import { randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { getConnInfo } from "@hono/node-server/conninfo";
import { evaluate, safeParseSignReading, type ParkingContext } from "@parking-lingo/core";
import type { Config } from "./config";
import { ApiError, errorBody } from "./errors";
import { checkImage } from "./image";
import { listMockFixtures } from "./mockSignReader";
import { RateLimiter } from "./rateLimit";
import { EvaluateBodySchema, formatIssues, ReadSignBodySchema, type RequestContext } from "./schemas";
import { SignReaderError, type ReadSignResult, type SignReader } from "./signReader";

export const SERVER_VERSION = "0.1.0";

export interface AppDeps {
  config: Config;
  reader: SignReader;
  /** Injectable clock (server "now" when the request has none). */
  clock?: () => Date;
  /** Injectable logger; defaults to one JSON line on stdout. */
  log?: (entry: Record<string, unknown>) => void;
}

type Env = { Variables: { requestId: string; logExtra: Record<string, unknown> } };

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

export function createApp(deps: AppDeps) {
  const { config, reader } = deps;
  const clock = deps.clock ?? (() => new Date());
  const log = deps.log ?? ((entry) => console.log(JSON.stringify(entry)));
  const readLimiter = new RateLimiter(config.rateLimitReadSign, config.rateLimitWindowMs);
  const evalLimiter = new RateLimiter(config.rateLimitEvaluate, config.rateLimitWindowMs);

  const app = new Hono<Env>();

  // Request id + access log (never logs bodies, images, or secrets).
  app.use("*", async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    c.set("requestId", requestId);
    c.set("logExtra", {});
    const started = performance.now();
    await next();
    c.header("x-request-id", requestId);
    if (config.logRequests) {
      log({
        t: new Date().toISOString(),
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - started),
        ...c.get("logExtra"),
      });
    }
  });

  if (config.corsOrigins.length > 0) {
    app.use(
      "*",
      cors({
        origin: config.corsOrigins.includes("*") ? "*" : config.corsOrigins,
        allowHeaders: ["content-type", "x-app-token", "x-request-id", "x-mock-fixture"],
        allowMethods: ["GET", "POST", "OPTIONS"],
        exposeHeaders: ["x-request-id", "retry-after"],
        maxAge: 600,
      }),
    );
  }

  app.onError((err, c) => {
    const requestId = c.get("requestId");
    const apiErr =
      err instanceof ApiError ? err : new ApiError(500, "internal_error", "Something went wrong. Please try again.");
    if (!(err instanceof ApiError) || apiErr.status >= 500 || apiErr.logDetail) {
      c.get("logExtra").error = {
        code: apiErr.code,
        detail: apiErr.logDetail ?? (err instanceof Error ? err.message : String(err)),
      };
    }
    if (apiErr.retryAfterSeconds !== undefined) c.header("retry-after", String(apiErr.retryAfterSeconds));
    return c.json(errorBody(apiErr, requestId), apiErr.status);
  });

  app.notFound((c) => c.json(errorBody(new ApiError(404, "not_found", `No route for ${c.req.method} ${c.req.path}`), c.get("requestId")), 404));

  app.get("/healthz", (c) =>
    c.json({
      ok: true,
      version: SERVER_VERSION,
      mode: config.mockVision ? "mock" : "live",
      model: config.mockVision ? "mock" : config.model,
      authRequired: config.appToken !== null,
    }),
  );

  // Shared app token (only enforced when configured).
  app.use("/v1/*", async (c, next) => {
    if (config.appToken !== null && !tokenMatches(c.req.header("x-app-token"), config.appToken)) {
      throw new ApiError(401, "unauthorized", "Missing or invalid x-app-token header.");
    }
    await next();
  });

  const limit = (limiter: RateLimiter) => async (c: Context<Env>, next: () => Promise<void>) => {
    if (limiter.limit > 0) {
      const r = limiter.hit(clientIp(c, config.trustProxy));
      c.header("x-ratelimit-limit", String(limiter.limit));
      c.header("x-ratelimit-remaining", String(r.remaining));
      if (!r.allowed) {
        throw new ApiError(429, "rate_limited", "Too many requests. Please wait a moment and try again.", r.retryAfterSeconds);
      }
    }
    await next();
  };

  const sizeLimit = bodyLimit({
    maxSize: config.maxBodyBytes,
    onError: () => {
      throw new ApiError(413, "payload_too_large", `Request body exceeds ${config.maxBodyBytes} bytes.`);
    },
  });

  app.post("/v1/read-sign", limit(readLimiter), sizeLimit, async (c) => {
    const body = await readJson(c);
    const parsed = ReadSignBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, "validation_failed", "Invalid request body.", undefined, formatIssues(parsed.error));
    }
    const { image, context } = parsed.data;
    const checked = checkImage(image, config.maxImageBytes);
    const now = context.now !== undefined ? new Date(context.now) : clock();
    const mockFixtureId = config.mockVision ? c.req.header("x-mock-fixture")?.trim() || null : null;

    const result = await withDeadline(config.readTimeoutMs, c.req.raw.signal, (signal) =>
      reader.read({
        image: { base64: checked.base64, mediaType: checked.mediaType },
        now,
        timeZone: context.timeZone,
        jurisdictionHint: context.jurisdictionHint ?? null,
        mockFixtureId,
        signal,
      }),
    );
    Object.assign(c.get("logExtra"), {
      model: result.model,
      attempts: result.attempts,
      imageBytes: checked.bytes,
      ...(result.usage ? { usage: result.usage } : {}),
      ...(result.mock ? { mockFixture: result.mock.fixtureId } : {}),
    });

    // Mock mode without an explicit `now`: use the fixture's demo time so the demo is interesting.
    const evalNow = context.now === undefined && result.mock ? new Date(result.mock.demoNow) : now;
    const verdict = runEvaluate(result.reading, toParkingContext(context, evalNow));
    c.header("cache-control", "no-store");
    return c.json({
      reading: result.reading,
      verdict,
      requestId: c.get("requestId"),
      meta: meta(result),
    });
  });

  app.post("/v1/evaluate", limit(evalLimiter), sizeLimit, async (c) => {
    const body = await readJson(c);
    const parsed = EvaluateBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, "validation_failed", "Invalid request body.", undefined, formatIssues(parsed.error));
    }
    const reading = safeParseSignReading(parsed.data.reading);
    if (!reading.success) {
      throw new ApiError(400, "validation_failed", "Invalid reading.", undefined, formatIssues(reading.error, "reading"));
    }
    const ctx = parsed.data.context;
    const now = ctx.now !== undefined ? new Date(ctx.now) : clock();
    const verdict = runEvaluate(reading.data, toParkingContext(ctx, now));
    c.header("cache-control", "no-store");
    return c.json({ verdict, requestId: c.get("requestId") });
  });

  if (config.mockVision) {
    app.get("/v1/mock-fixtures", (c) => c.json({ fixtures: listMockFixtures() }));
  }

  return app;
}

function meta(result: ReadSignResult) {
  return {
    model: result.model,
    attempts: result.attempts,
    ...(result.mock ? { mock: { fixtureId: result.mock.fixtureId, title: result.mock.title } } : {}),
  };
}

async function readJson(c: Context<Env>): Promise<unknown> {
  const type = c.req.header("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Content-Type must be application/json.");
  }
  try {
    return await c.req.json();
  } catch (err) {
    if (err instanceof ApiError) throw err; // body-limit error raised while reading the stream
    throw new ApiError(400, "invalid_json", "Request body is not valid JSON.");
  }
}

function toParkingContext(ctx: RequestContext, now: Date): ParkingContext {
  // jurisdictionHint goes to the model only; everything else maps 1:1 onto ParkingContext.
  const { jurisdictionHint: _hint, now: _now, ...rest } = ctx;
  return { ...rest, now };
}

function runEvaluate(reading: Parameters<typeof evaluate>[0], ctx: ParkingContext) {
  try {
    return evaluate(reading, ctx);
  } catch (err) {
    throw new ApiError(400, "bad_request", `Couldn't evaluate this context: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  // Hash both sides so lengths match and the comparison is constant-time.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function clientIp(c: Context<Env>, trustProxy: boolean): string {
  if (trustProxy) {
    const fly = c.req.header("fly-client-ip");
    if (fly) return fly.trim();
    const xff = c.req.header("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
    const real = c.req.header("x-real-ip");
    if (real) return real.trim();
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown"; // e.g. app.request() in tests
  }
}

/** Run `fn` with an AbortSignal that fires on the deadline or client disconnect; map reader errors to HTTP. */
async function withDeadline<T>(ms: number, clientSignal: AbortSignal | undefined, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("deadline"));
  }, ms);
  const onClientAbort = () => controller.abort(new Error("client disconnected"));
  clientSignal?.addEventListener("abort", onClientAbort, { once: true });
  const deadline = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () =>
      reject(new SignReaderError("timeout", timedOut ? "Reading the sign took too long." : "Request cancelled.")),
    );
  });
  try {
    return await Promise.race([fn(controller.signal), deadline]);
  } catch (err) {
    const apiErr = toApiError(err, timedOut);
    apiErr.logDetail ??= err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    throw apiErr;
  } finally {
    clearTimeout(timer);
    clientSignal?.removeEventListener("abort", onClientAbort);
  }
}

export function toApiError(err: unknown, timedOut = false): ApiError {
  if (err instanceof ApiError) return err;
  if (!(err instanceof SignReaderError)) {
    return new ApiError(500, "internal_error", "Something went wrong reading the sign. Please try again.");
  }
  switch (err.kind) {
    case "refused":
      return new ApiError(422, "model_refused", "This photo couldn't be read. Try another photo of the sign.");
    case "invalid_output":
      return new ApiError(502, "invalid_model_output", "Couldn't get a valid reading of the sign. Please try again.", 2);
    case "rate_limited":
      return new ApiError(503, "upstream_rate_limited", "The sign reader is busy. Please try again shortly.", err.retryAfterSeconds ?? 10);
    case "overloaded":
      return new ApiError(503, "upstream_overloaded", "The sign reader is overloaded. Please try again shortly.", err.retryAfterSeconds ?? 15);
    case "timeout":
      return new ApiError(504, "upstream_timeout", timedOut ? "Reading the sign took too long. Please try again." : err.message, 5);
    case "unavailable":
      return new ApiError(502, "upstream_unavailable", "Couldn't reach the sign reader. Please try again.", err.retryAfterSeconds ?? 5);
    case "auth":
      return new ApiError(500, "server_misconfigured", "The server is misconfigured. Please try again later.");
    case "bad_request":
      return new ApiError(502, "upstream_error", "The sign reader rejected this photo. Try retaking it as a JPEG.");
    case "unknown_fixture":
      return new ApiError(400, "bad_request", err.message);
    case "upstream":
    default:
      return new ApiError(502, "upstream_error", "The sign reader failed. Please try again.", err.retryAfterSeconds ?? 5);
  }
}


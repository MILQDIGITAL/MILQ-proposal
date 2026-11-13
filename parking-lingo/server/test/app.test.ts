import { describe, expect, it } from "vitest";
import { SignReaderError, type SignReaderErrorKind } from "../src/signReader";
import {
  FakeReader,
  FIXED_NOW,
  makeApp,
  post,
  readerReturning,
  readSignBody,
  splitSides,
  TINY_HEIC_B64,
  TINY_PNG_B64,
  twoPMeter,
} from "./helpers";

describe("GET /healthz", () => {
  it("reports ok without auth", async () => {
    const app = makeApp(readerReturning(twoPMeter), { appToken: "secret" });
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ ok: true, mode: "live", authRequired: true });
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("POST /v1/read-sign", () => {
  it("returns reading + verdict + requestId (happy path)", async () => {
    const reader = readerReturning(twoPMeter);
    const app = makeApp(reader);
    const res = await post(app, "/v1/read-sign", readSignBody({ context: { now: "2026-11-12T10:30:00+11:00", side: "left" } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.reading).toEqual(twoPMeter);
    expect(body.verdict.status).toBe("yes_with_conditions");
    expect(body.verdict.currentLimitMinutes).toBe(120);
    expect(body.verdict.paymentRequired).toBe(true);
    expect(body.verdict.timeZone).toBe("Australia/Sydney");
    expect(body.requestId).toBe(res.headers.get("x-request-id"));
    expect(body.meta).toEqual({ model: "fake-model", attempts: 1 });
    expect(res.headers.get("cache-control")).toBe("no-store");

    // The reader got the image, the resolved now and the zone.
    expect(reader.calls).toHaveLength(1);
    const call = reader.calls[0]!;
    expect(call.image.mediaType).toBe("image/jpeg");
    expect(call.now.toISOString()).toBe("2026-11-11T23:30:00.000Z");
    expect(call.timeZone).toBe("Australia/Sydney");
    expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  it("defaults now to server time and passes the jurisdiction hint", async () => {
    const reader = readerReturning(twoPMeter);
    const app = makeApp(reader);
    const res = await post(app, "/v1/read-sign", readSignBody({ context: { jurisdictionHint: "AU-NSW" } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(reader.calls[0]!.now.toISOString()).toBe(FIXED_NOW.toISOString());
    expect(reader.calls[0]!.jurisdictionHint).toBe("AU-NSW");
    expect(body.verdict.evaluatedAt).toBe(FIXED_NOW.toISOString());
  });

  it("echoes a sane incoming x-request-id", async () => {
    const app = makeApp(readerReturning(twoPMeter));
    const res = await post(app, "/v1/read-sign", readSignBody(), { "x-request-id": "app-req-12345678" });
    expect((await res.json() as any).requestId).toBe("app-req-12345678");
  });

  it("uses the sniffed media type when the declared one is wrong", async () => {
    const reader = readerReturning(twoPMeter);
    const app = makeApp(reader);
    const res = await post(app, "/v1/read-sign", readSignBody({ image: { base64: TINY_PNG_B64, mediaType: "image/jpeg" } }));
    expect(res.status).toBe(200);
    expect(reader.calls[0]!.image.mediaType).toBe("image/png");
  });

  it("accepts a data: URL and image/jpg alias", async () => {
    const reader = readerReturning(twoPMeter);
    const app = makeApp(reader);
    const res = await post(
      app,
      "/v1/read-sign",
      readSignBody({ image: { base64: `data:image/jpeg;base64,${readSignBody().image.base64}`, mediaType: "image/jpg" } }),
    );
    expect(res.status).toBe(200);
  });

  describe("validation", () => {
    const app = makeApp(readerReturning(twoPMeter), { maxImageBytes: 1024, maxBodyBytes: 4096 });

    it.each([
      ["missing context", { image: readSignBody().image }, 400, "validation_failed"],
      ["missing image", { context: readSignBody().context }, 400, "validation_failed"],
      ["bad time zone", readSignBody({ context: { timeZone: "Mars/Olympus" } }), 400, "validation_failed"],
      ["bad now", readSignBody({ context: { now: "yesterday" } }), 400, "validation_failed"],
      ["now without offset", readSignBody({ context: { now: "2026-11-12T10:30:00" } }), 400, "validation_failed"],
      ["bad side", readSignBody({ context: { side: "middle" } }), 400, "validation_failed"],
      ["bad vehicleType", readSignBody({ context: { vehicleType: "spaceship" } }), 400, "validation_failed"],
      ["negative stay", readSignBody({ context: { intendedStayMinutes: -5 } }), 400, "validation_failed"],
      ["heic declared", readSignBody({ image: { mediaType: "image/heic" } }), 415, "unsupported_media_type"],
      ["heic bytes", readSignBody({ image: { base64: TINY_HEIC_B64, mediaType: "image/jpeg" } }), 415, "unsupported_media_type"],
      ["unknown media type", readSignBody({ image: { mediaType: "application/pdf" } }), 415, "unsupported_media_type"],
      ["not base64", readSignBody({ image: { base64: "not base64!!" } }), 400, "image_invalid"],
      ["not an image", readSignBody({ image: { base64: Buffer.from("hello world!").toString("base64") } }), 400, "image_invalid"],
      ["image too large", readSignBody({ image: { base64: "/9j/" + "A".repeat(1500) } }), 413, "image_too_large"],
    ])("%s -> %i %s", async (_name, body, status, code) => {
      const res = await post(app, "/v1/read-sign", body);
      expect(res.status).toBe(status);
      const json = (await res.json()) as any;
      expect(json.error.code).toBe(code);
      expect(typeof json.error.message).toBe("string");
      expect(json.requestId).toBeTruthy();
    });

    it("lists validation issues with paths", async () => {
      const res = await post(app, "/v1/read-sign", readSignBody({ context: { timeZone: "Nope/Nope" } }));
      const json = (await res.json()) as any;
      expect(json.error.details).toEqual([expect.objectContaining({ path: "context.timeZone" })]);
    });

    it("rejects invalid JSON", async () => {
      const res = await post(app, "/v1/read-sign", "{not json");
      expect(res.status).toBe(400);
      expect((await res.json() as any).error.code).toBe("invalid_json");
    });

    it("rejects a non-JSON content type", async () => {
      const res = await app.request("/v1/read-sign", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
      expect(res.status).toBe(415);
    });

    it("rejects bodies over the body limit", async () => {
      const res = await post(app, "/v1/read-sign", readSignBody({ image: { base64: "/9j/" + "A".repeat(8000) } }));
      expect(res.status).toBe(413);
      expect((await res.json() as any).error.code).toBe("payload_too_large");
    });
  });

  describe("upstream error mapping", () => {
    it.each<[SignReaderErrorKind, number, string, boolean]>([
      ["rate_limited", 503, "upstream_rate_limited", true],
      ["overloaded", 503, "upstream_overloaded", true],
      ["timeout", 504, "upstream_timeout", true],
      ["unavailable", 502, "upstream_unavailable", true],
      ["refused", 422, "model_refused", false],
      ["invalid_output", 502, "invalid_model_output", true],
      ["auth", 500, "server_misconfigured", false],
      ["bad_request", 502, "upstream_error", false],
      ["upstream", 502, "upstream_error", true],
    ])("%s -> %i %s", async (kind, status, code, hasRetry) => {
      const app = makeApp(new FakeReader(() => Promise.reject(new SignReaderError(kind, "boom", 7))));
      const res = await post(app, "/v1/read-sign", readSignBody());
      expect(res.status).toBe(status);
      const json = (await res.json()) as any;
      expect(json.error.code).toBe(code);
      if (hasRetry) {
        expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
        expect(json.error.retryAfterSeconds).toBeGreaterThan(0);
      } else {
        expect(res.headers.get("retry-after")).toBeNull();
      }
    });

    it("passes the upstream retry-after through for rate limits", async () => {
      const app = makeApp(new FakeReader(() => Promise.reject(new SignReaderError("rate_limited", "x", 42))));
      const res = await post(app, "/v1/read-sign", readSignBody());
      expect(res.headers.get("retry-after")).toBe("42");
    });

    it("does not leak internal error details", async () => {
      const app = makeApp(new FakeReader(() => Promise.reject(new Error("secret internal stack"))));
      const res = await post(app, "/v1/read-sign", readSignBody());
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).toContain("internal_error");
      expect(text).not.toContain("secret internal stack");
    });

    it("times out a slow reader with 504 and aborts its signal", async () => {
      let seen: AbortSignal | undefined;
      const reader = new FakeReader((input) => {
        seen = input.signal;
        return new Promise(() => {}); // never resolves
      });
      const app = makeApp(reader, { readTimeoutMs: 50 });
      const res = await post(app, "/v1/read-sign", readSignBody());
      expect(res.status).toBe(504);
      expect((await res.json() as any).error.code).toBe("upstream_timeout");
      expect(seen?.aborted).toBe(true);
    });
  });

  it("returns 'Not a parking sign' as an unsure verdict, not an error", async () => {
    const app = makeApp(
      readerReturning({ isParkingSign: false, panels: [], overallConfidence: 0.9, legibilityIssues: ["Street name sign"], jurisdictionHint: null }),
    );
    const res = await post(app, "/v1/read-sign", readSignBody());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.verdict.status).toBe("unsure");
    expect(body.verdict.headline).toBe("Not a parking sign");
  });
});

describe("app token", () => {
  const app = makeApp(readerReturning(twoPMeter), { appToken: "s3cret-token" });

  it("rejects missing token", async () => {
    const res = await post(app, "/v1/read-sign", readSignBody());
    expect(res.status).toBe(401);
    expect((await res.json() as any).error.code).toBe("unauthorized");
  });

  it("rejects wrong token", async () => {
    const res = await post(app, "/v1/evaluate", { reading: twoPMeter, context: { timeZone: "Australia/Sydney" } }, { "x-app-token": "nope" });
    expect(res.status).toBe(401);
  });

  it("accepts the right token", async () => {
    const res = await post(app, "/v1/read-sign", readSignBody(), { "x-app-token": "s3cret-token" });
    expect(res.status).toBe(200);
  });

  it("is not enforced when unset", async () => {
    const open = makeApp(readerReturning(twoPMeter), { appToken: null });
    const res = await post(open, "/v1/read-sign", readSignBody());
    expect(res.status).toBe(200);
  });
});

describe("rate limiting", () => {
  it("limits per IP and returns 429 with Retry-After", async () => {
    const reader = readerReturning(twoPMeter);
    const app = makeApp(reader, { rateLimitReadSign: 2, rateLimitWindowMs: 60_000 });
    const ip = { "x-forwarded-for": "203.0.113.7" };
    expect((await post(app, "/v1/read-sign", readSignBody(), ip)).status).toBe(200);
    const second = await post(app, "/v1/read-sign", readSignBody(), ip);
    expect(second.status).toBe(200);
    expect(second.headers.get("x-ratelimit-remaining")).toBe("0");
    const third = await post(app, "/v1/read-sign", readSignBody(), ip);
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await third.json() as any).error.code).toBe("rate_limited");
    expect(reader.calls).toHaveLength(2); // the limited request never reached the model

    // Another IP is unaffected.
    expect((await post(app, "/v1/read-sign", readSignBody(), { "x-forwarded-for": "203.0.113.8" })).status).toBe(200);
  });

  it("uses a separate budget for /v1/evaluate", async () => {
    const app = makeApp(readerReturning(twoPMeter), { rateLimitReadSign: 1, rateLimitEvaluate: 5 });
    const ip = { "x-forwarded-for": "198.51.100.1" };
    await post(app, "/v1/read-sign", readSignBody(), ip);
    expect((await post(app, "/v1/read-sign", readSignBody(), ip)).status).toBe(429);
    const ev = await post(app, "/v1/evaluate", { reading: twoPMeter, context: { timeZone: "Australia/Sydney" } }, ip);
    expect(ev.status).toBe(200);
  });

  it("can be disabled with 0", async () => {
    const app = makeApp(readerReturning(twoPMeter), { rateLimitReadSign: 0 });
    const ip = { "x-forwarded-for": "198.51.100.2" };
    for (let i = 0; i < 5; i++) expect((await post(app, "/v1/read-sign", readSignBody(), ip)).status).toBe(200);
  });
});

describe("POST /v1/evaluate", () => {
  const app = makeApp(readerReturning(twoPMeter));

  it("evaluates a reading against a context", async () => {
    const res = await post(app, "/v1/evaluate", {
      reading: twoPMeter,
      context: { now: "2026-11-12T10:30:00+11:00", timeZone: "Australia/Sydney" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.verdict.status).toBe("yes_with_conditions");
    expect(body.verdict.leaveBy).toBe("2026-11-12T01:30:00.000Z"); // 12:30 pm Sydney
    expect(body.requestId).toBeTruthy();
  });

  it("re-evaluates when the user picks a side", async () => {
    const context = { now: "2026-11-12T11:00:00+11:00", timeZone: "Australia/Sydney" };
    const unknown = (await (await post(app, "/v1/evaluate", { reading: splitSides, context })).json()) as any;
    const left = (await (await post(app, "/v1/evaluate", { reading: splitSides, context: { ...context, side: "left" } })).json()) as any;
    const right = (await (await post(app, "/v1/evaluate", { reading: splitSides, context: { ...context, side: "right" } })).json()) as any;
    expect(unknown.verdict.bySide).not.toBeNull();
    expect(left.verdict.side).toBe("left");
    expect(right.verdict.side).toBe("right");
    expect(left.verdict.status).not.toBe(right.verdict.status);
  });

  it("defaults now to server time", async () => {
    const res = await post(app, "/v1/evaluate", { reading: twoPMeter, context: { timeZone: "Australia/Sydney" } });
    expect((await res.json() as any).verdict.evaluatedAt).toBe(FIXED_NOW.toISOString());
  });

  it("rejects an invalid reading with paths under 'reading'", async () => {
    const bad = { ...twoPMeter, overallConfidence: 7 };
    const res = await post(app, "/v1/evaluate", { reading: bad, context: { timeZone: "Australia/Sydney" } });
    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe("validation_failed");
    expect(json.error.details[0].path).toBe("reading.overallConfidence");
  });

  it("rejects a missing context", async () => {
    const res = await post(app, "/v1/evaluate", { reading: twoPMeter });
    expect(res.status).toBe(400);
  });
});

describe("misc", () => {
  it("returns JSON 404s", async () => {
    const app = makeApp(readerReturning(twoPMeter));
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
    expect((await res.json() as any).error.code).toBe("not_found");
  });

  it("allows configured CORS origins", async () => {
    const app = makeApp(readerReturning(twoPMeter), { corsOrigins: ["https://example.test"] });
    const res = await app.request("/healthz", { headers: { origin: "https://example.test" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://example.test");
  });

  it("never logs image data", async () => {
    const lines: string[] = [];
    const { createApp } = await import("../src/app");
    const { testConfig } = await import("../src/config");
    const app = createApp({
      config: testConfig({ logRequests: true, trustProxy: "xff" }),
      reader: readerReturning(twoPMeter),
      log: (e) => lines.push(JSON.stringify(e)),
    });
    const body = readSignBody();
    await post(app, "/v1/read-sign", body);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(body.image.base64);
    expect(JSON.parse(lines[0]!)).toMatchObject({ path: "/v1/read-sign", status: 200, model: "fake-model" });
  });
});

/**
 * Parking Lingo API client: POST /v1/read-sign with timeout + cancellation and typed errors.
 * Pure TypeScript (fetch is injectable) so it can be unit tested in Node.
 */
import { safeParseSignReading, type Side, type SignReading, type Verdict, type VehicleType } from "@parking-lingo/core";
import { AppError, errorFromResponse, errorFromThrown } from "./errors";

/** The `context` object the server accepts (JSON-safe). */
export interface ServerContext {
  now?: string;
  timeZone: string;
  side?: Side | "unknown";
  permits?: string[];
  hasDisabilityPermit?: boolean;
  vehicleType?: VehicleType;
  isElectricVehicle?: boolean;
  intendedStayMinutes?: number | null;
  isPublicHoliday?: boolean | "unknown";
  /** Extra known public holidays, local 'YYYY-MM-DD'. */
  publicHolidayDates?: string[];
  jurisdictionHint?: string | null;
}

export interface ReadSignRequest {
  image: { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" };
  context: ServerContext;
}

export interface ReadSignResult {
  reading: SignReading;
  /** The server's verdict (the app re-evaluates locally, but keeps this as a fallback). */
  verdict: Verdict | null;
  requestId: string | null;
  meta: { model?: string; attempts?: number; mock?: { fixtureId?: string; title?: string } } | null;
}

export interface ClientOptions {
  baseUrl: string | null;
  appToken?: string | null;
  timeoutMs?: number;
  /** Cancel from the UI. */
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Dev: fixture id sent as `x-mock-fixture` (server mock mode only). */
  mockFixture?: string | null;
}

export async function readSign(req: ReadSignRequest, opts: ClientOptions): Promise<ReadSignResult> {
  if (!opts.baseUrl) throw new AppError("not_configured", "EXPO_PUBLIC_API_URL is not set.");
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  let abortReason: "timeout" | "cancelled" | null = null;

  const onExternalAbort = () => {
    abortReason = "cancelled";
    controller.abort();
  };
  if (opts.signal) {
    if (opts.signal.aborted) throw new AppError("cancelled", "Cancelled.");
    opts.signal.addEventListener("abort", onExternalAbort);
  }
  const timer = setTimeout(() => {
    abortReason = "timeout";
    controller.abort();
  }, opts.timeoutMs ?? 75_000);

  try {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (opts.appToken) headers["x-app-token"] = opts.appToken;
    if (opts.mockFixture) headers["x-mock-fixture"] = opts.mockFixture;

    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}/v1/read-sign`, {
        method: "POST",
        headers,
        body: JSON.stringify(req),
        signal: controller.signal,
      });
    } catch (err) {
      throw errorFromThrown(err, abortReason);
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch (err) {
      if (abortReason) throw errorFromThrown(err, abortReason);
      body = null;
    }

    if (!res.ok) throw errorFromResponse(res.status, body, res.headers?.get?.("retry-after") ?? null);
    return parseReadSignBody(body);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onExternalAbort);
  }
}

/** Validate a 2xx body. The reading is untrusted, so it's re-validated with the core schema. */
export function parseReadSignBody(body: unknown): ReadSignResult {
  if (!body || typeof body !== "object") {
    throw new AppError("invalid_response", "The server sent an empty or non-JSON response.");
  }
  const b = body as { reading?: unknown; verdict?: unknown; requestId?: unknown; meta?: unknown };
  const parsed = safeParseSignReading(b.reading);
  if (!parsed.success) {
    throw new AppError("invalid_response", "The server's sign reading didn't match the expected format.", {
      requestId: typeof b.requestId === "string" ? b.requestId : null,
    });
  }
  const verdict =
    b.verdict && typeof b.verdict === "object" && typeof (b.verdict as Verdict).status === "string"
      ? (b.verdict as Verdict)
      : null;
  const meta = b.meta && typeof b.meta === "object" ? (b.meta as ReadSignResult["meta"]) : null;
  return { reading: parsed.data, verdict, requestId: typeof b.requestId === "string" ? b.requestId : null, meta };
}

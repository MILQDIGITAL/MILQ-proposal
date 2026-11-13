/**
 * Typed app errors and the mapping from HTTP / network failures / sign readings to
 * friendly, actionable copy. Pure: no React Native imports (unit tested).
 */
import type { SignReading } from "@parking-lingo/core";

export type AppErrorCode =
  | "not_configured"
  | "offline"
  | "timeout"
  | "cancelled"
  | "unavailable"
  | "rate_limited"
  | "unauthorized"
  | "bad_image"
  | "not_parking_sign"
  | "unreadable"
  | "invalid_response"
  | "server";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number | null;
  readonly serverCode: string | null;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: AppErrorCode,
    message: string,
    extra: {
      status?: number | null;
      serverCode?: string | null;
      requestId?: string | null;
      retryAfterSeconds?: number | null;
    } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = extra.status ?? null;
    this.serverCode = extra.serverCode ?? null;
    this.requestId = extra.requestId ?? null;
    this.retryAfterSeconds = extra.retryAfterSeconds ?? null;
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

/** Server error codes (see server/src/errors.ts) → app error codes. */
const SERVER_CODE_MAP: Record<string, AppErrorCode> = {
  image_too_large: "bad_image",
  payload_too_large: "bad_image",
  image_invalid: "bad_image",
  unsupported_media_type: "bad_image",
  unauthorized: "unauthorized",
  rate_limited: "rate_limited",
  upstream_rate_limited: "rate_limited",
  upstream_overloaded: "unavailable",
  upstream_unavailable: "unavailable",
  upstream_timeout: "timeout",
  model_refused: "unreadable",
  invalid_model_output: "unreadable",
  not_parking_sign: "not_parking_sign",
  too_blurry: "unreadable",
  unreadable: "unreadable",
};

function codeFromStatus(status: number): AppErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 413 || status === 415) return "bad_image";
  if (status === 429) return "rate_limited";
  if (status === 502 || status === 503 || status === 529) return "unavailable";
  if (status === 504 || status === 408) return "timeout";
  return "server";
}

/** Map a non-2xx HTTP response (parsed JSON body, or null if not JSON). */
export function errorFromResponse(status: number, body: unknown, retryAfterHeader?: string | null): AppError {
  let serverCode: string | null = null;
  let message = `Server responded ${status}`;
  let requestId: string | null = null;
  let retryAfterSeconds: number | null = null;
  if (body && typeof body === "object") {
    const b = body as { error?: { code?: unknown; message?: unknown; retryAfterSeconds?: unknown }; requestId?: unknown };
    if (b.error && typeof b.error === "object") {
      if (typeof b.error.code === "string") serverCode = b.error.code;
      if (typeof b.error.message === "string") message = b.error.message;
      if (typeof b.error.retryAfterSeconds === "number") retryAfterSeconds = b.error.retryAfterSeconds;
    }
    if (typeof b.requestId === "string") requestId = b.requestId;
  }
  if (retryAfterSeconds == null && retryAfterHeader) {
    const n = Number(retryAfterHeader);
    if (Number.isFinite(n) && n >= 0) retryAfterSeconds = n;
  }
  const code = (serverCode && SERVER_CODE_MAP[serverCode]) || codeFromStatus(status);
  return new AppError(code, message, { status, serverCode, requestId, retryAfterSeconds });
}

/**
 * Map something thrown by fetch/abort into an AppError. `reason` says why we aborted
 * (our own timeout vs. the user cancelling), since both surface as AbortError.
 */
export function errorFromThrown(err: unknown, reason: "timeout" | "cancelled" | null): AppError {
  if (isAppError(err)) return err;
  if (reason === "timeout") return new AppError("timeout", "The request timed out.");
  if (reason === "cancelled") return new AppError("cancelled", "Cancelled.");
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "AbortError") return new AppError("cancelled", "Cancelled.");
  // fetch() rejects with a TypeError ("Network request failed" on RN, "Failed to fetch" on web)
  // when there is no connection, DNS fails or the server is unreachable.
  if (err instanceof TypeError || name === "TypeError") {
    return new AppError("offline", err instanceof Error ? err.message : "Network request failed");
  }
  return new AppError("server", err instanceof Error ? err.message : String(err));
}

/**
 * A successful response can still be unusable: not a parking sign, or too blurry to read.
 * Returns the error to show instead of a result, or null if the reading is usable.
 * Readings that are merely uncertain (0.5–0.75) are still shown — the engine answers
 * conservatively and explains why.
 */
export function errorFromReading(reading: SignReading, minConfidence = 0.5): AppError | null {
  if (!reading.isParkingSign) return new AppError("not_parking_sign", "The photo isn't a parking sign.");
  if (reading.panels.length === 0) return new AppError("unreadable", "No sign panels were found.");
  if (reading.overallConfidence < minConfidence) {
    const issues = reading.legibilityIssues.length ? ` (${reading.legibilityIssues.join("; ")})` : "";
    return new AppError("unreadable", `The sign couldn't be read clearly${issues}.`);
  }
  return null;
}

export type ErrorAction = "retry" | "rescan" | "demo" | "settings" | "none";

export interface ErrorCopy {
  title: string;
  message: string;
  /** Ionicons glyph name. */
  icon: string;
  primary: ErrorAction;
  secondary: ErrorAction;
}

export function errorCopy(error: AppError): ErrorCopy {
  switch (error.code) {
    case "not_configured":
      return {
        title: "No server set up",
        message: "This build isn't connected to the sign-reading service yet. You can still try the app with demo signs.",
        icon: "construct-outline",
        primary: "demo",
        secondary: "rescan",
      };
    case "offline":
      return {
        title: "Can't connect",
        message: "We couldn't reach the server. Check your mobile data or Wi-Fi and try again.",
        icon: "cloud-offline-outline",
        primary: "retry",
        secondary: "rescan",
      };
    case "timeout":
      return {
        title: "That took too long",
        message: "The connection is slow or the service is busy. Try again — it usually works second time.",
        icon: "time-outline",
        primary: "retry",
        secondary: "rescan",
      };
    case "cancelled":
      return { title: "Cancelled", message: "Scan cancelled.", icon: "close-circle-outline", primary: "rescan", secondary: "none" };
    case "unavailable":
      return {
        title: "Service is busy",
        message: "The sign reader is overloaded right now. Wait a moment and try again.",
        icon: "hourglass-outline",
        primary: "retry",
        secondary: "rescan",
      };
    case "rate_limited":
      return {
        title: "Too many scans",
        message:
          error.retryAfterSeconds != null
            ? `Please wait ${Math.max(1, Math.ceil(error.retryAfterSeconds))} seconds, then try again.`
            : "Please wait a moment, then try again.",
        icon: "speedometer-outline",
        primary: "retry",
        secondary: "rescan",
      };
    case "unauthorized":
      return {
        title: "App not authorised",
        message: "The server rejected this app's access token. Update the app or check its configuration.",
        icon: "lock-closed-outline",
        primary: "rescan",
        secondary: "demo",
      };
    case "bad_image":
      return {
        title: "Couldn't use that photo",
        message: "The photo couldn't be processed. Take a new photo of the sign.",
        icon: "image-outline",
        primary: "rescan",
        secondary: "none",
      };
    case "not_parking_sign":
      return {
        title: "That's not a parking sign",
        message: "Point the camera at the parking sign on the pole so the whole sign fills the frame.",
        icon: "help-buoy-outline",
        primary: "rescan",
        secondary: "none",
      };
    case "unreadable":
      return {
        title: "Move closer and rescan",
        message: "The sign was too blurry or too far away to read. Get closer, hold steady and avoid glare.",
        icon: "scan-outline",
        primary: "rescan",
        secondary: "retry",
      };
    case "invalid_response":
    case "server":
      return {
        title: "Something went wrong",
        message: "The server had a problem reading this sign. Try again.",
        icon: "alert-circle-outline",
        primary: "retry",
        secondary: "rescan",
      };
  }
}

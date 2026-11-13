import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Stable, machine-readable error codes returned as `{ error: { code, message } }`. */
export type ErrorCode =
  | "bad_request"
  | "invalid_json"
  | "validation_failed"
  | "unsupported_media_type"
  | "image_too_large"
  | "image_invalid"
  | "payload_too_large"
  | "unauthorized"
  | "rate_limited"
  | "not_found"
  | "model_refused"
  | "invalid_model_output"
  | "upstream_rate_limited"
  | "upstream_overloaded"
  | "upstream_timeout"
  | "upstream_unavailable"
  | "upstream_error"
  | "server_misconfigured"
  | "internal_error";

export class ApiError extends Error {
  /** Server-side log detail (never sent to the client). */
  logDetail?: string;

  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    /** Seconds; sent as Retry-After and `error.retryAfterSeconds`. */
    readonly retryAfterSeconds?: number,
    /** Optional structured details (e.g. validation issues). Never contains image data. */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    retryAfterSeconds?: number;
    details?: unknown;
  };
  requestId?: string;
}

export function errorBody(err: ApiError, requestId?: string): ErrorBody {
  const body: ErrorBody = { error: { code: err.code, message: err.message } };
  if (err.retryAfterSeconds !== undefined) body.error.retryAfterSeconds = err.retryAfterSeconds;
  if (err.details !== undefined) body.error.details = err.details;
  if (requestId) body.requestId = requestId;
  return body;
}

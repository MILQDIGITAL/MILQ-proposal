import type { SignReading } from "@parking-lingo/core";

export type SupportedMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export interface ReadSignInput {
  image: { base64: string; mediaType: SupportedMediaType };
  /** The instant "now" for the user, already resolved (defaults to server time). */
  now: Date;
  /** IANA zone of the sign's location. */
  timeZone: string;
  /** Optional hint from the app, e.g. "AU-NSW". */
  jurisdictionHint?: string | null;
  /** Mock mode only: pick a fixture by id. */
  mockFixtureId?: string | null;
  /** Aborted when the request deadline passes or the client disconnects. */
  signal?: AbortSignal;
}

export interface ReadSignResult {
  reading: SignReading;
  /** Model that produced the reading ("mock" in mock mode). */
  model: string;
  /** Number of model calls made (1, or 2 after a validation retry). */
  attempts: number;
  /** Mock mode: the fixture used, and its demo context. */
  mock?: { fixtureId: string; title: string; demoNow: string };
  usage?: { inputTokens: number; outputTokens: number; cacheReadInputTokens: number };
}

/** Reads a parking-sign photo into a SignReading. The only component that talks to a model. */
export interface SignReader {
  read(input: ReadSignInput): Promise<ReadSignResult>;
}

export type SignReaderErrorKind =
  | "refused"
  | "invalid_output"
  | "rate_limited"
  | "overloaded"
  | "timeout"
  | "unavailable"
  | "auth"
  | "bad_request"
  | "upstream"
  | "unknown_fixture";

/** Provider-neutral failure from a SignReader; the HTTP layer maps it to a status code. */
export class SignReaderError extends Error {
  constructor(
    readonly kind: SignReaderErrorKind,
    message: string,
    readonly retryAfterSeconds?: number,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SignReaderError";
  }
}

/**
 * Server configuration, read once from the environment.
 * Secrets (ANTHROPIC_API_KEY, PARKING_LINGO_APP_TOKEN) are never logged.
 */

/** Claude's base64 image limit is 5 MB per image (decoded bytes). */
export const API_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const DEFAULT_MODEL = "claude-opus-5-5";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface Config {
  port: number;
  host: string;
  /** Model used for sign reading. */
  model: string;
  /** output_config.effort for the vision call. */
  effort: Effort;
  /** Opt into server-side refusal fallbacks (`fallbacks: "default"`). */
  refusalFallback: boolean;
  /** Return fixtures instead of calling Claude. */
  mockVision: boolean;
  /** Shared app token; enforced on /v1/* only when set. */
  appToken: string | null;
  /** Max decoded image size in bytes (capped at the API's 5 MB). */
  maxImageBytes: number;
  /** Max request body size in bytes (derived from maxImageBytes unless set). */
  maxBodyBytes: number;
  /** Overall deadline for one /v1/read-sign request, ms. */
  readTimeoutMs: number;
  /** SDK-level retries for 429/5xx/connection errors (within the deadline). */
  upstreamMaxRetries: number;
  /** Per-IP requests per window for /v1/read-sign (0 disables). */
  rateLimitReadSign: number;
  /** Per-IP requests per window for /v1/evaluate (0 disables). */
  rateLimitEvaluate: number;
  rateLimitWindowMs: number;
  /** Trust X-Forwarded-For / Fly-Client-IP for the client IP (set behind a proxy). */
  trustProxy: boolean;
  /** CORS allowed origins; empty = CORS disabled. '*' allowed. */
  corsOrigins: string[];
  /** Log one JSON line per request. */
  logRequests: boolean;
}

type Env = Record<string, string | undefined>;

function int(env: Env, key: string, fallback: number, min = 0): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
    throw new Error(`Invalid ${key}: expected an integer >= ${min}`);
  }
  return n;
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function loadConfig(env: Env = process.env): Config {
  const effortRaw = (env.PARKING_LINGO_EFFORT ?? "medium").trim() as Effort;
  if (!EFFORTS.includes(effortRaw)) {
    throw new Error(`Invalid PARKING_LINGO_EFFORT: expected one of ${EFFORTS.join(", ")}`);
  }
  const maxImageBytes = Math.min(int(env, "MAX_IMAGE_BYTES", API_MAX_IMAGE_BYTES, 1024), API_MAX_IMAGE_BYTES);
  // base64 inflates by 4/3; leave room for the JSON envelope and context.
  const derivedBody = Math.ceil((maxImageBytes * 4) / 3) + 64 * 1024;
  return {
    port: int(env, "PORT", 8787, 1),
    host: env.HOST?.trim() || "0.0.0.0",
    model: env.PARKING_LINGO_MODEL?.trim() || DEFAULT_MODEL,
    effort: effortRaw,
    refusalFallback: bool(env, "PARKING_LINGO_REFUSAL_FALLBACK", true),
    mockVision: bool(env, "MOCK_VISION", false),
    appToken: env.PARKING_LINGO_APP_TOKEN?.trim() || null,
    maxImageBytes,
    maxBodyBytes: int(env, "MAX_BODY_BYTES", derivedBody, 1024),
    readTimeoutMs: int(env, "READ_TIMEOUT_MS", 60_000, 1000),
    upstreamMaxRetries: int(env, "UPSTREAM_MAX_RETRIES", 1, 0),
    rateLimitReadSign: int(env, "RATE_LIMIT_READ_SIGN", 20, 0),
    rateLimitEvaluate: int(env, "RATE_LIMIT_EVALUATE", 120, 0),
    rateLimitWindowMs: int(env, "RATE_LIMIT_WINDOW_MS", 60_000, 1000),
    trustProxy: bool(env, "TRUST_PROXY", false),
    corsOrigins: (env.CORS_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    logRequests: bool(env, "LOG_REQUESTS", true),
  };
}

/** Config for tests: deterministic, quiet, mock off. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig({ LOG_REQUESTS: "0" }), ...overrides };
}

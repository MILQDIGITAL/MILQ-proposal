import Anthropic from "@anthropic-ai/sdk";
import { safeParseSignReading, signReadingStructuredOutputSchema, type SignReading } from "@parking-lingo/core";
import type { Effort } from "./config";
import { buildUserText, SYSTEM_PROMPT } from "./prompt";
import { SignReaderError, type ReadSignInput, type ReadSignResult, type SignReader } from "./signReader";

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

/** The single SDK call the reader needs; injectable so tests never touch the network. */
export type CreateMessageFn = (params: CreateParams, options?: Anthropic.RequestOptions) => Promise<BetaMessage>;

export interface ClaudeSignReaderOptions {
  model: string;
  effort: Effort;
  /** Opt into server-side refusal fallbacks (beta `server-side-fallback-2026-07-01`, `fallbacks: "default"`). */
  refusalFallback: boolean;
  /** Per-HTTP-call timeout for the SDK, ms. The overall deadline comes from input.signal. */
  timeoutMs: number;
  maxRetries: number;
  /** Total model calls allowed when the output fails validation (default 2 = one retry). */
  maxAttempts?: number;
  /** Inject for tests; defaults to a real Anthropic client (reads ANTHROPIC_API_KEY). */
  createMessage?: CreateMessageFn;
}

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class ClaudeSignReader implements SignReader {
  private readonly create: CreateMessageFn;
  private readonly maxAttempts: number;

  constructor(private readonly opts: ClaudeSignReaderOptions) {
    this.maxAttempts = opts.maxAttempts ?? 2;
    if (opts.createMessage) {
      this.create = opts.createMessage;
    } else {
      const client = new Anthropic({ timeout: opts.timeoutMs, maxRetries: opts.maxRetries });
      this.create = (params, options) => client.beta.messages.create(params, options);
    }
  }

  buildParams(input: ReadSignInput, previousIssues?: string[]): CreateParams {
    const params: CreateParams = {
      model: this.opts.model,
      // Thinking is on (adaptive) on current models and counts toward max_tokens; a reading is ~1-3k tokens.
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: this.opts.effort,
        format: { type: "json_schema", schema: signReadingStructuredOutputSchema },
      },
      // Static system prompt, cached across requests; per-request data lives in the user turn.
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.base64 } },
            {
              type: "text",
              text: buildUserText({
                now: input.now,
                timeZone: input.timeZone,
                jurisdictionHint: input.jurisdictionHint ?? null,
                ...(previousIssues ? { previousIssues } : {}),
              }),
            },
          ],
        },
      ],
    };
    if (this.opts.refusalFallback) {
      params.betas = [FALLBACK_BETA];
      params.fallbacks = "default";
    }
    return params;
  }

  async read(input: ReadSignInput): Promise<ReadSignResult> {
    let previousIssues: string[] | undefined;
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 };
    let model = this.opts.model;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const message = await this.call(this.buildParams(input, previousIssues), input.signal);
      model = message.model ?? model;
      usage.inputTokens += message.usage?.input_tokens ?? 0;
      usage.outputTokens += message.usage?.output_tokens ?? 0;
      usage.cacheReadInputTokens += message.usage?.cache_read_input_tokens ?? 0;

      if (message.stop_reason === "refusal") {
        throw new SignReaderError("refused", "The model declined to read this image.");
      }

      const outcome = extractReading(message);
      if (outcome.ok) {
        return { reading: outcome.reading, model, attempts: attempt, usage };
      }
      previousIssues = outcome.issues;
    }
    throw new SignReaderError(
      "invalid_output",
      `The sign reading failed validation after ${this.maxAttempts} attempts: ${(previousIssues ?? []).slice(0, 3).join("; ")}`,
    );
  }

  private async call(params: CreateParams, signal: AbortSignal | undefined): Promise<BetaMessage> {
    try {
      return await this.create(params, signal ? { signal } : undefined);
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }
}

type Extracted = { ok: true; reading: SignReading } | { ok: false; issues: string[] };

/** Pull the JSON text out of a structured-output response and validate it with core's zod schema. */
export function extractReading(message: Pick<BetaMessage, "content" | "stop_reason">): Extracted {
  if (message.stop_reason === "max_tokens") {
    return { ok: false, issues: ["The response was cut off (max_tokens); return the complete JSON object."] };
  }
  // Read blocks by type: thinking (and fallback) blocks can precede the text.
  const text = message.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) return { ok: false, issues: ["The response contained no JSON text."] };

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, issues: ["The response was not valid JSON."] };
  }
  const parsed = safeParseSignReading(data);
  if (parsed.success) return { ok: true, reading: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`),
  };
}

function retryAfter(headers: Headers | undefined, fallback: number): number {
  const raw = headers?.get?.("retry-after");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : fallback;
}

/** Map SDK errors (most specific first) to provider-neutral SignReaderErrors. */
export function mapAnthropicError(err: unknown): SignReaderError {
  if (err instanceof SignReaderError) return err;
  if (err instanceof Anthropic.APIUserAbortError) {
    return new SignReaderError("timeout", "The sign reading was cancelled (deadline exceeded or client disconnected).", undefined, err);
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new SignReaderError("timeout", "The vision model timed out.", 5, err);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new SignReaderError("unavailable", "Couldn't reach the vision model.", 5, err);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new SignReaderError("rate_limited", "The vision model is rate limited.", retryAfter(err.headers, 10), err);
  }
  if (err instanceof Anthropic.OverloadedError || err instanceof Anthropic.ServiceUnavailableError) {
    return new SignReaderError("overloaded", "The vision model is temporarily overloaded.", retryAfter(err.headers, 15), err);
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new SignReaderError("auth", "The server's Anthropic credentials were rejected.", undefined, err);
  }
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError || err instanceof Anthropic.UnprocessableEntityError) {
    return new SignReaderError("bad_request", `The vision model rejected the request: ${err.message}`, undefined, err);
  }
  if (err instanceof Anthropic.InternalServerError) {
    return new SignReaderError("upstream", "The vision model returned a server error.", retryAfter(err.headers, 5), err);
  }
  if (err instanceof Anthropic.APIError) {
    return new SignReaderError("upstream", `The vision model returned an error (${err.status ?? "unknown"}).`, undefined, err);
  }
  if (err instanceof Error && err.name === "AbortError") {
    return new SignReaderError("timeout", "The sign reading was cancelled.", undefined, err);
  }
  return new SignReaderError("upstream", "Unexpected error calling the vision model.", undefined, err);
}

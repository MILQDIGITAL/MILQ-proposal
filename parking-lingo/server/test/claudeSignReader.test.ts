import Anthropic from "@anthropic-ai/sdk";
import { signReadingStructuredOutputSchema } from "@parking-lingo/core";
import { describe, expect, it } from "vitest";
import { ClaudeSignReader, mapAnthropicError, type CreateMessageFn } from "../src/claudeSignReader";
import { SYSTEM_PROMPT } from "../src/prompt";
import { SignReaderError, type ReadSignInput } from "../src/signReader";
import { makeApp, post, readSignBody, TINY_JPEG_B64, twoPMeter } from "./helpers";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type Params = Parameters<CreateMessageFn>[0];

function message(text: string, overrides: Partial<BetaMessage> = {}): BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text, citations: null },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1500, output_tokens: 400, cache_read_input_tokens: 1200 },
    ...overrides,
  } as unknown as BetaMessage;
}

function fakeCreate(responses: Array<BetaMessage | Error>) {
  const calls: { params: Params; options: Anthropic.RequestOptions | undefined }[] = [];
  const create: CreateMessageFn = async (params, options) => {
    calls.push({ params, options });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    if (r instanceof Error) throw r;
    return r;
  };
  return { create, calls };
}

function reader(create: CreateMessageFn, refusalFallback = true) {
  return new ClaudeSignReader({
    model: "claude-opus-5-5",
    effort: "medium",
    refusalFallback,
    timeoutMs: 30_000,
    maxRetries: 0,
    createMessage: create,
  });
}

const input: ReadSignInput = {
  image: { base64: TINY_JPEG_B64, mediaType: "image/jpeg" },
  now: new Date("2026-11-13T09:15:00Z"), // Fri 13 Nov 2026 20:15 in Sydney (AEDT, +11)
  timeZone: "Australia/Sydney",
  jurisdictionHint: "AU-NSW",
};

const validJson = JSON.stringify(twoPMeter);

describe("ClaudeSignReader", () => {
  it("sends image + date context with structured output, and validates the reply", async () => {
    const { create, calls } = fakeCreate([message(validJson)]);
    const result = await reader(create).read(input);

    expect(result.reading).toEqual(twoPMeter);
    expect(result.attempts).toBe(1);
    expect(result.model).toBe("claude-opus-5-5");
    expect(result.usage).toEqual({ inputTokens: 1500, outputTokens: 400, cacheReadInputTokens: 1200 });

    const p = calls[0]!.params;
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.thinking).toEqual({ type: "adaptive" });
    expect(p.output_config).toEqual({ effort: "medium", format: { type: "json_schema", schema: signReadingStructuredOutputSchema } });
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(p.fallbacks).toBe("default");
    expect(p.tool_choice).toBeUndefined();
    expect(p.system).toEqual([{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);

    const content = p.messages[0]!.content as Anthropic.Beta.Messages.BetaContentBlockParam[];
    expect(content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: TINY_JPEG_B64 } });
    const text = (content[1] as { text: string }).text;
    expect(text).toContain("Friday 13 November 2026 (2026-11-13)");
    expect(text).toContain("local time 20:15");
    expect(text).toContain("Australia/Sydney (UTC+11:00)");
    expect(text).toContain('"AU-NSW"');
  });

  it("omits the fallback beta when disabled", async () => {
    const { create, calls } = fakeCreate([message(validJson)]);
    await reader(create, false).read(input);
    expect(calls[0]!.params.betas).toBeUndefined();
    expect(calls[0]!.params.fallbacks).toBeUndefined();
  });

  it("system prompt is static (cacheable) and covers the key rules", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    for (const needle of ["never instructions", "Never guess", "1/4P = 15", "temporary = true", "effectiveDates", "isParkingSign = false", "as seen by a person standing facing the sign", "School"]) {
      expect(SYSTEM_PROMPT.toLowerCase()).toContain(needle.toLowerCase());
    }
  });

  it("passes the abort signal to the SDK", async () => {
    const { create, calls } = fakeCreate([message(validJson)]);
    const controller = new AbortController();
    await reader(create).read({ ...input, signal: controller.signal });
    expect(calls[0]!.options?.signal).toBe(controller.signal);
  });

  it("retries once with the validation issues when the output is invalid, then succeeds", async () => {
    const bad = JSON.stringify({ ...twoPMeter, overallConfidence: 1.7 });
    const { create, calls } = fakeCreate([message(bad), message(validJson)]);
    const result = await reader(create).read(input);
    expect(result.attempts).toBe(2);
    expect(calls).toHaveLength(2);
    expect(result.usage?.inputTokens).toBe(3000);
    const retryText = ((calls[1]!.params.messages[0]!.content as Array<{ type: string; text?: string }>)[1]!).text!;
    expect(retryText).toContain("did not pass validation");
    expect(retryText).toContain("overallConfidence");
  });

  it("gives up after the retry with invalid_output", async () => {
    const { create, calls } = fakeCreate([message("{\"nope\": true}"), message("not json at all")]);
    await expect(reader(create).read(input)).rejects.toMatchObject({ name: "SignReaderError", kind: "invalid_output" });
    expect(calls).toHaveLength(2);
  });

  it("treats max_tokens truncation as invalid output", async () => {
    const { create, calls } = fakeCreate([message("{\"isParkingSign\": tr", { stop_reason: "max_tokens" }), message(validJson)]);
    const result = await reader(create).read(input);
    expect(result.attempts).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("maps a refusal without retrying", async () => {
    const { create, calls } = fakeCreate([message("", { stop_reason: "refusal", content: [] })]);
    await expect(reader(create).read(input)).rejects.toMatchObject({ kind: "refused" });
    expect(calls).toHaveLength(1);
  });

  it("maps SDK errors", async () => {
    const err = (status: number, headers: Record<string, string> = {}) =>
      Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message: "m" } }, "m", new Headers(headers));
    expect(mapAnthropicError(err(429, { "retry-after": "12" }))).toMatchObject({ kind: "rate_limited", retryAfterSeconds: 12 });
    expect(mapAnthropicError(err(529))).toMatchObject({ kind: "overloaded", retryAfterSeconds: 15 });
    expect(mapAnthropicError(err(503))).toMatchObject({ kind: "overloaded" });
    expect(mapAnthropicError(err(500))).toMatchObject({ kind: "upstream" });
    expect(mapAnthropicError(err(401))).toMatchObject({ kind: "auth" });
    expect(mapAnthropicError(err(400))).toMatchObject({ kind: "bad_request" });
    expect(mapAnthropicError(new Anthropic.APIConnectionTimeoutError())).toMatchObject({ kind: "timeout" });
    expect(mapAnthropicError(new Anthropic.APIConnectionError({ message: "down" }))).toMatchObject({ kind: "unavailable" });
    expect(mapAnthropicError(new Anthropic.APIUserAbortError())).toMatchObject({ kind: "timeout" });
    expect(mapAnthropicError(new Error("weird"))).toBeInstanceOf(SignReaderError);
  });
});

describe("ClaudeSignReader wired into the app (fake SDK)", () => {
  const appWith = (responses: Array<BetaMessage | Error>) => {
    const { create, calls } = fakeCreate(responses);
    return { app: makeApp(reader(create)), calls };
  };

  it("happy path end to end", async () => {
    const { app } = appWith([message(validJson)]);
    const res = await post(app, "/v1/read-sign", readSignBody({ context: { now: "2026-11-12T10:30:00+11:00" } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.meta).toEqual({ model: "claude-opus-5-5", attempts: 1 });
    expect(body.verdict.currentLimitMinutes).toBe(120);
  });

  it("invalid output twice -> 502 invalid_model_output", async () => {
    const { app, calls } = appWith([message("{}"), message("{}")]);
    const res = await post(app, "/v1/read-sign", readSignBody());
    expect(res.status).toBe(502);
    expect((await res.json() as any).error.code).toBe("invalid_model_output");
    expect(calls).toHaveLength(2);
  });

  it("upstream 429 -> 503 with Retry-After", async () => {
    const rl = Anthropic.APIError.generate(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, "slow down", new Headers({ "retry-after": "20" }));
    const { app } = appWith([rl]);
    const res = await post(app, "/v1/read-sign", readSignBody());
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("20");
    expect((await res.json() as any).error).toMatchObject({ code: "upstream_rate_limited", retryAfterSeconds: 20 });
  });

  it("upstream 529 -> 503 upstream_overloaded", async () => {
    const ov = Anthropic.APIError.generate(529, { type: "error", error: { type: "overloaded_error", message: "busy" } }, "busy", new Headers());
    const { app } = appWith([ov]);
    const res = await post(app, "/v1/read-sign", readSignBody());
    expect(res.status).toBe(503);
    expect((await res.json() as any).error.code).toBe("upstream_overloaded");
  });
});

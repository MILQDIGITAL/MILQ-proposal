import { getFixture } from "@parking-lingo/core/fixtures";
import { describe, expect, it, vi } from "vitest";
import { readSign, type ReadSignRequest } from "./client";
import { AppError, errorCopy, errorFromReading, errorFromResponse, errorFromThrown } from "./errors";

const req: ReadSignRequest = { image: { base64: "AAAA", mediaType: "image/jpeg" }, context: { timeZone: "Australia/Sydney" } };
const reading = getFixture("nsw-2p-meter-weekdays-sat").reading;

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

async function caught(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error("expected rejection");
}

describe("readSign", () => {
  it("posts to /v1/read-sign with token + mock headers and parses the body", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse(200, { reading, verdict: { status: "yes" }, requestId: "r1", meta: { model: "mock", attempts: 1 } }),
    );
    const res = await readSign(req, { baseUrl: "http://x", appToken: "tok", mockFixture: "fx", fetchImpl: fetchImpl as typeof fetch });
    expect(res.requestId).toBe("r1");
    expect(res.reading.panels).toHaveLength(1);
    expect(res.meta?.model).toBe("mock");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://x/v1/read-sign");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-app-token"]).toBe("tok");
    expect(headers["x-mock-fixture"]).toBe("fx");
    expect(JSON.parse(String(init?.body))).toEqual(req);
  });

  it("not configured", async () => {
    expect((await caught(readSign(req, { baseUrl: null }))).code).toBe("not_configured");
  });

  it("maps server error bodies", async () => {
    const fetchImpl = async () => jsonResponse(429, { error: { code: "rate_limited", message: "slow down", retryAfterSeconds: 12 }, requestId: "q" });
    const e = await caught(readSign(req, { baseUrl: "http://x", fetchImpl }));
    expect(e.code).toBe("rate_limited");
    expect(e.retryAfterSeconds).toBe(12);
    expect(e.requestId).toBe("q");
    expect(errorCopy(e).message).toContain("12 seconds");
  });

  it("network failure → offline", async () => {
    const fetchImpl = async () => {
      throw new TypeError("Network request failed");
    };
    expect((await caught(readSign(req, { baseUrl: "http://x", fetchImpl }))).code).toBe("offline");
  });

  it("times out", async () => {
    const fetchImpl = (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    const e = await caught(readSign(req, { baseUrl: "http://x", timeoutMs: 20, fetchImpl: fetchImpl as typeof fetch }));
    expect(e.code).toBe("timeout");
  });

  it("is cancellable by the caller", async () => {
    const ac = new AbortController();
    const fetchImpl = (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    const p = readSign(req, { baseUrl: "http://x", signal: ac.signal, fetchImpl: fetchImpl as typeof fetch });
    ac.abort();
    expect((await caught(p)).code).toBe("cancelled");
  });

  it("rejects malformed readings", async () => {
    const fetchImpl = async () => jsonResponse(200, { reading: { nope: true }, requestId: "z" });
    const e = await caught(readSign(req, { baseUrl: "http://x", fetchImpl }));
    expect(e.code).toBe("invalid_response");
    expect(e.requestId).toBe("z");
  });

  it("non-JSON 502 falls back to status mapping", async () => {
    const fetchImpl = async () => new Response("<html>bad gateway</html>", { status: 502 });
    expect((await caught(readSign(req, { baseUrl: "http://x", fetchImpl }))).code).toBe("unavailable");
  });
});

describe("errorFromResponse", () => {
  it.each([
    [400, "validation_failed", "server"],
    [401, "unauthorized", "unauthorized"],
    [413, "image_too_large", "bad_image"],
    [415, "unsupported_media_type", "bad_image"],
    [422, "model_refused", "unreadable"],
    [500, "internal_error", "server"],
    [502, "invalid_model_output", "unreadable"],
    [502, "upstream_unavailable", "unavailable"],
    [503, "upstream_overloaded", "unavailable"],
    [503, "upstream_rate_limited", "rate_limited"],
    [504, "upstream_timeout", "timeout"],
    [418, "some_new_code", "server"],
  ])("%d %s → %s", (status, code, expected) => {
    expect(errorFromResponse(status, { error: { code, message: "m" } }).code).toBe(expected);
  });

  it("uses Retry-After header when the body has none", () => {
    expect(errorFromResponse(429, null, "30").retryAfterSeconds).toBe(30);
  });
});

describe("errorFromThrown / errorFromReading", () => {
  it("abort reasons", () => {
    expect(errorFromThrown(new Error("x"), "timeout").code).toBe("timeout");
    expect(errorFromThrown(new Error("x"), "cancelled").code).toBe("cancelled");
    expect(errorFromThrown(Object.assign(new Error("x"), { name: "AbortError" }), null).code).toBe("cancelled");
    expect(errorFromThrown(new Error("boom"), null).code).toBe("server");
  });

  it("flags non-parking-sign and too-blurry readings", () => {
    expect(errorFromReading(getFixture("not-a-parking-sign").reading)?.code).toBe("not_parking_sign");
    const blurry = errorFromReading(getFixture("blurry-low-confidence").reading);
    expect(blurry?.code).toBe("unreadable");
    expect(errorCopy(blurry!).title).toBe("Move closer and rescan");
    expect(errorFromReading(reading)).toBeNull();
  });
});

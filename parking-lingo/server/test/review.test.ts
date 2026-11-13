import { describe, expect, it } from "vitest";
import { clientIpFromHeaders } from "../src/app";
import { assertStartupConfig, loadConfig, testConfig } from "../src/config";
import { MockSignReader } from "../src/mockSignReader";
import { buildUserText, SYSTEM_PROMPT } from "../src/prompt";
import { RateLimiter } from "../src/rateLimit";
import { makeApp, post, readerReturning, readSignBody, twoPMeter } from "./helpers";

const hdr = (h: Record<string, string>) => (n: string) => h[n.toLowerCase()];

describe("S1: trusted proxy headers", () => {
  it("xff uses the right-most trusted hop, not the client-supplied left entry", () => {
    const h = hdr({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    expect(clientIpFromHeaders(h, "xff", 1)).toBe("203.0.113.9");
    expect(clientIpFromHeaders(h, "xff", 2)).toBe("6.6.6.6");
    expect(clientIpFromHeaders(hdr({ "x-forwarded-for": "203.0.113.9" }), "xff", 3)).toBe("203.0.113.9");
  });

  it("fly mode trusts only Fly-Client-IP; xff mode ignores Fly-Client-IP", () => {
    const h = hdr({ "fly-client-ip": "198.51.100.4", "x-forwarded-for": "1.1.1.1" });
    expect(clientIpFromHeaders(h, "fly", 1)).toBe("198.51.100.4");
    expect(clientIpFromHeaders(h, "xff", 1)).toBe("1.1.1.1");
    expect(clientIpFromHeaders(h, false, 1)).toBeNull();
  });

  it("TRUST_PROXY values", () => {
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: "fly" }).trustProxy).toBe("fly");
    expect(loadConfig({ TRUST_PROXY: "xff", TRUSTED_PROXY_HOPS: "2" })).toMatchObject({ trustProxy: "xff", trustedProxyHops: 2 });
    expect(loadConfig({ TRUST_PROXY: "1" }).trustProxy).toBe("xff"); // legacy
    expect(() => loadConfig({ TRUST_PROXY: "cloudflare" })).toThrow();
  });

  it("rotating a spoofed left-most XFF entry doesn't bypass the limit", async () => {
    const app = makeApp(readerReturning(twoPMeter), { rateLimitReadSign: 1 });
    const send = (spoof: string) => post(app, "/v1/read-sign", readSignBody(), { "x-forwarded-for": `${spoof}, 203.0.113.50` });
    expect((await send("1.1.1.1")).status).toBe(200);
    expect((await send("2.2.2.2")).status).toBe(429);
  });
});

describe("S2: rate limiter memory is bounded", () => {
  it("never tracks more than maxKeys keys", () => {
    const rl = new RateLimiter(5, 60_000, () => 1000, 100);
    for (let i = 0; i < 1000; i++) rl.hit(`k${i}`);
    expect(rl.size).toBeLessThanOrEqual(100);
    // the most recent key is still tracked and limited
    for (let i = 0; i < 5; i++) rl.hit("hot");
    expect(rl.hit("hot").allowed).toBe(false);
  });
});

describe("S3: auth required in live mode", () => {
  it("refuses live mode without a token", () => {
    expect(() => assertStartupConfig(testConfig({ mockVision: false, appToken: null, allowNoAuth: false }))).toThrow(/PARKING_LINGO_APP_TOKEN/);
  });
  it("allows it with ALLOW_NO_AUTH=1 (with a warning), with a token, or in mock mode", () => {
    expect(assertStartupConfig(loadConfig({ ALLOW_NO_AUTH: "1" }))).toHaveLength(1);
    expect(assertStartupConfig(loadConfig({ PARKING_LINGO_APP_TOKEN: "t" }))).toEqual([]);
    expect(assertStartupConfig(loadConfig({ MOCK_VISION: "1" }))).toEqual([]);
  });
});

describe("S4: prompt guidance", () => {
  it("covers year resolution, 'only' vs 'excepted', other-times panels, arrows and confidence", () => {
    expect(SYSTEM_PROMPT).toMatch(/start <= end/);
    expect(SYSTEM_PROMPT).toMatch(/crosses New Year/);
    expect(SYSTEM_PROMPT).toMatch(/prefer\w* a range that includes today/);
    expect(SYSTEM_PROMPT).toMatch(/allowedVehicles/);
    expect(SYSTEM_PROMPT).toMatch(/excepted.*must NOT go here/);
    expect(SYSTEM_PROMPT).toMatch(/AT OTHER TIMES/);
    expect(SYSTEM_PROMPT).toMatch(/no arrow of its own mounted directly beneath an arrowed panel/);
    expect(SYSTEM_PROMPT).toMatch(/never higher than the weakest RESTRICTIVE panel/);
    expect(buildUserText({ now: new Date("2026-12-30T00:00:00Z"), timeZone: "Australia/Sydney" })).toContain("2026-12-30");
  });
});

describe("mock demo context (x-mock-demo-time)", () => {
  const mockApp = () => makeApp(new MockSignReader(), { mockVision: true });

  it("uses the fixture's time even when the app sends now", async () => {
    const res = await post(
      mockApp(),
      "/v1/read-sign",
      readSignBody({ context: { now: "2026-11-12T07:00:00+11:00" } }),
      { "x-mock-fixture": "nsw-clearway-sandwich", "x-mock-demo-time": "1" },
    );
    const body = (await res.json()) as any;
    expect(body.verdict.evaluatedAt).toBe("2026-11-12T02:30:00.000Z");
    expect(body.verdict.status).toBe("yes_with_conditions");
  });

  it("applies the fixture's other demo settings (permits, zone)", async () => {
    const res = await post(mockApp(), "/v1/read-sign", readSignBody({ context: { now: "2026-11-12T07:00:00+11:00", permits: [] } }), {
      "x-mock-fixture": "vic-permit-zone-area-12",
      "x-mock-demo-time": "1",
    });
    const body = (await res.json()) as any;
    expect(body.verdict.timeZone).toBe("Australia/Melbourne");
    expect(body.verdict.permitRequired).toBe(true);
  });

  it("without the header an explicit now still wins", async () => {
    const res = await post(mockApp(), "/v1/read-sign", readSignBody({ context: { now: "2026-11-12T07:00:00+11:00" } }), {
      "x-mock-fixture": "nsw-clearway-sandwich",
    });
    expect(((await res.json()) as any).verdict.status).toBe("no");
  });

  it("is ignored outside mock mode", async () => {
    const app = makeApp(readerReturning(twoPMeter));
    const res = await post(app, "/v1/read-sign", readSignBody({ context: { now: "2026-11-12T07:00:00+11:00" } }), { "x-mock-demo-time": "1" });
    expect(((await res.json()) as any).verdict.evaluatedAt).toBe("2026-11-11T20:00:00.000Z");
  });
});

describe("context.jurisdiction passthrough", () => {
  it("/v1/evaluate uses it for the holiday calendar", async () => {
    const app = makeApp(readerReturning(twoPMeter));
    const res = await post(app, "/v1/evaluate", {
      reading: twoPMeter,
      context: { now: "2026-11-03T10:00:00+11:00", timeZone: "Australia/Sydney", jurisdiction: "AU-VIC" },
    });
    expect(res.status).toBe(200);
    const v = ((await res.json()) as any).verdict;
    expect(v.jurisdiction).toBe("AU-VIC");
    expect(v.publicHolidayName).toBe("Melbourne Cup Day");
  });

  it("/v1/read-sign passes it to the evaluator and (as a hint) to the reader", async () => {
    const reader = readerReturning({ ...twoPMeter, jurisdictionHint: null });
    const app = makeApp(reader);
    const res = await post(app, "/v1/read-sign", readSignBody({ context: { now: "2026-01-26T10:00:00+11:00", jurisdiction: "NSW" } }));
    const v = ((await res.json()) as any).verdict;
    expect(v.jurisdiction).toBe("AU-NSW");
    expect(v.publicHolidayName).toBe("Australia Day");
    expect(reader.calls[0]!.jurisdictionHint).toBe("NSW");
  });

  it("rejects an over-long jurisdiction", async () => {
    const app = makeApp(readerReturning(twoPMeter));
    const res = await post(app, "/v1/evaluate", { reading: twoPMeter, context: { timeZone: "Australia/Sydney", jurisdiction: "x".repeat(40) } });
    expect(res.status).toBe(400);
  });
});

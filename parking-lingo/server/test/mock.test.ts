import { fixtures } from "@parking-lingo/core/fixtures";
import { describe, expect, it } from "vitest";
import { MockSignReader } from "../src/mockSignReader";
import { makeApp, post, readSignBody } from "./helpers";

describe("MOCK_VISION mode", () => {
  const mockApp = () => makeApp(new MockSignReader(), { mockVision: true });

  it("reports mock mode on /healthz", async () => {
    const res = await mockApp().request("/healthz");
    expect(await res.json() as any).toMatchObject({ ok: true, mode: "mock", model: "mock" });
  });

  it("cycles through fixtures", async () => {
    const app = mockApp();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const body = (await (await post(app, "/v1/read-sign", readSignBody())).json()) as any;
      ids.push(body.meta.mock.fixtureId);
    }
    expect(ids).toEqual(fixtures.slice(0, 3).map((f) => f.id));
  });

  it("selects a fixture with x-mock-fixture and uses its demo time when no now is sent", async () => {
    const res = await post(mockApp(), "/v1/read-sign", readSignBody(), { "x-mock-fixture": "nsw-clearway-sandwich" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.meta).toEqual({ model: "mock", attempts: 1, mock: { fixtureId: "nsw-clearway-sandwich", title: expect.any(String) } });
    expect(body.reading.panels).toHaveLength(3);
    // demoContext.now = 2026-11-12T13:30+11:00 (2P ticket window between clearways)
    expect(body.verdict.evaluatedAt).toBe("2026-11-12T02:30:00.000Z");
    expect(body.verdict.status).toBe("yes_with_conditions");
  });

  it("honours an explicit now over the fixture demo time", async () => {
    const res = await post(mockApp(), "/v1/read-sign", readSignBody({ context: { now: "2026-11-12T07:00:00+11:00" } }), {
      "x-mock-fixture": "nsw-clearway-sandwich",
    });
    const body = (await res.json()) as any;
    expect(body.verdict.status).toBe("no"); // morning clearway
  });

  it("rejects an unknown fixture id", async () => {
    const res = await post(mockApp(), "/v1/read-sign", readSignBody(), { "x-mock-fixture": "nope" });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.message).toContain("Unknown mock fixture");
  });

  it("lists fixtures", async () => {
    const res = await mockApp().request("/v1/mock-fixtures");
    const body = (await res.json()) as any;
    expect(body.fixtures).toHaveLength(fixtures.length);
  });

  it("hides /v1/mock-fixtures when not in mock mode", async () => {
    const res = await makeApp(new MockSignReader(), { mockVision: false }).request("/v1/mock-fixtures");
    expect(res.status).toBe(404);
  });

  it("still validates the image in mock mode", async () => {
    const res = await post(mockApp(), "/v1/read-sign", readSignBody({ image: { mediaType: "image/heic" } }));
    expect(res.status).toBe(415);
  });
});

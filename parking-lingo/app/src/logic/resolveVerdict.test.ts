import { evaluate, type Side } from "@parking-lingo/core";
import { getFixture } from "@parking-lingo/core/fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkIntlTimeZoneSupport } from "./intlCheck";
import { resolveVerdict, SERVER_VERDICT_MAX_AGE_MS } from "./resolveVerdict";

const f = getFixture("split-sides-no-stopping-1p");
const now = Date.parse(f.demoContext.now as string);
const local = (side: Side | "unknown") => evaluate(f.reading, { now, timeZone: f.demoContext.timeZone, side });
const server = local("unknown");

describe("resolveVerdict", () => {
  it("evaluates locally when Intl is OK", () => {
    const r = resolveVerdict({ intlOk: true, side: "right", evaluateLocal: local, serverVerdict: null, nowMs: now });
    expect(r.kind).toBe("local");
    if (r.kind === "local") expect(r.shown.side).toBe("right");
  });

  it("uses a fresh server verdict (with its per-side answer) when Intl failed", () => {
    const r = resolveVerdict({ intlOk: false, side: "right", evaluateLocal: local, serverVerdict: server, nowMs: now + 30_000 });
    expect(r.kind).toBe("server");
    if (r.kind === "server") {
      expect(r.shown.side).toBe("right");
      expect(r.shown.status).toBe("yes_with_conditions");
      expect(r.notice).toMatch(/server/);
    }
  });

  it("errors instead of showing a stale server verdict", () => {
    const r = resolveVerdict({ intlOk: false, side: "unknown", evaluateLocal: local, serverVerdict: server, nowMs: now + SERVER_VERDICT_MAX_AGE_MS + 60_000 });
    expect(r.kind).toBe("error");
  });

  it("errors in demo/history mode (no server verdict) when Intl failed", () => {
    expect(resolveVerdict({ intlOk: false, side: "unknown", evaluateLocal: local, serverVerdict: null, nowMs: now }).kind).toBe("error");
  });

  it("falls back only to a fresh server verdict when local evaluation throws", () => {
    const boom = () => {
      throw new RangeError("Invalid time zone");
    };
    expect(resolveVerdict({ intlOk: true, side: "unknown", evaluateLocal: boom, serverVerdict: server, nowMs: now + 10_000 }).kind).toBe("server");
    const stale = resolveVerdict({ intlOk: true, side: "unknown", evaluateLocal: boom, serverVerdict: server, nowMs: now + 10 * 60_000 });
    expect(stale.kind).toBe("error");
    if (stale.kind === "error") expect(stale.message).toContain("Invalid time zone");
  });
});

describe("checkIntlTimeZoneSupport", () => {
  const Real = Intl.DateTimeFormat;
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes on Node (full ICU)", () => {
    expect(checkIntlTimeZoneSupport()).toEqual({ ok: true, detail: "Intl time zones OK" });
  });

  it("fails for an engine that ignores hourCycle h23 (12-hour clock)", () => {
    class TwelveHour extends Real {
      constructor(locale?: string | string[], opts?: Intl.DateTimeFormatOptions) {
        const { hourCycle: _ignored, ...rest } = opts ?? {};
        super(locale, { ...rest, hour12: true });
      }
    }
    vi.stubGlobal("Intl", { ...Intl, DateTimeFormat: TwelveHour });
    const r = checkIntlTimeZoneSupport();
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/afternoon|midnight/);
  });

  it("fails for an engine without DST data (fixed offset)", () => {
    class FixedOffset extends Real {
      constructor(locale?: string | string[], opts?: Intl.DateTimeFormatOptions) {
        super(locale, { ...opts, timeZone: opts?.timeZone === "Australia/Sydney" ? "Etc/GMT-10" : opts?.timeZone });
      }
    }
    vi.stubGlobal("Intl", { ...Intl, DateTimeFormat: FixedOffset });
    expect(checkIntlTimeZoneSupport().ok).toBe(false);
  });
});

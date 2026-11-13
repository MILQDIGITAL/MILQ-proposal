import { getFixture } from "@parking-lingo/core/fixtures";
import { describe, expect, it } from "vitest";
import { checkIntlTimeZoneSupport } from "../logic/intlCheck";
import { fitLongEdge, base64Bytes } from "../logic/image";
import { planReminder } from "../logic/reminder";
import { addToHistory, parseStoredHistory, type HistoryEntry } from "./history";
import { buildContext, buildServerContext, DEFAULT_SETTINGS, parsePermitInput, parseStoredSettings } from "./settings";
import { demoResult } from "./sessions";

describe("settings parsing", () => {
  it("defaults on missing/garbage", () => {
    expect(parseStoredSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings("{oops")).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings("42")).toEqual(DEFAULT_SETTINGS);
  });
  it("keeps valid fields, drops invalid ones", () => {
    const s = parseStoredSettings(
      JSON.stringify({ permits: ["12", "Area 012", 5, " 7 "], vehicleType: "spaceship", isElectricVehicle: true, reminderLeadMinutes: 15, demoMode: "yes" }),
    );
    expect(s.permits).toEqual(["12", "7"]);
    expect(s.vehicleType).toBe("car");
    expect(s.isElectricVehicle).toBe(true);
    expect(s.reminderLeadMinutes).toBe(15);
    expect(s.demoMode).toBe(false);
  });
  it("parses permit input", () => {
    expect(parsePermitInput("12, Area 5; 12\nzone 05")).toEqual(["12", "Area 5"]);
  });
});

describe("settings → context", () => {
  const settings = { ...DEFAULT_SETTINGS, permits: ["12"], hasDisabilityPermit: true, vehicleType: "commercial" as const, isElectricVehicle: true };

  it("engine context", () => {
    const ctx = buildContext(settings, { now: 1000, timeZone: "Australia/Melbourne", side: "left", isPublicHoliday: false });
    expect(ctx).toEqual({
      now: 1000,
      timeZone: "Australia/Melbourne",
      side: "left",
      permits: ["12"],
      hasDisabilityPermit: true,
      vehicleType: "commercial",
      isElectricVehicle: true,
      isPublicHoliday: false,
    });
  });

  it("defaults side/holiday to unknown and merges per-scan overrides", () => {
    const ctx = buildContext(DEFAULT_SETTINGS, { now: 0, timeZone: "Australia/Sydney", overrides: { permits: ["Area 3"], isElectricVehicle: true } });
    expect(ctx.side).toBe("unknown");
    expect(ctx.isPublicHoliday).toBe("unknown");
    expect(ctx.permits).toEqual(["Area 3"]);
    expect(ctx.isElectricVehicle).toBe(true);
  });

  it("server context is JSON-safe with ISO now", () => {
    const c = buildServerContext(settings, { now: Date.UTC(2026, 10, 12, 0, 0), timeZone: "Australia/Sydney" });
    expect(c.now).toBe("2026-11-12T00:00:00.000Z");
    expect(c.timeZone).toBe("Australia/Sydney");
    expect(c.permits).toEqual(["12"]);
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });
});

describe("demo sessions", () => {
  it("runs the fixture on a demo clock", () => {
    const f = getFixture("vic-permit-zone-area-12");
    const real = Date.UTC(2030, 0, 1);
    const r = demoResult(f, true, real, "Australia/Perth");
    expect(real + r.clockOffsetMs).toBe(Date.parse("2026-11-12T09:00:00+11:00"));
    expect(r.timeZone).toBe("Australia/Melbourne");
    expect(r.overrides).toEqual({ permits: ["12"] });
    const live = demoResult(f, false, real, "Australia/Perth");
    expect(live.clockOffsetMs).toBe(0);
    expect(live.timeZone).toBe("Australia/Perth");
  });
});

describe("reminder planning", () => {
  const now = Date.parse("2026-11-12T00:00:00Z");
  it("fires lead minutes before leaveBy", () => {
    const p = planReminder("2026-11-12T02:00:00Z", now, 10, "Australia/Sydney")!;
    expect(p.fireAtMs).toBe(Date.parse("2026-11-12T01:50:00Z"));
    expect(p.leadMinutes).toBe(10);
    expect(p.body).toContain("1:00 pm");
  });
  it("shortens the lead when time is short, null when too soon", () => {
    expect(planReminder("2026-11-12T00:05:00Z", now, 10, "Australia/Sydney")!.leadMinutes).toBe(4);
    expect(planReminder("2026-11-12T00:01:00Z", now, 10, "Australia/Sydney")).toBeNull();
    expect(planReminder("garbage", now, 10, "Australia/Sydney")).toBeNull();
  });
});

describe("image sizing", () => {
  it("constrains the long edge", () => {
    expect(fitLongEdge(4032, 3024, 1600)).toEqual({ width: 1600 });
    expect(fitLongEdge(3024, 4032, 1600)).toEqual({ height: 1600 });
    expect(fitLongEdge(1200, 900, 1600)).toBeNull();
    expect(base64Bytes("AAAA")).toBe(3);
    expect(base64Bytes("AA==")).toBe(1);
  });
});

describe("history", () => {
  const entry = (id: string): HistoryEntry => ({
    id,
    scannedAt: "2026-11-12T00:00:00.000Z",
    timeZone: "Australia/Sydney",
    reading: getFixture("nsw-2p-meter-weekdays-sat").reading,
    thumbnail: null,
    statusAtScan: "yes_with_conditions",
    headlineAtScan: "Yes — 2 hrs",
    fixtureId: null,
    requestId: null,
  });
  it("adds newest first, dedupes and caps", () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < 25; i++) list = addToHistory(list, entry(String(i)));
    list = addToHistory(list, entry("3"));
    expect(list).toHaveLength(20);
    expect(list[0]!.id).toBe("3");
    expect(list.filter((e) => e.id === "3")).toHaveLength(1);
  });
  it("round-trips and drops malformed entries", () => {
    const raw = JSON.stringify([entry("a"), { id: "b", reading: { bad: 1 } }, null]);
    const parsed = parseStoredHistory(raw);
    expect(parsed.map((e) => e.id)).toEqual(["a"]);
    expect(parseStoredHistory("not json")).toEqual([]);
  });
});

describe("Intl self-check", () => {
  it("passes on Node (full ICU)", () => {
    expect(checkIntlTimeZoneSupport()).toEqual({ ok: true, detail: "Intl time zones OK" });
  });
});

/** Regression tests for the independent review (C1–C6, H1–H2, M1–M2). */
import { describe, expect, it } from "vitest";
import { evaluate, normalisePermit, permitTokens, panelLabel, SignReadingSchema, signReadingStructuredOutputSchema } from "../src/index";
import { ctx, ev, panel, reading, schedule, twoPMeter, utc, WEEKDAYS, ALL_DAYS } from "./helpers";

const N = "2026-11-13T10:00:00+11:00"; // Fri
const words = (v: { warnings: string[] }) => v.warnings.join(" ");

describe("C1: restrictions apply on public holidays unless the sign says otherwise", () => {
  it("1P Mon–Fri on a known holiday still applies, with a soft note", () => {
    const p = panel({ kind: "timed_parking", timeLimitMinutes: 60, schedules: [schedule(WEEKDAYS, "08:00", "18:00")] });
    const v = ev([p], "2026-12-25T10:00:00+11:00", { isPublicHoliday: true });
    expect(v.maxStayMinutes).toBe(60);
    expect(words(v)).toMatch(/public holiday today — sign times still apply unless the sign says otherwise \(some councils differ\)/);
  });

  it("Christmas Day via the calendar: No Parking Mon–Fri still applies", () => {
    const p = panel({ kind: "no_parking", schedules: [schedule(WEEKDAYS, "08:00", "18:00")] });
    const v = evaluate(reading([p]), { now: "2026-12-25T10:00:00+11:00", timeZone: "Australia/Sydney" });
    expect(v.status).toBe("no");
    expect(v.publicHolidayName).toBe("Christmas Day");
  });

  it("'except public holidays' is lifted on a known holiday", () => {
    const p = twoPMeter([schedule(WEEKDAYS, "08:00", "18:00", "excluded")]);
    expect(ev([p], N, { isPublicHoliday: true }).paymentRequired).toBe(false);
  });

  it("'Sun & public holidays' clearway applies on a listed holiday tomorrow", () => {
    const cw = panel({ kind: "clearway", schedules: [schedule(["sun"], "06:00", "10:00", "included")] });
    const v = ev([cw], "2026-12-27T20:00:00+11:00", { publicHolidayDates: ["2026-12-28"] });
    expect(v.leaveBy).toBe(utc("2026-12-28T06:00:00+11:00"));
  });

  it("'Sun & public holidays' on a calendar holiday tomorrow (Boxing Day substitute, Mon 28 Dec 2026)", () => {
    const cw = panel({ kind: "clearway", schedules: [schedule(["sun"], "06:00", "10:00", "included")] });
    const v = evaluate(reading([cw]), { now: "2026-12-27T20:00:00+11:00", timeZone: "Australia/Sydney" });
    expect(v.leaveBy).toBe(utc("2026-12-28T06:00:00+11:00"));
  });

  it("unknown holiday status (no jurisdiction): restrictive for included AND excluded, on look-ahead days too", () => {
    const noCal = { timeZone: "UTC" };
    // Included: a Sun&PH clearway is assumed to apply on Monday (tomorrow) too.
    const cw = panel({ kind: "clearway", schedules: [schedule(["sun"], "06:00", "10:00", "included")] });
    const v = evaluate(reading([cw]), { ...noCal, now: "2026-11-15T20:00:00Z" });
    expect(v.leaveBy).toBe("2026-11-16T06:00:00.000Z");
    expect(words(v)).toMatch(/Not sure if Mon 16 Nov is a public holiday/);
    // Excluded: the limit is assumed to apply.
    const p = twoPMeter([schedule(WEEKDAYS, "08:00", "18:00", "excluded")]);
    expect(evaluate(reading([p]), { ...noCal, now: "2026-11-13T10:00:00Z" }).maxStayMinutes).toBe(120);
  });
});

describe("C2: doubtful temporary dates", () => {
  const twoP = panel({ kind: "timed_parking", timeLimitMinutes: 120 });

  it("year mis-resolved across New Year (28 Dec – 3 Jan read as 2026-12-28 → 2026-01-03)", () => {
    const t = panel({ kind: "no_stopping", temporary: true, effectiveDates: { start: "2026-12-28", end: "2026-01-03" } });
    const v = ev([twoP, t], "2026-12-30T10:00:00+11:00");
    expect(v.status).toBe("unsure");
    expect(v.shortLabel).toBe("Check temporary sign");
    expect(v.summary).toBe("A temporary sign's dates are unclear — read it before parking.");
  });

  it("range one year off (2025-12-28 → 2026-01-03, now 30 Dec 2026) -> unsure", () => {
    const t = panel({ kind: "no_stopping", temporary: true, effectiveDates: { start: "2025-12-28", end: "2026-01-03" } });
    const v = ev([twoP, t], "2026-12-30T10:00:00+11:00");
    expect(v.status).toBe("unsure");
    expect(words(v)).toMatch(/year on the sign may have been misread/);
  });

  it("end before start (both future) is never ignored -> unsure", () => {
    const t = panel({ kind: "no_stopping", temporary: true, effectiveDates: { start: "2026-11-20", end: "2026-11-14" } });
    expect(ev([t], N).status).toBe("unsure");
  });

  it("invalid calendar date -> unsure", () => {
    const t = panel({ kind: "no_stopping", temporary: true, effectiveDates: { start: "2026-11-30", end: "2026-11-31" } });
    expect(ev([t], "2026-12-01T10:00:00+11:00").status).toBe("unsure");
  });

  it("a plainly expired sign (ended yesterday) isn't year-ambiguous and isn't a plain yes", () => {
    const t = panel({ kind: "no_stopping", temporary: true, effectiveDates: { start: "2026-11-10", end: "2026-11-12" } });
    const v = ev([t], N);
    expect(v.status).toBe("yes_with_conditions");
    expect(v.summary).toMatch(/out of date/);
  });
});

describe("C3: date-only end keeps the last overnight window", () => {
  const nightWorks = panel({
    kind: "no_stopping",
    temporary: true,
    towAway: true,
    schedules: [schedule(ALL_DAYS, "22:00", "06:00")],
    effectiveDates: { start: "2026-11-10", end: "2026-11-14" },
  });

  it("02:00 on the morning after the end date is still in force", () => {
    const v = ev([panel({ kind: "timed_parking" }), nightWorks], "2026-11-15T02:00:00+11:00");
    expect(v.status).toBe("no");
    expect(v.nextAllowedAt).toBe(utc("2026-11-15T06:00:00+11:00"));
  });

  it("the night after that is clear", () => {
    const v = ev([panel({ kind: "timed_parking" }), nightWorks], "2026-11-15T21:00:00+11:00");
    expect(v.status).toBe("yes_with_conditions"); // expired temporary sign: never a plain yes
    expect(v.timeline.every((t) => t.status === "allowed")).toBe(true);
  });
});

describe("C4: vehicle restrictions", () => {
  it("'Authorised vehicles only' text -> no for a car", () => {
    const v = ev([panel({ kind: "timed_parking", vehicleRestriction: "Authorised vehicles only" })], N);
    expect(v.status).toBe("no");
    expect(v.headline).toBe("No — not your vehicle");
    expect(v.shortLabel).toBe("Not your vehicle");
  });

  it("structured allowedVehicles matching the user's vehicle -> allowed, but with the note", () => {
    const p = panel({ kind: "timed_parking", timeLimitMinutes: 60, allowedVehicles: ["motorcycle"], vehicleRestriction: "Motor cycles only" });
    expect(ev([p], N).status).toBe("no");
    const v = ev([p], N, { vehicleType: "motorcycle" });
    expect(v.status).toBe("yes_with_conditions");
    expect(v.summary).toContain('Sign note: "Motor cycles only".');
  });

  it("'excepted' wording never blocks, but caps a plain yes", () => {
    const v = ev([panel({ kind: "timed_parking", vehicleRestriction: "Buses excepted" })], N);
    expect(v.status).toBe("yes_with_conditions");
    expect(v.summary).toContain('Sign note: "Buses excepted".');
  });

  it("'only' wording we can't interpret -> unsure", () => {
    const v = ev([panel({ kind: "timed_parking", vehicleRestriction: "Caravans and boat trailers only" })], N);
    expect(v.status).toBe("unsure");
    expect(v.summary).toMatch(/Caravans and boat trailers only/);
  });

  it("schema: allowedVehicles is optional for parsing but required (nullable) in the structured-output schema", () => {
    const p = panel({ kind: "timed_parking" });
    expect(SignReadingSchema.safeParse(reading([p])).success).toBe(true);
    expect(SignReadingSchema.safeParse(reading([{ ...p, allowedVehicles: ["car"] }])).success).toBe(true);
    expect(SignReadingSchema.safeParse(reading([{ ...p, allowedVehicles: ["spaceship"] as never }])).success).toBe(false);
    const panelSchema = JSON.stringify(signReadingStructuredOutputSchema);
    expect(panelSchema).toContain('"allowedVehicles"');
  });
});

describe("C5: permit codes", () => {
  it("tokenises multi-area codes", () => {
    expect(permitTokens("Area 1/2")).toEqual(["1", "2"]);
    expect(permitTokens("Area 1 & 2")).toEqual(["1", "2"]);
    expect(permitTokens("1, 2")).toEqual(["1", "2"]);
    expect(permitTokens("Areas 1-3")).toEqual(["1", "2", "3"]);
    expect(permitTokens("Permit Area S")).toEqual(["S"]);
    expect(permitTokens("Resident permit 12")).toEqual(["12"]);
    expect(normalisePermit("Area 012")).toBe("12");
    expect(normalisePermit("Area 1 & 2")).toBe("1,2");
  });

  it("'Area 1/2' does not match a permit for area 12, but matches area 2", () => {
    const p = panel({ kind: "timed_parking", timeLimitMinutes: 120, permitExempt: { areaCode: "Area 1/2" } });
    expect(ev([p], N, { permits: ["12"] }).permitRequired).toBe(false);
    expect(ev([p], N, { permits: ["Area 2"] }).permitRequired).toBe(true);
  });
});

describe("C6: permits only exempt parking-type panels", () => {
  it.each(["no_stopping", "clearway", "bus_lane", "transit_lane", "special_event"] as const)("%s ignores permits", (kind) => {
    const v = ev([panel({ kind, permitExempt: { areaCode: "12" } })], N, { permits: ["12"] });
    expect(v.status).toBe("no");
    expect(words(v)).toMatch(/Permits don't exempt you/);
  });

  it("No Parking with permit holders excepted does exempt", () => {
    expect(ev([panel({ kind: "no_parking", permitExempt: { areaCode: "5" } })], N, { permits: ["5"] }).status).toBe(
      "yes_with_conditions",
    );
  });
});

describe("H1: loading zone default limit", () => {
  it("no printed limit -> 30 min for an eligible vehicle", () => {
    const lz = panel({ kind: "loading_zone", schedules: [schedule(WEEKDAYS, "06:00", "18:00")] });
    const v = ev([lz], N, { vehicleType: "commercial" });
    expect(v.maxStayMinutes).toBe(30);
    expect(v.summary).not.toMatch(/No restrictions/);
  });
});

describe("H2: low-confidence restrictive panel on the other side", () => {
  it("is counted for this side too (its arrow may be misread)", () => {
    const r = reading([panel({ kind: "no_stopping", arrow: "right", confidence: 0.3 }), panel({ kind: "timed_parking", arrow: "left" })]);
    const v = evaluate(r, ctx(N, { side: "left" }));
    expect(v.status).toBe("unsure");
  });

  it("moderately unsure other-side No Stopping -> no (not yes)", () => {
    const r = reading([panel({ kind: "no_stopping", arrow: "right", confidence: 0.6 }), panel({ kind: "timed_parking", arrow: "left" })]);
    const v = evaluate(r, ctx(N, { side: "left" }));
    expect(v.status).toBe("no");
    expect(words(v)).toMatch(/arrow may be misread/);
  });

  it("a confident other-side panel is still ignored", () => {
    const r = reading([panel({ kind: "no_stopping", arrow: "right" }), panel({ kind: "timed_parking", arrow: "left" })]);
    expect(evaluate(r, ctx(N, { side: "left" })).status).toBe("yes");
  });
});

describe("M1: imminent prohibitions and intended stays", () => {
  it("clearway starting in under 5 minutes -> no", () => {
    const ns = panel({ kind: "clearway", schedules: [schedule(WEEKDAYS, "16:00", "18:00")] });
    const v = ev([ns], "2026-11-13T15:58:00+11:00");
    expect(v.status).toBe("no");
    expect(v.summary).toMatch(/^Clearway starts in 2 min \(4:00 pm\) — don't park here\. You can park from 6:00 pm\./);
    expect(v.nextAllowedAt).toBe(utc("2026-11-13T18:00:00+11:00"));
    expect(v.shortLabel).toBe("Clearway in 2 min");
  });

  it("intended stay that doesn't fit: never a plain yes and says how long", () => {
    const ns = panel({ kind: "no_stopping", schedules: [schedule(["sat"], "16:00", "20:00")] });
    const v = ev([ns], N, { intendedStayMinutes: 48 * 60 });
    expect(v.status).toBe("yes_with_conditions");
    expect(v.fitsIntendedStay).toBe(false);
    expect(v.summary).toMatch(/You can stay 1 day 6 hr — until 4:00 pm tomorrow\./);
  });
});

describe("M2: accurate text", () => {
  it("a limit that ends before it bites says so", () => {
    const p = panel({ kind: "timed_parking", timeLimitMinutes: 120, schedules: [schedule(WEEKDAYS, "08:00", "18:00")] });
    const v = ev([p], "2026-11-13T17:00:00+11:00");
    expect(v.summary).toBe("2P ends 6:00 pm — no limit after that. 2P from 8:00 am Mon — move by 10:00 am Mon.");
    expect(v.summary).not.toMatch(/No restrictions right now/);
  });

  it("the override warning only appears when a temporary prohibition decides the answer", () => {
    const tempP = panel({ kind: "timed_parking", temporary: true });
    const v = ev([tempP, twoPMeter()], N);
    expect(words(v)).not.toMatch(/overrides the regular sign/);
    const tempNS = panel({ kind: "no_stopping", temporary: true });
    expect(words(ev([tempNS, twoPMeter()], N))).toMatch(/overrides the regular sign/);
  });

  it("temporary sign labels keep sign codes in capitals", () => {
    expect(panelLabel(panel({ kind: "timed_parking", temporary: true }))).toBe("Temporary P");
    expect(panelLabel(panel({ kind: "timed_parking", timeLimitMinutes: 120, temporary: true }))).toBe("Temporary 2P");
    expect(panelLabel(panel({ kind: "no_stopping", temporary: true }))).toBe("Temporary no stopping");
  });
});

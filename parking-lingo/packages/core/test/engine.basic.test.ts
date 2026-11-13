import { describe, expect, it } from "vitest";
import { evaluate } from "../src/index";
import type { SignReading } from "../src/index";
import { ctx, ev, panel, reading, schedule, twoPMeter, utc, WEEKDAYS, ALL_DAYS } from "./helpers";

describe("confidence gating", () => {
  it("not a parking sign -> unsure", () => {
    const v = evaluate(reading([], { isParkingSign: false }), ctx("2026-11-12T10:00:00+11:00"));
    expect(v.status).toBe("unsure");
    expect(v.headline).toBe("Not a parking sign");
    expect(v.timeline).toEqual([]);
  });

  it("no panels -> unsure", () => {
    const v = evaluate(reading([]), ctx("2026-11-12T10:00:00+11:00"));
    expect(v.status).toBe("unsure");
    expect(v.summary).toMatch(/rescan/i);
  });

  it("very low overall confidence -> unsure with actionable advice", () => {
    const v = evaluate(
      reading([twoPMeter()], { overallConfidence: 0.3, legibilityIssues: ["glare"] }),
      ctx("2026-11-12T10:00:00+11:00"),
    );
    expect(v.status).toBe("unsure");
    expect(v.summary).toMatch(/Move closer/);
    expect(v.warnings.join(" ")).toMatch(/glare/);
  });

  it("moderate confidence never yields yes", () => {
    const v = evaluate(reading([twoPMeter()], { overallConfidence: 0.65 }), ctx("2026-11-12T10:00:00+11:00"));
    expect(v.status).toBe("unsure");
    expect(v.headline).toBe("Not sure — rescan");
  });

  it("moderate panel confidence never yields yes", () => {
    const p = { ...twoPMeter(), confidence: 0.6 };
    expect(ev([p], "2026-11-12T10:00:00+11:00").status).toBe("unsure");
  });

  it("moderate confidence 'no' stays 'no' with a warning", () => {
    const p = panel({ kind: "no_stopping", confidence: 0.6 });
    const v = ev([p], "2026-11-12T10:00:00+11:00");
    expect(v.status).toBe("no");
    expect(v.warnings.join(" ")).toMatch(/full confidence/);
  });

  it("panel confidence below the hard minimum -> unsure even for no", () => {
    const v = ev([panel({ kind: "no_stopping", confidence: 0.3 })], "2026-11-12T10:00:00+11:00");
    expect(v.status).toBe("unsure");
  });

  it("thresholds are configurable", () => {
    const v = evaluate(reading([twoPMeter()], { overallConfidence: 0.65 }), ctx("2026-11-12T10:00:00+11:00"), {
      minConfidenceForYes: 0.6,
    });
    expect(v.status).toBe("yes_with_conditions");
  });

  it("malformed reading -> unsure (not a throw)", () => {
    const bad = { isParkingSign: true, panels: [{ kind: "nonsense" }] } as unknown as SignReading;
    expect(evaluate(bad, ctx("2026-11-12T10:00:00+11:00")).status).toBe("unsure");
  });

  it("unrecognised panel kind -> unsure", () => {
    const v = ev([panel({ kind: "other", rawText: "RESIDENTS ONLY XYZ" }), twoPMeter()], "2026-11-12T10:00:00+11:00");
    expect(v.status).toBe("unsure");
    expect(v.summary).toContain("RESIDENTS ONLY XYZ");
  });

  it("contradictory overlapping time limits -> unsure", () => {
    const a = panel({ kind: "timed_parking", timeLimitMinutes: 60, schedules: [schedule(WEEKDAYS, "08:00", "18:00")] });
    const b = panel({ kind: "timed_parking", timeLimitMinutes: 120, schedules: [schedule(WEEKDAYS, "09:00", "17:00")] });
    const v = ev([a, b], "2026-11-12T10:00:00+11:00");
    expect(v.status).toBe("unsure");
    expect(v.headline).toMatch(/unclear/);
  });

  it("different limits on non-overlapping days are fine", () => {
    const a = panel({ kind: "timed_parking", timeLimitMinutes: 60, schedules: [schedule(WEEKDAYS, "08:00", "18:00")] });
    const b = panel({ kind: "timed_parking", timeLimitMinutes: 120, schedules: [schedule(["sat"], "08:00", "12:00")] });
    const v = ev([a, b], "2026-11-12T10:00:00+11:00");
    expect(v.status).toBe("yes_with_conditions");
    expect(v.maxStayMinutes).toBe(60);
  });

  it("throws on an invalid now or time zone (programming errors)", () => {
    expect(() => evaluate(reading([twoPMeter()]), { now: "not a date", timeZone: "Australia/Sydney" })).toThrow(
      RangeError,
    );
    expect(() => evaluate(reading([twoPMeter()]), { now: Date.now(), timeZone: "Nowhere/Land" })).toThrow(RangeError);
  });
});

describe("no stopping / clearway / no parking", () => {
  it("No Stopping at all times -> no", () => {
    const v = ev([panel({ kind: "no_stopping" })], "2026-11-12T10:00:00+11:00");
    expect(v.status).toBe("no");
    expect(v.headline).toBe("No stopping");
    expect(v.summary).toMatch(/at all times/);
    expect(v.nextAllowedAt).toBeNull();
    expect(v.towAwayRisk).toBe(false);
  });

  it("No Stopping with tow-away -> towAwayRisk", () => {
    const v = ev([panel({ kind: "no_stopping", towAway: true })], "2026-11-12T10:00:00+11:00");
    expect(v.towAwayRisk).toBe(true);
    expect(v.summary).toMatch(/Tow-away/);
  });

  it("clearway in force -> no, towed, allowed when it ends", () => {
    const cw = panel({ kind: "clearway", schedules: [schedule(WEEKDAYS, "06:00", "10:00")] });
    const v = ev([cw], "2026-11-12T07:00:00+11:00");
    expect(v.status).toBe("no");
    expect(v.headline).toBe("No — clearway");
    expect(v.towAwayRisk).toBe(true);
    expect(v.nextAllowedAt).toBe(utc("2026-11-12T10:00:00+11:00"));
    expect(v.validUntil).toBe(utc("2026-11-12T10:00:00+11:00"));
    expect(v.summary).toMatch(/until 10:00 am/);
  });

  it("clearway coming up -> leave before it starts, with tow warning", () => {
    const cw = panel({ kind: "clearway", schedules: [schedule(WEEKDAYS, "16:00", "19:00")] });
    const v = ev([cw], "2026-11-12T14:00:00+11:00");
    expect(v.status).toBe("yes_with_conditions");
    expect(v.leaveBy).toBe(utc("2026-11-12T16:00:00+11:00"));
    expect(v.maxStayMinutes).toBe(120);
    expect(v.towAwayRisk).toBe(true);
    expect(v.summary).toContain("Move by 4:00 pm — clearway starts.");
    expect(v.warnings).toContain("Clearway starts 4:00 pm — vehicles are towed.");
  });

  it("No Parking -> no, with the drop-off nuance", () => {
    const v = ev([panel({ kind: "no_parking", schedules: [schedule(WEEKDAYS, "08:00", "09:30")] })], "2026-11-12T08:30:00+11:00");
    expect(v.status).toBe("no");
    expect(v.headline).toBe("No parking");
    expect(v.summary).toMatch(/2 min/);
    expect(v.summary).toMatch(/3 m/);
  });

  it("No Parking outside its hours -> park until it starts", () => {
    const v = ev([panel({ kind: "no_parking", schedules: [schedule(WEEKDAYS, "08:00", "09:30")] })], "2026-11-12T10:00:00+11:00");
    expect(v.status).toBe("yes_with_conditions");
    expect(v.leaveBy).toBe(utc("2026-11-13T08:00:00+11:00"));
  });

  it("bus lane -> no", () => {
    const v = ev([panel({ kind: "bus_lane", schedules: [schedule(WEEKDAYS, "07:00", "19:00")] })], "2026-11-12T10:00:00+11:00");
    expect(v.status).toBe("no");
    expect(v.headline).toBe("No — bus lane");
  });

  it("special event clearway undated -> treated as in force", () => {
    const v = ev([panel({ kind: "special_event", temporary: true })], "2026-11-12T10:00:00+11:00");
    expect(v.status).toBe("no");
    expect(v.towAwayRisk).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/no readable dates/);
  });
});

describe("timed parking", () => {
  it("inside the window: limit from arrival", () => {
    const v = ev([twoPMeter()], "2026-11-12T10:30:00+11:00");
    expect(v.status).toBe("yes_with_conditions");
    expect(v.headline).toBe("Yes — 2 hrs");
    expect(v.maxStayMinutes).toBe(120);
    expect(v.currentLimitMinutes).toBe(120);
    expect(v.leaveBy).toBe(utc("2026-11-12T12:30:00+11:00"));
    expect(v.paymentRequired).toBe(true);
    expect(v.payment).toBe("meter");
    expect(v.summary).toBe("Park for up to 2 hours. Pay at the meter. Move by 12:30 pm.");
  });

  it("a stay running past the end of the window is fine", () => {
    const v = ev([twoPMeter()], "2026-11-12T17:00:00+11:00");
    // Limit ends at 6 pm, so the next constraint is tomorrow's window: 8 am + 2h.
    expect(v.leaveBy).toBe(utc("2026-11-13T10:00:00+11:00"));
    expect(v.status).toBe("yes_with_conditions");
    expect(v.paymentRequired).toBe(true);
  });

  it("arriving before the window: limit counts from window start", () => {
    const v = ev([twoPMeter()], "2026-11-12T07:00:00+11:00");
    expect(v.leaveBy).toBe(utc("2026-11-12T10:00:00+11:00"));
    expect(v.maxStayMinutes).toBe(180);
    expect(v.paymentRequired).toBe(false);
    expect(v.summary).toContain("Pay from 8:00 am.");
    expect(v.summary).toContain("2P limit starts 8:00 am — move by 10:00 am.");
  });

  it("boundary: exactly at window start", () => {
    const v = ev([twoPMeter()], "2026-11-12T08:00:00+11:00");
    expect(v.leaveBy).toBe(utc("2026-11-12T10:00:00+11:00"));
    expect(v.evidence[0]!.state).toBe("active_now");
  });

  it("boundary: one second before window end is still restricted", () => {
    const v = ev([twoPMeter()], "2026-11-12T17:59:59+11:00");
    expect(v.currentLimitMinutes).toBe(120);
    expect(v.paymentRequired).toBe(true);
  });

  it("boundary: exactly at window end on Friday -> unrestricted for the weekend", () => {
    const v = ev([twoPMeter()], "2026-11-13T18:00:00+11:00");
    expect(v.status).toBe("yes");
    expect(v.headline).toBe("You can park");
    expect(v.paymentRequired).toBe(false);
    expect(v.leaveBy).toBe(utc("2026-11-16T10:00:00+11:00"));
    expect(v.summary).toMatch(/No restrictions right now\. Next restriction: 2P · Meter from 8:00 am Mon\./);
  });

  it("Saturday schedule differs from weekdays", () => {
    const p = twoPMeter([schedule(WEEKDAYS, "08:00", "18:00"), schedule(["sat"], "08:00", "12:30")]);
    const v = ev([p], "2026-11-14T11:00:00+11:00");
    // 11:00 + 2h = 1 pm is after the 12:30 end, so no deadline until Monday.
    expect(v.leaveBy).toBe(utc("2026-11-16T10:00:00+11:00"));
    expect(v.status).toBe("yes_with_conditions");
    expect(v.headline).toBe("Yes — pay to park");
  });

  it("plain P (no limit, no fee) -> yes", () => {
    const v = ev([panel({ kind: "timed_parking", schedules: [] })], "2026-11-12T10:00:00+11:00");
    expect(v.status).toBe("yes");
    expect(v.maxStayMinutes).toBeNull();
  });

  it("paid parking without a time limit", () => {
    const p = panel({ kind: "timed_parking", payment: "ticket", schedules: [schedule(WEEKDAYS, "08:00", "18:00")] });
    const v = ev([p], "2026-11-12T10:00:00+11:00");
    expect(v.status).toBe("yes_with_conditions");
    expect(v.maxStayMinutes).toBeNull();
    expect(v.leaveBy).toBeNull();
    expect(v.paymentRequired).toBe(true);
    expect(v.summary).toContain("No time limit.");
    expect(v.summary).toContain("Buy a ticket");
  });

  it("1/4P", () => {
    const p = panel({ kind: "timed_parking", timeLimitMinutes: 15, schedules: [schedule(WEEKDAYS, "07:00", "18:00")] });
    const v = ev([p], "2026-11-12T12:00:00+11:00");
    expect(v.headline).toBe("Yes — 15 min");
    expect(v.timeline[0]!.label).toBe("1/4P");
  });

  it("intended stay that doesn't fit", () => {
    const v = ev([twoPMeter()], "2026-11-12T10:00:00+11:00", { intendedStayMinutes: 180 });
    expect(v.fitsIntendedStay).toBe(false);
    expect(v.warnings.join(" ")).toMatch(/3 hours/);
    const ok = ev([twoPMeter()], "2026-11-12T10:00:00+11:00", { intendedStayMinutes: 90 });
    expect(ok.fitsIntendedStay).toBe(true);
  });

  it("back-to-back limited windows keep counting from arrival (conservative)", () => {
    const a = panel({ kind: "timed_parking", timeLimitMinutes: 60, schedules: [schedule(ALL_DAYS, "08:00", "10:00")] });
    const b = panel({ kind: "timed_parking", timeLimitMinutes: 120, schedules: [schedule(ALL_DAYS, "10:00", "18:00")] });
    const v = ev([a, b], "2026-11-12T09:30:00+11:00");
    expect(v.leaveBy).toBe(utc("2026-11-12T11:30:00+11:00"));
  });

  it("accepts Date and epoch-ms for now", () => {
    const d = new Date("2026-11-12T10:30:00+11:00");
    const a = evaluate(reading([twoPMeter()]), ctx("x", { now: d }));
    const b = evaluate(reading([twoPMeter()]), ctx("x", { now: d.getTime() }));
    expect(a.leaveBy).toBe(b.leaveBy);
    expect(a.evaluatedAt).toBe(d.toISOString());
    expect(a.timeZone).toBe("Australia/Sydney");
  });
});

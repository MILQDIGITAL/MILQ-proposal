import { describe, expect, it } from "vitest";
import { evaluate, formatDuration, formatShortDuration } from "../src/index";
import { fixtures, getFixture } from "../src/fixtures";
import { ctx, ev, panel, reading, schedule, twoPMeter, utc, WEEKDAYS, ALL_DAYS } from "./helpers";

const NOT_SURE = /Not sure if today is a public holiday/;

describe("needsSide", () => {
  it("true only when the answer differs by side", () => {
    const split = getFixture("split-sides-no-stopping-1p").reading;
    const v = evaluate(split, ctx("2026-11-12T11:00:00+11:00"));
    expect(v.needsSide).toBe(true);
    expect(v.bySide).not.toBeNull();
    expect(v.shortLabel).toBe("Depends on side");
  });

  it("false when the side is given, when sides agree, and when both sides are no", () => {
    const split = getFixture("split-sides-no-stopping-1p").reading;
    expect(evaluate(split, ctx("2026-11-12T11:00:00+11:00", { side: "left" })).needsSide).toBe(false);
    expect(ev([twoPMeter()], "2026-11-12T11:00:00+11:00").needsSide).toBe(false);
    const both = ev([panel({ kind: "no_stopping", arrow: "left" }), panel({ kind: "no_parking", arrow: "right" })], "2026-11-12T11:00:00+11:00");
    expect(both.needsSide).toBe(false);
    expect(both.shortLabel).toBe("Either side");
  });
});

describe("shortLabel", () => {
  it.each([
    ["nsw-2p-meter-weekdays-sat", "Up to 2 hrs"],
    ["nsw-clearway-sandwich", "Up to 1h 30m"],
    ["loading-zone-with-evening-1p", "Loading zone"],
    ["temporary-roadworks-no-stopping", "Temporary sign"],
    ["temporary-works-zone-undated", "Roadworks"],
    ["temporary-event-clearway", "Until 6:00 am"],
    ["vic-permit-zone-area-12", "With permit"],
    ["school-no-parking", "No parking"],
    ["blurry-low-confidence", "Rescan"],
    ["not-a-parking-sign", "Not a parking sign"],
  ])("%s -> %s", (id, label) => {
    const f = getFixture(id);
    expect(evaluate(f.reading, f.demoContext).shortLabel).toBe(label);
  });

  it("clearway and plain yes", () => {
    const cw = panel({ kind: "clearway", schedules: [schedule(WEEKDAYS, "06:00", "10:00")] });
    expect(ev([cw], "2026-11-12T07:00:00+11:00").shortLabel).toBe("Clearway");
    expect(ev([panel({ kind: "timed_parking" })], "2026-11-12T07:00:00+11:00").shortLabel).toBe("No restrictions");
  });

  it("is set on every side verdict", () => {
    for (const f of fixtures) {
      for (const side of ["left", "right", "unknown"] as const) {
        const v = evaluate(f.reading, { ...f.demoContext, side });
        expect(v.shortLabel.length).toBeGreaterThan(0);
        expect(v.shortLabel).not.toMatch(/^(Yes|No) —/);
        if (v.bySide) expect(v.bySide.left.shortLabel.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("long stays", () => {
  it("maxStayMinutes is null when the deadline is more than 24 h away; leaveBy keeps the deadline", () => {
    // Saturday 11 am, meter until 12:30, next limit Monday.
    const p = twoPMeter([schedule(WEEKDAYS, "08:00", "18:00"), schedule(["sat"], "08:00", "12:30")]);
    const v = ev([p], "2026-11-14T11:00:00+11:00");
    expect(v.maxStayMinutes).toBeNull();
    expect(v.leaveBy).toBe(utc("2026-11-16T10:00:00+11:00"));
    expect(v.unrestrictedUntil).toBeNull(); // paying right now
    expect(v.summary).toBe("2P ends 12:30 pm — no limit after that. 2P from 8:00 am Mon — move by 10:00 am Mon. Pay at the meter.");
    expect(v.shortLabel).toBe("Pay to park");
  });

  it("unrestrictedUntil marks when restrictions resume", () => {
    const v = ev([twoPMeter()], "2026-11-14T15:00:00+11:00");
    expect(v.status).toBe("yes");
    expect(v.unrestrictedUntil).toBe(utc("2026-11-16T08:00:00+11:00"));
    expect(v.summary).toBe("No restrictions until 8:00 am Mon (2P · Meter).");
  });

  it("nothing in the look-ahead", () => {
    const v = ev([panel({ kind: "timed_parking" })], "2026-11-14T15:00:00+11:00");
    expect(v.unrestrictedUntil).toBeNull();
    expect(v.leaveBy).toBeNull();
    expect(v.summary).toBe("No restrictions for at least the next 7 days.");
  });

  it("maxStayMinutes stays set within 24 h", () => {
    expect(ev([twoPMeter()], "2026-11-12T17:00:00+11:00").maxStayMinutes).toBe(17 * 60);
  });

  it("intended stay is still checked against a deadline beyond 24 h", () => {
    const v = ev([twoPMeter()], "2026-11-13T18:00:00+11:00", { intendedStayMinutes: 4 * 24 * 60 });
    expect(v.fitsIntendedStay).toBe(false);
    expect(v.warnings.join(" ")).toMatch(/2 days 16 hr/);
  });

  it("formatDuration and formatShortDuration handle days", () => {
    expect(formatDuration(2654)).toBe("1 day 20 hr");
    expect(formatDuration(3 * 24 * 60)).toBe("3 days");
    expect(formatDuration(24 * 60 + 5)).toBe("1 day");
    expect(formatShortDuration(2654)).toBe("1d 20h");
  });
});

describe("timeline invariants", () => {
  it("segments always have from < to and cover exactly now -> now + 24 h", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    const nows: number[] = [];
    for (let i = 0; i < 60; i++) nows.push(start + i * 6.1 * 24 * 3600_000 + (i * 7919) % 3600_000 + (i % 3) * 0.5);
    nows.push(Date.parse("2026-10-03T16:00:00Z"), Date.parse("2026-04-04T16:00:00Z"));
    for (const f of fixtures) {
      for (const now of nows) {
        for (const side of ["left", "right", "unknown"] as const) {
          const v = evaluate(f.reading, { ...f.demoContext, now, side });
          for (const sv of [v, v.bySide?.left, v.bySide?.right]) {
            if (!sv || sv.timeline.length === 0) continue;
            const t = sv.timeline;
            const nowIso = new Date(now).toISOString();
            expect(t[0]!.from).toBe(nowIso);
            expect(Date.parse(t[t.length - 1]!.to) - Date.parse(t[0]!.from)).toBe(24 * 3600_000);
            for (let i = 0; i < t.length; i++) {
              expect(Date.parse(t[i]!.from)).toBeLessThan(Date.parse(t[i]!.to));
              if (i > 0) expect(t[i]!.from).toBe(t[i - 1]!.to);
            }
          }
        }
      }
    }
  });

  it("an unchanging day is one 24 h segment", () => {
    const f = getFixture("ev-charging-2p");
    const v = evaluate(f.reading, f.demoContext);
    expect(v.timeline).toHaveLength(1);
    expect(v.timeline[0]!.from).toBe(utc("2026-11-12T12:00:00+11:00"));
    expect(v.timeline[0]!.to).toBe(utc("2026-11-13T12:00:00+11:00"));
  });
});

describe("holiday calendar in evaluate", () => {
  it("Australia Day 2026 in Sydney: 'except public holidays' lifted, named warning", () => {
    const p = twoPMeter([schedule(WEEKDAYS, "08:00", "18:00", "excluded")]);
    const v = evaluate(reading([p]), { now: "2026-01-26T10:00:00+11:00", timeZone: "Australia/Sydney" });
    expect(v.jurisdiction).toBe("AU-NSW");
    expect(v.publicHolidayToday).toBe(true);
    expect(v.publicHolidayName).toBe("Australia Day");
    expect(v.paymentRequired).toBe(false);
    expect(v.warnings.join(" ")).toMatch(/Public holiday \(Australia Day\)/);
    expect(v.warnings.join(" ")).not.toMatch(NOT_SURE);
  });

  it("Australia Day 2026: a sign silent on holidays still applies", () => {
    const v = evaluate(reading([twoPMeter()]), { now: "2026-01-26T10:00:00+11:00", timeZone: "Australia/Sydney" });
    expect(v.maxStayMinutes).toBe(120);
    expect(v.paymentRequired).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/sign times still apply unless the sign says otherwise/);
  });

  it("ordinary weekday with app-style 'unknown': no 'not sure' warning", () => {
    const v = evaluate(reading([twoPMeter()]), { now: "2026-11-12T10:00:00+11:00", timeZone: "Australia/Sydney", isPublicHoliday: "unknown" });
    expect(v.publicHolidayToday).toBe(false);
    expect(v.publicHolidayName).toBeNull();
    expect(v.warnings.join(" ")).not.toMatch(/holiday/);
    expect(v.maxStayMinutes).toBe(120);
  });

  it("explicit isPublicHoliday overrides the calendar for today", () => {
    const v = evaluate(reading([twoPMeter()]), { now: "2026-01-26T10:00:00+11:00", timeZone: "Australia/Sydney", isPublicHoliday: false });
    expect(v.publicHolidayToday).toBe(false);
    expect(v.maxStayMinutes).toBe(120);
  });

  it("calendar applies to future days in the look-ahead", () => {
    // Sunday evening before Australia Day (Mon 26 Jan 2026): the weekday 2P doesn't start Monday.
    const p = twoPMeter([schedule(WEEKDAYS, "08:00", "18:00", "excluded")]);
    const v = evaluate(reading([p]), { now: "2026-01-25T20:00:00+11:00", timeZone: "Australia/Sydney" });
    expect(v.leaveBy).toBe(utc("2026-01-27T10:00:00+11:00"));
    expect(v.status).toBe("yes");
  });

  it("context.jurisdiction beats the reading hint and the time zone", () => {
    // Melbourne Cup Day 2026 (3 Nov) is a partial (metro) holiday in VIC: stay conservative, warn.
    const r = reading([twoPMeter([schedule(WEEKDAYS, "08:00", "18:00", "excluded")])], { jurisdictionHint: "AU-NSW" });
    const v = evaluate(r, { now: "2026-11-03T10:00:00+11:00", timeZone: "Australia/Sydney", jurisdiction: "VIC" });
    expect(v.jurisdiction).toBe("AU-VIC");
    expect(v.publicHolidayToday).toBe("unknown");
    expect(v.publicHolidayName).toBe("Melbourne Cup Day");
    expect(v.maxStayMinutes).toBe(120);
    expect(v.warnings.join(" ")).toMatch(/Melbourne Cup Day is a public holiday in only part of the state/);
  });

  it("reading.jurisdictionHint is used when context has none", () => {
    const r = reading([twoPMeter()], { jurisdictionHint: "AU-NSW" });
    const v = evaluate(r, { now: "2026-01-26T09:30:00+10:30", timeZone: "Australia/Broken_Hill" });
    expect(v.jurisdiction).toBe("AU-NSW");
    expect(v.publicHolidayToday).toBe(true);
  });

  it("unknown jurisdiction: warn only when a panel's outcome depends on the holiday", () => {
    const noCal = { now: "2026-11-12T10:00:00Z", timeZone: "UTC" };
    const excl = twoPMeter([schedule(WEEKDAYS, "08:00", "18:00", "excluded")]);
    // 'except public holidays' -> depends.
    expect(evaluate(reading([excl]), noCal).warnings.join(" ")).toMatch(NOT_SURE);
    // Silent on holidays -> applies regardless, no warning.
    expect(evaluate(reading([twoPMeter()]), noCal).warnings.join(" ")).not.toMatch(NOT_SURE);
    // All-times panel -> doesn't depend.
    expect(evaluate(reading([panel({ kind: "no_stopping" })]), noCal).warnings.join(" ")).not.toMatch(NOT_SURE);
    // Clearway never lifted on holidays -> doesn't depend.
    const cw = panel({ kind: "clearway", schedules: [schedule(WEEKDAYS, "06:00", "10:00")] });
    expect(evaluate(reading([cw]), { ...noCal, now: "2026-11-12T07:00:00Z" }).warnings.join(" ")).not.toMatch(NOT_SURE);
    // Weekday limit hidden under an all-day No Stopping -> outcome identical, no warning.
    expect(evaluate(reading([panel({ kind: "no_stopping" }), excl]), noCal).warnings.join(" ")).not.toMatch(NOT_SURE);
    expect(evaluate(reading([twoPMeter()]), noCal).jurisdiction).toBeNull();
  });

  it("Good Friday in Melbourne: 'except public holidays' 1P lifted, clearway kept", () => {
    const onep = panel({ kind: "timed_parking", timeLimitMinutes: 60, schedules: [schedule(ALL_DAYS, "08:00", "18:00", "excluded")] });
    const v = evaluate(reading([onep]), { now: "2026-04-03T10:00:00+11:00", timeZone: "Australia/Melbourne" });
    expect(v.publicHolidayName).toBe("Good Friday");
    expect(v.maxStayMinutes).not.toBe(60);
    const cw = panel({ kind: "clearway", schedules: [schedule(WEEKDAYS, "07:00", "10:00")] });
    expect(evaluate(reading([cw]), { now: "2026-04-03T08:00:00+11:00", timeZone: "Australia/Melbourne" }).status).toBe("no");
  });
});

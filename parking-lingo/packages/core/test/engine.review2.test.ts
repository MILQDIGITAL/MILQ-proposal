/** Regression tests for review round 2 (N1–N4, M-a, M-b, L1, L3). */
import { describe, expect, it } from "vitest";
import {
  evaluate,
  isPublicHolidayOn,
  jurisdictionsFromTimeZone,
  publicHolidaysOn,
  resolveJurisdictions,
} from "../src/index";
import { ctx, ev, panel, reading, schedule, utc, WEEKDAYS, ALL_DAYS } from "./helpers";

const SYD = "Australia/Sydney";
const MEL = "Australia/Melbourne";
const words = (v: { warnings: string[] }) => v.warnings.join(" ");
const twoP = (extra = {}) => panel({ kind: "timed_parking", timeLimitMinutes: 120, ...extra });
const sunPH = (kind: "no_stopping" | "clearway" = "no_stopping") =>
  panel({ kind, schedules: [schedule(["sun"], "08:00", "20:00", "included")] });
const exclNS = (days = WEEKDAYS) => panel({ kind: "no_stopping", schedules: [schedule(days, "07:00", "19:00", "excluded")] });

describe("N1: free-text vehicle wording", () => {
  it.each([
    "Car share vehicles only",
    "Police cars only",
    "Hire cars only",
    "Electric cars only",
    "Car pool vehicles only",
    "Medical practitioners' cars only",
    "Small cars only",
    "Doctors only",
  ])("%s -> unsure for a car (never yes)", (vr) => {
    expect(ev([twoP({ vehicleRestriction: vr })], "2026-11-16T10:00:00+11:00").status).toBe("unsure");
  });

  it("'Authorised cars only' -> no (authorised is exclusive)", () => {
    expect(ev([twoP({ vehicleRestriction: "Authorised cars only" })], "2026-11-16T10:00:00+11:00").status).toBe("no");
  });

  it("'Taxis only except buses' -> no for a car (the only-clause decides)", () => {
    const v = ev([twoP({ vehicleRestriction: "Taxis only except buses" })], "2026-11-16T10:00:00+11:00");
    expect(v.status).toBe("no");
    expect(ev([twoP({ vehicleRestriction: "Taxis only except buses" })], "2026-11-16T10:00:00+11:00", { vehicleType: "taxi" }).status).not.toBe("no");
  });

  it("plain 'Cars only' / 'Motor cars only' / 'Motor vehicles only' allow a car (with the note)", () => {
    for (const vr of ["Cars only", "Motor cars only", "Motor vehicles only"]) {
      const v = ev([twoP({ vehicleRestriction: vr })], "2026-11-16T10:00:00+11:00");
      expect(v.status).toBe("yes_with_conditions");
      expect(v.summary).toContain(`Sign note: "${vr}"`);
    }
    expect(ev([twoP({ vehicleRestriction: "Cars only" })], "2026-11-16T10:00:00+11:00", { vehicleType: "motorcycle" }).status).toBe("no");
  });

  it("structured ['other'] -> unsure unless the user's class is also listed", () => {
    expect(ev([twoP({ allowedVehicles: ["other"], vehicleRestriction: "Police only" })], "2026-11-16T10:00:00+11:00").status).toBe("unsure");
    expect(ev([twoP({ allowedVehicles: ["car", "other"] })], "2026-11-16T10:00:00+11:00").status).toBe("yes_with_conditions");
  });
});

describe("N2: temporary dates", () => {
  const ns = (effectiveDates: { start: string | null; end: string | null }, extra = {}) =>
    panel({ kind: "no_stopping", temporary: true, effectiveDates, ...extra });
  const at = "2026-12-30T10:00:00+11:00";

  it("one-sided end date one year off (until '2026-01-03', now 30 Dec 2026) -> unsure", () => {
    const v = ev([panel({ kind: "timed_parking" }), ns({ start: null, end: "2026-01-03" })], at);
    expect(v.status).toBe("unsure");
    expect(v.shortLabel).toBe("Check temporary sign");
    expect(v.summary).toBe("A temporary sign's dates are unclear — read it before parking.");
  });

  it("one-sided start date one year off (from '2027-12-28', now 30 Dec 2026) -> unsure", () => {
    expect(ev([panel({ kind: "timed_parking" }), ns({ start: "2027-12-28", end: null })], at).status).toBe("unsure");
  });

  it("cleanly future temporary prohibition -> never a plain yes, dates stated", () => {
    const t = ns({ start: "2026-12-01", end: "2026-12-20" }, { schedules: [schedule(WEEKDAYS, "07:00", "17:00")] });
    const v = ev([panel({ kind: "timed_parking" }), t], "2026-11-13T10:00:00+11:00");
    expect(v.status).toBe("yes_with_conditions");
    expect(v.shortLabel).toBe("Temporary sign ahead");
    expect(v.summary).toMatch(/Temporary sign: Temporary no stopping.*Tue 1 Dec – Sun 20 Dec/);
  });

  it("cleanly past temporary prohibition -> never a plain yes, dates stated", () => {
    const v = ev([panel({ kind: "timed_parking" }), ns({ start: "2026-01-05", end: "2026-03-31" })], "2026-11-13T10:00:00+11:00");
    expect(v.status).toBe("yes_with_conditions");
    expect(v.summary).toMatch(/looks out of date \(Temporary no stopping, at all times \(Mon 5 Jan – Tue 31 Mar\)\)/);
  });

  it("a doubtful temporary sign doesn't override a permanent No Stopping (still no)", () => {
    const v = ev([panel({ kind: "no_stopping" }), ns({ start: null, end: "2026-01-03" })], at);
    expect(v.status).toBe("no");
  });

  it("date-only START: an overnight window from the night before doesn't count", () => {
    const works = panel({
      kind: "works_zone",
      temporary: true,
      schedules: [schedule(ALL_DAYS, "20:00", "06:00")],
      effectiveDates: { start: "2026-11-13", end: "2026-11-15" },
    });
    const v = ev([panel({ kind: "timed_parking" }), works], "2026-11-13T02:00:00+11:00");
    expect(v.status).toBe("yes_with_conditions");
    expect(v.leaveBy).toBe(utc("2026-11-13T20:00:00+11:00"));
    // ...but 02:00 the next morning (first night) is in force
    expect(ev([panel({ kind: "timed_parking" }), works], "2026-11-14T02:00:00+11:00").status).toBe("no");
  });
});

describe("N3: three-valued calendar and the 'incl. public holidays' caveat", () => {
  it("AFL Grand Final Friday 2026 (VIC) is unknown -> Sun & PH applies", () => {
    expect(isPublicHolidayOn("2026-09-25", "AU-VIC")).toBe("unknown");
    const v = evaluate(reading([sunPH()]), { now: "2026-09-25T10:00:00+10:00", timeZone: MEL });
    expect(v.status).toBe("no");
  });

  it("WA King's Birthday candidate Monday is unknown", () => {
    expect(isPublicHolidayOn("2026-09-28", "AU-WA")).toBe("unknown");
    const v = evaluate(reading([sunPH()]), { now: "2026-09-28T10:00:00+08:00", timeZone: "Australia/Perth" });
    expect(v.status).toBe("no");
  });

  it("Canberra Day with jurisdiction only inferred from Australia/Sydney -> unknown -> Sun & PH applies", () => {
    expect(jurisdictionsFromTimeZone(SYD)).toEqual(["AU-NSW", "AU-ACT"]);
    const v = evaluate(reading([sunPH()]), { now: "2026-03-09T10:00:00+11:00", timeZone: SYD });
    expect(v.status).toBe("no");
    expect(v.publicHolidayToday).toBe("unknown");
    expect(v.jurisdictionSource).toBe("time_zone");
  });

  it("an 'incl. public holidays' panel not in force now: soft warning and never a plain yes", () => {
    const v = evaluate(reading([sunPH()]), { now: "2026-11-12T10:00:00+11:00", timeZone: SYD });
    expect(v.status).toBe("yes_with_conditions");
    expect(v.shortLabel).toBe("Check local holidays");
    expect(words(v)).toMatch(/Local and regional public holidays aren't known to the app/);
  });

  it("…unless the user said today isn't a holiday", () => {
    const v = evaluate(reading([sunPH()]), { now: "2026-11-12T10:00:00+11:00", timeZone: SYD, isPublicHoliday: false });
    expect(words(v)).not.toMatch(/regional public holidays/);
  });

  it("weekend date of a holiday with a weekday substitute is unknown", () => {
    expect(isPublicHolidayOn("2026-12-26", "AU-NSW")).toBe("unknown"); // Boxing Day (Sat), Mon 28 substitute
    expect(isPublicHolidayOn("2026-12-28", "AU-NSW")).toBe(true);
    expect(publicHolidaysOn("2027-12-25", "AU-VIC")[0]?.scope).toBe("uncertain");
  });
});

describe("N4: jurisdiction resolution", () => {
  it("the sign's hint is trusted only when it agrees with the time zone", () => {
    expect(resolveJurisdictions({ timeZone: SYD }, { jurisdictionHint: "AU-ACT" })).toEqual({ jurisdictions: ["AU-ACT"], source: "reading" });
    expect(resolveJurisdictions({ timeZone: "UTC" }, { jurisdictionHint: "VIC" })).toEqual({ jurisdictions: ["AU-VIC"], source: "reading" });
    expect(resolveJurisdictions({ timeZone: SYD }, { jurisdictionHint: "AU-VIC" }).source).toBe("conflict");
    expect(resolveJurisdictions({ timeZone: SYD, jurisdiction: "VIC" }, { jurisdictionHint: "AU-NSW" })).toEqual({
      jurisdictions: ["AU-VIC"],
      source: "context",
    });
  });

  it("Sydney zone + hint AU-VIC on VIC Labour Day: 'except public holidays' No Stopping is NOT lifted", () => {
    const v = evaluate(reading([exclNS()], { jurisdictionHint: "AU-VIC" }), { now: "2026-03-09T10:00:00+11:00", timeZone: SYD });
    expect(v.status).toBe("no");
    expect(v.publicHolidayToday).toBe("unknown");
  });

  it("explicit context.jurisdiction still wins", () => {
    const v = evaluate(reading([exclNS()]), { now: "2026-03-09T10:00:00+11:00", timeZone: SYD, jurisdiction: "AU-VIC" });
    expect(v.status).not.toBe("no");
  });
});

describe("M-a / M-b: who decides it's a holiday", () => {
  it("lifted only by the calendar -> capped and explained", () => {
    const v = evaluate(reading([exclNS(ALL_DAYS)]), { now: "2026-12-25T10:00:00+11:00", timeZone: SYD });
    expect(v.status).toBe("yes_with_conditions");
    expect(v.summary).toMatch(/Lifted today — Christmas Day\. Check the sign\./);
  });

  it("user confirmed the holiday -> no 'lifted by calendar' note", () => {
    const v = evaluate(reading([exclNS(ALL_DAYS)]), { now: "2026-12-25T10:00:00+11:00", timeZone: SYD, isPublicHoliday: true });
    expect(v.summary).not.toMatch(/Lifted today/);
  });

  it("isPublicHoliday:false doesn't switch off 'Sun & PH' on Christmas Day", () => {
    const v = evaluate(reading([sunPH("clearway")]), { now: "2026-12-25T10:00:00+11:00", timeZone: SYD, isPublicHoliday: false });
    expect(v.status).toBe("no");
  });
});

describe("L1 / L3", () => {
  it("2P then 1/4P: move by when the 1/4P starts, coherent text", () => {
    const a = panel({ kind: "timed_parking", timeLimitMinutes: 120, schedules: [schedule(WEEKDAYS, "08:00", "12:00")] });
    const b = panel({ kind: "timed_parking", timeLimitMinutes: 15, schedules: [schedule(WEEKDAYS, "12:00", "14:00")] });
    const v = ev([a, b], "2026-11-13T11:30:00+11:00");
    expect(v.leaveBy).toBe(utc("2026-11-13T12:00:00+11:00"));
    expect(v.summary).toBe("Park for up to 30 min. Move by 12:00 pm — 1/4P limit starts.");
  });

  it("status no (imminent prohibition) clears leaveBy / maxStay / unrestrictedUntil", () => {
    const cw = panel({ kind: "clearway", schedules: [schedule(WEEKDAYS, "16:00", "18:00")] });
    const v = ev([cw], "2026-11-13T15:58:00+11:00");
    expect(v.status).toBe("no");
    expect(v.leaveBy).toBeNull();
    expect(v.maxStayMinutes).toBeNull();
    expect(v.unrestrictedUntil).toBeNull();
  });

  it("every 'no' verdict over the fixtures-like matrix has the three fields null", () => {
    const panelsList = [
      [panel({ kind: "no_stopping" })],
      [panel({ kind: "clearway", schedules: [schedule(WEEKDAYS, "06:00", "10:00")] })],
      [panel({ kind: "loading_zone" })],
    ];
    for (const ps of panelsList) {
      for (const now of ["2026-11-13T07:00:00+11:00", "2026-11-13T05:57:00+11:00"]) {
        const v = evaluate(reading(ps), ctx(now));
        if (v.status !== "no") continue;
        expect([v.leaveBy, v.maxStayMinutes, v.unrestrictedUntil]).toEqual([null, null, null]);
      }
    }
  });
});

describe("holiday property sweep (own fuzz)", () => {
  it("never a plain yes with an 'incl./except public holidays' panel on any day of 2026, in every zone", () => {
    const zones = [SYD, MEL, "Australia/Brisbane", "Australia/Perth", "Australia/Adelaide", "Australia/Hobart", "Australia/Darwin", "UTC"];
    let checked = 0;
    for (const tz of zones) {
      for (let day = 0; day < 365; day += 3) {
        const now = Date.UTC(2026, 0, 1, 1) + day * 86_400_000; // ~noon in eastern AU
        for (const rule of ["included", "excluded"] as const) {
          const p = panel({ kind: "no_stopping", schedules: [schedule(rule === "included" ? ["sun"] : WEEKDAYS, "06:00", "22:00", rule)] });
          const v = evaluate(reading([p]), { now, timeZone: tz });
          checked++;
          if (v.status === "yes") {
            // A plain yes is only possible for an 'excluded' panel on a day it doesn't cover at all.
            expect(rule).toBe("excluded");
            expect(v.summary).not.toMatch(/Lifted today/);
          }
          if (v.timeline.length) {
            expect(Date.parse(v.timeline.at(-1)!.to) - Date.parse(v.timeline[0]!.from)).toBe(86_400_000);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(900);
  });
});

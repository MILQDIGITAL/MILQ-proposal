import { describe, expect, it } from "vitest";
import { evaluate, normalisePermit } from "../src/index";
import { getFixture } from "../src/fixtures";
import { BNE, ctx, ev, panel, schedule, twoPMeter, utc, WEEKDAYS, ALL_DAYS } from "./helpers";

describe("public holidays", () => {
  it("unknown status: restriction applies and the user is warned", () => {
    // UTC has no inferable jurisdiction.
    const p = twoPMeter([schedule(WEEKDAYS, "08:00", "18:00", "excluded")]);
    const v = ev([p], "2026-11-12T09:30:00Z", { isPublicHoliday: "unknown", timeZone: "UTC" });
    expect(v.maxStayMinutes).toBe(120);
    expect(v.warnings.join(" ")).toMatch(/Not sure if today is a public holiday/);
  });

  it("known holiday: a sign silent on holidays still applies, with an info note", () => {
    const v = ev([twoPMeter()], "2026-11-12T10:00:00+11:00", { isPublicHoliday: true });
    expect(v.paymentRequired).toBe(true);
    expect(v.maxStayMinutes).toBe(120);
    expect(v.warnings.join(" ")).toMatch(/public holiday today — sign times still apply/);
  });

  it("unspecified restrictions of every kind still apply on a holiday", () => {
    for (const kind of ["loading_zone", "bus_zone", "disabled_only", "no_parking"] as const) {
      const p = panel({ kind, schedules: [schedule(WEEKDAYS, "06:00", "18:00")] });
      expect(ev([p], "2026-11-16T10:00:00+11:00", { isPublicHoliday: true }).status).toBe("no");
    }
  });

  it("known holiday: explicit 'except public holidays' is honoured", () => {
    const p = twoPMeter([schedule(WEEKDAYS, "08:00", "18:00", "excluded")]);
    const v = ev([p], "2026-11-12T10:00:00+11:00", { isPublicHoliday: true });
    expect(v.paymentRequired).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/excepted/);
  });

  it("known holiday: clearway with no holiday wording stays in force (conservative)", () => {
    const cw = panel({ kind: "clearway", schedules: [schedule(WEEKDAYS, "06:00", "10:00")] });
    const v = ev([cw], "2026-11-12T07:00:00+11:00", { isPublicHoliday: true });
    expect(v.status).toBe("no");
    expect(v.warnings.join(" ")).toMatch(/sign times still apply/);
  });

  it("'Sun & public holidays' applies on a weekday holiday", () => {
    const r = getFixture("sunday-and-holidays-no-parking").reading;
    const v = evaluate(r, ctx("2026-11-12T09:00:00+11:00", { isPublicHoliday: true }));
    expect(v.status).toBe("no");
    expect(v.reasons.join(" ")).toMatch(/also applies on public holidays/);
  });

  it("'Sun & public holidays' with unknown status on a weekday: assume it applies", () => {
    const r = getFixture("sunday-and-holidays-no-parking").reading;
    const v = evaluate(r, ctx("2026-11-12T09:00:00Z", { isPublicHoliday: "unknown", timeZone: "UTC" }));
    expect(v.status).toBe("no");
    expect(v.warnings.join(" ")).toMatch(/public holiday/);
  });

  it("'Sun & public holidays' on an ordinary weekday doesn't apply", () => {
    const r = getFixture("sunday-and-holidays-no-parking").reading;
    const v = evaluate(r, ctx("2026-11-12T09:00:00+11:00"));
    expect(v.status).toBe("yes_with_conditions");
    expect(v.maxStayMinutes).toBe(120);
  });

  it("publicHolidayDates covers days other than today", () => {
    const p = twoPMeter([schedule(WEEKDAYS, "08:00", "18:00", "excluded")]);
    const v = ev([p], "2026-11-12T20:00:00+11:00", { publicHolidayDates: ["2026-11-13"] });
    expect(v.status).toBe("yes");
    expect(v.leaveBy).toBe(utc("2026-11-16T10:00:00+11:00"));
  });

  it("no holiday warning when the holiday status is known false", () => {
    const v = ev([twoPMeter()], "2026-11-12T10:00:00+11:00");
    expect(v.warnings.join(" ")).not.toMatch(/holiday/);
  });
});

describe("permits and vehicles", () => {
  const vic = getFixture("vic-permit-zone-area-12").reading;

  it("matching area permit exempts from the limit", () => {
    const v = evaluate(vic, ctx("2026-11-12T09:00:00+11:00", { timeZone: "Australia/Melbourne", permits: ["12"] }));
    expect(v.status).toBe("yes_with_conditions");
    expect(v.permitRequired).toBe(true);
    expect(v.maxStayMinutes).toBeNull();
    expect(v.headline).toBe("Yes — with permit");
    expect(v.timeline.every((t) => t.status === "allowed")).toBe(true);
  });

  it("permit codes are normalised", () => {
    expect(normalisePermit("Area 012")).toBe("12");
    expect(normalisePermit("zone 5a")).toBe("5A");
    const v = evaluate(vic, ctx("2026-11-12T09:00:00+11:00", { permits: ["AREA 12"] }));
    expect(v.permitRequired).toBe(true);
  });

  it("wrong area permit -> normal 2P limit", () => {
    const v = evaluate(vic, ctx("2026-11-12T09:00:00+11:00", { permits: ["7"] }));
    expect(v.maxStayMinutes).toBe(120);
    expect(v.permitRequired).toBe(false);
  });

  it("exemption with unreadable area -> not assumed, warn", () => {
    const p = { ...twoPMeter(), permitExempt: { areaCode: null } };
    const v = ev([p], "2026-11-12T10:00:00+11:00", { permits: ["12"] });
    expect(v.maxStayMinutes).toBe(120);
    expect(v.warnings.join(" ")).toMatch(/no area could be read/);
  });

  it("permits never exempt from a clearway", () => {
    const cw = panel({ kind: "clearway", permitExempt: { areaCode: "12" } });
    expect(ev([cw], "2026-11-12T10:00:00+11:00", { permits: ["12"] }).status).toBe("no");
  });

  it("permit zone: no for non-holders, yes for holders", () => {
    const pz = panel({ kind: "permit_zone", permitExempt: { areaCode: "S" }, schedules: [schedule(ALL_DAYS, "08:00", "22:00")] });
    const no = ev([pz], "2026-11-12T10:00:00+11:00");
    expect(no.status).toBe("no");
    expect(no.headline).toBe("No — permit holders");
    expect(ev([pz], "2026-11-12T10:00:00+11:00", { permits: ["s"] }).permitRequired).toBe(true);
  });

  it("disability bay: no without permit, yes with it", () => {
    const d = panel({ kind: "disabled_only", timeLimitMinutes: 120 });
    const no = ev([d], "2026-11-12T10:00:00+11:00");
    expect(no.status).toBe("no");
    expect(no.headline).toBe("No — disability permit");
    const yes = ev([d], "2026-11-12T10:00:00+11:00", { hasDisabilityPermit: true });
    expect(yes.status).toBe("yes_with_conditions");
    expect(yes.permitRequired).toBe(true);
    expect(yes.maxStayMinutes).toBe(120);
    expect(yes.summary).toMatch(/disability permit/);
  });

  it("loading zone: no for cars, conditional for commercial vehicles", () => {
    const lz = getFixture("loading-zone-with-evening-1p").reading;
    const car = evaluate(lz, ctx("2026-11-12T11:00:00+11:00"));
    expect(car.status).toBe("no");
    expect(car.headline).toBe("No — loading zone");
    expect(car.nextAllowedAt).toBe(utc("2026-11-12T18:00:00+11:00"));
    const van = evaluate(lz, ctx("2026-11-12T11:00:00+11:00", { vehicleType: "commercial" }));
    expect(van.status).toBe("yes_with_conditions");
    expect(van.maxStayMinutes).toBe(30);
    expect(van.summary).toMatch(/loading or unloading/);
  });

  it("motorbike parking: no for cars, ok for motorcycles", () => {
    const m = panel({ kind: "motorcycle_only" });
    expect(ev([m], "2026-11-12T10:00:00+11:00").headline).toBe("No — motorbikes only");
    expect(ev([m], "2026-11-12T10:00:00+11:00", { vehicleType: "motorcycle" }).status).toBe("yes");
  });

  it("EV charging bay: no for non-EVs", () => {
    const r = getFixture("ev-charging-2p").reading;
    expect(evaluate(r, ctx("2026-11-12T12:00:00+11:00")).status).toBe("no");
    const yes = evaluate(r, ctx("2026-11-12T12:00:00+11:00", { isElectricVehicle: true }));
    expect(yes.maxStayMinutes).toBe(120);
  });

  it("works / mail / car share zones block ordinary cars", () => {
    for (const kind of ["works_zone", "mail_zone", "car_share", "bus_zone", "truck_zone"] as const) {
      expect(ev([panel({ kind })], "2026-11-12T10:00:00+11:00").status).toBe("no");
    }
    expect(ev([panel({ kind: "truck_zone" })], "2026-11-12T10:00:00+11:00", { vehicleType: "truck" }).status).toBe("yes");
  });

  it("free-text vehicle notes are surfaced", () => {
    const p = { ...twoPMeter(), vehicleRestriction: "Motor cars only" };
    expect(ev([p], "2026-11-12T10:00:00+11:00").warnings.join(" ")).toMatch(/Motor cars only/);
  });
});

describe("daylight saving", () => {
  it("time limit is real elapsed time across the DST jump", () => {
    const p = panel({ kind: "timed_parking", timeLimitMinutes: 120 });
    // 1:30 am AEST on 4 Oct 2026; clocks jump 2 -> 3 am.
    const v = ev([p], "2026-10-04T01:30:00+10:00");
    expect(v.leaveBy).toBe("2026-10-03T17:30:00.000Z"); // 4:30 am AEDT
    expect(v.summary).toContain("4:30 am");
  });

  it("windows on the DST start day use the new offset", () => {
    const v = ev([twoPMeter([schedule(["sun"], "08:00", "18:00")])], "2026-10-04T07:00:00+11:00");
    expect(v.leaveBy).toBe(utc("2026-10-04T10:00:00+11:00"));
  });

  it("overnight no stopping shrinks to 7 real hours on DST start night", () => {
    const ns = panel({ kind: "no_stopping", schedules: [schedule(ALL_DAYS, "22:00", "06:00")] });
    const v = ev([ns], "2026-10-03T23:00:00+10:00");
    expect(v.nextAllowedAt).toBe(utc("2026-10-04T06:00:00+11:00"));
    const seg = v.timeline[0]!;
    expect(seg.status).toBe("prohibited");
  });

  it("overnight no stopping on DST end night ends at 6 am standard time", () => {
    const ns = panel({ kind: "no_stopping", schedules: [schedule(ALL_DAYS, "22:00", "06:00")] });
    const v = ev([ns], "2026-04-04T23:00:00+11:00");
    expect(v.nextAllowedAt).toBe("2026-04-04T20:00:00.000Z");
  });

  it("Brisbane is unaffected by southern DST", () => {
    const v = evaluate(
      getFixture("qld-quarter-p-and-p").reading,
      ctx("2026-10-05T07:00:00+10:00", { timeZone: BNE }),
    );
    expect(v.leaveBy).toBe("2026-10-04T21:15:00.000Z");
  });
});

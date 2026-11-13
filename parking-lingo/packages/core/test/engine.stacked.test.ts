import { describe, expect, it } from "vitest";
import { evaluate } from "../src/index";
import { getFixture } from "../src/fixtures";
import { ctx, ev, panel, schedule, twoPMeter, utc, WEEKDAYS, ALL_DAYS } from "./helpers";

const sandwich = getFixture("nsw-clearway-sandwich").reading;
const at = (now: string, extra = {}) => evaluate(sandwich, ctx(now, extra));

describe("stacked panels (clearway / 2P / clearway)", () => {
  it("morning clearway -> no until 10 am", () => {
    const v = at("2026-11-12T07:00:00+11:00");
    expect(v.status).toBe("no");
    expect(v.nextAllowedAt).toBe(utc("2026-11-12T10:00:00+11:00"));
    expect(v.evidence.map((e) => e.state)).toEqual(["active_now", "upcoming", "upcoming"]);
    expect(v.evidence[0]!.drivesDecision).toBe(true);
  });

  it("boundary: 9:59 still clearway, 10:00 parking", () => {
    expect(at("2026-11-12T09:59:00+11:00").status).toBe("no");
    const v = at("2026-11-12T10:00:00+11:00");
    expect(v.status).toBe("yes_with_conditions");
    expect(v.leaveBy).toBe(utc("2026-11-12T12:00:00+11:00"));
  });

  it("afternoon clearway cuts the 2P short", () => {
    const v = at("2026-11-12T13:30:00+11:00");
    expect(v.maxStayMinutes).toBe(90);
    expect(v.leaveBy).toBe(utc("2026-11-12T15:00:00+11:00"));
    expect(v.towAwayRisk).toBe(true);
    expect(v.paymentRequired).toBe(true);
    expect(v.summary).toBe("Park for up to 1 hr 30 min. Buy a ticket and display it. Move by 3:00 pm — clearway starts.");
    expect(v.evidence[2]!.drivesDecision).toBe(true);
    expect(v.reasons.some((r) => r.startsWith("Next: Clearway"))).toBe(true);
  });

  it("evening after clearway: free until next morning's clearway", () => {
    const v = at("2026-11-12T19:00:00+11:00");
    expect(v.status).toBe("yes_with_conditions");
    expect(v.leaveBy).toBe(utc("2026-11-13T06:00:00+11:00"));
    expect(v.summary).toBe("Park until 6:00 am tomorrow — clearway starts.");
    expect(v.headline).toBe("Yes — until 6:00 am");
  });

  it("Saturday -> unrestricted", () => {
    const v = at("2026-11-14T12:00:00+11:00");
    expect(v.status).toBe("yes");
    expect(v.timeline).toHaveLength(1);
    expect(v.timeline[0]!.status).toBe("allowed");
  });
});

describe("overlaps and overnight windows", () => {
  it("most restrictive panel wins when windows overlap", () => {
    const np = panel({ kind: "no_parking", schedules: [schedule(WEEKDAYS, "08:00", "09:30")] });
    const v = ev([np, twoPMeter()], "2026-11-12T09:00:00+11:00");
    expect(v.status).toBe("no");
    expect(v.nextAllowedAt).toBe(utc("2026-11-12T09:30:00+11:00"));
  });

  it("overnight taxi zone blocks cars across midnight", () => {
    const taxi = panel({ kind: "taxi_zone", schedules: [schedule(ALL_DAYS, "22:00", "06:00")] });
    const v = ev([taxi], "2026-11-12T23:00:00+11:00");
    expect(v.status).toBe("no");
    expect(v.headline).toBe("No — taxi zone");
    expect(v.nextAllowedAt).toBe(utc("2026-11-13T06:00:00+11:00"));
    expect(ev([taxi], "2026-11-13T05:59:00+11:00").status).toBe("no");
    expect(ev([taxi], "2026-11-13T06:00:00+11:00").status).not.toBe("no");
  });

  it("overnight window belongs to the day it starts", () => {
    const fri = panel({ kind: "no_stopping", schedules: [schedule(["fri"], "22:00", "06:00")] });
    expect(ev([fri], "2026-11-14T02:00:00+11:00").status).toBe("no"); // Sat 2am (Fri night)
    expect(ev([fri], "2026-11-13T02:00:00+11:00").status).not.toBe("no"); // Fri 2am (Thu night)
  });

  it("taxi zone is fine for a taxi", () => {
    const taxi = panel({ kind: "taxi_zone", schedules: [schedule(ALL_DAYS, "22:00", "06:00")] });
    expect(ev([taxi], "2026-11-12T23:00:00+11:00", { vehicleType: "taxi" }).status).not.toBe("no");
  });

  it("whole-day schedule 00:00-24:00", () => {
    const sun = panel({ kind: "no_stopping", schedules: [schedule(["sun"], "00:00", "24:00")] });
    const v = ev([sun], "2026-11-15T12:00:00+11:00");
    expect(v.status).toBe("no");
    expect(v.nextAllowedAt).toBe(utc("2026-11-16T00:00:00+11:00"));
  });
});

describe("side handling", () => {
  const split = getFixture("split-sides-no-stopping-1p").reading;

  it("left of the pole -> no stopping", () => {
    const v = evaluate(split, ctx("2026-11-12T11:00:00+11:00", { side: "left" }));
    expect(v.status).toBe("no");
    expect(v.side).toBe("left");
    expect(v.bySide).toBeNull();
    expect(v.evidence[1]!.state).toBe("other_side");
  });

  it("right of the pole -> 1P", () => {
    const v = evaluate(split, ctx("2026-11-12T11:00:00+11:00", { side: "right" }));
    expect(v.status).toBe("yes_with_conditions");
    expect(v.maxStayMinutes).toBe(60);
    expect(v.evidence[0]!.state).toBe("other_side");
  });

  it("unknown side with differing arrows -> depends on side, with per-side answers", () => {
    const v = evaluate(split, ctx("2026-11-12T11:00:00+11:00"));
    expect(v.status).toBe("unsure");
    expect(v.headline).toBe("Depends on side");
    expect(v.bySide?.left.status).toBe("no");
    expect(v.bySide?.right.status).toBe("yes_with_conditions");
    expect(v.summary).toMatch(/Which side/);
    expect(v.timeline).toEqual([]);
  });

  it("unknown side where both sides are prohibited -> no", () => {
    const r = [panel({ kind: "no_stopping", arrow: "left" }), panel({ kind: "no_parking", arrow: "right" })];
    const v = ev(r, "2026-11-12T11:00:00+11:00");
    expect(v.status).toBe("no");
    expect(v.headline).toBe("No — either side");
  });

  it("panels without arrows apply to both sides; no per-side split needed", () => {
    const v = ev([twoPMeter()], "2026-11-12T11:00:00+11:00");
    expect(v.bySide).toBeNull();
    expect(v.side).toBe("unknown");
  });

  it("chosen side not covered by any panel -> unsure", () => {
    const v = ev([panel({ kind: "no_stopping", arrow: "left" })], "2026-11-12T11:00:00+11:00", { side: "right" });
    expect(v.status).toBe("unsure");
    expect(v.summary).toMatch(/right side/);
  });

  it("a double-headed arrow panel applies to either chosen side", () => {
    const p = { ...twoPMeter(), arrow: "both" as const };
    expect(ev([p], "2026-11-12T11:00:00+11:00", { side: "left" }).maxStayMinutes).toBe(120);
    expect(ev([p], "2026-11-12T11:00:00+11:00", { side: "right" }).maxStayMinutes).toBe(120);
  });
});

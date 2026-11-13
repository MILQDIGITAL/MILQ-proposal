import { describe, expect, it } from "vitest";
import { evaluate } from "../src/index";
import { getFixture } from "../src/fixtures";
import { ctx, ev, panel, schedule, twoPMeter, utc, WEEKDAYS } from "./helpers";

const roadworks = getFixture("temporary-roadworks-no-stopping").reading;
const event = getFixture("temporary-event-clearway").reading;

describe("temporary signs", () => {
  it("roadworks no stopping overrides the permanent 2P during its hours", () => {
    const v = evaluate(roadworks, ctx("2026-11-16T09:00:00+11:00"));
    expect(v.status).toBe("no");
    expect(v.headline).toBe("No — temporary sign");
    expect(v.towAwayRisk).toBe(true);
    expect(v.nextAllowedAt).toBe(utc("2026-11-16T17:00:00+11:00"));
    expect(v.warnings).toContain("A temporary sign overrides the regular sign right now.");
  });

  it("after the roadworks hours the permanent 2P applies", () => {
    const v = evaluate(roadworks, ctx("2026-11-16T17:30:00+11:00"));
    expect(v.status).toBe("yes_with_conditions");
    expect(v.leaveBy).toBe(utc("2026-11-17T10:00:00+11:00"));
  });

  it("before the dated works: normal rules plus an upcoming warning", () => {
    const v = evaluate(roadworks, ctx("2026-11-13T10:00:00+11:00"));
    expect(v.status).toBe("yes_with_conditions");
    expect(v.maxStayMinutes).toBe(120);
    expect(v.upcomingTemporary).toHaveLength(1);
    expect(v.upcomingTemporary[0]!.from).toBe(utc("2026-11-16T07:00:00+11:00"));
    expect(v.warnings.join(" ")).toMatch(/Temporary no stopping from 7:00 am Mon/);
  });

  it("the night before the works: leave before 7 am", () => {
    const v = evaluate(roadworks, ctx("2026-11-15T20:00:00+11:00"));
    expect(v.leaveBy).toBe(utc("2026-11-16T07:00:00+11:00"));
    expect(v.towAwayRisk).toBe(true);
    expect(v.summary).toContain("temporary no stopping starts");
  });

  it("temporary event clearway (date-time range) in force", () => {
    const v = evaluate(event, ctx("2026-11-21T12:00:00+11:00"));
    expect(v.status).toBe("no");
    expect(v.headline).toBe("No — temporary clearway");
    expect(v.nextAllowedAt).toBe(utc("2026-11-21T20:00:00+11:00"));
  });

  it("temporary event clearway: day before shows the deadline", () => {
    const v = evaluate(event, ctx("2026-11-20T18:00:00+11:00"));
    expect(v.leaveBy).toBe(utc("2026-11-21T06:00:00+11:00"));
    expect(v.summary).toBe("4P ends 8:00 pm — no limit after that. Park until 6:00 am tomorrow — temporary clearway starts.");
  });

  it("temporary event clearway: after it ends, permanent rules again", () => {
    const v = evaluate(event, ctx("2026-11-21T20:00:00+11:00"));
    expect(v.status).not.toBe("no");
    expect(v.evidence[0]!.state).toBe("expired");
  });

  it("undated temporary sign is treated as in force, with a warning", () => {
    const v = evaluate(getFixture("temporary-works-zone-undated").reading, ctx("2026-11-12T10:00:00+11:00"));
    expect(v.status).toBe("no");
    expect(v.headline).toBe("No — roadworks");
    expect(v.warnings.join(" ")).toMatch(/no readable dates/);
  });

  it("expired temporary sign: not applied, but warned and never a plain yes", () => {
    const old = panel({
      kind: "no_stopping",
      temporary: true,
      effectiveDates: { start: "2026-05-12", end: "2026-05-12" },
    });
    const v = ev([old], "2026-11-14T10:00:00+11:00");
    expect(v.status).toBe("yes_with_conditions");
    expect(v.warnings.join(" ")).toMatch(/out of date/);
    expect(v.warnings.join(" ")).toMatch(/12 May 2026/);
  });

  it("a temporary permissive sign never beats a permanent prohibition", () => {
    const tempP = panel({ kind: "timed_parking", timeLimitMinutes: 240, temporary: true });
    const ns = panel({ kind: "no_stopping" });
    expect(ev([tempP, ns], "2026-11-12T10:00:00+11:00").status).toBe("no");
  });

  it("temporary sign far in the future is listed but doesn't change today's answer", () => {
    const future = panel({
      kind: "no_stopping",
      temporary: true,
      schedules: [schedule(WEEKDAYS, "07:00", "17:00")],
      effectiveDates: { start: "2027-01-11", end: "2027-01-15" },
    });
    const v = ev([future, twoPMeter()], "2026-11-12T10:00:00+11:00");
    expect(v.maxStayMinutes).toBe(120);
    expect(v.upcomingTemporary[0]!.from).toBe(utc("2027-01-11T07:00:00+11:00"));
  });
});

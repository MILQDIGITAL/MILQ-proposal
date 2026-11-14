import { evaluate, type Verdict } from "@parking-lingo/core";
import { getFixture } from "@parking-lingo/core/fixtures";
import { describe, expect, it } from "vitest";
import { buildContext, DEFAULT_SETTINGS } from "../state/settings";
import { countdownText, formatCountdown, shortHourLabel } from "./format";
import { buildTimelineModel } from "./timeline";
import { devFixturesById } from "../dev/devFixtures";
import { buildVerdictViewModel, buildWarnings, classifyWarning, dependsOnSide, holidayCalendarLine, isHolidayQuestion, toneFor } from "./viewModel";

function verdictFor(id: string, extra: Parameters<typeof buildContext>[1] extends infer T ? Partial<T> : never = {}): { v: Verdict; now: number; reading: ReturnType<typeof getFixture>["reading"] } {
  const f = getFixture(id);
  const { now, timeZone, ...overrides } = f.demoContext;
  const v = evaluate(f.reading, buildContext(DEFAULT_SETTINGS, { now, timeZone, overrides, ...extra }));
  return { v, now: new Date(now).getTime(), reading: f.reading };
}

describe("formatCountdown", () => {
  it.each([
    [0, "now"],
    [-5, "now"],
    [30_000, "under 1 min"],
    [12 * 60_000, "12 min"],
    [60 * 60_000, "1 h"],
    [85 * 60_000, "1 h 25 min"],
    [26 * 3_600_000, "1 day 2 h"],
    [48 * 3_600_000, "2 days"],
  ])("%d ms → %s", (ms, out) => expect(formatCountdown(ms)).toBe(out));

  it("countdownText", () => {
    expect(countdownText("2026-01-01T01:00:00Z", Date.parse("2026-01-01T00:00:00Z"))).toBe("in 1 h");
    expect(countdownText("2026-01-01T00:00:00Z", Date.parse("2026-01-01T00:00:01Z"))).toBe("time's up");
  });

  it("shortHourLabel", () => {
    expect([0, 6, 12, 18].map(shortHourLabel)).toEqual(["12 am", "6 am", "12 pm", "6 pm"]);
  });
});

describe("toneFor / stripStatusPrefix / classifyWarning", () => {
  it("maps statuses to tones", () => {
    expect(toneFor("yes", false)).toBe("yes");
    expect(toneFor("yes_with_conditions", false)).toBe("conditional");
    expect(toneFor("no", false)).toBe("no");
    expect(toneFor("unsure", false)).toBe("unsure");
    expect(toneFor("unsure", true)).toBe("side");
  });
  it("classifies warnings", () => {
    expect(classifyWarning("A temporary sign overrides the regular sign right now.")).toBe("temporary");
    expect(classifyWarning("Clearway starts 3:00 pm — vehicles are towed.")).toBe("tow");
    expect(classifyWarning("Not sure if today is a public holiday — assuming…")).toBe("holiday");
    expect(classifyWarning("Hard to read: Motion blur.")).toBe("legibility");
    expect(classifyWarning("Something else")).toBe("general");
  });
});

describe("buildVerdictViewModel", () => {
  it("2P meter: conditional, leave-by first with countdown, then stay + payment", () => {
    const { v, now, reading } = verdictFor("nsw-2p-meter-weekdays-sat");
    const vm = buildVerdictViewModel(v, reading, now);
    expect(vm.tone).toBe("conditional");
    expect(vm.statusWord).toBe("YES");
    expect(vm.heroHeadline).toBe("Up to 2 hrs");
    expect(vm.haptic).toBe("warning");
    expect(vm.chips.map((c) => c.key)).toEqual(["leaveBy", "stay", "payment"]);
    const leave = vm.chips[0]!;
    expect(leave.label).toBe("Leave by 12:30 pm");
    expect(leave.value).toBe("12:30 pm");
    expect(leave.countdownTo).toBe(v.leaveBy);
    expect(vm.chips[1]!.label).toBe("Up to 2 hours");
    expect(vm.chips[2]!.label).toBe("Pay at meter");
    expect(vm.accessibilityLabel).toContain("Leave by 12:30 pm, in 2 hours");
    // NSW calendar resolves the holiday question, so no "not sure" warning any more.
    expect(vm.warnings).toEqual([]);
    expect(vm.holidayNote).toBeNull();
  });

  it("clearway sandwich: tow-away chip and tow warning", () => {
    const { v, now, reading } = verdictFor("nsw-clearway-sandwich");
    const vm = buildVerdictViewModel(v, reading, now);
    expect(vm.chips.map((c) => c.key)).toEqual(["leaveBy", "stay", "payment", "towAway"]);
    expect(vm.chips.find((c) => c.key === "payment")!.label).toBe("Buy a ticket");
    expect(vm.chips.find((c) => c.key === "towAway")!.tone).toBe("danger");
    expect(vm.warnings[0]!.kind).toBe("tow");
  });

  it("temporary roadworks: red NO, active temporary banner, no duplicate override warning", () => {
    const { v, now, reading } = verdictFor("temporary-roadworks-no-stopping");
    const vm = buildVerdictViewModel(v, reading, now);
    expect(vm.tone).toBe("no");
    expect(vm.haptic).toBe("error");
    expect(vm.temporaryAlert?.state).toBe("active");
    expect(vm.temporaryAlert?.title).toBe("Temporary sign in force");
    expect(vm.temporaryAlert?.detail).toBe("Temporary no stopping overrides the regular sign — tow-away.");
    expect(vm.warnings.some((w) => /overrides the regular sign/.test(w.text))).toBe(false);
    expect(vm.chips.map((c) => c.key)).toEqual(["nextAllowed", "towAway"]);
    expect(vm.chips[0]!.label).toBe("Can park from 5:00 pm");
  });

  it("future temporary clearway: upcoming banner", () => {
    const { v, now, reading } = verdictFor("temporary-event-clearway");
    const vm = buildVerdictViewModel(v, reading, now);
    expect(vm.temporaryAlert).toEqual({
      state: "upcoming",
      title: "Temporary sign coming up",
      detail: "Temporary clearway from 6:00 am tomorrow to 8:00 pm tomorrow.",
    });
  });

  it("split sides: side tone, details hidden, per-side verdicts present", () => {
    const { v, now, reading } = verdictFor("split-sides-no-stopping-1p");
    expect(dependsOnSide(v)).toBe(true);
    const vm = buildVerdictViewModel(v, reading, now);
    expect(vm.tone).toBe("side");
    expect(vm.showDetails).toBe(false);
    expect(v.bySide?.left.status).toBe("no");
    expect(v.bySide?.right.status).toBe("yes_with_conditions");
  });

  it("selected side re-evaluates to that side's answer", () => {
    const { v } = verdictFor("split-sides-no-stopping-1p", { side: "right" });
    expect(v.side).toBe("right");
    expect(v.status).toBe("yes_with_conditions");
    expect(dependsOnSide(v)).toBe(false);
  });

  it("permit holder: permit chip + no time limit", () => {
    const { v, now, reading } = verdictFor("vic-permit-zone-area-12");
    const vm = buildVerdictViewModel(v, reading, now);
    expect(vm.chips.map((c) => c.key)).toEqual(["noLimit", "permit"]);
  });

  it("blurry: unsure with no chips", () => {
    const { v, now, reading } = verdictFor("blurry-low-confidence");
    const vm = buildVerdictViewModel(v, reading, now);
    expect(vm.tone).toBe("unsure");
    expect(vm.statusWord).toBe("NOT SURE");
    expect(vm.chips).toEqual([]);
    expect(vm.warnings[0]!.kind).toBe("legibility");
  });
});

describe("buildTimelineModel", () => {
  it("lays out contiguous blocks over 24 h with local 6-hourly ticks", () => {
    const { v, now } = verdictFor("nsw-clearway-sandwich");
    const m = buildTimelineModel(v.timeline, now, v.timeZone)!;
    expect(m.blocks.length).toBe(v.timeline.length);
    const total = m.blocks.reduce((a, b) => a + b.width, 0);
    expect(total).toBeCloseTo(1, 5);
    expect(m.blocks[0]!.start).toBe(0);
    expect(m.nowAt).toBe(0);
    expect(m.currentIndex).toBe(0);
    expect(m.blocks[0]!.rangeText).toBe("1:30 pm – 3:00 pm");
    expect(m.blocks[1]!.status).toBe("prohibited");
    expect(m.ticks.map((t) => t.label)).toEqual(["6 pm", "12 am", "6 am", "12 pm"]);
  });

  it("handles a single all-day segment and empty timelines", () => {
    const { v, now } = verdictFor("ev-charging-2p");
    const m = buildTimelineModel(v.timeline, now, v.timeZone)!;
    expect(m.blocks).toHaveLength(1);
    expect(m.blocks[0]!.width).toBe(1);
    expect(buildTimelineModel([], now, v.timeZone)).toBeNull();
  });
});

describe("new core semantics", () => {
  it("uses core's shortLabel and needsSide", () => {
    const { v, now, reading } = verdictFor("temporary-roadworks-no-stopping");
    expect(buildVerdictViewModel(v, reading, now).heroHeadline).toBe("Temporary sign");
    expect(verdictFor("split-sides-no-stopping-1p").v.needsSide).toBe(true);
  });

  it("no limit until the next restriction when unrestricted now", () => {
    const { v, now, reading } = verdictFor("nsw-2p-meter-weekdays-sat");
    const free = {
      ...v,
      status: "yes" as const,
      maxStayMinutes: null,
      leaveBy: null,
      paymentRequired: false,
      unrestrictedUntil: "2026-11-15T21:00:00.000Z", // 8:00 am Mon Sydney
    };
    const vm = buildVerdictViewModel(free, reading, now);
    expect(vm.chips.map((c) => c.label)).toEqual(["No limit until 8:00 am Mon"]);
    expect(vm.statusQualifier).toBeNull();
    const none = buildVerdictViewModel({ ...free, unrestrictedUntil: null }, reading, now);
    expect(none.chips.map((c) => c.label)).toEqual(["No time limit"]);
  });

  it("holiday toggle only for core's 'not sure' question; holiday name note", () => {
    const w = buildWarnings([
      "Not sure if today is a public holiday — assuming the sign's restrictions apply.",
      "It's a public holiday today — sign times still apply unless the sign says otherwise (some councils differ).",
    ]);
    expect(w.map((x) => x.holidayQuestion)).toEqual([true, false]);
    const { v, now, reading } = verdictFor("nsw-2p-meter-weekdays-sat");
    const vm = buildVerdictViewModel({ ...v, publicHolidayToday: true, publicHolidayName: "Christmas Day" }, reading, now);
    expect(vm.holidayNote).toBe("Public holiday today: Christmas Day");
  });

  it("temporary banner relies on core: no override claim without core's warning", () => {
    const { v, now, reading } = verdictFor("temporary-roadworks-no-stopping");
    const notDriving = { ...v, warnings: v.warnings.filter((x) => !x.includes("overrides")) };
    expect(buildVerdictViewModel(notDriving, reading, now).temporaryAlert).toBeNull();
    const inForce = { ...v, warnings: ["A temporary sign is in force right now."] };
    expect(buildVerdictViewModel(inForce, reading, now).temporaryAlert?.detail).toBe("Temporary no stopping applies right now — tow-away.");
  });
});

describe("read-the-sign unsure states and holiday calendar", () => {
  const evalDev = (id: string) => {
    const f = devFixturesById[id]!;
    const v = evaluate(f.reading, buildContext(DEFAULT_SETTINGS, { now: f.demoContext.now, timeZone: f.demoContext.timeZone }));
    return { v, reading: f.reading, now: Date.parse(f.demoContext.now as string) };
  };

  it("unclear temporary dates get the temporary tone and a read-the-sign card, not an 'overrides' banner", () => {
    const { v, reading, now } = evalDev("dev-temporary-dates-unclear");
    expect(v.shortLabel).toBe("Check temporary sign");
    const vm = buildVerdictViewModel(v, reading, now);
    expect(vm.tone).toBe("temporary");
    expect(vm.statusWord).toBe("CHECK SIGN");
    expect(vm.special?.kind).toBe("temporary_dates");
    expect(vm.special?.title).toBe("Read the temporary sign");
    expect(vm.special?.quote).toContain("ROAD WORK");
    expect(vm.temporaryAlert).toBeNull();
    expect(vm.showDetails).toBe(false);
    expect(vm.warnings.some((w) => /overrides the regular sign/.test(w.text))).toBe(false);
    expect(vm.chips).toEqual([]);
  });

  it("unclear vehicle wording shows the sign's vehicle note", () => {
    const { v, reading, now } = evalDev("dev-vehicle-note-unclear");
    const vm = buildVerdictViewModel(v, reading, now);
    expect(vm.tone).toBe("unsure");
    expect(vm.special).toMatchObject({ kind: "vehicle_note", quote: "Except buses, cars only" });
    expect(vm.statusWord).toBe("CHECK SIGN");
  });

  it("blurry stays the generic unsure state", () => {
    const { v, now, reading } = verdictFor("blurry-low-confidence");
    expect(buildVerdictViewModel(v, reading, now).special).toBeNull();
  });

  it("calendar line covers conflict, unknown jurisdiction and unknown status", () => {
    const { v, reading } = evalDev("dev-jurisdiction-conflict");
    expect(v.jurisdictionSource).toBe("conflict");
    expect(holidayCalendarLine(v, reading)).toMatch(/looks like VIC, but this phone's time zone suggests NSW/);
    expect(holidayCalendarLine({ jurisdiction: null, jurisdictionSource: null, publicHolidayToday: "unknown" }, null)).toMatch(/^State unknown.*unclear/);
    expect(holidayCalendarLine({ jurisdiction: "AU-QLD", jurisdictionSource: "reading", publicHolidayToday: false }, null)).toBe(
      "Public holidays: QLD calendar (from the sign). Local and regional holidays aren't included.",
    );
  });

  it("holiday toggle is offered for the local/regional and partial-state caveats too", () => {
    expect(isHolidayQuestion("Local and regional public holidays aren't known to the app — if today is one, the 2P times apply.")).toBe(true);
    expect(isHolidayQuestion("Melbourne Cup Day is a public holiday in only part of the state — assuming the sign's restrictions apply. Check locally.")).toBe(true);
    expect(isHolidayQuestion("It's a public holiday today — sign times still apply unless the sign says otherwise (some councils differ).")).toBe(false);
  });

  it("'no' verdicts never get leave-by/stay tiles", () => {
    const { v, now, reading } = verdictFor("school-no-parking");
    expect(v.leaveBy).toBeNull();
    expect(buildVerdictViewModel(v, reading, now).chips.map((c) => c.key)).toEqual(["nextAllowed"]);
  });
});

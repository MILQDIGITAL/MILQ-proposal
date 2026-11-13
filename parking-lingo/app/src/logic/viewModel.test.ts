import { evaluate, type Verdict } from "@parking-lingo/core";
import { getFixture } from "@parking-lingo/core/fixtures";
import { describe, expect, it } from "vitest";
import { buildContext, DEFAULT_SETTINGS } from "../state/settings";
import { countdownText, formatCountdown, shortHourLabel } from "./format";
import { buildTimelineModel } from "./timeline";
import { buildVerdictViewModel, classifyWarning, dependsOnSide, stripStatusPrefix, toneFor } from "./viewModel";

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
  it("strips a status prefix that repeats the badge", () => {
    expect(stripStatusPrefix("Yes — 2 hrs")).toBe("Up to 2 hrs");
    expect(stripStatusPrefix("Yes — until 6:00 am")).toBe("Until 6:00 am");
    expect(stripStatusPrefix("No — clearway")).toBe("Clearway");
    expect(stripStatusPrefix("No parking")).toBe("No parking");
    expect(stripStatusPrefix("No — either side")).toBe("No — either side");
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
    // holiday doubt sorts last
    expect(vm.warnings.at(-1)?.kind).toBe("holiday");
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
    expect(vm.temporaryAlert?.detail).toContain("Temporary no stopping");
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

describe("long stays", () => {
  it("drops the 'Up to' tile when the stay is over a day", () => {
    const { v, now, reading } = verdictFor("nsw-clearway-sandwich");
    const long = { ...v, status: "yes" as const, maxStayMinutes: 2654, leaveBy: new Date(now + 2654 * 60_000).toISOString(), paymentRequired: false, towAwayRisk: false };
    const vm = buildVerdictViewModel(long, reading, now);
    expect(vm.chips.map((c) => c.key)).toEqual(["leaveBy"]);
    expect(vm.statusQualifier).toBeNull();
  });
});

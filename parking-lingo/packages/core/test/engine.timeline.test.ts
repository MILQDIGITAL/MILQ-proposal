import { describe, expect, it } from "vitest";
import { evaluate } from "../src/index";
import type { VerdictStatus } from "../src/index";
import { fixtures, getFixture } from "../src/fixtures";
import { ctx, ev, twoPMeter, utc } from "./helpers";

describe("timeline", () => {
  it("is contiguous and covers exactly the next 24 hours", () => {
    for (const f of fixtures) {
      const v = evaluate(f.reading, { ...f.demoContext, isPublicHoliday: false, side: "left" });
      if (v.status === "unsure") continue;
      const now = Date.parse(v.evaluatedAt);
      expect(Date.parse(v.timeline[0]!.from)).toBe(now);
      expect(Date.parse(v.timeline[v.timeline.length - 1]!.to)).toBe(now + 24 * 3600_000);
      for (let i = 1; i < v.timeline.length; i++) {
        expect(v.timeline[i]!.from).toBe(v.timeline[i - 1]!.to);
        // adjacent segments always differ
        const a = v.timeline[i - 1]!;
        const b = v.timeline[i]!;
        expect(a.status === b.status && a.label === b.label).toBe(false);
      }
    }
  });

  it("clearway sandwich from 5 am shows the full day", () => {
    const v = evaluate(getFixture("nsw-clearway-sandwich").reading, ctx("2026-11-12T05:00:00+11:00"));
    expect(v.timeline.map((t) => [t.status, t.label])).toEqual([
      ["allowed", "No restrictions"],
      ["prohibited", "Clearway (tow-away)"],
      ["limited", "2P · Ticket"],
      ["prohibited", "Clearway (tow-away)"],
      ["allowed", "No restrictions"],
    ]);
    expect(v.timeline[1]!.from).toBe(utc("2026-11-12T06:00:00+11:00"));
    expect(v.timeline[3]!.to).toBe(utc("2026-11-12T19:00:00+11:00"));
    expect(v.timeline[2]!.panels).toEqual([1]);
  });

  it("is empty for unsure verdicts", () => {
    const v = evaluate(getFixture("blurry-low-confidence").reading, ctx("2026-11-12T10:00:00+11:00"));
    expect(v.timeline).toEqual([]);
  });

  it("is deterministic", () => {
    const a = ev([twoPMeter()], "2026-11-12T10:00:00+11:00");
    const b = ev([twoPMeter()], "2026-11-12T10:00:00+11:00");
    expect(a).toEqual(b);
  });
});

describe("fixtures with their demo context", () => {
  const expected: Record<string, VerdictStatus> = {
    "nsw-2p-meter-weekdays-sat": "yes_with_conditions",
    "nsw-clearway-sandwich": "yes_with_conditions",
    "no-stopping-anytime-left": "unsure",
    "school-no-parking": "no",
    "loading-zone-with-evening-1p": "no",
    "vic-permit-zone-area-12": "yes_with_conditions",
    "bus-zone-peaks": "yes_with_conditions",
    "night-taxi-zone": "yes_with_conditions",
    "disabled-only-right": "unsure",
    "split-sides-no-stopping-1p": "unsure",
    "temporary-roadworks-no-stopping": "no",
    "temporary-event-clearway": "yes_with_conditions",
    "temporary-works-zone-undated": "no",
    "qld-quarter-p-and-p": "yes_with_conditions",
    "ev-charging-2p": "yes_with_conditions",
    "sunday-and-holidays-no-parking": "no",
    "blurry-low-confidence": "unsure",
    "not-a-parking-sign": "unsure",
  };

  it("every fixture has an expectation", () => {
    expect(Object.keys(expected).sort()).toEqual(fixtures.map((f) => f.id).sort());
  });

  it.each(fixtures.map((f) => [f.id, f] as const))("%s", (id, f) => {
    const v = evaluate(f.reading, f.demoContext);
    expect(v.status).toBe(expected[id]);
    // Headlines stay glanceable: at most 4 words (ignoring the dash).
    expect(v.headline.split(" ").filter((w) => w !== "—").length).toBeLessThanOrEqual(4);
    expect(v.summary.length).toBeGreaterThan(0);
    if (v.bySide) {
      for (const s of [v.bySide.left, v.bySide.right]) {
        expect(s.headline.split(" ").filter((w) => w !== "—").length).toBeLessThanOrEqual(4);
      }
    }
  });
});

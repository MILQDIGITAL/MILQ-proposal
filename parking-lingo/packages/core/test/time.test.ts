import { describe, expect, it } from "vitest";
import {
  dayOfWeek,
  formatClock,
  formatDays,
  formatDuration,
  formatInstant,
  fromLocal,
  toLocal,
  tzOffsetMs,
  assertValidTimeZone,
  HOUR,
} from "../src/time";
import { SYD, BNE } from "./helpers";

describe("time utilities", () => {
  it("converts an instant to Sydney wall-clock time (AEDT)", () => {
    const l = toLocal(Date.parse("2026-11-12T23:30:00Z"), SYD);
    expect(l).toMatchObject({ year: 2026, month: 11, day: 13, hour: 10, minute: 30 });
  });

  it("converts local wall-clock to an instant", () => {
    expect(new Date(fromLocal({ year: 2026, month: 11, day: 13 }, 8 * 60, SYD)).toISOString()).toBe(
      "2026-11-12T21:00:00.000Z",
    );
  });

  it("reports offsets either side of the October DST start", () => {
    expect(tzOffsetMs(Date.parse("2026-10-03T12:00:00Z"), SYD)).toBe(10 * HOUR);
    expect(tzOffsetMs(Date.parse("2026-10-04T12:00:00Z"), SYD)).toBe(11 * HOUR);
  });

  it("shifts a non-existent local time (DST gap) forward", () => {
    // 2:30 am on 4 Oct 2026 doesn't exist in Sydney; resolves to 3:30 am AEDT.
    const t = fromLocal({ year: 2026, month: 10, day: 4 }, 150, SYD);
    expect(new Date(t).toISOString()).toBe("2026-10-03T16:30:00.000Z");
    expect(toLocal(t, SYD)).toMatchObject({ hour: 3, minute: 30 });
  });

  it("handles the April DST end", () => {
    const before = fromLocal({ year: 2026, month: 4, day: 5 }, 60, SYD); // 1 am AEDT
    const after = fromLocal({ year: 2026, month: 4, day: 5 }, 6 * 60, SYD); // 6 am AEST
    expect(new Date(before).toISOString()).toBe("2026-04-04T14:00:00.000Z");
    expect(new Date(after).toISOString()).toBe("2026-04-04T20:00:00.000Z");
  });

  it("Brisbane never observes DST", () => {
    expect(tzOffsetMs(Date.parse("2026-01-10T00:00:00Z"), BNE)).toBe(10 * HOUR);
    expect(tzOffsetMs(Date.parse("2026-07-10T00:00:00Z"), BNE)).toBe(10 * HOUR);
  });

  it("computes day of week", () => {
    expect(dayOfWeek({ year: 2026, month: 11, day: 13 })).toBe("fri");
    expect(dayOfWeek({ year: 2026, month: 11, day: 15 })).toBe("sun");
  });

  it("formats 12-hour clock times", () => {
    expect(formatClock(0)).toBe("12:00 am");
    expect(formatClock(12 * 60)).toBe("12:00 pm");
    expect(formatClock(16 * 60)).toBe("4:00 pm");
    expect(formatClock(9 * 60 + 30)).toBe("9:30 am");
    expect(formatClock(1440)).toBe("12:00 am");
  });

  it("formats instants relative to now", () => {
    const now = Date.parse("2026-11-12T10:00:00+11:00"); // Thu
    expect(formatInstant(Date.parse("2026-11-12T16:00:00+11:00"), now, SYD)).toBe("4:00 pm");
    expect(formatInstant(Date.parse("2026-11-13T08:00:00+11:00"), now, SYD)).toBe("8:00 am tomorrow");
    expect(formatInstant(Date.parse("2026-11-16T08:00:00+11:00"), now, SYD)).toBe("8:00 am Mon");
    expect(formatInstant(Date.parse("2026-11-26T08:00:00+11:00"), now, SYD)).toBe("8:00 am Thu 26 Nov");
  });

  it("formats durations", () => {
    expect(formatDuration(15)).toBe("15 min");
    expect(formatDuration(60)).toBe("1 hour");
    expect(formatDuration(120)).toBe("2 hours");
    expect(formatDuration(90)).toBe("1 hr 30 min");
  });

  it("formats day sets", () => {
    expect(formatDays(["mon", "tue", "wed", "thu", "fri"])).toBe("Mon–Fri");
    expect(formatDays(["sat", "sun"])).toBe("Sat, Sun");
    expect(formatDays(["mon", "wed"])).toBe("Mon, Wed");
    expect(formatDays(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).toBe("every day");
  });

  it("rejects an invalid time zone", () => {
    expect(() => assertValidTimeZone("Mars/Olympus")).toThrow(RangeError);
  });
});

import type { ParkingContext, SignPanel } from "../src/index";
import { evaluate } from "../src/index";
import { panel, reading, schedule, WEEKDAYS, ALL_DAYS } from "../src/fixtures";

export const SYD = "Australia/Sydney";
export const MEL = "Australia/Melbourne";
export const BNE = "Australia/Brisbane";
export { panel, reading, schedule, WEEKDAYS, ALL_DAYS };

/** Context with sensible test defaults (holiday known false, Sydney). */
export function ctx(now: string, extra: Partial<ParkingContext> = {}): ParkingContext {
  return { now, timeZone: SYD, isPublicHoliday: false, ...extra };
}

/** Evaluate a list of panels at `now` (Sydney, not a holiday). */
export function ev(panels: SignPanel[], now: string, extra: Partial<ParkingContext> = {}) {
  return evaluate(reading(panels), ctx(now, extra));
}

/** ISO instant (UTC) for a local offset time string. */
export function utc(s: string): string {
  return new Date(s).toISOString();
}

export const twoPMeter = (sched = [schedule(WEEKDAYS, "08:00", "18:00")]) =>
  panel({ kind: "timed_parking", timeLimitMinutes: 120, payment: "meter", schedules: sched, rawText: "2P METER" });

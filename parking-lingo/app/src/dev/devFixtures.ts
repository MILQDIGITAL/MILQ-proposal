/**
 * Extra demo readings for states no core fixture covers yet. Used by tests and, in dev
 * builds only, by `/result?fixture=<id>` (for screenshots/review).
 */
import { panel, reading, schedule, WEEKDAYS, type SignFixture } from "@parking-lingo/core/fixtures";

export const devFixtures: SignFixture[] = [
  {
    id: "dev-temporary-dates-unclear",
    title: "Temporary No Stopping — dates unclear",
    description: "Roadworks sign whose dates were read end-before-start, over a permanent 2P.",
    reading: reading([
      panel({
        kind: "no_stopping",
        temporary: true,
        towAway: true,
        schedules: [schedule(WEEKDAYS, "07:00", "17:00")],
        effectiveDates: { start: "2026-11-20", end: "2026-11-10" },
        rawText: "NO STOPPING / ROAD WORK / 20 NOV - 10 NOV / 7AM-5PM / TOW AWAY",
        confidence: 0.85,
      }),
      panel({ kind: "timed_parking", timeLimitMinutes: 120, schedules: [schedule(WEEKDAYS, "08:00", "18:00")], rawText: "2P / 8am-6pm MON-FRI" }),
    ]),
    demoContext: { now: "2026-11-12T10:00:00+11:00", timeZone: "Australia/Sydney" },
  },
  {
    id: "dev-vehicle-note-unclear",
    title: "1P with tangled vehicle note",
    description: "1P 8am–6pm Mon–Fri, \"Except buses, cars only\".",
    reading: reading([
      panel({
        kind: "timed_parking",
        timeLimitMinutes: 60,
        schedules: [schedule(WEEKDAYS, "08:00", "18:00")],
        vehicleRestriction: "Except buses, cars only",
        rawText: "1P / 8am-6pm MON-FRI / EXCEPT BUSES, CARS ONLY",
      }),
    ]),
    demoContext: { now: "2026-11-12T10:00:00+11:00", timeZone: "Australia/Sydney" },
  },
  {
    id: "dev-jurisdiction-conflict",
    title: "2P read as VIC, phone in Sydney",
    description: "Sign hint AU-VIC but the device time zone is Australia/Sydney.",
    reading: reading(
      [panel({ kind: "timed_parking", timeLimitMinutes: 120, schedules: [schedule(WEEKDAYS, "08:00", "18:00")], rawText: "2P / 8am-6pm MON-FRI" })],
      { jurisdictionHint: "AU-VIC" },
    ),
    demoContext: { now: "2026-11-12T10:00:00+11:00", timeZone: "Australia/Sydney" },
  },
];

export const devFixturesById: Record<string, SignFixture> = Object.fromEntries(devFixtures.map((f) => [f.id, f]));

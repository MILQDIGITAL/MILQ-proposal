/**
 * Realistic SignReading fixtures for common Australian sign setups.
 * Used for the app's demo mode and for server/engine tests.
 *
 * Each fixture carries a `demoContext` (a sensible "now" + zone) so the demo
 * shows an interesting answer regardless of the real date.
 */
import type { DayOfWeek, Schedule, SignPanel, SignReading } from "./schema";
import type { ParkingContext } from "./types";

export const WEEKDAYS: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri"];
export const ALL_DAYS: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** Build a schedule (publicHolidays defaults to 'unspecified'). */
export function schedule(
  days: DayOfWeek[],
  start: string,
  end: string,
  publicHolidays: Schedule["publicHolidays"] = "unspecified",
): Schedule {
  return { days, start, end, publicHolidays };
}

/** Build a panel with conservative defaults; override what you need. */
export function panel(overrides: Partial<SignPanel> & Pick<SignPanel, "kind">): SignPanel {
  return {
    timeLimitMinutes: null,
    payment: "none",
    permitExempt: null,
    vehicleRestriction: null,
    schedules: [],
    arrow: "both",
    temporary: false,
    effectiveDates: null,
    towAway: false,
    rawText: "",
    confidence: 0.95,
    ...overrides,
  };
}

/** Build a reading with sensible defaults. */
export function reading(panels: SignPanel[], overrides: Partial<SignReading> = {}): SignReading {
  return {
    isParkingSign: true,
    panels,
    overallConfidence: 0.95,
    legibilityIssues: [],
    jurisdictionHint: null,
    ...overrides,
  };
}

export interface SignFixture {
  id: string;
  title: string;
  description: string;
  reading: SignReading;
  /** A context that makes the demo interesting (merge with user settings). */
  demoContext: Pick<ParkingContext, "now" | "timeZone"> & Partial<ParkingContext>;
}

const SYD = "Australia/Sydney";
const MEL = "Australia/Melbourne";
const BNE = "Australia/Brisbane";

export const fixtures: SignFixture[] = [
  {
    id: "nsw-2p-meter-weekdays-sat",
    title: "2P Meter (Sydney CBD fringe)",
    description: "2P Meter 8am–6pm Mon–Fri, 8am–12:30pm Sat. Unrestricted otherwise.",
    reading: reading(
      [
        panel({
          kind: "timed_parking",
          timeLimitMinutes: 120,
          payment: "meter",
          schedules: [schedule(WEEKDAYS, "08:00", "18:00"), schedule(["sat"], "08:00", "12:30")],
          rawText: "2P / METER / 8am-6pm MON-FRI / 8am-12.30pm SAT",
        }),
      ],
      { jurisdictionHint: "AU-NSW" },
    ),
    demoContext: { now: "2026-11-12T10:30:00+11:00", timeZone: SYD },
  },
  {
    id: "nsw-clearway-sandwich",
    title: "Clearway / 2P Ticket / Clearway",
    description: "Clearway 6–10am, 2P Ticket 10am–3pm, Clearway 3–7pm, Mon–Fri. Classic arterial road setup.",
    reading: reading(
      [
        panel({
          kind: "clearway",
          schedules: [schedule(WEEKDAYS, "06:00", "10:00")],
          towAway: true,
          rawText: "CLEARWAY / 6am-10am / MON-FRI / TOW AWAY",
        }),
        panel({
          kind: "timed_parking",
          timeLimitMinutes: 120,
          payment: "ticket",
          schedules: [schedule(WEEKDAYS, "10:00", "15:00")],
          rawText: "2P / TICKET / 10am-3pm MON-FRI",
        }),
        panel({
          kind: "clearway",
          schedules: [schedule(WEEKDAYS, "15:00", "19:00")],
          towAway: true,
          rawText: "CLEARWAY / 3pm-7pm / MON-FRI / TOW AWAY",
        }),
      ],
      { jurisdictionHint: "AU-NSW" },
    ),
    demoContext: { now: "2026-11-12T13:30:00+11:00", timeZone: SYD },
  },
  {
    id: "no-stopping-anytime-left",
    title: "No Stopping (arrow left)",
    description: "No Stopping at all times, arrow pointing left.",
    reading: reading([panel({ kind: "no_stopping", arrow: "left", rawText: "NO STOPPING ←" })]),
    demoContext: { now: "2026-11-12T09:00:00+11:00", timeZone: SYD },
  },
  {
    id: "school-no-parking",
    title: "No Parking (school zone pick-up/drop-off)",
    description: "No Parking 8–9:30am and 2:30–4pm on school days (Mon–Fri).",
    reading: reading([
      panel({
        kind: "no_parking",
        schedules: [schedule(WEEKDAYS, "08:00", "09:30"), schedule(WEEKDAYS, "14:30", "16:00")],
        rawText: "NO PARKING / 8-9.30am / 2.30-4pm / SCHOOL DAYS",
        vehicleRestriction: null,
      }),
    ]),
    demoContext: { now: "2026-11-12T15:00:00+11:00", timeZone: SYD },
  },
  {
    id: "loading-zone-with-evening-1p",
    title: "Loading Zone + 1P evenings",
    description: "Loading Zone 30 min 6am–6pm Mon–Sat, then 1P 6pm–10pm every day.",
    reading: reading([
      panel({
        kind: "loading_zone",
        timeLimitMinutes: 30,
        schedules: [schedule(["mon", "tue", "wed", "thu", "fri", "sat"], "06:00", "18:00")],
        rawText: "LOADING ZONE / 30 MIN / 6am-6pm MON-SAT",
      }),
      panel({
        kind: "timed_parking",
        timeLimitMinutes: 60,
        schedules: [schedule(ALL_DAYS, "18:00", "22:00")],
        rawText: "1P / 6pm-10pm",
      }),
    ]),
    demoContext: { now: "2026-11-12T11:00:00+11:00", timeZone: SYD },
  },
  {
    id: "vic-permit-zone-area-12",
    title: "2P Permit holders excepted (Melbourne)",
    description: "2P 8am–6pm Mon–Sat, permit holders excepted Area 12.",
    reading: reading(
      [
        panel({
          kind: "timed_parking",
          timeLimitMinutes: 120,
          schedules: [schedule(["mon", "tue", "wed", "thu", "fri", "sat"], "08:00", "18:00")],
          permitExempt: { areaCode: "12" },
          rawText: "2P / 8.00am-6.00pm / MON-SAT / PERMIT HOLDERS EXCEPTED / AREA 12",
        }),
      ],
      { jurisdictionHint: "AU-VIC" },
    ),
    demoContext: { now: "2026-11-12T09:00:00+11:00", timeZone: MEL, permits: ["12"] },
  },
  {
    id: "bus-zone-peaks",
    title: "Bus Zone (peaks) + 1P",
    description: "Bus Zone 7–9am & 4–6pm Mon–Fri; 1P 9am–4pm Mon–Fri.",
    reading: reading([
      panel({
        kind: "bus_zone",
        schedules: [schedule(WEEKDAYS, "07:00", "09:00"), schedule(WEEKDAYS, "16:00", "18:00")],
        rawText: "BUS ZONE / 7-9am 4-6pm / MON-FRI",
      }),
      panel({
        kind: "timed_parking",
        timeLimitMinutes: 60,
        schedules: [schedule(WEEKDAYS, "09:00", "16:00")],
        rawText: "1P / 9am-4pm MON-FRI",
      }),
    ]),
    demoContext: { now: "2026-11-12T15:15:00+11:00", timeZone: SYD },
  },
  {
    id: "night-taxi-zone",
    title: "1P days, Taxi Zone overnight",
    description: "1P 8am–6pm every day; Taxi Zone 10pm–6am every night.",
    reading: reading([
      panel({
        kind: "timed_parking",
        timeLimitMinutes: 60,
        schedules: [schedule(ALL_DAYS, "08:00", "18:00")],
        rawText: "1P / 8am-6pm",
      }),
      panel({
        kind: "taxi_zone",
        schedules: [schedule(ALL_DAYS, "22:00", "06:00")],
        rawText: "TAXI ZONE / 10pm-6am",
      }),
    ]),
    demoContext: { now: "2026-11-12T20:00:00+11:00", timeZone: SYD },
  },
  {
    id: "disabled-only-right",
    title: "Disability parking (arrow right)",
    description: "Disability permit parking at all times, arrow right; 2P left.",
    reading: reading([
      panel({
        kind: "disabled_only",
        arrow: "right",
        rawText: "P [wheelchair symbol] / DISABILITY PERMIT ONLY →",
      }),
      panel({
        kind: "timed_parking",
        timeLimitMinutes: 120,
        arrow: "left",
        schedules: [schedule(WEEKDAYS, "08:30", "18:00")],
        rawText: "← 2P / 8.30am-6pm MON-FRI",
      }),
    ]),
    demoContext: { now: "2026-11-12T12:00:00+11:00", timeZone: SYD },
  },
  {
    id: "split-sides-no-stopping-1p",
    title: "No Stopping left / 1P right",
    description: "No Stopping to the left of the pole, 1P 9am–5:30pm Mon–Fri to the right.",
    reading: reading([
      panel({ kind: "no_stopping", arrow: "left", rawText: "← NO STOPPING" }),
      panel({
        kind: "timed_parking",
        timeLimitMinutes: 60,
        arrow: "right",
        schedules: [schedule(WEEKDAYS, "09:00", "17:30")],
        rawText: "1P → / 9am-5.30pm MON-FRI",
      }),
    ]),
    demoContext: { now: "2026-11-12T11:00:00+11:00", timeZone: SYD },
  },
  {
    id: "temporary-roadworks-no-stopping",
    title: "Temporary No Stopping — road work",
    description: "Yellow sign: No Stopping, road work, Mon 16 Nov 7am–5pm, over a permanent 2P.",
    reading: reading([
      panel({
        kind: "no_stopping",
        temporary: true,
        towAway: true,
        schedules: [schedule(["mon"], "07:00", "17:00")],
        effectiveDates: { start: "2026-11-16", end: "2026-11-16" },
        rawText: "NO STOPPING / ROAD WORK / MON 16 NOV / 7AM - 5PM / TOW AWAY",
        confidence: 0.9,
      }),
      panel({
        kind: "timed_parking",
        timeLimitMinutes: 120,
        schedules: [schedule(WEEKDAYS, "08:00", "18:00")],
        rawText: "2P / 8am-6pm MON-FRI",
      }),
    ], { overallConfidence: 0.9 }),
    demoContext: { now: "2026-11-16T09:00:00+11:00", timeZone: SYD },
  },
  {
    id: "temporary-event-clearway",
    title: "Temporary Clearway — special event",
    description: "Temporary clearway Sat 21 Nov 2026 6am–8pm (marathon), over a permanent 4P.",
    reading: reading([
      panel({
        kind: "clearway",
        temporary: true,
        towAway: true,
        schedules: [],
        effectiveDates: { start: "2026-11-21T06:00", end: "2026-11-21T20:00" },
        rawText: "TEMPORARY CLEARWAY / SAT 21 NOV / 6AM - 8PM / SPECIAL EVENT / TOW AWAY",
        confidence: 0.92,
      }),
      panel({
        kind: "timed_parking",
        timeLimitMinutes: 240,
        schedules: [schedule(ALL_DAYS, "08:00", "20:00")],
        rawText: "4P / 8am-8pm",
      }),
    ], { overallConfidence: 0.92 }),
    demoContext: { now: "2026-11-20T18:00:00+11:00", timeZone: SYD },
  },
  {
    id: "temporary-works-zone-undated",
    title: "Temporary Works Zone (dates unreadable)",
    description: "Orange temporary works zone sign whose handwritten dates are illegible.",
    reading: reading(
      [
        panel({
          kind: "works_zone",
          temporary: true,
          schedules: [schedule(WEEKDAYS, "07:00", "17:00")],
          effectiveDates: null,
          rawText: "WORKS ZONE / 7am-5pm MON-FRI / [handwritten dates illegible]",
          confidence: 0.82,
        }),
        panel({
          kind: "timed_parking",
          timeLimitMinutes: 60,
          payment: "meter",
          schedules: [schedule(WEEKDAYS, "08:00", "18:00")],
          rawText: "1P / METER / 8am-6pm MON-FRI",
        }),
      ],
      { overallConfidence: 0.85, legibilityIssues: ["Handwritten dates on temporary sign unreadable"] },
    ),
    demoContext: { now: "2026-11-12T16:00:00+11:00", timeZone: SYD },
  },
  {
    id: "qld-quarter-p-and-p",
    title: "1/4P weekdays (Brisbane)",
    description: "1/4P 7am–6pm Mon–Fri; plain P (unrestricted) other times.",
    reading: reading(
      [
        panel({
          kind: "timed_parking",
          timeLimitMinutes: 15,
          schedules: [schedule(WEEKDAYS, "07:00", "18:00")],
          rawText: "1/4 P / 7am-6pm MON-FRI",
        }),
      ],
      { jurisdictionHint: "AU-QLD" },
    ),
    demoContext: { now: "2026-11-12T17:50:00+10:00", timeZone: BNE },
  },
  {
    id: "ev-charging-2p",
    title: "EV charging bay 2P",
    description: "Electric vehicle charging only, 2P, at all times.",
    reading: reading([
      panel({
        kind: "ev_charging",
        timeLimitMinutes: 120,
        rawText: "2P / ELECTRIC VEHICLES ONLY / WHILE CHARGING",
      }),
    ]),
    demoContext: { now: "2026-11-12T12:00:00+11:00", timeZone: SYD, isElectricVehicle: true },
  },
  {
    id: "sunday-and-holidays-no-parking",
    title: "No Parking Sun & public holidays (market)",
    description: "No Parking 6am–2pm Sun & public holidays (street market); 2P 8am–6pm Mon–Sat.",
    reading: reading([
      panel({
        kind: "no_parking",
        schedules: [schedule(["sun"], "06:00", "14:00", "included")],
        rawText: "NO PARKING / 6am-2pm / SUN & PUBLIC HOLIDAYS",
      }),
      panel({
        kind: "timed_parking",
        timeLimitMinutes: 120,
        schedules: [schedule(["mon", "tue", "wed", "thu", "fri", "sat"], "08:00", "18:00")],
        rawText: "2P / 8am-6pm MON-SAT",
      }),
    ]),
    demoContext: { now: "2026-11-15T09:00:00+11:00", timeZone: SYD },
  },
  {
    id: "blurry-low-confidence",
    title: "Blurry photo",
    description: "Low-confidence reading from a blurry, glare-affected photo.",
    reading: reading(
      [
        panel({
          kind: "timed_parking",
          timeLimitMinutes: 120,
          schedules: [schedule(WEEKDAYS, "08:00", "18:00")],
          rawText: "2P / 8?-6? / MON-F?",
          confidence: 0.35,
        }),
      ],
      { overallConfidence: 0.4, legibilityIssues: ["Motion blur", "Sun glare across lower half"] },
    ),
    demoContext: { now: "2026-11-12T12:00:00+11:00", timeZone: SYD },
  },
  {
    id: "not-a-parking-sign",
    title: "Not a parking sign",
    description: "A 50 km/h speed limit sign.",
    reading: reading([], {
      isParkingSign: false,
      overallConfidence: 0.97,
      legibilityIssues: [],
    }),
    demoContext: { now: "2026-11-12T12:00:00+11:00", timeZone: SYD },
  },
];

export const fixturesById: Record<string, SignFixture> = Object.fromEntries(fixtures.map((f) => [f.id, f]));

export function getFixture(id: string): SignFixture {
  const f = fixturesById[id];
  if (!f) throw new Error(`Unknown fixture: ${id}`);
  return f;
}

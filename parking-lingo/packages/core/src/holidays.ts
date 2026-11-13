/**
 * Best-effort Australian public holiday calendar, computed by rule for any year.
 *
 * Scope and caveats (also in the README):
 *  - Only state/territory-wide holidays are `statewide`. Holidays that apply to
 *    part of a state (Melbourne Cup Day — metropolitan Melbourne only) are
 *    `partial`, and `isPublicHolidayOn` reports them as "unknown" so the engine
 *    stays conservative.
 *  - Regional/local holidays (show days, Royal Hobart Regatta, the Ekka in
 *    Brisbane, council-substituted days) can't be known and are not listed.
 *  - Days proclaimed ad hoc (e.g. AFL Grand Final Friday in VIC, the WA King's
 *    Birthday, national days of mourning) are not listed.
 *  - Part-day holidays (Christmas Eve / New Year's Eve from 7 pm in SA and NT)
 *    are not listed.
 *  - Where a rule is uncertain we leave the day OUT. For parking that is the
 *    conservative direction: "not a holiday" means signed restrictions apply.
 */
import { addDays, dateKey, dayOfWeek, type LocalDate } from "./time";

export const AUSTRALIAN_JURISDICTIONS = [
  "AU-NSW",
  "AU-VIC",
  "AU-QLD",
  "AU-SA",
  "AU-WA",
  "AU-TAS",
  "AU-NT",
  "AU-ACT",
] as const;
export type AustralianJurisdiction = (typeof AUSTRALIAN_JURISDICTIONS)[number];

export interface PublicHoliday {
  /** Local date 'YYYY-MM-DD'. */
  date: string;
  name: string;
  /** 'partial' = only part of the jurisdiction observes it (e.g. metro Melbourne). */
  scope: "statewide" | "partial";
  /** True for an additional/substitute day given because the holiday fell on a weekend. */
  substitute: boolean;
}

/**
 * Normalise "AU-NSW", "nsw", "NSW", "New South Wales", "AU_NSW" → "AU-NSW".
 * Returns null for anything not recognised as an Australian state/territory.
 */
export function normaliseJurisdiction(input: string | null | undefined): AustralianJurisdiction | null {
  if (!input) return null;
  const s = input.trim().toUpperCase().replace(/[\s_.]+/g, "-");
  const code = s.replace(/^AU-?/, "").replace(/^AUSTRALIA-?/, "");
  const names: Record<string, AustralianJurisdiction> = {
    NSW: "AU-NSW",
    "NEW-SOUTH-WALES": "AU-NSW",
    VIC: "AU-VIC",
    VICTORIA: "AU-VIC",
    QLD: "AU-QLD",
    QUEENSLAND: "AU-QLD",
    SA: "AU-SA",
    "SOUTH-AUSTRALIA": "AU-SA",
    WA: "AU-WA",
    "WESTERN-AUSTRALIA": "AU-WA",
    TAS: "AU-TAS",
    TASMANIA: "AU-TAS",
    NT: "AU-NT",
    "NORTHERN-TERRITORY": "AU-NT",
    ACT: "AU-ACT",
    "AUSTRALIAN-CAPITAL-TERRITORY": "AU-ACT",
  };
  return names[code] ?? null;
}

/**
 * Jurisdiction implied by an IANA zone, only where the mapping is unambiguous
 * enough to be safe. "Australia/Sydney" maps to NSW: the ACT shares the zone,
 * but every NSW-wide holiday is also an ACT holiday, so the guess can only
 * miss holidays (conservative), never invent them.
 */
export function jurisdictionFromTimeZone(timeZone: string): AustralianJurisdiction | null {
  const map: Record<string, AustralianJurisdiction> = {
    "Australia/Sydney": "AU-NSW",
    "Australia/NSW": "AU-NSW",
    "Australia/ACT": "AU-ACT",
    "Australia/Canberra": "AU-ACT",
    "Australia/Melbourne": "AU-VIC",
    "Australia/Victoria": "AU-VIC",
    "Australia/Brisbane": "AU-QLD",
    "Australia/Queensland": "AU-QLD",
    "Australia/Adelaide": "AU-SA",
    "Australia/South": "AU-SA",
    "Australia/Perth": "AU-WA",
    "Australia/West": "AU-WA",
    "Australia/Hobart": "AU-TAS",
    "Australia/Tasmania": "AU-TAS",
    "Australia/Darwin": "AU-NT",
    "Australia/North": "AU-NT",
  };
  return map[timeZone] ?? null;
}

/** Easter Sunday (Gregorian, anonymous algorithm). */
export function easterSunday(year: number): LocalDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

const DOW_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 } as const;

function dowIndex(d: LocalDate): number {
  return DOW_INDEX[dayOfWeek(d)];
}

/** nth (1-based) given weekday of a month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): LocalDate {
  const first: LocalDate = { year, month, day: 1 };
  const offset = (weekday - dowIndex(first) + 7) % 7;
  return addDays(first, offset + 7 * (n - 1));
}

/** First given weekday on or after a date. */
function onOrAfter(d: LocalDate, weekday: number): LocalDate {
  return addDays(d, (weekday - dowIndex(d) + 7) % 7);
}

const MON = 1;
const TUE = 2;

/**
 * All public holidays for a jurisdiction and year, sorted by date. Includes
 * substitute/additional days for holidays falling on weekends where the rule
 * is well established. See the module comment for what is left out.
 */
export function australianPublicHolidays(year: number, jurisdiction: string): PublicHoliday[] {
  const j = normaliseJurisdiction(jurisdiction);
  if (!j) return [];
  const out: PublicHoliday[] = [];
  const add = (d: LocalDate, name: string, substitute = false, scope: PublicHoliday["scope"] = "statewide") =>
    out.push({ date: dateKey(d), name, scope, substitute });

  /** Holiday on a fixed date; if it falls on Sat/Sun the following Monday is added. */
  const fixedWithMondaySub = (month: number, day: number, name: string) => {
    const d = { year, month, day };
    add(d, name);
    const w = dowIndex(d);
    if (w === 6) add(addDays(d, 2), `${name} (additional day)`, true);
    if (w === 0) add(addDays(d, 1), `${name} (additional day)`, true);
  };

  // New Year's Day and Australia Day: following Monday if on a weekend (all states/territories).
  fixedWithMondaySub(1, 1, "New Year's Day");
  fixedWithMondaySub(1, 26, "Australia Day");

  // Easter.
  const easter = easterSunday(year);
  add(addDays(easter, -2), "Good Friday");
  if (["AU-NSW", "AU-VIC", "AU-QLD", "AU-SA", "AU-NT", "AU-ACT"].includes(j)) add(addDays(easter, -1), "Easter Saturday");
  // Easter Sunday is a gazetted holiday in these; SA/NT/TAS left out (unsure — see README).
  if (["AU-NSW", "AU-VIC", "AU-QLD", "AU-WA", "AU-ACT"].includes(j)) add(easter, "Easter Sunday");
  add(addDays(easter, 1), "Easter Monday");

  // Anzac Day: 25 April everywhere. Only WA's weekend substitute (following Monday) is
  // included; other states' Sunday rules vary and are left out (conservative).
  const anzac = { year, month: 4, day: 25 };
  add(anzac, "Anzac Day");
  if (j === "AU-WA" && (dowIndex(anzac) === 6 || dowIndex(anzac) === 0)) {
    add(onOrAfter(anzac, MON), "Anzac Day (additional day)", true);
  }

  // Christmas Day / Boxing Day with the standard weekend substitutes.
  const xmas = { year, month: 12, day: 25 };
  const boxing = { year, month: 12, day: 26 };
  add(xmas, "Christmas Day");
  add(boxing, j === "AU-SA" ? "Proclamation Day" : "Boxing Day");
  const xw = dowIndex(xmas);
  if (xw === 5) add(addDays(boxing, 2), "Boxing Day (additional day)", true); // Fri/Sat -> Mon 28
  if (xw === 6) {
    add(addDays(xmas, 2), "Christmas Day (additional day)", true); // Mon 27
    add(addDays(xmas, 3), "Boxing Day (additional day)", true); // Tue 28
  }
  if (xw === 0) add(addDays(xmas, 2), "Christmas Day (additional day)", true); // Boxing Mon 26, Tue 27

  // Labour Day / Eight Hours Day / May Day.
  switch (j) {
    case "AU-NSW":
    case "AU-ACT":
    case "AU-SA":
      add(nthWeekday(year, 10, MON, 1), "Labour Day");
      break;
    case "AU-VIC":
      add(nthWeekday(year, 3, MON, 2), "Labour Day");
      break;
    case "AU-TAS":
      add(nthWeekday(year, 3, MON, 2), "Eight Hours Day");
      break;
    case "AU-WA":
      add(nthWeekday(year, 3, MON, 1), "Labour Day");
      break;
    case "AU-QLD":
      add(nthWeekday(year, 5, MON, 1), "Labour Day");
      break;
    case "AU-NT":
      add(nthWeekday(year, 5, MON, 1), "May Day");
      break;
  }

  // King's Birthday: 2nd Monday in June, except QLD (1st Monday in October).
  // WA's date is proclaimed each year (usually late Sept) — left out.
  if (j === "AU-QLD") add(nthWeekday(year, 10, MON, 1), "King's Birthday");
  else if (j !== "AU-WA") add(nthWeekday(year, 6, MON, 2), "King's Birthday");

  // State/territory-specific.
  switch (j) {
    case "AU-VIC":
      add(nthWeekday(year, 11, TUE, 1), "Melbourne Cup Day", false, "partial");
      break;
    case "AU-SA":
      add(nthWeekday(year, 3, MON, 2), "Adelaide Cup Day");
      break;
    case "AU-WA":
      add(nthWeekday(year, 6, MON, 1), "Western Australia Day");
      break;
    case "AU-NT":
      add(nthWeekday(year, 8, MON, 1), "Picnic Day");
      break;
    case "AU-ACT":
      add(nthWeekday(year, 3, MON, 2), "Canberra Day");
      if (year >= 2018) add(onOrAfter({ year, month: 5, day: 27 }, MON), "Reconciliation Day");
      break;
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

const cache = new Map<string, Map<string, PublicHoliday[]>>();

function holidaysByDate(year: number, j: AustralianJurisdiction): Map<string, PublicHoliday[]> {
  const key = `${j}|${year}`;
  let m = cache.get(key);
  if (!m) {
    m = new Map();
    for (const h of australianPublicHolidays(year, j)) {
      const list = m.get(h.date) ?? [];
      list.push(h);
      m.set(h.date, list);
    }
    cache.set(key, m);
  }
  return m;
}

/** Holidays (possibly several) on a local date, or [] if none. */
export function publicHolidaysOn(date: LocalDate | string, jurisdiction: string): PublicHoliday[] {
  const j = normaliseJurisdiction(jurisdiction);
  if (!j) return [];
  const d = typeof date === "string" ? parseDate(date) : date;
  return holidaysByDate(d.year, j).get(dateKey(d)) ?? [];
}

/**
 * Is this local date a public holiday in the jurisdiction?
 *  - true: a statewide public holiday
 *  - false: not a statewide holiday as far as this calendar knows (regional
 *    holidays can't be known)
 *  - "unknown": jurisdiction not recognised, or the holiday only applies to
 *    part of the jurisdiction (e.g. Melbourne Cup Day)
 */
export function isPublicHolidayOn(date: LocalDate | string, jurisdiction: string | null | undefined): boolean | "unknown" {
  const j = normaliseJurisdiction(jurisdiction);
  if (!j) return "unknown";
  const list = publicHolidaysOn(date, j);
  if (list.length === 0) return false;
  return list.some((h) => h.scope === "statewide") ? true : "unknown";
}

function parseDate(s: string): LocalDate {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) throw new RangeError(`Invalid date: ${s}`);
  return { year: y, month: m, day: d };
}

/**
 * Timezone-correct time helpers built only on Intl (no date libraries).
 * All instants are epoch milliseconds; all "local" values are wall-clock
 * values in an IANA time zone.
 */
import type { DayOfWeek } from "./schema";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export interface LocalDateTime extends LocalDate {
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** Throws a RangeError if the zone is not a valid IANA zone. */
export function assertValidTimeZone(timeZone: string): void {
  formatter(timeZone);
}

export function toLocal(ms: number, timeZone: string): LocalDateTime {
  const parts = formatter(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  let hour = get("hour");
  if (hour === 24) hour = 0; // some engines emit 24 for midnight
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of the zone from UTC at the instant, in ms (e.g. +10h => 36_000_000). */
export function tzOffsetMs(ms: number, timeZone: string): number {
  const base = Math.floor(ms / 1000) * 1000;
  const l = toLocal(base, timeZone);
  return Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second) - base;
}

/**
 * Instant for a local wall-clock time. `minutesOfDay` may be >= 1440 (rolls
 * into following days). Non-existent times (DST gap) resolve to the instant
 * shifted forward by the gap; ambiguous times (DST overlap) resolve to one of
 * the two occurrences.
 */
export function fromLocal(date: LocalDate, minutesOfDay: number, timeZone: string): number {
  const guess = Date.UTC(date.year, date.month - 1, date.day, 0, minutesOfDay);
  const off1 = tzOffsetMs(guess, timeZone);
  const t1 = guess - off1;
  const off2 = tzOffsetMs(t1, timeZone);
  if (off2 === off1) return t1;
  return guess - off2;
}

export function localDateOf(ms: number, timeZone: string): LocalDate {
  const l = toLocal(ms, timeZone);
  return { year: l.year, month: l.month, day: l.day };
}

export function addDays(d: LocalDate, n: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day);
}

export function dateKey(d: LocalDate): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

const DOW_BY_UTC_DAY: DayOfWeek[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function dayOfWeek(d: LocalDate): DayOfWeek {
  return DOW_BY_UTC_DAY[new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()]!;
}

/** "HH:mm" -> minutes since midnight ("24:00" -> 1440). */
export function parseTimeOfDay(s: string): number {
  const [h, m] = s.split(":");
  return Number(h) * 60 + Number(m);
}

/** Parse 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'. */
export function parseLocalDateTime(s: string): { date: LocalDate; minutes: number | null } {
  const [datePart, timePart] = s.split("T");
  const [y, mo, d] = (datePart ?? "").split("-").map(Number);
  return {
    date: { year: y ?? 0, month: mo ?? 1, day: d ?? 1 },
    minutes: timePart ? parseTimeOfDay(timePart) : null,
  };
}

export function toInstant(value: Date | string | number): number {
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) throw new RangeError(`Invalid instant: ${String(value)}`);
  return ms;
}

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Formatting (user-facing, plain English, 12-hour clock)
// ---------------------------------------------------------------------------

export function formatClock(minutesOfDay: number): string {
  const m = ((minutesOfDay % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const min = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${h24 < 12 ? "am" : "pm"}`;
}

const DOW_LABEL: Record<DayOfWeek, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(d: LocalDate): string {
  return `${DOW_LABEL[dayOfWeek(d)]} ${d.day} ${MONTHS[d.month - 1]}`;
}

/** "4:00 pm", "8:00 am tomorrow", "8:00 am Mon", "8:00 am Thu 26 Nov". */
export function formatInstant(ms: number, nowMs: number, timeZone: string): string {
  const l = toLocal(ms, timeZone);
  const clock = formatClock(l.hour * 60 + l.minute);
  const today = localDateOf(nowMs, timeZone);
  const date: LocalDate = { year: l.year, month: l.month, day: l.day };
  const diffDays = Math.round(compareDates(date, today) / DAY);
  if (diffDays === 0) return clock;
  if (diffDays === 1) return `${clock} tomorrow`;
  if (diffDays > 1 && diffDays < 7) return `${clock} ${DOW_LABEL[dayOfWeek(date)]}`;
  return `${clock} ${formatDate(date)}`;
}

/** "2 hours", "1 hour", "15 min", "1 hr 30 min", "3 days". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  if (m >= 48 * 60 && m % (24 * 60) === 0) return `${m / (24 * 60)} days`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (rem === 0) return h === 1 ? "1 hour" : `${h} hours`;
  return `${h} hr ${rem} min`;
}

/** Compact duration for headlines: "2 hrs", "15 min", "1h 30m". */
export function formatShortDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (rem === 0) return h === 1 ? "1 hr" : `${h} hrs`;
  return `${h}h ${rem}m`;
}

const DAY_ORDER: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** ["mon".."fri"] -> "Mon–Fri"; all -> "every day"; ["mon","wed"] -> "Mon, Wed". */
export function formatDays(days: readonly DayOfWeek[]): string {
  const set = new Set(days);
  if (set.size === 7) return "every day";
  const idx = DAY_ORDER.map((d, i) => (set.has(d) ? i : -1)).filter((i) => i >= 0);
  const runs: string[] = [];
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j]! + 1) j++;
    const a = DOW_LABEL[DAY_ORDER[idx[i]!]!];
    const b = DOW_LABEL[DAY_ORDER[idx[j]!]!];
    if (j === i) runs.push(a);
    else if (j === i + 1) runs.push(`${a}, ${b}`);
    else runs.push(`${a}–${b}`);
    i = j + 1;
  }
  return runs.join(", ");
}

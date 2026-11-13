/**
 * Deterministic rules engine: SignReading + ParkingContext -> Verdict.
 *
 * Model:
 *  1. Each panel that applies to the chosen side is expanded into the instants
 *     it is in force (schedules x days x effective dates x public holidays),
 *     using the injected IANA time zone (DST-correct, via Intl).
 *  2. Each panel has a static "effect" for this driver (e.g. a loading zone is
 *     no-stopping for a car but limited parking for a commercial vehicle).
 *  3. The timeline is swept; at every instant the MOST RESTRICTIVE active
 *     effect wins (no stopping > no parking > limited > free). Temporary panels
 *     participate the same way, so a temporary prohibition overrides permanent
 *     parking, but a temporary sign can never make things *more* permissive
 *     than a permanent prohibition (conservative).
 *  4. Walking forward from `now` gives leaveBy / maxStay / nextAllowedAt.
 *
 * Conservative principles: never 'yes' on low confidence, unknown panel kinds,
 * contradictory panels or missing side info; unknown public-holiday status is
 * treated as "restrictions apply".
 */
import { describePanel, KIND_LABEL, limitLabel, PAYMENT_INSTRUCTION, PAYMENT_LABEL, panelLabel } from "./describe";
import type { PanelKind, PaymentMethod, Schedule, SignPanel, SignReading, VehicleClass } from "./schema";
import { SignReadingSchema } from "./schema";
import {
  type AustralianJurisdiction,
  isPublicHolidayOn,
  jurisdictionFromTimeZone,
  normaliseJurisdiction,
  publicHolidaysOn,
} from "./holidays";
import {
  addDays,
  assertValidTimeZone,
  DAY,
  dateKey,
  dayOfWeek,
  formatDuration,
  formatInstant,
  formatShortDuration,
  fromLocal,
  HOUR,
  iso,
  type LocalDate,
  localDateOf,
  MINUTE,
  parseLocalDateTime,
  parseTimeOfDay,
  compareDates,
  toInstant,
  toLocal,
  formatClock,
  formatDate,
} from "./time";
import type {
  EvaluateOptions,
  PanelEvidence,
  ParkingContext,
  Side,
  SideVerdict,
  TimelineSegment,
  TimelineStatus,
  UpcomingRestriction,
  Verdict,
  VehicleType,
} from "./types";

export const DEFAULT_MIN_CONFIDENCE_FOR_YES = 0.75;
export const DEFAULT_MIN_CONFIDENCE = 0.5;

/** How far ahead leaveBy / nextAllowedAt are searched. */
const LOOKAHEAD_MS = 8 * DAY;
const TIMELINE_MS = 24 * HOUR;
/** A prohibition starting sooner than this makes the answer "no". */
const IMMINENT_MS = 5 * MINUTE;
/** How far ahead dated temporary signs are reported in `upcomingTemporary`. */
const TEMP_LOOKAHEAD_MS = 120 * DAY;

// ---------------------------------------------------------------------------
// Context normalisation
// ---------------------------------------------------------------------------

interface Ctx {
  nowMs: number;
  tz: string;
  todayKey: string;
  holidayToday: boolean | "unknown";
  holidayDates: Set<string>;
  permits: string[];
  hasDisabilityPermit: boolean;
  vehicleType: VehicleType;
  isElectricVehicle: boolean;
  intendedStayMinutes: number | null;
  /** Resolved jurisdiction used for the holiday calendar (null = unknown). */
  jurisdiction: AustralianJurisdiction | null;
  /** When set, holiday statuses that would be 'unknown' are treated as this (used to test sensitivity). */
  unknownAs: boolean | null;
}

/**
 * Jurisdiction for the holiday calendar: context.jurisdiction, else the
 * reading's jurisdictionHint, else inferred from the time zone (where safe).
 */
export function resolveJurisdiction(
  context: Pick<ParkingContext, "jurisdiction" | "timeZone">,
  reading?: Pick<SignReading, "jurisdictionHint"> | null,
): AustralianJurisdiction | null {
  return (
    normaliseJurisdiction(context.jurisdiction) ??
    normaliseJurisdiction(reading?.jurisdictionHint) ??
    jurisdictionFromTimeZone(context.timeZone)
  );
}

function normaliseContext(c: ParkingContext, reading: SignReading | null): Ctx {
  const nowMs = toInstant(c.now);
  assertValidTimeZone(c.timeZone);
  return {
    nowMs,
    tz: c.timeZone,
    todayKey: dateKey(localDateOf(nowMs, c.timeZone)),
    holidayToday: c.isPublicHoliday ?? "unknown",
    jurisdiction: resolveJurisdiction(c, reading),
    unknownAs: null,
    holidayDates: new Set(c.publicHolidayDates ?? []),
    permits: [...new Set((c.permits ?? []).flatMap(permitTokens))],
    hasDisabilityPermit: c.hasDisabilityPermit ?? false,
    vehicleType: c.vehicleType ?? "car",
    isElectricVehicle: c.isElectricVehicle ?? false,
    intendedStayMinutes: c.intendedStayMinutes ?? null,
  };
}

const PERMIT_FILLER = new Set([
  "AREA",
  "AREAS",
  "ZONE",
  "ZONES",
  "PERMIT",
  "PERMITS",
  "PRECINCT",
  "PRECINCTS",
  "RESIDENT",
  "RESIDENTS",
  "RESIDENTIAL",
  "HOLDER",
  "HOLDERS",
  "PARKING",
  "SCHEME",
  "AND",
  "OR",
  "NO",
  "NUMBER",
  "EXCEPTED",
  "ONLY",
]);

/**
 * Permit area codes in a string: "Area 1/2" -> ["1","2"], "Areas 1-3" -> ["1","2","3"],
 * "Permit Area S" -> ["S"], "Area 012" -> ["12"], "zone 5a" -> ["5A"].
 */
export function permitTokens(code: string): string[] {
  const up = code.toUpperCase();
  const out: string[] = [];
  const norm = (t: string) => t.replace(/^(AREA|ZONE|PERMIT|PRECINCT)(?=[0-9])/, "").replace(/^0+(?=[0-9A-Z])/, "");
  // Expand small numeric ranges "1-3" first.
  const withRanges = up.replace(/\b(\d{1,3})\s*[-–]\s*(\d{1,3})\b/g, (m, a: string, b: string) => {
    const x = Number(a);
    const y = Number(b);
    if (y > x && y - x <= 20) return Array.from({ length: y - x + 1 }, (_, i) => String(x + i)).join(" ");
    return m;
  });
  for (const raw of withRanges.split(/[^A-Z0-9]+/)) {
    if (!raw || PERMIT_FILLER.has(raw)) continue;
    const t = norm(raw);
    if (t && !PERMIT_FILLER.has(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Normalised permit code(s), comma-joined when several: "Area 05" -> "5", "Area 1 & 2" -> "1,2". */
export function normalisePermit(code: string): string {
  return permitTokens(code).join(",");
}

function rawHolidayStatus(d: LocalDate, ctx: Ctx): boolean | "unknown" {
  const key = dateKey(d);
  if (ctx.holidayDates.has(key)) return true;
  if (key === ctx.todayKey && typeof ctx.holidayToday === "boolean") return ctx.holidayToday;
  if (ctx.jurisdiction) return isPublicHolidayOn(d, ctx.jurisdiction);
  // No calendar: unknown for every day (the restrictive reading is used).
  return "unknown";
}

function holidayStatus(d: LocalDate, ctx: Ctx): boolean | "unknown" {
  const s = rawHolidayStatus(d, ctx);
  return s === "unknown" && ctx.unknownAs != null ? ctx.unknownAs : s;
}

// ---------------------------------------------------------------------------
// Panel -> intervals in force
// ---------------------------------------------------------------------------

interface Interval {
  start: number;
  end: number;
}

type HolidayNoteKind = "unknown_sensitive" | "excluded" | "included" | "kept";

interface HolidayNote {
  kind: HolidayNoteKind;
  panelIndex: number;
  date: LocalDate;
  interval: Interval;
}

const PROHIBITIVE_KINDS: ReadonlySet<PanelKind> = new Set([
  "no_stopping",
  "clearway",
  "bus_lane",
  "transit_lane",
  "special_event",
]);

/** Kinds where "permit holders excepted" can exempt you. Never prohibitive kinds. */
const PERMIT_EXEMPTABLE_KINDS: ReadonlySet<PanelKind> = new Set(["timed_parking", "no_parking", "permit_zone"]);

interface EffectiveWindow {
  start: number; // -Infinity if open
  end: number; // +Infinity if open
  dated: boolean;
  /** Date-only end: windows starting on or before this date run to their natural end. */
  endDateOnly: LocalDate | null;
  /**
   * The dates can't be trusted: invalid calendar date, end before start, or a
   * range that would be in force now if one endpoint's year were off by one.
   */
  doubtful: string | null;
}

const MAX_TEMP_RANGE_MS = 120 * DAY;

function isValidDate(d: LocalDate): boolean {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day));
  return t.getUTCFullYear() === d.year && t.getUTCMonth() === d.month - 1 && t.getUTCDate() === d.day;
}

function shiftYear(d: LocalDate, n: number): LocalDate {
  return { year: d.year + n, month: d.month, day: d.month === 2 && d.day === 29 ? 28 : d.day };
}

function effectiveWindow(p: SignPanel, tz: string, nowMs?: number): EffectiveWindow {
  const ed = p.effectiveDates;
  const dated = Boolean(ed?.start || ed?.end);
  const s = ed?.start ? parseLocalDateTime(ed.start) : null;
  const e = ed?.end ? parseLocalDateTime(ed.end) : null;
  const startOf = (x: { date: LocalDate; minutes: number | null }) => fromLocal(x.date, x.minutes ?? 0, tz);
  const endOf = (x: { date: LocalDate; minutes: number | null }) =>
    x.minutes == null ? fromLocal(addDays(x.date, 1), 0, tz) : fromLocal(x.date, x.minutes, tz);
  const open: EffectiveWindow = { start: -Infinity, end: Infinity, dated, endDateOnly: null, doubtful: null };

  if ((s && !isValidDate(s.date)) || (e && !isValidDate(e.date))) {
    return { ...open, doubtful: "a date on the sign isn't a real date" };
  }
  const start = s ? startOf(s) : -Infinity;
  const end = e ? endOf(e) : Infinity;
  if (start >= end) return { ...open, doubtful: "the end date is before the start date" };

  if (p.temporary && s && e && nowMs != null && !(start <= nowMs && nowMs < end)) {
    // Year mis-resolution check (e.g. "28 Dec – 3 Jan" read as 2026-12-28 → 2026-01-03 is caught above;
    // "2025-12-28 → 2026-01-03" with now in late 2026 is caught here).
    for (const [ds, de] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, 1],
    ] as const) {
      const a = startOf({ date: shiftYear(s.date, ds), minutes: s.minutes });
      const b = endOf({ date: shiftYear(e.date, de), minutes: e.minutes });
      if (b > a && b - a <= MAX_TEMP_RANGE_MS && a <= nowMs && nowMs < b) {
        return { ...open, doubtful: "the year on the sign may have been misread" };
      }
    }
  }
  return { start, end, dated, endDateOnly: e && e.minutes == null ? e.date : null, doubtful: null };
}

function scheduleInterval(s: Schedule, d: LocalDate, tz: string): Interval {
  const st = parseTimeOfDay(s.start);
  let en = parseTimeOfDay(s.end);
  if (en <= st) en += 1440; // overnight (or start == end => 24h)
  return { start: fromLocal(d, st, tz), end: fromLocal(d, en, tz) };
}

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/**
 * Public holiday handling (architect decision): signed restrictions APPLY on
 * public holidays unless the sign says otherwise. Holiday status only matters
 * for schedules marked 'excluded' (lifted on a holiday) or 'included' (also
 * applies on holidays). Unknown status => the restrictive reading for both.
 */
function panelIntervals(
  p: SignPanel,
  panelIndex: number,
  rangeStart: number,
  rangeEnd: number,
  ctx: Ctx,
  notes: HolidayNote[] | null,
): Interval[] {
  const win = effectiveWindow(p, ctx.tz, ctx.nowMs);
  const lo = Math.max(rangeStart, win.start);
  const hi = Math.min(rangeEnd, win.end);
  if (p.schedules.length === 0) return lo < hi ? [{ start: lo, end: hi }] : [];
  // A date-only end includes every window that starts on or before that date, to its natural end.
  const windowHi = win.endDateOnly ? rangeEnd : hi;
  if (lo >= windowHi) return [];

  const out: Interval[] = [];
  const first = addDays(localDateOf(lo, ctx.tz), -1);
  let last = localDateOf(windowHi, ctx.tz);
  if (win.endDateOnly && compareDates(win.endDateOnly, last) < 0) last = win.endDateOnly;
  for (let d = first; compareDates(d, last) <= 0; d = addDays(d, 1)) {
    const dow = dayOfWeek(d);
    const hol = holidayStatus(d, ctx);
    for (const s of p.schedules) {
      const iv = scheduleInterval(s, d, ctx.tz);
      if (iv.end <= lo || iv.start >= windowHi) continue;
      const dayMatch = s.days.includes(dow);
      let applies = false;
      let note: HolidayNoteKind | null = null;
      if (s.publicHolidays === "included") {
        if (dayMatch) applies = true;
        else if (hol === true) {
          applies = true;
          note = "included";
        } else if (hol === "unknown") {
          applies = true; // restrictive reading
          note = "unknown_sensitive";
        }
      } else if (s.publicHolidays === "excluded") {
        if (dayMatch) {
          if (hol === false) applies = true;
          else if (hol === "unknown") {
            applies = true; // restrictive reading
            note = "unknown_sensitive";
          } else note = "excluded";
        }
      } else if (dayMatch) {
        applies = true; // 'unspecified': applies on holidays too
        if (hol === true && s.days.length < 7) note = "kept";
      }
      const clipped = { start: Math.max(iv.start, lo), end: Math.min(iv.end, windowHi) };
      if (note && notes) notes.push({ kind: note, panelIndex, date: d, interval: clipped });
      if (applies) out.push(clipped);
    }
  }
  return mergeIntervals(out);
}

// ---------------------------------------------------------------------------
// Panel effects for this driver
// ---------------------------------------------------------------------------

const FREE = 0;
const LIMITED = 1;
const NO_PARKING = 2;
const NO_STOPPING = 3;
type Severity = typeof FREE | typeof LIMITED | typeof NO_PARKING | typeof NO_STOPPING;

interface Effect {
  severity: Severity;
  limit: number | null;
  payment: PaymentMethod | null;
  label: string;
  towAway: boolean;
  permitUsed: "area" | "disability" | null;
  note: string | null;
  kind: PanelKind;
  temporary: boolean;
  panelIndex: number;
  /** The panel's vehicle wording can't be matched to the driver: answer 'unsure'. */
  vehicleUnclear?: string;
  /** Prohibited because the panel is for other vehicles only (the sign's wording). */
  vehicleOnly?: string;
}

type PermitMatch = "match" | "no_match" | "unclear";

function matchPermit(areaCode: string | null, ctx: Ctx): PermitMatch {
  if (ctx.permits.length === 0) return "no_match";
  const tokens = areaCode == null ? [] : permitTokens(areaCode);
  if (tokens.length === 0) return "unclear";
  return tokens.some((t) => ctx.permits.includes(t)) ? "match" : "no_match";
}

const VEHICLE_WORDS: [RegExp, VehicleClass[]][] = [
  [/\bauthori[sz]ed\b/i, ["authorised"]],
  [/\b(motor ?cycles?|motor ?bikes?|m\/?cycles?)\b/i, ["motorcycle"]],
  [/\b(motor ?cars?|cars?|sedans?)\b/i, ["car"]],
  [/\b(goods|commercial|delivery|loading)\b/i, ["commercial", "truck"]],
  [/\b(trucks?|lorr(y|ies)|heavy vehicles?)\b/i, ["truck"]],
  [/\b(bus|buses)\b/i, ["bus"]],
  [/\b(taxis?|cabs?)\b/i, ["taxi"]],
];

/**
 * Vehicles a panel is restricted to ("X only"), from the structured field or,
 * failing that, the raw text. Returns null when there's no "only" restriction,
 * or "unclear" when the text says "only" but names nothing recognisable.
 */
function allowedVehiclesOf(p: SignPanel): VehicleClass[] | "unclear" | null {
  if (p.allowedVehicles && p.allowedVehicles.length > 0) return p.allowedVehicles;
  const text = p.vehicleRestriction;
  if (!text || !/\bonly\b/i.test(text) || /\bexcept(ed)?\b/i.test(text)) return null;
  const found = new Set<VehicleClass>();
  for (const [re, classes] of VEHICLE_WORDS) if (re.test(text)) classes.forEach((c) => found.add(c));
  return found.size > 0 ? [...found] : "unclear";
}

function panelEffect(p: SignPanel, panelIndex: number, ctx: Ctx, warnings: string[] | null): Effect {
  const eff = basePanelEffect(p, panelIndex, ctx, warnings);
  if (eff.severity >= NO_PARKING) return eff;
  // "X only" restrictions on otherwise-permissive panels.
  const allowed = allowedVehiclesOf(p);
  if (allowed === "unclear") {
    return { ...eff, vehicleUnclear: p.vehicleRestriction ?? "vehicle restriction" };
  }
  if (allowed && !allowed.includes(ctx.vehicleType as VehicleClass)) {
    const what = p.vehicleRestriction ?? `${allowed.join(", ")} only`;
    return { ...eff, severity: NO_STOPPING, limit: null, payment: null, permitUsed: null, label: what, vehicleOnly: what };
  }
  return eff;
}

function basePanelEffect(p: SignPanel, panelIndex: number, ctx: Ctx, warnings: string[] | null): Effect {
  const base = {
    limit: null,
    payment: null,
    towAway: p.towAway,
    permitUsed: null,
    note: null,
    kind: p.kind,
    temporary: p.temporary,
    panelIndex,
  } as const;
  const label = panelLabel(p);
  const prohibited = (severity: Severity, lbl = label): Effect => ({ ...base, severity, label: lbl });
  const limited = (
    lbl = label,
    note: string | null = null,
    permitUsed: Effect["permitUsed"] = null,
    defaultLimit: number | null = null,
  ): Effect => {
    const payment = p.payment === "none" ? null : p.payment;
    const limit = p.timeLimitMinutes ?? defaultLimit;
    if (limit == null && payment == null) {
      return { ...base, severity: FREE, label: lbl, note, permitUsed };
    }
    return { ...base, severity: LIMITED, limit, payment, label: lbl, note, permitUsed };
  };

  // "Permit holders excepted" — only on parking-type panels, never no stopping / clearway / lanes.
  if (p.permitExempt) {
    if (!PERMIT_EXEMPTABLE_KINDS.has(p.kind)) {
      warnings?.push(`Permits don't exempt you from "${label}".`);
    } else {
      const m = matchPermit(p.permitExempt.areaCode, ctx);
      if (m === "match") {
        return {
          ...base,
          severity: FREE,
          label: p.kind === "permit_zone" ? "Permit zone (your permit)" : "Permit exempt",
          permitUsed: "area",
        };
      }
      if (m === "unclear") {
        warnings?.push(
          `"${label}" says permit holders are excepted but no area could be read — check your permit covers this street.`,
        );
      }
    }
  }

  const v = ctx.vehicleType;
  switch (p.kind) {
    case "no_stopping":
    case "bus_lane":
    case "transit_lane":
      return prohibited(NO_STOPPING);
    case "clearway":
    case "special_event":
      return { ...prohibited(NO_STOPPING), towAway: true };
    case "no_parking":
      return prohibited(NO_PARKING);
    case "timed_parking":
      return limited();
    case "permit_zone":
      return prohibited(NO_PARKING, "Permit holders only");
    case "disabled_only":
      return ctx.hasDisabilityPermit
        ? limited("Disability parking", null, "disability")
        : prohibited(NO_STOPPING, "Disability permit only");
    case "loading_zone":
      // ARR r.179: 30 minutes unless the sign says otherwise.
      if (v === "commercial" || v === "truck") {
        return limited(
          label,
          p.timeLimitMinutes == null
            ? "Only while loading or unloading goods (30 min max unless signed)."
            : "Only while loading or unloading goods.",
          null,
          30,
        );
      }
      return prohibited(NO_STOPPING);
    case "bus_zone":
      return v === "bus" ? limited(label) : prohibited(NO_STOPPING);
    case "taxi_zone":
      return v === "taxi" ? limited(label) : prohibited(NO_STOPPING);
    case "truck_zone":
      return v === "truck" ? limited(label) : prohibited(NO_STOPPING);
    case "motorcycle_only":
      return v === "motorcycle" ? limited(label) : prohibited(NO_STOPPING, "Motorbikes only");
    case "ev_charging":
      return ctx.isElectricVehicle
        ? limited(label, "Only while your vehicle is charging.")
        : prohibited(NO_STOPPING, "EV charging only");
    case "car_share":
      return prohibited(NO_STOPPING, "Car share only");
    case "mail_zone":
    case "works_zone":
      return prohibited(NO_STOPPING);
    case "other":
      return prohibited(NO_STOPPING);
  }
}

// ---------------------------------------------------------------------------
// Combining & sweeping
// ---------------------------------------------------------------------------

interface Combined {
  severity: Severity;
  limit: number | null;
  payment: PaymentMethod | null;
  label: string;
  towAway: boolean;
  permitUsed: "area" | "disability" | null;
  note: string | null;
  primary: Effect | null;
  panels: number[];
}

function combine(effects: Effect[]): Combined {
  if (effects.length === 0) {
    return {
      severity: FREE,
      limit: null,
      payment: null,
      label: "No restrictions",
      towAway: false,
      permitUsed: null,
      note: null,
      primary: null,
      panels: [],
    };
  }
  const max = Math.max(...effects.map((e) => e.severity)) as Severity;
  const top = effects.filter((e) => e.severity === max);
  const panels = effects.map((e) => e.panelIndex).sort((a, b) => a - b);
  const primary = top.find((e) => e.temporary) ?? top.find((e) => e.towAway) ?? top[0]!;
  if (max >= NO_PARKING) {
    return {
      severity: max,
      limit: null,
      payment: null,
      label: primary.label,
      towAway: top.some((e) => e.towAway),
      permitUsed: null,
      note: null,
      primary,
      panels,
    };
  }
  const limits = top.map((e) => e.limit).filter((l): l is number => l != null);
  const limit = limits.length ? Math.min(...limits) : null;
  const payment = top.map((e) => e.payment).find((x) => x != null) ?? null;
  const permitUsed = top.map((e) => e.permitUsed).find((x) => x != null) ?? null;
  const note = top.map((e) => e.note).find((x) => x != null) ?? null;
  let label: string;
  if (max === FREE) {
    const permitEffect = top.find((e) => e.permitUsed != null);
    if (permitEffect) label = permitEffect.label;
    else label = primary.kind === "timed_parking" ? "Parking permitted" : primary.label;
  } else if (permitUsed === "disability") {
    label = "Disability parking" + (limit != null ? ` ${limitLabel(limit)}` : "");
  } else {
    const parts: string[] = [];
    parts.push(limit != null ? limitLabel(limit) : payment ? "Paid parking" : "Parking");
    if (payment && limit != null) parts.push(PAYMENT_LABEL[payment]);
    label = parts.join(" · ");
    if (primary.kind !== "timed_parking") label = `${KIND_LABEL[primary.kind]} · ${label}`;
  }
  return {
    severity: max,
    limit,
    payment,
    label,
    towAway: top.some((e) => e.towAway),
    permitUsed,
    note,
    primary,
    panels,
  };
}

interface Segment extends Combined {
  from: number;
  to: number;
}

function segKey(c: Combined): string {
  return [c.severity, c.limit, c.payment, c.label, c.towAway, c.permitUsed, c.panels.join(",")].join("|");
}

function sweep(
  intervals: Map<number, Interval[]>,
  effects: Map<number, Effect>,
  from: number,
  to: number,
): Segment[] {
  const bounds = new Set<number>([from, to]);
  for (const ivs of intervals.values()) {
    for (const iv of ivs) {
      if (iv.start > from && iv.start < to) bounds.add(iv.start);
      if (iv.end > from && iv.end < to) bounds.add(iv.end);
    }
  }
  const pts = [...bounds].sort((a, b) => a - b);
  const segs: Segment[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const active: Effect[] = [];
    for (const [idx, ivs] of intervals) {
      if (ivs.some((iv) => iv.start <= a && a < iv.end)) active.push(effects.get(idx)!);
    }
    const c = combine(active);
    const last = segs[segs.length - 1];
    if (last && segKey(last) === segKey(c)) last.to = b;
    else segs.push({ ...c, from: a, to: b });
  }
  return segs;
}

function timelineStatus(s: Combined): TimelineStatus {
  if (s.severity >= NO_PARKING) return "prohibited";
  if (s.severity === LIMITED && (s.limit != null || s.payment != null)) return "limited";
  return "allowed";
}

function timelineLabel(s: Combined): string {
  if (s.severity >= NO_PARKING) return s.towAway ? `${s.label} (tow-away)` : s.label;
  return s.label;
}

// ---------------------------------------------------------------------------
// Verdict construction helpers
// ---------------------------------------------------------------------------

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

function emptySide(): Omit<SideVerdict, "status" | "headline" | "summary" | "shortLabel"> {
  return {
    maxStayMinutes: null,
    leaveBy: null,
    unrestrictedUntil: null,
    validUntil: null,
    nextAllowedAt: null,
    currentLimitMinutes: null,
    paymentRequired: false,
    payment: null,
    permitRequired: false,
    towAwayRisk: false,
    fitsIntendedStay: null,
    reasons: [],
    warnings: [],
    timeline: [],
    upcomingTemporary: [],
    evidence: [],
  };
}

function unsure(
  headline: string,
  summary: string,
  reasons: string[],
  warnings: string[] = [],
  evidence: PanelEvidence[] = [],
): SideVerdict {
  return {
    ...emptySide(),
    status: "unsure",
    headline,
    shortLabel: unsureShortLabel(headline),
    summary,
    reasons,
    warnings: uniq(warnings),
    evidence,
  };
}

/** "Not sure — rescan" -> "Rescan"; "Sign unclear — rescan" -> "Sign unclear"; else the headline. */
function unsureShortLabel(headline: string): string {
  const [a, b] = headline.split(" — ");
  if (b && a === "Not sure") return b.charAt(0).toUpperCase() + b.slice(1);
  return a ?? headline;
}

const NO_SHORT_LABEL: Partial<Record<PanelKind, string>> = {
  clearway: "Clearway",
  no_stopping: "No stopping",
  no_parking: "No parking",
  special_event: "Special event",
  bus_lane: "Bus lane",
  transit_lane: "Transit lane",
  loading_zone: "Loading zone",
  bus_zone: "Bus zone",
  taxi_zone: "Taxi zone",
  mail_zone: "Mail zone",
  works_zone: "Works zone",
  truck_zone: "Truck zone",
  motorcycle_only: "Motorbikes only",
  car_share: "Car share only",
  ev_charging: "EV charging only",
  disabled_only: "Disability permit only",
  permit_zone: "Permit holders only",
};

function noShortLabel(e: Effect | null): string {
  if (!e) return "No parking";
  if (e.vehicleOnly) return "Not your vehicle";
  if (e.temporary) {
    if (e.kind === "works_zone") return "Roadworks";
    if (e.kind === "clearway" || e.kind === "special_event") return "Temporary clearway";
    return "Temporary sign";
  }
  return NO_SHORT_LABEL[e.kind] ?? "No parking";
}

/** Clip segments to [now, now + 24h), merging neighbours that look the same. Always from < to. */
function buildTimeline(segs: Segment[], nowMs: number): TimelineSegment[] {
  const end = nowMs + TIMELINE_MS;
  const out: TimelineSegment[] = [];
  let lastTo = nowMs;
  for (const s of segs) {
    const from = Math.max(s.from, nowMs);
    const to = Math.min(s.to, end);
    if (!(to > from)) continue;
    const seg: TimelineSegment = {
      from: iso(from),
      to: iso(to),
      status: timelineStatus(s),
      label: timelineLabel(s),
      panels: s.panels,
    };
    lastTo = to;
    const last = out[out.length - 1];
    if (last && last.status === seg.status && last.label === seg.label) {
      last.to = seg.to;
      last.panels = [...new Set([...last.panels, ...seg.panels])].sort((a, b) => a - b);
    } else out.push(seg);
  }
  // Defensive: the sweep always covers the window, but never return a short bar.
  if (out.length > 0 && lastTo < end) out[out.length - 1]!.to = iso(end);
  return out;
}

const NO_HEADLINE: Partial<Record<PanelKind, string>> = {
  clearway: "No — clearway",
  no_stopping: "No stopping",
  no_parking: "No parking",
  special_event: "No — special event",
  bus_lane: "No — bus lane",
  transit_lane: "No — transit lane",
  loading_zone: "No — loading zone",
  bus_zone: "No — bus zone",
  taxi_zone: "No — taxi zone",
  mail_zone: "No — mail zone",
  works_zone: "No — works zone",
  truck_zone: "No — truck zone",
  motorcycle_only: "No — motorbikes only",
  car_share: "No — car share only",
  ev_charging: "No — EV charging only",
  disabled_only: "No — disability permit",
  permit_zone: "No — permit holders",
};

function noHeadline(e: Effect | null): string {
  if (!e) return "No";
  if (e.vehicleOnly) return "No — not your vehicle";
  if (e.temporary) {
    if (e.kind === "works_zone") return "No — roadworks";
    if (e.kind === "clearway" || e.kind === "special_event") return "No — temporary clearway";
    return "No — temporary sign";
  }
  return NO_HEADLINE[e.kind] ?? "No";
}

function noSentence(e: Effect | null): string {
  if (!e) return "You can't park here";
  if (e.vehicleOnly) return `"${e.vehicleOnly}" — not for your vehicle`;
  switch (e.kind) {
    case "clearway":
    case "special_event":
      return `${e.label} — no stopping`;
    case "no_stopping":
      return e.temporary ? "Temporary no stopping" : "No stopping";
    case "no_parking":
      return e.temporary ? "Temporary no parking" : "No parking";
    case "bus_lane":
    case "transit_lane":
      return `${KIND_LABEL[e.kind]} — no stopping`;
    case "permit_zone":
      return "Permit holders only";
    case "disabled_only":
      return "Disability permit holders only";
    default:
      return `You can't stop in this ${e.temporary ? "temporary " : ""}${KIND_LABEL[e.kind].toLowerCase().replace(/^ev /, "EV ")}`;
  }
}

function contradictoryPanels(
  applicable: number[],
  panels: SignPanel[],
  intervals: Map<number, Interval[]>,
): [number, number] | null {
  for (let i = 0; i < applicable.length; i++) {
    for (let j = i + 1; j < applicable.length; j++) {
      const a = panels[applicable[i]!]!;
      const b = panels[applicable[j]!]!;
      if (a.kind !== "timed_parking" || b.kind !== "timed_parking") continue;
      if (a.temporary !== b.temporary) continue;
      if (a.timeLimitMinutes == null || b.timeLimitMinutes == null) continue;
      if (a.timeLimitMinutes === b.timeLimitMinutes) continue;
      const ia = intervals.get(applicable[i]!) ?? [];
      const ib = intervals.get(applicable[j]!) ?? [];
      const overlap = ia.some((x) => ib.some((y) => x.start < y.end && y.start < x.end));
      if (overlap) return [applicable[i]!, applicable[j]!];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-side evaluation
// ---------------------------------------------------------------------------

function appliesToSide(p: SignPanel, side: Side | "unknown"): boolean {
  if (side === "unknown" || p.arrow === "both" || p.arrow === "none") return true;
  return p.arrow === side;
}

/**
 * A restrictive panel read with low confidence may have a misread arrow, so it
 * counts for both sides (conservative).
 */
function appliesToSideOrShaky(p: SignPanel, side: Side | "unknown", ctx: Ctx, opts: Required<EvaluateOptions>): boolean {
  if (appliesToSide(p, side)) return true;
  return p.confidence < opts.minConfidenceForYes && panelEffect(p, -1, ctx, null).severity >= NO_PARKING;
}

function evaluateSide(
  reading: SignReading,
  side: Side | "unknown",
  ctx: Ctx,
  opts: Required<EvaluateOptions>,
): SideVerdict {
  const { nowMs, tz } = ctx;
  const panels = reading.panels;
  const applicable = panels.map((_, i) => i).filter((i) => appliesToSideOrShaky(panels[i]!, side, ctx, opts));
  const fmt = (ms: number): string => formatInstant(ms, nowMs, tz);
  const warnings: string[] = [];
  const reasons: string[] = [];

  const otherSideEvidence = (i: number): PanelEvidence => ({
    panelIndex: i,
    label: panelLabel(panels[i]!),
    state: "other_side",
    drivesDecision: false,
    nextStart: null,
  });

  if (applicable.length === 0) {
    return unsure(
      "No sign this side",
      `This sign doesn't cover the ${side} side of the pole. Look for another sign.`,
      ["Every panel's arrow points the other way."],
      [],
      panels.map((_, i) => otherSideEvidence(i)),
    );
  }

  const other = applicable.find((i) => panels[i]!.kind === "other");
  if (other != null) {
    return unsure(
      "Not sure — check sign",
      `One panel couldn't be interpreted ("${panels[other]!.rawText}"). Read the sign yourself before parking.`,
      [`Panel ${other + 1} isn't a sign type we understand yet.`],
    );
  }

  for (const i of applicable) {
    if (!appliesToSide(panels[i]!, side)) {
      warnings.push(
        `Panel ${i + 1} ("${panelLabel(panels[i]!)}") was hard to read — its arrow may be misread, so we're counting it for this side too.`,
      );
    }
  }

  const unclearVehicle = applicable.find((i) => panelEffect(panels[i]!, i, ctx, null).vehicleUnclear != null);
  if (unclearVehicle != null) {
    const txt = panels[unclearVehicle]!.vehicleRestriction ?? "";
    return unsure(
      "Not sure — check sign",
      `The sign says "${txt}" — check whether your vehicle is allowed before parking.`,
      [`Panel ${unclearVehicle + 1} restricts which vehicles may park, and we couldn't match it to yours.`],
      warnings,
    );
  }

  const shaky = applicable.find((i) => panels[i]!.confidence < opts.minConfidence);
  if (shaky != null) {
    return unsure("Not sure — rescan", "Part of the sign couldn't be read clearly. Move closer and rescan.", [
      `Panel ${shaky + 1} ("${panels[shaky]!.rawText}") was read with low confidence.`,
    ]);
  }

  // Expand intervals and effects.
  const horizonEnd = nowMs + LOOKAHEAD_MS;
  const holidayNotes: HolidayNote[] = [];
  const intervals = new Map<number, Interval[]>();
  const effects = new Map<number, Effect>();
  const expired = new Set<number>();
  const doubtfulDates: number[] = [];
  const vehicleNotes: string[] = [];
  for (const i of applicable) {
    const p = panels[i]!;
    const win = effectiveWindow(p, tz, nowMs);
    const ivs = panelIntervals(p, i, nowMs, horizonEnd, ctx, holidayNotes);
    if (win.end <= nowMs && ivs.length === 0) expired.add(i);
    intervals.set(i, ivs);
    effects.set(i, panelEffect(p, i, ctx, warnings));
    if (win.doubtful) {
      doubtfulDates.push(i);
      warnings.push(
        `Dates on the temporary sign are unclear (${win.doubtful}) — treating "${panelLabel(p)}" as in force. Check the sign.`,
      );
    } else if (p.temporary && !win.dated) {
      warnings.push(`Temporary sign ("${panelLabel(p)}") has no readable dates — treating it as in force.`);
    }
    if (p.vehicleRestriction) vehicleNotes.push(p.vehicleRestriction);
  }
  for (const n of uniq(vehicleNotes)) warnings.push(`Sign also says: "${n}".`);

  const clash = contradictoryPanels(applicable, panels, intervals);
  if (clash) {
    return unsure(
      "Sign unclear — rescan",
      "The panels seem to give different time limits for the same times. Move closer and rescan.",
      [
        `Panel ${clash[0] + 1} (${panelLabel(panels[clash[0]]!)}) and panel ${clash[1] + 1} (${panelLabel(
          panels[clash[1]]!,
        )}) overlap with different limits.`,
      ],
    );
  }

  for (const i of expired) {
    const p = panels[i]!;
    const endTxt = p.effectiveDates?.end ? ` (ended ${describeLocal(p.effectiveDates.end)})` : "";
    warnings.push(
      `${panelLabel(p)} sign${endTxt} looks out of date — it may still be up, or the date was misread. Check for newer signs.`,
    );
  }

  const segs = sweep(intervals, effects, nowMs, horizonEnd);
  const cur = segs[0]!;
  const timelineEnd = nowMs + TIMELINE_MS;
  const timeline = buildTimeline(segs, nowMs);

  // Holiday notes relevant to the next 24h.
  const relevantNotes = holidayNotes.filter((n) => n.interval.end > nowMs && n.interval.start < timelineEnd);
  // Unknown holiday status only matters if either answer (holiday / not) would change the next 24h.
  let holidayMatters = false;
  if (relevantNotes.some((n) => n.kind === "unknown_sensitive")) {
    const strip = (t: TimelineSegment[]) => JSON.stringify(t.map(({ from, to, status, label }) => [from, to, status, label]));
    const base = strip(timeline);
    for (const assume of [true, false]) {
      const alt: Ctx = { ...ctx, unknownAs: assume };
      const altIntervals = new Map<number, Interval[]>();
      for (const i of applicable) altIntervals.set(i, panelIntervals(panels[i]!, i, nowMs, horizonEnd, alt, null));
      if (strip(buildTimeline(sweep(altIntervals, effects, nowMs, horizonEnd), nowMs)) !== base) holidayMatters = true;
    }
  }
  const holidayName = (d: LocalDate): string | null =>
    ctx.jurisdiction ? (publicHolidaysOn(d, ctx.jurisdiction)[0]?.name ?? null) : null;
  const todayDate = localDateOf(nowMs, tz);
  for (const n of relevantNotes) {
    const lbl = panelLabel(panels[n.panelIndex]!);
    const name = holidayName(n.date);
    const ph = name ? `Public holiday (${name})` : "Public holiday";
    const dayTxt = compareDates(n.date, todayDate) === 0 ? "today" : formatDate(n.date);
    switch (n.kind) {
      case "unknown_sensitive":
        if (!holidayMatters) break;
        if (name) {
          warnings.push(
            `${name} is a public holiday in only part of the state — assuming the sign's restrictions apply. Check locally.`,
          );
        } else {
          warnings.push(`Not sure if ${dayTxt} is a public holiday — assuming the sign's restrictions apply.`);
        }
        break;
      case "excluded":
        reasons.push(`Public holidays are excepted on the ${lbl} panel.`);
        warnings.push(`${ph} — the ${lbl} times don't apply. Double-check the sign.`);
        break;
      case "included":
        reasons.push(`The ${lbl} panel also applies on public holidays.`);
        break;
      case "kept":
        warnings.push(
          `It's a public holiday ${dayTxt === "today" ? "today" : `on ${dayTxt}`} — sign times still apply unless the sign says otherwise (some councils differ).`,
        );
        break;
    }
  }

  // Upcoming dated temporary restrictions.
  const upcomingTemporary: UpcomingRestriction[] = [];
  for (const i of applicable) {
    const p = panels[i]!;
    if (!p.temporary) continue;
    const win = effectiveWindow(p, tz);
    if (!win.dated || win.end <= nowMs) continue;
    const next = panelIntervals(p, i, nowMs, nowMs + TEMP_LOOKAHEAD_MS, ctx, null).find((iv) => iv.start > nowMs);
    if (!next) continue;
    upcomingTemporary.push({
      from: iso(next.start),
      to: Number.isFinite(next.end) ? iso(next.end) : null,
      label: panelLabel(p),
      panelIndex: i,
    });
    const activeNowTemp = (intervals.get(i) ?? []).some((iv) => iv.start <= nowMs && nowMs < iv.end);
    // Within 24h it's already in the timeline/summary.
    if (!activeNowTemp && next.start - nowMs > TIMELINE_MS && next.start - nowMs <= 7 * DAY) {
      warnings.push(`${panelLabel(p)} from ${fmt(next.start)}.`);
    }
  }
  upcomingTemporary.sort((a, b) => a.from.localeCompare(b.from));

  // Only when a temporary PROHIBITION is what decides the answer right now.
  if (cur.severity >= NO_PARKING && cur.primary?.temporary) {
    if (cur.panels.some((i) => !panels[i]!.temporary)) warnings.push("A temporary sign overrides the regular sign right now.");
    else warnings.push("A temporary sign is in force right now.");
  }

  // Reasons: what's in force now.
  const activeNow = new Set(cur.panels);
  if (activeNow.size === 0) reasons.push("No panel is in force right now.");
  for (const i of cur.panels) reasons.push(`In force now: ${describePanel(panels[i]!)}.`);

  // Evidence (filled in after decision).
  const driving = new Set<number>(cur.severity === FREE && cur.permitUsed == null ? [] : cur.panels);

  let base: SideVerdict;
  const validUntil = cur.to < horizonEnd ? iso(cur.to) : null;

  if (cur.severity >= NO_PARKING) {
    // ---- NO ----
    const allowedSeg = segs.find((s) => s.severity <= LIMITED);
    const nextAllowed = allowedSeg ? allowedSeg.from : null;
    const prim = cur.primary;
    let summary =
      cur.to < horizonEnd ? `${noSentence(prim)} until ${fmt(cur.to)}.` : `${noSentence(prim)} at all times.`;
    if (nextAllowed != null && nextAllowed !== cur.to) summary += ` You can park from ${fmt(nextAllowed)}.`;
    if (cur.severity === NO_PARKING && prim?.kind !== "permit_zone") {
      summary += " You may stop up to 2 min to drop off or pick up, staying within 3 m of your car.";
    } else if (cur.severity === NO_PARKING) {
      summary += " You may stop briefly to drop off or pick up.";
    }
    if (cur.towAway) summary += " Tow-away area.";
    if (prim?.kind === "loading_zone") {
      warnings.push("Loading zones are for goods vehicles; some states let other vehicles stop briefly to load — check local rules.");
    }
    if (prim?.kind === "car_share") warnings.push("If you're driving the car-share vehicle for this bay, you can park.");
    base = {
      ...emptySide(),
      status: "no",
      headline: noHeadline(prim),
      shortLabel: noShortLabel(prim),
      summary,
      validUntil,
      nextAllowedAt: nextAllowed != null ? iso(nextAllowed) : null,
      towAwayRisk: cur.towAway,
      reasons,
      warnings,
      timeline,
      upcomingTemporary,
    };
  } else {
    // ---- YES / YES WITH CONDITIONS ----
    let countStart: number | null = null;
    let leaveBy: number | null = null;
    let leaveSeg: Segment | null = null;
    let leaveKind: "prohibition" | "limit" | null = null;
    for (const s of segs) {
      if (s.severity >= NO_PARKING) {
        leaveBy = s.from;
        leaveSeg = s;
        leaveKind = "prohibition";
        break;
      }
      if (s.severity === LIMITED && s.limit != null) {
        // Limit counts from when you arrive or when the window starts, whichever
        // is later. Back-to-back limited windows keep counting (conservative).
        if (countStart == null) countStart = Math.max(s.from, nowMs);
        const deadline = countStart + s.limit * MINUTE;
        if (deadline < s.to) {
          leaveBy = deadline;
          leaveSeg = s;
          leaveKind = "limit";
          break;
        }
      } else {
        countStart = null;
      }
    }
    if (leaveSeg) for (const i of leaveSeg.panels) driving.add(i);

    const leaveSoon = leaveBy != null && leaveSeg != null && leaveBy - nowMs <= TIMELINE_MS;
    // Only meaningful when you must move within 24 h; otherwise see leaveBy / unrestrictedUntil.
    const maxStay = leaveSoon && leaveBy != null ? Math.floor((leaveBy - nowMs) / MINUTE) : null;
    const allowedNow = timelineStatus(cur) === "allowed";
    const nextRestr = segs.find((s) => s.from > nowMs && timelineStatus(s) !== "allowed") ?? null;
    const unrestrictedUntil = allowedNow && nextRestr ? nextRestr.from : null;
    const paymentNow = cur.severity === LIMITED && cur.payment != null;
    const permitRequired = cur.permitUsed != null;
    const parts: string[] = [];

    const shortStay = maxStay != null && maxStay <= 4 * 60;
    let moveBy: string | null = null; // appended after payment/permit notes
    if (leaveSoon && leaveSeg && leaveBy != null) {
      const what = leaveKind === "prohibition" ? lowerFirst(leaveSeg.primary ? leaveSeg.primary.label : "restriction") : "";
      if (shortStay) {
        parts.push(`Park for up to ${formatDuration(maxStay!)}.`);
        if (leaveKind === "prohibition") moveBy = `Move by ${fmt(leaveBy)} — ${what} starts.`;
        else if (leaveSeg.from > nowMs) moveBy = `${limitLabel(leaveSeg.limit!)} limit starts ${fmt(leaveSeg.from)} — move by ${fmt(leaveBy)}.`;
        else moveBy = `Move by ${fmt(leaveBy)}.`;
      } else if (leaveKind === "prohibition") {
        parts.push(`Park until ${fmt(leaveBy)} — ${what} starts.`);
      } else if (leaveSeg.from > nowMs) {
        parts.push(`Park until ${fmt(leaveBy)} (${limitLabel(leaveSeg.limit!)} limit from ${fmt(leaveSeg.from)}).`);
      } else {
        parts.push(`Park until ${fmt(leaveBy)}.`);
      }
      if (leaveKind === "prohibition" && leaveSeg.towAway) {
        const lbl = leaveSeg.primary ? leaveSeg.primary.label : "Restriction";
        warnings.push(`${lbl} starts ${fmt(leaveBy)} — vehicles are towed.`);
      }
    } else if (allowedNow) {
      parts.push(
        nextRestr
          ? `No restrictions until ${fmt(nextRestr.from)} (${lowerFirst(timelineLabel(nextRestr))}).`
          : "No restrictions for at least the next 7 days.",
      );
    } else if (leaveBy != null && leaveSeg && leaveKind === "limit" && leaveSeg.from > nowMs) {
      parts.push(`${limitLabel(leaveSeg.limit!)} from ${fmt(leaveSeg.from)} — move by ${fmt(leaveBy)}.`);
    } else if (leaveBy != null && leaveSeg && leaveKind === "prohibition") {
      parts.push(`Move by ${fmt(leaveBy)} — ${lowerFirst(leaveSeg.primary ? leaveSeg.primary.label : "restriction")} starts.`);
    } else if (leaveBy != null) {
      parts.push(`No time limit until ${fmt(leaveBy)}.`);
    } else parts.push("No time limit.");

    // A limit in force now that ends before it can bite: say so instead of "no restrictions".
    const afterCur = segs[1];
    if (
      cur.severity === LIMITED &&
      cur.limit != null &&
      nowMs + cur.limit * MINUTE >= cur.to &&
      cur.to < horizonEnd &&
      (!afterCur || timelineStatus(afterCur) === "allowed")
    ) {
      parts.unshift(`${limitLabel(cur.limit)} ends ${fmt(cur.to)} — no limit after that.`);
    }

    if (paymentNow) parts.push(PAYMENT_INSTRUCTION[cur.payment as Exclude<PaymentMethod, "none">]);
    else if (leaveSoon) {
      const stayEnd = Math.min(leaveBy ?? timelineEnd, timelineEnd);
      const paySeg = segs.find((s) => s.from > nowMs && s.from < stayEnd && s.severity === LIMITED && s.payment != null);
      if (paySeg) parts.push(`Pay from ${fmt(paySeg.from)}.`);
    }
    if (cur.permitUsed === "area") parts.push("Your permit exempts you — display it.");
    if (cur.permitUsed === "disability") parts.push("Display your disability permit.");
    if (cur.note) parts.push(cur.note);

    if (moveBy) parts.push(moveBy);

    const allAllowed24 = timeline.every((t) => t.status === "allowed");
    let status: SideVerdict["status"] =
      allAllowed24 && !permitRequired && (leaveBy == null || leaveBy - nowMs > TIMELINE_MS) && !cur.note
        ? "yes"
        : "yes_with_conditions";
    if (status === "yes" && expired.size > 0) status = "yes_with_conditions";

    let shortLabel: string;
    if (status === "yes") shortLabel = "No restrictions";
    else if (maxStay != null && maxStay <= 4 * 60) shortLabel = `Up to ${formatShortDuration(maxStay)}`;
    else if (maxStay != null && leaveBy != null) shortLabel = `Until ${formatClock(toLocalMinutes(leaveBy, tz))}`;
    else if (paymentNow) shortLabel = "Pay to park";
    else if (permitRequired) shortLabel = "With permit";
    else if (cur.note) shortLabel = "Conditions apply";
    else shortLabel = "No time limit now";

    let headline: string;
    if (status === "yes") headline = "You can park";
    else if (maxStay != null && maxStay <= 4 * 60) headline = `Yes — ${formatShortDuration(maxStay)}`;
    else if (maxStay != null && leaveBy != null && maxStay < 24 * 60) headline = `Yes — until ${formatClock(toLocalMinutes(leaveBy, tz))}`;
    else if (paymentNow) headline = "Yes — pay to park";
    else if (permitRequired) headline = "Yes — with permit";
    else headline = "You can park";

    let fits: boolean | null = null;
    if (ctx.intendedStayMinutes != null) {
      const fullStay = leaveBy != null ? Math.floor((leaveBy - nowMs) / MINUTE) : null;
      fits = fullStay == null || ctx.intendedStayMinutes <= fullStay;
      if (!fits && leaveBy != null) {
        warnings.push(
          `You planned ${formatDuration(ctx.intendedStayMinutes)} — the most you can stay is ${formatDuration(fullStay!)}.`,
        );
        if (status === "yes") status = "yes_with_conditions";
        if (!leaveSoon) parts.push(`You can stay ${formatDuration(fullStay!)} — until ${fmt(leaveBy)}.`);
      }
    }
    // Any vehicle wording on a panel in play: never a plain yes, and say it.
    if (vehicleNotes.length > 0) {
      if (status === "yes") status = "yes_with_conditions";
      parts.push(...uniq(vehicleNotes).map((n) => `Sign note: "${n}".`));
    }

    if (status !== "yes" && headline === "You can park" && shortLabel === "No restrictions") {
      shortLabel = vehicleNotes.length > 0 ? "Check vehicle note" : "Conditions apply";
    }

    base = {
      ...emptySide(),
      status,
      headline,
      shortLabel,
      summary: parts.join(" "),
      maxStayMinutes: maxStay,
      leaveBy: leaveBy != null ? iso(leaveBy) : null,
      unrestrictedUntil: unrestrictedUntil != null ? iso(unrestrictedUntil) : null,
      validUntil,
      currentLimitMinutes: cur.severity === LIMITED ? cur.limit : null,
      paymentRequired: paymentNow,
      payment: paymentNow ? cur.payment : null,
      permitRequired,
      towAwayRisk: leaveKind === "prohibition" && leaveSeg != null && leaveSeg.towAway,
      fitsIntendedStay: fits,
      reasons,
      warnings,
      timeline,
      upcomingTemporary,
    };
    if (leaveSeg && leaveKind === "prohibition") {
      for (const i of leaveSeg.panels) {
        if (!activeNow.has(i)) reasons.push(`Next: ${describePanel(panels[i]!)}.`);
      }
    }

    // A prohibition starting within minutes: don't invite the user to park.
    if (leaveKind === "prohibition" && leaveSeg && leaveBy != null && leaveBy - nowMs < IMMINENT_MS) {
      const after = segs.find((x) => x.from >= leaveSeg!.to && x.severity <= LIMITED);
      const mins = Math.max(1, Math.ceil((leaveBy - nowMs) / MINUTE));
      const what = leaveSeg.primary ? leaveSeg.primary.label : "A restriction";
      let summary = `${what} starts in ${mins} min (${fmt(leaveBy)}) — don't park here.`;
      if (after) summary += ` You can park from ${fmt(after.from)}.`;
      if (leaveSeg.towAway) summary += " Tow-away area.";
      base = {
        ...base,
        status: "no",
        headline: noHeadline(leaveSeg.primary),
        shortLabel: `${noShortLabel(leaveSeg.primary)} in ${mins} min`,
        summary,
        maxStayMinutes: null,
        nextAllowedAt: after ? iso(after.from) : null,
        currentLimitMinutes: null,
        paymentRequired: false,
        payment: null,
        fitsIntendedStay: null,
        towAwayRisk: leaveSeg.towAway,
      };
    }
  }

  if (doubtfulDates.length > 0) {
    base.summary += " Dates on the temporary sign are unclear — check the sign.";
  }
  if (expired.size > 0 && base.status !== "no") {
    base.summary += " A temporary sign here looks out of date — check it before parking.";
  }

  // Evidence.
  base.evidence = panels.map((p, i): PanelEvidence => {
    if (!applicable.includes(i)) return otherSideEvidence(i);
    const ivs = intervals.get(i) ?? [];
    const isActive = ivs.some((iv) => iv.start <= nowMs && nowMs < iv.end);
    const nextIv = ivs.find((iv) => iv.start > nowMs);
    const state: PanelEvidence["state"] = expired.has(i)
      ? "expired"
      : isActive
        ? "active_now"
        : nextIv && nextIv.start - nowMs <= TIMELINE_MS
          ? "upcoming"
          : "not_soon";
    return {
      panelIndex: i,
      label: panelLabel(p),
      state,
      drivesDecision: driving.has(i),
      nextStart: nextIv ? iso(nextIv.start) : null,
    };
  });

  // Legibility & confidence gating.
  const minPanelConf = Math.min(...applicable.map((i) => panels[i]!.confidence));
  const conf = Math.min(minPanelConf, reading.overallConfidence);
  if (reading.legibilityIssues.length > 0) {
    warnings.push(`Hard to read: ${reading.legibilityIssues.join("; ")}.`);
  }
  if (conf < opts.minConfidenceForYes) {
    if (base.status === "no") {
      warnings.push("The sign wasn't read with full confidence — rescan if this looks wrong.");
    } else {
      return unsure(
        "Not sure — rescan",
        "Couldn't read the sign clearly enough to say yes. Move closer and rescan.",
        [`Reading confidence ${Math.round(conf * 100)}% is below ${Math.round(opts.minConfidenceForYes * 100)}%.`],
        warnings,
        base.evidence,
      );
    }
  }
  base.warnings = uniq(warnings);
  base.reasons = uniq(base.reasons);
  return base;
}

function lowerFirst(s: string): string {
  // Keep acronyms / limit labels like "2P", "EV" intact.
  if (/^[A-Z0-9]{2}/.test(s)) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function toLocalMinutes(ms: number, tz: string): number {
  const l = toLocal(ms, tz);
  return l.hour * 60 + l.minute;
}

function describeLocal(v: string): string {
  const { date, minutes } = parseLocalDateTime(v);
  const d = `${date.day} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.month - 1]} ${date.year}`;
  return minutes == null ? d : `${d} ${formatClock(minutes)}`;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Turn a sign reading + context into a verdict. Pure and deterministic: the
 * same inputs always give the same output. Throws RangeError only for an
 * invalid `now` or `timeZone` (programming errors); bad readings yield 'unsure'.
 */
export function evaluate(reading: SignReading, context: ParkingContext, options: EvaluateOptions = {}): Verdict {
  const ctx = normaliseContext(context, null);
  const opts: Required<EvaluateOptions> = {
    minConfidenceForYes: options.minConfidenceForYes ?? DEFAULT_MIN_CONFIDENCE_FOR_YES,
    minConfidence: options.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
  };
  const wrap = (
    sv: SideVerdict,
    side: Side | "unknown",
    bySide: Verdict["bySide"] = null,
    needsSide = false,
  ): Verdict => {
    const today = localDateOf(ctx.nowMs, ctx.tz);
    const publicHolidayToday = holidayStatus(today, ctx);
    const name = ctx.jurisdiction ? (publicHolidaysOn(today, ctx.jurisdiction)[0]?.name ?? null) : null;
    return {
      ...sv,
      side,
      needsSide,
      bySide,
      evaluatedAt: iso(ctx.nowMs),
      timeZone: ctx.tz,
      jurisdiction: ctx.jurisdiction,
      publicHolidayToday,
      publicHolidayName: publicHolidayToday === false ? null : name,
    };
  };
  const requestedSide = context.side ?? "unknown";

  const parsed = SignReadingSchema.safeParse(reading);
  if (!parsed.success) {
    return wrap(
      unsure("Couldn't read sign", "Something went wrong reading the sign. Rescan.", [
        "The sign reading didn't match the expected format.",
      ]),
      requestedSide,
    );
  }
  const r = parsed.data;
  ctx.jurisdiction = resolveJurisdiction(context, r);
  if (!r.isParkingSign) {
    return wrap(
      unsure("Not a parking sign", "This doesn't look like a parking sign. Point the camera at the sign and rescan.", [
        "The photo wasn't recognised as a parking sign.",
      ]),
      requestedSide,
    );
  }
  if (r.panels.length === 0) {
    return wrap(
      unsure("No sign found", "Couldn't find any sign panels. Move closer and rescan.", ["No panels were read."]),
      requestedSide,
    );
  }
  if (r.overallConfidence < opts.minConfidence) {
    const issues = r.legibilityIssues.length ? [`Hard to read: ${r.legibilityIssues.join("; ")}.`] : [];
    return wrap(
      unsure(
        "Not sure — rescan",
        "The sign couldn't be read clearly. Move closer, avoid glare and rescan.",
        [`Reading confidence ${Math.round(r.overallConfidence * 100)}% is too low.`],
        issues,
      ),
      requestedSide,
    );
  }

  if (requestedSide !== "unknown") {
    return wrap(evaluateSide(r, requestedSide, ctx, opts), requestedSide);
  }

  const leftSet = r.panels.map((p, i) => (appliesToSideOrShaky(p, "left", ctx, opts) ? i : -1)).filter((i) => i >= 0);
  const rightSet = r.panels.map((p, i) => (appliesToSideOrShaky(p, "right", ctx, opts) ? i : -1)).filter((i) => i >= 0);
  if (leftSet.join(",") === rightSet.join(",")) {
    return wrap(evaluateSide(r, "unknown", ctx, opts), "unknown");
  }

  const left = evaluateSide(r, "left", ctx, opts);
  const right = evaluateSide(r, "right", ctx, opts);
  const bySide = { left, right };
  if (left.status === right.status && left.summary === right.summary && left.headline === right.headline) {
    return wrap({ ...left, evidence: mergeEvidence(left, right) }, "unknown", bySide);
  }
  const sideReason = "The panels point different ways — the answer depends on which side of the pole you park.";
  const bothNo = left.status === "no" && right.status === "no";
  const combined: SideVerdict = {
    ...emptySide(),
    status: bothNo ? "no" : "unsure",
    headline: bothNo ? "No — either side" : "Depends on side",
    shortLabel: bothNo ? "Either side" : "Depends on side",
    summary:
      bothNo
        ? `Left of the pole: ${left.summary} Right of the pole: ${right.summary}`
        : `Left of the pole: ${left.headline}. Right of the pole: ${right.headline}. Which side are you parking on?`,
    paymentRequired: left.paymentRequired || right.paymentRequired,
    permitRequired: left.permitRequired || right.permitRequired,
    towAwayRisk: left.towAwayRisk || right.towAwayRisk,
    reasons: [sideReason],
    warnings: uniq([...left.warnings, ...right.warnings]),
    upcomingTemporary: dedupeUpcoming([...left.upcomingTemporary, ...right.upcomingTemporary]),
    evidence: mergeEvidence(left, right),
  };
  return wrap(combined, "unknown", bySide, !bothNo);
}

function mergeEvidence(a: SideVerdict, b: SideVerdict): PanelEvidence[] {
  return a.evidence.map((e, i) => {
    const o = b.evidence[i];
    if (e.state === "other_side" && o) return o;
    if (o && o.drivesDecision) return { ...e, drivesDecision: true };
    return e;
  });
}

function dedupeUpcoming(list: UpcomingRestriction[]): UpcomingRestriction[] {
  const seen = new Set<string>();
  return list
    .filter((u) => {
      const k = `${u.panelIndex}|${u.from}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((x, y) => x.from.localeCompare(y.from));
}

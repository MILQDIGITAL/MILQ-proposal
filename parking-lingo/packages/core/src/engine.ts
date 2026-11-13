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
import type { PanelKind, PaymentMethod, Schedule, SignPanel, SignReading } from "./schema";
import { SignReadingSchema } from "./schema";
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
}

function normaliseContext(c: ParkingContext): Ctx {
  const nowMs = toInstant(c.now);
  assertValidTimeZone(c.timeZone);
  return {
    nowMs,
    tz: c.timeZone,
    todayKey: dateKey(localDateOf(nowMs, c.timeZone)),
    holidayToday: c.isPublicHoliday ?? "unknown",
    holidayDates: new Set(c.publicHolidayDates ?? []),
    permits: (c.permits ?? []).map(normalisePermit).filter((p) => p.length > 0),
    hasDisabilityPermit: c.hasDisabilityPermit ?? false,
    vehicleType: c.vehicleType ?? "car",
    isElectricVehicle: c.isElectricVehicle ?? false,
    intendedStayMinutes: c.intendedStayMinutes ?? null,
  };
}

/** "Area 05" -> "5", "zone 12a" -> "12A", "S" -> "S". */
export function normalisePermit(code: string): string {
  let s = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  s = s.replace(/^(AREA|ZONE|PERMIT|PRECINCT)/, "");
  s = s.replace(/^0+(?=\d)/, "");
  return s;
}

function holidayStatus(d: LocalDate, ctx: Ctx): boolean | "unknown" {
  const key = dateKey(d);
  if (ctx.holidayDates.has(key)) return true;
  if (key === ctx.todayKey) return ctx.holidayToday;
  return false;
}

// ---------------------------------------------------------------------------
// Panel -> intervals in force
// ---------------------------------------------------------------------------

interface Interval {
  start: number;
  end: number;
}

type HolidayNoteKind = "unknown_sensitive" | "lifted" | "excluded" | "included" | "kept";

interface HolidayNote {
  kind: HolidayNoteKind;
  panelIndex: number;
  interval: Interval;
}

const PROHIBITIVE_KINDS: ReadonlySet<PanelKind> = new Set([
  "no_stopping",
  "clearway",
  "bus_lane",
  "transit_lane",
  "special_event",
]);

/**
 * Whether a schedule with publicHolidays='unspecified' is assumed NOT to apply
 * on a known public holiday. Only "soft" restrictions are lifted; tow-away /
 * no-stopping / clearway / temporary panels stay in force (conservative).
 */
function liftableOnHoliday(p: SignPanel): boolean {
  return !p.temporary && !p.towAway && !PROHIBITIVE_KINDS.has(p.kind);
}

interface EffectiveWindow {
  start: number; // -Infinity if open
  end: number; // +Infinity if open
  dated: boolean;
}

function effectiveWindow(p: SignPanel, tz: string): EffectiveWindow {
  let start = -Infinity;
  let end = Infinity;
  const ed = p.effectiveDates;
  if (ed?.start) {
    const { date, minutes } = parseLocalDateTime(ed.start);
    start = fromLocal(date, minutes ?? 0, tz);
  }
  if (ed?.end) {
    const { date, minutes } = parseLocalDateTime(ed.end);
    end = minutes == null ? fromLocal(addDays(date, 1), 0, tz) : fromLocal(date, minutes, tz);
  }
  return { start, end, dated: Boolean(ed?.start || ed?.end) };
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

function panelIntervals(
  p: SignPanel,
  panelIndex: number,
  rangeStart: number,
  rangeEnd: number,
  ctx: Ctx,
  notes: HolidayNote[] | null,
): Interval[] {
  const win = effectiveWindow(p, ctx.tz);
  const lo = Math.max(rangeStart, win.start);
  const hi = Math.min(rangeEnd, win.end);
  if (lo >= hi) return [];
  if (p.schedules.length === 0) return [{ start: lo, end: hi }];

  const out: Interval[] = [];
  const first = addDays(localDateOf(lo, ctx.tz), -1);
  const last = localDateOf(hi, ctx.tz);
  for (let d = first; compareDates(d, last) <= 0; d = addDays(d, 1)) {
    const dow = dayOfWeek(d);
    const hol = holidayStatus(d, ctx);
    for (const s of p.schedules) {
      const iv = scheduleInterval(s, d, ctx.tz);
      if (iv.end <= lo || iv.start >= hi) continue;
      const dayMatch = s.days.includes(dow);
      let applies = false;
      let note: HolidayNoteKind | null = null;
      if (s.publicHolidays === "included") {
        if (dayMatch) applies = true;
        else if (hol === true) {
          applies = true;
          note = "included";
        } else if (hol === "unknown") {
          applies = true;
          note = "unknown_sensitive";
        }
      } else if (dayMatch) {
        if (hol === false) applies = true;
        else if (hol === "unknown") {
          // Only sensitive if the answer would differ on a holiday.
          applies = true;
          if (s.publicHolidays === "excluded" || liftableOnHoliday(p)) note = "unknown_sensitive";
        } else if (s.publicHolidays === "excluded") {
          note = "excluded";
        } else if (liftableOnHoliday(p)) {
          note = "lifted";
        } else {
          applies = true;
          note = "kept";
        }
      }
      const clipped = { start: Math.max(iv.start, lo), end: Math.min(iv.end, hi) };
      if (note && notes) notes.push({ kind: note, panelIndex, interval: clipped });
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
}

type PermitMatch = "match" | "no_match" | "unclear";

function matchPermit(areaCode: string | null, ctx: Ctx): PermitMatch {
  if (ctx.permits.length === 0) return "no_match";
  if (areaCode == null || normalisePermit(areaCode) === "") return "unclear";
  return ctx.permits.includes(normalisePermit(areaCode)) ? "match" : "no_match";
}

function panelEffect(p: SignPanel, panelIndex: number, ctx: Ctx, warnings: string[]): Effect {
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
  const limited = (lbl = label, note: string | null = null, permitUsed: Effect["permitUsed"] = null): Effect => {
    const payment = p.payment === "none" ? null : p.payment;
    if (p.timeLimitMinutes == null && payment == null) {
      return { ...base, severity: FREE, label: lbl, note, permitUsed };
    }
    return { ...base, severity: LIMITED, limit: p.timeLimitMinutes, payment, label: lbl, note, permitUsed };
  };

  // "Permit holders excepted" — never exempts from a clearway.
  if (p.permitExempt && p.kind !== "clearway") {
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
      warnings.push(
        `"${label}" says permit holders are excepted but no area could be read — check your permit covers this street.`,
      );
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
      if (v === "commercial" || v === "truck") return limited(label, "Only while loading or unloading goods.");
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

function emptySide(): Omit<SideVerdict, "status" | "headline" | "summary"> {
  return {
    maxStayMinutes: null,
    leaveBy: null,
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
  return { ...emptySide(), status: "unsure", headline, summary, reasons, warnings: uniq(warnings), evidence };
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
  if (e.temporary) {
    if (e.kind === "works_zone") return "No — roadworks";
    if (e.kind === "clearway" || e.kind === "special_event") return "No — temporary clearway";
    return "No — temporary sign";
  }
  return NO_HEADLINE[e.kind] ?? "No";
}

function noSentence(e: Effect | null): string {
  if (!e) return "You can't park here";
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

function evaluateSide(
  reading: SignReading,
  side: Side | "unknown",
  ctx: Ctx,
  opts: Required<EvaluateOptions>,
): SideVerdict {
  const { nowMs, tz } = ctx;
  const panels = reading.panels;
  const applicable = panels.map((_, i) => i).filter((i) => appliesToSide(panels[i]!, side));
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
  for (const i of applicable) {
    const p = panels[i]!;
    const win = effectiveWindow(p, tz);
    if (win.end <= nowMs) expired.add(i);
    intervals.set(i, panelIntervals(p, i, nowMs, horizonEnd, ctx, holidayNotes));
    effects.set(i, panelEffect(p, i, ctx, warnings));
    if (p.temporary && !win.dated) {
      warnings.push(`Temporary sign ("${panelLabel(p)}") has no readable dates — treating it as in force.`);
    }
    if (p.vehicleRestriction) warnings.push(`Sign also says: "${p.vehicleRestriction}".`);
  }

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
  const timeline: TimelineSegment[] = [];
  for (const s of segs) {
    if (s.from >= timelineEnd) break;
    const seg: TimelineSegment = {
      from: iso(s.from),
      to: iso(Math.min(s.to, timelineEnd)),
      status: timelineStatus(s),
      label: timelineLabel(s),
      panels: s.panels,
    };
    const last = timeline[timeline.length - 1];
    if (last && last.status === seg.status && last.label === seg.label) {
      last.to = seg.to;
      last.panels = [...new Set([...last.panels, ...seg.panels])].sort((a, b) => a - b);
    } else timeline.push(seg);
  }

  // Holiday notes relevant to the next 24h.
  for (const n of holidayNotes) {
    if (n.interval.end <= nowMs || n.interval.start >= timelineEnd) continue;
    const lbl = panelLabel(panels[n.panelIndex]!);
    switch (n.kind) {
      case "unknown_sensitive":
        warnings.push("Not sure if today is a public holiday — assuming the sign's usual times apply today.");
        break;
      case "lifted":
        warnings.push(`Public holiday — assuming the ${lbl} times don't apply. Double-check the sign.`);
        break;
      case "excluded":
        reasons.push(`Public holidays are excepted on the ${lbl} panel.`);
        warnings.push(`Public holiday — the ${lbl} times don't apply today. Double-check the sign.`);
        break;
      case "included":
        reasons.push(`The ${lbl} panel also applies on public holidays.`);
        break;
      case "kept":
        warnings.push(`Public holiday — ${lbl} may still apply, so we're treating it as in force.`);
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

  const tempActiveNow = cur.primary?.temporary || cur.panels.some((i) => panels[i]!.temporary);
  if (tempActiveNow && cur.panels.some((i) => !panels[i]!.temporary)) {
    warnings.push("A temporary sign overrides the regular sign right now.");
  } else if (tempActiveNow) {
    warnings.push("A temporary sign is in force right now.");
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

    const maxStay = leaveBy != null ? Math.floor((leaveBy - nowMs) / MINUTE) : null;
    const paymentNow = cur.severity === LIMITED && cur.payment != null;
    const permitRequired = cur.permitUsed != null;
    const parts: string[] = [];

    const leaveSoon = leaveBy != null && leaveSeg != null && leaveBy - nowMs <= TIMELINE_MS;
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
    } else if (cur.severity === LIMITED && cur.limit == null) parts.push("No time limit.");
    else parts.push("No restrictions right now.");

    if (paymentNow) parts.push(PAYMENT_INSTRUCTION[cur.payment as Exclude<PaymentMethod, "none">]);
    else {
      const stayEnd = Math.min(leaveBy ?? timelineEnd, timelineEnd);
      const paySeg = segs.find((s) => s.from > nowMs && s.from < stayEnd && s.severity === LIMITED && s.payment != null);
      if (paySeg) parts.push(`Pay from ${fmt(paySeg.from)}.`);
    }
    if (cur.permitUsed === "area") parts.push("Your permit exempts you — display it.");
    if (cur.permitUsed === "disability") parts.push("Display your disability permit.");
    if (cur.note) parts.push(cur.note);

    if (moveBy) parts.push(moveBy);
    if (!leaveSoon) {
      const nextRestr = segs.find((s) => s.from > nowMs && timelineStatus(s) !== "allowed");
      if (nextRestr) parts.push(`Next restriction: ${lowerFirst(timelineLabel(nextRestr))} from ${fmt(nextRestr.from)}.`);
    }

    const allAllowed24 = timeline.every((t) => t.status === "allowed");
    let status: SideVerdict["status"] =
      allAllowed24 && !permitRequired && (leaveBy == null || leaveBy - nowMs > TIMELINE_MS) && !cur.note
        ? "yes"
        : "yes_with_conditions";
    if (status === "yes" && expired.size > 0) status = "yes_with_conditions";

    let headline: string;
    if (status === "yes") headline = "You can park";
    else if (maxStay != null && maxStay <= 4 * 60) headline = `Yes — ${formatShortDuration(maxStay)}`;
    else if (maxStay != null && leaveBy != null && maxStay < 24 * 60) headline = `Yes — until ${formatClock(toLocalMinutes(leaveBy, tz))}`;
    else if (paymentNow) headline = "Yes — pay to park";
    else if (permitRequired) headline = "Yes — with permit";
    else headline = "You can park";

    let fits: boolean | null = null;
    if (ctx.intendedStayMinutes != null) {
      fits = maxStay == null || ctx.intendedStayMinutes <= maxStay;
      if (!fits) {
        warnings.push(
          `You planned ${formatDuration(ctx.intendedStayMinutes)} — the most you can stay is ${formatDuration(maxStay!)}.`,
        );
      }
    }

    base = {
      ...emptySide(),
      status,
      headline,
      summary: parts.join(" "),
      maxStayMinutes: maxStay,
      leaveBy: leaveBy != null ? iso(leaveBy) : null,
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
  const ctx = normaliseContext(context);
  const opts: Required<EvaluateOptions> = {
    minConfidenceForYes: options.minConfidenceForYes ?? DEFAULT_MIN_CONFIDENCE_FOR_YES,
    minConfidence: options.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
  };
  const wrap = (sv: SideVerdict, side: Side | "unknown", bySide: Verdict["bySide"] = null): Verdict => ({
    ...sv,
    side,
    bySide,
    evaluatedAt: iso(ctx.nowMs),
    timeZone: ctx.tz,
  });
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

  const leftSet = r.panels.map((p, i) => (appliesToSide(p, "left") ? i : -1)).filter((i) => i >= 0);
  const rightSet = r.panels.map((p, i) => (appliesToSide(p, "right") ? i : -1)).filter((i) => i >= 0);
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
  const combined: SideVerdict = {
    ...emptySide(),
    status: left.status === "no" && right.status === "no" ? "no" : "unsure",
    headline: left.status === "no" && right.status === "no" ? "No — either side" : "Depends on side",
    summary:
      left.status === "no" && right.status === "no"
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
  return wrap(combined, "unknown", bySide);
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

/**
 * Verdict → what the Result screen shows. Pure (no React Native), unit tested.
 * Every tone carries an icon and words so colour is never the only signal.
 */
import {
  formatDuration,
  formatInstant,
  panelLabel,
  type PaymentMethod,
  type SideVerdict,
  type SignReading,
  type Verdict,
  type VerdictStatus,
} from "@parking-lingo/core";
import type { Tone } from "../theme/tokens";
import { formatCountdown, spokenCountdown } from "./format";

export type ChipTone = "good" | "caution" | "danger" | "info";

export interface FactChip {
  key: "stay" | "leaveBy" | "nextAllowed" | "payment" | "permit" | "towAway" | "noLimit";
  /** Ionicons glyph. */
  icon: string;
  label: string;
  /** For time tiles: small caption + big value ("Leave by" / "3:00 pm"). */
  caption: string | null;
  value: string | null;
  /** Static secondary line (e.g. "Display it on the dash"). */
  detail: string | null;
  tone: ChipTone;
  /** If set, the chip shows a live countdown to this ISO instant. */
  countdownTo: string | null;
}

export type WarningKind = "temporary" | "tow" | "legibility" | "holiday" | "general";

export interface WarningItem {
  kind: WarningKind;
  text: string;
  /** Core is unsure whether today is a public holiday and it changes the answer: offer the inline toggle. */
  holidayQuestion: boolean;
}

export interface TemporaryAlert {
  state: "active" | "upcoming";
  title: string;
  detail: string;
}

/** Unsure answers that need the user to read a specific part of the sign (not "rescan"). */
export interface SpecialUnsure {
  kind: "temporary_dates" | "vehicle_note";
  title: string;
  detail: string;
  /** Text to show prominently: the temporary panel as read, or the sign's vehicle note. */
  quote: string | null;
}

export interface VerdictViewModel {
  special: SpecialUnsure | null;
  tone: Tone;
  /** Short uppercase word shown with the icon: "YES", "NO", "NOT SURE"... */
  statusWord: string;
  /** Second line of the badge, e.g. "Conditions apply". */
  statusQualifier: string | null;
  icon: string;
  /** The engine headline. */
  headline: string;
  /** Core's shortLabel: the headline without the yes/no part ("Up to 2 hrs", "Clearway"). */
  heroHeadline: string;
  /** e.g. "Public holiday today: Christmas Day", when the calendar says today is one. */
  holidayNote: string | null;
  /** Whether the hero shows headline + summary (hidden when the side selector says it better). */
  showDetails: boolean;
  summary: string;
  chips: FactChip[];
  warnings: WarningItem[];
  temporaryAlert: TemporaryAlert | null;
  haptic: "success" | "warning" | "error";
  /** Full sentence for VoiceOver on the hero. */
  accessibilityLabel: string;
}

export function toneFor(status: VerdictStatus, dependsOnSide: boolean): Tone {
  if (dependsOnSide) return "side";
  switch (status) {
    case "yes":
      return "yes";
    case "yes_with_conditions":
      return "conditional";
    case "no":
      return "no";
    case "unsure":
      return "unsure";
  }
}

const TONE_META: Record<Tone, { word: string; qualifier: string | null; icon: string; haptic: VerdictViewModel["haptic"] }> = {
  yes: { word: "YES", qualifier: null, icon: "checkmark-circle", haptic: "success" },
  conditional: { word: "YES", qualifier: "Conditions apply", icon: "alert-circle", haptic: "warning" },
  no: { word: "NO", qualifier: "Don't park here", icon: "close-circle", haptic: "error" },
  unsure: { word: "NOT SURE", qualifier: "Check the sign yourself", icon: "help-circle", haptic: "warning" },
  temporary: { word: "CHECK SIGN", qualifier: "Read the temporary sign", icon: "construct", haptic: "warning" },
  side: { word: "IT DEPENDS", qualifier: "on which side of the pole you park", icon: "swap-horizontal", haptic: "warning" },
};

const PAYMENT_CHIP: Record<Exclude<PaymentMethod, "none">, { label: string; detail: string }> = {
  meter: { label: "Pay at meter", detail: "Paid parking" },
  ticket: { label: "Buy a ticket", detail: "Display it on the dash" },
  pay_by_phone: { label: "Pay by app", detail: "Or by phone" },
  paid_unspecified: { label: "Paid parking", detail: "Payment required" },
};

/** True when the combined verdict asks the user to choose a side. */
export function dependsOnSide(v: Verdict): boolean {
  return v.needsSide && v.bySide !== null;
}

export function classifyWarning(text: string): WarningKind {
  const t = text.toLowerCase();
  if (t.includes("temporary") || t.includes("roadwork") || t.includes("road work") || t.includes("works zone")) return "temporary";
  if (t.includes("public holiday")) return "holiday";
  if (t.includes("tow") || t.includes("clearway")) return "tow";
  if (t.includes("hard to read") || t.includes("confidence") || t.includes("legib") || t.includes("misread")) return "legibility";
  return "general";
}

const WARNING_ORDER: Record<WarningKind, number> = { temporary: 0, tow: 1, legibility: 2, general: 3, holiday: 4 };

/** Warnings where the user's own knowledge of today's holiday status settles it. */
export function isHolidayQuestion(text: string): boolean {
  return (
    /^not sure if .* public holiday/i.test(text) ||
    /public holiday in only part of the state/i.test(text) ||
    /local and regional public holidays aren't known/i.test(text)
  );
}

/** One line for "How we read the sign" about which public-holiday calendar was used. */
export function holidayCalendarLine(v: Pick<Verdict, "jurisdiction" | "jurisdictionSource" | "publicHolidayToday">, reading: SignReading | null): string {
  const st = (j: string | null | undefined) => (j ?? "").replace(/^AU-/, "");
  const unknownToday = v.publicHolidayToday === "unknown" ? " Today's holiday status is unclear, so the sign's restrictions are assumed to apply." : "";
  if (!v.jurisdiction) return `State unknown — public holidays couldn't be checked; restrictions are assumed to apply.${unknownToday}`;
  if (v.jurisdictionSource === "conflict") {
    return `The sign looks like ${st(reading?.jurisdictionHint) || "another state"}, but this phone's time zone suggests ${st(v.jurisdiction)} — holidays in only one of them are treated as uncertain (restrictions apply).${unknownToday}`;
  }
  const how = v.jurisdictionSource === "context" ? "set for this scan" : v.jurisdictionSource === "reading" ? "from the sign" : "from your time zone";
  return `Public holidays: ${st(v.jurisdiction)} calendar (${how}). Local and regional holidays aren't included.${unknownToday}`;
}

export function buildWarnings(warnings: readonly string[]): WarningItem[] {
  const seen = new Set<string>();
  return warnings
    .filter((w) => {
      if (seen.has(w)) return false;
      seen.add(w);
      return true;
    })
    .map((text) => ({ kind: classifyWarning(text), text, holidayQuestion: isHolidayQuestion(text) }))
    .sort((a, b) => WARNING_ORDER[a.kind] - WARNING_ORDER[b.kind]);
}

const OVERRIDE_WARNING = "A temporary sign overrides the regular sign right now.";
const TEMP_ACTIVE_WARNING = "A temporary sign is in force right now.";

/**
 * Banner for temporary signs (roadworks, event clearways). Whether a temporary sign is
 * actually driving the answer comes from core's warnings — the app doesn't re-derive it.
 */
export function buildTemporaryAlert(v: SideVerdict, reading: SignReading | null, nowMs: number, timeZone: string): TemporaryAlert | null {
  const overrides = v.warnings.includes(OVERRIDE_WARNING);
  const inForce = overrides || v.warnings.includes(TEMP_ACTIVE_WARNING);
  if (inForce) {
    const driving = reading
      ? v.evidence.find((e) => e.state === "active_now" && e.drivesDecision && reading.panels[e.panelIndex]?.temporary)
      : undefined;
    const p = driving && reading ? reading.panels[driving.panelIndex] : undefined;
    const what = p ? panelLabel(p) : "A temporary sign";
    return {
      state: "active",
      title: "Temporary sign in force",
      detail: overrides
        ? `${what} overrides the regular sign${p?.towAway ? " — tow-away" : ""}.`
        : `${what} applies right now${p?.towAway ? " — tow-away" : ""}.`,
    };
  }
  const next = v.upcomingTemporary[0];
  if (next) {
    const from = Date.parse(next.from);
    const to = next.to ? formatInstant(Date.parse(next.to), nowMs, timeZone) : null;
    return {
      state: "upcoming",
      title: "Temporary sign coming up",
      detail: `${next.label} from ${formatInstant(from, nowMs, timeZone)}${to ? ` to ${to}` : ""}.`,
    };
  }
  return null;
}

export function buildChips(v: SideVerdict, nowMs: number, timeZone: string): FactChip[] {
  const chips: FactChip[] = [];
  const parkable = v.status === "yes" || v.status === "yes_with_conditions";

  if (parkable) {
    // Most time-critical fact first.
    if (v.leaveBy) {
      chips.push({
        key: "leaveBy",
        icon: "alarm-outline",
        label: `Leave by ${formatInstant(Date.parse(v.leaveBy), nowMs, timeZone)}`,
        caption: "Leave by",
        value: formatInstant(Date.parse(v.leaveBy), nowMs, timeZone),
        detail: null,
        tone: "caution",
        countdownTo: v.leaveBy,
      });
    }
    // Core sets maxStayMinutes only when you must move within 24 h.
    if (v.maxStayMinutes != null) {
      chips.push({
        key: "stay",
        icon: "hourglass-outline",
        label: `Up to ${formatDuration(v.maxStayMinutes)}`,
        caption: null,
        value: null,
        detail: v.currentLimitMinutes != null && v.currentLimitMinutes !== v.maxStayMinutes ? `Sign limit ${formatDuration(v.currentLimitMinutes)}` : null,
        tone: "caution",
        countdownTo: null,
      });
    } else if (v.leaveBy == null && v.unrestrictedUntil) {
      // Unrestricted now; a limit or fee (not a prohibition) starts later.
      const at = formatInstant(Date.parse(v.unrestrictedUntil), nowMs, timeZone);
      chips.push({ key: "noLimit", icon: "infinite-outline", label: `No limit until ${at}`, caption: null, value: null, detail: "Then the sign's limits apply", tone: "good", countdownTo: null });
    } else if (v.leaveBy == null) {
      chips.push({ key: "noLimit", icon: "infinite-outline", label: "No time limit", caption: null, value: null, detail: "For at least the next 7 days", tone: "good", countdownTo: null });
    }
  } else if (v.status === "no" && v.nextAllowedAt) {
    chips.push({
      key: "nextAllowed",
      icon: "time-outline",
      label: `Can park from ${formatInstant(Date.parse(v.nextAllowedAt), nowMs, timeZone)}`,
      caption: "Can park from",
      value: formatInstant(Date.parse(v.nextAllowedAt), nowMs, timeZone),
      detail: null,
      tone: "info",
      countdownTo: v.nextAllowedAt,
    });
  }

  if (v.paymentRequired) {
    const p = PAYMENT_CHIP[v.payment && v.payment !== "none" ? v.payment : "paid_unspecified"];
    chips.push({ key: "payment", icon: "card-outline", label: p.label, caption: null, value: null, detail: p.detail, tone: "caution", countdownTo: null });
  }
  if (v.permitRequired) {
    chips.push({ key: "permit", icon: "id-card-outline", label: "Permit required", caption: null, value: null, detail: "Display your permit", tone: "caution", countdownTo: null });
  }
  if (v.towAwayRisk) {
    chips.push({ key: "towAway", icon: "car-sport-outline", label: "Tow-away zone", caption: null, value: null, detail: "Vehicles are towed", tone: "danger", countdownTo: null });
  }
  return chips;
}

export const CHECK_TEMPORARY_LABEL = "Check temporary sign";

/** Detect core's "read the sign" unsure states: unclear temporary-sign dates, unclear vehicle wording. */
export function buildSpecialUnsure(v: SideVerdict, reading: SignReading | null): SpecialUnsure | null {
  if (v.status !== "unsure") return null;
  if (v.shortLabel === CHECK_TEMPORARY_LABEL || v.headline === CHECK_TEMPORARY_LABEL) {
    const temp = reading?.panels.filter((p) => p.temporary) ?? [];
    return {
      kind: "temporary_dates",
      title: "Read the temporary sign",
      detail: "Its dates are unclear, so we can't tell if it applies today. If it does, it overrides the regular sign — follow it.",
      quote: temp.length ? temp.map((p) => p.rawText).filter(Boolean).join("  ·  ") : null,
    };
  }
  const note = reading?.panels.map((p) => p.vehicleRestriction).find((n): n is string => !!n && v.summary.includes(`"${n}"`));
  if (note) {
    return {
      kind: "vehicle_note",
      title: "Check the vehicle note",
      detail: "The sign limits which vehicles may park here and we couldn't match it to yours. Read it before parking.",
      quote: note,
    };
  }
  return null;
}

export function buildVerdictViewModel(v: Verdict, reading: SignReading | null, nowMs: number): VerdictViewModel {
  const special0 = v.status === "unsure" ? buildSpecialUnsure(v, reading) : null;
  const tone = special0?.kind === "temporary_dates" ? "temporary" : toneFor(v.status, dependsOnSide(v));
  const meta = TONE_META[tone];
  const chips = buildChips(v, nowMs, v.timeZone);
  // For unclear temporary dates, the special card replaces the "overrides" banner (it may not apply).
  const temporaryAlert = special0?.kind === "temporary_dates" ? null : buildTemporaryAlert(v, reading, nowMs, v.timeZone);
  let warnings = buildWarnings(v.warnings);
  const special = special0;
  // The banner already says this; don't repeat it in the list.
  if (temporaryAlert?.state === "active" || special) warnings = warnings.filter((w) => w.text !== OVERRIDE_WARNING && w.text !== TEMP_ACTIVE_WARNING);
  const a11yParts = [`${meta.word.toLowerCase()}. ${v.headline}.`, v.summary];
  for (const c of chips) {
    if (c.countdownTo) {
      const ms = Date.parse(c.countdownTo) - nowMs;
      a11yParts.push(`${c.label}, in ${spokenCountdown(ms)}.`);
    } else {
      a11yParts.push(`${c.label}.`);
    }
  }
  return {
    special,
    tone,
    statusWord: special?.kind === "vehicle_note" ? "CHECK SIGN" : meta.word,
    statusQualifier: special?.kind === "vehicle_note" ? "Read the vehicle note" : meta.qualifier,
    icon: special?.kind === "vehicle_note" ? "car-outline" : meta.icon,
    headline: v.headline,
    heroHeadline: v.shortLabel,
    holidayNote: v.publicHolidayToday === true ? `Public holiday today${v.publicHolidayName ? `: ${v.publicHolidayName}` : ""}` : null,
    // The side picker or the read-the-sign card says it better than a repeated headline.
    showDetails: tone !== "side" && !special,
    summary: v.summary,
    chips,
    warnings,
    temporaryAlert,
    haptic: meta.haptic,
    accessibilityLabel: `Parking verdict: ${a11yParts.join(" ")}`,
  };
}

/** Compact per-side summary for the side selector. */
export function sideSummary(v: SideVerdict, nowMs: number, timeZone: string): { tone: Tone; word: string; icon: string; headline: string; detail: string | null } {
  const tone = toneFor(v.status, false);
  const meta = TONE_META[tone];
  let detail: string | null = null;
  if ((v.status === "yes" || v.status === "yes_with_conditions") && v.leaveBy) {
    detail = `Leave by ${formatInstant(Date.parse(v.leaveBy), nowMs, timeZone)}`;
  } else if (v.status === "no" && v.nextAllowedAt) {
    detail = `Until ${formatInstant(Date.parse(v.nextAllowedAt), nowMs, timeZone)}`;
  }
  return { tone, word: meta.word, icon: meta.icon, headline: v.shortLabel, detail };
}

export { formatCountdown };

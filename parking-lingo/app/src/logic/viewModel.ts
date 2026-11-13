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
}

export interface TemporaryAlert {
  state: "active" | "upcoming";
  title: string;
  detail: string;
}

export interface VerdictViewModel {
  tone: Tone;
  /** Short uppercase word shown with the icon: "YES", "NO", "NOT SURE"... */
  statusWord: string;
  /** Second line of the badge, e.g. "Conditions apply". */
  statusQualifier: string | null;
  icon: string;
  /** The engine headline. */
  headline: string;
  /** Headline without a "Yes — "/"No — " prefix that repeats the status word. */
  heroHeadline: string;
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
  return v.bySide !== null && v.side === "unknown" && v.headline === "Depends on side";
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

export function buildWarnings(warnings: readonly string[]): WarningItem[] {
  const seen = new Set<string>();
  return warnings
    .filter((w) => {
      if (seen.has(w)) return false;
      seen.add(w);
      return true;
    })
    .map((text) => ({ kind: classifyWarning(text), text }))
    .sort((a, b) => WARNING_ORDER[a.kind] - WARNING_ORDER[b.kind]);
}

/** Banner for temporary signs (roadworks, event clearways) in force now or coming up. */
export function buildTemporaryAlert(v: SideVerdict, reading: SignReading | null, nowMs: number, timeZone: string): TemporaryAlert | null {
  if (reading) {
    const active = v.evidence.find((e) => e.state === "active_now" && reading.panels[e.panelIndex]?.temporary);
    if (active) {
      const p = reading.panels[active.panelIndex]!;
      return {
        state: "active",
        title: "Temporary sign in force",
        detail: `${panelLabel(p)} overrides the regular sign${p.towAway ? " — tow-away" : ""}.`,
      };
    }
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
  if (reading) {
    const soon = v.evidence.find((e) => e.state === "upcoming" && reading.panels[e.panelIndex]?.temporary && e.nextStart);
    if (soon && soon.nextStart) {
      return {
        state: "upcoming",
        title: "Temporary sign coming up",
        detail: `${soon.label} from ${formatInstant(Date.parse(soon.nextStart), nowMs, timeZone)}.`,
      };
    }
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
    // Beyond a day the "Leave by" tile says it better than "Up to 44 hr 14 min".
    if (v.maxStayMinutes != null && v.maxStayMinutes < 24 * 60) {
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
    } else if (v.maxStayMinutes == null && v.leaveBy == null) {
      chips.push({ key: "noLimit", icon: "infinite-outline", label: "No time limit", caption: null, value: null, detail: "For the next 7 days", tone: "good", countdownTo: null });
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

/** "Yes — 2 hrs" → "2 hrs", "No — clearway" → "Clearway"; others unchanged. */
export function stripStatusPrefix(headline: string): string {
  const m = /^(yes|no)\s*[—–-]\s*(.+)$/i.exec(headline.trim());
  if (!m || !m[2]) return headline;
  const rest = m[2];
  // Keep "No — either side" style phrases readable.
  if (/^either side$/i.test(rest)) return headline;
  // "Yes — 2 hrs" → "Up to 2 hrs"
  if (/^\d/.test(rest)) return `Up to ${rest}`;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

export function buildVerdictViewModel(v: Verdict, reading: SignReading | null, nowMs: number): VerdictViewModel {
  const tone = toneFor(v.status, dependsOnSide(v));
  const meta = TONE_META[tone];
  const chips = buildChips(v, nowMs, v.timeZone);
  const temporaryAlert = buildTemporaryAlert(v, reading, nowMs, v.timeZone);
  let warnings = buildWarnings(v.warnings);
  // The banner already says this; don't repeat it in the list.
  if (temporaryAlert?.state === "active") warnings = warnings.filter((w) => !/overrides the regular sign/i.test(w.text));
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
    tone,
    statusWord: meta.word,
    statusQualifier: meta.qualifier,
    icon: meta.icon,
    headline: v.headline,
    heroHeadline: tone === "yes" || tone === "conditional" || tone === "no" ? stripStatusPrefix(v.headline) : v.headline,
    showDetails: tone !== "side",
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
  return { tone, word: meta.word, icon: meta.icon, headline: v.headline, detail };
}

export { formatCountdown };

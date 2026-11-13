import type { PaymentMethod } from "./schema";

export type Side = "left" | "right";
export type VehicleType = "car" | "motorcycle" | "commercial" | "truck" | "bus" | "taxi";

/** Everything the engine needs besides the sign reading. Time is injected. */
export interface ParkingContext {
  /** The current instant (Date, ISO-8601 string with offset/Z, or epoch ms). */
  now: Date | string | number;
  /** IANA zone of the sign's location, e.g. "Australia/Sydney". */
  timeZone: string;
  /**
   * Whether *today* (local date of `now`) is a public holiday. Default 'unknown'.
   * A boolean overrides the built-in calendar for today; 'unknown' (or omitted)
   * means "use the calendar for the resolved jurisdiction, if any".
   */
  isPublicHoliday?: boolean | "unknown";
  /**
   * Extra known public holidays as local 'YYYY-MM-DD' dates (e.g. regional show
   * days). These are always treated as holidays, on top of the calendar.
   */
  publicHolidayDates?: string[];
  /**
   * Jurisdiction for the holiday calendar, e.g. "AU-NSW" (also accepts "NSW").
   * Falls back to reading.jurisdictionHint, then to the time zone where safe
   * (Australia/Sydney -> NSW, Melbourne -> VIC, Brisbane -> QLD, ...).
   * Without any jurisdiction, today's holiday status is unknown and other days
   * are assumed not to be holidays.
   */
  jurisdiction?: string | null;
  /** Side of the pole the user wants to park on, as seen facing the sign. Default 'unknown'. */
  side?: Side | "unknown";
  /** Permit area codes held, e.g. ["12", "Area 5"]. Default []. */
  permits?: string[];
  /** Holds a valid disability parking permit (MPS). Default false. */
  hasDisabilityPermit?: boolean;
  /** Default 'car'. 'commercial' = goods-carrying van/ute registered for business use. */
  vehicleType?: VehicleType;
  /** Electric vehicle that will be charging (for EV-charging bays). Default false. */
  isElectricVehicle?: boolean;
  /** How long the user wants to stay, if known. */
  intendedStayMinutes?: number | null;
}

export interface EvaluateOptions {
  /** Below this (overall or relevant panel), the engine never answers yes. Default 0.75. */
  minConfidenceForYes?: number;
  /** Below this, the engine answers 'unsure' even for 'no'. Default 0.5. */
  minConfidence?: number;
}

export type VerdictStatus = "yes" | "yes_with_conditions" | "no" | "unsure";

/** For drawing a bar: green / amber / red. */
export type TimelineStatus = "allowed" | "limited" | "prohibited";

export interface TimelineSegment {
  /** ISO instant (UTC, 'Z'). */
  from: string;
  to: string;
  status: TimelineStatus;
  /** Short label, e.g. "2P · Meter", "Clearway (tow-away)", "No restrictions". */
  label: string;
  /** Indexes into reading.panels that are in force during this segment. */
  panels: number[];
}

export interface UpcomingRestriction {
  from: string;
  to: string | null;
  label: string;
  panelIndex: number;
}

export type PanelEvidenceState =
  | "active_now"
  | "upcoming"
  | "not_soon"
  | "expired"
  | "other_side";

export interface PanelEvidence {
  panelIndex: number;
  label: string;
  state: PanelEvidenceState;
  /** True if this panel governs the answer right now or determines leaveBy. */
  drivesDecision: boolean;
  /** Next time this panel comes into force (ISO), if within the look-ahead. */
  nextStart: string | null;
}

/** The answer for one side of the pole (or for both, when they agree). */
export interface SideVerdict {
  status: VerdictStatus;
  /** ≤ ~4 words, e.g. "You can park", "No — clearway". */
  headline: string;
  /**
   * The headline without the yes/no part, for showing under a big YES/NO:
   * "Up to 2 hrs", "Until 6:00 am", "Pay to park", "With permit", "No restrictions",
   * "Clearway", "No stopping", "Loading zone", "Temporary sign", "Rescan", "Depends on side".
   */
  shortLabel: string;
  /** One or a few short plain-English sentences. */
  summary: string;
  /**
   * Longest stay starting now, in minutes — set only when you must move within the
   * next 24 hours (i.e. `leaveBy` is within 24 h). null when parking isn't allowed,
   * or when there is no deadline within 24 h (see `leaveBy` / `unrestrictedUntil`).
   */
  maxStayMinutes: number | null;
  /**
   * ISO instant: earliest of time-limit expiry or start of the next prohibiting
   * restriction, searched up to 8 days ahead (null = none found).
   */
  leaveBy: string | null;
  /**
   * When parking is currently unrestricted for you (timeline "allowed" now): the ISO
   * instant the next restriction of any kind (limit, fee, prohibition) starts,
   * within 8 days. null if parking is restricted now or nothing starts within 8 days.
   */
  unrestrictedUntil: string | null;
  /** ISO instant when the rules for this spot next change (end of current segment). */
  validUntil: string | null;
  /** When status is 'no': ISO instant parking next becomes allowed (within 7 days), else null. */
  nextAllowedAt: string | null;
  /** The time limit printed on the sign currently in force (minutes), if any. */
  currentLimitMinutes: number | null;
  paymentRequired: boolean;
  payment: PaymentMethod | null;
  /** True if the answer relies on the user's permit (area permit / disability permit). */
  permitRequired: boolean;
  towAwayRisk: boolean;
  /** Whether `intendedStayMinutes` fits; null if not given or not parkable. */
  fitsIntendedStay: boolean | null;
  reasons: string[];
  warnings: string[];
  /** Ordered, contiguous segments covering the next 24 hours. Empty when 'unsure'. */
  timeline: TimelineSegment[];
  /** Dated temporary restrictions starting after now (may be beyond 24h). */
  upcomingTemporary: UpcomingRestriction[];
  evidence: PanelEvidence[];
}

export interface Verdict extends SideVerdict {
  /** Side this verdict was computed for ('unknown' if the side doesn't matter or wasn't given). */
  side: Side | "unknown";
  /** True when the answer differs by side of the pole: ask the user, then use `bySide`. */
  needsSide: boolean;
  /** Jurisdiction used for the holiday calendar, e.g. "AU-NSW" (null if unknown). */
  jurisdiction: string | null;
  /** Whether today is a public holiday as used by the engine. */
  publicHolidayToday: boolean | "unknown";
  /** Name of today's public holiday from the calendar, if any. */
  publicHolidayName: string | null;
  /** Per-side answers when the side is unknown and the panels differ by side. */
  bySide: { left: SideVerdict; right: SideVerdict } | null;
  evaluatedAt: string;
  timeZone: string;
}

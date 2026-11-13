import type { PaymentMethod } from "./schema";

export type Side = "left" | "right";
export type VehicleType = "car" | "motorcycle" | "commercial" | "truck" | "bus" | "taxi";

/** Everything the engine needs besides the sign reading. Time is injected. */
export interface ParkingContext {
  /** The current instant (Date, ISO-8601 string with offset/Z, or epoch ms). */
  now: Date | string | number;
  /** IANA zone of the sign's location, e.g. "Australia/Sydney". */
  timeZone: string;
  /** Whether *today* (local date of `now`) is a public holiday. Default 'unknown'. */
  isPublicHoliday?: boolean | "unknown";
  /**
   * Extra known public holidays as local 'YYYY-MM-DD' dates (used for days in the
   * timeline other than today). Days not listed (other than today) are assumed
   * not to be public holidays.
   */
  publicHolidayDates?: string[];
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
  /** One or a few short plain-English sentences. */
  summary: string;
  /** Longest stay starting now, in minutes (null = no limit within the next 7 days or not parkable). */
  maxStayMinutes: number | null;
  /** ISO instant: earliest of time-limit expiry or start of the next prohibiting restriction. */
  leaveBy: string | null;
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
  /** Per-side answers when the side is unknown and the panels differ by side. */
  bySide: { left: SideVerdict; right: SideVerdict } | null;
  evaluatedAt: string;
  timeZone: string;
}

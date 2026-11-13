/**
 * User settings (pure): defaults, tolerant parsing of persisted JSON, and mapping
 * settings → engine/server context.
 */
import { normalisePermit, type ParkingContext, type Side, type VehicleType } from "@parking-lingo/core";
import type { ServerContext } from "../api/client";

export const VEHICLE_TYPES: readonly VehicleType[] = ["car", "motorcycle", "commercial", "truck", "bus", "taxi"];
export const VEHICLE_LABEL: Record<VehicleType, string> = {
  car: "Car",
  motorcycle: "Motorbike",
  commercial: "Van / ute (business)",
  truck: "Truck",
  bus: "Bus",
  taxi: "Taxi",
};
export const REMINDER_LEAD_OPTIONS = [5, 10, 15, 30] as const;

export interface Settings {
  /** Residential/area permit codes as the user typed them, e.g. ["12", "Area 5"]. */
  permits: string[];
  hasDisabilityPermit: boolean;
  vehicleType: VehicleType;
  isElectricVehicle: boolean;
  /** Minutes before "leave by" that the reminder fires. */
  reminderLeadMinutes: number;
  /** Show demo signs on the scan screen. */
  demoMode: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  permits: [],
  hasDisabilityPermit: false,
  vehicleType: "car",
  isElectricVehicle: false,
  reminderLeadMinutes: 10,
  demoMode: false,
};

export const SETTINGS_STORAGE_KEY = "parking-lingo/settings/v1";

/** Parse persisted settings, falling back to defaults field by field. Never throws. */
export function parseStoredSettings(raw: string | null | undefined): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (!data || typeof data !== "object") return { ...DEFAULT_SETTINGS };
  const d = data as Record<string, unknown>;
  const permits = Array.isArray(d.permits)
    ? dedupePermits(d.permits.filter((p): p is string => typeof p === "string"))
    : DEFAULT_SETTINGS.permits;
  const lead = typeof d.reminderLeadMinutes === "number" && d.reminderLeadMinutes > 0 && d.reminderLeadMinutes <= 120
    ? Math.round(d.reminderLeadMinutes)
    : DEFAULT_SETTINGS.reminderLeadMinutes;
  return {
    permits,
    hasDisabilityPermit: typeof d.hasDisabilityPermit === "boolean" ? d.hasDisabilityPermit : DEFAULT_SETTINGS.hasDisabilityPermit,
    vehicleType:
      typeof d.vehicleType === "string" && (VEHICLE_TYPES as readonly string[]).includes(d.vehicleType)
        ? (d.vehicleType as VehicleType)
        : DEFAULT_SETTINGS.vehicleType,
    isElectricVehicle: typeof d.isElectricVehicle === "boolean" ? d.isElectricVehicle : DEFAULT_SETTINGS.isElectricVehicle,
    reminderLeadMinutes: lead,
    demoMode: typeof d.demoMode === "boolean" ? d.demoMode : DEFAULT_SETTINGS.demoMode,
  };
}

/** Remove blanks and duplicates (by normalised code: "Area 012" == "12"), keeping the first spelling. */
export function dedupePermits(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const t = raw.trim();
    const key = normalisePermit(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** "12, Area 5; 7" → ["12", "Area 5", "7"]. Commas, semicolons and newlines separate entries. */
export function parsePermitInput(text: string): string[] {
  return dedupePermits(text.split(/[,;\n]+/));
}

export interface ContextInputs {
  now: Date | number | string;
  timeZone: string;
  side?: Side | "unknown";
  isPublicHoliday?: boolean | "unknown";
  /** Per-scan overrides (e.g. a demo fixture's permits) applied on top of settings. */
  overrides?: Partial<ParkingContext>;
}

/** Settings + scan state → the engine's ParkingContext. */
export function buildContext(settings: Settings, input: ContextInputs): ParkingContext {
  const ctx: ParkingContext = {
    now: input.now,
    timeZone: input.timeZone,
    side: input.side ?? "unknown",
    permits: [...settings.permits],
    hasDisabilityPermit: settings.hasDisabilityPermit,
    vehicleType: settings.vehicleType,
    isElectricVehicle: settings.isElectricVehicle,
    isPublicHoliday: input.isPublicHoliday ?? "unknown",
  };
  const o = input.overrides;
  if (o) {
    if (o.permits) ctx.permits = dedupePermits([...(ctx.permits ?? []), ...o.permits]);
    if (o.hasDisabilityPermit !== undefined) ctx.hasDisabilityPermit = o.hasDisabilityPermit;
    if (o.vehicleType !== undefined) ctx.vehicleType = o.vehicleType;
    if (o.isElectricVehicle !== undefined) ctx.isElectricVehicle = o.isElectricVehicle;
    if (o.isPublicHoliday !== undefined && input.isPublicHoliday === undefined) ctx.isPublicHoliday = o.isPublicHoliday;
    if (o.publicHolidayDates) ctx.publicHolidayDates = o.publicHolidayDates;
    if (o.intendedStayMinutes !== undefined) ctx.intendedStayMinutes = o.intendedStayMinutes;
  }
  return ctx;
}

/** Settings → the JSON context sent with /v1/read-sign. */
export function buildServerContext(settings: Settings, input: { now: Date | number; timeZone: string }): ServerContext {
  return {
    now: new Date(input.now).toISOString(),
    timeZone: input.timeZone,
    side: "unknown",
    permits: [...settings.permits],
    hasDisabilityPermit: settings.hasDisabilityPermit,
    vehicleType: settings.vehicleType,
    isElectricVehicle: settings.isElectricVehicle,
    isPublicHoliday: "unknown",
  };
}

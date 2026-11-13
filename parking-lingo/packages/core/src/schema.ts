/**
 * The data contract between the vision model and the rules engine.
 *
 * The LLM only READS the sign into this structure; the deterministic engine
 * (see `evaluate`) DECIDES. Every field is required (nullable where it may be
 * absent) so the schema works directly as a structured-output schema and the
 * model is forced to make an explicit choice for each field.
 */
import { z } from "zod";

export const DAYS_OF_WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const DayOfWeekSchema = z.enum(DAYS_OF_WEEK);
export type DayOfWeek = z.infer<typeof DayOfWeekSchema>;

export const PANEL_KINDS = [
  "no_stopping",
  "no_parking",
  "clearway",
  "timed_parking",
  "loading_zone",
  "bus_zone",
  "taxi_zone",
  "permit_zone",
  "disabled_only",
  "works_zone",
  "mail_zone",
  "truck_zone",
  "motorcycle_only",
  "car_share",
  "ev_charging",
  "bus_lane",
  "transit_lane",
  "special_event",
  "other",
] as const;
export const PanelKindSchema = z
  .enum(PANEL_KINDS)
  .describe(
    "What the panel restricts. timed_parking covers 1/4P, 1/2P, 1P, 2P, 4P and a plain 'P' (parking permitted), " +
      "including metered/ticket parking. special_event = special event clearway/no stopping. " +
      "Use 'other' only if none fit.",
  );
export type PanelKind = z.infer<typeof PanelKindSchema>;

export const PAYMENT_METHODS = ["none", "meter", "ticket", "pay_by_phone", "paid_unspecified"] as const;
export const PaymentMethodSchema = z
  .enum(PAYMENT_METHODS)
  .describe(
    "How parking is paid: 'meter' (METER), 'ticket' (TICKET / pay & display), 'pay_by_phone' (app/phone), " +
      "'paid_unspecified' if the sign says payment applies but not how, 'none' if no payment is mentioned.",
  );
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const VEHICLE_CLASSES = [
  "car",
  "motorcycle",
  "commercial",
  "truck",
  "bus",
  "taxi",
  "authorised",
  "other",
] as const;
export const VehicleClassSchema = z
  .enum(VEHICLE_CLASSES)
  .describe(
    "car = motor cars; commercial = goods/delivery vehicles; authorised = 'authorised vehicles only' " +
      "(council, police, emergency, permit-holding service vehicles); other = anything else (e.g. caravans).",
  );
export type VehicleClass = z.infer<typeof VehicleClassSchema>;

export const ARROWS = ["left", "right", "both", "none"] as const;
export const ArrowSchema = z
  .enum(ARROWS)
  .describe(
    "Arrow on the panel, as seen by a person standing facing the sign: 'left' = arrow points left (applies to " +
      "the kerb left of the pole), 'right', 'both' = double-headed arrow, 'none' = no arrow.",
  );
export type Arrow = z.infer<typeof ArrowSchema>;

export const PUBLIC_HOLIDAY_RULES = ["included", "excluded", "unspecified"] as const;
export const PublicHolidayRuleSchema = z
  .enum(PUBLIC_HOLIDAY_RULES)
  .describe(
    "'included' if the sign says the times also apply on public holidays (e.g. 'Sun & Public Holidays', " +
      "'incl public holidays'); 'excluded' if it says public holidays are excepted; 'unspecified' otherwise.",
  );
export type PublicHolidayRule = z.infer<typeof PublicHolidayRuleSchema>;

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d)?$/;

export const TimeOfDaySchema = z
  .string()
  .regex(TIME_RE)
  .describe("24-hour local time 'HH:mm'. Use '00:00'–'24:00' for a whole day.");

export const ScheduleSchema = z
  .object({
    days: z
      .array(DayOfWeekSchema)
      .min(1)
      .describe("Days the window STARTS on. 'Mon-Fri' => [mon,tue,wed,thu,fri]. All days => all seven."),
    start: TimeOfDaySchema.describe("Window start, local 24h 'HH:mm'."),
    end: TimeOfDaySchema.describe(
      "Window end, local 24h 'HH:mm'. If end <= start the window runs overnight into the next day.",
    ),
    publicHolidays: PublicHolidayRuleSchema,
  })
  .describe("One time window, e.g. '8am-6pm Mon-Fri'.");
export type Schedule = z.infer<typeof ScheduleSchema>;

export const LocalDateTimeStringSchema = z
  .string()
  .regex(LOCAL_DATE_RE)
  .describe("Local date 'YYYY-MM-DD' or local date-time 'YYYY-MM-DDTHH:mm' (no timezone offset).");

export const EffectiveDatesSchema = z
  .object({
    start: LocalDateTimeStringSchema.nullable().describe(
      "First day (or date-time) the sign is in force, or null if not shown/illegible.",
    ),
    end: LocalDateTimeStringSchema.nullable().describe(
      "Last day (inclusive) or end date-time the sign is in force, or null if not shown/illegible.",
    ),
  })
  .describe("Date range printed on a temporary sign.");
export type EffectiveDates = z.infer<typeof EffectiveDatesSchema>;

export const PermitExemptionSchema = z
  .object({
    areaCode: z
      .string()
      .nullable()
      .describe("Permit area/scheme code shown, e.g. '12', 'Area 5', 'S'. null if no area is shown."),
  })
  .describe("Present when the panel says 'Permit holders excepted' (or similar).");
export type PermitExemption = z.infer<typeof PermitExemptionSchema>;

export const SignPanelSchema = z
  .object({
    kind: PanelKindSchema,
    timeLimitMinutes: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe("Time limit in minutes: 1/4P=15, 1/2P=30, 1P=60, 2P=120, 4P=240. null if no limit (plain 'P', No Stopping, etc)."),
    payment: PaymentMethodSchema,
    permitExempt: PermitExemptionSchema.nullable(),
    vehicleRestriction: z
      .string()
      .nullable()
      .describe("Free text vehicle note if any, e.g. 'Buses excepted', 'Motor cars only', 'Goods vehicles'."),
    allowedVehicles: z
      .array(VehicleClassSchema)
      .nullable()
      .optional()
      .describe(
        "ONLY when the panel restricts itself to certain vehicles ('Motor cars only', 'Authorised vehicles only', " +
          "'Buses only'): the classes allowed. null when there is no such 'only' wording — in particular " +
          "'... excepted' notes are NOT 'only' restrictions (keep those in vehicleRestriction only).",
      ),
    schedules: z
      .array(ScheduleSchema)
      .describe("When the panel applies. EMPTY ARRAY means it applies at all times (24/7, 'Anytime')."),
    arrow: ArrowSchema,
    temporary: z
      .boolean()
      .describe(
        "True for temporary signs: roadworks, events, temporary clearways, council temporary notices " +
          "(usually yellow/orange, often with printed or handwritten dates).",
      ),
    effectiveDates: EffectiveDatesSchema.nullable().describe(
      "Dates printed on the sign (mostly temporary signs). null if none are shown or they are illegible.",
    ),
    towAway: z.boolean().describe("True if the panel says 'Tow away', 'Tow-away area' or similar."),
    rawText: z.string().describe("Text on this panel exactly as read, line breaks as ' / '."),
    confidence: z.number().min(0).max(1).describe("0..1 confidence that this panel was read correctly."),
  })
  .describe("One physical plate/panel on the pole.");
export type SignPanel = z.infer<typeof SignPanelSchema>;

export const SignReadingSchema = z
  .object({
    isParkingSign: z.boolean().describe("False if the photo does not show a kerbside parking/stopping sign."),
    panels: z.array(SignPanelSchema).describe("One entry per distinct panel, top to bottom."),
    overallConfidence: z.number().min(0).max(1).describe("0..1 confidence in the whole reading."),
    legibilityIssues: z
      .array(z.string())
      .describe("Problems reading the sign: glare, blur, obstruction, faded text, partly out of frame..."),
    jurisdictionHint: z
      .string()
      .nullable()
      .describe("Likely jurisdiction if evident, e.g. 'AU-NSW', 'AU-VIC', 'AU-QLD'. null if unknown."),
  })
  .describe("Structured reading of a parking sign photo.");
export type SignReading = z.infer<typeof SignReadingSchema>;

/** Validate untrusted model output. */
export function parseSignReading(data: unknown): SignReading {
  return SignReadingSchema.parse(data);
}

export function safeParseSignReading(
  data: unknown,
): { success: true; data: SignReading } | { success: false; error: z.ZodError } {
  const r = SignReadingSchema.safeParse(data);
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

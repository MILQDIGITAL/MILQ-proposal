import { z } from "zod";

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ISO-8601 instant with an explicit offset or Z, e.g. "2026-11-13T09:30:00+11:00".
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/;

export const NowSchema = z
  .union([
    z.string().regex(ISO_INSTANT_RE, "now must be an ISO-8601 instant with an offset or Z, e.g. 2026-11-13T09:30:00+11:00"),
    z.number().int().nonnegative(),
  ])
  .refine((v) => Number.isFinite(new Date(v).getTime()), "now is not a valid instant")
  .describe("Current instant (ISO-8601 with offset, or epoch ms). Defaults to server time.");

export const ContextSchema = z.object({
  now: NowSchema.optional(),
  timeZone: z.string().min(1).max(64).refine(isValidTimeZone, "timeZone must be a valid IANA zone, e.g. Australia/Sydney"),
  side: z.enum(["left", "right", "unknown"]).optional(),
  permits: z.array(z.string().max(32)).max(20).optional(),
  hasDisabilityPermit: z.boolean().optional(),
  vehicleType: z.enum(["car", "motorcycle", "commercial", "truck", "bus", "taxi"]).optional(),
  isElectricVehicle: z.boolean().optional(),
  intendedStayMinutes: z.number().int().positive().max(7 * 24 * 60).nullable().optional(),
  isPublicHoliday: z.union([z.boolean(), z.literal("unknown")]).optional(),
  publicHolidayDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60).optional(),
  jurisdictionHint: z.string().max(32).nullable().optional(),
  /** Jurisdiction for the public-holiday calendar, e.g. "AU-NSW" (also "NSW"). */
  jurisdiction: z.string().max(32).nullable().optional(),
});
export type RequestContext = z.infer<typeof ContextSchema>;

export const ReadSignBodySchema = z.object({
  image: z.object({
    base64: z.string().min(1),
    mediaType: z.string().min(1).max(64),
  }),
  context: ContextSchema,
});
export type ReadSignBody = z.infer<typeof ReadSignBodySchema>;

export const EvaluateBodySchema = z.object({
  // Validated against core's SignReadingSchema separately so errors point at the reading.
  reading: z.unknown(),
  context: ContextSchema,
});

/** Compact, client-friendly list of zod issues. */
export function formatIssues(error: z.ZodError, prefix = ""): { path: string; message: string }[] {
  return error.issues.slice(0, 20).map((i) => ({
    path: [prefix, ...i.path.map(String)].filter(Boolean).join("."),
    message: i.message,
  }));
}

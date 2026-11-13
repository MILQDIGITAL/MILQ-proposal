/** When to fire the "time to move your car" reminder (pure). */
import { formatInstant } from "@parking-lingo/core";

export interface ReminderPlan {
  fireAtMs: number;
  /** Minutes before leaveBy the reminder actually fires (may be less than requested). */
  leadMinutes: number;
  title: string;
  body: string;
}

/**
 * Plan a reminder `leadMinutes` before `leaveBy`. If that moment has already passed,
 * shorten the lead (minimum 1 min before). Returns null when leaveBy is under ~2 min away.
 */
export function planReminder(leaveByIso: string, nowMs: number, leadMinutes: number, timeZone: string): ReminderPlan | null {
  const leaveBy = Date.parse(leaveByIso);
  if (!Number.isFinite(leaveBy)) return null;
  const minutesLeft = Math.floor((leaveBy - nowMs) / 60_000);
  if (minutesLeft < 2) return null;
  const lead = Math.max(1, Math.min(leadMinutes, minutesLeft - 1));
  const at = formatInstant(leaveBy, nowMs, timeZone);
  return {
    fireAtMs: leaveBy - lead * 60_000,
    leadMinutes: lead,
    title: `Move your car in ${lead} min`,
    body: `Parking ends at ${at}. Check the sign before you go.`,
  };
}

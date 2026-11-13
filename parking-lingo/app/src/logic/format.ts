/** Small formatting helpers used by the view models (pure). */

/**
 * Remaining time until a deadline, for live countdowns:
 * "under 1 min", "12 min", "1 h 25 min", "2 h", "1 day 3 h".
 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return "under 1 min";
  if (totalMin < 60) return `${totalMin} min`;
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days} day${days > 1 ? "s" : ""} ${hours} h` : `${days} day${days > 1 ? "s" : ""}`;
  return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
}

/** "in 1 h 25 min" / "time's up" for a future ISO instant. */
export function countdownText(targetIso: string, nowMs: number, past = "time's up"): string {
  const ms = Date.parse(targetIso) - nowMs;
  return ms <= 0 ? past : `in ${formatCountdown(ms)}`;
}

/** VoiceOver-friendly expansion of a countdown ("1 hour 25 minutes"). */
export function spokenCountdown(ms: number): string {
  return formatCountdown(ms)
    .replace(/\bh\b/g, ms >= 7_200_000 ? "hours" : "hour")
    .replace(/\bmin\b/g, "minutes");
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

/** Local hour (0–23) and minute of an instant in an IANA zone. */
export function localHourMinute(ms: number, timeZone: string): { hour: number; minute: number } {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
    partsCache.set(timeZone, f);
  }
  const parts = f.formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return { hour, minute };
}

/** 0 → "12 am", 13 → "1 pm", 12 → "12 pm". */
export function shortHourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${h < 12 ? "am" : "pm"}`;
}

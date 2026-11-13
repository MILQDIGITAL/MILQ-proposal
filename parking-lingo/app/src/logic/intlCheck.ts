/**
 * Runtime self-check for the Intl features @parking-lingo/core relies on
 * (Intl.DateTimeFormat with `timeZone` + `hourCycle` + `formatToParts`).
 * Hermes ships these on iOS/Android; this guards against a regression or an engine
 * without full time-zone data. Pure, runs in Node too.
 */
export interface IntlCheckResult {
  ok: boolean;
  detail: string;
}

export function checkIntlTimeZoneSupport(): IntlCheckResult {
  try {
    if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") {
      return { ok: false, detail: "Intl.DateTimeFormat is missing" };
    }
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: "Australia/Sydney",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    if (typeof f.formatToParts !== "function") return { ok: false, detail: "formatToParts is missing" };
    const get = (ms: number) => {
      const parts = f.formatToParts(new Date(ms));
      const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
      return { y: n("year"), mo: n("month"), d: n("day"), h: n("hour") % 24, mi: n("minute") };
    };
    // 2026-01-01T00:30Z = 11:30 am AEDT (UTC+11); 2026-07-01T00:30Z = 10:30 am AEST (UTC+10).
    const summer = get(Date.UTC(2026, 0, 1, 0, 30));
    const winter = get(Date.UTC(2026, 6, 1, 0, 30));
    const okSummer = summer.y === 2026 && summer.mo === 1 && summer.d === 1 && summer.h === 11 && summer.mi === 30;
    const okWinter = winter.y === 2026 && winter.mo === 7 && winter.d === 1 && winter.h === 10 && winter.mi === 30;
    if (!okSummer || !okWinter) {
      return { ok: false, detail: `Unexpected local times: ${JSON.stringify({ summer, winter })}` };
    }
    // Perth has no DST; a second zone confirms real tz data rather than a fixed offset.
    const perth = new Intl.DateTimeFormat("en-US", { timeZone: "Australia/Perth", hourCycle: "h23", hour: "2-digit" })
      .formatToParts(new Date(Date.UTC(2026, 0, 1, 0, 0)))
      .find((p) => p.type === "hour")?.value;
    if (Number(perth) !== 8) return { ok: false, detail: `Australia/Perth hour was ${perth}, expected 8` };
    return { ok: true, detail: "Intl time zones OK" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

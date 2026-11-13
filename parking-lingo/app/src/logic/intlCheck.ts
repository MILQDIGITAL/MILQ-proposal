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

let cached: IntlCheckResult | null = null;

/** Cached result (the engine doesn't change at runtime). */
export function intlSupport(): IntlCheckResult {
  if (!cached) cached = checkIntlTimeZoneSupport();
  return cached;
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
      // Core maps an hour of 24 to 0 (some engines print 24 for midnight); mirror that, nothing more.
      const h = n("hour");
      return { y: n("year"), mo: n("month"), d: n("day"), h: h === 24 ? 0 : h, mi: n("minute") };
    };
    // Probes cover AM, PM (catches engines ignoring hourCycle h23), just after midnight
    // (catches "24"/"12" midnight bugs) and both sides of a DST change.
    const probes: { utc: number; want: [number, number, number, number, number]; what: string }[] = [
      // 2026-01-01T00:30Z = 11:30 am AEDT (UTC+11)
      { utc: Date.UTC(2026, 0, 1, 0, 30), want: [2026, 1, 1, 11, 30], what: "summer morning" },
      // 2026-01-01T04:00Z = 3:00 pm AEDT
      { utc: Date.UTC(2026, 0, 1, 4, 0), want: [2026, 1, 1, 15, 0], what: "afternoon (h23)" },
      // 2025-12-31T13:30Z = 00:30 am 1 Jan AEDT
      { utc: Date.UTC(2025, 11, 31, 13, 30), want: [2026, 1, 1, 0, 30], what: "just after midnight" },
      // 2026-07-01T00:30Z = 10:30 am AEST (UTC+10)
      { utc: Date.UTC(2026, 6, 1, 0, 30), want: [2026, 7, 1, 10, 30], what: "winter (no DST)" },
      // DST starts Sun 4 Oct 2026 02:00 AEST → 03:00 AEDT (15:59Z = 01:59, 16:00Z = 03:00)
      { utc: Date.UTC(2026, 9, 3, 15, 59), want: [2026, 10, 4, 1, 59], what: "before DST change" },
      { utc: Date.UTC(2026, 9, 3, 16, 0), want: [2026, 10, 4, 3, 0], what: "after DST change" },
    ];
    for (const pr of probes) {
      const g = get(pr.utc);
      const got: [number, number, number, number, number] = [g.y, g.mo, g.d, g.h, g.mi];
      if (got.some((v, i) => v !== pr.want[i])) {
        return { ok: false, detail: `Wrong local time for ${pr.what}: got ${got.join("/")}, expected ${pr.want.join("/")}` };
      }
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

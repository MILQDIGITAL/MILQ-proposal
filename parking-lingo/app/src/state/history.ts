/** Recent scans (pure helpers). Persistence lives in HistoryProvider. */
import { safeParseSignReading, type SignReading, type VerdictStatus } from "@parking-lingo/core";

export const HISTORY_STORAGE_KEY = "parking-lingo/history/v1";
export const HISTORY_LIMIT = 20;

export interface HistoryEntry {
  id: string;
  scannedAt: string;
  timeZone: string;
  reading: SignReading;
  /** Small JPEG data URI, or null (demo scans). */
  thumbnail: string | null;
  statusAtScan: VerdictStatus;
  headlineAtScan: string;
  fixtureId: string | null;
  requestId: string | null;
}

/** Newest first, de-duplicated by id, capped at `limit`. */
export function addToHistory(list: readonly HistoryEntry[], entry: HistoryEntry, limit = HISTORY_LIMIT): HistoryEntry[] {
  return [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, limit);
}

/** Tolerant parse: drops malformed entries instead of failing the whole list. */
export function parseStoredHistory(raw: string | null | undefined): HistoryEntry[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: HistoryEntry[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const r = safeParseSignReading(e.reading);
    if (!r.success || typeof e.id !== "string" || typeof e.scannedAt !== "string" || typeof e.timeZone !== "string") continue;
    out.push({
      id: e.id,
      scannedAt: e.scannedAt,
      timeZone: e.timeZone,
      reading: r.data,
      thumbnail: typeof e.thumbnail === "string" ? e.thumbnail : null,
      statusAtScan: (["yes", "yes_with_conditions", "no", "unsure"] as const).includes(e.statusAtScan as VerdictStatus)
        ? (e.statusAtScan as VerdictStatus)
        : "unsure",
      headlineAtScan: typeof e.headlineAtScan === "string" ? e.headlineAtScan : "",
      fixtureId: typeof e.fixtureId === "string" ? e.fixtureId : null,
      requestId: typeof e.requestId === "string" ? e.requestId : null,
    });
  }
  return out.slice(0, HISTORY_LIMIT);
}

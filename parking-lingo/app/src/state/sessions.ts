/** Builders for ScanResult from demo fixtures and history entries (pure). */
import type { SignFixture } from "@parking-lingo/core/fixtures";
import type { HistoryEntry } from "./history";
import { newScanId, type ScanResult } from "./scanStore";

/**
 * A demo result. With `useDemoClock`, the clock starts at the fixture's demo time and
 * keeps running (so countdowns are live); otherwise it uses the real current time.
 */
export function demoResult(fixture: SignFixture, useDemoClock: boolean, realNowMs: number = Date.now(), deviceTimeZone: string): ScanResult {
  const { now, timeZone, ...overrides } = fixture.demoContext;
  const demoNowMs = typeof now === "number" ? now : new Date(now).getTime();
  return {
    id: `demo-${fixture.id}-${newScanId()}`,
    source: "demo",
    reading: fixture.reading,
    serverVerdict: null,
    requestId: null,
    photoUri: null,
    thumbnail: null,
    timeZone: useDemoClock ? timeZone : deviceTimeZone,
    scannedAt: new Date(useDemoClock ? demoNowMs : realNowMs).toISOString(),
    clockOffsetMs: useDemoClock ? demoNowMs - realNowMs : 0,
    overrides: Object.keys(overrides).length ? overrides : null,
    fixtureId: fixture.id,
  };
}

/** Re-open a past scan: always re-evaluated for the current time. */
export function historyResult(entry: HistoryEntry): ScanResult {
  return {
    id: entry.id,
    source: "history",
    reading: entry.reading,
    serverVerdict: null,
    requestId: entry.requestId,
    photoUri: entry.thumbnail,
    thumbnail: entry.thumbnail,
    timeZone: entry.timeZone,
    scannedAt: entry.scannedAt,
    clockOffsetMs: 0,
    overrides: null,
    fixtureId: entry.fixtureId,
  };
}

/** Verdict timeline → geometry + labels for the 24 h bar (pure). */
import { formatInstant, type TimelineSegment, type TimelineStatus } from "@parking-lingo/core";
import { localHourMinute, shortHourLabel } from "./format";

export interface TimelineBlock {
  index: number;
  status: TimelineStatus;
  label: string;
  /** 0..1 position and width within the window. */
  start: number;
  width: number;
  /** "4:00 pm – 7:00 pm" */
  rangeText: string;
  accessibilityLabel: string;
}

export interface TimelineTick {
  at: number;
  label: string;
}

export interface TimelineModel {
  blocks: TimelineBlock[];
  ticks: TimelineTick[];
  /** 0..1 position of "now" (normally 0: the engine's timeline starts at now). */
  nowAt: number;
  /** Index of the block containing now. */
  currentIndex: number;
}

const STATUS_WORD: Record<TimelineStatus, string> = {
  allowed: "Parking allowed",
  limited: "Time-limited or paid",
  prohibited: "No parking",
};

export function buildTimelineModel(segments: readonly TimelineSegment[], nowMs: number, timeZone: string): TimelineModel | null {
  if (segments.length === 0) return null;
  const startMs = Date.parse(segments[0]!.from);
  let endMs = Date.parse(segments[segments.length - 1]!.to);
  // A single all-day segment can come back with from === to; treat it as 24 h.
  if (!(endMs > startMs)) endMs = startMs + 24 * 3_600_000;
  const span = endMs - startMs;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));

  const blocks: TimelineBlock[] = segments.map((s, index) => {
    const from = Date.parse(s.from);
    let to = Date.parse(s.to);
    if (!(to > from)) to = endMs;
    const rangeText = `${formatInstant(from, nowMs, timeZone)} – ${formatInstant(to, nowMs, timeZone)}`;
    return {
      index,
      status: s.status,
      label: s.label,
      start: clamp((from - startMs) / span),
      width: clamp((to - from) / span),
      rangeText,
      accessibilityLabel: `${rangeText}: ${s.label}. ${STATUS_WORD[s.status]}.`,
    };
  });

  // Ticks at local 12 am / 6 am / 12 pm / 6 pm.
  const ticks: TimelineTick[] = [];
  const firstHour = Math.ceil(startMs / 3_600_000) * 3_600_000;
  for (let t = firstHour; t < endMs; t += 3_600_000) {
    const { hour, minute } = localHourMinute(t, timeZone);
    if (minute !== 0 || hour % 6 !== 0) continue;
    const at = (t - startMs) / span;
    if (at < 0.06 || at > 0.97) continue; // keep clear of the "Now" label and the edge
    ticks.push({ at, label: shortHourLabel(hour) });
  }

  const nowAt = clamp((nowMs - startMs) / span);
  const currentIndex = Math.max(
    0,
    blocks.findIndex((b) => nowAt >= b.start && nowAt < b.start + b.width),
  );
  return { blocks, ticks, nowAt, currentIndex };
}

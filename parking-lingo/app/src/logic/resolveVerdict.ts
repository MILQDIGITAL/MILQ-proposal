/**
 * Decide which verdict the Result screen may show (pure, unit tested).
 *
 * Normally the app evaluates locally with core (instant, offline, live every minute).
 * If this JS engine's time-zone support failed the self-check, or local evaluation
 * throws, we must not show a possibly wrong answer: fall back to the server's verdict
 * only while it's fresh, otherwise show an error.
 */
import type { Side, Verdict } from "@parking-lingo/core";

/** How old a server verdict may be and still be shown as "now". */
export const SERVER_VERDICT_MAX_AGE_MS = 90_000;

export type Resolution =
  | { kind: "local"; base: Verdict; shown: Verdict }
  | { kind: "server"; base: Verdict; shown: Verdict; notice: string }
  | { kind: "error"; title: string; message: string };

export interface ResolveInput {
  intlOk: boolean;
  side: Side | "unknown";
  /** Evaluate locally for a side ('unknown' = combined). May throw. */
  evaluateLocal: (side: Side | "unknown") => Verdict;
  serverVerdict: Verdict | null;
  nowMs: number;
}

/** A side's answer from a combined server verdict, in Verdict shape. */
export function serverVerdictForSide(v: Verdict, side: Side | "unknown"): Verdict {
  if (side === "unknown" || !v.bySide) return v;
  return { ...v, ...v.bySide[side], side, needsSide: false, bySide: v.bySide };
}

export function resolveVerdict(input: ResolveInput): Resolution {
  let failure: string | null = input.intlOk ? null : "time-zone support check failed";
  if (input.intlOk) {
    try {
      const base = input.evaluateLocal("unknown");
      const shown = input.side === "unknown" ? base : input.evaluateLocal(input.side);
      return { kind: "local", base, shown };
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  }
  const sv = input.serverVerdict;
  if (sv) {
    const age = input.nowMs - Date.parse(sv.evaluatedAt);
    if (Number.isFinite(age) && age >= -SERVER_VERDICT_MAX_AGE_MS && age <= SERVER_VERDICT_MAX_AGE_MS) {
      return {
        kind: "server",
        base: sv,
        shown: serverVerdictForSide(sv, input.side),
        notice: input.intlOk
          ? "Showing the server's answer from just now — this phone couldn't work it out. It won't update; rescan in a few minutes."
          : "This phone can't do reliable local time maths, so this is the server's answer from just now. It won't update; rescan to refresh.",
      };
    }
  }
  return {
    kind: "error",
    title: "Can't work out the answer on this phone",
    message: input.intlOk
      ? `Something went wrong checking the sign (${failure}). Rescan to get a fresh answer.`
      : sv
        ? "This phone's time-zone support didn't pass our check and the server's answer is now out of date. Scan the sign again for a fresh answer."
        : "This phone's time-zone support didn't pass our check, so saved and demo scans can't be checked safely here. Scan the sign again to get the server's answer.",
  };
}

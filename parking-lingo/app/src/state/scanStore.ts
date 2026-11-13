/**
 * In-memory state for the current scan, shared by Scan → Analysing → Result.
 * A tiny external store (no extra dependency) consumed with useSyncExternalStore.
 */
import { useSyncExternalStore } from "react";
import type { ParkingContext, SignReading, Verdict } from "@parking-lingo/core";

export interface PendingPhoto {
  /** Display URI for the frozen photo (file:// on iOS, blob:/data: on web). */
  uri: string;
  /** Downscaled JPEG for upload. */
  base64: string;
  /** Small JPEG data URI for history. */
  thumbnail: string | null;
  source: "camera" | "library";
}

export interface ScanResult {
  id: string;
  source: "camera" | "library" | "demo" | "history";
  reading: SignReading;
  serverVerdict: Verdict | null;
  requestId: string | null;
  photoUri: string | null;
  thumbnail: string | null;
  timeZone: string;
  scannedAt: string;
  /** Added to Date.now() — lets demo fixtures run on their own "demo clock". */
  clockOffsetMs: number;
  /** Per-scan context overrides (e.g. fixture demo permits). */
  overrides: Partial<ParkingContext> | null;
  fixtureId: string | null;
}

interface State {
  pending: PendingPhoto | null;
  result: ScanResult | null;
}

let state: State = { pending: null, result: null };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export const scanStore = {
  get: () => state,
  setPending: (pending: PendingPhoto | null) => set({ pending }),
  setResult: (result: ScanResult | null) => set({ result }),
  reset: () => set({ pending: null, result: null }),
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useScanState(): State {
  return useSyncExternalStore(scanStore.subscribe, scanStore.get, scanStore.get);
}

export function newScanId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

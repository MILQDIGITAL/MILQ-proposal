/**
 * Runtime configuration. Expo inlines `process.env.EXPO_PUBLIC_*` at build time, so these
 * must be read with direct, static property access.
 */
export function normaliseBaseUrl(raw: string | undefined | null): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) return null;
  return v.replace(/\/+$/, "");
}

export const config = {
  apiUrl: normaliseBaseUrl(process.env.EXPO_PUBLIC_API_URL),
  appToken: (process.env.EXPO_PUBLIC_APP_TOKEN ?? "").trim() || null,
  /** The server's own vision timeout is 60 s, so give it headroom before giving up. */
  requestTimeoutMs: 75_000,
  /** After this long the Analysing screen says "taking longer than usual". */
  slowAfterMs: 15_000,
  /** Dev only: with the server in mock mode (MOCK_VISION=1), ask for this fixture via `x-mock-fixture`. */
  mockFixture: (process.env.EXPO_PUBLIC_MOCK_FIXTURE ?? "").trim() || null,
} as const;

export const isApiConfigured = (): boolean => config.apiUrl !== null;

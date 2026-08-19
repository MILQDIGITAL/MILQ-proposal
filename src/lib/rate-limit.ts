import "server-only";

/**
 * In-memory fixed-window limiter. Fine for a single long-lived Node process (local dev, a
 * container), but each serverless invocation gets its own memory — on Vercel this does not
 * actually enforce a global limit across instances. Swap for a durable store (a Supabase table,
 * Upstash Redis) before relying on this in production.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();

export function isRateLimited(
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  entry.count += 1;
  return entry.count > limit;
}

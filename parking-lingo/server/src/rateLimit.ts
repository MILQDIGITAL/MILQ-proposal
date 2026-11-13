/**
 * Minimal in-memory fixed-window rate limiter (per key, e.g. per IP).
 * Good enough for a single-instance MVP; use a shared store (Redis) when scaling out.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit. Returns whether it is allowed and, if not, seconds until the window resets. */
  hit(key: string): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const t = this.now();
    this.sweep(t);
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count++;
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - t) / 1000));
    if (entry.count > this.limit) return { allowed: false, remaining: 0, retryAfterSeconds };
    return { allowed: true, remaining: this.limit - entry.count, retryAfterSeconds };
  }

  /** Drop expired entries at most once per window so memory stays bounded. */
  private sweep(t: number): void {
    if (t - this.lastSweep < this.windowMs) return;
    this.lastSweep = t;
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}

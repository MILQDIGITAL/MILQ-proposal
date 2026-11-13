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
    /** Hard cap on tracked keys so spoofed/rotating keys can't grow memory unbounded. */
    readonly maxKeys = 10_000,
  ) {}

  /** Number of keys currently tracked (for tests/metrics). */
  get size(): number {
    return this.hits.size;
  }

  /** Records a hit. Returns whether it is allowed and, if not, seconds until the window resets. */
  hit(key: string): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const t = this.now();
    this.sweep(t);
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      if (!entry && this.hits.size >= this.maxKeys) this.makeRoom(t);
      entry = { count: 0, resetAt: t + this.windowMs };
      this.hits.delete(key);
      this.hits.set(key, entry);
    }
    entry.count++;
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - t) / 1000));
    if (entry.count > this.limit) return { allowed: false, remaining: 0, retryAfterSeconds };
    return { allowed: true, remaining: this.limit - entry.count, retryAfterSeconds };
  }

  /** Full: drop expired entries, then the oldest (insertion order) until there's room. */
  private makeRoom(t: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
    this.lastSweep = t;
    const it = this.hits.keys();
    while (this.hits.size >= this.maxKeys) {
      const k = it.next();
      if (k.done) break;
      this.hits.delete(k.value);
    }
  }

  /** Drop expired entries at most once per window so memory stays bounded. */
  private sweep(t: number): void {
    if (t - this.lastSweep < this.windowMs) return;
    this.lastSweep = t;
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}

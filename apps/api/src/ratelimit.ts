// In-memory token buckets keyed by client IP (single instance; Redis if we ever scale out).
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private readonly capacity: number, private readonly refillPerMs: number) {}

  static perMinute(n: number) { return new RateLimiter(n, n / 60_000); }
  static perHour(n: number) { return new RateLimiter(n, n / 3_600_000); }

  /** Returns 0 if allowed, otherwise ms until the next token. */
  take(key: string): number {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + (now - b.at) * this.refillPerMs);
    b.at = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      this.buckets.set(key, b);
      if (this.buckets.size > 10_000) this.sweep(now);
      return 0;
    }
    this.buckets.set(key, b);
    return Math.ceil((1 - b.tokens) / this.refillPerMs);
  }

  private sweep(now: number) {
    for (const [k, b] of this.buckets) if (now - b.at > 3_600_000) this.buckets.delete(k);
  }
}

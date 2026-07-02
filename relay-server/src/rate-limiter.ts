// Why: throttle abusive or looping clients hammering the relay — reconnect
// storms, token brute-force, or a buggy client that reopens in a tight loop.
// A sliding-window counter per key (the client IP): at most `maxEvents` accepted
// within any `windowMs` span. Over-budget connections are rejected with
// WebSocket 1013 (Try Again Later) so well-behaved clients back off rather than
// being permanently banned.

export type RateLimiterOptions = {
  maxEvents: number
  windowMs: number
  // Injectable clock for deterministic tests.
  now?: () => number
}

export class SlidingWindowRateLimiter {
  private readonly maxEvents: number
  private readonly windowMs: number
  private readonly now: () => number
  private readonly hits = new Map<string, number[]>()

  constructor(options: RateLimiterOptions) {
    this.maxEvents = options.maxEvents
    this.windowMs = options.windowMs
    this.now = options.now ?? Date.now
  }

  // Records the event and returns true when within budget; returns false (and
  // records nothing) when the key has already used its full budget this window.
  tryAcquire(key: string): boolean {
    const now = this.now()
    const cutoff = now - this.windowMs
    const recent = (this.hits.get(key) ?? []).filter((time) => time > cutoff)
    if (recent.length >= this.maxEvents) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.set(key, recent)
    return true
  }

  // Drop keys whose events have all aged out, to bound memory under churn of
  // many distinct IPs. Safe to call periodically.
  sweep(): void {
    const cutoff = this.now() - this.windowMs
    for (const [key, times] of this.hits) {
      const recent = times.filter((time) => time > cutoff)
      if (recent.length === 0) {
        this.hits.delete(key)
      } else {
        this.hits.set(key, recent)
      }
    }
  }

  get trackedKeyCount(): number {
    return this.hits.size
  }
}

import { describe, expect, it } from 'vitest'
import { SlidingWindowRateLimiter } from '../src/rate-limiter.js'

describe('SlidingWindowRateLimiter', () => {
  it('allows up to maxEvents within the window, then rejects', () => {
    let now = 1_000
    const limiter = new SlidingWindowRateLimiter({ maxEvents: 3, windowMs: 1_000, now: () => now })
    expect(limiter.tryAcquire('a')).toBe(true)
    expect(limiter.tryAcquire('a')).toBe(true)
    expect(limiter.tryAcquire('a')).toBe(true)
    expect(limiter.tryAcquire('a')).toBe(false)
  })

  it('refills as events age out of the window', () => {
    let now = 1_000
    const limiter = new SlidingWindowRateLimiter({ maxEvents: 2, windowMs: 1_000, now: () => now })
    expect(limiter.tryAcquire('a')).toBe(true)
    expect(limiter.tryAcquire('a')).toBe(true)
    expect(limiter.tryAcquire('a')).toBe(false)
    now += 1_001
    expect(limiter.tryAcquire('a')).toBe(true)
  })

  it('tracks each key independently', () => {
    const now = 0
    const limiter = new SlidingWindowRateLimiter({ maxEvents: 1, windowMs: 1_000, now: () => now })
    expect(limiter.tryAcquire('a')).toBe(true)
    expect(limiter.tryAcquire('b')).toBe(true)
    expect(limiter.tryAcquire('a')).toBe(false)
  })

  it('sweep() drops keys whose events have all aged out', () => {
    let now = 0
    const limiter = new SlidingWindowRateLimiter({ maxEvents: 1, windowMs: 1_000, now: () => now })
    limiter.tryAcquire('a')
    expect(limiter.trackedKeyCount).toBe(1)
    now += 2_000
    limiter.sweep()
    expect(limiter.trackedKeyCount).toBe(0)
  })
})

/**
 * In-memory sliding-window rate limiter.
 *
 * Safe because the service runs as a single instance (one WhatsApp session can
 * only be active in one place). Counters reset on restart, which is acceptable.
 */
export interface LimitResult {
  allowed: boolean
  limit: number
  remaining: number
  /** Seconds until the oldest counted hit leaves the window. */
  resetSec: number
}

export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>()

  constructor(private windowMs: number = 60_000) {
    // Drop idle keys so the map doesn't grow forever
    setInterval(() => this.sweep(), 5 * 60_000).unref()
  }

  private recent(key: string, now: number): number[] {
    const cutoff = now - this.windowMs
    const list = (this.hits.get(key) ?? []).filter(t => t > cutoff)
    if (list.length) this.hits.set(key, list)
    else this.hits.delete(key)
    return list
  }

  private result(list: number[], limit: number, now: number, allowed: boolean): LimitResult {
    const oldest = list[0] ?? now
    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - list.length),
      resetSec: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)),
    }
  }

  /** Count a hit if under the limit. Rejected hits are not counted. */
  consume(key: string, limit: number): LimitResult {
    const now = Date.now()
    const list = this.recent(key, now)
    if (list.length >= limit) return this.result(list, limit, now, false)
    list.push(now)
    this.hits.set(key, list)
    return this.result(list, limit, now, true)
  }

  /** Check without counting. */
  peek(key: string, limit: number): LimitResult {
    const now = Date.now()
    const list = this.recent(key, now)
    return this.result(list, limit, now, list.length < limit)
  }

  private sweep() {
    const now = Date.now()
    for (const key of [...this.hits.keys()]) this.recent(key, now)
  }
}

/** All requests per API client. */
export const requestLimiter = new SlidingWindowLimiter()
/** Send endpoints per API client (protects the WhatsApp number). */
export const sendLimiter = new SlidingWindowLimiter()
/** Failed API-key attempts per IP (slows down key guessing). */
export const failedAuthLimiter = new SlidingWindowLimiter()
export const FAILED_AUTH_LIMIT_PER_MIN = 20

/**
 * Rate Limiter
 * Per-user sliding window rate limiting.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the user can send again (only set if not allowed) */
  retryAfter?: number;
}

interface UserBucket {
  /** Timestamps of messages in the current window */
  timestamps: number[];
  /** Whether we've already sent a rate limit warning in this window */
  warned: boolean;
}

/**
 * Simple sliding window rate limiter.
 * Tracks message timestamps per user and enforces a max messages per minute limit.
 */
export class RateLimiter {
  private buckets = new Map<string, UserBucket>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private checkCount = 0;

  constructor(messagesPerMinute: number) {
    this.maxRequests = messagesPerMinute;
    this.windowMs = 60 * 1000; // 1 minute window
  }

  /**
   * Check if a request from the given user should be allowed.
   * @param userId The user identifier
   * @returns Result with allowed status and optional retry time
   */
  check(userId: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Periodic cleanup to prevent memory leaks (every 100 checks)
    if (++this.checkCount % 100 === 0) {
      this.cleanup();
    }

    let bucket = this.buckets.get(userId);
    if (!bucket) {
      bucket = { timestamps: [], warned: false };
      this.buckets.set(userId, bucket);
    }

    // Remove timestamps outside the window
    bucket.timestamps = bucket.timestamps.filter((ts) => ts > windowStart);

    // Check if under limit
    if (bucket.timestamps.length < this.maxRequests) {
      bucket.timestamps.push(now);
      // Reset warned flag when user is under limit
      if (bucket.timestamps.length < this.maxRequests * 0.8) {
        bucket.warned = false;
      }
      return { allowed: true };
    }

    // Calculate retry time based on oldest timestamp in window
    const oldestInWindow = bucket.timestamps[0];
    const retryAfter = Math.ceil((oldestInWindow + this.windowMs - now) / 1000);

    return {
      allowed: false,
      retryAfter: Math.max(1, retryAfter),
    };
  }

  /**
   * Check if we should send a warning message for this user.
   * Returns true only on the first rate limit hit in a window (to avoid spam).
   */
  shouldWarn(userId: string): boolean {
    const bucket = this.buckets.get(userId);
    if (!bucket) return true;

    if (!bucket.warned) {
      bucket.warned = true;
      return true;
    }
    return false;
  }

  /**
   * Reset rate limit state for a user.
   */
  reset(userId: string): void {
    this.buckets.delete(userId);
  }

  /**
   * Clean up stale entries (call periodically to prevent memory leaks).
   */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [userId, bucket] of this.buckets) {
      // Remove if all timestamps are outside window
      if (bucket.timestamps.every((ts) => ts <= windowStart)) {
        this.buckets.delete(userId);
      }
    }
  }
}

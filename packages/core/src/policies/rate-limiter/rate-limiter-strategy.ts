/**
 * Interface for rate limiting strategies.
 *
 * Implementations control how permits are acquired and when requests should be
 * throttled. Common strategies include token bucket, sliding window, and fixed window.
 *
 * @example
 * ```typescript
 * class FixedWindowStrategy implements IRateLimiterStrategy {
 *   private count = 0;
 *   private windowStart = Date.now();
 *
 *   constructor(private limit: number, private windowMs: number) {}
 *
 *   acquire(): boolean {
 *     const now = Date.now();
 *     if (now - this.windowStart >= this.windowMs) {
 *       this.count = 0;
 *       this.windowStart = now;
 *     }
 *     if (this.count < this.limit) {
 *       this.count++;
 *       return true;
 *     }
 *     return false;
 *   }
 *
 *   async waitForPermit(timeoutMs?: number): Promise<boolean> {
 *     // Implementation...
 *   }
 * }
 * ```
 */
export interface IRateLimiterStrategy {
  /**
   * Attempts to acquire a permit immediately without blocking.
   *
   * This is a non-blocking operation that returns immediately. Use this method
   * when you want to fail fast if no permit is available.
   *
   * @returns `true` if a permit was acquired, `false` if the rate limit is exceeded.
   *          May return a Promise for async implementations (e.g., distributed rate limiters).
   */
  acquire(): Promise<boolean> | boolean;

  /**
   * Waits for a permit to become available, up to the specified timeout.
   *
   * This method blocks (asynchronously) until either a permit is acquired or
   * the timeout expires. Use this when you prefer to queue requests rather
   * than reject them immediately.
   *
   * @param timeoutMs - Maximum time to wait in milliseconds. If `0` or not specified,
   *                    may wait indefinitely (implementation-dependent).
   * @returns `true` if a permit was acquired within the timeout, `false` if the
   *          timeout expired before a permit became available.
   */
  waitForPermit(timeoutMs?: number): Promise<boolean>;
}

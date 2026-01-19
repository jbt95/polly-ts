import type { IRateLimiterStrategy } from './rate-limiter-strategy';

/**
 * Configuration options for the Token Bucket rate limiting strategy.
 *
 * @example
 * ```typescript
 * // Allow 100 requests per second with burst capacity of 100
 * const options: TokenBucketOptions = {
 *   capacity: 100,
 *   refillRate: 100,
 *   refillIntervalMs: 1000,
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Allow 10 requests per minute, starting with 5 tokens
 * const options: TokenBucketOptions = {
 *   capacity: 10,
 *   refillRate: 10,
 *   refillIntervalMs: 60000,
 *   initialTokens: 5,
 * };
 * ```
 */
export interface TokenBucketOptions {
  /**
   * Maximum number of tokens the bucket can hold.
   *
   * This defines the burst capacity - the maximum number of requests that can
   * be made in quick succession before rate limiting kicks in.
   */
  capacity: number;

  /**
   * Number of tokens added to the bucket per refill interval.
   *
   * Combined with `refillIntervalMs`, this determines the sustained rate limit.
   * For example, `refillRate: 10` with `refillIntervalMs: 1000` allows 10
   * requests per second on average.
   */
  refillRate: number;

  /**
   * Time interval in milliseconds between token refills.
   *
   * @default 1000 (1 second)
   */
  refillIntervalMs?: number;

  /**
   * Number of tokens available when the bucket is created.
   *
   * Set this lower than `capacity` to implement a "warm-up" period where
   * the rate limit is more restrictive initially.
   *
   * @default Same as `capacity` (bucket starts full)
   */
  initialTokens?: number;
}

/**
 * Token Bucket rate limiting strategy.
 *
 * The token bucket algorithm allows requests at a sustained rate while permitting
 * short bursts of traffic. Tokens are added to a bucket at a fixed rate, and each
 * request consumes one token. Requests are rejected when the bucket is empty.
 *
 * **Algorithm:**
 * 1. Bucket starts with `initialTokens` (default: `capacity`)
 * 2. Every `refillIntervalMs`, `refillRate` tokens are added (up to `capacity`)
 * 3. Each request consumes 1 token
 * 4. If no tokens available, request is rejected or queued
 *
 * **Use Cases:**
 * - API rate limiting (e.g., 100 requests/second)
 * - Protecting downstream services from overload
 * - Implementing fair usage policies
 *
 * @example
 * ```typescript
 * // 100 requests per second with burst of 100
 * const strategy = new TokenBucketStrategy({
 *   capacity: 100,
 *   refillRate: 100,
 *   refillIntervalMs: 1000,
 * });
 *
 * const policy = new RateLimiterPolicy({ strategy });
 *
 * // Will succeed until bucket is empty
 * await policy.execute(() => callApi());
 * ```
 *
 * @example
 * ```typescript
 * // 10 requests per minute, slower start
 * const strategy = new TokenBucketStrategy({
 *   capacity: 10,
 *   refillRate: 10,
 *   refillIntervalMs: 60000,
 *   initialTokens: 2, // Start with only 2 tokens
 * });
 * ```
 */
export class TokenBucketStrategy implements IRateLimiterStrategy {
  /** Current number of available tokens. */
  private tokens: number;

  /** Maximum tokens the bucket can hold. */
  private readonly capacity: number;

  /** Number of tokens added each refill interval. */
  private readonly tokensPerRefill: number;

  /** Time between refills in milliseconds. */
  private readonly refillIntervalMs: number;

  /** Timestamp of the last refill calculation. */
  private lastRefill: number;

  /**
   * Creates a new TokenBucketStrategy.
   *
   * @param options - Configuration for the token bucket behavior.
   */
  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.tokens = options.initialTokens ?? options.capacity;
    this.tokensPerRefill = options.refillRate;
    this.refillIntervalMs = options.refillIntervalMs ?? 1000;
    this.lastRefill = Date.now();
  }

  /**
   * Refills tokens based on elapsed time since last refill.
   * Uses lazy refill - only calculates new tokens when needed.
   */
  private updateTokens(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const refills = Math.floor(timePassed / this.refillIntervalMs);

    if (refills > 0) {
      const newTokens = refills * this.tokensPerRefill;
      this.tokens = Math.min(this.capacity, this.tokens + newTokens);
      this.lastRefill = now;
    }
  }

  /**
   * Attempts to acquire a token immediately.
   *
   * Updates the token count based on elapsed time, then attempts to consume
   * one token. This is a non-blocking operation.
   *
   * @returns `true` if a token was available and consumed, `false` if the bucket is empty.
   */
  acquire(): boolean {
    this.updateTokens();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Waits for a token to become available.
   *
   * Polls the bucket at regular intervals until either a token is acquired
   * or the timeout expires. The polling interval is the minimum of the
   * time until the next refill or 50ms.
   *
   * @param timeoutMs - Maximum time to wait in milliseconds. If `0`, waits indefinitely.
   * @returns `true` if a token was acquired, `false` if the timeout expired.
   */
  async waitForPermit(timeoutMs = 0): Promise<boolean> {
    const start = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- intentional infinite loop
    while (true) {
      if (this.acquire()) {
        return true;
      }

      const elapsed = Date.now() - start;
      if (timeoutMs > 0 && elapsed >= timeoutMs) {
        return false;
      }

      // Compute time until next refill
      const nextRefillTime = this.lastRefill + this.refillIntervalMs;
      const waitTime = Math.max(0, nextRefillTime - Date.now());

      // If wait time exceeds remaining timeout, we can't make it
      if (timeoutMs > 0 && elapsed + waitTime > timeoutMs) {
        // Wait as much as we can then fail? Or fail now?
        // Let's just fail now to save resources.
        return false;
      }

      await new Promise((resolve) => setTimeout(resolve, Math.min(waitTime, 50)));
    }
  }
}

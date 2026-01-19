import type { IRateLimiterStrategy } from './rate-limiter-strategy';

export interface TokenBucketOptions {
  /**
   * Maximum number of tokens in the bucket.
   */
  capacity: number;
  /**
   * Tokens added per second (or per interval if refillInterval is set).
   * Default: refillInterval is 1000ms.
   */
  refillRate: number;
  /**
   * Interval in ms for refillRate. Default 1000ms.
   */
  refillIntervalMs?: number;
  /**
   * Initial tokens. Default: capacity.
   */
  initialTokens?: number;
}

export class TokenBucketStrategy implements IRateLimiterStrategy {
  private tokens: number;
  private readonly capacity: number;
  private readonly tokensPerRefill: number;
  private readonly refillIntervalMs: number;
  private lastRefill: number;

  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.tokens = options.initialTokens ?? options.capacity;
    this.tokensPerRefill = options.refillRate;
    this.refillIntervalMs = options.refillIntervalMs ?? 1000;
    this.lastRefill = Date.now();
  }

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

  acquire(): boolean {
    this.updateTokens();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

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

import { PolicyError } from './policy-error';

/**
 * Error thrown when a request is rejected due to rate limiting.
 *
 * This error is thrown by {@link RateLimiterPolicy} when:
 * - No permit is available and `waitForPermit` is `false` (fail fast mode)
 * - No permit becomes available within `maxWaitMs` (queue mode with timeout)
 *
 * **Handling Rate Limit Errors:**
 * - Implement backoff and retry logic
 * - Show user-friendly "try again later" messages
 * - Monitor error frequency to detect capacity issues
 *
 * @example
 * ```typescript
 * try {
 *   await rateLimiterPolicy.execute(() => callApi());
 * } catch (error) {
 *   if (error instanceof RateLimitRejectedError) {
 *     // Handle rate limiting - perhaps retry with backoff
 *     console.log('Rate limited, retrying in 1 second...');
 *     await delay(1000);
 *     return retry();
 *   }
 *   throw error;
 * }
 * ```
 */
export class RateLimitRejectedError extends PolicyError {
  /**
   * Creates a new RateLimitRejectedError.
   *
   * @param message - Optional custom error message.
   */
  constructor(message = 'Rate limit exceeded') {
    super(message, 'RateLimiterPolicy');
    this.name = 'RateLimitRejectedError';
  }
}

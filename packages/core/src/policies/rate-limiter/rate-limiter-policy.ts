import { randomUUID } from 'crypto';
import type { IPolicy, PolicyOptions, ExecutionContext } from '../../types';
import type { SuccessEventArgs, FailureEventArgs, PolicyEvent } from '../../types/events';
import { PolicyEventEmitter } from '../../types/events';
import { createExecutionContext } from '../../types/context';
import { RateLimitRejectedError } from '../../errors/rate-limit-rejected-error';
import type { IRateLimiterStrategy } from './rate-limiter-strategy';

/**
 * Configuration options for the RateLimiterPolicy.
 *
 * @example
 * ```typescript
 * // Fail fast when rate limit exceeded
 * const options: RateLimiterPolicyOptions = {
 *   strategy: new TokenBucketStrategy({ capacity: 100, refillRate: 100 }),
 *   waitForPermit: false, // Fail immediately if no permit
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Queue requests when rate limit exceeded
 * const options: RateLimiterPolicyOptions = {
 *   strategy: new TokenBucketStrategy({ capacity: 10, refillRate: 10 }),
 *   waitForPermit: true,
 *   maxWaitMs: 5000, // Wait up to 5 seconds for a permit
 * };
 * ```
 */
export interface RateLimiterPolicyOptions extends PolicyOptions {
  /**
   * The rate limiting strategy to use.
   *
   * Built-in strategies include {@link TokenBucketStrategy}. Custom strategies
   * can be implemented by implementing the {@link IRateLimiterStrategy} interface.
   */
  strategy: IRateLimiterStrategy;

  /**
   * Whether to wait for a permit when the rate limit is exceeded.
   *
   * - `false` (default): Fail immediately with {@link RateLimitRejectedError}
   * - `true`: Wait up to `maxWaitMs` for a permit to become available
   *
   * @default false
   */
  waitForPermit?: boolean;

  /**
   * Maximum time to wait for a permit in milliseconds.
   *
   * Only applicable when `waitForPermit` is `true`. If a permit is not
   * acquired within this time, throws {@link RateLimitRejectedError}.
   *
   * @default 0 (wait indefinitely when waitForPermit is true)
   */
  maxWaitMs?: number;
}

/**
 * A resilience policy that limits the rate of operations using pluggable strategies.
 *
 * Rate limiting prevents overloading downstream services and ensures fair resource
 * usage. This policy supports both "fail fast" and "queue" modes:
 *
 * - **Fail fast**: Immediately rejects requests when rate limit is exceeded
 * - **Queue mode**: Waits for a permit to become available (with optional timeout)
 *
 * **Use Cases:**
 * - Protecting APIs from excessive calls
 * - Implementing client-side rate limiting
 * - Ensuring compliance with third-party API rate limits
 * - Load shedding during high traffic
 *
 * @example
 * ```typescript
 * // Basic rate limiting: 100 requests/second, fail fast
 * const policy = new RateLimiterPolicy({
 *   strategy: new TokenBucketStrategy({
 *     capacity: 100,
 *     refillRate: 100,
 *   }),
 * });
 *
 * try {
 *   await policy.execute(() => callApi());
 * } catch (error) {
 *   if (error instanceof RateLimitRejectedError) {
 *     console.log('Rate limit exceeded, try again later');
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Rate limiting with queueing
 * const policy = new RateLimiterPolicy({
 *   strategy: new TokenBucketStrategy({
 *     capacity: 10,
 *     refillRate: 10,
 *   }),
 *   waitForPermit: true,
 *   maxWaitMs: 5000,
 * });
 *
 * // Will wait up to 5 seconds for a permit
 * await policy.execute(() => callApi());
 * ```
 */
export class RateLimiterPolicy implements IPolicy {
  /** The name of this policy instance, used for logging and debugging. */
  readonly name: string;

  private readonly strategy: IRateLimiterStrategy;
  private readonly waitForPermit: boolean;
  private readonly maxWaitMs: number;

  private readonly successEmitter = new PolicyEventEmitter<SuccessEventArgs>();
  private readonly failureEmitter = new PolicyEventEmitter<FailureEventArgs>();

  /**
   * Event emitted when an operation completes successfully after acquiring a permit.
   */
  readonly onSuccess: PolicyEvent<SuccessEventArgs> = this.successEmitter.subscribe;

  /**
   * Event emitted when an operation fails, either due to rate limiting or operation error.
   */
  readonly onFailure: PolicyEvent<FailureEventArgs> = this.failureEmitter.subscribe;

  /**
   * Creates a new RateLimiterPolicy.
   *
   * @param options - Configuration options including the rate limiting strategy.
   */
  constructor(options: RateLimiterPolicyOptions) {
    this.name = options.name ?? 'RateLimiterPolicy';
    this.strategy = options.strategy;
    this.waitForPermit = options.waitForPermit ?? false;
    this.maxWaitMs = options.maxWaitMs ?? 0;
  }

  /**
   * Executes an operation with rate limiting.
   *
   * First attempts to acquire a permit from the configured strategy. If successful,
   * executes the operation. If no permit is available:
   * - In fail-fast mode: throws {@link RateLimitRejectedError} immediately
   * - In queue mode: waits up to `maxWaitMs` for a permit
   *
   * @typeParam T - The return type of the operation.
   * @param fn - The operation to execute.
   * @param signal - Optional AbortSignal to cancel the operation.
   * @returns The result of the operation.
   * @throws {@link RateLimitRejectedError} if no permit is available (fail-fast)
   *         or timeout expires (queue mode).
   * @throws Any error thrown by the operation itself.
   */
  async execute<T>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    const correlationId = randomUUID();
    const startTime = Date.now();
    const abortController = new AbortController();

    if (signal) {
      if (signal.aborted) throw signal.reason;
      signal.addEventListener('abort', () => {
        abortController.abort(signal.reason);
      });
    }

    const context = createExecutionContext({
      signal: abortController.signal,
      correlationId,
      startTime,
      attemptNumber: 1,
    });

    const acquired = this.waitForPermit
      ? await this.strategy.waitForPermit(this.maxWaitMs)
      : await this.strategy.acquire();

    if (!acquired) {
      const error = new RateLimitRejectedError();
      this.failureEmitter.emit({
        error,
        duration: Date.now() - startTime,
        attempts: 1,
        correlationId,
      });
      throw error;
    }

    try {
      const result = await fn(context);
      this.successEmitter.emit({
        duration: Date.now() - startTime,
        attemptNumber: 1,
        correlationId,
      });
      return result;
    } catch (err) {
      this.failureEmitter.emit({
        error: err as Error,
        duration: Date.now() - startTime,
        attempts: 1,
        correlationId,
      });
      throw err;
    }
  }
}

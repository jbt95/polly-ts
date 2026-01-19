import type { IPolicy, PolicyOptions } from '../../types/policy';
import type { ExecutionContext } from '../../types/context';
import type { SuccessEventArgs, FailureEventArgs, PolicyEvent } from '../../types/events';
import { PolicyEventEmitter } from '../../types/events';
import { createExecutionContext } from '../../types/context';
import type { BackoffStrategy } from './backoff';
import { ExponentialBackoff } from './backoff';

/**
 * Predicate to determine if an error should trigger a retry.
 */
export type RetryPredicate = (error: Error) => boolean;

/**
 * Predicate to determine if a result should trigger a retry.
 */
export type ResultPredicate<T> = (result: T) => boolean;

/**
 * Arguments passed to the onRetry event.
 */
export interface RetryEventArgs {
  /** The error that triggered the retry (if any) */
  readonly error?: Error;
  /** The result that triggered the retry (if any) */
  readonly result?: unknown;
  /** Current attempt number (1-indexed) */
  readonly attemptNumber: number;
  /** Delay before the next attempt in milliseconds */
  readonly delay: number;
  /** Correlation ID for this execution */
  readonly correlationId: string;
}

/**
 * Options for configuring a RetryPolicy.
 */
export interface RetryPolicyOptions<T = unknown> extends PolicyOptions {
  /** Maximum number of retry attempts (not including the initial attempt). Default: 3 */
  maxAttempts?: number;

  /** Maximum total duration for all attempts in milliseconds. Default: undefined (no limit) */
  maxDuration?: number;

  /** Backoff strategy to use. Default: ExponentialBackoff */
  backoff?: BackoffStrategy;

  /**
   * Predicate to determine if an error should trigger a retry.
   * Default: retry on all errors
   */
  shouldRetryError?: RetryPredicate;

  /**
   * Predicate to determine if a result should trigger a retry.
   * Default: never retry on result
   */
  shouldRetryResult?: ResultPredicate<T>;

  /**
   * Custom delay function for testing (injectable).
   * Default: setTimeout-based delay
   */
  delayFn?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Default delay function using setTimeout
 */
function defaultDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason as Error);
      return;
    }

    const timeoutId = setTimeout(resolve, ms);

    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeoutId);
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });
}

/**
 * Retry policy - retries failed operations with configurable backoff.
 */
export class RetryPolicy<TResult = unknown> implements IPolicy<TResult> {
  readonly name: string;

  private readonly maxAttempts: number;
  private readonly maxDuration: number | undefined;
  private readonly backoff: BackoffStrategy;
  private readonly shouldRetryError: RetryPredicate;
  private readonly shouldRetryResult: ResultPredicate<TResult>;
  private readonly delayFn: (ms: number, signal: AbortSignal) => Promise<void>;

  private readonly successEmitter = new PolicyEventEmitter<SuccessEventArgs>();
  private readonly failureEmitter = new PolicyEventEmitter<FailureEventArgs>();
  private readonly retryEmitter = new PolicyEventEmitter<RetryEventArgs>();

  readonly onSuccess: PolicyEvent<SuccessEventArgs> = this.successEmitter.subscribe;
  readonly onFailure: PolicyEvent<FailureEventArgs> = this.failureEmitter.subscribe;
  readonly onRetry: PolicyEvent<RetryEventArgs> = this.retryEmitter.subscribe;

  constructor(options: RetryPolicyOptions<TResult> = {}) {
    this.name = options.name ?? 'RetryPolicy';
    this.maxAttempts = options.maxAttempts ?? 3;
    this.maxDuration = options.maxDuration;
    this.backoff = options.backoff ?? new ExponentialBackoff();
    this.shouldRetryError = options.shouldRetryError ?? ((): boolean => true);
    this.shouldRetryResult = options.shouldRetryResult ?? ((): boolean => false);
    this.delayFn = options.delayFn ?? defaultDelay;
  }

  async execute<T extends TResult>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    const abortController = new AbortController();
    const startTime = Date.now();
    const correlationId = crypto.randomUUID();

    // Link external signal to internal controller
    if (signal) {
      if (signal.aborted) {
        throw signal.reason as Error;
      }
      signal.addEventListener('abort', () => {
        abortController.abort(signal.reason);
      });
    }

    let lastError: Error | undefined;
    let attemptNumber = 0;

    while (attemptNumber <= this.maxAttempts) {
      attemptNumber++;

      // Check max duration
      if (this.maxDuration !== undefined) {
        const elapsed = Date.now() - startTime;
        if (elapsed >= this.maxDuration) {
          break;
        }
      }

      // Check if aborted
      if (abortController.signal.aborted) {
        throw abortController.signal.reason as Error;
      }

      const context = createExecutionContext({
        signal: abortController.signal,
        correlationId,
        attemptNumber,
        startTime,
      });

      try {
        const result = await fn(context);

        // Check if result should trigger retry
        if (this.shouldRetryResult(result) && attemptNumber <= this.maxAttempts) {
          const delay = this.backoff.getDelay(attemptNumber + 1);

          this.retryEmitter.emit({
            result,
            attemptNumber,
            delay,
            correlationId,
          });

          await this.delayFn(delay, abortController.signal);
          continue;
        }

        // Success
        const duration = Date.now() - startTime;
        this.successEmitter.emit({
          duration,
          attemptNumber,
          correlationId,
        });

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error should trigger retry
        if (!this.shouldRetryError(lastError) || attemptNumber > this.maxAttempts) {
          break;
        }

        const delay = this.backoff.getDelay(attemptNumber + 1);

        this.retryEmitter.emit({
          error: lastError,
          attemptNumber,
          delay,
          correlationId,
        });

        // Wait before next attempt (unless this was the last attempt)
        if (attemptNumber <= this.maxAttempts) {
          await this.delayFn(delay, abortController.signal);
        }
      }
    }

    // All retries exhausted
    const duration = Date.now() - startTime;
    this.failureEmitter.emit({
      error: lastError ?? new Error('Retry exhausted'),
      duration,
      attempts: attemptNumber,
      correlationId,
    });

    throw lastError ?? new Error('Retry exhausted');
  }
}

import { randomUUID } from 'crypto';
import type { IPolicy, PolicyOptions } from '../../types/policy';
import type { ExecutionContext } from '../../types/context';
import type { SuccessEventArgs, FailureEventArgs, PolicyEvent } from '../../types/events';
import { PolicyEventEmitter } from '../../types/events';
import { createExecutionContext } from '../../types/context';

/**
 * Predicate to determine if an error should trigger fallback.
 */
export type FallbackPredicate = (error: Error) => boolean;

/**
 * Predicate to determine if a result should trigger fallback.
 */
export type FallbackResultPredicate<T> = (result: T) => boolean;

/**
 * Function that produces a fallback value.
 */
export type FallbackFactory<T> = (
  error: Error | undefined,
  context: ExecutionContext,
) => T | Promise<T>;

/**
 * Arguments passed to the onFallback event.
 */
export interface FallbackEventArgs<T> {
  /** The error that triggered the fallback (if any) */
  readonly error?: Error;
  /** The result that triggered the fallback (if any) */
  readonly originalResult?: T;
  /** The fallback value returned */
  readonly fallbackValue: T;
  /** Correlation ID */
  readonly correlationId: string;
}

/**
 * Options for configuring a FallbackPolicy.
 */
export interface FallbackPolicyOptions<T = unknown> extends PolicyOptions {
  /** Static fallback value OR factory function that produces fallback */
  fallback: T | FallbackFactory<T>;

  /** Predicate to determine if an error should trigger fallback. Default: all errors */
  shouldHandle?: FallbackPredicate;

  /** Predicate to determine if a result should trigger fallback. Default: never */
  shouldHandleResult?: FallbackResultPredicate<T>;
}

/**
 * Fallback policy - returns a fallback value when the operation fails.
 */
export class FallbackPolicy<TResult = unknown> implements IPolicy<TResult> {
  readonly name: string;

  private readonly fallbackValue: TResult | FallbackFactory<TResult>;
  private readonly shouldHandle: FallbackPredicate;
  private readonly shouldHandleResult: FallbackResultPredicate<TResult>;

  private readonly successEmitter = new PolicyEventEmitter<SuccessEventArgs>();
  private readonly failureEmitter = new PolicyEventEmitter<FailureEventArgs>();
  private readonly fallbackEmitter = new PolicyEventEmitter<FallbackEventArgs<TResult>>();

  readonly onSuccess: PolicyEvent<SuccessEventArgs> = this.successEmitter.subscribe;
  readonly onFailure: PolicyEvent<FailureEventArgs> = this.failureEmitter.subscribe;
  readonly onFallback: PolicyEvent<FallbackEventArgs<TResult>> = this.fallbackEmitter.subscribe;

  constructor(options: FallbackPolicyOptions<TResult>) {
    this.name = options.name ?? 'FallbackPolicy';
    this.fallbackValue = options.fallback;
    this.shouldHandle = options.shouldHandle ?? ((): boolean => true);
    this.shouldHandleResult = options.shouldHandleResult ?? ((): boolean => false);
  }

  async execute<T extends TResult>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    const startTime = Date.now();
    const correlationId = randomUUID();

    if (signal?.aborted) {
      throw signal.reason as Error;
    }

    const context = createExecutionContext({
      signal: signal ?? new AbortController().signal,
      correlationId,
      attemptNumber: 1,
      startTime,
    });

    try {
      const result = await fn(context);

      // Check if result should trigger fallback
      if (this.shouldHandleResult(result as TResult)) {
        return (await this.provideFallback(
          undefined,
          result as TResult,
          context,
          correlationId,
          startTime,
        )) as T;
      }

      const duration = Date.now() - startTime;
      this.successEmitter.emit({
        duration,
        attemptNumber: 1,
        correlationId,
      });

      return result;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));

      if (this.shouldHandle(errorObj)) {
        return (await this.provideFallback(
          errorObj,
          undefined,
          context,
          correlationId,
          startTime,
        )) as T;
      }

      throw error;
    }
  }

  private async provideFallback(
    error: Error | undefined,
    originalResult: TResult | undefined,
    context: ExecutionContext,
    correlationId: string,
    startTime: number,
  ): Promise<TResult> {
    let fallbackValue: TResult;

    if (typeof this.fallbackValue === 'function') {
      fallbackValue = await (this.fallbackValue as FallbackFactory<TResult>)(error, context);
    } else {
      fallbackValue = this.fallbackValue;
    }

    const duration = Date.now() - startTime;

    const eventArgs: FallbackEventArgs<TResult> = {
      fallbackValue,
      correlationId,
    };
    if (error !== undefined) {
      (eventArgs as { error: Error }).error = error;
    }
    if (originalResult !== undefined) {
      (eventArgs as { originalResult: TResult }).originalResult = originalResult;
    }
    this.fallbackEmitter.emit(eventArgs);

    this.failureEmitter.emit({
      error: error ?? new Error('Fallback triggered by result'),
      duration,
      attempts: 1,
      correlationId,
    });

    // Return but cast to T (the fallback type should match)
    return fallbackValue;
  }
}

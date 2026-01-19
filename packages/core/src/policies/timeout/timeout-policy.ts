import type { IPolicy, PolicyOptions } from '../../types/policy';
import type { ExecutionContext } from '../../types/context';
import type { SuccessEventArgs, FailureEventArgs, PolicyEvent } from '../../types/events';
import { PolicyEventEmitter } from '../../types/events';
import { createExecutionContext } from '../../types/context';
import { TimeoutError } from '../../errors/timeout-error';

/**
 * Timeout strategy determines how the timeout is enforced.
 *
 * - `pessimistic`: Races the operation against a timeout. If timeout wins,
 *   TimeoutError is thrown but the operation continues in the background.
 *
 * - `optimistic`: Uses AbortSignal for cooperative cancellation. The operation
 *   should check the signal and abort gracefully.
 */
export type TimeoutStrategy = 'pessimistic' | 'optimistic';

/**
 * Arguments passed to the onTimeout event.
 */
export interface TimeoutEventArgs {
  /** The timeout duration in milliseconds */
  readonly timeoutMs: number;
  /** The elapsed time when timeout occurred */
  readonly elapsedMs: number;
  /** The correlation ID for this execution */
  readonly correlationId: string;
  /** The strategy used */
  readonly strategy: TimeoutStrategy;
}

/**
 * Options for configuring a TimeoutPolicy.
 */
export interface TimeoutPolicyOptions extends PolicyOptions {
  /** Timeout duration in milliseconds */
  timeoutMs: number;

  /** Timeout strategy. Default: 'pessimistic' */
  strategy?: TimeoutStrategy;
}

/**
 * Timeout policy - enforces a time limit on operations.
 */
export class TimeoutPolicy<TResult = unknown> implements IPolicy<TResult> {
  readonly name: string;

  private readonly timeoutMs: number;
  private readonly strategy: TimeoutStrategy;

  private readonly successEmitter = new PolicyEventEmitter<SuccessEventArgs>();
  private readonly failureEmitter = new PolicyEventEmitter<FailureEventArgs>();
  private readonly timeoutEmitter = new PolicyEventEmitter<TimeoutEventArgs>();

  readonly onSuccess: PolicyEvent<SuccessEventArgs> = this.successEmitter.subscribe;
  readonly onFailure: PolicyEvent<FailureEventArgs> = this.failureEmitter.subscribe;
  readonly onTimeout: PolicyEvent<TimeoutEventArgs> = this.timeoutEmitter.subscribe;

  constructor(options: TimeoutPolicyOptions) {
    this.name = options.name ?? 'TimeoutPolicy';
    this.timeoutMs = options.timeoutMs;
    this.strategy = options.strategy ?? 'pessimistic';
  }

  async execute<T extends TResult>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    const startTime = Date.now();
    const correlationId = crypto.randomUUID();

    // Create internal abort controller for timeout
    const timeoutController = new AbortController();

    // Link external signal if provided
    if (signal) {
      if (signal.aborted) {
        throw signal.reason as Error;
      }
      signal.addEventListener('abort', () => {
        timeoutController.abort(signal.reason);
      });
    }

    const context = createExecutionContext({
      signal: timeoutController.signal,
      correlationId,
      attemptNumber: 1,
      startTime,
    });

    if (this.strategy === 'pessimistic') {
      return this.executePessimistic(fn, context, startTime, correlationId, timeoutController);
    } else {
      return this.executeOptimistic(fn, context, startTime, correlationId, timeoutController);
    }
  }

  private async executePessimistic<T extends TResult>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    context: ExecutionContext,
    startTime: number,
    correlationId: string,
    controller: AbortController,
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        const elapsedMs = Date.now() - startTime;
        controller.abort(new TimeoutError(this.name, this.timeoutMs, elapsedMs));

        this.timeoutEmitter.emit({
          timeoutMs: this.timeoutMs,
          elapsedMs,
          correlationId,
          strategy: 'pessimistic',
        });

        reject(new TimeoutError(this.name, this.timeoutMs, elapsedMs));
      }, this.timeoutMs);
    });

    try {
      const result = await Promise.race([Promise.resolve(fn(context)), timeoutPromise]);

      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;
      this.successEmitter.emit({
        duration,
        attemptNumber: 1,
        correlationId,
      });

      return result;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof TimeoutError) {
        const duration = Date.now() - startTime;
        this.failureEmitter.emit({
          error,
          duration,
          attempts: 1,
          correlationId,
        });
      }

      throw error;
    }
  }

  private async executeOptimistic<T extends TResult>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    context: ExecutionContext,
    startTime: number,
    correlationId: string,
    controller: AbortController,
  ): Promise<T> {
    const timeoutId = setTimeout(() => {
      const elapsedMs = Date.now() - startTime;
      controller.abort(new TimeoutError(this.name, this.timeoutMs, elapsedMs));

      this.timeoutEmitter.emit({
        timeoutMs: this.timeoutMs,
        elapsedMs,
        correlationId,
        strategy: 'optimistic',
      });
    }, this.timeoutMs);

    try {
      const result = await fn(context);

      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;
      this.successEmitter.emit({
        duration,
        attemptNumber: 1,
        correlationId,
      });

      return result;
    } catch (error) {
      clearTimeout(timeoutId);

      const errorObj = error instanceof Error ? error : new Error(String(error));
      const duration = Date.now() - startTime;

      this.failureEmitter.emit({
        error: errorObj,
        duration,
        attempts: 1,
        correlationId,
      });

      throw error;
    }
  }
}

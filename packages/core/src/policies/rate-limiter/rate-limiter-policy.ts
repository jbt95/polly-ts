import type { IPolicy, PolicyOptions, ExecutionContext } from '../../types';
import type { SuccessEventArgs, FailureEventArgs, PolicyEvent } from '../../types/events';
import { PolicyEventEmitter } from '../../types/events';
import { createExecutionContext } from '../../types/context';
import { RateLimitRejectedError } from '../../errors/rate-limit-rejected-error';
import type { IRateLimiterStrategy } from './rate-limiter-strategy';

export interface RateLimiterPolicyOptions extends PolicyOptions {
  strategy: IRateLimiterStrategy;
  /**
   * If true, wait for a permit (up to maxWaitMs).
   * If false, fail immediately if no permit available.
   * Default: false (fail fast)
   */
  waitForPermit?: boolean;
  maxWaitMs?: number;
}

export class RateLimiterPolicy implements IPolicy {
  readonly name: string;

  private readonly strategy: IRateLimiterStrategy;
  private readonly waitForPermit: boolean;
  private readonly maxWaitMs: number;

  private readonly successEmitter = new PolicyEventEmitter<SuccessEventArgs>();
  private readonly failureEmitter = new PolicyEventEmitter<FailureEventArgs>();

  readonly onSuccess: PolicyEvent<SuccessEventArgs> = this.successEmitter.subscribe;
  readonly onFailure: PolicyEvent<FailureEventArgs> = this.failureEmitter.subscribe;

  constructor(options: RateLimiterPolicyOptions) {
    this.name = options.name ?? 'RateLimiterPolicy';
    this.strategy = options.strategy;
    this.waitForPermit = options.waitForPermit ?? false;
    this.maxWaitMs = options.maxWaitMs ?? 0;
  }

  async execute<T>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    const correlationId = crypto.randomUUID();
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

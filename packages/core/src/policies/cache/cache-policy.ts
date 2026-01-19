import { randomUUID } from 'crypto';
import type { IPolicy, PolicyOptions, ExecutionContext } from '../../types';
import {
  PolicyEventEmitter,
  type SuccessEventArgs,
  type FailureEventArgs,
} from '../../types/events';
import { createExecutionContext } from '../../types/context';
import type { ICacheProvider } from './cache-provider';
import { MemoryCacheProvider } from './cache-provider';

export interface CachePolicyOptions extends PolicyOptions {
  provider?: ICacheProvider;
  /**
   * Time to live in milliseconds.
   * Default: undefined (forever)
   */
  ttlMs?: number;
  /**
   * Key generator function.
   * Default: Uses context.operationKey or throws if missing.
   */
  keyGenerator?: (context: ExecutionContext) => string;
}

export interface CacheHitEventArgs {
  key: string;
  correlationId: string;
}

export interface CacheMissEventArgs {
  key: string;
  correlationId: string;
}

export class CachePolicy implements IPolicy {
  readonly name: string;
  private readonly provider: ICacheProvider;
  private readonly ttlMs?: number;
  private readonly keyGenerator: (context: ExecutionContext) => string;

  private readonly successEmitter = new PolicyEventEmitter<SuccessEventArgs>();
  private readonly failureEmitter = new PolicyEventEmitter<FailureEventArgs>();
  private readonly cacheHitEmitter = new PolicyEventEmitter<CacheHitEventArgs>();
  private readonly cacheMissEmitter = new PolicyEventEmitter<CacheMissEventArgs>();

  readonly onSuccess = this.successEmitter.subscribe;
  readonly onFailure = this.failureEmitter.subscribe;
  readonly onCacheHit = this.cacheHitEmitter.subscribe;
  readonly onCacheMiss = this.cacheMissEmitter.subscribe;

  constructor(options: CachePolicyOptions = {}) {
    this.name = options.name ?? 'CachePolicy';
    this.provider = options.provider ?? new MemoryCacheProvider();
    this.ttlMs = options.ttlMs ?? 0;
    this.keyGenerator =
      options.keyGenerator ??
      ((ctx): string => {
        if (!ctx.operationKey) {
          throw new Error(
            'CachePolicy requires a unique operationKey in the execution context or a keyGenerator',
          );
        }
        return ctx.operationKey;
      });
  }

  async execute<T>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    const correlationId = randomUUID();
    const startTime = Date.now();

    const abortController = new AbortController();
    if (signal) {
      signal.addEventListener('abort', () => { abortController.abort(signal.reason); });
    }

    const context = createExecutionContext({
      signal: abortController.signal,
      correlationId,
      startTime,
      attemptNumber: 1,
    });

    const key = this.keyGenerator(context);

    const cached = await this.provider.get(key);
    if (cached !== undefined) {
      this.cacheHitEmitter.emit({ key, correlationId });
      this.successEmitter.emit({
        duration: Date.now() - startTime,
        attemptNumber: 1,
        correlationId,
      });
      return cached as T;
    }

    this.cacheMissEmitter.emit({ key, correlationId });

    try {
      const result = await fn(context);
      await this.provider.set(key, result, this.ttlMs);

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

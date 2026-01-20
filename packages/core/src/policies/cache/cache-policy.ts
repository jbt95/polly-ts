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

/**
 * Configuration options for the CachePolicy.
 *
 * @example
 * ```typescript
 * const options: CachePolicyOptions = {
 *   provider: new MemoryCacheProvider(),
 *   ttlMs: 60000, // 1 minute TTL
 *   keyGenerator: (ctx) => `user:${ctx.operationKey}`,
 * };
 * ```
 */
export interface CachePolicyOptions extends PolicyOptions {
  /**
   * The cache storage provider to use.
   *
   * @default MemoryCacheProvider (in-memory cache)
   * @see {@link ICacheProvider} for implementing custom providers
   */
  provider?: ICacheProvider;

  /**
   * Time to live for cached values in milliseconds.
   *
   * After this duration, cached values are considered expired and the
   * operation will be re-executed on the next request.
   *
   * @default 0 (cache indefinitely)
   */
  ttlMs?: number;

  /**
   * Function to generate cache keys from the execution context.
   *
   * The generated key should uniquely identify the operation and its parameters.
   * If not provided, uses `context.operationKey` (and throws if missing).
   *
   * @param context - The execution context containing operation metadata.
   * @returns A unique string key for the cache entry.
   *
   * @example
   * ```typescript
   * // Key based on operation and user ID
   * keyGenerator: (ctx) => `${ctx.operationKey}:${userId}`
   * ```
   */
  keyGenerator?: (context: ExecutionContext) => string;
}

/**
 * Event arguments emitted when a cached value is found (cache hit).
 */
export interface CacheHitEventArgs {
  /** The cache key that was hit. */
  readonly key: string;

  /** Unique identifier for this execution. */
  readonly correlationId: string;
}

/**
 * Event arguments emitted when a cached value is not found (cache miss).
 */
export interface CacheMissEventArgs {
  /** The cache key that was missed. */
  readonly key: string;

  /** Unique identifier for this execution. */
  readonly correlationId: string;
}

/**
 * A resilience policy that caches operation results to avoid redundant computations.
 *
 * The CachePolicy stores successful operation results and returns cached values
 * on subsequent requests with the same cache key, reducing load on downstream
 * systems and improving response times.
 *
 * **Behavior:**
 * 1. Generate cache key from context (via `keyGenerator` or `operationKey`)
 * 2. Check cache for existing value
 *    - If found: return cached value (cache hit)
 *    - If not found: execute operation, cache result, return result (cache miss)
 * 3. Failed operations are NOT cached
 *
 * **Use Cases:**
 * - Caching expensive computations
 * - Reducing database load for read-heavy operations
 * - API response caching
 * - Memoization of function results
 *
 * @example
 * ```typescript
 * // Basic caching with 5-minute TTL
 * const policy = new CachePolicy({
 *   ttlMs: 300000,
 * });
 *
 * // The operationKey is used as the cache key
 * const context = createExecutionContext({ operationKey: 'user:123' });
 * const user = await policy.execute(
 *   () => fetchUserFromDatabase(123),
 *   undefined,
 * );
 * ```
 *
 * @example
 * ```typescript
 * // Custom key generation and cache provider
 * const policy = new CachePolicy({
 *   provider: new RedisCacheProvider(redisClient),
 *   ttlMs: 60000,
 *   keyGenerator: (ctx) => `api:${ctx.operationKey}:v2`,
 * });
 *
 * policy.onCacheHit(({ key }) => console.log(`Cache hit: ${key}`));
 * policy.onCacheMiss(({ key }) => console.log(`Cache miss: ${key}`));
 * ```
 */
export class CachePolicy implements IPolicy {
  /** The name of this policy instance, used for logging and debugging. */
  readonly name: string;

  private readonly provider: ICacheProvider;
  private readonly ttlMs?: number;
  private readonly keyGenerator: (context: ExecutionContext) => string;

  private readonly successEmitter = new PolicyEventEmitter<SuccessEventArgs>();
  private readonly failureEmitter = new PolicyEventEmitter<FailureEventArgs>();
  private readonly cacheHitEmitter = new PolicyEventEmitter<CacheHitEventArgs>();
  private readonly cacheMissEmitter = new PolicyEventEmitter<CacheMissEventArgs>();

  /**
   * Event emitted when an operation completes successfully (from cache or execution).
   */
  readonly onSuccess = this.successEmitter.subscribe;

  /**
   * Event emitted when the underlying operation fails.
   * Note: Cache lookup failures do not trigger this event.
   */
  readonly onFailure = this.failureEmitter.subscribe;

  /**
   * Event emitted when a cached value is found and returned.
   * Useful for cache hit rate monitoring.
   */
  readonly onCacheHit = this.cacheHitEmitter.subscribe;

  /**
   * Event emitted when no cached value is found and the operation is executed.
   * Useful for cache hit rate monitoring.
   */
  readonly onCacheMiss = this.cacheMissEmitter.subscribe;

  /**
   * Creates a new CachePolicy.
   *
   * @param options - Configuration options for caching behavior.
   */
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

  /**
   * Executes an operation with caching support.
   *
   * First checks the cache for an existing value. If found, returns immediately
   * without executing the operation. If not found, executes the operation and
   * caches the successful result.
   *
   * @typeParam T - The return type of the operation.
   * @param fn - The operation to execute on cache miss.
   * @param signal - Optional AbortSignal to cancel the operation.
   * @returns The cached or freshly computed result.
   * @throws Error if no `operationKey` is in context and no `keyGenerator` was provided.
   * @throws Any error thrown by the operation itself (errors are not cached).
   */
  async execute<T>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    const correlationId = randomUUID();
    const startTime = Date.now();

    const abortController = new AbortController();
    if (signal) {
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

/**
 * Interface for cache storage providers.
 *
 * Implementations provide the underlying storage mechanism for the CachePolicy.
 * Providers can be synchronous (in-memory) or asynchronous (Redis, database).
 *
 * **Built-in Implementations:**
 * - {@link MemoryCacheProvider} - Simple in-memory cache (default)
 *
 * **Custom Implementation Example:**
 * ```typescript
 * class RedisCacheProvider implements ICacheProvider {
 *   constructor(private client: RedisClient) {}
 *
 *   async get(key: string): Promise<unknown> {
 *     const value = await this.client.get(key);
 *     return value ? JSON.parse(value) : undefined;
 *   }
 *
 *   async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
 *     const serialized = JSON.stringify(value);
 *     if (ttlMs) {
 *       await this.client.set(key, serialized, 'PX', ttlMs);
 *     } else {
 *       await this.client.set(key, serialized);
 *     }
 *   }
 *
 *   async delete(key: string): Promise<void> {
 *     await this.client.del(key);
 *   }
 * }
 * ```
 */
export interface ICacheProvider {
  /**
   * Retrieves a value from the cache.
   *
   * @param key - The cache key to look up.
   * @returns The cached value, or `undefined` if not found or expired.
   *          May return a Promise for async providers.
   */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- intentional sync/async return
  get(key: string): Promise<unknown> | unknown;

  /**
   * Stores a value in the cache.
   *
   * @param key - The cache key.
   * @param value - The value to cache. Must be serializable if using a remote provider.
   * @param ttlMs - Time to live in milliseconds. If not specified or `0`, the value
   *                should be cached indefinitely (or until explicitly deleted).
   */
  set(key: string, value: unknown, ttlMs?: number): Promise<void> | void;

  /**
   * Removes a value from the cache.
   *
   * @param key - The cache key to delete.
   */
  delete(key: string): Promise<void> | void;
}

/**
 * Simple in-memory cache provider with TTL support.
 *
 * Stores cached values in a JavaScript Map. Values are expired lazily on read
 * (expired entries are not proactively cleaned up).
 *
 * **Characteristics:**
 * - Fast: No network overhead
 * - Ephemeral: Lost on process restart
 * - No size limit: May consume unbounded memory
 * - Not distributed: Not shared between processes
 *
 * **Use Cases:**
 * - Development and testing
 * - Single-process applications
 * - Short-lived caches with natural eviction
 *
 * For production distributed systems, consider implementing a provider
 * backed by Redis, Memcached, or a similar distributed cache.
 *
 * @example
 * ```typescript
 * const provider = new MemoryCacheProvider();
 *
 * // Store a value with 5-minute TTL
 * provider.set('user:123', { name: 'Alice' }, 300000);
 *
 * // Retrieve the value
 * const user = provider.get('user:123');
 * ```
 */
export class MemoryCacheProvider implements ICacheProvider {
  /** Internal storage map with expiration metadata. */
  private readonly store = new Map<string, { value: unknown; expiresAt: number }>();

  /**
   * Retrieves a value from the cache.
   *
   * Returns `undefined` if the key doesn't exist or the value has expired.
   * Expired entries are deleted on access (lazy expiration).
   *
   * @param key - The cache key to look up.
   * @returns The cached value or `undefined`.
   */
  get(key: string): unknown {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Stores a value in the cache with optional TTL.
   *
   * @param key - The cache key.
   * @param value - The value to store.
   * @param ttlMs - Time to live in milliseconds. If `0`, `undefined`, or not specified,
   *                the value is cached indefinitely.
   */
  set(key: string, value: unknown, ttlMs?: number): void {
    const expiresAt = ttlMs && ttlMs > 0 ? Date.now() + ttlMs : Number.MAX_SAFE_INTEGER;
    this.store.set(key, { value, expiresAt });
  }

  /**
   * Removes a value from the cache.
   *
   * @param key - The cache key to delete.
   */
  delete(key: string): void {
    this.store.delete(key);
  }
}

/**
 * Interface for cache providers.
 */
export interface ICacheProvider {
  /**
   * Retrieves a value from the cache.
   * @param key The cache key.
   * @returns The value or undefined if not found.
   */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- intentional sync/async return
  get(key: string): Promise<unknown> | unknown;

  /**
   * Sets a value in the cache.
   * @param key The cache key.
   * @param value The value to store.
   * @param ttlMs Time to live in milliseconds.
   */
  set(key: string, value: unknown, ttlMs?: number): Promise<void> | void;

  /**
   * Removes a value from the cache.
   * @param key The cache key.
   */
  delete(key: string): Promise<void> | void;
}

/**
 * Simple in-memory cache provider.
 */
export class MemoryCacheProvider implements ICacheProvider {
  private readonly store = new Map<string, { value: unknown; expiresAt: number }>();

  get(key: string): unknown {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: unknown, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? Number.MAX_SAFE_INTEGER);
    this.store.set(key, { value, expiresAt });
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}

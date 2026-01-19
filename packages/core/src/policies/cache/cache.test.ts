import { describe, it, expect, vi } from 'vitest';
import { CachePolicy } from './cache-policy';
import { MemoryCacheProvider } from './cache-provider';

describe('CachePolicy', () => {
  it('should return cached value on hit', async () => {
    const provider = new MemoryCacheProvider();
    provider.set('test-key', 'cached-value');

    const policy = new CachePolicy({
      provider,
      keyGenerator: (): string => 'test-key',
    });

    const fn = vi.fn().mockReturnValue('fresh-value');

    const result = await policy.execute<string>(fn);

    expect(result).toBe('cached-value');
    expect(fn).not.toHaveBeenCalled();
  });

  it('should execute and cache on miss', async () => {
    const provider = new MemoryCacheProvider();
    const policy = new CachePolicy({
      provider,
      keyGenerator: (): string => 'miss-key',
    });

    const fn = vi.fn().mockReturnValue('fresh-value');

    const result = await policy.execute<string>(fn);

    expect(result).toBe('fresh-value');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(await provider.get('miss-key')).toBe('fresh-value');
  });

  it('should respect TTL', async () => {
    const provider = new MemoryCacheProvider();
    const policy = new CachePolicy({
      provider,
      keyGenerator: (): string => 'ttl-key',
      ttlMs: 10,
    });

    // Execute to cache
    await policy.execute(() => 'val');
    expect(await provider.get('ttl-key')).toBe('val');

    // Wait for expiration
    await new Promise((r) => setTimeout(r, 20));

    // Should be gone
    expect(await provider.get('ttl-key')).toBeUndefined();

    // Execute again should refresh
    const fn = vi.fn().mockReturnValue('val-2');
    await policy.execute(fn);
    expect(fn).toHaveBeenCalled();
  });
});

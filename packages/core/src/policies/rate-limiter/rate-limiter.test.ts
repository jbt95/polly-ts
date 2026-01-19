import { describe, it, expect } from 'vitest';
import { RateLimiterPolicy } from './rate-limiter-policy';
import { TokenBucketStrategy } from './token-bucket';
import { RateLimitRejectedError } from '../../errors/rate-limit-rejected-error';

describe('RateLimiterPolicy', () => {
  it('should allow requests within limit', async () => {
    const strategy = new TokenBucketStrategy({ capacity: 10, refillRate: 1 });
    const policy = new RateLimiterPolicy({ strategy });

    await expect(policy.execute(() => 'ok')).resolves.toBe('ok');
  });

  it('should reject requests exceeding capacity', async () => {
    // 1 token capacity, refill very slow
    const strategy = new TokenBucketStrategy({
      capacity: 1,
      refillRate: 1,
      refillIntervalMs: 10000,
    });
    const policy = new RateLimiterPolicy({ strategy });

    await expect(policy.execute(() => 'ok')).resolves.toBe('ok');

    // Second call immediately fails
    await expect(policy.execute(() => 'ok')).rejects.toThrow(RateLimitRejectedError);
  });

  it('should support waiting for permits', async () => {
    // 1 token, refill every 100ms
    const strategy = new TokenBucketStrategy({ capacity: 1, refillRate: 1, refillIntervalMs: 100 });
    const policy = new RateLimiterPolicy({
      strategy,
      waitForPermit: true,
      maxWaitMs: 200,
    });

    await expect(policy.execute(() => 'ok1')).resolves.toBe('ok1');

    const start = Date.now();
    await expect(policy.execute(() => 'ok2')).resolves.toBe('ok2');
    const elapsed = Date.now() - start;

    // Should have waited at least 100ms (minus execution time) for refill
    expect(elapsed).toBeGreaterThanOrEqual(90);
  });

  it('should timeout if waiting too long', async () => {
    // 1 token, refill every 10s
    const strategy = new TokenBucketStrategy({
      capacity: 1,
      refillRate: 1,
      refillIntervalMs: 10000,
    });
    const policy = new RateLimiterPolicy({
      strategy,
      waitForPermit: true,
      maxWaitMs: 100, // wait 100ms, but refill needs 10s
    });

    await expect(policy.execute(() => 'ok')).resolves.toBe('ok');
    await expect(policy.execute(() => 'ok')).rejects.toThrow(RateLimitRejectedError);
  });
});

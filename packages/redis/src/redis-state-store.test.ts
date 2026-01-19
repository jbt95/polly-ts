/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { describe, it, expect, beforeEach } from 'vitest';
import Redis from 'ioredis-mock';
import { RedisStateStore } from './redis-state-store';

describe('RedisStateStore', () => {
  let redis: any;
  let store: RedisStateStore;

  const options = {
    client: null as any, // set in beforeEach
    name: 'test-policy',
    failThreshold: 2,
    breakDuration: 100,
    successThreshold: 2,
  };

  beforeEach(() => {
    redis = new Redis();
    options.client = redis;
    store = new RedisStateStore(options);
  });

  it('should start in closed state', async () => {
    expect(await store.getState()).toBe('closed');
  });

  it('should transition to open after failure threshold reached', async () => {
    // 1st failure
    expect(await store.recordFailure('corr-1')).toBe(false);
    expect(await store.getState()).toBe('closed');

    // 2nd failure (threshold)
    expect(await store.recordFailure('corr-2')).toBe(true);
    expect(await store.getState()).toBe('open');
  });

  it('should transition to half-open after break duration', async () => {
    await store.setState('open', 'corr-1');
    const openedAt = Date.now() - 200; // 200ms ago, break is 100ms
    await redis.hset('polly:cb:test-policy', 'openedAt', openedAt);

    expect(await store.getState()).toBe('halfOpen');
  });

  it('should fail immediately when half-open', async () => {
    await store.setState('halfOpen', 'corr-1');

    expect(await store.recordFailure('corr-2')).toBe(true);
    expect(await store.getState()).toBe('open');
  });

  it('should close after success threshold in half-open', async () => {
    await store.setState('halfOpen', 'corr-1');

    // 1st success
    expect(await store.recordSuccess('corr-1')).toBe(false);
    expect(await store.getState()).toBe('halfOpen'); // Still half-open (need 2 successes)

    // 2nd success
    expect(await store.recordSuccess('corr-2')).toBe(true);
    expect(await store.getState()).toBe('closed');
  });

  it('should persist state across store instances', async () => {
    await store.setState('open', 'corr-1');

    const store2 = new RedisStateStore({ ...options, client: redis });
    expect(await store2.getState()).toBe('open');
  });
});

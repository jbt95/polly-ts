import { describe, it, expect, vi } from 'vitest';
import { PolicyWrap, pipeline } from './index';
import { RetryPolicy } from '../retry/retry-policy';
import { TimeoutPolicy } from '../timeout/timeout-policy';
import { CircuitBreakerPolicy } from '../circuit-breaker/circuit-breaker-policy';
import type { ExecutionContext } from '../../types/context';
import type { IPolicy } from '../../types/policy';

describe('PolicyWrap', () => {
  it('should execute outer policy then inner policy', async () => {
    const events: string[] = [];

    const outer: IPolicy<string> = {
      name: 'Outer',
      execute: async <T extends string>(fn: (ctx: ExecutionContext) => Promise<T> | T): Promise<T> => {
        events.push('outer-start');
        const result = await fn({ signal: new AbortController().signal } as ExecutionContext);
        events.push('outer-end');
        return result;
      },
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    };

    const inner: IPolicy<string> = {
      name: 'Inner',
      execute: async <T extends string>(fn: (ctx: ExecutionContext) => Promise<T> | T): Promise<T> => {
        events.push('inner-start');
        const result = await fn({ signal: new AbortController().signal } as ExecutionContext);
        events.push('inner-end');
        return result;
      },
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    };

    const wrap = new PolicyWrap(outer, inner);
    await wrap.execute(() => {
      events.push('execute');
      return 'success';
    });

    expect(events).toEqual(['outer-start', 'inner-start', 'execute', 'inner-end', 'outer-end']);
  });

  describe('Integration: Retry wrapping Timeout', () => {
    // Retry(Timeout(Operation))
    // If operation times out, Retry should catch it and retry.
    it('should retry on timeout', async () => {
      const retry = new RetryPolicy({ maxAttempts: 2, delayFn: (): Promise<void> => Promise.resolve() });
      const timeout = new TimeoutPolicy({ timeoutMs: 50, strategy: 'pessimistic' });

      const wrap = new PolicyWrap(retry, timeout);

      let attempts = 0;
      const result = await wrap.execute(async () => {
        attempts++;
        if (attempts === 1) {
          // First attempt: simulate slow operation that times out
          await new Promise((r) => setTimeout(r, 100));
          return 'slow';
        }
        return 'success';
      });

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });
  });

  describe('Integration: CircuitBreaker wrapping Retry', () => {
    // CircuitBreaker(Retry(Operation))
    // If Retry fails exhausted, CircuitBreaker sees one failure.
    // If CircuitBreaker opens, subsequent calls fail fast.
    it('should open circuit after retries exhausted', async () => {
      const circuitBreaker = new CircuitBreakerPolicy({ failureThreshold: 1 });
      const retry = new RetryPolicy({ maxAttempts: 1, delayFn: (): Promise<void> => Promise.resolve() });

      const wrap = new PolicyWrap(circuitBreaker, retry);

      // First call: fails 1 initial + 1 retry = 2 attempts, but 1 overall failure to CB
      await expect(wrap.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      expect(await circuitBreaker.getState()).toBe('open');

      // Second call: fails fast due to CB, retry not even invoked
      const fn = vi.fn();
      await expect(wrap.execute(fn)).rejects.toThrow(/Circuit breaker is open/);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('pipeline', () => {
    it('should combine multiple policies in order', async () => {
      const events: string[] = [];

      const p1: IPolicy<string> = {
        name: 'P1',
        execute: async <T extends string>(fn: (ctx: ExecutionContext) => Promise<T> | T): Promise<T> => {
          events.push('p1-start');
          const res = await fn({ signal: new AbortController().signal } as ExecutionContext);
          events.push('p1-end');
          return res;
        },
        onSuccess: vi.fn(),
        onFailure: vi.fn(),
      };

      const p2: IPolicy<string> = {
        name: 'P2',
        execute: async <T extends string>(fn: (ctx: ExecutionContext) => Promise<T> | T): Promise<T> => {
          events.push('p2-start');
          const res = await fn({ signal: new AbortController().signal } as ExecutionContext);
          events.push('p2-end');
          return res;
        },
        onSuccess: vi.fn(),
        onFailure: vi.fn(),
      };

      const p3: IPolicy<string> = {
        name: 'P3',
        execute: async <T extends string>(fn: (ctx: ExecutionContext) => Promise<T> | T): Promise<T> => {
          events.push('p3-start');
          const res = await fn({ signal: new AbortController().signal } as ExecutionContext);
          events.push('p3-end');
          return res;
        },
        onSuccess: vi.fn(),
        onFailure: vi.fn(),
      };

      const pipe = pipeline(p1, p2, p3);

      await pipe.execute(() => {
        events.push('execute');
        return 'ok';
      });

      expect(events).toEqual([
        'p1-start',
        'p2-start',
        'p3-start',
        'execute',
        'p3-end',
        'p2-end',
        'p1-end',
      ]);
    });
  });
});

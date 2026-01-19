import { describe, it, expect, vi } from 'vitest';
import {
  RetryPolicy,
  ConstantBackoff,
  ExponentialBackoff,
  ExponentialBackoffWithJitter,
} from './index';
import type { ExecutionContext } from '../../types/context';

describe('RetryPolicy', () => {
  // Instant delay for testing
  const instantDelay = (): Promise<void> => Promise.resolve();

  describe('basic retry behavior', () => {
    it('should succeed on first attempt without retrying', async () => {
      const policy = new RetryPolicy({ delayFn: instantDelay });
      const fn = vi.fn().mockResolvedValue('success');

      const result = await policy.execute<string>(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const policy = new RetryPolicy({ maxAttempts: 3, delayFn: instantDelay });
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      const result = await policy.execute<string>(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after exhausting all retries', async () => {
      const policy = new RetryPolicy({ maxAttempts: 2, delayFn: instantDelay });
      const fn = vi.fn().mockRejectedValue(new Error('always fails'));

      await expect(policy.execute(fn)).rejects.toThrow('always fails');
      expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });
  });

  describe('retry predicates', () => {
    it('should only retry errors matching the predicate', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        delayFn: instantDelay,
        shouldRetryError: (error): boolean => error.message.includes('transient'),
      });

      const fn = vi.fn().mockRejectedValue(new Error('permanent error'));

      await expect(policy.execute(fn)).rejects.toThrow('permanent error');
      expect(fn).toHaveBeenCalledTimes(1); // No retries
    });

    it('should retry when result matches predicate', async () => {
      const policy = new RetryPolicy<number>({
        maxAttempts: 3,
        delayFn: instantDelay,
        shouldRetryResult: (result): boolean => result < 10,
      });

      const fn = vi.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(8).mockResolvedValue(15);

      const result = await policy.execute<number>(fn);

      expect(result).toBe(15);
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('events', () => {
    it('should emit onRetry event on each retry', async () => {
      const policy = new RetryPolicy({ maxAttempts: 2, delayFn: instantDelay });
      const retryHandler = vi.fn();
      policy.onRetry(retryHandler);

      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      await policy.execute(fn);

      expect(retryHandler).toHaveBeenCalledTimes(2);
      expect(retryHandler).toHaveBeenCalledWith(expect.objectContaining({ attemptNumber: 1 }));
      expect(retryHandler).toHaveBeenCalledWith(expect.objectContaining({ attemptNumber: 2 }));
    });

    it('should emit onSuccess on successful completion', async () => {
      const policy = new RetryPolicy({ delayFn: instantDelay });
      const successHandler = vi.fn();
      policy.onSuccess(successHandler);

      await policy.execute(() => Promise.resolve('ok'));

      expect(successHandler).toHaveBeenCalledTimes(1);
      expect(successHandler).toHaveBeenCalledWith(expect.objectContaining({ attemptNumber: 1 }));
    });

    it('should emit onFailure when retries exhausted', async () => {
      const policy = new RetryPolicy({ maxAttempts: 1, delayFn: instantDelay });
      const failureHandler = vi.fn();
      policy.onFailure(failureHandler);

      const fn = vi.fn().mockRejectedValue(new Error('failed'));

      await expect(policy.execute(fn)).rejects.toThrow();

      expect(failureHandler).toHaveBeenCalledTimes(1);
      expect(failureHandler).toHaveBeenCalledWith(expect.objectContaining({ attempts: 2 }));
    });
  });

  describe('context', () => {
    it('should pass context with incrementing attempt number', async () => {
      const policy = new RetryPolicy({ maxAttempts: 2, delayFn: instantDelay });
      const contexts: number[] = [];

      const fn = vi.fn().mockImplementation((ctx: ExecutionContext): string => {
        contexts.push(ctx.attemptNumber);
        if (contexts.length < 3) {
          throw new Error('retry');
        }
        return 'done';
      });

      await policy.execute(fn);

      expect(contexts).toEqual([1, 2, 3]);
    });

    it('should provide AbortSignal in context', async () => {
      const policy = new RetryPolicy({ delayFn: instantDelay });

      await policy.execute((ctx) => {
        expect(ctx.signal).toBeInstanceOf(AbortSignal);
        return Promise.resolve('ok');
      });
    });
  });
});

describe('Backoff Strategies', () => {
  describe('ConstantBackoff', () => {
    it('should return constant delay', () => {
      const backoff = new ConstantBackoff({ delay: 500 });

      expect(backoff.getDelay(2)).toBe(500);
      expect(backoff.getDelay(3)).toBe(500);
      expect(backoff.getDelay(10)).toBe(500);
    });
  });

  describe('ExponentialBackoff', () => {
    it('should calculate exponential delay', () => {
      const backoff = new ExponentialBackoff({ initialDelay: 100, multiplier: 2 });

      expect(backoff.getDelay(2)).toBe(100); // First retry
      expect(backoff.getDelay(3)).toBe(200);
      expect(backoff.getDelay(4)).toBe(400);
    });

    it('should cap at maxDelay', () => {
      const backoff = new ExponentialBackoff({
        initialDelay: 100,
        multiplier: 2,
        maxDelay: 500,
      });

      expect(backoff.getDelay(10)).toBe(500);
    });
  });

  describe('ExponentialBackoffWithJitter', () => {
    it('should return delay within expected range for full jitter', () => {
      const backoff = new ExponentialBackoffWithJitter({
        initialDelay: 100,
        jitter: 'full',
      });

      // Run multiple times to test randomness stays in bounds
      for (let i = 0; i < 100; i++) {
        const delay = backoff.getDelay(2);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(100);
      }
    });

    it('should return delay within expected range for equal jitter', () => {
      const backoff = new ExponentialBackoffWithJitter({
        initialDelay: 100,
        jitter: 'equal',
      });

      for (let i = 0; i < 100; i++) {
        const delay = backoff.getDelay(2);
        expect(delay).toBeGreaterThanOrEqual(50);
        expect(delay).toBeLessThanOrEqual(100);
      }
    });
  });
});

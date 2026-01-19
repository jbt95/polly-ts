import { describe, it, expect, vi } from 'vitest';
import { CircuitBreakerPolicy } from './index';
import { CircuitOpenError } from '../../errors/circuit-open-error';

describe('CircuitBreakerPolicy', () => {
  describe('closed state behavior', () => {
    it('should execute successfully when circuit is closed', async () => {
      const policy = new CircuitBreakerPolicy();

      const result = await policy.execute(() => Promise.resolve('success'));

      expect(result).toBe('success');
      expect(await policy.getState()).toBe('closed');
    });

    it('should remain closed after failures below threshold', async () => {
      const policy = new CircuitBreakerPolicy({ failureThreshold: 3 });

      // Fail twice (below threshold of 3)
      for (let i = 0; i < 2; i++) {
        await expect(policy.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }

      expect(await policy.getState()).toBe('closed');
    });

    it('should open circuit after reaching failure threshold', async () => {
      const policy = new CircuitBreakerPolicy({ failureThreshold: 3 });

      // Fail 3 times to reach threshold
      for (let i = 0; i < 3; i++) {
        await expect(policy.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }

      expect(await policy.getState()).toBe('open');
    });
  });

  describe('open state behavior', () => {
    it('should reject immediately when circuit is open', async () => {
      const policy = new CircuitBreakerPolicy({ failureThreshold: 1 });

      // Fail once to open
      await expect(policy.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      expect(await policy.getState()).toBe('open');

      // Should reject immediately without calling the function
      const fn = vi.fn().mockResolvedValue('success');
      await expect(policy.execute(fn)).rejects.toThrow(CircuitOpenError);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('half-open state behavior', () => {
    it('should transition to half-open after break duration', async () => {
      vi.useFakeTimers();

      const policy = new CircuitBreakerPolicy({
        failureThreshold: 1,
        breakDuration: 1000,
      });

      // Fail to open
      await expect(policy.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      expect(await policy.getState()).toBe('open');

      // Advance time past break duration
      vi.advanceTimersByTime(1001);

      expect(await policy.getState()).toBe('halfOpen');

      vi.useRealTimers();
    });

    it('should close circuit after success in half-open state', async () => {
      vi.useFakeTimers();

      const policy = new CircuitBreakerPolicy({
        failureThreshold: 1,
        breakDuration: 100,
        successThreshold: 1,
      });

      // Fail to open
      await expect(policy.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      // Advance to half-open
      vi.advanceTimersByTime(101);
      expect(await policy.getState()).toBe('halfOpen');

      vi.useRealTimers();

      // Succeed to close
      await policy.execute(() => Promise.resolve('success'));
      expect(await policy.getState()).toBe('closed');
    });

    it('should re-open circuit after failure in half-open state', async () => {
      vi.useFakeTimers();

      const policy = new CircuitBreakerPolicy({
        failureThreshold: 1,
        breakDuration: 100,
      });

      // Fail to open
      await expect(policy.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      // Advance to half-open
      vi.advanceTimersByTime(101);
      expect(await policy.getState()).toBe('halfOpen');

      vi.useRealTimers();

      // Fail again - should re-open
      await expect(policy.execute(() => Promise.reject(new Error('fail again')))).rejects.toThrow();
      expect(await policy.getState()).toBe('open');
    });
  });

  describe('isolation and reset', () => {
    it('should reject when manually isolated', async () => {
      const policy = new CircuitBreakerPolicy();
      await policy.isolate();

      expect(await policy.getState()).toBe('isolated');
      await expect(policy.execute(() => Promise.resolve('ok'))).rejects.toThrow(CircuitOpenError);
    });

    it('should allow execution after reset', async () => {
      const policy = new CircuitBreakerPolicy({ failureThreshold: 1 });

      // Fail to open
      await expect(policy.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      expect(await policy.getState()).toBe('open');

      // Reset
      await policy.reset();
      expect(await policy.getState()).toBe('closed');

      // Should work again
      const result = await policy.execute(() => Promise.resolve('success'));
      expect(result).toBe('success');
    });
  });

  describe('events', () => {
    it('should emit onStateChange when circuit opens', async () => {
      const policy = new CircuitBreakerPolicy({ failureThreshold: 1 });
      const stateChangeHandler = vi.fn();
      policy.onStateChange(stateChangeHandler);

      await expect(policy.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      expect(stateChangeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          fromState: 'closed',
          toState: 'open',
        }),
      );
    });

    it('should emit onSuccess on successful execution', async () => {
      const policy = new CircuitBreakerPolicy();
      const successHandler = vi.fn();
      policy.onSuccess(successHandler);

      await policy.execute(() => Promise.resolve('ok'));

      expect(successHandler).toHaveBeenCalledTimes(1);
    });

    it('should emit onFailure when circuit rejects', async () => {
      const policy = new CircuitBreakerPolicy({ failureThreshold: 1 });
      const failureHandler = vi.fn();
      policy.onFailure(failureHandler);

      // Fail to open
      await expect(policy.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      // Try while open
      await expect(policy.execute(() => Promise.resolve('ok'))).rejects.toThrow();

      // Two failures: one for the actual failure, one for circuit rejection
      expect(failureHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('failure predicates', () => {
    it('should only count matching errors as failures', async () => {
      const policy = new CircuitBreakerPolicy({
        failureThreshold: 2,
        shouldHandle: (error): boolean => error.message.includes('transient'),
      });

      // Non-matching error should not count
      await expect(policy.execute(() => Promise.reject(new Error('permanent')))).rejects.toThrow();
      expect(await policy.getState()).toBe('closed');

      // Matching errors should count
      await expect(
        policy.execute(() => Promise.reject(new Error('transient 1'))),
      ).rejects.toThrow();
      await expect(
        policy.execute(() => Promise.reject(new Error('transient 2'))),
      ).rejects.toThrow();
      expect(await policy.getState()).toBe('open');
    });
  });
});

import { describe, it, expect, vi } from 'vitest';
import { BulkheadPolicy } from './index';
import { BulkheadRejectedError } from '../../errors/bulkhead-rejected-error';

describe('BulkheadPolicy', () => {
  describe('concurrency limiting', () => {
    it('should allow execution within limit', async () => {
      const policy = new BulkheadPolicy({ maxConcurrent: 2 });

      const result = await policy.execute(() => Promise.resolve('success'));

      expect(result).toBe('success');
    });

    it('should reject when at capacity with no queue', async () => {
      const policy = new BulkheadPolicy({ maxConcurrent: 1, maxQueue: 0 });

      // Start a slow operation
      const slowOp = policy.execute(
        () =>
          new Promise((resolve) =>
            setTimeout(() => {
              resolve('slow');
            }, 100),
          ),
      );

      // Second should be rejected immediately
      await expect(policy.execute(() => Promise.resolve('second'))).rejects.toThrow(
        BulkheadRejectedError,
      );

      // First should succeed
      await expect(slowOp).resolves.toBe('slow');
    });

    it('should queue requests when queue is available', async () => {
      const policy = new BulkheadPolicy({ maxConcurrent: 1, maxQueue: 1 });
      const order: number[] = [];

      const op1 = policy.execute(async () => {
        await new Promise((r) => setTimeout(r, 50));
        order.push(1);
        return 'first';
      });

      const op2 = policy.execute(() => {
        order.push(2);
        return 'second';
      });

      await Promise.all([op1, op2]);

      expect(order).toEqual([1, 2]);
    });
  });

  describe('slot inspection', () => {
    it('should report available execution slots', async () => {
      const policy = new BulkheadPolicy({ maxConcurrent: 3 });

      expect(policy.executionSlots).toBe(3);

      const pendingOps: Promise<string>[] = [];
      for (let i = 0; i < 2; i++) {
        pendingOps.push(
          policy.execute(
            () =>
              new Promise((r) =>
                setTimeout(() => {
                  r('done');
                }, 50),
              ),
          ),
        );
      }

      // Allow operations to start
      await new Promise((r) => setTimeout(r, 10));
      expect(policy.executionSlots).toBe(1);

      await Promise.all(pendingOps);
      expect(policy.executionSlots).toBe(3);
    });
  });

  describe('events', () => {
    it('should emit onReject when capacity exceeded', async () => {
      const policy = new BulkheadPolicy({ maxConcurrent: 1, maxQueue: 0 });
      const rejectHandler = vi.fn();
      policy.onReject(rejectHandler);

      // Start first operation
      const op1 = policy.execute(
        () =>
          new Promise((resolve) =>
            setTimeout(() => {
              resolve('first');
            }, 100),
          ),
      );

      // Try second - should be rejected
      await expect(policy.execute(() => Promise.resolve('second'))).rejects.toThrow();

      expect(rejectHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          activeCount: 1,
          maxConcurrent: 1,
        }),
      );

      await op1;
    });

    it('should emit onSuccess on completion', async () => {
      const policy = new BulkheadPolicy();
      const successHandler = vi.fn();
      policy.onSuccess(successHandler);

      await policy.execute(() => Promise.resolve('ok'));

      expect(successHandler).toHaveBeenCalledTimes(1);
    });

    it('should emit onFailure when operation fails', async () => {
      const policy = new BulkheadPolicy();
      const failureHandler = vi.fn();
      policy.onFailure(failureHandler);

      await expect(policy.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      expect(failureHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('abort signal', () => {
    it('should respect external abort signal', async () => {
      const policy = new BulkheadPolicy();
      const controller = new AbortController();
      controller.abort(new Error('Cancelled'));

      await expect(policy.execute(() => Promise.resolve('ok'), controller.signal)).rejects.toThrow(
        'Cancelled',
      );
    });
  });
});

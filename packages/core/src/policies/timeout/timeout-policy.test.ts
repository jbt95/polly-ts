import { describe, it, expect, vi } from 'vitest';
import { TimeoutPolicy } from './index';
import { TimeoutError } from '../../errors/timeout-error';

describe('TimeoutPolicy', () => {
  describe('pessimistic strategy', () => {
    it('should complete successfully before timeout', async () => {
      const policy = new TimeoutPolicy({ timeoutMs: 1000, strategy: 'pessimistic' });

      const result = await policy.execute(() => Promise.resolve('success'));

      expect(result).toBe('success');
    });

    it('should throw TimeoutError when operation exceeds timeout', async () => {
      const policy = new TimeoutPolicy({ timeoutMs: 50, strategy: 'pessimistic' });

      const slowOperation = (): Promise<string> =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve('too late');
          }, 200),
        );

      await expect(policy.execute(slowOperation)).rejects.toThrow(TimeoutError);
    });

    it('should emit onTimeout event when timeout occurs', async () => {
      const policy = new TimeoutPolicy({ timeoutMs: 50, strategy: 'pessimistic' });
      const timeoutHandler = vi.fn();
      policy.onTimeout(timeoutHandler);

      const slowOperation = (): Promise<string> =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve('too late');
          }, 200),
        );

      await expect(policy.execute(slowOperation)).rejects.toThrow();

      expect(timeoutHandler).toHaveBeenCalledTimes(1);
      expect(timeoutHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          timeoutMs: 50,
          strategy: 'pessimistic',
        }),
      );
    });

    it('should emit onSuccess when completing before timeout', async () => {
      const policy = new TimeoutPolicy({ timeoutMs: 1000, strategy: 'pessimistic' });
      const successHandler = vi.fn();
      policy.onSuccess(successHandler);

      await policy.execute(() => Promise.resolve('ok'));

      expect(successHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('optimistic strategy', () => {
    it('should complete successfully before timeout', async () => {
      const policy = new TimeoutPolicy({ timeoutMs: 1000, strategy: 'optimistic' });

      const result = await policy.execute(() => Promise.resolve('success'));

      expect(result).toBe('success');
    });

    it('should abort signal when timeout occurs', async () => {
      const policy = new TimeoutPolicy({ timeoutMs: 50, strategy: 'optimistic' });
      let signalAborted = false;

      const cooperativeOperation = (ctx: { signal: AbortSignal }): Promise<string> =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            resolve('completed');
          }, 200);

          ctx.signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            signalAborted = true;
            reject(ctx.signal.reason as Error);
          });
        });

      await expect(policy.execute(cooperativeOperation)).rejects.toThrow(TimeoutError);
      expect(signalAborted).toBe(true);
    });

    it('should emit onTimeout when signal is aborted due to timeout', async () => {
      const policy = new TimeoutPolicy({ timeoutMs: 50, strategy: 'optimistic' });
      const timeoutHandler = vi.fn();
      policy.onTimeout(timeoutHandler);

      const cooperativeOperation = (ctx: { signal: AbortSignal }): Promise<string> =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            resolve('completed');
          }, 200);
          ctx.signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(ctx.signal.reason as Error);
          });
        });

      await expect(policy.execute(cooperativeOperation)).rejects.toThrow();

      expect(timeoutHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: 'optimistic',
        }),
      );
    });
  });

  describe('external abort signal', () => {
    it('should respect external abort signal with optimistic strategy', async () => {
      const policy = new TimeoutPolicy({ timeoutMs: 1000, strategy: 'optimistic' });
      const externalController = new AbortController();

      const cooperativeOperation = (ctx: { signal: AbortSignal }): Promise<string> =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            resolve('done');
          }, 500);
          ctx.signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(ctx.signal.reason as Error);
          });
        });

      // Abort after 50ms
      setTimeout(() => {
        externalController.abort(new Error('User cancelled'));
      }, 50);

      await expect(policy.execute(cooperativeOperation, externalController.signal)).rejects.toThrow(
        'User cancelled',
      );
    });

    it('should throw immediately if signal already aborted', async () => {
      const policy = new TimeoutPolicy({ timeoutMs: 1000 });
      const controller = new AbortController();
      controller.abort(new Error('Already aborted'));

      await expect(policy.execute(() => Promise.resolve('ok'), controller.signal)).rejects.toThrow(
        'Already aborted',
      );
    });
  });

  describe('error propagation', () => {
    it('should propagate errors that are not timeouts', async () => {
      const policy = new TimeoutPolicy({ timeoutMs: 1000 });

      await expect(
        policy.execute(() => Promise.reject(new Error('Operation failed'))),
      ).rejects.toThrow('Operation failed');
    });
  });
});

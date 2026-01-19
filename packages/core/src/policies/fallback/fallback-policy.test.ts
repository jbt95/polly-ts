import { describe, it, expect, vi } from 'vitest';
import { FallbackPolicy } from './index';

describe('FallbackPolicy', () => {
  describe('static fallback value', () => {
    it('should return result on success', async () => {
      const policy = new FallbackPolicy({ fallback: 'fallback' });

      const result = await policy.execute(() => Promise.resolve('success'));

      expect(result).toBe('success');
    });

    it('should return fallback on error', async () => {
      const policy = new FallbackPolicy({ fallback: 'fallback' });

      const result = await policy.execute(() => Promise.reject(new Error('fail')));

      expect(result).toBe('fallback');
    });
  });

  describe('dynamic fallback function', () => {
    it('should call fallback function with error', async () => {
      const fallbackFn = vi.fn().mockReturnValue('fallback-value');
      const policy = new FallbackPolicy({ fallback: fallbackFn });

      const result = await policy.execute(() => Promise.reject(new Error('operation failed')));

      expect(result).toBe('fallback-value');
      expect(fallbackFn).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'operation failed' }),
        expect.objectContaining({ correlationId: expect.any(String) as string }),
      );
    });

    it('should support async fallback function', async () => {
      const policy = new FallbackPolicy({
        fallback: async (): Promise<string> => {
          await new Promise((r) => setTimeout(r, 10));
          return 'async-fallback';
        },
      });

      const result = await policy.execute(() => Promise.reject(new Error('fail')));

      expect(result).toBe('async-fallback');
    });
  });

  describe('predicates', () => {
    it('should only trigger fallback for matching errors', async () => {
      const policy = new FallbackPolicy({
        fallback: 'fallback',
        shouldHandle: (error): boolean => error.message.includes('transient'),
      });

      // Non-matching error should throw
      await expect(policy.execute(() => Promise.reject(new Error('permanent')))).rejects.toThrow(
        'permanent',
      );

      // Matching error should fallback
      const result = await policy.execute(() => Promise.reject(new Error('transient error')));
      expect(result).toBe('fallback');
    });

    it('should trigger fallback on result predicate match', async () => {
      const policy = new FallbackPolicy<string | null>({
        fallback: 'default',
        shouldHandleResult: (result): boolean => result === null,
      });

      const result = await policy.execute(() => Promise.resolve(null));

      expect(result).toBe('default');
    });
  });

  describe('events', () => {
    it('should emit onFallback when fallback is used', async () => {
      const policy = new FallbackPolicy({ fallback: 'fallback' });
      const fallbackHandler = vi.fn();
      policy.onFallback(fallbackHandler);

      await policy.execute(() => Promise.reject(new Error('fail')));

      expect(fallbackHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          fallbackValue: 'fallback',
        }),
      );
    });

    it('should emit onSuccess when no fallback needed', async () => {
      const policy = new FallbackPolicy({ fallback: 'fallback' });
      const successHandler = vi.fn();
      policy.onSuccess(successHandler);

      await policy.execute(() => Promise.resolve('ok'));

      expect(successHandler).toHaveBeenCalledTimes(1);
    });

    it('should emit onFailure when fallback is used', async () => {
      const policy = new FallbackPolicy({ fallback: 'fallback' });
      const failureHandler = vi.fn();
      policy.onFailure(failureHandler);

      await policy.execute(() => Promise.reject(new Error('fail')));

      expect(failureHandler).toHaveBeenCalledTimes(1);
    });
  });
});

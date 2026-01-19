import { describe, it, expect, vi } from 'vitest';
import { HedgingPolicy } from './hedging-policy';
import type { ExecutionContext } from '../../types/context';

describe('HedgingPolicy', () => {
  it('should return first successful result', async () => {
    const policy = new HedgingPolicy({ delayMs: 10, maxHedges: 1 });

    // First attempt acts slow
    // Second attempt (hedge) acts fast

    const fn = vi.fn().mockImplementation(async (ctx: ExecutionContext): Promise<string> => {
      if (ctx.attemptNumber === 1) {
        await new Promise((r) => setTimeout(r, 100)); // Slow primary
        return 'primary';
      }
      if (ctx.attemptNumber === 2) {
        return 'hedge'; // Fast hedge
      }
      return 'unknown';
    });

    const result = await policy.execute<string>(fn);

    expect(result).toBe('hedge');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should fail only if all attempts fail', async () => {
    const policy = new HedgingPolicy({ delayMs: 1, maxHedges: 1 });

    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(policy.execute(fn)).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(2); // Primary + 1 hedge
  });

  it('should not hedge if primary finishes fast', async () => {
    const policy = new HedgingPolicy({ delayMs: 50, maxHedges: 1 });

    const fn = vi.fn().mockResolvedValue('fast'); // Immediate

    const result = await policy.execute<string>(fn);

    expect(result).toBe('fast');
    // Wait a bit to ensure hedge didn't fire late?
    await new Promise((r) => setTimeout(r, 60));
    // Ideally we want to check it WASN'T called.
    // But my implementation checks `!completed` inside timeout.
    // `onResult` sets `completed = true`.
    // So timeout fires, checks `completed`, and does NOT launch.

    expect(fn).toHaveBeenCalledTimes(1);
  });
});

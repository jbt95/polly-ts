import type { MiddlewareHandler } from 'hono';
import type { IPolicy } from 'polly-ts-core';

/**
 * Creates a Hono middleware that applies a Polly policy.
 * @param policy The policy to apply.
 * @returns Hono MiddlewareHandler.
 */
export function polly(policy: IPolicy): MiddlewareHandler {
  return async (c, next) => {
    return policy.execute(async (context) => {
      c.set('pollySignal', context.signal);
      await next();
      if (c.res.status >= 500) {
        throw new Error(`HTTP ${String(c.res.status)}`);
      }
    });
  };
}

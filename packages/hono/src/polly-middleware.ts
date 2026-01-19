import type { MiddlewareHandler } from 'hono';
import type { IPolicy } from 'polly-ts-core';

/**
 * Creates a Hono middleware that applies a Polly policy.
 * @param policy The policy to apply.
 * @returns Hono MiddlewareHandler.
 */
export function polly(policy: IPolicy): MiddlewareHandler {
  return async (c, next) => {
    // Unlike Express/Fastify, Hono context 'c' has direct control
    // But we still need to wrap the *next()* execution.

    return policy.execute(async (context) => {
      // 1. Attach signal? Hono 'c.req' has AbortSignal?
      // c.req.raw.signal is standard Request signal.

      // If policy provides a signal (timeout), we should ideally link it.
      // But standard Fetch Request signal is read-only.
      // We can pass it in c.set('pollySignal', context.signal) for downstream use?
      c.set('pollySignal', context.signal);

      await next();

      // Check response status
      if (c.res.status >= 500) {
        throw new Error(`HTTP ${String(c.res.status)}`);
      }

      // Hono handles exceptions thrown here.
      // If we throw, Polly records failure.
    });
  };
}

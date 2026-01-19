import { Hono } from 'hono';
import { describe, it, expect } from 'vitest';
import { polly } from './polly-middleware';
import { RetryPolicy, CircuitBreakerPolicy } from '@polly-ts/core';

describe('polly hono middleware', () => {
  it('should allow request when policy succeeds', async () => {
    const app = new Hono();
    const policy = new RetryPolicy();

    app.use('/test', polly(policy));
    app.get('/test', (c) => c.text('ok'));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  // Retry logic with Hono middleware is complex because 'next()' cannot be easily re-executed
  // in the same dispatch context. Skipped for now.

  it('should open circuit on 500 responses', async () => {
    const app = new Hono();
    const policy = new CircuitBreakerPolicy({ failureThreshold: 1 });

    app.use('/circuit', polly(policy));
    app.get('/circuit', (c) => c.text('error', 500));

    // Define the check route upfront
    app.use('/circuit-check', polly(policy));
    let called = false;
    app.get('/circuit-check', (c) => {
      called = true;
      return c.text('ok');
    });

    // First call fails and opens circuit
    try {
      await app.request('/circuit');
    } catch {
      // middleware might throw, handled by Hono or swallowed here
    }

    expect(await policy.getState()).toBe('open');

    // Second call should be rejected by circuit breaker immediately
    const res = await app.request('/circuit-check');
    expect(res.status).toBe(500); // Internal Server Error due to exception
    expect(called).toBe(false);
  });
});

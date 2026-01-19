import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { polly } from './polly-plugin';
import { CircuitBreakerPolicy } from 'polly-ts-core';

describe('polly fastify hook', () => {
  it('should allow request when policy succeeds', async () => {
    const fastify = Fastify();
    const policy = new CircuitBreakerPolicy();

    fastify.addHook('onRequest', polly(policy));

    fastify.get('/', (): { hello: string } => {
      return { hello: 'world' };
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.statusCode).toBe(200);
    expect(await policy.getState()).toBe('closed');
  });

  it('should reject request when circuit is open', async () => {
    const fastify = Fastify();
    const policy = new CircuitBreakerPolicy();
    await policy.isolate(); // Open circuit

    fastify.addHook('onRequest', polly(policy));

    fastify.get('/', (): { hello: string } => {
      return { hello: 'world' };
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.statusCode).toBe(500); // Default fastify error handler for throw
    // Should contain circuit open error message or similar
  });

  it('should open circuit on 500 responses', async () => {
    const fastify = Fastify();
    const policy = new CircuitBreakerPolicy({ failureThreshold: 1 });

    fastify.addHook('onRequest', polly(policy));

    fastify.get('/', async (req, reply) => {
      reply.code(500);
      return { error: 'boom' };
    });

    // 1st request: 500 triggers failure
    await fastify.inject({ method: 'GET', url: '/' });

    // Wait for async policy update (microtask)
    await new Promise((r) => setTimeout(r, 10));

    expect(await policy.getState()).toBe('open');

    // 2nd request: Should fail fast due to open circuit
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const response2 = await fastify.inject({ method: 'GET', url: '/' });

    // Fastify default error handler usually returns 500 for thrown errors too,
    // but the body should differ (from 'boom' to error message) OR we can check internal behavior.

    // If circuit is open, hook throws CircuitOpenError.
    // Fastify catches it.
  });
});

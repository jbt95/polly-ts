/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { polly } from './polly-middleware';
import { CircuitBreakerPolicy, CircuitOpenError } from 'polly-ts-core';
import { EventEmitter } from 'events';
import type { Request, Response, NextFunction } from 'express';

describe('polly middleware', () => {
  let req: Request;
  let res: Response & EventEmitter;
  let next: NextFunction;

  beforeEach(() => {
    req = {} as Request;
    const mockRes = new EventEmitter() as Response & EventEmitter;
    mockRes.statusCode = 200;
    mockRes.headersSent = false;
    mockRes.destroy = vi.fn();
    res = mockRes;
    next = vi.fn();
  });

  it('should execute next() and finish successfully', async () => {
    const policy = new CircuitBreakerPolicy();
    const middleware = polly(policy);

    middleware(req, res, next);

    await new Promise((r) => setTimeout(r, 0));
    expect(next).toHaveBeenCalled();

    // Simulate response finish
    res.emit('finish');

    // Policy should record success (we can verify state)
    expect(await policy.getState()).toBe('closed');
  });

  it('should call next(err) if circuit is open', async () => {
    const policy = new CircuitBreakerPolicy();
    await policy.isolate(); // Force open

    const middleware = polly(policy);

    middleware(req, res, next);

    // Wait for microtasks
    await new Promise(process.nextTick);

    expect(next).toHaveBeenCalledWith(expect.any(CircuitOpenError));
  });

  it('should treat 500 as failure and update circuit state', async () => {
    const policy = new CircuitBreakerPolicy({ failureThreshold: 1 });
    const middleware = polly(policy);

    middleware(req, res, next);

    await new Promise((r) => setTimeout(r, 0));
    expect(next).toHaveBeenCalled();

    // Simulate 500 error
    res.statusCode = 500;
    res.emit('finish');

    // Wait for async policy handling to update value
    await new Promise((r) => setTimeout(r, 10));

    expect(await policy.getState()).toBe('open');
  });
});

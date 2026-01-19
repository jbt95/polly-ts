/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unused-vars, @typescript-eslint/explicit-function-return-type, @typescript-eslint/require-await, no-empty */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pollyFetch, HttpError } from './polly-fetch';
import { RetryPolicy } from '@polly-ts/core';

describe('pollyFetch', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should pass through successful requests', async () => {
    const mockResponse = { ok: true, status: 200, text: () => Promise.resolve('ok') } as Response;
    (global.fetch as any).mockResolvedValue(mockResponse);

    const policy = new RetryPolicy();
    const fetchWithPolly = pollyFetch(policy);

    const response = await fetchWithPolly('https://api.example.com');

    expect(response).toBe(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith('https://api.example.com', {
      signal: expect.any(AbortSignal),
    });
  });

  it('should throw HttpError for failure status codes (default 500/429)', async () => {
    const mockResponse = {
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    } as Response;
    (global.fetch as any).mockResolvedValue(mockResponse);

    const policy = new RetryPolicy({ maxAttempts: 1 }); // Don't actually retry effectively, just pass through
    const fetchWithPolly = pollyFetch(policy);

    await expect(fetchWithPolly('https://api.example.com')).rejects.toThrow(HttpError);
  });

  it('should retry on failure status codes with RetryPolicy', async () => {
    // 1st attempt: 503
    // 2nd attempt: 200
    const failResponse = { ok: false, status: 503, statusText: 'Unavailable' } as Response;
    const successResponse = { ok: true, status: 200 } as Response;

    const fetchMock = global.fetch as any;
    fetchMock.mockResolvedValueOnce(failResponse).mockResolvedValueOnce(successResponse);

    const policy = new RetryPolicy({ maxAttempts: 2, delayFn: () => Promise.resolve() });
    const fetchWithPolly = pollyFetch(policy);

    const response = await fetchWithPolly('https://api.example.com');

    expect(response).toBe(successResponse);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('should respect custom shouldFail predicate', async () => {
    const mockResponse = { ok: false, status: 400 } as Response; // 400 usually not retried
    (global.fetch as any).mockResolvedValue(mockResponse);

    const policy = new RetryPolicy();
    // Configure to fail on 400
    const fetchWithPolly = pollyFetch(policy, {
      shouldFail: (res) => res.status === 400,
    });

    await expect(fetchWithPolly('https://api.example.com')).rejects.toThrow(HttpError);
  });

  it('should propagate AbortSignal from policy context (Timeout)', async () => {
    const fetchMock = global.fetch as any;
    // Mock fetch to resolve immediately so we can check args
    fetchMock.mockResolvedValue(new Response('ok'));

    // Mock policy that creates a signal
    const mockPolicy = {
      name: 'Mock',
      execute: async (fn: any, signal: any) => {
        // Create a new controller/signal like TimeoutPolicy would
        const controller = new AbortController();
        return fn({ signal: controller.signal });
      },
      onSuccess: vi.fn(),
      onFailure: vi.fn(),
    };

    const fetchWithPolly = pollyFetch(mockPolicy as any);

    // We expect the fetch to be called with the signal provided by the context
    try {
      await fetchWithPolly('https://example.com');
    } catch {}

    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[1].signal).toBeInstanceOf(AbortSignal);
  });
});

import type { IPolicy } from '@polly-ts/core';

/**
 * Options for configuring pollyFetch.
 */
export interface PollyFetchOptions {
  /**
   * Predicate to determine if a response should be treated as a failure.
   * If true, an HTTPError will be thrown, triggering policy failure handling.
   * Default: Returns true for status 429 and 5xx.
   */
  shouldFail?: (response: Response) => boolean;
}

/**
 * Custom error class for HTTP failures.
 */
export class HttpError extends Error {
  constructor(
    public readonly response: Response,
    message?: string,
  ) {
    super(message ?? `HTTP ${String(response.status)} ${response.statusText}`);
    this.name = 'HttpError';
  }
}

const defaultShouldFail = (response: Response): boolean => {
  return response.status === 429 || response.status >= 500;
};

/**
 * Wraps the global fetch function (or any custom fetch) with a Polly policy.
 *
 * @param policy The policy to wrap the fetch call with.
 * @param options Configuration options.
 * @returns A decorated fetch function.
 */
export function pollyFetch(
  policy: IPolicy<Response>,
  options: PollyFetchOptions = {},
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const shouldFail = options.shouldFail ?? defaultShouldFail;

  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Extract signal to pass to policy execution context if present
    const signal = init?.signal as AbortSignal | undefined;

    return policy.execute(async (context) => {
      // Merge context signal with init signal if both exist
      // Priority: Context signal (controlled by Timeout/Cancellation policies) > Init signal (user)
      // Actually, we should respect both. If policy controls it, we use that.
      const fetchSignal = context.signal;

      const modifiedInit: RequestInit = {
        ...init,
        signal: fetchSignal,
      };

      const response = await fetch(input, modifiedInit);

      if (shouldFail(response)) {
        throw new HttpError(response);
      }

      return response;
    }, signal);
  };
}

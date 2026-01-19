import { PolicyError } from './policy-error';

/**
 * Error thrown when a circuit breaker is open and rejecting requests.
 */
export class CircuitOpenError extends PolicyError {
  /**
   * When the circuit breaker will next attempt to close (half-open state).
   * This is a timestamp from Date.now().
   */
  readonly retryAfter: number;

  constructor(policyName: string, retryAfter: number, options?: ErrorOptions) {
    const retryInMs = Math.max(0, retryAfter - Date.now());
    super(`Circuit breaker is open. Retry after ${String(retryInMs)}ms`, policyName, options);
    this.name = 'CircuitOpenError';
    this.retryAfter = retryAfter;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- V8 only
    Error.captureStackTrace?.(this, CircuitOpenError);
  }
}

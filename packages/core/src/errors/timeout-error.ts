import { PolicyError } from './policy-error';

/**
 * Error thrown when an operation exceeds its timeout duration.
 */
export class TimeoutError extends PolicyError {
  /**
   * The timeout duration that was exceeded, in milliseconds.
   */
  readonly timeoutMs: number;

  /**
   * The actual elapsed time before timeout, in milliseconds.
   */
  readonly elapsedMs: number;

  constructor(policyName: string, timeoutMs: number, elapsedMs: number, options?: ErrorOptions) {
    super(
      `Operation timed out after ${String(elapsedMs)}ms (timeout: ${String(timeoutMs)}ms)`,
      policyName,
      options,
    );
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
    this.elapsedMs = elapsedMs;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- V8 only
    Error.captureStackTrace?.(this, TimeoutError);
  }
}

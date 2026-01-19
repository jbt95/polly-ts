import { PolicyError } from './policy-error';

/**
 * Error thrown when a bulkhead policy rejects a request due to capacity limits.
 */
export class BulkheadRejectedError extends PolicyError {
  /**
   * The maximum number of concurrent executions allowed.
   */
  readonly maxConcurrent: number;

  /**
   * The maximum queue depth allowed.
   */
  readonly maxQueue: number;

  constructor(policyName: string, maxConcurrent: number, maxQueue: number, options?: ErrorOptions) {
    super(
      `Bulkhead capacity exceeded (max concurrent: ${String(maxConcurrent)}, max queue: ${String(maxQueue)})`,
      policyName,
      options,
    );
    this.name = 'BulkheadRejectedError';
    this.maxConcurrent = maxConcurrent;
    this.maxQueue = maxQueue;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- V8 only
    Error.captureStackTrace?.(this, BulkheadRejectedError);
  }
}

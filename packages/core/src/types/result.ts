/**
 * Detailed outcome of a policy execution.
 *
 * @typeParam T - The result value type
 */
export interface ExecutionResult<T> {
  /**
   * Whether the execution completed successfully.
   */
  readonly success: boolean;

  /**
   * The result value if successful.
   */
  readonly value?: T;

  /**
   * The error if execution failed.
   */
  readonly error?: Error;

  /**
   * The reason for the execution outcome.
   */
  readonly outcome: ExecutionOutcome;

  /**
   * Total number of attempts made (including the final one).
   */
  readonly attempts: number;

  /**
   * Total duration of the execution in milliseconds.
   */
  readonly duration: number;

  /**
   * Durations of individual attempts in milliseconds.
   */
  readonly attemptDurations: readonly number[];
}

/**
 * Possible outcomes of a policy execution.
 */
export type ExecutionOutcome =
  | 'success'
  | 'failure'
  | 'timeout'
  | 'circuitOpen'
  | 'bulkheadRejected'
  | 'rateLimited'
  | 'cancelled';

/**
 * Creates a successful ExecutionResult.
 */
export function createSuccessResult<T>(
  value: T,
  attempts: number,
  duration: number,
  attemptDurations: readonly number[],
): ExecutionResult<T> {
  return {
    success: true,
    value,
    outcome: 'success',
    attempts,
    duration,
    attemptDurations,
  };
}

/**
 * Creates a failed ExecutionResult.
 */
export function createFailureResult<T>(
  error: Error,
  outcome: ExecutionOutcome,
  attempts: number,
  duration: number,
  attemptDurations: readonly number[],
): ExecutionResult<T> {
  return {
    success: false,
    error,
    outcome,
    attempts,
    duration,
    attemptDurations,
  };
}

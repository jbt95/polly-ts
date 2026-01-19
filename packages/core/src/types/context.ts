/**
 * Context passed to every policy execution.
 * Contains metadata about the current execution attempt.
 */
export interface ExecutionContext {
  /**
   * AbortSignal for cancellation support.
   * The executing function should check this signal and abort if requested.
   */
  readonly signal: AbortSignal;

  /**
   * Unique identifier for correlating logs and traces across retries.
   */
  readonly correlationId: string;

  /**
   * Optional key identifying the operation being executed.
   * Useful for metrics and logging.
   */
  readonly operationKey?: string;

  /**
   * Current attempt number (1-indexed).
   * For non-retry policies, this is always 1.
   */
  readonly attemptNumber: number;

  /**
   * Timestamp when the execution started (from Date.now()).
   */
  readonly startTime: number;
}

/**
 * Creates a new ExecutionContext with default values.
 */
export function createExecutionContext(
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext {
  const context: ExecutionContext = {
    signal: overrides.signal ?? new AbortController().signal,
    correlationId: overrides.correlationId ?? crypto.randomUUID(),
    attemptNumber: overrides.attemptNumber ?? 1,
    startTime: overrides.startTime ?? Date.now(),
  };

  if (overrides.operationKey !== undefined) {
    return { ...context, operationKey: overrides.operationKey };
  }

  return context;
}

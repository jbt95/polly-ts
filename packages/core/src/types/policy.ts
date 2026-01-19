import type { ExecutionContext } from './context';
import type { PolicyEvent, SuccessEventArgs, FailureEventArgs } from './events';

/**
 * The core interface that all resilience policies implement.
 * Provides a consistent execution model with event-based observability.
 *
 * @typeParam TResult - The expected result type from policy execution
 */
export interface IPolicy<TResult = unknown> {
  /**
   * A unique name for this policy instance.
   */
  readonly name: string;

  /**
   * Executes a function through this policy's resilience behavior.
   *
   * @param fn - The function to execute, receives an ExecutionContext
   * @param signal - Optional AbortSignal for cancellation
   * @returns A promise that resolves with the function's result
   */
  execute<T extends TResult>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T>;

  /**
   * Fires when a request completes successfully.
   */
  readonly onSuccess: PolicyEvent<SuccessEventArgs>;

  /**
   * Fires when a request fails due to a handled error.
   */
  readonly onFailure: PolicyEvent<FailureEventArgs>;
}

/**
 * Base options shared by all policies.
 */
export interface PolicyOptions {
  /**
   * Optional name for this policy instance.
   * If not provided, a default name will be generated.
   */
  name?: string;
}

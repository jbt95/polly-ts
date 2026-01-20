/**
 * Event listener function type.
 */
export type PolicyEventListener<T> = (args: T) => void;

/**
 * Event interface for subscribing to policy events.
 */
/**
 * Subscribe to this event.
 * @param listener - The callback to invoke when the event fires
 * @returns A function to unsubscribe
 */
export type PolicyEvent<T> = (listener: PolicyEventListener<T>) => () => void;

/**
 * Arguments passed to the onSuccess event.
 */
export interface SuccessEventArgs {
  /**
   * The duration of the successful execution in milliseconds.
   */
  readonly duration: number;

  /**
   * The attempt number that succeeded (1-indexed).
   */
  readonly attemptNumber: number;

  /**
   * The correlation ID for this execution.
   */
  readonly correlationId: string;
}

/**
 * Arguments passed to the onFailure event.
 */
export interface FailureEventArgs {
  /**
   * The error that caused the failure.
   */
  readonly error: Error;

  /**
   * The duration of the failed execution in milliseconds.
   */
  readonly duration: number;

  /**
   * The number of attempts made before giving up.
   */
  readonly attempts: number;

  /**
   * The correlation ID for this execution.
   */
  readonly correlationId: string;
}

/**
 * Internal event emitter for policies.
 */
export class PolicyEventEmitter<T> {
  private readonly listeners = new Set<PolicyEventListener<T>>();

  /**
   * Subscribe to this event.
   */
  readonly subscribe: PolicyEvent<T> = (listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Emit the event to all listeners.
   */
  emit(args: T): void {
    for (const listener of this.listeners) {
      try {
        listener(args);
      } catch {
        // Swallow errors in event listeners to prevent breaking execution
      }
    }
  }
}

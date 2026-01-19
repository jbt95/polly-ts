import type { IPolicy, PolicyOptions } from '../../types/policy';
import type { ExecutionContext } from '../../types/context';
import type { SuccessEventArgs, FailureEventArgs, PolicyEvent } from '../../types/events';
import { PolicyEventEmitter } from '../../types/events';
import { createExecutionContext } from '../../types/context';
import { CircuitOpenError } from '../../errors/circuit-open-error';
import { MemoryStateStore } from './state-store';
import type { CircuitBreakerStateStore } from './state-store';

/**
 * Circuit breaker states.
 */
export type CircuitState = 'closed' | 'open' | 'halfOpen' | 'isolated';

/**
 * Arguments passed to state change events.
 */
export interface CircuitStateChangeEventArgs {
  /** Previous state */
  readonly fromState: CircuitState;
  /** New state */
  readonly toState: CircuitState;
  /** Correlation ID */
  readonly correlationId: string;
}

/**
 * Predicate to determine if an error should count as a failure.
 */
export type FailurePredicate = (error: Error) => boolean;

/**
 * Predicate to determine if a result should count as a failure.
 */
export type ResultFailurePredicate<T> = (result: T) => boolean;

/**
 * Options for configuring a CircuitBreakerPolicy.
 */
export interface CircuitBreakerPolicyOptions<T = unknown> extends PolicyOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5 */
  failureThreshold?: number;

  /** Duration the circuit stays open before transitioning to half-open, in milliseconds. Default: 30000 */
  breakDuration?: number;

  /** Number of successful requests in half-open state before closing circuit. Default: 1 */
  successThreshold?: number;

  /** Predicate to determine if an error counts as a failure. Default: all errors */
  shouldHandle?: FailurePredicate;

  /** Predicate to determine if a result counts as a failure. Default: no results */
  shouldHandleResult?: ResultFailurePredicate<T>;

  /**
   * Custom state store for distributed circuit breakers.
   * If not provided, an in-memory store is used.
   */
  stateStore?: CircuitBreakerStateStore;
}

/**
 * Circuit breaker policy - prevents cascading failures by failing fast.
 */
export class CircuitBreakerPolicy<TResult = unknown> implements IPolicy<TResult> {
  readonly name: string;

  private readonly breakDuration: number;
  private readonly shouldHandle: FailurePredicate;
  private readonly shouldHandleResult: ResultFailurePredicate<TResult>;
  private readonly store: CircuitBreakerStateStore;

  private readonly successEmitter = new PolicyEventEmitter<SuccessEventArgs>();
  private readonly failureEmitter = new PolicyEventEmitter<FailureEventArgs>();
  private readonly stateChangeEmitter = new PolicyEventEmitter<CircuitStateChangeEventArgs>();

  readonly onSuccess: PolicyEvent<SuccessEventArgs> = this.successEmitter.subscribe;
  readonly onFailure: PolicyEvent<FailureEventArgs> = this.failureEmitter.subscribe;
  readonly onStateChange: PolicyEvent<CircuitStateChangeEventArgs> =
    this.stateChangeEmitter.subscribe;

  constructor(options: CircuitBreakerPolicyOptions<TResult> = {}) {
    this.name = options.name ?? 'CircuitBreakerPolicy';
    this.breakDuration = options.breakDuration ?? 30000;
    this.shouldHandle = options.shouldHandle ?? ((): boolean => true);
    this.shouldHandleResult = options.shouldHandleResult ?? ((): boolean => false);

    this.store =
      options.stateStore ??
      new MemoryStateStore(
        options.failureThreshold ?? 5,
        this.breakDuration,
        options.successThreshold ?? 1,
      );
  }

  /**
   * Current circuit state.
   */
  async getState(): Promise<CircuitState> {
    return this.store.getState();
  }

  /**
   * Manually isolate the circuit (force open).
   */
  async isolate(): Promise<void> {
    await this.transitionTo('isolated', crypto.randomUUID());
  }

  /**
   * Reset the circuit to closed state.
   */
  async reset(): Promise<void> {
    await this.transitionTo('closed', crypto.randomUUID());
  }

  async execute<T extends TResult>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    const startTime = Date.now();
    const correlationId = crypto.randomUUID();

    // Check current state
    const currentState = await this.getState();

    // Reject immediately if circuit is open or isolated
    if (currentState === 'open' || currentState === 'isolated') {
      const openedAt = (await this.store.getOpenedAt()) ?? Date.now();
      const retryAfter = openedAt + this.breakDuration;

      this.failureEmitter.emit({
        error: new CircuitOpenError(this.name, retryAfter),
        duration: 0,
        attempts: 0,
        correlationId,
      });

      throw new CircuitOpenError(this.name, retryAfter);
    }

    // Check external abort signal
    if (signal?.aborted) {
      throw signal.reason as Error;
    }

    const context = createExecutionContext({
      signal: signal ?? new AbortController().signal,
      correlationId,
      attemptNumber: 1,
      startTime,
    });

    try {
      const result = await fn(context);

      // Check if result should count as failure
      if (this.shouldHandleResult(result)) {
        await this.handleFailure(correlationId, startTime, new Error('Result predicate matched'));
        return result;
      }

      await this.handleSuccess(correlationId, startTime);
      return result;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));

      // Only count as failure if predicate matches
      if (this.shouldHandle(errorObj)) {
        await this.handleFailure(correlationId, startTime, errorObj);
      }

      throw error;
    }
  }

  private async handleSuccess(correlationId: string, startTime: number): Promise<void> {
    const duration = Date.now() - startTime;

    const changed = await this.store.recordSuccess(correlationId);

    if (changed) {
      // Ideally store should return info about transition, or we query it.
      // For now assuming transition to closed if it changed from halfOpen.
      // MemoryStore transitions to closed.
      this.stateChangeEmitter.emit({
        fromState: 'halfOpen', // Only changes on success if halfOpen -> closed
        toState: 'closed',
        correlationId,
      });
    }

    this.successEmitter.emit({
      duration,
      attemptNumber: 1,
      correlationId,
    });
  }

  private async handleFailure(
    correlationId: string,
    startTime: number,
    error: Error,
  ): Promise<void> {
    const duration = Date.now() - startTime;
    const previousState = await this.store.getState();
    const changed = await this.store.recordFailure(correlationId);

    if (changed) {
      // Did we open?
      const newState = await this.store.getState();
      this.stateChangeEmitter.emit({
        fromState: previousState,
        toState: newState,
        correlationId,
      });
    }

    this.failureEmitter.emit({
      error,
      duration,
      attempts: 1,
      correlationId,
    });
  }

  private async transitionTo(newState: CircuitState, correlationId: string): Promise<void> {
    const previousState = await this.store.getState();
    if (previousState !== newState) {
      await this.store.setState(newState, correlationId);
      this.stateChangeEmitter.emit({
        fromState: previousState,
        toState: newState,
        correlationId,
      });
    }
  }
}

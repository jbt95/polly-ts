import { randomUUID } from 'crypto';
import type {
  IPolicy,
  PolicyOptions,
  ExecutionContext,
  SuccessEventArgs,
  FailureEventArgs,
} from 'polly-ts-core';
import { PolicyEventEmitter, createExecutionContext } from 'polly-ts-core';

export interface ChaosPolicyOptions extends PolicyOptions {
  /**
   * Probability of injecting a fault (0.0 to 1.0).
   * Default: 0.1 (10%)
   */
  injectionRate?: number; // 0-1

  /**
   * Error to throw when fault is injected.
   * Default: Error("Chaos injected")
   */
  fault?: Error;

  /**
   * Latency to inject in milliseconds.
   * Default: undefined (no latency)
   */
  latencyMs?: number;
}

/**
 * A policy that introduces chaos into the execution of a function.
 * This can be used for testing the resilience of applications by injecting faults or latency.
 */
export class ChaosPolicy implements IPolicy {
  /**
   * The name of the policy.
   */
  readonly name: string;

  private readonly injectionRate: number;
  private readonly fault: Error;
  private readonly latencyMs: number | undefined;

  private readonly successEmitter = new PolicyEventEmitter<SuccessEventArgs>();
  private readonly failureEmitter = new PolicyEventEmitter<FailureEventArgs>();

  /**
   * Event triggered on successful execution of the function.
   */
  readonly onSuccess = this.successEmitter.subscribe;

  /**
   * Event triggered on failed execution of the function.
   */
  readonly onFailure = this.failureEmitter.subscribe;

  /**
   * Creates a new ChaosPolicy instance.
   *
   * @param options Configuration options for the chaos policy.
   * @param options.injectionRate Probability of injecting a fault (0.0 to 1.0). Default: 0.1 (10%).
   * @param options.fault The error to throw when a fault is injected. Default: `Error('Chaos injected')`.
   * @param options.latencyMs The latency to inject in milliseconds. Default: `undefined` (no latency).
   */
  constructor(options: ChaosPolicyOptions = {}) {
    this.name = options.name ?? 'ChaosPolicy';
    this.injectionRate = options.injectionRate ?? 0.1;
    this.fault = options.fault ?? new Error('Chaos injected');
    this.latencyMs = options.latencyMs;
  }

  /**
   * Executes the provided function, potentially injecting chaos (faults or latency).
   *
   * @param fn The function to execute, which represents the operation to protect.
   * @param signal An optional AbortSignal to cancel the operation.
   * @returns The result of the function execution.
   * @throws The injected fault or any error thrown by the provided function.
   */
  async execute<T>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    // Simulating chaos logic
    if (Math.random() < this.injectionRate) {
      if (this.latencyMs) {
        await new Promise((r) => setTimeout(r, this.latencyMs));
      }

      const error = this.fault;
      this.failureEmitter.emit({
        error,
        duration: 0,
        attempts: 1,
        correlationId: 'chaos',
      });
      throw error;
    }

    const context = createExecutionContext({
      signal: signal ?? new AbortController().signal,
      correlationId: randomUUID(),
      startTime: Date.now(),
      attemptNumber: 1,
    });

    try {
      const result = await fn(context);
      this.successEmitter.emit({
        duration: Date.now() - context.startTime,
        attemptNumber: 1,
        correlationId: context.correlationId,
      });
      return result;
    } catch (e) {
      this.failureEmitter.emit({
        error: e as Error,
        duration: Date.now() - context.startTime,
        attempts: 1,
        correlationId: context.correlationId,
      });
      throw e;
    }
  }
}

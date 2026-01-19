import { randomUUID } from 'crypto';
import type { IPolicy, PolicyOptions } from '../../types/policy';
import type { ExecutionContext } from '../../types/context';
import type { SuccessEventArgs, FailureEventArgs, PolicyEvent } from '../../types/events';
import { PolicyEventEmitter } from '../../types/events';
import { createExecutionContext } from '../../types/context';
import { BulkheadRejectedError } from '../../errors/bulkhead-rejected-error';

/**
 * Event arguments emitted when a request is rejected due to capacity limits.
 */
export interface BulkheadRejectEventArgs {
  /** Number of currently executing operations. */
  readonly activeCount: number;

  /** Number of requests currently waiting in the queue. */
  readonly queueDepth: number;

  /** Maximum concurrent executions allowed by this bulkhead. */
  readonly maxConcurrent: number;

  /** Maximum queue depth allowed by this bulkhead. */
  readonly maxQueue: number;

  /** Unique identifier for the rejected request. */
  readonly correlationId: string;
}

/**
 * Configuration options for the BulkheadPolicy.
 *
 * @example
 * ```typescript
 * // Limit to 5 concurrent executions, no queueing
 * const options: BulkheadPolicyOptions = {
 *   maxConcurrent: 5,
 *   maxQueue: 0, // Reject immediately when full
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Allow queueing with timeout
 * const options: BulkheadPolicyOptions = {
 *   maxConcurrent: 10,
 *   maxQueue: 100,      // Queue up to 100 requests
 *   queueTimeout: 5000, // Reject after 5s in queue
 * };
 * ```
 */
export interface BulkheadPolicyOptions extends PolicyOptions {
  /**
   * Maximum number of operations that can execute concurrently.
   *
   * When this limit is reached, new requests are either queued (if `maxQueue > 0`)
   * or rejected immediately with {@link BulkheadRejectedError}.
   *
   * @default 10
   */
  maxConcurrent?: number;

  /**
   * Maximum number of requests to queue when at execution capacity.
   *
   * Set to `0` for "fail fast" behavior (reject immediately when full).
   * Set to a positive number to allow queueing during traffic spikes.
   *
   * @default 0 (no queueing, reject immediately)
   */
  maxQueue?: number;

  /**
   * Maximum time a request can wait in the queue before being rejected.
   *
   * Only applicable when `maxQueue > 0`. Requests that exceed this timeout
   * are rejected with {@link BulkheadRejectedError}.
   *
   * @default 30000 (30 seconds)
   */
  queueTimeout?: number;
}

/** Internal type for queued requests. */
interface QueuedRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * A resilience policy that limits concurrent executions to prevent resource exhaustion.
 *
 * The Bulkhead pattern isolates elements of an application into pools so that if one
 * fails, the others continue to function. This policy limits the number of concurrent
 * operations, protecting shared resources from being overwhelmed.
 *
 * **Behavior:**
 * 1. If execution slots are available, execute immediately
 * 2. If no slots but queue space available, wait in queue (with timeout)
 * 3. If no slots and no queue space, reject with {@link BulkheadRejectedError}
 *
 * **Use Cases:**
 * - Limiting concurrent database connections
 * - Protecting external API from too many parallel calls
 * - Resource pool management
 * - Preventing thread pool exhaustion
 *
 * @typeParam TResult - The expected return type of operations (used for type inference).
 *
 * @example
 * ```typescript
 * // Limit to 5 concurrent API calls, reject extras immediately
 * const policy = new BulkheadPolicy({
 *   maxConcurrent: 5,
 *   maxQueue: 0,
 * });
 *
 * try {
 *   await policy.execute(() => callExternalApi());
 * } catch (error) {
 *   if (error instanceof BulkheadRejectedError) {
 *     console.log('System at capacity, try again later');
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Allow queueing during traffic spikes
 * const policy = new BulkheadPolicy({
 *   maxConcurrent: 10,
 *   maxQueue: 50,
 *   queueTimeout: 5000, // 5 second queue timeout
 * });
 *
 * // Monitor capacity
 * console.log(`Available slots: ${policy.executionSlots}`);
 * console.log(`Queue capacity: ${policy.queueSlots}`);
 * ```
 */
export class BulkheadPolicy<TResult = unknown> implements IPolicy<TResult> {
  /** The name of this policy instance, used for logging and debugging. */
  readonly name: string;

  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private readonly queueTimeout: number;

  /** Number of currently executing operations. */
  private activeCount = 0;

  /** Queue of waiting requests. */
  private readonly queue: QueuedRequest[] = [];

  private readonly successEmitter = new PolicyEventEmitter<SuccessEventArgs>();
  private readonly failureEmitter = new PolicyEventEmitter<FailureEventArgs>();
  private readonly rejectEmitter = new PolicyEventEmitter<BulkheadRejectEventArgs>();

  /**
   * Event emitted when an operation completes successfully.
   */
  readonly onSuccess: PolicyEvent<SuccessEventArgs> = this.successEmitter.subscribe;

  /**
   * Event emitted when an operation fails or is rejected.
   */
  readonly onFailure: PolicyEvent<FailureEventArgs> = this.failureEmitter.subscribe;

  /**
   * Event emitted when a request is rejected due to capacity limits.
   * Useful for monitoring and alerting on capacity issues.
   */
  readonly onReject: PolicyEvent<BulkheadRejectEventArgs> = this.rejectEmitter.subscribe;

  /**
   * Creates a new BulkheadPolicy.
   *
   * @param options - Configuration options for concurrency limits.
   */
  constructor(options: BulkheadPolicyOptions = {}) {
    this.name = options.name ?? 'BulkheadPolicy';
    this.maxConcurrent = options.maxConcurrent ?? 10;
    this.maxQueue = options.maxQueue ?? 0;
    this.queueTimeout = options.queueTimeout ?? 30000;
  }

  /**
   * Number of available execution slots.
   *
   * This is the difference between `maxConcurrent` and currently active operations.
   * When this reaches 0, new requests will be queued (if `maxQueue > 0`) or rejected.
   *
   * Useful for monitoring bulkhead utilization and implementing adaptive behavior.
   *
   * @example
   * ```typescript
   * if (policy.executionSlots === 0) {
   *   console.warn('Bulkhead at capacity');
   * }
   * ```
   */
  get executionSlots(): number {
    return this.maxConcurrent - this.activeCount;
  }

  /**
   * Number of available queue slots.
   *
   * This is the difference between `maxQueue` and currently queued requests.
   * When both `executionSlots` and `queueSlots` are 0, requests will be rejected.
   *
   * @example
   * ```typescript
   * if (policy.queueSlots === 0 && policy.executionSlots === 0) {
   *   console.error('Bulkhead completely saturated');
   * }
   * ```
   */
  get queueSlots(): number {
    return this.maxQueue - this.queue.length;
  }

  /**
   * Executes an operation with bulkhead protection.
   *
   * @typeParam T - The return type of the operation.
   * @param fn - The operation to execute.
   * @param signal - Optional AbortSignal to cancel queued requests.
   * @returns The result of the operation.
   * @throws {@link BulkheadRejectedError} if no execution slots or queue slots available,
   *         or if the queue timeout expires.
   */
  async execute<T extends TResult>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    const startTime = Date.now();
    const correlationId = randomUUID();

    if (signal?.aborted) {
      throw signal.reason as Error;
    }

    // Try to acquire execution slot
    if (this.activeCount < this.maxConcurrent) {
      return this.executeWithSlot(fn, signal, startTime, correlationId);
    }

    // Try to queue
    if (this.queue.length < this.maxQueue) {
      await this.waitForSlot(correlationId, signal);
      return this.executeWithSlot(fn, signal, startTime, correlationId);
    }

    // Reject
    this.rejectEmitter.emit({
      activeCount: this.activeCount,
      queueDepth: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueue: this.maxQueue,
      correlationId,
    });

    this.failureEmitter.emit({
      error: new BulkheadRejectedError(this.name, this.maxConcurrent, this.maxQueue),
      duration: 0,
      attempts: 0,
      correlationId,
    });

    throw new BulkheadRejectedError(this.name, this.maxConcurrent, this.maxQueue);
  }

  private async waitForSlot(correlationId: string, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const index = this.queue.findIndex((r) => r.resolve === resolve);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        reject(new BulkheadRejectedError(this.name, this.maxConcurrent, this.maxQueue));
      }, this.queueTimeout);

      const request: QueuedRequest = { resolve, reject, timeoutId };
      this.queue.push(request);

      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          const index = this.queue.indexOf(request);
          if (index !== -1) {
            this.queue.splice(index, 1);
          }
          reject(signal.reason as Error);
        });
      }
    });
  }

  private async executeWithSlot<T extends TResult>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    signal: AbortSignal | undefined,
    startTime: number,
    correlationId: string,
  ): Promise<T> {
    this.activeCount++;

    const context = createExecutionContext({
      signal: signal ?? new AbortController().signal,
      correlationId,
      attemptNumber: 1,
      startTime,
    });

    try {
      const result = await fn(context);

      const duration = Date.now() - startTime;
      this.successEmitter.emit({
        duration,
        attemptNumber: 1,
        correlationId,
      });

      return result;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      const duration = Date.now() - startTime;

      this.failureEmitter.emit({
        error: errorObj,
        duration,
        attempts: 1,
        correlationId,
      });

      throw error;
    } finally {
      this.activeCount--;
      this.releaseNextInQueue();
    }
  }

  private releaseNextInQueue(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        clearTimeout(next.timeoutId);
        next.resolve();
      }
    }
  }
}

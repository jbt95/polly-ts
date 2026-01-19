import { randomUUID } from 'crypto';
import type { IPolicy, PolicyOptions } from '../../types/policy';
import type { ExecutionContext } from '../../types/context';
import type { SuccessEventArgs, FailureEventArgs, PolicyEvent } from '../../types/events';
import { PolicyEventEmitter } from '../../types/events';
import { createExecutionContext } from '../../types/context';
import { BulkheadRejectedError } from '../../errors/bulkhead-rejected-error';

/**
 * Arguments passed to the onReject event.
 */
export interface BulkheadRejectEventArgs {
  /** Current number of active executions */
  readonly activeCount: number;
  /** Current queue depth */
  readonly queueDepth: number;
  /** Maximum concurrent allowed */
  readonly maxConcurrent: number;
  /** Maximum queue depth allowed */
  readonly maxQueue: number;
  /** Correlation ID */
  readonly correlationId: string;
}

/**
 * Options for configuring a BulkheadPolicy.
 */
export interface BulkheadPolicyOptions extends PolicyOptions {
  /** Maximum number of concurrent executions. Default: 10 */
  maxConcurrent?: number;

  /** Maximum number of requests to queue when at capacity. Default: 0 (reject immediately) */
  maxQueue?: number;

  /** Maximum time to wait in queue before rejecting, in milliseconds. Default: 30000 */
  queueTimeout?: number;
}

interface QueuedRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Bulkhead policy - limits concurrent executions to prevent resource exhaustion.
 */
export class BulkheadPolicy<TResult = unknown> implements IPolicy<TResult> {
  readonly name: string;

  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private readonly queueTimeout: number;

  private activeCount = 0;
  private readonly queue: QueuedRequest[] = [];

  private readonly successEmitter = new PolicyEventEmitter<SuccessEventArgs>();
  private readonly failureEmitter = new PolicyEventEmitter<FailureEventArgs>();
  private readonly rejectEmitter = new PolicyEventEmitter<BulkheadRejectEventArgs>();

  readonly onSuccess: PolicyEvent<SuccessEventArgs> = this.successEmitter.subscribe;
  readonly onFailure: PolicyEvent<FailureEventArgs> = this.failureEmitter.subscribe;
  readonly onReject: PolicyEvent<BulkheadRejectEventArgs> = this.rejectEmitter.subscribe;

  constructor(options: BulkheadPolicyOptions = {}) {
    this.name = options.name ?? 'BulkheadPolicy';
    this.maxConcurrent = options.maxConcurrent ?? 10;
    this.maxQueue = options.maxQueue ?? 0;
    this.queueTimeout = options.queueTimeout ?? 30000;
  }

  /**
   * Current number of active executions.
   */
  get executionSlots(): number {
    return this.maxConcurrent - this.activeCount;
  }

  /**
   * Current number of requests in queue.
   */
  get queueSlots(): number {
    return this.maxQueue - this.queue.length;
  }

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

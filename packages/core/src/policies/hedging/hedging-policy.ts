import { randomUUID } from 'crypto';
import type { IPolicy, PolicyOptions, ExecutionContext } from '../../types';
import {
  PolicyEventEmitter,
  type SuccessEventArgs,
  type FailureEventArgs,
} from '../../types/events';
import { createExecutionContext } from '../../types/context';

/**
 * Configuration options for the HedgingPolicy.
 *
 * @example
 * ```typescript
 * const policy = new HedgingPolicy({
 *   name: 'MyHedgingPolicy',
 *   delayMs: 100,  // Wait 100ms before launching hedge
 *   maxHedges: 2,  // Launch up to 2 additional attempts
 * });
 * ```
 */
export interface HedgingPolicyOptions extends PolicyOptions {
  /**
   * Delay in milliseconds before triggering each hedged attempt.
   *
   * - If `0`, all hedged attempts are launched immediately in parallel with the primary.
   * - If greater than `0`, hedged attempts are staggered: the first hedge launches after
   *   `delayMs`, the second after `2 * delayMs`, etc.
   *
   * @default 0
   */
  delayMs?: number;

  /**
   * Maximum number of hedged (additional) attempts to spawn beyond the primary attempt.
   *
   * Total concurrent attempts will be `1 + maxHedges`. For example, if `maxHedges` is 2,
   * up to 3 attempts may run concurrently (1 primary + 2 hedges).
   *
   * @default 1
   */
  maxHedges?: number;
}

/**
 * Event arguments emitted when a hedged attempt is launched.
 */
export interface HedgeEventArgs {
  /**
   * The attempt number of the hedged request (2 for first hedge, 3 for second, etc.).
   * The primary attempt is number 1 and does not trigger this event.
   */
  readonly attemptNumber: number;

  /**
   * Unique identifier correlating all attempts within this execution.
   */
  readonly correlationId: string;
}

/**
 * A resilience policy that reduces tail latency by launching parallel "hedged" requests.
 *
 * Hedging is a latency-reduction technique where additional requests are sent if the
 * primary request hasn't completed within a specified time. The first successful
 * response wins, and all other in-flight requests are cancelled.
 *
 * **Use Cases:**
 * - Reducing P99 latency for read operations
 * - Fan-out requests to multiple replicas
 * - Speculative execution for idempotent operations
 *
 * **Important:** Only use hedging for idempotent operations, as the same request
 * may be executed multiple times concurrently.
 *
 * @example
 * ```typescript
 * // Launch a hedge after 100ms if primary hasn't completed
 * const policy = new HedgingPolicy({
 *   delayMs: 100,
 *   maxHedges: 1,
 * });
 *
 * const result = await policy.execute(async (ctx) => {
 *   return await fetchFromReplica(ctx.signal);
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Immediate parallel execution (fan-out)
 * const policy = new HedgingPolicy({
 *   delayMs: 0,    // Launch all immediately
 *   maxHedges: 2,  // 3 total parallel requests
 * });
 *
 * policy.onHedge((args) => {
 *   console.log(`Hedge attempt ${args.attemptNumber} launched`);
 * });
 * ```
 */
export class HedgingPolicy implements IPolicy {
  /** The name of this policy instance, used for logging and debugging. */
  readonly name: string;

  private readonly delayMs: number;
  private readonly maxHedges: number;

  private readonly successEmitter = new PolicyEventEmitter<SuccessEventArgs>();
  private readonly failureEmitter = new PolicyEventEmitter<FailureEventArgs>();
  private readonly hedgeEmitter = new PolicyEventEmitter<HedgeEventArgs>();

  /**
   * Event emitted when any attempt completes successfully.
   * Only fires once per execution (for the winning attempt).
   */
  readonly onSuccess = this.successEmitter.subscribe;

  /**
   * Event emitted when all attempts (primary + hedges) have failed.
   * Contains the error from the last failing attempt.
   */
  readonly onFailure = this.failureEmitter.subscribe;

  /**
   * Event emitted when a hedged attempt is launched.
   * Does not fire for the primary attempt (attempt 1).
   */
  readonly onHedge = this.hedgeEmitter.subscribe;

  /**
   * Creates a new HedgingPolicy instance.
   *
   * @param options - Configuration options for the hedging behavior.
   */
  constructor(options: HedgingPolicyOptions = {}) {
    this.name = options.name ?? 'HedgingPolicy';
    this.delayMs = options.delayMs ?? 0;
    this.maxHedges = options.maxHedges ?? 1;
  }

  /**
   * Executes an operation with hedging support.
   *
   * Launches the primary attempt immediately, then spawns hedged attempts according
   * to the configured delay and maxHedges settings. Returns the result of the first
   * successful attempt and cancels all remaining in-flight requests.
   *
   * @typeParam T - The return type of the operation.
   * @param fn - The operation to execute. Receives an ExecutionContext with an AbortSignal
   *             that will be triggered if another attempt wins or the policy is cancelled.
   * @param signal - Optional AbortSignal to cancel all attempts externally.
   * @returns The result from the first successful attempt.
   * @throws The error from the last attempt if all attempts fail.
   *
   * @example
   * ```typescript
   * const result = await policy.execute(async (ctx) => {
   *   // Check signal for cancellation
   *   if (ctx.signal.aborted) throw new Error('Cancelled');
   *
   *   const response = await fetch(url, { signal: ctx.signal });
   *   return response.json();
   * });
   * ```
   */
  async execute<T>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    const correlationId = randomUUID();
    const startTime = Date.now();
    const abortController = new AbortController();

    if (signal) {
      if (signal.aborted) throw signal.reason;
      signal.addEventListener('abort', () => { abortController.abort(signal.reason); });
    }

    const attempts: Promise<T>[] = [];
    const controllers: AbortController[] = [];

    const launchAttempt = (attemptNum: number): Promise<T> => {
      const ctrl = new AbortController();
      controllers.push(ctrl);

      const onAbort = (): void => {
        ctrl.abort(signal?.reason);
      };
      if (signal) signal.addEventListener('abort', onAbort);

      const ctx = createExecutionContext({
        signal: ctrl.signal,
        correlationId,
        startTime,
        attemptNumber: attemptNum,
      });

      if (attemptNum > 1) {
        this.hedgeEmitter.emit({ attemptNumber: attemptNum, correlationId });
      }

      return Promise.resolve(fn(ctx))
        .then((res) => {
          if (signal) signal.removeEventListener('abort', onAbort);
          return res;
        })
        .catch((err: unknown) => {
          if (signal) signal.removeEventListener('abort', onAbort);
          throw err;
        });
    };

    attempts.push(launchAttempt(1));

    return new Promise<T>((resolve, reject) => {
      let failures = 0;
      let completed = false;
      const totalAttempts = 1 + this.maxHedges;

      const onResult = (res: T): void => {
        if (!completed) {
          completed = true;
          // Cancel others
          controllers.forEach((c) => {
            c.abort();
          });

          this.successEmitter.emit({
            duration: Date.now() - startTime,
            attemptNumber: 0,
            correlationId,
          });
          resolve(res);
        }
      };

      const onError = (err: unknown): void => {
        failures++;
        if (failures >= totalAttempts && !completed) {
          completed = true;
          const error = err instanceof Error ? err : new Error(String(err));
          this.failureEmitter.emit({
            error,
            duration: Date.now() - startTime,
            attempts: failures,
            correlationId,
          });
          reject(error);
        }
      };

      const track = (p: Promise<T>): void => {
        p.then(onResult).catch(onError);
      };

      const firstAttempt = attempts[0];
      if (firstAttempt) {
        track(firstAttempt);
      }

      if (this.maxHedges > 0) {
        for (let i = 0; i < this.maxHedges; i++) {
          const hedgeNum = i + 2;
          const time = this.delayMs * (hedgeNum - 1);

          if (time === 0) {
            track(launchAttempt(hedgeNum));
          } else {
            setTimeout(() => {
              if (!completed) {
                track(launchAttempt(hedgeNum));
              }
            }, time);
          }
        }
      }
    });
  }
}

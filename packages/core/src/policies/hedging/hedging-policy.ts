import type { IPolicy, PolicyOptions, ExecutionContext } from '../../types';
import {
  PolicyEventEmitter,
  type SuccessEventArgs,
  type FailureEventArgs,
} from '../../types/events';
import { createExecutionContext } from '../../types/context';

export interface HedgingPolicyOptions extends PolicyOptions {
  /**
   * Delay before triggering a hedged attempt in milliseconds.
   * If 0, runs in parallel immediately.
   * Default: 0
   */
  delayMs?: number;

  /**
   * Maximum number of hedged attempts to spawn (in addition to primary).
   * Default: 1
   */
  maxHedges?: number;
}

export interface HedgeEventArgs {
  attemptNumber: number;
  correlationId: string;
}

export class HedgingPolicy implements IPolicy {
  readonly name: string;
  private readonly delayMs: number;
  private readonly maxHedges: number;

  private readonly successEmitter = new PolicyEventEmitter<SuccessEventArgs>();
  private readonly failureEmitter = new PolicyEventEmitter<FailureEventArgs>();
  private readonly hedgeEmitter = new PolicyEventEmitter<HedgeEventArgs>();

  readonly onSuccess = this.successEmitter.subscribe;
  readonly onFailure = this.failureEmitter.subscribe;
  readonly onHedge = this.hedgeEmitter.subscribe;

  constructor(options: HedgingPolicyOptions = {}) {
    this.name = options.name ?? 'HedgingPolicy';
    this.delayMs = options.delayMs ?? 0;
    this.maxHedges = options.maxHedges ?? 1;
  }

  async execute<T>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    const correlationId = crypto.randomUUID();
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

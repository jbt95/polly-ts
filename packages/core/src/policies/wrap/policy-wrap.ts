import type { IPolicy } from '../../types/policy';
import type { ExecutionContext } from '../../types/context';
import type { SuccessEventArgs, FailureEventArgs, PolicyEvent } from '../../types/events';
import { PolicyEventEmitter } from '../../types/events';

/**
 * A policy that wraps another policy.
 * The outer policy is executed first, and it delegates to the inner policy.
 */
export class PolicyWrap<TResult = unknown> implements IPolicy<TResult> {
  readonly name: string;

  private readonly outerPolicy: IPolicy<TResult>;
  private readonly innerPolicy: IPolicy<TResult>;

  private readonly successEmitter = new PolicyEventEmitter<SuccessEventArgs>();
  private readonly failureEmitter = new PolicyEventEmitter<FailureEventArgs>();

  readonly onSuccess: PolicyEvent<SuccessEventArgs> = this.successEmitter.subscribe;
  readonly onFailure: PolicyEvent<FailureEventArgs> = this.failureEmitter.subscribe;

  constructor(outerPolicy: IPolicy<TResult>, innerPolicy: IPolicy<TResult>) {
    this.name = `${outerPolicy.name}/${innerPolicy.name}`;
    this.outerPolicy = outerPolicy;
    this.innerPolicy = innerPolicy;
  }

  async execute<T extends TResult>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.outerPolicy.execute((outerContext) => {
      return this.innerPolicy.execute(fn, outerContext.signal);
    }, signal);
  }
}

/**
 * Creates a policy that executes the given policies in order.
 * The first policy in the list is the "outermost" policy.
 *
 * Example: `pipeline(retry, circuitBreaker, timeout)`
 * Executes: `retry(circuitBreaker(timeout(fn)))`
 *
 * @param policies The policies to wrap.
 * @returns A policy that wraps all the given policies.
 */
export function pipeline<TResult = unknown>(...policies: IPolicy<TResult>[]): IPolicy<TResult> {
  if (policies.length === 0) {
    throw new Error('At least one policy must be provided');
  }

  if (policies.length === 1) {
    const single = policies[0];
    if (!single) {
      throw new Error('At least one policy must be provided');
    }
    return single;
  }

  const first = policies[0];
  if (!first) {
    throw new Error('At least one policy must be provided');
  }
  let wrapped: IPolicy<TResult> = first;

  for (let i = 1; i < policies.length; i++) {
    const next = policies[i];
    if (next) {
      wrapped = new PolicyWrap(wrapped, next);
    }
  }
  return wrapped;
}

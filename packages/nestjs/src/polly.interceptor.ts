import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
  Inject,
  Logger,
} from '@nestjs/common';
import { type Observable, from, lastValueFrom } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { POLLY_POLICY_KEY } from './use-policy.decorator';
import { type IPolicy } from 'polly-ts-core';

@Injectable()
export class PollyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PollyInterceptor.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject('POLLY_POLICIES') private readonly policies: Map<string, IPolicy>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const policyName = this.reflector.getAllAndOverride<string>(POLLY_POLICY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!policyName) {
      return next.handle();
    }

    const policy = this.policies.get(policyName);
    if (!policy) {
      this.logger.warn(`Policy '${policyName}' not found.`);
      return next.handle();
    }

    return from(this.executeWithPolicy(policy, next));
  }

  private async executeWithPolicy(policy: IPolicy, next: CallHandler): Promise<unknown> {
    return policy.execute(async (_ctx) => {
      // Need to handle signal propagation if possible?
      // NestJS doesn't expose request signal cleanly in generic ExecutionContext logic unless strict HTTP.
      // But we can check type.

      // For now, just wrap the observable execution
      return (await lastValueFrom(next.handle())) as unknown;
    });
  }
}

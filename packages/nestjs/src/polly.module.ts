/**
 * A module for integrating Polly-TS resilience policies into a NestJS application.
 * This module allows you to register and use Polly policies within your NestJS services and controllers.
 */
import { Module, type DynamicModule, type Provider, Global } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { type IPolicy } from 'polly-ts-core';
import { PollyInterceptor } from './polly.interceptor';

export interface PollyModuleOptions {
  policies: { name: string; useValue: IPolicy }[];
}

@Global()
@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module pattern requires class
export class PollyModule {
  /**
   * Registers Polly policies globally in the application.
   *
   * @param options An object where the keys are policy names and the values are policy instances.
   * @returns A dynamic module that provides the PollyInterceptor with the registered policies.
   */
  static register(options: PollyModuleOptions): DynamicModule {
    const policyMap = new Map<string, IPolicy>();
    options.policies.forEach((p) => policyMap.set(p.name, p.useValue));

    const policiesProvider: Provider = {
      provide: 'POLLY_POLICIES',
      useValue: policyMap,
    };

    return {
      module: PollyModule,
      providers: [
        policiesProvider,
        {
          provide: APP_INTERCEPTOR,
          useClass: PollyInterceptor,
        },
      ],
      exports: [policiesProvider],
    };
  }
}

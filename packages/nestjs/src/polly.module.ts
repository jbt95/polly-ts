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

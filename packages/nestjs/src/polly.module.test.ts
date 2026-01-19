/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/explicit-function-return-type, @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Controller, Get, Injectable, Inject } from '@nestjs/common';
import { PollyModule } from './polly.module';
import { UsePolicy } from './use-policy.decorator';
import { RetryPolicy, CircuitBreakerPolicy } from '@polly-ts/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

describe('PollyModule', () => {
  const retryPolicy = new RetryPolicy({ maxAttempts: 3, delayFn: () => Promise.resolve() });
  const cbPolicy = new CircuitBreakerPolicy({ failureThreshold: 1 });

  @Injectable()
  class TestService {
    async riskyOperation() {
      throw new Error('boom');
    }
  }

  @Controller('test')
  class TestController {
    constructor(@Inject(TestService) private readonly service: TestService) {}

    @Get('retry')
    @UsePolicy('retry')
    async retry() {
      return this.service.riskyOperation();
    }

    @Get('circuit')
    @UsePolicy('circuit')
    async circuit() {
      return this.service.riskyOperation();
    }
  }

  let moduleRef: TestingModule;
  let service: TestService;

  let app: any;

  const createModule = async () => {
    return Test.createTestingModule({
      imports: [
        PollyModule.register({
          policies: [
            { name: 'retry', useValue: retryPolicy },
            { name: 'circuit', useValue: cbPolicy },
          ],
        }),
      ],
      controllers: [TestController],
      providers: [TestService],
    }).compile();
  };

  beforeEach(async () => {
    moduleRef = await createModule();
    app = moduleRef.createNestApplication();
    await app.init();
    service = moduleRef.get<TestService>(TestService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('should apply retry policy to decorated method', async () => {
    vi.spyOn(service, 'riskyOperation');
    await request(app.getHttpServer()).get('/test/retry').expect(500); // Expect failure eventually
    expect(service.riskyOperation).toHaveBeenCalledTimes(4);
  });

  it('should apply circuit breaker policy', async () => {
    await request(app.getHttpServer()).get('/test/circuit').expect(500);
    expect(await cbPolicy.getState()).toBe('open');
    vi.spyOn(service, 'riskyOperation').mockClear();
    await request(app.getHttpServer()).get('/test/circuit').expect(500);
    expect(service.riskyOperation).not.toHaveBeenCalled();
  });
});

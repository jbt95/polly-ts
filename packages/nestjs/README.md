# polly-ts-nestjs

NestJS module and decorators for **Polly-TS**, integrating resilience policies into your application architecture.

## Installation

```bash
npm install polly-ts-core polly-ts-nestjs
# or
pnpm add polly-ts-core polly-ts-nestjs
```

## Setup

register the global `PollyModule` with your policies.

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { PollyModule } from 'polly-ts-nestjs';
import { RetryPolicy } from 'polly-ts-core';

@Module({
  imports: [
    PollyModule.register({
      policies: [
        {
          name: 'exponentialRetry',
          useValue: new RetryPolicy({ maxAttempts: 5 }),
        },
      ],
    }),
  ],
})
export class AppModule {}
```

## Usage

Use the `@UsePolicy` decorator to protect your Controller methods or Services (if wrapped via Interceptor manually).

```typescript
import { Controller, Get } from '@nestjs/common';
import { UsePolicy } from 'polly-ts-nestjs';

@Controller('users')
export class UserController {
  @Get()
  @UsePolicy('exponentialRetry')
  async findAll() {
    // If this throws, it will be retried automatically
    return this.userService.findAll();
  }
}
```

## Examples

### PollyModule

```typescript
@Module({
  imports: [
    PollyModule.register({
      policies: [{ name: 'retry', useValue: new RetryPolicy({ maxAttempts: 3 }) }],
    }),
  ],
})
export class AppModule {}
```

### PollyInterceptor

```typescript
providers: [{ provide: APP_INTERCEPTOR, useClass: PollyInterceptor }];
```

### UsePolicy

```typescript
@UsePolicy('retry')
async getData() {
  return this.service.fetch();
}
```

### POLLY_POLICY_KEY

```typescript
SetMetadata(POLLY_POLICY_KEY, 'retry');
```

## API Reference

| API                | Kind      | Description                                                       | Example                                                                     |
| ------------------ | --------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `PollyModule`      | Class     | NestJS module that registers policies and the global interceptor. | `PollyModule.register({ policies: [{ name: 'retry', useValue: retry }] });` |
| `PollyInterceptor` | Class     | Interceptor that runs handlers inside the selected policy.        | `providers: [{ provide: APP_INTERCEPTOR, useClass: PollyInterceptor }]`     |
| `UsePolicy`        | Decorator | Attaches a policy name to a controller or method.                 | `@UsePolicy('retry')`                                                       |
| `POLLY_POLICY_KEY` | Constant  | Metadata key used to store the policy name.                       | `SetMetadata(POLLY_POLICY_KEY, 'retry');`                                   |

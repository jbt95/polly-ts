# Polly-TS

**Polly-TS** is a comprehensive resilience and transient fault handling library for TypeScript and Node.js, inspired by the popular .NET [Polly](https://github.com/App-vNext/Polly) library. It allows developers to express resilience strategies—such as Retry, Circuit Breaker, Timeout, Bulkhead, and Fallback—in a fluent and type-safe manner.

## Why Polly-TS?

Modern distributed systems are inherently unreliable. Networks fail, services go down, and resources get exhausted. Polly-TS helps you build applications that gracefully handle these failures by providing:

- **Type-safe policies** with full TypeScript support and inference
- **Composable strategies** that can be combined to handle complex failure scenarios
- **Observable events** for monitoring and logging resilience behavior
- **Zero dependencies** in the core package
- **Framework integrations** for Express, Fastify, NestJS, and Hono

## Features

- **Retry** - Automatically retry operations that fail due to transient errors with configurable backoff strategies (constant, exponential, exponential with jitter).
- **Circuit Breaker** - Stop executing operations that are likely to fail, preventing cascade failures and allowing systems to recover.
- **Timeout** - Enforce time limits on operations with optimistic (cooperative) or pessimistic (racing) strategies.
- **Bulkhead** - Limit concurrent executions to prevent resource exhaustion and isolate failures.
- **Rate Limiter** - Control request rates using Token Bucket algorithm.
- **Cache** - Cache operation results with in-memory or custom providers, with TTL support.
- **Hedging** - Run parallel attempts to reduce tail latency for time-sensitive operations.
- **Fallback** - Define alternative behavior when operations fail, with support for static values or dynamic fallback functions.
- **Policy Wrapping** - Compose policies using `pipeline()` to create powerful resilience strategies.
- **Telemetry** - Monitor resilience events with OpenTelemetry integration for traces and metrics.
- **Distributed State** - Share Circuit Breaker state across services using Redis.
- **Testing** - Utilities for chaos engineering and deterministic testing.

## Packages

| Package                                      | Description                                      | Version                                                 |
| -------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| [`polly-ts-core`](./packages/core)           | Core policies and execution engine               | ![npm](https://img.shields.io/npm/v/polly-ts-core)      |
| [`polly-ts-http`](./packages/http)           | Wrappers for standard `fetch` API                | ![npm](https://img.shields.io/npm/v/polly-ts-http)      |
| [`polly-ts-express`](./packages/express)     | Resilience middleware for Express                | ![npm](https://img.shields.io/npm/v/polly-ts-express)   |
| [`polly-ts-fastify`](./packages/fastify)     | Plugins and hooks for Fastify                    | ![npm](https://img.shields.io/npm/v/polly-ts-fastify)   |
| [`polly-ts-nestjs`](./packages/nestjs)       | Modules, decorators, and interceptors for NestJS | ![npm](https://img.shields.io/npm/v/polly-ts-nestjs)    |
| [`polly-ts-hono`](./packages/hono)           | Middleware for Hono                              | ![npm](https://img.shields.io/npm/v/polly-ts-hono)      |
| [`polly-ts-redis`](./packages/redis)         | Distributed circuit breaker state using Redis    | ![npm](https://img.shields.io/npm/v/polly-ts-redis)     |
| [`polly-ts-telemetry`](./packages/telemetry) | OpenTelemetry integration                        | ![npm](https://img.shields.io/npm/v/polly-ts-telemetry) |
| [`polly-ts-testing`](./packages/testing)     | Testing utilities and chaos injection            | ![npm](https://img.shields.io/npm/v/polly-ts-testing)   |

## Quick Start

### Installation

```bash
pnpm add polly-ts-core
# or
npm install polly-ts-core
```

### Basic Usage

```typescript
import { RetryPolicy, CircuitBreakerPolicy, pipeline } from 'polly-ts-core';

// Define a Retry Policy with exponential backoff
const retry = new RetryPolicy({
  maxAttempts: 3,
  shouldRetryError: (err) => err.message.includes('Network'),
});

// Define a Circuit Breaker Policy
const breaker = new CircuitBreakerPolicy({
  failureThreshold: 5,
  breakDuration: 30000, // 30 seconds
});

// Combine them: Retry wraps Circuit Breaker
// If circuit is open, retry won't attempt; if closed, retries happen inside
const strategy = pipeline(breaker, retry);

// Execute with the combined strategy
const result = await strategy.execute(async () => {
  const res = await fetch('https://api.example.com/data');
  if (!res.ok) throw new Error('Network Error');
  return res.json();
});
```

### Individual Policies

#### Retry with Backoff

```typescript
import { RetryPolicy, ExponentialBackoff } from 'polly-ts-core';

const retry = new RetryPolicy({
  maxAttempts: 5,
  backoff: new ExponentialBackoff({
    initialDelay: 100,
    multiplier: 2,
    maxDelay: 5000,
  }),
});

retry.onRetry((event) => {
  console.log(`Retry attempt ${event.attemptNumber} after ${event.delay}ms`);
});
```

#### Circuit Breaker

```typescript
import { CircuitBreakerPolicy } from 'polly-ts-core';

const breaker = new CircuitBreakerPolicy({
  failureThreshold: 3, // Open after 3 failures
  breakDuration: 30000, // Stay open for 30 seconds
  successThreshold: 2, // Close after 2 successes in half-open state
});

breaker.onStateChange((event) => {
  console.log(`Circuit state changed to: ${event.state}`);
});
```

#### Timeout

```typescript
import { TimeoutPolicy } from 'polly-ts-core';

const timeout = new TimeoutPolicy({
  timeoutMs: 5000,
  strategy: 'optimistic', // Cooperative cancellation via AbortSignal
});
```

#### Bulkhead

```typescript
import { BulkheadPolicy } from 'polly-ts-core';

const bulkhead = new BulkheadPolicy({
  maxConcurrent: 10, // Max 10 concurrent executions
  maxQueue: 100, // Queue up to 100 waiting requests
});
```

#### Fallback

```typescript
import { FallbackPolicy } from 'polly-ts-core';

const fallback = new FallbackPolicy({
  fallback: (error, context) => ({ data: 'default', fromCache: true }),
  shouldHandle: (error) => error.name === 'NetworkError',
});
```

### Policy Wrapping with `pipeline`

The `pipeline` function in polly-ts allows you to compose multiple resilience policies into a single, cohesive strategy. This is particularly useful when you want to apply multiple resilience techniques (e.g., retries, circuit breakers, timeouts) in a specific order.

#### How It Works

The `pipeline` function takes a list of policies and wraps them in such a way that the first policy in the list becomes the outermost policy, and the last policy becomes the innermost. When the composed policy is executed, the outermost policy delegates to the next policy in the chain, and so on, until the innermost policy executes the actual operation.

For example, if you create a pipeline with a retry policy, a circuit breaker policy, and a timeout policy:

```typescript
const strategy = pipeline(retryPolicy, circuitBreakerPolicy, timeoutPolicy);
```

The execution flow will look like this:

1. The `retryPolicy` is the outermost policy. It will handle retries if the operation fails.
2. The `retryPolicy` delegates to the `circuitBreakerPolicy`, which will check if the circuit is open or closed.
3. The `circuitBreakerPolicy` delegates to the `timeoutPolicy`, which enforces a time limit on the operation.
4. Finally, the `timeoutPolicy` executes the actual operation.

If any policy in the chain decides to handle the operation (e.g., the circuit breaker opens, or the timeout is exceeded), the execution stops, and the result or error is returned.

#### ASCII Diagram

Here’s an ASCII diagram to illustrate the flow:

```
+-------------------+
|   Retry Policy    |
+-------------------+
         |
         v
+-------------------+
| Circuit Breaker   |
+-------------------+
         |
         v
+-------------------+
|   Timeout Policy  |
+-------------------+
         |
         v
+-------------------+
|   Actual Operation|
+-------------------+
```

#### Example

```typescript
import { RetryPolicy, CircuitBreakerPolicy, TimeoutPolicy, pipeline } from 'polly-ts-core';

const retryPolicy = new RetryPolicy({ maxAttempts: 3 });
const circuitBreakerPolicy = new CircuitBreakerPolicy({ failureThreshold: 5 });
const timeoutPolicy = new TimeoutPolicy({ timeoutMs: 5000 });

const strategy = pipeline(retryPolicy, circuitBreakerPolicy, timeoutPolicy);

const result = await strategy.execute(async () => {
  return fetch('https://api.example.com/data');
});
```

In this example, the `retryPolicy` will retry the operation up to 3 times if it fails, but only if the `circuitBreakerPolicy` allows it (i.e., the circuit is closed). The `timeoutPolicy` ensures that each attempt does not exceed 5 seconds.

## Framework Integrations

Polly-TS provides dedicated packages for popular Node.js frameworks.

### Express

```typescript
import express from 'express';
import { polly } from 'polly-ts-express';
import { CircuitBreakerPolicy } from 'polly-ts-core';

const app = express();
const breaker = new CircuitBreakerPolicy({ failureThreshold: 5 });

app.get('/api/data', polly(breaker), async (req, res) => {
  const data = await fetchExternalService();
  res.json(data);
});
```

[Read more](./packages/express/README.md)

### Fastify

```typescript
import Fastify from 'fastify';
import { polly } from 'polly-ts-fastify';
import { BulkheadPolicy } from 'polly-ts-core';

const fastify = Fastify();
const bulkhead = new BulkheadPolicy({ maxConcurrent: 10 });

fastify.addHook('onRequest', polly(bulkhead));

fastify.get('/api/data', async () => {
  return fetchExternalService();
});
```

[Read more](./packages/fastify/README.md)

### NestJS

```typescript
import { Module, Controller, Get } from '@nestjs/common';
import { UsePolicy, PollyModule } from 'polly-ts-nestjs';
import { RetryPolicy, CircuitBreakerPolicy, pipeline } from 'polly-ts-core';

// Define resilience policies
const retryPolicy = new RetryPolicy({
  maxAttempts: 3,
  backoff: { type: 'exponential', initialDelay: 100, maxDelay: 1000 },
});

const circuitBreakerPolicy = new CircuitBreakerPolicy({
  failureThreshold: 5,
  breakDuration: 30000, // 30 seconds
});

const combinedPolicy = pipeline(circuitBreakerPolicy, retryPolicy);

@Module({
  imports: [
    PollyModule.register({
      policies: {
        'resilience-strategy': combinedPolicy,
      },
    }),
  ],
  controllers: [DataController],
})
export class AppModule {}

@Controller('data')
export class DataController {
  @Get()
  @UsePolicy('resilience-strategy')
  async getData() {
    /* your code */
  }
}
```

[Read more](./packages/nestjs/README.md)

### Hono

```typescript
import { Hono } from 'hono';
import { polly } from 'polly-ts-hono';
import { TimeoutPolicy } from 'polly-ts-core';

const app = new Hono();
const timeout = new TimeoutPolicy({ timeoutMs: 5000 });

app.use('/api/*', polly(timeout));

app.get('/api/data', async (c) => {
  const data = await fetchExternalService();
  return c.json(data);
});
```

[Read more](./packages/hono/README.md)

## HTTP Client Integration

Wrap the global `fetch` with resilience policies:

```typescript
import { pollyFetch } from 'polly-ts-http';
import { RetryPolicy } from 'polly-ts-core';

const retry = new RetryPolicy({ maxAttempts: 3 });
const resilientFetch = pollyFetch(retry);

const response = await resilientFetch('https://api.example.com/data');
```

## Distributed Circuit Breaker

Share circuit breaker state across multiple service instances using Redis:

```typescript
import { CircuitBreakerPolicy } from 'polly-ts-core';
import { RedisStateStore } from 'polly-ts-redis';
import Redis from 'ioredis';

const redis = new Redis();
const stateStore = new RedisStateStore({
  client: redis,
  name: 'payment-service',
  failThreshold: 5,
  breakDuration: 30000,
  successThreshold: 2,
});

const breaker = new CircuitBreakerPolicy({
  stateStore,
  failureThreshold: 5,
});
```

## Telemetry

Monitor your resilience policies with OpenTelemetry:

```typescript
import { TelemetryPolicy } from 'polly-ts-telemetry';
import { trace, metrics } from '@opentelemetry/api';

const telemetry = new TelemetryPolicy(innerPolicy, {
  tracer: trace.getTracer('my-service'),
  meter: metrics.getMeter('my-service'),
});
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

```bash
# Clone the repo
git clone https://github.com/polly-ts/polly-ts.git
cd polly-ts

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run linter
pnpm lint
```

## License

MIT

## API Reference

Public API exported by `polly-ts-core`.

| API | Kind | Description | Example |
| --- | --- | --- | --- |
| `PolicyEventEmitter` | Class | Emits policy lifecycle events and lets subscribers listen safely. | `const emitter = new PolicyEventEmitter<{ value: number }>();` |
| `createExecutionContext` | Function | Builds an `ExecutionContext` with defaults and optional overrides. | `const ctx = createExecutionContext({ operationKey: 'fetch-user' });` |
| `PolicyError` | Error class | Base error type for policy-specific failures. | `if (err instanceof PolicyError) handle(err);` |
| `TimeoutError` | Error class | Indicates a timeout policy exceeded its configured time limit. | `if (err instanceof TimeoutError) retryLater();` |
| `CircuitOpenError` | Error class | Indicates a circuit breaker is open and rejecting executions. | `if (err instanceof CircuitOpenError) queue();` |
| `BulkheadRejectedError` | Error class | Indicates a bulkhead policy rejected execution due to limits. | `if (err instanceof BulkheadRejectedError) throttle();` |
| `RateLimitRejectedError` | Error class | Indicates a rate limiter rejected execution when no permits were available. | `if (err instanceof RateLimitRejectedError) backoff();` |
| `RetryPolicy` | Class | Retries failed operations based on error/result predicates. | `const retry = new RetryPolicy({ maxAttempts: 3 });` |
| `ConstantBackoff` | Class | Retry backoff strategy with a fixed delay between attempts. | `new ConstantBackoff({ delay: 200 });` |
| `ExponentialBackoff` | Class | Retry backoff strategy with exponential delay growth. | `new ExponentialBackoff({ initialDelay: 100 });` |
| `ExponentialBackoffWithJitter` | Class | Exponential backoff with jitter to avoid synchronized retries. | `new ExponentialBackoffWithJitter({ jitter: 'full' });` |
| `CustomBackoff` | Class | Backoff strategy powered by a user-supplied delay function. | `new CustomBackoff((attempt) => attempt * 250);` |
| `TimeoutPolicy` | Class | Enforces time limits with optimistic or pessimistic cancellation. | `const timeout = new TimeoutPolicy({ timeoutMs: 1000 });` |
| `CircuitBreakerPolicy` | Class | Fails fast after thresholds and recovers after a break duration. | `const breaker = new CircuitBreakerPolicy({ failureThreshold: 5 });` |
| `FallbackPolicy` | Class | Provides fallback values or actions when failures occur. | `new FallbackPolicy({ fallback: () => 'default' });` |
| `BulkheadPolicy` | Class | Limits concurrency and optional queueing to protect resources. | `new BulkheadPolicy({ maxConcurrent: 5, maxQueue: 10 });` |
| `CachePolicy` | Class | Caches successful results with TTL and key generation. | `new CachePolicy({ ttlMs: 60000, keyGenerator: () => 'key' });` |
| `MemoryCacheProvider` | Class | In-memory cache provider for CachePolicy. | `const provider = new MemoryCacheProvider();` |
| `HedgingPolicy` | Class | Runs parallel attempts to reduce tail latency. | `new HedgingPolicy({ delayMs: 100, maxHedges: 1 });` |
| `RateLimiterPolicy` | Class | Limits operation rate using a strategy such as token bucket. | `new RateLimiterPolicy({ strategy });` |
| `TokenBucketStrategy` | Class | Token bucket rate limiting strategy. | `new TokenBucketStrategy({ capacity: 100, refillRate: 100 });` |
| `PolicyWrap` | Class | Wraps one policy around another to compose strategies. | `const wrapped = new PolicyWrap(retry, timeout);` |
| `pipeline` | Function | Composes multiple policies into a single execution pipeline. | `const combined = pipeline(retry, timeout);` |
| `MemoryStateStore` | Class | In-memory circuit breaker state store for single-process apps. | `const store = new MemoryStateStore(5, 30000, 2);` |

## Package API Index

### polly-ts-http

| API | Kind | Description | Example |
| --- | --- | --- | --- |
| `pollyFetch` | Function | Wraps `fetch` with a Polly policy for resilient HTTP calls. | `const resilientFetch = pollyFetch(retry);` |
| `HttpError` | Error class | Error thrown when a response matches the failure predicate. | `if (err instanceof HttpError) handle(err.response);` |

### polly-ts-express

| API | Kind | Description | Example |
| --- | --- | --- | --- |
| `polly` | Function | Express middleware that executes a request inside a Polly policy. | `app.get('/path', polly(policy), handler);` |
| `POLLY_CONTEXT` | Constant | Symbol key for attaching Polly metadata to `req`. | `req[POLLY_CONTEXT] = { operation: 'get-user' };` |

### polly-ts-fastify

| API | Kind | Description | Example |
| --- | --- | --- | --- |
| `polly` | Function | Fastify hook wrapper that runs requests inside a Polly policy. | `fastify.addHook('onRequest', polly(policy));` |

### polly-ts-nestjs

| API | Kind | Description | Example |
| --- | --- | --- | --- |
| `PollyModule` | Class | NestJS module that registers policies and the global interceptor. | `PollyModule.register({ policies: [{ name: 'retry', useValue: retry }] });` |
| `PollyInterceptor` | Class | Interceptor that runs handlers inside the selected policy. | `providers: [{ provide: APP_INTERCEPTOR, useClass: PollyInterceptor }]` |
| `UsePolicy` | Decorator | Attaches a policy name to a controller or method. | `@UsePolicy('retry')` |
| `POLLY_POLICY_KEY` | Constant | Metadata key used to store the policy name. | `SetMetadata(POLLY_POLICY_KEY, 'retry');` |

### polly-ts-hono

| API | Kind | Description | Example |
| --- | --- | --- | --- |
| `polly` | Function | Hono middleware that executes requests inside a Polly policy. | `app.use('/api/*', polly(policy));` |

### polly-ts-redis

| API | Kind | Description | Example |
| --- | --- | --- | --- |
| `RedisStateStore` | Class | Redis-backed circuit breaker state store for distributed coordination. | `const store = new RedisStateStore({ client: redis, name: 'billing', failThreshold: 5, breakDuration: 30000, successThreshold: 2 });` |

### polly-ts-telemetry

| API | Kind | Description | Example |
| --- | --- | --- | --- |
| `TelemetryPolicy` | Class | Wraps another policy and records OpenTelemetry metrics and spans. | `const observed = new TelemetryPolicy(retry, { tracer: 'svc', meter: 'svc' });` |
| `VERSION` | Constant | Package version string used for telemetry instrumentation. | `console.log(VERSION);` |

### polly-ts-testing

| API | Kind | Description | Example |
| --- | --- | --- | --- |
| `ChaosPolicy` | Class | Injects faults and latency for chaos testing. | `const chaos = new ChaosPolicy({ injectionRate: 0.2 });` |

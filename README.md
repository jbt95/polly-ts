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
import { Controller, Get } from '@nestjs/common';
import { UsePolicy } from 'polly-ts-nestjs';

@Controller('data')
export class DataController {
  @Get()
  @UsePolicy('my-retry-policy')
  async getData() {
    return this.service.fetchData();
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

# @polly-ts/core

A comprehensive resilience and transient fault handling library for TypeScript/Node.js, inspired by .NET Polly.

[![npm version](https://img.shields.io/npm/v/@polly-ts/core.svg)](https://www.npmjs.com/package/@polly-ts/core)
[![License](https://img.shields.io/npm/l/@polly-ts/core.svg)](https://github.com/jordi-bermejo/polly-ts/blob/main/LICENSE)

## Features

- **Retry**: Retries failed operations with configurable backoff strategies (Constant, Exponential, Jitter).
- **Circuit Breaker**: Fails fast when a threshold of failures is reached to prevent cascading failures.
- **Timeout**: Enforces time limits on operations (supports both pessimistic and optimistic strategies).
- **Fallback**: Provides a default value or alternative action on failure.
- **Bulkhead**: Limits concurrent executions to prevent resource exhaustion.
- **Composition**: easily combine policies using `pipeline()`.

## Installation

```bash
pnpm add @polly-ts/core
# or
npm install @polly-ts/core
```

## Usage

### Retry Policy

```typescript
import { RetryPolicy, ExponentialBackoff } from '@polly-ts/core';

const retry = new RetryPolicy({
  maxAttempts: 3,
  backoff: new ExponentialBackoff({ initialDelay: 100, multiplier: 2 }),
  shouldRetryError: (err) => err.status >= 500,
});

const result = await retry.execute(async () => {
  return await fetch('https://api.example.com/data');
});
```

### Circuit Breaker

```typescript
import { CircuitBreakerPolicy } from '@polly-ts/core';

const breaker = new CircuitBreakerPolicy({
  failureThreshold: 5,
  breakDuration: 30000, // 30 seconds
});

breaker.onStateChange((event) => {
  console.log(`Circuit state changed from ${event.fromState} to ${event.toState}`);
});

await breaker.execute(() => sensitiveOperation());
```

### Policy Composition

Use `pipeline` to combine policies. The order matters: the first policy wraps the subsequent ones.

```typescript
import { pipeline, RetryPolicy, CircuitBreakerPolicy, TimeoutPolicy } from '@polly-ts/core';

// Retry -> wraps -> CircuitBreaker -> wraps -> Timeout -> wraps -> Operation
const resilience = pipeline(
  new RetryPolicy({ maxAttempts: 3 }),
  new CircuitBreakerPolicy({ failureThreshold: 5 }),
  new TimeoutPolicy({ timeoutMs: 1000 }),
);

const result = await resilience.execute(async (ctx) => {
  // AbortSignal is propagated through the pipeline
  return fetch('/api/data', { signal: ctx.signal });
});
```

## Advanced

### Context & Cancellation

All policies support passing an `AbortSignal`.

```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);

await policy.execute(async (ctx) => {
  // ctx.signal combines the external signal (controller) and policy signals (timeout)
  await doWork(ctx.signal);
}, controller.signal);
```

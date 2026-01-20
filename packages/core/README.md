# polly-ts-core

A comprehensive resilience and transient fault handling library for TypeScript/Node.js, inspired by .NET Polly.

[![npm version](https://img.shields.io/npm/v/polly-ts-core.svg)](https://www.npmjs.com/package/polly-ts-core)
[![License](https://img.shields.io/npm/l/polly-ts-core.svg)](https://github.com/jordi-bermejo/polly-ts/blob/main/LICENSE)

## Features

- **Retry**: Retries failed operations with configurable backoff strategies (Constant, Exponential, Jitter).
- **Circuit Breaker**: Fails fast when a threshold of failures is reached to prevent cascading failures.
- **Timeout**: Enforces time limits on operations (supports both pessimistic and optimistic strategies).
- **Fallback**: Provides a default value or alternative action on failure.
- **Bulkhead**: Limits concurrent executions to prevent resource exhaustion.
- **Cache**: Caches successful results with TTL and custom key strategies.
- **Hedging**: Launches parallel attempts to reduce tail latency.
- **Rate Limiter**: Controls request rates using a token bucket strategy.
- **Composition**: easily combine policies using `pipeline()`.

## Policies

| Policy                      | Description                                                                       |
| --------------------------- | --------------------------------------------------------------------------------- |
| `RetryPolicy`               | Retries failed operations with configurable predicates and backoff strategies.    |
| `CircuitBreakerPolicy`      | Opens after consecutive failures to fail fast and recover after a break duration. |
| `TimeoutPolicy`             | Enforces execution time limits with optimistic or pessimistic cancellation.       |
| `FallbackPolicy`            | Returns a fallback value or action when errors or results match a predicate.      |
| `BulkheadPolicy`            | Limits concurrent executions and optional queueing to protect resources.          |
| `CachePolicy`               | Caches successful results with TTL and custom key generation.                     |
| `HedgingPolicy`             | Runs parallel attempts to reduce tail latency for idempotent work.                |
| `RateLimiterPolicy`         | Limits the rate of operations using token bucket strategies.                      |
| `PolicyWrap` / `pipeline()` | Composes policies in order to build a single resilience strategy.                 |

## Installation

```bash
pnpm add polly-ts-core
# or
npm install polly-ts-core
```

## Usage

### Retry Policy

Use retry when failures are transient (timeouts, flaky networks) and the operation is safe to repeat. It is best for idempotent operations and for scenarios where extra latency is acceptable in exchange for higher success rates.

Further reading: https://learn.microsoft.com/azure/architecture/patterns/retry

Backoff is pluggable: implement `BackoffStrategy` to customize retry delays.

```
request -> fail -> wait -> retry -> success
```

```typescript
import { RetryPolicy, ExponentialBackoff } from 'polly-ts-core';

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

Use a circuit breaker to fail fast when a dependency is unhealthy and you want to prevent cascading failures. It reduces pressure on failing services and gives them time to recover before traffic resumes.

Further reading: https://learn.microsoft.com/azure/architecture/patterns/circuit-breaker and https://martinfowler.com/bliki/CircuitBreaker.html

State storage is pluggable: implement `CircuitBreakerStateStore` to share state across nodes or processes.

```
CLOSED --failures--> OPEN --time--> HALF_OPEN --success--> CLOSED
```

```typescript
import { CircuitBreakerPolicy } from 'polly-ts-core';

const breaker = new CircuitBreakerPolicy({
  failureThreshold: 5,
  breakDuration: 30000, // 30 seconds
});

breaker.onStateChange((event) => {
  console.log(`Circuit state changed from ${event.fromState} to ${event.toState}`);
});

await breaker.execute(() => sensitiveOperation());
```

### Timeout Policy

Use a timeout to cap how long you will wait for an operation, preventing resource exhaustion and keeping tail latency in check. Prefer optimistic timeouts when your work honors `AbortSignal`; use pessimistic timeouts when you must race or cancel non-cooperative work.

```
operation -> timer -> success or timeout
```

```typescript
import { TimeoutPolicy } from 'polly-ts-core';

const timeout = new TimeoutPolicy({ timeoutMs: 1000 });
await timeout.execute(async () => fetch('/api'));
```

### Cache Policy

Use cache to avoid recomputing or refetching expensive results that are safe to reuse for a time window. It is ideal for read-heavy workloads where slightly stale data is acceptable.

Further reading: https://learn.microsoft.com/azure/architecture/patterns/cache-aside

Cache providers are pluggable: implement `ICacheProvider` to back the cache with Redis, Memcached, or a custom store.

```
request -> cache? -> hit -> return
                \-> miss -> execute -> store
```

```typescript
import { CachePolicy, MemoryCacheProvider } from 'polly-ts-core';

const userId = '123';
const cache = new CachePolicy({
  provider: new MemoryCacheProvider(),
  ttlMs: 60000,
  keyGenerator: () => `user:${userId}`,
});

const user = await cache.execute(async () => fetchUser(userId));
```

### Hedging Policy

Use hedging to reduce tail latency for idempotent operations by running parallel attempts. It is useful for read operations with unpredictable latency, but be mindful of added load on dependencies.

```
primary ----->\
hedge (delay)  +--> first success wins
```

```typescript
import { HedgingPolicy } from 'polly-ts-core';

const hedging = new HedgingPolicy({ delayMs: 100, maxHedges: 1 });

hedging.onHedge(({ attemptNumber }) => {
  console.log(`Launching hedge attempt ${attemptNumber}`);
});

const result = await hedging.execute(async (ctx) => {
  return fetch('/api/data', { signal: ctx.signal });
});
```

### Rate Limiter

Use rate limiting to cap request volume and protect downstream services or comply with API quotas. It smooths bursts and enforces fairness when multiple callers share the same capacity.

Further reading: https://learn.microsoft.com/azure/architecture/patterns/throttling and https://en.wikipedia.org/wiki/Token_bucket

Rate limiting is strategy-based: implement `IRateLimiterStrategy` for fixed window, sliding window, or distributed limits.

```
requests -> token bucket -> allow or reject
```

```typescript
import { RateLimiterPolicy, TokenBucketStrategy } from 'polly-ts-core';

const rateLimiter = new RateLimiterPolicy({
  strategy: new TokenBucketStrategy({ capacity: 100, refillRate: 100 }),
});

await rateLimiter.execute(() => callApi());
```

### Fallback Policy

Use fallback when you want a safe default response or alternate path after failures. It is a good fit for optional features or for returning cached/degraded data instead of failing requests.

```
operation -> fail -> fallback
```

```typescript
import { FallbackPolicy } from 'polly-ts-core';

const fallback = new FallbackPolicy({
  fallback: () => ({ data: [], source: 'fallback' }),
});
```

### Bulkhead Policy

Use bulkhead to isolate high-cost or unreliable operations and prevent resource exhaustion. It limits concurrency and optional queue depth so one workload cannot starve another.

Further reading: https://learn.microsoft.com/azure/architecture/patterns/bulkhead and https://martinfowler.com/bliki/Bulkhead.html

```
requests -> bulkhead -> execute or reject
```

```typescript
import { BulkheadPolicy } from 'polly-ts-core';

const bulkhead = new BulkheadPolicy({ maxConcurrent: 10, maxQueue: 50 });
```

### Policy Composition

Use composition when you want multiple resilience techniques applied in a specific order. It lets you model real-world failure behavior, such as retrying inside a circuit breaker with a timeout boundary.

Use `pipeline` to combine policies. The order matters: the first policy wraps the subsequent ones.

```
Retry -> CircuitBreaker -> Timeout -> Operation
```

```typescript
import { pipeline, RetryPolicy, CircuitBreakerPolicy, TimeoutPolicy } from 'polly-ts-core';

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

## API Reference

| API                            | Kind        | Description                                                       | Example                                                               |
| ------------------------------ | ----------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| `PolicyEventEmitter`           | Class       | Emits and manages policy success/failure event listeners.         | `const emitter = new PolicyEventEmitter<{ value: number }>();`        |
| `createExecutionContext`       | Function    | Builds an execution context with defaults and optional overrides. | `const ctx = createExecutionContext({ operationKey: 'fetch-user' });` |
| `PolicyError`                  | Error class | Base error for policy-specific failures.                          | `if (err instanceof PolicyError) handle(err);`                        |
| `TimeoutError`                 | Error class | Thrown when a timeout policy expires.                             | `if (err instanceof TimeoutError) retryLater();`                      |
| `CircuitOpenError`             | Error class | Thrown when a circuit breaker is open.                            | `if (err instanceof CircuitOpenError) queue();`                       |
| `BulkheadRejectedError`        | Error class | Thrown when bulkhead capacity is exceeded.                        | `if (err instanceof BulkheadRejectedError) throttle();`               |
| `RateLimitRejectedError`       | Error class | Thrown when a rate limiter denies a request.                      | `if (err instanceof RateLimitRejectedError) backoff();`               |
| `RetryPolicy`                  | Class       | Retries failed operations with configurable predicates.           | `const retry = new RetryPolicy({ maxAttempts: 3 });`                  |
| `ConstantBackoff`              | Class       | Fixed delay backoff strategy for retries.                         | `const backoff = new ConstantBackoff({ delay: 200 });`                |
| `ExponentialBackoff`           | Class       | Exponential delay backoff strategy for retries.                   | `const backoff = new ExponentialBackoff({ initialDelay: 100 });`      |
| `ExponentialBackoffWithJitter` | Class       | Exponential backoff with jitter to spread retries.                | `new ExponentialBackoffWithJitter({ jitter: 'full' });`               |
| `CustomBackoff`                | Class       | Backoff strategy defined by a custom delay function.              | `new CustomBackoff((attempt) => attempt * 250);`                      |
| `TimeoutPolicy`                | Class       | Enforces time limits with cancellation.                           | `const timeout = new TimeoutPolicy({ timeoutMs: 1000 });`             |
| `CircuitBreakerPolicy`         | Class       | Fails fast after repeated failures and recovers after a break.    | `const breaker = new CircuitBreakerPolicy({ failureThreshold: 5 });`  |
| `FallbackPolicy`               | Class       | Returns a fallback value or action on failure.                    | `new FallbackPolicy({ fallback: () => 'default' });`                  |
| `BulkheadPolicy`               | Class       | Limits concurrency and queue length.                              | `new BulkheadPolicy({ maxConcurrent: 5, maxQueue: 10 });`             |
| `CachePolicy`                  | Class       | Caches successful results with TTL and key generation.            | `new CachePolicy({ ttlMs: 60000, keyGenerator: () => 'key' });`       |
| `MemoryCacheProvider`          | Class       | In-memory cache provider for CachePolicy.                         | `const provider = new MemoryCacheProvider();`                         |
| `HedgingPolicy`                | Class       | Launches parallel attempts to reduce tail latency.                | `new HedgingPolicy({ delayMs: 100, maxHedges: 1 });`                  |
| `RateLimiterPolicy`            | Class       | Limits operation rate using a strategy such as token bucket.      | `new RateLimiterPolicy({ strategy });`                                |
| `TokenBucketStrategy`          | Class       | Token bucket rate limiting strategy.                              | `new TokenBucketStrategy({ capacity: 100, refillRate: 100 });`        |
| `PolicyWrap`                   | Class       | Wraps one policy around another.                                  | `const wrapped = new PolicyWrap(retry, timeout);`                     |
| `pipeline`                     | Function    | Composes policies into a single execution pipeline.               | `const combined = pipeline(retry, timeout);`                          |
| `MemoryStateStore`             | Class       | In-memory circuit breaker state store.                            | `const store = new MemoryStateStore(5, 30000, 2);`                    |

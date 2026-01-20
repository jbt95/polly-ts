# polly-ts-redis

Redis-based state store for **Polly-TS** Circuit Breakers, enabling distributed circuit state sharing across multiple instances of your application.

## Installation

```bash
npm install polly-ts-core polly-ts-redis ioredis
# or
pnpm add polly-ts-core polly-ts-redis ioredis
```

## Usage

```typescript
import Redis from 'ioredis';
import { CircuitBreakerPolicy } from 'polly-ts-core';
import { RedisStateStore } from 'polly-ts-redis';

const redis = new Redis('redis://localhost:6379');

const breaker = new CircuitBreakerPolicy({
  stateStore: new RedisStateStore({
    client: redis,
    name: 'payment-service',
    failThreshold: 10,
    breakDuration: 60000,
    successThreshold: 2,
  }),
});

// Now this breaker shares state across all nodes connected to Redis.
// If one node trips the breaker, all nodes will open.
```

## Examples

### RedisStateStore

```typescript
const redis = new Redis('redis://localhost:6379');

const store = new RedisStateStore({
  client: redis,
  name: 'payments',
  failThreshold: 5,
  breakDuration: 30000,
  successThreshold: 2,
});

const breaker = new CircuitBreakerPolicy({ stateStore: store });
```

## API Reference

| API               | Kind  | Description                                                            | Example                                                                                                                               |
| ----------------- | ----- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `RedisStateStore` | Class | Redis-backed circuit breaker state store for distributed coordination. | `const store = new RedisStateStore({ client: redis, name: 'billing', failThreshold: 5, breakDuration: 30000, successThreshold: 2 });` |

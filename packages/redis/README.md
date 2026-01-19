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
  failureThreshold: 10,
  breakDuration: 60000,
  stateStore: new RedisStateStore(redis, {
    namespace: 'my-service-breaker',
  }),
});

// Now this breaker shares state across all nodes connected to Redis.
// If one node trips the breaker, all nodes will open.
```

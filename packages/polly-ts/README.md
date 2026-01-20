# polly-ts

All-in-one Polly-TS bundle with core policies and integrations.

## Installation

```bash
npm install polly-ts
# or
pnpm add polly-ts
```

## Usage

Named exports from core:

```typescript
import { RetryPolicy, CircuitBreakerPolicy, pipeline } from 'polly-ts';

const retry = new RetryPolicy({ maxAttempts: 3 });
const breaker = new CircuitBreakerPolicy({ failureThreshold: 5 });
const strategy = pipeline(breaker, retry);
```

Namespaced access for integrations:

```typescript
import express from 'express';
import { Core, Http, Express } from 'polly-ts';

const retry = new Core.RetryPolicy({ maxAttempts: 3 });
const breaker = new Core.CircuitBreakerPolicy({ failureThreshold: 5 });
const resilientFetch = Http.pollyFetch(retry);

const app = express();
app.get('/data', Express.polly(breaker), async (_req, res) => {
  res.json({ ok: true });
});
```

## Sub-packages

- [Core](../core/README.md)
- [HTTP](../http/README.md)
- [Express](../express/README.md)
- [Fastify](../fastify/README.md)
- [NestJS](../nestjs/README.md)
- [Hono](../hono/README.md)
- [Redis](../redis/README.md)
- [Telemetry](../telemetry/README.md)
- [Testing](../testing/README.md)

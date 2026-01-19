# polly-ts-fastify

Fastify plugin/hooks for **Polly-TS**, enabling resilience policies on your routes.

## Installation

```bash
npm install polly-ts-core polly-ts-fastify
# or
pnpm add polly-ts-core polly-ts-fastify
```

## Usage

Use the `polly` hook wrapper to apply policies to Fastify routes.

```typescript
import Fastify from 'fastify';
import { polly } from 'polly-ts-fastify';
import { BulkheadPolicy } from 'polly-ts-core';

const fastify = Fastify();

// Limit concurrent requests to 10 with a queue of 5
const bulkhead = new BulkheadPolicy({ maxConcurrent: 10, maxQueue: 5 });

fastify.register(async (instance) => {
  // Apply to all routes in this encapsulated context
  instance.addHook('onRequest', polly(bulkhead));

  instance.get('/limited', async (req, reply) => {
    // ... expensive operation ...
    return { status: 'ok' };
  });
});

fastify.listen({ port: 3000 });
```

### Handling Failures

Polly-TS errors (like `BulkheadRejectedError` or `CircuitOpenError`) will be thrown by the hook. Fastify's default error handler will return 500. You can customize this:

```typescript
import { BulkheadRejectedError } from 'polly-ts-core';

fastify.setErrorHandler((error, request, reply) => {
  if (error instanceof BulkheadRejectedError) {
    reply.status(429).send({ error: 'Too Many Requests' });
  } else {
    reply.send(error);
  }
});
```

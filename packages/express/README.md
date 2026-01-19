# polly-ts-express

Express middleware for **Polly-TS**, enabling resilience policies on your API routes.

## Installation

```bash
npm install polly-ts-core polly-ts-express
# or
pnpm add polly-ts-core polly-ts-express
```

## Usage

Wrap your route handlers with the `polly` middleware to apply policies like Circuit Breaker, Bulkhead, or Timeout.

```typescript
import express from 'express';
import { polly } from 'polly-ts-express';
import { CircuitBreakerPolicy } from 'polly-ts-core';

const app = express();
const breaker = new CircuitBreakerPolicy({
  failureThreshold: 3,
  breakDuration: 30000,
});

app.get(
  '/unstable-endpoint',
  // Stop processing requests if backend is failing involved
  polly(breaker),
  async (req, res) => {
    // ... risky operation ...
    res.send('Success');
  },
);

app.listen(3000);
```

### Error Handling

If a policy rejects the request (e.g., Circuit Open, Timeout, Bulkhead Rejected), the middleware calls `next(err)`. You should have a global error handler to format these errors appropriately.

```typescript
import { CircuitOpenError } from 'polly-ts-core';

app.use((err, req, res, next) => {
  if (err instanceof CircuitOpenError) {
    res.status(503).send('Service Unavailable');
  } else {
    res.status(500).send('Internal Server Error');
  }
});
```

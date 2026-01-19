# polly-ts-hono

Hono middleware for **Polly-TS**.

## Installation

```bash
npm install polly-ts-core polly-ts-hono
# or
pnpm add polly-ts-core polly-ts-hono
```

## Usage

```typescript
import { Hono } from 'hono';
import { polly } from 'polly-ts-hono';
import { TimeoutPolicy } from 'polly-ts-core';

const app = new Hono();
const timeout = new TimeoutPolicy({ timeoutMs: 2000 });

app.use('/api/*', polly(timeout));

app.get('/api/data', async (c) => {
  // Requests taking longer than 2s will be aborted
  // and return 500 (or custom error handlers)
  await longRunningTask();
  return c.json({ success: true });
});

export default app;
```

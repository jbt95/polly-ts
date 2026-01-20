# polly-ts-http

Resilience wrappers for the standard Fetch API, part of the **Polly-TS** library.

## Installation

```bash
npm install polly-ts-core polly-ts-http
# or
pnpm add polly-ts-core polly-ts-http
```

## Usage

Use `pollyFetch` to wrap your HTTP requests with resilience policies (Retry, Circuit Breaker, etc.).

```typescript
import { pollyFetch, HttpError } from 'polly-ts-http';
import { RetryPolicy, CircuitBreakerPolicy } from 'polly-ts-core';

const retry = new RetryPolicy({ maxAttempts: 3 });
const breaker = new CircuitBreakerPolicy({ failureThreshold: 5, breakDuration: 10000 });

// Wrap standard fetch
const resilientFetch = pollyFetch(retry);

async function getData() {
  try {
    const response = await resilientFetch('https://api.example.com/data');
    const data = await response.json();
    return data;
  } catch (err) {
    if (err instanceof HttpError) {
      console.error('HTTP Error:', err.response.status);
    }
    throw err;
  }
}
```

### AbortSignal Support

`pollyFetch` automatically handles `AbortSignal` propagation. If the policy times out or is cancelled, the underlying fetch request will be aborted.

```typescript
import { TimeoutPolicy } from 'polly-ts-core';

const timeout = new TimeoutPolicy({ timeoutMs: 1000 });
const fetchWithTimeout = pollyFetch(timeout);

await fetchWithTimeout('https://slow-api.com'); // Aborts if > 1s
```

## Examples

### pollyFetch

```typescript
const retry = new RetryPolicy({ maxAttempts: 3 });
const resilientFetch = pollyFetch(retry, {
  shouldFail: (res) => res.status >= 500,
});
```

### HttpError

```typescript
const resilientFetch = pollyFetch(retry);

try {
  await resilientFetch('https://api.example.com/data');
} catch (err) {
  if (err instanceof HttpError) {
    console.error('Status', err.response.status);
  }
}
```

## API Reference

| API          | Kind        | Description                                                 | Example                                               |
| ------------ | ----------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| `pollyFetch` | Function    | Wraps `fetch` with a Polly policy for resilient HTTP calls. | `const resilientFetch = pollyFetch(retry);`           |
| `HttpError`  | Error class | Error thrown when a response matches the failure predicate. | `if (err instanceof HttpError) handle(err.response);` |

# polly-ts-telemetry

Telemetry integration for **Polly-TS**, allowing you to emit metrics and traces for resilience events (retries, timeouts, circuit breaks).

> **Note**: This package emits OpenTelemetry spans and metrics; you still need an SDK/exporter to see the data.

## Installation

```bash
npm install polly-ts-core polly-ts-telemetry
# or
pnpm add polly-ts-core polly-ts-telemetry
```

## Usage

Wrap your existing policies with `TelemetryPolicy` to emit spans and metrics.

```typescript
import { TelemetryPolicy } from 'polly-ts-telemetry';
import { RetryPolicy } from 'polly-ts-core';

const retry = new RetryPolicy({ maxAttempts: 3 });

const observedRetry = new TelemetryPolicy(retry, {
  tracer: 'my-service',
  meter: 'my-service',
  recordMetrics: true,
  recordSpans: true,
});

await observedRetry.execute(() => fetch('/api'));
```

## Examples

### TelemetryPolicy

```typescript
const retry = new RetryPolicy({ maxAttempts: 3 });
const observed = new TelemetryPolicy(retry, {
  tracer: 'my-service',
  meter: 'my-service',
  recordMetrics: true,
});
```

### VERSION

```typescript
console.log(`polly-ts-telemetry version ${VERSION}`);
```

## API Reference

| API               | Kind     | Description                                                       | Example                                                                         |
| ----------------- | -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `TelemetryPolicy` | Class    | Wraps another policy and records OpenTelemetry metrics and spans. | `const observed = new TelemetryPolicy(retry, { tracer: 'svc', meter: 'svc' });` |
| `VERSION`         | Constant | Package version string used for telemetry instrumentation.        | `console.log(VERSION);`                                                         |

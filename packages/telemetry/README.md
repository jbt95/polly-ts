# polly-ts-telemetry

Telemetry integration for **Polly-TS**, allowing you to emit metrics and traces for resilience events (retries, timeouts, circuit breaks).

> **Note**: This package currently provides the base `TelemetryPolicy`. OpenTelemetry integration is planned for future updates.

## Installation

```bash
npm install polly-ts-core polly-ts-telemetry
# or
pnpm add polly-ts-core polly-ts-telemetry
```

## Usage

Wrap your existing policies with `TelemetryPolicy` to observe their execution.

```typescript
import { TelemetryPolicy } from 'polly-ts-telemetry';
import { RetryPolicy } from 'polly-ts-core';

const retry = new RetryPolicy();

const observedRetry = new TelemetryPolicy(retry, {
  onEvent: (event) => {
    // Log to console, or send to Prometheus/Datadog/etc.
    console.log(`[Telemetry] ${event.type}:`, event.data);
  },
});

await observedRetry.execute(() => fetch('/api'));
```

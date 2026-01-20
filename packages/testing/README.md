# Testing Package

The `polly-ts-testing` package provides utilities for testing resilience policies in your applications. It is part of the Polly-TS library, a comprehensive resilience and transient fault handling library for TypeScript/Node.js.

## Features

- Chaos testing utilities to simulate failures.
- Helpers for testing Polly-TS policies.
- Fully type-safe and designed for modern TypeScript.

## Installation

Install the package using pnpm:

```bash
pnpm add polly-ts-testing
```

## Usage

### Chaos Policy

The `ChaosPolicy` allows you to simulate random failures or latency to test resilience.

```typescript
import { ChaosPolicy } from 'polly-ts-testing';

const chaosPolicy = new ChaosPolicy({
  injectionRate: 0.3, // 30% chance of fault injection
  latencyMs: 150, // Optional latency injection
});

await chaosPolicy.execute(() => {
  console.log('This might fail!');
});
```

### Composing With Core Policies

Combine `ChaosPolicy` with core policies to test complex behavior.

```typescript
import { ChaosPolicy } from 'polly-ts-testing';
import { RetryPolicy, pipeline } from 'polly-ts-core';

const chaos = new ChaosPolicy({ injectionRate: 0.5 });
const retry = new RetryPolicy({ maxAttempts: 3 });
const strategy = pipeline(chaos, retry);

await strategy.execute(async () => {
  // Simulate an operation that might fail
  if (Math.random() < 0.7) {
    throw new Error('Simulated failure');
  }
  return 'ok';
});
```

## Examples

### ChaosPolicy

```typescript
const chaos = new ChaosPolicy({
  injectionRate: 0.2,
  fault: new Error('Injected failure'),
});

await chaos.execute(async () => {
  return 'ok';
});
```

## API Reference

| API           | Kind  | Description                                   | Example                                                  |
| ------------- | ----- | --------------------------------------------- | -------------------------------------------------------- |
| `ChaosPolicy` | Class | Injects faults and latency for chaos testing. | `const chaos = new ChaosPolicy({ injectionRate: 0.2 });` |

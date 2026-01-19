# Testing Package

The `@polly-ts/testing` package provides utilities for testing resilience policies in your applications. It is part of the Polly-TS library, a comprehensive resilience and transient fault handling library for TypeScript/Node.js.

## Features

- Chaos testing utilities to simulate failures.
- Helpers for testing Polly-TS policies.
- Fully type-safe and designed for modern TypeScript.

## Installation

Install the package using pnpm:

```bash
pnpm add @polly-ts/testing
```

## Usage

### Chaos Policy

The `ChaosPolicy` allows you to simulate random failures in your application to test its resilience.

```typescript
import { ChaosPolicy } from '@polly-ts/testing';

const chaosPolicy = new ChaosPolicy({
  failureRate: 0.3, // 30% chance of failure
});

chaosPolicy.execute(() => {
  console.log('This might fail!');
});
```

### Testing Policies

Use the utilities in this package to test your Polly-TS policies under various conditions.

```typescript
import { RetryPolicy } from '@polly-ts/core';
import { ChaosPolicy } from '@polly-ts/testing';

// Create a RetryPolicy
const retryPolicy = new RetryPolicy({
  retries: 3,
});

// Wrap the RetryPolicy with a ChaosPolicy for testing
const chaosPolicy = new ChaosPolicy({
  failureRate: 0.5, // 50% chance of failure
});

const combinedPolicy = chaosPolicy.wrap(retryPolicy);

// Execute a test action
combinedPolicy.execute(async () => {
  console.log('Attempting operation...');
  // Simulate an operation that might fail
  if (Math.random() < 0.7) {
    throw new Error('Simulated failure');
  }
  console.log('Operation succeeded');
});
```

## Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository.
2. Create a new branch for your feature or bugfix.
3. Write tests and ensure all existing tests pass.
4. Submit a pull request.

## License

This project is licensed under the MIT License. See the LICENSE file for details.

---

For more information, visit the [Polly-TS GitHub repository](https://github.com/jbt95/polly-ts).

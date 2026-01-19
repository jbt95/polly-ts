/**
 * Backoff strategy interface.
 * Determines delay between retry attempts.
 */
export interface BackoffStrategy {
  /**
   * Calculate the delay before the next retry attempt.
   * @param attemptNumber - Current attempt number (1-indexed, so first retry is attempt 2)
   * @returns Delay in milliseconds before the next attempt
   */
  getDelay(attemptNumber: number): number;
}

/**
 * Options for ConstantBackoff.
 */
export interface ConstantBackoffOptions {
  /** Delay in milliseconds between retries. Default: 1000 */
  delay?: number;
}

/**
 * Constant delay between retries.
 */
export class ConstantBackoff implements BackoffStrategy {
  private readonly delay: number;

  constructor(options: ConstantBackoffOptions = {}) {
    this.delay = options.delay ?? 1000;
  }

  getDelay(_attemptNumber: number): number {
    return this.delay;
  }
}

/**
 * Options for ExponentialBackoff.
 */
export interface ExponentialBackoffOptions {
  /** Initial delay in milliseconds. Default: 100 */
  initialDelay?: number;
  /** Maximum delay in milliseconds. Default: 30000 */
  maxDelay?: number;
  /** Multiplier for each attempt. Default: 2 */
  multiplier?: number;
}

/**
 * Exponential backoff - delay doubles (or multiplies) with each attempt.
 */
export class ExponentialBackoff implements BackoffStrategy {
  private readonly initialDelay: number;
  private readonly maxDelay: number;
  private readonly multiplier: number;

  constructor(options: ExponentialBackoffOptions = {}) {
    this.initialDelay = options.initialDelay ?? 100;
    this.maxDelay = options.maxDelay ?? 30000;
    this.multiplier = options.multiplier ?? 2;
  }

  getDelay(attemptNumber: number): number {
    // attemptNumber 2 = first retry, should use initialDelay
    const delay = this.initialDelay * Math.pow(this.multiplier, attemptNumber - 2);
    return Math.min(delay, this.maxDelay);
  }
}

/**
 * Jitter types for randomizing backoff delays.
 */
export type JitterType = 'full' | 'equal' | 'decorrelated';

/**
 * Options for ExponentialBackoffWithJitter.
 */
export interface ExponentialBackoffWithJitterOptions extends ExponentialBackoffOptions {
  /** Type of jitter to apply. Default: 'full' */
  jitter?: JitterType;
}

/**
 * Exponential backoff with jitter to prevent thundering herd.
 *
 * Jitter types:
 * - full: delay = random(0, exponentialDelay)
 * - equal: delay = exponentialDelay/2 + random(0, exponentialDelay/2)
 * - decorrelated: delay = random(initialDelay, previousDelay * 3)
 */
export class ExponentialBackoffWithJitter implements BackoffStrategy {
  private readonly initialDelay: number;
  private readonly maxDelay: number;
  private readonly multiplier: number;
  private readonly jitter: JitterType;
  private previousDelay: number;

  constructor(options: ExponentialBackoffWithJitterOptions = {}) {
    this.initialDelay = options.initialDelay ?? 100;
    this.maxDelay = options.maxDelay ?? 30000;
    this.multiplier = options.multiplier ?? 2;
    this.jitter = options.jitter ?? 'full';
    this.previousDelay = this.initialDelay;
  }

  getDelay(attemptNumber: number): number {
    const baseDelay = this.initialDelay * Math.pow(this.multiplier, attemptNumber - 2);
    const cappedDelay = Math.min(baseDelay, this.maxDelay);

    let jitteredDelay: number;

    switch (this.jitter) {
      case 'full':
        // Full jitter: random between 0 and calculated delay
        jitteredDelay = Math.random() * cappedDelay;
        break;

      case 'equal':
        // Equal jitter: half the delay + random half
        jitteredDelay = cappedDelay / 2 + Math.random() * (cappedDelay / 2);
        break;

      case 'decorrelated':
        // Decorrelated jitter: random between initial and 3x previous
        jitteredDelay =
          Math.random() * (this.previousDelay * 3 - this.initialDelay) + this.initialDelay;
        jitteredDelay = Math.min(jitteredDelay, this.maxDelay);
        this.previousDelay = jitteredDelay;
        break;
    }

    return Math.floor(jitteredDelay);
  }
}

/**
 * Custom backoff using a user-provided function.
 */
export class CustomBackoff implements BackoffStrategy {
  constructor(private readonly delayFn: (attemptNumber: number) => number) {}

  getDelay(attemptNumber: number): number {
    return this.delayFn(attemptNumber);
  }
}

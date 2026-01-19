import {
  trace,
  metrics,
  SpanStatusCode,
  context as otelContext,
  type Tracer,
  type Meter,
  type Histogram,
  type Counter,
} from '@opentelemetry/api';
import type {
  IPolicy,
  ExecutionContext,
  SuccessEventArgs,
  FailureEventArgs,
  PolicyEvent,
} from 'polly-ts-core';
// We need to import PolicyEventEmitter but it's not exported from polly-ts-core top level?
// I exported events types but not class PolicyEventEmitter?
// Let me check core exports.
// If not exported, I implement TelemetryPolicy simply wrapping execute.
// But I need to implement onSuccess/onFailure. I can delegate to inner policy.
// But TelemetryPolicy itself is a policy, so it should have its own events or pass-through?
// Usually listeners subscribe to the *wrapper* or the *inner*.
// If I wrap, I should forward the inner events? Or just expose them?
// IPolicy interface requires onSuccess/onFailure properties.
// I can just re-expose inner.onSuccess.

export interface TelemetryOptions {
  /**
   * Tracer provider or name.
   */
  tracer?: Tracer | string;

  /**
   * Meter provider or name.
   */
  meter?: Meter | string;

  /**
   * Defines if success/failure metrics should be recorded. Default: true.
   */
  recordMetrics?: boolean;

  /**
   * Defines if spans should be created. Default: true.
   */
  recordSpans?: boolean;
}

export class TelemetryPolicy<TResult = unknown> implements IPolicy<TResult> {
  readonly name: string;
  private readonly inner: IPolicy<TResult>;
  private readonly tracer: Tracer;
  private readonly meter: Meter;
  private readonly recordMetrics: boolean;
  private readonly recordSpans: boolean;

  // Metrics
  private readonly attemptCounter: Counter;
  private readonly successCounter: Counter;
  private readonly failureCounter: Counter;
  private readonly durationHistogram: Histogram;

  constructor(inner: IPolicy<TResult>, options: TelemetryOptions = {}) {
    this.inner = inner;
    this.name = `Telemetry(${inner.name})`;
    this.recordMetrics = options.recordMetrics ?? true;
    this.recordSpans = options.recordSpans ?? true;

    // Setup Tracer
    if (typeof options.tracer === 'string' || options.tracer === undefined) {
      this.tracer = trace.getTracer(options.tracer ?? 'polly-ts', '0.1.0');
    } else {
      this.tracer = options.tracer;
    }

    // Setup Meter
    if (typeof options.meter === 'string' || options.meter === undefined) {
      this.meter = metrics.getMeter(options.meter ?? 'polly-ts', '0.1.0');
    } else {
      this.meter = options.meter;
    }

    // Initialize Metrics
    this.attemptCounter = this.meter.createCounter('polly.policy.attempts', {
      description: 'Number of policy execution attempts',
    });
    this.successCounter = this.meter.createCounter('polly.policy.successes', {
      description: 'Number of successful policy executions',
    });
    this.failureCounter = this.meter.createCounter('polly.policy.failures', {
      description: 'Number of failed policy executions',
    });
    this.durationHistogram = this.meter.createHistogram('polly.policy.duration', {
      description: 'Duration of policy executions',
      unit: 'ms',
    });
  }

  // Pass-through events
  get onSuccess(): PolicyEvent<SuccessEventArgs> {
    return this.inner.onSuccess;
  }

  get onFailure(): PolicyEvent<FailureEventArgs> {
    return this.inner.onFailure;
  }

  async execute<T extends TResult>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!this.recordSpans) {
      return this.executeWithMetricsOnly(fn, signal);
    }

    const span = this.tracer.startSpan(this.inner.name, {
      attributes: {
        'polly.policy.name': this.inner.name,
      },
    });

    return otelContext.with(trace.setSpan(otelContext.active(), span), async () => {
      const startTime = Date.now();
      try {
        if (this.recordMetrics) {
          this.attemptCounter.add(1, { 'policy.name': this.inner.name });
        }

        const result = await this.inner.execute(fn, signal);
        const duration = Date.now() - startTime;

        span.setStatus({ code: SpanStatusCode.OK });

        if (this.recordMetrics) {
          this.successCounter.add(1, { 'policy.name': this.inner.name });
          this.durationHistogram.record(duration, {
            'policy.name': this.inner.name,
            status: 'success',
          });
        }

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;

        span.recordException(error as Error);

        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });

        if (this.recordMetrics) {
          this.failureCounter.add(1, { 'policy.name': this.inner.name });
          this.durationHistogram.record(duration, {
            'policy.name': this.inner.name,
            status: 'failure',
          });
        }

        throw error;
      } finally {
        span.end();
      }
    });
  }

  private async executeWithMetricsOnly<T extends TResult>(
    fn: (context: ExecutionContext) => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.recordMetrics) {
      this.attemptCounter.add(1, { 'policy.name': this.inner.name });
    }

    const startTime = Date.now();
    try {
      const result = await this.inner.execute(fn, signal);
      const duration = Date.now() - startTime;

      if (this.recordMetrics) {
        this.successCounter.add(1, { 'policy.name': this.inner.name });
        this.durationHistogram.record(duration, {
          'policy.name': this.inner.name,
          status: 'success',
        });
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      if (this.recordMetrics) {
        this.failureCounter.add(1, { 'policy.name': this.inner.name });
        this.durationHistogram.record(duration, {
          'policy.name': this.inner.name,
          status: 'failure',
        });
      }
      throw error;
    }
  }
}

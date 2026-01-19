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

/**
 * A policy that adds telemetry (metrics and tracing) to an inner policy.
 * This policy wraps another policy and records metrics and spans for its execution.
 *
 * @template TResult The type of the result returned by the policy.
 */
export class TelemetryPolicy<TResult = unknown> implements IPolicy<TResult> {
  /**
   * The name of the telemetry policy, which includes the name of the inner policy.
   */
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

  /**
   * Creates a new TelemetryPolicy instance.
   *
   * @param inner The inner policy to wrap with telemetry.
   * @param options Configuration options for telemetry.
   */
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

  /**
   * Event triggered on successful execution of the inner policy.
   */
  get onSuccess(): PolicyEvent<SuccessEventArgs> {
    return this.inner.onSuccess;
  }

  /**
   * Event triggered on failed execution of the inner policy.
   */
  get onFailure(): PolicyEvent<FailureEventArgs> {
    return this.inner.onFailure;
  }

  /**
   * Executes the provided function within the context of the telemetry policy.
   *
   * @param fn The function to execute, which represents the operation to protect.
   * @param signal An optional AbortSignal to cancel the operation.
   * @returns The result of the function execution.
   * @throws Any error thrown by the inner policy or the provided function.
   */
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

  /**
   * Executes the provided function with metrics recording only, without spans.
   *
   * @param fn The function to execute, which represents the operation to protect.
   * @param signal An optional AbortSignal to cancel the operation.
   * @returns The result of the function execution.
   * @throws Any error thrown by the inner policy or the provided function.
   */
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

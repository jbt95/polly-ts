/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/prefer-promise-reject-errors */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelemetryPolicy } from './index';
import { PolicyEventEmitter } from 'polly-ts-core';
import type { IPolicy } from 'polly-ts-core';

// Mock OpenTelemetry
const mockSpan = {
  setStatus: vi.fn(),
  recordException: vi.fn(),
  end: vi.fn(),
};

const mockTracer = {
  startSpan: vi.fn().mockReturnValue(mockSpan),
} as any;

const mockCounter = {
  add: vi.fn(),
};

const mockHistogram = {
  record: vi.fn(),
};

const mockMeter = {
  createCounter: vi.fn().mockReturnValue(mockCounter),
  createHistogram: vi.fn().mockReturnValue(mockHistogram),
} as any;

class MockPolicy implements IPolicy {
  readonly name = 'MockPolicy';
  readonly onSuccess = new PolicyEventEmitter<any>().subscribe;
  readonly onFailure = new PolicyEventEmitter<any>().subscribe;

  execute = vi.fn().mockImplementation((fn: any) => fn({}));
}

describe('TelemetryPolicy', () => {
  let innerPolicy: MockPolicy;
  let telemetryPolicy: TelemetryPolicy;

  beforeEach(() => {
    vi.clearAllMocks();
    innerPolicy = new MockPolicy();
    telemetryPolicy = new TelemetryPolicy(innerPolicy, {
      tracer: mockTracer,
      meter: mockMeter,
    });
  });

  describe('execute', () => {
    it('should start and end a span on success', async () => {
      innerPolicy.execute.mockResolvedValue('success');

      await telemetryPolicy.execute(() => Promise.resolve('success'));

      expect(mockTracer.startSpan).toHaveBeenCalledWith('MockPolicy', expect.any(Object));
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // OK = 1 in OTEL API? Check enums usually 0=UNSET, 1=OK, 2=ERROR
      // Actually @opentelemetry/api SpanStatusCode: UNSET=0, OK=1, ERROR=2
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should record metrics on success', async () => {
      innerPolicy.execute.mockResolvedValue('success');

      await telemetryPolicy.execute(() => Promise.resolve('success'));

      expect(mockCounter.add).toHaveBeenCalledTimes(2); // Attempt + Success
      expect(mockHistogram.record).toHaveBeenCalledTimes(1); // Duration
    });

    it('should record exception and error status on failure', async () => {
      const error = new Error('fail');
      innerPolicy.execute.mockRejectedValue(error);

      await expect(telemetryPolicy.execute(() => Promise.reject(error))).rejects.toThrow('fail');

      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      // SpanStatusCode.ERROR is 2
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 2 });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should record failure metrics', async () => {
      innerPolicy.execute.mockRejectedValue(new Error('fail'));

      await expect(telemetryPolicy.execute(() => Promise.reject('fail'))).rejects.toThrow();

      expect(mockCounter.add).toHaveBeenCalledTimes(2); // Attempt + Failure
      expect(mockHistogram.record).toHaveBeenCalledTimes(1);
    });
  });
});

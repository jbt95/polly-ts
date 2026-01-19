import { randomUUID } from 'crypto';
import type { CircuitState } from './circuit-breaker-policy';

/**
 * Interface for storing Circuit Breaker state.
 */
export interface CircuitBreakerStateStore {
  /**
   * Gets the current state of the circuit.
   */
  getState(): Promise<CircuitState>;

  /**
   * Records a success.
   * @param correlationId Correlation ID of the request
   * @returns true if state changed
   */
  recordSuccess(correlationId: string): Promise<boolean>;

  /**
   * Records a failure.
   * @param correlationId Correlation ID of the request
   * @returns true if state changed
   */
  recordFailure(correlationId: string): Promise<boolean>;

  /**
   * Manually transitions to a new state.
   */
  setState(state: CircuitState, correlationId: string): Promise<void>;

  /**
   * Gets the timestamp when the circuit opened (if open).
   */
  getOpenedAt(): Promise<number | undefined>;
}

/**
 * In-memory implementation of CircuitBreakerStateStore.
 */
export class MemoryStateStore implements CircuitBreakerStateStore {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private openedAt = 0;

  constructor(
    private readonly failureThreshold: number,
    private readonly breakDuration: number,
    private readonly successThreshold: number,
  ) {}

  async getState(): Promise<CircuitState> {
    if (this.state === 'open') {
      const now = Date.now();
      if (now >= this.openedAt + this.breakDuration) {
        await this.setState('halfOpen', randomUUID());
      }
    }
    return this.state;
  }

  async recordSuccess(correlationId: string): Promise<boolean> {
    if (this.state === 'halfOpen') {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.successThreshold) {
        await this.setState('closed', correlationId);
        return Promise.resolve(true);
      }
    } else {
      this.consecutiveFailures = 0;
    }
    return Promise.resolve(false);
  }

  async recordFailure(_correlationId: string): Promise<boolean> {
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;

    if (this.state === 'halfOpen') {
      await this.openCircuit(_correlationId);
      return Promise.resolve(true);
    } else if (this.state === 'closed' && this.consecutiveFailures >= this.failureThreshold) {
      await this.openCircuit(_correlationId);
      return Promise.resolve(true);
    }

    return Promise.resolve(false);
  }

  setState(state: CircuitState, _correlationId: string): Promise<void> {
    if (state === 'closed') {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
    } else if (state === 'open') {
      this.openedAt = Date.now();
    }
    this.state = state;
    return Promise.resolve();
  }

  getOpenedAt(): Promise<number | undefined> {
    return Promise.resolve(this.state === 'open' ? this.openedAt : undefined);
  }

  private async openCircuit(correlationId: string): Promise<void> {
    await this.setState('open', correlationId);
  }
}

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

  getState(): Promise<CircuitState> {
    if (this.state === 'open') {
      const now = Date.now();
      if (now >= this.openedAt + this.breakDuration) {
        // Transition logic should ideally be here or caller?
        // Since get is async, we can mutate state here (lazy evaluation)
        this.setState('halfOpen', crypto.randomUUID());
      }
    }
    return Promise.resolve(this.state);
  }

  recordSuccess(correlationId: string): Promise<boolean> {
    if (this.state === 'halfOpen') {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.successThreshold) {
        this.setState('closed', correlationId);
        return Promise.resolve(true);
      }
    } else {
      this.consecutiveFailures = 0;
    }
    return Promise.resolve(false);
  }

  recordFailure(_correlationId: string): Promise<boolean> {
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;

    if (this.state === 'halfOpen') {
      this.openCircuit(_correlationId);
      return Promise.resolve(true);
    } else if (this.state === 'closed' && this.consecutiveFailures >= this.failureThreshold) {
      this.openCircuit(_correlationId);
      return Promise.resolve(true);
    }

    return Promise.resolve(false);
  }

  setState(state: CircuitState, _correlationId: string): void {
    if (state === 'closed') {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
    } else if (state === 'open') {
      this.openedAt = Date.now();
    }
    this.state = state;
  }

  getOpenedAt(): number | undefined {
    return this.state === 'open' ? this.openedAt : undefined;
  }

  private openCircuit(correlationId: string): void {
    this.setState('open', correlationId);
  }
}

import { randomUUID } from 'crypto';
import type { CircuitState } from './circuit-breaker-policy';

/**
 * Interface for storing and managing Circuit Breaker state.
 *
 * The state store is responsible for tracking failures, successes, and managing
 * state transitions according to the circuit breaker pattern. Implementations
 * can be in-memory (single process) or distributed (Redis, database) for
 * multi-process coordination.
 *
 * **Circuit Breaker State Machine:**
 * ```
 *                  ┌──────────────────────────────────────────────┐
 *                  │                                              │
 *                  ▼                                              │
 *              ┌───────┐  failure threshold   ┌──────┐   break    │
 *   start ──▶  │ CLOSED │ ──────────────────▶ │ OPEN │ ─duration─┐│
 *              └───────┘                      └──────┘           ││
 *                  ▲                              │               ││
 *                  │  success threshold      ┌────────┐          ▼│
 *                  └───────────────────────  │HALFOPEN│ ◀────────┘│
 *                                            └────────┘           │
 *                                                │  failure       │
 *                                                └─────────────────┘
 * ```
 *
 * **State Descriptions:**
 * - `closed`: Normal operation, requests flow through
 * - `open`: Circuit is tripped, requests fail fast
 * - `halfOpen`: Testing if the service has recovered
 * - `isolated`: Manually opened, won't auto-recover
 *
 * @example
 * ```typescript
 * // Custom distributed state store
 * class RedisStateStore implements CircuitBreakerStateStore {
 *   constructor(private redis: RedisClient, private key: string) {}
 *
 *   async getState(): Promise<CircuitState> {
 *     const state = await this.redis.get(`${this.key}:state`);
 *     return (state as CircuitState) || 'closed';
 *   }
 *   // ... implement other methods
 * }
 * ```
 */
export interface CircuitBreakerStateStore {
  /**
   * Gets the current state of the circuit.
   *
   * Implementations should check if the break duration has elapsed when in
   * the `open` state and automatically transition to `halfOpen` if so.
   *
   * @returns The current circuit state.
   */
  getState(): Promise<CircuitState>;

  /**
   * Records a successful operation.
   *
   * **State Transition Rules:**
   * - In `halfOpen`: Increments success counter; if threshold reached, transitions to `closed`
   * - In `closed`: Resets consecutive failure counter (no state change)
   * - In `open` or `isolated`: No effect
   *
   * @param correlationId - Unique identifier for tracing/logging.
   * @returns `true` if the state changed (e.g., halfOpen → closed), `false` otherwise.
   */
  recordSuccess(correlationId: string): Promise<boolean>;

  /**
   * Records a failed operation.
   *
   * **State Transition Rules:**
   * - In `closed`: Increments failure counter; if threshold reached, transitions to `open`
   * - In `halfOpen`: Immediately transitions back to `open`
   * - In `open` or `isolated`: No effect
   *
   * @param correlationId - Unique identifier for tracing/logging.
   * @returns `true` if the state changed (e.g., closed → open), `false` otherwise.
   */
  recordFailure(correlationId: string): Promise<boolean>;

  /**
   * Manually sets the circuit state.
   *
   * Used for programmatic control (e.g., isolation, manual reset).
   * Resets counters appropriately when transitioning to `closed`.
   *
   * @param state - The target state.
   * @param correlationId - Unique identifier for tracing/logging.
   */
  setState(state: CircuitState, correlationId: string): Promise<void>;

  /**
   * Gets the timestamp when the circuit entered the `open` state.
   *
   * Used to calculate if the break duration has elapsed.
   *
   * @returns Unix timestamp (ms) when opened, or `undefined` if not in `open` state.
   */
  getOpenedAt(): Promise<number | undefined>;
}

/**
 * In-memory implementation of CircuitBreakerStateStore.
 *
 * Stores circuit breaker state in memory with threshold-based transitions.
 * Suitable for single-process applications. For distributed systems, implement
 * a custom store backed by Redis or a database.
 *
 * **Characteristics:**
 * - Thread-safe within single Node.js process (async/await)
 * - Lost on process restart (circuit resets to closed)
 * - Not shared between processes/instances
 *
 * @example
 * ```typescript
 * const store = new MemoryStateStore(
 *   5,     // Open after 5 consecutive failures
 *   30000, // Stay open for 30 seconds
 *   3,     // Close after 3 consecutive successes in half-open
 * );
 *
 * const policy = new CircuitBreakerPolicy({
 *   stateStore: store,
 * });
 * ```
 */
export class MemoryStateStore implements CircuitBreakerStateStore {
  /** Current circuit state. */
  private state: CircuitState = 'closed';

  /** Count of consecutive failures (resets on success or state change). */
  private consecutiveFailures = 0;

  /** Count of consecutive successes in half-open state. */
  private consecutiveSuccesses = 0;

  /** Timestamp when the circuit was opened. */
  private openedAt = 0;

  /**
   * Creates a new MemoryStateStore.
   *
   * @param failureThreshold - Number of consecutive failures to open the circuit.
   * @param breakDuration - Duration in ms to stay open before transitioning to half-open.
   * @param successThreshold - Number of consecutive successes in half-open to close the circuit.
   */
  constructor(
    private readonly failureThreshold: number,
    private readonly breakDuration: number,
    private readonly successThreshold: number,
  ) {}

  /**
   * Gets the current state, auto-transitioning from open to half-open if break duration elapsed.
   *
   * @returns The current circuit state.
   */
  async getState(): Promise<CircuitState> {
    if (this.state === 'open') {
      const now = Date.now();
      if (now >= this.openedAt + this.breakDuration) {
        await this.setState('halfOpen', randomUUID());
      }
    }
    return this.state;
  }

  /**
   * Records a successful operation, potentially closing the circuit.
   *
   * @param correlationId - Unique identifier for tracing.
   * @returns `true` if state changed to closed, `false` otherwise.
   */
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

  /**
   * Records a failed operation, potentially opening the circuit.
   *
   * @param _correlationId - Unique identifier for tracing.
   * @returns `true` if state changed to open, `false` otherwise.
   */
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

  /**
   * Manually sets the circuit state.
   *
   * @param state - The target state.
   * @param _correlationId - Unique identifier for tracing.
   */
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

  /**
   * Gets the timestamp when the circuit was opened.
   *
   * @returns Unix timestamp (ms) or `undefined` if not open.
   */
  getOpenedAt(): Promise<number | undefined> {
    return Promise.resolve(this.state === 'open' ? this.openedAt : undefined);
  }

  /**
   * Internal helper to transition to open state.
   *
   * @param correlationId - Unique identifier for tracing.
   */
  private async openCircuit(correlationId: string): Promise<void> {
    await this.setState('open', correlationId);
  }
}

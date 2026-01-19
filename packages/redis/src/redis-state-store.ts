import type { Redis } from 'ioredis';
import type { CircuitBreakerStateStore, CircuitState } from 'polly-ts-core';

/**
 * Options for configuring the RedisStateStore.
 */
export interface RedisStateStoreOptions {
  /**
   * The Redis client instance to use.
   */
  client: Redis;

  /**
   * Optional prefix for Redis keys. Default: 'polly:cb'.
   */
  prefix?: string;

  /**
   * The unique name of the Circuit Breaker.
   */
  name: string;

  /**
   * The number of failures required to open the Circuit Breaker.
   */
  failThreshold: number;

  /**
   * The duration (in milliseconds) the Circuit Breaker remains open.
   */
  breakDuration: number;

  /**
   * The number of successes required to close the Circuit Breaker from half-open state.
   */
  successThreshold: number;
}

/**
 * A Redis-backed state store for managing the state of a Circuit Breaker.
 * This implementation uses Redis to persist and manage the state transitions
 * of a Circuit Breaker, ensuring distributed consistency.
 */
export class RedisStateStore implements CircuitBreakerStateStore {
  private readonly redis: Redis;
  private readonly key: string;
  private readonly failThreshold: number;
  private readonly breakDuration: number;
  private readonly successThreshold: number;

  /**
   * Creates a new RedisStateStore instance.
   *
   * @param options Configuration options for the Redis state store.
   */
  constructor(options: RedisStateStoreOptions) {
    this.redis = options.client;
    this.key = `${options.prefix ?? 'polly:cb'}:${options.name}`;
    this.failThreshold = options.failThreshold;
    this.breakDuration = options.breakDuration;
    this.successThreshold = options.successThreshold;
  }

  /**
   * Retrieves the current state of the Circuit Breaker.
   *
   * @returns The current state of the Circuit Breaker ('closed', 'open', or 'halfOpen').
   */
  async getState(): Promise<CircuitState> {
    const now = Date.now();
    // Lua script to check state and transition open -> halfOpen if needed
    const script = `
      local key = KEYS[1]
      local breakDuration = tonumber(ARGV[1])
      local now = tonumber(ARGV[2])
      
      local state = redis.call('HGET', key, 'state')
      local openedAt = tonumber(redis.call('HGET', key, 'openedAt') or '0')

      if state == 'open' and (now >= (openedAt + breakDuration)) then
        redis.call('HSET', key, 'state', 'halfOpen')
        return 'halfOpen'
      end

      return state or 'closed'
    `;

    const state = await this.redis.eval(script, 1, this.key, this.breakDuration, now);
    return state as CircuitState;
  }

  /**
   * Records a successful execution and updates the Circuit Breaker state if necessary.
   *
   * @param _correlationId The correlation ID for the operation (not used in this implementation).
   * @returns `true` if the state transitioned to 'closed', otherwise `false`.
   */
  async recordSuccess(_correlationId: string): Promise<boolean> {
    const script = `
      local key = KEYS[1]
      local successThreshold = tonumber(ARGV[1])
      
      local state = redis.call('HGET', key, 'state') or 'closed'

      if state == 'halfOpen' then
        local successes = redis.call('HINCRBY', key, 'successes', 1)
        if tonumber(successes) >= successThreshold then
          redis.call('HSET', key, 'state', 'closed')
          redis.call('HSET', key, 'failures', 0)
          redis.call('HSET', key, 'successes', 0)
          return 1 -- Changed to closed
        end
      elseif state == 'closed' then
        redis.call('HSET', key, 'failures', 0) -- Reset failures on success in closed state
      end

      return 0 -- No state change
    `;

    const result = await this.redis.eval(script, 1, this.key, this.successThreshold);
    return result === 1;
  }

  /**
   * Records a failed execution and updates the Circuit Breaker state if necessary.
   *
   * @param _correlationId The correlation ID for the operation (not used in this implementation).
   * @returns `true` if the state transitioned to 'open', otherwise `false`.
   */
  async recordFailure(_correlationId: string): Promise<boolean> {
    const now = Date.now();
    const script = `
      local key = KEYS[1]
      local failThreshold = tonumber(ARGV[1])
      local now = tonumber(ARGV[2])

      local state = redis.call('HGET', key, 'state') or 'closed'

      if state == 'closed' then
        local failures = redis.call('HINCRBY', key, 'failures', 1)
        if tonumber(failures) >= failThreshold then
          redis.call('HSET', key, 'state', 'open')
          redis.call('HSET', key, 'openedAt', now)
          return 1 -- Changed to open
        end
      elseif state == 'halfOpen' then
        -- Fail immediately in half-open
        redis.call('HSET', key, 'state', 'open')
        redis.call('HSET', key, 'openedAt', now)
        return 1 -- Changed to open
      end

      return 0 -- No state change
    `;

    const result = await this.redis.eval(script, 1, this.key, this.failThreshold, now);
    return result === 1;
  }

  /**
   * Sets the state of the Circuit Breaker.
   *
   * @param state The new state to set ('closed', 'open', or 'halfOpen').
   * @param _correlationId The correlation ID for the operation (not used in this implementation).
   */
  async setState(state: CircuitState, _correlationId: string): Promise<void> {
    const now = Date.now();
    const pipeline = this.redis.pipeline();

    pipeline.hset(this.key, 'state', state);

    if (state === 'open') {
      pipeline.hset(this.key, 'openedAt', now);
    } else if (state === 'closed') {
      pipeline.hset(this.key, 'failures', 0);
      pipeline.hset(this.key, 'successes', 0);
    }

    await pipeline.exec();
  }

  /**
   * Retrieves the timestamp (in milliseconds) when the Circuit Breaker was last opened.
   *
   * @returns The timestamp when the Circuit Breaker was last opened, or `undefined` if not available.
   */
  async getOpenedAt(): Promise<number | undefined> {
    const openedAt = await this.redis.hget(this.key, 'openedAt');
    return openedAt ? parseInt(openedAt, 10) : undefined;
  }
}

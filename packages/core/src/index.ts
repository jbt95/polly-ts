// polly-ts-core
// A comprehensive resilience and transient fault handling library for TypeScript

// Types
export type {
  IPolicy,
  PolicyOptions,
  ExecutionContext,
  ExecutionResult,
  SuccessEventArgs,
  FailureEventArgs,
  PolicyEvent,
  PolicyEventListener,
} from './types/index';
export { PolicyEventEmitter } from './types/index';
export { createExecutionContext } from './types/context';

// Errors
export {
  PolicyError,
  TimeoutError,
  CircuitOpenError,
  BulkheadRejectedError,
  RateLimitRejectedError,
} from './errors/index';

// Policies
export {
  RetryPolicy,
  ConstantBackoff,
  ExponentialBackoff,
  ExponentialBackoffWithJitter,
  CustomBackoff,
  TimeoutPolicy,
  CircuitBreakerPolicy,
  FallbackPolicy,
  BulkheadPolicy,
  CachePolicy,
  MemoryCacheProvider,
  HedgingPolicy,
  RateLimiterPolicy,
  TokenBucketStrategy,
  PolicyWrap,
  pipeline,
  MemoryStateStore,
} from './policies/index';

export type {
  RetryPolicyOptions,
  RetryPredicate,
  ResultPredicate,
  RetryEventArgs,
  BackoffStrategy,
  ConstantBackoffOptions,
  ExponentialBackoffOptions,
  ExponentialBackoffWithJitterOptions,
  JitterType,
  TimeoutPolicyOptions,
  TimeoutStrategy,
  TimeoutEventArgs,
  CircuitBreakerPolicyOptions,
  CircuitState,
  CircuitStateChangeEventArgs,
  FailurePredicate,
  ResultFailurePredicate,
  FallbackPolicyOptions,
  FallbackPredicate,
  FallbackResultPredicate,
  FallbackFactory,
  FallbackEventArgs,
  BulkheadPolicyOptions,
  BulkheadRejectEventArgs,
  CachePolicyOptions,
  CacheHitEventArgs,
  CacheMissEventArgs,
  ICacheProvider,
  HedgingPolicyOptions,
  HedgeEventArgs,
  RateLimiterPolicyOptions,
  IRateLimiterStrategy,
  TokenBucketOptions,
  CircuitBreakerStateStore,
} from './policies/index';

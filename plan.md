Polly-TS Feature Plan
Vision
A comprehensive resilience and transient fault handling library for TypeScript/Node.js that matches Polly's capabilities while embracing TypeScript idioms and the async-first nature of the Node.js ecosystem.

Core Principles

Type safety — Full inference from policy configuration to execution result
Composability — Policies combine predictably with clear execution order
Observability — First-class telemetry, metrics, and debugging support
Zero dependencies — Core library has no external dependencies
Framework agnostic — Works with any HTTP client, database driver, or async operation
Testability — Deterministic behavior, injectable clocks, mockable state

Package Structure
@polly-ts/core — Core policies and composition
@polly-ts/telemetry — OpenTelemetry integration
@polly-ts/redis — Distributed state (circuit breaker, rate limiter)
@polly-ts/testing — Test utilities, fake timers, chaos injection
@polly-ts/http — HTTP-specific policies and fetch/axios wrappers

Phase 1: Core Policies
1.1 Retry
Strategies:

Constant delay
Linear backoff
Exponential backoff
Exponential backoff with jitter (decorrelated jitter, full jitter, equal jitter)
Custom backoff function

Configuration:

Maximum attempts
Maximum total duration (time-boxed retry)
Per-attempt timeout
Retry predicate (which errors to retry)
Result predicate (retry on specific return values, not just exceptions)
Before/after retry hooks

Behavior:

Sleepless retry for testing (injectable delay function)
Attempt counting (1-indexed, matching Polly)
Context propagation through attempts

1.2 Circuit Breaker
States:

Closed (normal operation)
Open (failing fast)
Half-open (testing recovery)
Isolated (manually opened)

Configuration:

Failure threshold (count-based)
Failure rate threshold (percentage-based over sampling window)
Sampling duration (sliding window)
Minimum throughput (don't trip on low traffic)
Break duration
Success threshold for half-open → closed
Failure predicate (which errors count as failures)
Result predicate (which return values count as failures)

Behavior:

State change events
Manual isolation and reset
State inspection (current state, failure count, last failure time)
Half-open concurrency control (limit concurrent test requests)

1.3 Timeout
Strategies:

Optimistic timeout (cooperative cancellation via AbortSignal)
Pessimistic timeout (race with rejection, operation continues in background)

Configuration:

Duration (static or dynamic based on context)
Timeout predicate (apply timeout conditionally)
Timeout event hook

Behavior:

AbortController integration for cancellable operations
Proper cleanup signaling
Nested timeout handling

1.4 Fallback
Configuration:

Fallback value (static)
Fallback function (dynamic, receives error and context)
Fallback async function (fetch from cache, secondary service)
Fallback predicate (which errors trigger fallback)
Result predicate (which return values trigger fallback)

Behavior:

Fallback on exception
Fallback on result (e.g., null, empty array)
Chained fallbacks (primary → secondary → tertiary)

1.5 Bulkhead
Strategies:

Semaphore-based (concurrency limiter)
Thread-pool-based (not applicable to Node.js single thread, but useful for worker pools)

Configuration:

Maximum concurrent executions
Maximum queue depth
Queue timeout (how long to wait in queue)
Rejection event hook

Behavior:

Fair queuing (FIFO)
Priority queuing (optional)
Active count and queue length inspection
Graceful drain (stop accepting, wait for completion)

1.6 Rate Limiter
Strategies:

Fixed window
Sliding window (log-based)
Sliding window (counter-based)
Token bucket
Leaky bucket

Configuration:

Requests per window
Window duration
Burst allowance (token bucket)
Queue behavior (reject vs queue)
Per-key limiting (e.g., per user, per endpoint)

Behavior:

Remaining capacity inspection
Time until next permit
Distributed state support (Redis backend)

1.7 Cache
Strategies:

Cache-aside (read-through)
Write-through
Write-behind (async write)

Configuration:

Cache key generator
TTL (static or dynamic)
Stale-while-revalidate duration
Cache predicate (what to cache)
Serialization strategy

Behavior:

Cache hit/miss events
Background refresh
Cache stampede prevention (single-flight)
Negative caching (cache failures)

1.8 Hedging
Strategies:

Parallel hedging (fire N requests simultaneously)
Latency-based hedging (fire backup after delay)
Rate-limited hedging (limit hedge frequency)

Configuration:

Hedge delay (time before firing backup)
Maximum hedge attempts
Hedge predicate (when to hedge)
Result selector (how to pick winner)

Behavior:

Cancellation of losing requests
Resource cleanup
Cost tracking (how many hedges fired)

Phase 2: Policy Composition
2.1 Policy Wrapping
Behavior:

Wrap policies in execution order (outer executes first)
Type preservation through composition
Short-circuit propagation (circuit breaker open stops inner policies)

API:

wrap(outer, inner) — Binary composition
wrap(...policies) — Variadic composition
policy.wrap(inner) — Fluent composition

2.2 Policy Pipeline
Concept:

Named policy stages
Conditional policy application
Dynamic policy selection at runtime

Configuration:

Stage ordering
Stage conditions (apply retry only for idempotent operations)
Stage overrides (replace timeout for specific operations)

2.3 Policy Registry
Concept:

Centralized policy management
Named policies for reuse
Environment-specific configuration

Features:

Register policies by name
Retrieve policies by name
Override policies for testing
Policy inheritance (base policy + overrides)

Phase 3: Context and Execution
3.1 Execution Context
Built-in Properties:

Correlation ID
Operation key
Attempt number
Policy execution path
Start time
Cancellation token

Extensibility:

Custom context properties
Context inheritance (parent → child)
Context isolation (no mutation)

3.2 Execution Result
Properties:

Success/failure indicator
Result value
Final exception
Outcome reason (success, failure, timeout, circuitBroken, bulkheadRejected, rateLimited, hedged)
Attempt count
Total duration
Per-attempt durations
Policy execution trace

3.3 Cancellation
Integration:

Native AbortController/AbortSignal support
Cancellation propagation through policy chain
Cleanup callbacks on cancellation

Behavior:

Cancel pending retries
Cancel queued bulkhead requests
Cancel hedge attempts

Phase 4: Observability
4.1 Events
Policy Events:

onRetry — Before each retry attempt
onCircuitStateChange — Circuit state transitions
onTimeout — Operation timed out
onFallback — Fallback triggered
onBulkheadReject — Request rejected by bulkhead
onRateLimitReject — Request rejected by rate limiter
onCacheHit / onCacheMiss — Cache operations
onHedge — Hedge request fired

Execution Events:

onExecutionStart — Before policy execution
onExecutionSuccess — Successful completion
onExecutionFailure — Failed completion

4.2 Metrics
Counter Metrics:

Executions (total, success, failure)
Retries (total, exhausted)
Circuit breaker trips
Timeouts
Fallback activations
Bulkhead rejections
Rate limit rejections
Cache hits/misses
Hedge attempts

Gauge Metrics:

Circuit breaker state
Bulkhead active count
Bulkhead queue depth
Rate limiter remaining permits

Histogram Metrics:

Execution duration
Queue wait time
Retry attempt count distribution

4.3 Telemetry Integration
OpenTelemetry:

Span creation per policy execution
Span attributes (policy type, outcome, attempts)
Span events (retry, state change, fallback)
Baggage propagation through context
Metric instrument creation

Custom Telemetry:

Pluggable telemetry interface
Adapter pattern for other systems (Datadog, New Relic, Prometheus)

4.4 Logging
Structured Logging:

Policy execution start/end
State changes
Failure details
Retry attempts

Integration:

Pluggable logger interface
Pino adapter
Winston adapter
Console adapter (development)

Phase 5: Distributed Resilience
5.1 Distributed Circuit Breaker
State Storage:

Redis backend
Custom backend interface

Behavior:

Shared state across instances
Atomic state transitions
Lease-based ownership (prevent split-brain)
Graceful degradation (local-only if Redis unavailable)

5.2 Distributed Rate Limiter
Strategies:

Redis-based sliding window
Redis-based token bucket
Lua script for atomicity

Behavior:

Cluster-wide rate limiting
Per-key partitioning
Synchronization strategies (strict vs eventual)

5.3 Distributed Caching
Integration:

Redis cache backend
Memcached cache backend
Multi-tier caching (local + distributed)

Behavior:

Serialization configuration
Compression
Cache invalidation patterns

Phase 6: HTTP Integration
6.1 HTTP-Specific Policies
Retry Conditions:

Retry on 5xx status codes
Retry on network errors
Retry on specific status codes (429, 503)
No retry on 4xx (client errors)

Timeout:

Connection timeout
Request timeout
Response timeout

Circuit Breaker:

Trip on 5xx rate
Ignore 4xx for failure counting

6.2 Fetch Integration
Wrapper:

resilientFetch(url, options, policy) — Drop-in fetch replacement
Request/response interceptors
Automatic retry-after header handling

6.3 Axios Integration
Wrapper:

Axios interceptor-based integration
Request config per policy
Response transformation

6.4 Other HTTP Clients
Adapters:

Got
Undici
Node.js native http/https

Phase 7: Testing Utilities
7.1 Fake Timers
Features:

Controlled time advancement
Deterministic retry timing
Circuit breaker duration testing

Integration:

Jest fake timers compatibility
Vitest fake timers compatibility
Standalone fake timer implementation

7.2 Policy Mocks
Features:

Mock policy that records calls
Configurable success/failure sequences
Assertion helpers (called N times, with context)

7.3 Chaos Injection
Fault Types:

Exception injection (throw specific errors)
Latency injection (add artificial delay)
Result injection (return specific values)
Behavior injection (custom fault logic)

Configuration:

Injection rate (percentage of requests)
Injection predicate (conditional injection)
Deterministic mode (seeded random for reproducibility)

7.4 Scenario Testing
Helpers:

Simulate circuit breaker trip and recovery
Simulate retry exhaustion
Simulate bulkhead saturation
Simulate rate limit exhaustion

Phase 8: Developer Experience
8.1 Fluent Builder API
Features:

Method chaining for policy construction
IntelliSense-friendly configuration
Validation at build time

8.2 Declarative Configuration
Features:

JSON/YAML policy definitions
Environment variable interpolation
Schema validation

8.3 Debugging
Features:

Execution trace logging
Policy decision explanation
Visual execution timeline (dev tools integration)

8.4 Documentation
Content:

Getting started guide
Policy-by-policy documentation
Composition patterns
Best practices
Migration guide from other libraries
API reference

Phase 9: Advanced Features
9.1 Reactive Policies
Concept:

Policies that respond to external signals
Dynamic configuration updates
Health check integration

Examples:

Increase timeout during known slow periods
Reduce rate limit when downstream is degraded
Open circuit based on external health signal

9.2 Adaptive Policies
Concept:

Self-tuning policies based on observed behavior
Machine learning integration (optional)

Examples:

Adaptive retry delay based on success rate
Adaptive circuit breaker thresholds
Adaptive rate limiting based on latency

9.3 Policy Inheritance
Concept:

Base policies with environment-specific overrides
Hierarchical configuration (global → service → operation)

9.4 Multi-Tenancy
Concept:

Per-tenant policy configuration
Tenant isolation for stateful policies
Tenant-aware metrics

Release Roadmap
v0.1.0 — MVP

Retry (basic backoff strategies)
Circuit Breaker (count-based)
Timeout (pessimistic)
Fallback
Bulkhead
Basic policy wrapping

v0.2.0 — Observability

Event hooks for all policies
Execution result with full metadata
Basic metrics interface

v0.3.0 — Advanced Policies

Rate Limiter (token bucket, sliding window)
Cache policy
Hedging

v0.4.0 — Telemetry

OpenTelemetry integration
Structured logging interface
Metrics adapters

v0.5.0 — Distributed

Redis circuit breaker
Redis rate limiter
Distributed cache backend

v0.6.0 — HTTP

Fetch wrapper
Axios integration
HTTP-specific retry conditions

v0.7.0 — Testing

Fake timers
Chaos injection
Policy mocks

v1.0.0 — Stable

API stabilization
Performance optimization
Comprehensive documentation
Production hardening

Success Metrics

Adoption — npm weekly downloads
Reliability — Issue volume and severity
Performance — Benchmark comparisons with alternatives
Developer satisfaction — GitHub stars, survey feedback
Ecosystem — Third-party integrations and adapters

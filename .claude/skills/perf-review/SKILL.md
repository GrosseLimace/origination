---
name: perf-review
description: Review code for performance risks such as N+1 queries, unnecessary Angular re-renders, blocking calls, over-fetching, expensive loops, and avoidable allocations. Use when the developer asks about slow code, performance hotspots, optimization opportunities, scalability risk, or wants a performance-focused review before release.
---

# Performance Review

Review the current scope for the highest-value performance problems.

## Workflow

### Phase 1: Explore

- Identify the scope: endpoint, feature, screen, service, query layer, or whole subsystem.
- Read the relevant local guides for the stack in scope.
- Inspect the hot path first: request flow, data access, rendering path, background work, or batch processing.
- For large repos, split the review into bounded hot-path batches and summarize each batch before moving on.
- If useful and supported, optionally use sub-agents to inspect disjoint hot paths in parallel. Do not require sub-agents.

### Phase 2: Findings

Look for performance-specific risks such as:

- N+1 queries or repeated database round trips
- one logical operation decomposed into repeated per-item outbound API calls
- over-fetching or loading too much data into memory
- missing caching on repeated, relatively static reads
- blocking or synchronous work on latency-sensitive paths
- repeated expensive computation in loops or render paths
- Angular change-detection churn, unnecessary recomputation, or template work
- broad object mapping or serialization costs on hot paths

Distinguish proven problems from likely risks.

### Phase 3: Proposal

Prioritize findings and proposed fixes by:

- impact on user-visible latency or throughput
- confidence that the issue is real
- size and safety of the likely fix

Present findings first, identify what is measured versus inferred, and wait for explicit user approval before changing code.

### Phase 4: Implement

Only after explicit user approval:

- fix the smallest high-impact issues first
- preserve behavior
- avoid speculative micro-optimizations

### Phase 5: Verify

Use the best deterministic evidence available:

- targeted benchmarks
- query inspection
- build/test coverage for the touched code
- existing telemetry or measured before/after output if available in the repo

Use regression testing after each approved fix batch and again at the end. If no measurement exists, say the finding is an inferred risk.

### Phase 6: Report

Summarize:

- confirmed bottlenecks
- inferred hotspots worth measuring
- recommended fixes in priority order
- what evidence was available vs missing

## Stop Conditions

- The performance claim depends on production telemetry not available locally.
- The likely fix would require broad architecture change without measurement.
- There is no clear hot path and the request is too broad for a credible review.

## References

- `style-guides/csharp-guide.md` when backend batching, caching, or outbound call design are central to the finding
- `style-guides/logging-guide.md` when telemetry, sampling, traces, Query Store, or Azure Monitor evidence drive the review
- `style-guides/sql-guide.md` when database query shape or indexing are central to the finding

# ADR-005 Production Infrastructure Deferred

## Status

Accepted for v0.5.0.

## Context

Queue, durable Writer execution, independent D1, authentication, billing and abuse protection would be required for a production SaaS, but the current goal is a validated AI product portfolio and demo.

## Decision

Defer production infrastructure. Preserve the current Sites environment and data; do not migrate or delete it during the portfolio release.

## Evidence

Latency investigation identified the application timeout boundary, and durable options were assessed. Product scope changed before implementation because creator research, usage frequency and cost limits remain unvalidated.

## Consequences

The project can communicate its actual product logic and experiments without implying production readiness. Synchronous execution and access limitations remain explicit.

## Alternatives considered

- Implement Queue and durable execution now: rejected as infrastructure ahead of validated product demand.
- Present the current demo as production-ready: rejected as inaccurate.

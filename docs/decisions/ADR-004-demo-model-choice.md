# ADR-004 DeepSeek Flash as the Portfolio Demo Writer Candidate

## Status

Accepted for the portfolio-demo target; not a production SLA decision.

## Context

Long V4-Pro Writer calls made a synchronous demo unreliable within the former application timeout window.

## Decision

Prefer DeepSeek Flash as the default Writer candidate for portfolio demonstrations, subject to the existing output contract and Validator. Existing hosted configuration is not silently replaced by this documentation release.

## Evidence

Flash created Candidates in all three dedicated demo stability runs. Durations were 66,224 ms, 56,083 ms and 56,716 ms. One Candidate was blocked for an internal time conflict.

## Consequences

The demo has a more practical latency profile while preserving safety checks. Three runs are not enough for reliability percentages, SLA, P95 or P99 claims.

## Alternatives considered

- Keep V4-Pro as the demo default: retained as a quality option, but less predictable for synchronous demonstrations.
- Change prompt or target length: rejected because the stability experiment froze both.

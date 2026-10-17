# ADR-003 Content Intelligence Remains Optional

## Status

Accepted for v0.5.0.

## Context

ContentPlan and Mechanism Retrieval were introduced as an experimental API/benchmark path to test promise-to-payoff conversion and structural causality in CREATE. The current v0.5.0 UI does not expose this path; ordinary UI CREATE uses Direct Writer.

## Decision

Content Intelligence is an Optional Structural Enhancement, not a proprietary narrative model or deterministic planning algorithm. One Planner LLM call returns a structured ContentPlan and mechanism IDs from an eight-item human-curated catalog. Program code applies a known-ID allowlist, deduplication, a maximum-five cap, persistence and traceability. The Writer receives the plan and selected mechanisms through its prompt; actual fulfillment remains model-mediated and is not deterministically verified.

It is appropriate to experiment with the path when an opening promise is strong but easily dropped, identity setup needs payoff, growth spans stages, or a Direct Writer draft leaves a setting outside the plot.

It is not forced when character capability is tightly constrained, the story is a single scene, the theme is already clear, or Direct Writer naturally develops the premise.

## Evidence

Human blind review preferred the enhanced path for the hidden-heir case and Direct Writer for the 17-year-old emperor and regret-vision cases.

## Consequences

The product avoids extra latency and over-structuring where planning adds little value. Future UX may expose a selective enhancement choice rather than a global default.

## Alternatives considered

- Always run Content Intelligence: rejected by blind-review results and latency cost.
- Remove it entirely: rejected because the hidden-heir case showed a useful promise-to-payoff improvement.

# ADR-001 Program Constraints over Prompt-only Control

## Status

Accepted for v0.5.0.

## Context

EXPAND, scoped REWRITE and CONTINUE become unsafe when a model is asked to preserve unrelated text through instructions alone. Duplicate sentences, full-text responses and stale source versions expose this weakness.

## Decision

The program owns selection ranges, merge/append behavior, output-kind contracts, source-version checks, Candidate isolation, content-hash binding and CAS adoption.

## Evidence

Wrapper Audit and L2 Hardening regression cases cover duplicate selections, full pretending to be segment, oversized output and source-version race.

## Consequences

Model flexibility is bounded by explicit operation contracts. More implementation logic is required, but removing model intelligence still leaves meaningful product behavior.

## Alternatives considered

- Prompt-only preservation: rejected because it cannot guarantee target scope.
- Full-document regeneration for every operation: rejected because unrelated text can drift.


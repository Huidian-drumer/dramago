# ADR-002 Semantic Validator as a Safety Layer

## Status

Accepted for v0.5.0.

## Context

The first Validator configuration preserved hard-conflict recall but blocked normal drafts too often.

## Decision

Validator protects adoption against evidenced hard conflicts. Blocking requires an allowed finding type, `severity=blocking`, sufficient confidence and concrete evidence. Style, pacing and inferred mechanism quality remain warnings or human-review concerns.

## Evidence

In a controlled 20-case regression, normal false blocking moved from 3/5 to 0/5 while 13/13 expected hard blocks were retained; two expected warnings remained warnings.

## Consequences

Authors can inspect warnings without losing a Candidate. The system still cannot claim general semantic accuracy, and normal drafts may receive non-blocking warnings.

## Alternatives considered

- Treat every detected issue as blocking: rejected as over-restrictive.
- Remove semantic validation: rejected because clear fact and hard-preserve conflicts should protect adoption.

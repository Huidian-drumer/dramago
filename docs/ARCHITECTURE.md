# DramaGo Architecture

## Scope

DramaGo v0.5.0 is a text-only creative workbench. The architecture separates model generation from program-owned editing, persistence and adoption rules.

## Execution pipeline

```text
Creative Brief
  → Operation Router
  → Writer
  → Output Contract
  → Programmatic Merge / Append
  → Semantic Validator
  → Candidate Version
  → CAS Adopt
```

CREATE may optionally add `ContentPlan → Mechanism Retrieval` before Writer. The enhanced path is not the default for every story.

## Model responsibilities

- Generate full text, a selected segment or a continuation.
- Perform limited semantic reasoning in the independent Validator.
- Extract lightweight Story Facts snapshots.

## Program responsibilities

- Resolve operation and target scope.
- Bind a selection by character range.
- Replace a range or append continuation deterministically.
- Enforce `full / segment / continuation` output contracts.
- Enforce response-size limits.
- Persist works, versions, tasks, facts and adoption events.
- Bind validation to Candidate ID and content hash.
- Compare source version and update through CAS.
- Keep Provider failures from changing the source work.

## Persistence

The workbench uses D1-compatible storage for works, versions, generation tasks, Story Facts snapshots and adoption events. GitHub Pages is documentation-only and contains no server-side Provider secret.

## Trust boundary

Prompt instructions improve model behavior but do not replace program checks. Semantic validation is probabilistic; scope, merge, version and adoption safety are enforced by code.

## Current limitation

PLAN, WRITE and VALIDATE are staged, but long Writer calls still use synchronous HTTP execution. Durable async execution is a future productization option, not part of v0.5.0.


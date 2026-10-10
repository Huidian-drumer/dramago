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
  → Candidate Version
  → Separate model-assisted Semantic Validator
  → Checks + Story Facts Snapshot
  → CAS Adopt

Next validation:
Source Story Facts Snapshot → Semantic Validator
```

CREATE may optionally add `ContentPlan → Mechanism Retrieval` before Writer through the API-level experimental path. The v0.5.0 UI does not expose this toggle; UI CREATE uses Direct Writer.

## Model responsibilities

- Generate full text, a selected segment or a continuation.
- Generate a structured ContentPlan and select mechanism IDs when the experimental path is explicitly requested.
- Perform limited semantic reasoning in a separate Validator call, including facts, timeline, outcomes and internal consistency.
- Extract lightweight, version/hash-bound Story Facts snapshots during validation.

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
- Allowlist and deduplicate known mechanism IDs, cap the selection at five, then persist and trace the selected IDs.

## Persistence

The workbench uses D1-compatible storage for works, versions, generation tasks, Story Facts snapshots and adoption events. GitHub Pages is documentation-only and contains no server-side Provider secret.

## Trust boundary

Prompt instructions improve model behavior but do not replace program checks. Semantic validation is model-assisted and probabilistic. The program enforces finding-type allowlists, severity, confidence and evidence requirements, source priority, hash binding, `can_auto_apply` and CAS adoption. It does not establish an independent truth engine.

## Story Facts boundary

Story Facts in v0.5.0 are version/hash-bound validation fact snapshots, not a Narrative Memory or Writer Memory system. The Validator extracts source and candidate facts, the program normalizes and stores them, and later validation stages may read them. The Writer does not consume Story Facts directly; it receives the CreativeBrief, context, source-version full text and, when explicitly enabled, ContentPlan and selected mechanisms.

## Current runtime

- `worker/`: API routing, provider calls, merge, validation and adoption controls.
- `web/`: current author workbench UI.
- `db/`: current persistence schema.

These directories form the v0.5.0 authoring runtime.

## Legacy / historical components

- `script-writer/`: retained Script Writer V0.1 experiment with a separate WritingPacket, local-test persistence and legacy validation stack; it is not imported by the current Worker.
- `/experience`: retained interactive prototype built from legacy sources under `dist/`; it does not share the current authoring pipeline and is not the recommended entry.
- `dist/` and `drizzle/meta/`: generated release and migration artifacts, not independent source architectures.

## Current limitation

PLAN, WRITE and VALIDATE are staged, but long Writer calls still use synchronous HTTP execution. Durable async execution is a future productization option, not part of v0.5.0.

# DramaGo v0.5.0 Capability Boundaries

This document separates program guarantees from model-mediated behavior for the public v0.5.0 snapshot. It is the primary reference for interpreting product claims.

## What the program guarantees

- Duplicate-safe selection by character range rather than first-match text search.
- Programmatic selected-range replacement and continuation append.
- `full`, `segment` and `continuation` output-kind contracts.
- Central response and content-size limits.
- Candidate isolation: generated text does not directly overwrite the current version.
- Source-version rechecks and compare-and-swap adoption.
- Candidate/check binding by version ID and content hash.
- Stage/task state, idempotent stage recovery and explicit Provider failure states.
- Evidence-bound validation gating before `can_auto_apply`.

These guarantees control how output moves through the workbench. They do not guarantee that generated prose is correct, original, enjoyable or commercially successful.

## What the model provides

- Creative text generation and instruction interpretation.
- ContentPlan generation and mechanism-ID selection when the experimental CREATE path is explicitly requested.
- Semantic judgments about facts, timeline, required outcomes, hard-preserve constraints and internal consistency.
- Source and candidate Story Facts extraction during validation.

These behaviors remain probabilistic and Provider/model dependent.

## What Story Facts are

Story Facts are **version/hash-bound validation fact snapshots**. The Validator LLM returns `source_story_facts` and `candidate_story_facts`; the program normalizes and persists them with their version and content hash. Later validation stages may reuse a source snapshot.

> **IMPORTANT — Story Facts in v0.5.0 are validation snapshots, not a Narrative Memory system. They are extracted by the Validator, bound to a version and content hash, and reused by later validation stages. The Writer does not consume Story Facts directly.**

Writer 直接接收 CreativeBrief、context、source version 完整正文，以及显式启用实验路径时的 ContentPlan 和 selected mechanisms。当前 Writer 不读取 Story Facts。

## What Story Facts are not

They are not Narrative Memory, Writer Memory, long-term generation memory, a knowledge graph, a complete character-state engine or a Story Facts-driven Writer. User-authorized rewrites may supersede older facts.

## What Content Intelligence is

Content Intelligence V0.1 is an **experimental, API-level optional structural enhancement** for CREATE. It uses:

1. one Planner LLM call;
2. a structured ContentPlan;
3. an eight-item human-curated mechanism catalog;
4. mechanism IDs returned by the Planner;
5. programmatic known-ID allowlisting, deduplication, a maximum-five cap, persistence and traceability;
6. prompt delivery of the plan and selected mechanisms to the Writer.

Benchmarks and experiments have exercised this path. Human blind A/B showed selective—not universal—benefit.

## What Content Intelligence is not

It is not the default CREATE pipeline, a proprietary narrative model, causal-graph search, a constraint solver or a narrative-scoring algorithm. The program does not deterministically verify that the Writer fulfills a selected mechanism. Mechanism selection and Writer fulfillment remain model-mediated.

## What the Semantic Validator can enforce

The Semantic Validator is a **separate model-assisted semantic-validation stage with programmatic enforcement**. The model call judges facts, timeline, outcomes and internal consistency. Program code decides whether a finding may block by enforcing:

- finding-type allowlist;
- severity;
- confidence threshold;
- non-empty evidence;
- source priority;
- candidate/version and content-hash binding;
- `can_auto_apply`;
- CAS adoption.

## What the Semantic Validator cannot guarantee

The Validator may use the same Provider and can fall back to the same model as the Writer. It is not an independent truth engine, formal proof, comprehensive contradiction detector or literary-quality judge. An unavailable Validator is recorded as unavailable rather than passed. Small controlled regressions do not establish general semantic accuracy.

## Meaning of project-specific L2

“L2” is the DramaGo **project-specific Wrapper maturity rubric**, not an industry standard or certification:

| Level | Project-specific meaning |
| --- | --- |
| L0 | UI → Prompt → LLM → Text |
| L1 | Different prompts/templates and persistence, with scope mainly left to model compliance |
| L2 | Programmatic scope, version, candidate, merge/adopt and failure protection |
| L3 | Reliable domain state, semantic impact analysis and continuous memory |
| L4 | Reference/feedback learning and large-scale diversity control |

The v0.5.0 red-team classification is a domain-adapted L2 AI text-editing workflow with model-mediated semantics. It is not L3 and does not claim a proprietary AI engine.

## Meaning of Validated Portfolio MVP

“Validated” refers to engineering workflow validation, controlled real-model experiments and a small-sample human blind review. It does **not** mean market validation, large-scale creator validation, production-reliability validation, an SLA or statistical proof that one content pipeline is superior.

## Current UI-accessible features

- Work creation and manual saving.
- CREATE through Direct Writer.
- EXPAND and selection REWRITE through character-range selection.
- Full REWRITE and CONTINUE.
- Candidate inspection, validation state and adopt controls.
- Version history and retry-safe failure visibility.

## API / experiment-only features

- Content Intelligence V0.1 can be requested through the backend API and has been used by benchmark runners.
- It is **not exposed as a toggle in the v0.5.0 UI**; current UI CREATE does not send `create_pipeline=content_intelligence_v0.1`.
- Validator fixture endpoints and benchmark runners are audit/test surfaces, not end-user authoring features.

## Current legacy components

- `script-writer/`: Script Writer V0.1, retained for provenance and historical tests; separate WritingPacket, local-test persistence and legacy validation stack.
- `/experience`: retained interactive prototype; it does not share the current generation pipeline and is not the recommended product entry.

Neither component belongs to the current `worker/ + web/ + db/` authoring runtime.

## Current production limitations

v0.5.0 has no production SLA, durable asynchronous Writer, high-concurrency guarantee, user authentication, billing or anti-abuse controls. It is text-only: image, video, TTS, StoryWorld and Narrative Memory are not implemented. Synchronous long-form requests remain sensitive to Provider and host execution windows.

# DramaGo P1 Credibility Alignment Report

## Scope

This post-release documentation change addresses the four P1 findings in the immutable `DRAMAGO_FULL_NON_WRAPPER_RED_TEAM_AUDIT_V1` baseline. It does not change product behavior, prompts, models, schemas, API contracts, benchmarks, package version, the published `v0.5.0` tag or its GitHub Release.

## P1-1 — Story Facts boundary

**Before:** Public wording could imply that Story Facts constrained Writer or served as long-term story memory.

**Code boundary:** Validator LLM output (`source_story_facts` / `candidate_story_facts`) is normalized and stored in `story_facts_snapshots`; later Validator calls may read the snapshot. `buildProviderMessages` does not receive Story Facts.

**After:** Public docs define Story Facts as version/hash-bound validation fact snapshots. They explicitly state that Writer receives CreativeBrief, context, source-version full text, and optional ContentPlan/mechanisms—but not Story Facts.

**Primary files:** `docs/CAPABILITY_BOUNDARIES.md`, `docs/ARCHITECTURE.md`, `docs/guide/concepts.html`, `docs/guide/operations.html`, `docs/guide/architecture.html`.

## P1-2 — Content Intelligence form and reachability

**Before:** “Optional structural enhancement” did not consistently disclose that mechanism selection and fulfillment were model-mediated or that the UI had no toggle.

**Code boundary:** A Planner LLM returns ContentPlan and mechanism IDs. Program code applies a known-ID allowlist, deduplication and a maximum-five cap, then persists/traces selection. Writer receives plan/mechanisms through its prompt. `web/app.js` does not send `create_pipeline=content_intelligence_v0.1`.

**After:** Public docs label Content Intelligence V0.1 as experimental and API/benchmark-only in v0.5.0. They disclose Planner LLM selection, limited program controls, model-mediated Writer fulfillment, the missing UI toggle, and selective—not universal—blind-review value.

**Primary files:** `README.md`, `docs/CAPABILITY_BOUNDARIES.md`, `docs/product/index.html`, `docs/experiments/index.html`, `docs/decisions/ADR-003-content-intelligence-optional.md`, `portfolio-evidence/`.

## P1-3 — Legacy surface separation

**Before:** `script-writer/` and `/experience` remained visible without a sufficiently strong boundary from the current workbench.

**Code boundary:** Current authoring runtime is `worker/ + web/ + db/`. `script-writer/` has a separate WritingPacket, local-test persistence and legacy validator. `/experience` is packaged from retained legacy sources under `dist/`.

**After:** `script-writer/README.md` is labeled “Legacy Experiment.” `/experience` carries a visible bilingual legacy banner and `noindex`. Architecture and repository maps separate current, legacy, generated and evidence paths.

**Primary files:** `script-writer/README.md`, `dist/index.html`, `docs/ARCHITECTURE.md`, `docs/PROVENANCE.md`, `README.md`.

## P1-4 — Public snapshot provenance

**Before:** Release notes described snapshot consolidation but lacked a dedicated, verifiable source/dependency classification and limitation statement.

**After:** `PROVENANCE.md` provides a root entry; `docs/PROVENANCE.md` records public history, internal evolution, snapshot consolidation, source classification, dependency licenses, evidence limits and a maintainer statement. It does not claim that every internal commit was migrated or provide a legal originality certification.

## Related wording alignment

- Semantic Validator is described as a separate model-assisted stage with programmatic enforcement, not an independent truth engine.
- “L2” is identified as the DramaGo project-specific Wrapper maturity rubric, not an industry certification.
- “Validated Portfolio MVP” is limited to engineering workflow validation, controlled real-model experiments and small-sample human blind review—not market validation, production reliability, SLA or statistical superiority.
- `docs/errata/v0.5.0-capability-clarifications.md` records these post-release clarifications without rewriting the released tag.

## Deterministic documentation protection

`scripts/validate-public-claims.mjs` verifies required boundary/provenance artifacts, README links, exact Story Facts/UI/L2/Validated qualifiers, legacy markers, current-runtime isolation from `script-writer`, and the immutable audit SHA-256.

## Product behavior intentionally unchanged

- No Writer, Validator or Planner prompt change.
- No model or Provider-call change.
- No ContentPlan schema or mechanism-library change.
- No candidate/version/CAS, database schema or API behavior change.
- No benchmark, fixture or Golden Set change.
- No package-version, tag or Release change.

## Validation

- `pnpm test`: PASS, 22/22 tests.
- `pnpm build`: PASS.
- `pnpm validate`: PASS; generated artifact contains no client-side key input.
- `pnpm audit:l2`: PASS, 20/20 listed audit/fault-injection outcomes passed or passed at the recorded pipeline-only scope; 25 traces.
- `pnpm db:validate`: PASS; three migrations, required tables and reliability columns verified.
- `pnpm docs:validate`: PASS; 14 HTML pages and 18 required pages/assets.
- `pnpm claims:validate`: PASS, including immutable audit hash verification.
- `pnpm links:validate`: PASS; 66 Markdown/HTML files and zero broken local links.
- Secret scan: 0 matches for configured credential patterns.
- Personal absolute-path scan: 0 matches.
- Browser QA: Home, Product, Docs, Experiments, Architecture, Capability Boundaries, Provenance and legacy experience checked across desktop/mobile and light/dark states; legacy banner and `noindex` confirmed.

## Remaining issues

- Story Facts remain model-extracted validation snapshots, not Writer-consumed Narrative Memory.
- Content Intelligence remains model-mediated and unavailable through the v0.5.0 UI.
- Semantic validation remains probabilistic and may share Provider/model lineage with Writer.
- Synchronous long-form execution, authentication, billing, anti-abuse and production SLA remain outside v0.5.0.

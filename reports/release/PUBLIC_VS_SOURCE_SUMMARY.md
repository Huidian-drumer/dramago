# Public vs Source Snapshot Summary

- Public baseline: a765031 (origin/main)
- Source snapshot: dd3a8be plus explicitly selected untracked evidence documents
- Strategy: file snapshot transplant; no Git history merge
- dist/: retained because it is a tracked release artifact in both repositories

## Counts

- Current public tracked files: 86
- Selected source release files: 100
- New from source: 16
- Modified from source: 84
- Identical: 0
- Public-only candidates: 2

## New from source

- benchmark/content-intelligence-v0.1/CONTENT_INTELLIGENCE_BENCHMARK_REPORT.md
- benchmark/content-intelligence-v0.1/golden_inputs.json
- benchmark/content-intelligence-v0.1/official-rerun/OFFICIAL_AB_REPORT.md
- benchmark/real-content-v0.1/REAL_CONTENT_BENCHMARK_REPORT.md
- benchmark/runtime-reliability-v0.2/RUNTIME_RELIABILITY_REPORT.md
- benchmark/writer-latency-validator-calibration-v0.3/WRITER_LATENCY_AND_VALIDATOR_CALIBRATION_REPORT.md
- dist/.openai/drizzle/0002_conscious_oracle.sql
- dist/.openai/drizzle/meta/0002_snapshot.json
- dist/server/content-mechanisms.mjs
- drizzle/0002_conscious_oracle.sql
- drizzle/meta/0002_snapshot.json
- portfolio-benchmark/report.md
- portfolio-evidence/FUTURE_ROADMAP.md
- portfolio-evidence/PORTFOLIO_EVIDENCE_PACKAGE.md
- test/runtime-reliability.test.mjs
- worker/content-mechanisms.mjs

## Modified from source

- .env.example
- .gitignore
- .openai/hosting.json
- audit/fake-d1.mjs
- audit/run-wrapper-audit.mjs
- audit/validate-migrations.mjs
- CONTRIBUTING.md
- CREATIVE_WORKBENCH_REPORT.md
- db/schema.ts
- dist/.openai/drizzle/0000_low_the_fallen.sql
- dist/.openai/drizzle/0001_kind_the_spike.sql
- dist/.openai/drizzle/meta/_journal.json
- dist/.openai/drizzle/meta/0000_snapshot.json
- dist/.openai/drizzle/meta/0001_snapshot.json
- dist/.openai/hosting.json
- dist/app.js
- dist/index.html
- dist/server/assets.mjs
- dist/server/core.mjs
- dist/server/index.js
- docs/.nojekyll
- docs/404.html
- docs/app.js
- docs/index.html
- docs/robots.txt
- docs/styles.css
- drizzle.config.ts
- drizzle/0000_low_the_fallen.sql
- drizzle/0001_kind_the_spike.sql
- drizzle/meta/_journal.json
- drizzle/meta/0000_snapshot.json
- drizzle/meta/0001_snapshot.json
- L2_HARDENING_REPORT.md
- LICENSE
- package.json
- pnpm-lock.yaml
- pnpm-workspace.yaml
- README.md
- script-writer/.gitignore
- script-writer/artifacts/internal/identity-fulfillment-beat-map.json
- script-writer/artifacts/internal/identity-fulfillment-writing-packet.json
- script-writer/artifacts/internal/long-term-growth-beat-map.json
- script-writer/artifacts/internal/long-term-growth-writing-packet.json
- script-writer/artifacts/internal/relationship-closure-beat-map.json
- script-writer/artifacts/internal/relationship-closure-writing-packet.json
- script-writer/artifacts/MODEL_USAGE.json
- script-writer/artifacts/reports/batch-expression-report.json
- script-writer/artifacts/reports/identity-fulfillment.json
- script-writer/artifacts/reports/identity-fulfillment.md
- script-writer/artifacts/reports/long-term-growth.json
- script-writer/artifacts/reports/long-term-growth.md
- script-writer/artifacts/reports/relationship-closure.json
- script-writer/artifacts/reports/relationship-closure.md
- script-writer/artifacts/REVISION_COMPARISON.md
- script-writer/artifacts/SCRIPT_WRITER_REPORT.md
- script-writer/artifacts/scripts/identity-fulfillment.md
- script-writer/artifacts/scripts/long-term-growth.md
- script-writer/artifacts/scripts/relationship-closure.md
- script-writer/package.json
- script-writer/README.md
- script-writer/src/contracts.mjs
- script-writer/src/index.mjs
- script-writer/src/persistence.mjs
- script-writer/src/providers.mjs
- script-writer/src/utils.mjs
- script-writer/src/validators.mjs
- script-writer/src/writer.mjs
- script-writer/test/build-artifacts.mjs
- script-writer/test/drafts/identity-fulfillment.md
- script-writer/test/drafts/long-term-growth.md
- script-writer/test/drafts/relationship-closure.md
- script-writer/test/fixtures/cases.mjs
- script-writer/test/run-tests.mjs
- scripts/build.mjs
- scripts/preview.mjs
- scripts/validate-artifact.mjs
- SECURITY.md
- test/creative-workbench.test.mjs
- web/app.js
- web/index.html
- web/styles.css
- worker/core.mjs
- worker/index.mjs
- WRAPPER_AUDIT_REPORT.md

## Public-only candidates

- audit/CREATIVE_TRACE_SAMPLE.json — Remove: superseded by curated audit reports; raw trace/result JSON is intentionally not republished.
- audit/WRAPPER_AUDIT_RESULTS.json — Remove: superseded by curated audit reports; raw trace/result JSON is intentionally not republished.

## Copy exclusions

- .git/, .env, .env.* except .env.example, node_modules/, .wrangler/, caches, coverage, temporary directories, logs, archives, screenshots, credentials
- One-time runner: benchmark/run-portfolio-benchmark.mjs
- Raw benchmark candidate bodies, plans, machine JSON and duplicate intermediate files
- Raw audit trace/result JSON replaced by curated Markdown evidence

## Conflict assessment

No unresolved public-only file conflict. The two public-only JSON artifacts are intentionally removed under the evidence-curation policy.

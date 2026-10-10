# DramaGo Documentation

DramaGo v0.5.0 是一个验证型 AI 短剧创作工作台 MVP。本文档只做导航；详细说明保存在对应页面与报告中。

“Validated”只表示工程工作流验证、受控真实模型实验与小样本人工盲评，不表示市场验证、生产可靠性验证、SLA 或内容优势的统计证明。能力声明以 [Capability Boundaries](docs/CAPABILITY_BOUNDARIES.md) 为准。

## Product

- [Product overview](docs/product/index.html)
- [Creative Workbench Report](CREATIVE_WORKBENCH_REPORT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Capability Boundaries](docs/CAPABILITY_BOUNDARIES.md)
- [Repository provenance](docs/PROVENANCE.md)
- [Product decisions](docs/PRODUCT_DECISIONS.md)

## Getting Started

- [Documentation home](docs/guide/index.html)
- [Quick start](docs/guide/quick-start.html)
- [Configuration and reference](docs/guide/reference.html)

## Concepts

- [Creative Brief, Candidate Version, Story Facts and Semantic Validator](docs/guide/concepts.html)

## Operations

- [CREATE, EXPAND, REWRITE and CONTINUE](docs/guide/operations.html)

## Architecture

- [Execution pipeline, selection and merge, version safety and output contracts](docs/guide/architecture.html)
- [Wrapper Audit](WRAPPER_AUDIT_REPORT.md)
- [L2 Hardening Report](L2_HARDENING_REPORT.md)
- [Non-wrapper Red-Team Audit](reports/audit/DRAMAGO_FULL_NON_WRAPPER_RED_TEAM_AUDIT_V1.md)
- [P1 Credibility Alignment Report](reports/audit/P1_CREDIBILITY_ALIGNMENT_REPORT.md)

## Experiments

- [Experiments overview](docs/experiments/index.html)
- [Portfolio Evidence Package](portfolio-evidence/PORTFOLIO_EVIDENCE_PACKAGE.md)
- [Content Intelligence blind-review summary](portfolio-evidence/CONTENT_INTELLIGENCE_BLIND_REVIEW_SUMMARY.md)

## Decisions

- [ADR-001 — Program constraints over prompt-only control](docs/decisions/ADR-001-program-constraints-over-prompt-only.md)
- [ADR-002 — Validator role](docs/decisions/ADR-002-validator-role.md)
- [ADR-003 — Content Intelligence remains optional](docs/decisions/ADR-003-content-intelligence-optional.md)
- [ADR-004 — Demo model choice](docs/decisions/ADR-004-demo-model-choice.md)
- [ADR-005 — Production infrastructure deferred](docs/decisions/ADR-005-production-infrastructure-deferred.md)

## Security

- [Security Policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Roadmap

- [Public roadmap](docs/roadmap/index.html)
- [Future productization roadmap](portfolio-evidence/FUTURE_ROADMAP.md)

## Release

- [Changelog](CHANGELOG.md)
- [DramaGo v0.5.0 release notes](RELEASE_NOTES_V0.5.0.md)
- [v0.5.0 capability clarifications](docs/errata/v0.5.0-capability-clarifications.md)
- [Pre-release checklist](reports/release/PRE_RELEASE_CHECKLIST.md)
- [Public release preparation report](reports/release/GITHUB_RELEASE_V0.5.0_REPORT.md)
- [Product site design report](reports/release/GITHUB_PRODUCT_DESIGN_REPORT.md)
- [Public/source snapshot summary](reports/release/PUBLIC_VS_SOURCE_SUMMARY.md)

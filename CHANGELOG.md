# Changelog

All notable public changes are recorded here. This changelog begins with the validated portfolio MVP and does not invent earlier release history.

## [0.5.0] — 2026-10-10

### Added

- Content Intelligence V0.1 with lightweight ContentPlan and curated Mechanism Retrieval.
- Validator V2 with evidence-bound blocking findings and severity calibration.
- Staged generation tasks for PLAN, WRITE and VALIDATE.
- Public portfolio benchmark evidence and human blind-review summary.
- GitHub/Primer-inspired product and documentation site.
- Architecture notes, product decisions and five ADRs.

### Improved

- Candidate and source-version protection through content hash binding and compare-and-swap adoption.
- Internal-consistency, negative-constraint and hard-preserve checks.
- Provider timeout observability and transport-attempt accounting.
- Demo-model stability evidence and public documentation.

### Validated

- Real-provider Golden Set: seven candidates created and one recorded timeout across eight cases.
- Writer latency investigation: the old approximately 90-second boundary came from two 45-second application attempts.
- Validator controlled regression: normal false blocking moved from 3/5 to 0/5 while 13/13 expected hard blocks were retained.
- Three-case human blind Content Intelligence A/B.
- DeepSeek Flash created candidates in all three demo stability runs; one candidate was blocked by Validator.

### Product Decisions

- Content Intelligence remains an optional structural enhancement, not the default CREATE pipeline.
- Semantic Validator protects adoption; it is not a literary-quality judge or formal proof system.
- DeepSeek Flash is preferred as the portfolio demo Writer candidate without changing the existing hosted configuration in this release.
- Production Queue and durable execution remain deferred.
- The project remains a Validated Portfolio MVP, not a production SaaS release.

### Known Limitations

- Long WRITE requests still use synchronous HTTP execution.
- The hosted demo may require authorized access; public GitHub Pages contains no Provider secret.
- Semantic validation remains model-dependent and may emit non-blocking warnings on normal drafts.
- The experiments are small controlled samples, not SLA or general-accuracy measurements.
- Authentication, billing, abuse protection, large-scale creator research and production observability are not implemented.


# DramaGo Repository Provenance

## Public history

- Public repository: [`Huidian-drumer/dramago`](https://github.com/Huidian-drumer/dramago).
- The repository began with an early public snapshot and retained that public history.
- The consolidated v0.5.0 release snapshot was reviewed through a normal pull request and merged to the public default branch.
- The published `v0.5.0` tag and GitHub Release point to that release snapshot. This post-release documentation alignment does not move or rewrite either one.

## Internal evolution

The project evolved through these product stages:

```text
Interactive prototype
→ autonomous-world prototype
→ Script Writer V0.1
→ Creative Workbench
→ L2 hardening
→ DramaGo branding
→ Content Intelligence experiments
→ v0.5.0 public snapshot
```

This sequence describes product evolution. It is not a claim that every internal commit exists as a corresponding public commit.

## Snapshot consolidation

DramaGo v0.5.0 was consolidated from a continuously iterated internal working tree into a public release snapshot while preserving the repository's existing public Git history. Internal commits were not represented as individually migrated public commits. The public snapshot includes the source, tests, audit artifacts and documentation selected for reproducibility and review.

## Source classification

| Classification | Paths | Meaning |
| --- | --- | --- |
| Current source | `worker/`, `web/`, `db/`, `scripts/`, `test/`, `audit/` | v0.5.0 runtime, build, verification and audit source |
| Legacy | `script-writer/`, `/experience` sources under `dist/` | historical experiments retained for provenance; outside the current authoring call path |
| Generated | `dist/`, `drizzle/meta/` | build output and generated migration metadata |
| Documentation / evidence | `docs/`, `benchmark/`, `portfolio-evidence/`, `reports/` | public claims, controlled results, reports and release evidence |

The current authoring runtime is `worker/ + web/ + db/`. `script-writer/` is not imported by that runtime. The `/experience` route is a retained interactive prototype and is not the recommended product entry.

## Dependency transparency

| Dependency | License | Role |
| --- | --- | --- |
| `drizzle-orm` | Apache-2.0 | Infrastructure library for database access/schema definitions |
| `drizzle-kit` | MIT | Development-time migration tooling |

The public dependency manifest does not integrate a third-party AI writing-application framework. DramaGo still relies on infrastructure libraries, provider APIs and platform services; this document does not claim that no third-party code is used.

## Evidence and limitation

The public basis for this account includes repository history, the dependency manifest, public-code inspection, benchmark records and the [non-wrapper red-team audit](../reports/audit/DRAMAGO_FULL_NON_WRAPPER_RED_TEAM_AUDIT_V1.md).

Repository history, dependency audit and public-code search support the stated evolution path, but do not constitute a legal originality certification for every line of source code.

## Maintainer statement

The maintainer states that this document describes the public snapshot and known project evolution to the best of their knowledge. It is a factual project statement, not a digital signature, third-party certification or legal opinion.

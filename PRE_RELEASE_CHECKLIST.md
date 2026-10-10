# DramaGo v0.5.0 Pre-release Checklist

Release target: `DramaGo v0.5.0 — Validated Portfolio MVP`
Release branch: `release/v0.5.0`

## Repository preflight

- [x] Fresh clone created from public GitHub `main`.
- [x] Public baseline confirmed as `a76503161e9933ab2a921b1045c22905c6a6aab3`.
- [x] Release branch created from the public baseline.
- [x] Source repository left unchanged.
- [x] Snapshot transplant used; unrelated histories were not merged.
- [x] `origin/main` re-fetched and unchanged immediately before push.

## Version and release content

- [x] Root package version is `0.5.0`.
- [x] README, documentation index, CHANGELOG and release notes prepared.
- [x] Provenance note included.
- [x] Content Intelligence described as optional, not default.

## Engineering validation

- [x] `pnpm test` — 22 passed, 0 failed.
- [x] `pnpm build`
- [x] `pnpm validate`
- [x] `pnpm audit:l2` — 18 PASS, 2 PASS_PIPELINE_ONLY.
- [x] `pnpm db:validate` — 3 migrations, 5 tables.
- [x] Documentation/link validation — 12 HTML pages, 16 required pages/assets.

## GitHub Pages

- [x] Home, Product, Docs, Experiments, Roadmap, Changelog and 404 present.
- [x] `/dramago/` base-path links checked by documentation validator.
- [x] Light, Dark and System themes checked.
- [x] 320, 375, 1024 and 1440px layouts checked; CSS breakpoint covers 768px.
- [x] Keyboard controls, visible focus, semantic landmarks and skip links checked.
- [ ] Production Pages checked after merge and deployment.

## Security and privacy

- [x] High-confidence secret scan passed.
- [x] `.env` and `.env.*` ignored; `.env.example` retained.
- [x] Personal absolute-path scan passed.
- [x] No local runner, raw trace, OAuth data or release archive selected for commit.

## Git and release gate

- [x] Clean, reviewable commits created.
- [x] Release branch pushed without force.
- [x] Pull request opened against `main`: <https://github.com/Huidian-drumer/dramago/pull/1>.
- [ ] Human approval received before merge.
- [x] Tag, GitHub Release and production Pages intentionally deferred until explicit approval.

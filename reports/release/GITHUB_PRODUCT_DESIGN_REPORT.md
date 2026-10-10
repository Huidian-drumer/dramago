# DramaGo v0.5.0 — GitHub Product Design Report

Date: 2026-10-10
Target: GitHub Pages under `/dramago/`
Direction: GitHub-native open-source product and documentation site, with DramaGo's own identity.

## Outcome

The previous dark-gradient SaaS landing page was replaced with a compact, evidence-driven product site. The new system uses neutral canvases, one-pixel borders, restrained labels, checks, tables, code blocks and documentation navigation. It does not copy GitHub logos, illustrations or trademark assets.

## Information architecture

| Route | Purpose |
| --- | --- |
| `/` | Repository-style product overview and current release truth |
| `/product/` | Product model, operations and explicit boundaries |
| `/guide/` | Documentation index |
| `/guide/quick-start.html` | Installation, configuration and validation |
| `/guide/concepts.html` | Creative Brief, Candidate, Story Facts, Validator |
| `/guide/operations.html` | CREATE / EXPAND / REWRITE / CONTINUE contracts |
| `/guide/architecture.html` | Pipeline, merge, version, hash and CAS |
| `/guide/reference.html` | Environment, errors and limitations |
| `/experiments/` | Audit, Golden Set, calibration, latency and A/B evidence |
| `/changelog/` | v0.5.0 public change summary |
| `/roadmap/` | Explicitly deferred productization work |
| `/404.html` | Base-path-safe not-found page |

## Design system

- Semantic tokens are isolated in `docs/assets/tokens.css`.
- Light, Dark and System themes share component semantics.
- System is the default; explicit choices persist under `dramago-theme`.
- Radius scale is 6px, 8px and 12px; only two restrained shadow tokens are available.
- UI uses system fonts; code and status values use a monospace stack.
- Components include labels, checks, status panels, operation cards, workflow nodes, metrics, tables, docs sidebar, callouts and decision cards.

## Content hierarchy

The home page follows the frozen release brief:

1. Hero
2. Project Status
3. Why DramaGo
4. Core Operations
5. Product Workflow
6. Programmatic Controls
7. Validation Evidence
8. Content Intelligence Experiment
9. Product Decisions
10. Latest Release
11. CTA and footer

The primary product message is evidence-based: removing model intelligence would still leave meaningful program logic. The primary experiment message is that more agents did not automatically produce better content.

## Accessibility and responsive behavior

- Semantic header, navigation, main, section, article, aside and footer landmarks.
- Skip link on every page.
- Visible `:focus-visible` state.
- Native select for theme choice and native button for the mobile menu.
- Reduced motion support.
- Scroll containers for wide workflow, tables and code blocks.
- No horizontal document overflow at 320 CSS pixels.

## Local browser QA

| Check | Result |
| --- | --- |
| 1440 desktop, Light | Passed |
| 1024 documentation layout, Dark | Passed |
| 375 mobile, Light and Dark | Passed |
| 320 mobile minimum | Passed; `clientWidth = scrollWidth = 320` |
| Mobile menu | Passed |
| Light / Dark / System selection | Passed |
| System preference persistence | Passed; explicit theme removed and `system` saved |
| Live Demo navigation | Passed in the authenticated browser; public access may require authorization |
| Reduced motion and keyboard focus | Implemented and source-checked |

## Automated documentation QA

`pnpm docs:validate` verifies required pages/assets, local `href`/`src` references, `/dramago/` mappings for the 404 page, removed evidence links and core release-truth language.

Result: **12 HTML pages and 16 required pages/assets passed.**

## Known constraints

- Production GitHub Pages cannot be post-deploy tested until the release branch is reviewed and merged.
- The hosted Demo is reachable in the authenticated project context but anonymous requests may be denied; public copy says access may be required.
- No large image or custom web-font payload was introduced.

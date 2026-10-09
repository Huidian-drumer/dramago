# DramaGo v0.5.0 — Validated Portfolio MVP

DramaGo is an AI short-drama creative workbench that turns one-shot LLM generation into an editable, traceable and validated creative workflow.

> DramaGo v0.5.0 is a validated portfolio MVP. The core author workflow and real-model experiments are complete. Production-scale async execution, authentication, billing and large-scale user validation remain roadmap items.

## What DramaGo is

Authors can CREATE a full draft, EXPAND a reliable selection, REWRITE a full work or selection, and CONTINUE without asking the model to rewrite prior text. Generated content is saved as a Candidate and must pass program and semantic checks before CAS adoption.

## What changed

- Added strong `full / segment / continuation` output contracts.
- Added programmatic range replacement and continuation append.
- Added source-version checks, Candidate isolation, content-hash binding and CAS adoption.
- Added Story Facts snapshots and an independent Semantic Validator safety layer.
- Added optional ContentPlan and Mechanism Retrieval for selected CREATE cases.
- Added a public documentation system, experiment index and ADR set.

## What was validated

- The real-provider Golden Set created candidates for G01–G07; G08 retained its Provider timeout failure.
- Validator calibration retained 13/13 expected hard blocks and reduced normal false blocking from 3/5 to 0/5 in a controlled 20-case regression.
- The old approximately 90-second Writer failure boundary was traced to the application's `45s × 2 attempts`, not a demonstrated fixed host wall-time limit.
- In a 180-second experimental window, two frozen 2000-character CREATE requests completed, including one after the old boundary.
- DeepSeek Flash created Candidates in all three portfolio demo stability runs; one Candidate was blocked by Validator.

## What failed

- Earlier V4-Pro Content Intelligence runs produced only four Candidates across eight calls; timeouts, cancellation, HTTP 500 and stale-stage recovery remained visible.
- Content Intelligence did not win every human blind-review case.
- A stability candidate contained contradictory time anchors and was correctly blocked rather than silently adopted.

## What we learned

More agents did not automatically produce better content. Human blind review preferred the enhanced path for the hidden-heir story, where an opening identity promise needed causal payoff. Direct Writer was preferred for the 17-year-old emperor and regret-vision stories, where additional planning over-shaped the character or added insufficient value.

The public conclusion is: **Blind A/B showed selective—not universal—benefit.**

## Product decisions

- Content Intelligence is an **Optional Structural Enhancement**.
- Semantic Validator is a safety layer, not a quality score or formal proof.
- DeepSeek Flash is the preferred portfolio-demo Writer candidate based on three successful candidate-creation runs, not an SLA claim.
- Production Queue and durable async Writer were investigated and deferred.

## Known limitations

- No production SLA, P95/P99 latency claim or large-scale user validation.
- Synchronous long-form WRITE remains sensitive to provider latency.
- No production authentication, billing, anti-abuse or durable task execution.
- No Narrative Memory, image generation, video generation, TTS or StoryWorld in v0.5.0.

## Future roadmap

See [DramaGo Roadmap](docs/roadmap/index.html) and [Future Productization Roadmap](portfolio-evidence/FUTURE_ROADMAP.md).

## Public-history provenance

The validated MVP was developed through an internal iterative history and consolidated into the public repository as the v0.5.0 release snapshot, while preserving the existing public GitHub history. Internal commits were not represented as individually migrated public commits.

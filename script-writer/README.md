# 开戏 DramaGo Script Writer V0.1

Pure-text writer and validation module. It does not generate images, video, TTS, storyboards, visual prompts, or realtime StoryWorld content.

## What is implemented

- A compact `WritingPacket` contract.
- Full-draft generation through a provider interface.
- Explicit `STRUCTURE_CHANGE_REQUIRED` handling.
- Independent post-draft event and knowledge-change extraction.
- Structural, factual, expression, and batch-diversity checks.
- Current-version SHA-256 binding for every validation report.
- Configurable local expression repair, capped at two attempts by default.
- Explicit failure when no Text Provider is configured.
- Local JSON persistence for tests only.

## Commands

```text
npm test
npm run build:artifacts
```

The three local contracts and approved skeletons under `test/fixtures` are marked test inputs. The accompanying drafts were generated in the current Codex session and enter the module through `ExternalDraftAdapter`; they are not represented as product-provider output.

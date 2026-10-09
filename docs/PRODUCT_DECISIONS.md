# DramaGo Product Decisions

## Decision summary

| Decision | Evidence | Consequence |
|---|---|---|
| Program controls over prompt-only control | Wrapper Audit and failure injection | Scope, merge, output contract and adoption remain code-owned. |
| Validator is a safety layer | 20-case controlled regression | It can block adoption but does not score literary quality. |
| Content Intelligence remains optional | Three-case human blind A/B | Use it for structural gaps, not every CREATE request. |
| DeepSeek Flash is the demo Writer candidate | Three candidate-creation runs | Better demo responsiveness is preferred without an SLA claim. |
| Production infrastructure is deferred | Portfolio scope and latency investigation | Queue, auth, billing and durable execution stay on the roadmap. |

Detailed context is recorded in [`decisions/`](decisions/).


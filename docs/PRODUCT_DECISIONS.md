# DramaGo Product Decisions

## Decision summary

| Decision | Evidence | Consequence |
|---|---|---|
| Program controls over prompt-only control | Wrapper Audit and failure injection | Scope, merge, output contract and adoption remain code-owned. |
| Validator is a separate model-assisted stage with program enforcement | 20-case controlled regression | It can block adoption through an evidence-bound gate but is not an independent truth engine or literary score. |
| Content Intelligence remains experimental and API-only in v0.5.0 | Three-case human blind A/B | Planner selection and Writer fulfillment remain model-mediated; the current UI has no toggle. |
| DeepSeek Flash is the demo Writer candidate | Three candidate-creation runs | Better demo responsiveness is preferred without an SLA claim. |
| Production infrastructure is deferred | Portfolio scope and latency investigation | Queue, auth, billing and durable execution stay on the roadmap. |

Detailed context is recorded in [`decisions/`](decisions/).

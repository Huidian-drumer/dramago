<div align="center">

# 开戏 DramaGo

**AI short-drama creative workbench that turns one-shot LLM generation into an editable, traceable and validated creative workflow.**

面向短剧作者的 AI 文字创作工作台：让一次性生成变成可编辑、可追踪、可校验的创作流程。

[![Version](https://img.shields.io/badge/version-v0.5.0-0969da?style=flat-square)](RELEASE_NOTES_V0.5.0.md)
[![Status](https://img.shields.io/badge/status-Validated%20Portfolio%20MVP-1a7f37?style=flat-square)](DOCUMENTATION.md)
[![Node](https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](package.json)
[![License](https://img.shields.io/badge/license-MIT-8250df?style=flat-square)](LICENSE)

[Project site](https://huidian-drumer.github.io/dramago/) · [Documentation](DOCUMENTATION.md) · [Experiments](portfolio-evidence/PORTFOLIO_EVIDENCE_PACKAGE.md) · [Live demo](https://dramaworld-v01.huidian31.chatgpt.site/)*

<sub>*托管 Demo 可能要求授权访问；GitHub Pages 只承载静态官网。</sub>

</div>

## Why DramaGo

聊天式 AI 可以写文本，但局部修改可能重写无关内容，长篇续写会遗失既有事实，模型结果也可能绕过作者的明确约束。DramaGo 把创作拆成可审计的产品流程：

```text
Creative Brief → Operation Router → Writer → Output Contract
               → Programmatic Merge → Semantic Validator
               → Candidate Version → CAS Adopt
```

模型负责生成与有限语义推理；程序负责 scope、selection、merge、append、version、hash、candidate、output contract 与 adopt。

## Core operations

| Operation | Provider output | Program behavior |
| --- | --- | --- |
| `CREATE` | `full` | 建立完整候选稿；结构增强为可选支线 |
| `EXPAND` | `segment`（选区） | 按可靠字符范围合并，保留范围外正文 |
| `REWRITE` | `full` / `segment` | 管理目标范围、来源版本与候选稿 |
| `CONTINUE` | `continuation` | 程序追加，前文不会被模型整篇重写 |

## More than prompt instructions

- 选区操作使用 character range，不靠全文搜索定位重复句。
- 输出类型不匹配、空响应和异常超长内容不会进入可采用候选。
- 生成期间源版本变化时，旧候选不能覆盖新版本。
- checks 与 candidate content hash 绑定；采用执行 compare-and-swap。
- Provider 失败明确进入 failed，不使用 fixture 或固定正文冒充成功。
- Semantic Validator 是独立安全层，不是文学评分器或形式化证明。

当前工程成熟度是 **可靠 L2 + 最小内容保护层**，不是生产 SaaS。

## What the experiments showed

- DeepSeek Flash 在 3 次作品集 Demo stability 运行中均建立真实 candidate；其中 1 个被 Validator 阻断。这个小样本不构成生产稳定性或 SLA 声明。
- Validator V2 的 20-case controlled regression 中，normal false blocking 从 `3/5` 降为 `0/5`，`13/13` hard blocking 保留，`2/2` expected warnings 继续保持 warning；这不是通用语义准确率。
- Writer latency 审计将旧约 90 秒失败边界定位为应用自身 `45s × 2 attempts`。180 秒实验窗口内，冻结的 2000 字输入两次成功，其中一次用时 94,406 ms。
- 3-case human blind A/B 显示 **selective—not universal—benefit**：隐藏豪门继承人偏好 Content Intelligence，17 岁新帝与“看见别人即将后悔选择”的大学生偏好 Direct Writer。

因此，Content Intelligence 是 **Optional Structural Enhancement**，不是默认 CREATE Pipeline。

## Quick start

Requires Node.js 20+, pnpm, a D1-compatible binding, and an OpenAI-compatible text provider.

```bash
git clone https://github.com/Huidian-drumer/dramago.git
cd dramago
pnpm install --frozen-lockfile

pnpm test
pnpm build
pnpm validate
pnpm audit:l2
pnpm db:validate
pnpm docs:validate
```

复制 `.env.example` 并仅在服务端环境中设置：

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=
OPENAI_ENDPOINT=
VALIDATOR_MODEL=
MAX_AUTO_REPAIRS=2
```

API Key 不应进入前端、数据库、日志、Creative Trace 或 Git 历史。

## Repository map

```text
web/                 Author workbench UI
worker/              API, routing, provider, merge and validation
db/ + drizzle/       Data model and migrations
test/                Product and reliability regression
audit/               Wrapper audit and fault injection
benchmark/           Curated benchmark reports
portfolio-evidence/  Public product evidence and decisions
docs/                GitHub Pages product and documentation site
```

## Documentation

- [Documentation index](DOCUMENTATION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Product decisions](docs/PRODUCT_DECISIONS.md)
- [Wrapper Audit](WRAPPER_AUDIT_REPORT.md)
- [L2 Hardening](L2_HARDENING_REPORT.md)
- [Portfolio Evidence](portfolio-evidence/PORTFOLIO_EVIDENCE_PACKAGE.md)
- [Release notes](RELEASE_NOTES_V0.5.0.md)
- [Roadmap](portfolio-evidence/FUTURE_ROADMAP.md)

## Scope and limits

DramaGo v0.5.0 is a validated portfolio MVP. The core author workflow and real-model experiments are complete. Production-scale async execution, authentication, billing, high concurrency, multimedia generation and large-scale creator validation remain roadmap items.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Do not report secrets in a public issue; follow [SECURITY.md](SECURITY.md).

Released under the [MIT License](LICENSE).

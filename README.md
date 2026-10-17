# 开戏 DramaGo · Windows Text Studio V1.4

**Private staging — 公开前验收源码；不是生产级 SaaS 或公开稳定安装版。** 本仓库以独立根提交建立，不继承旧公开或内部 Git 历史。本阶段不提供 Windows ZIP，不部署 Pages。

V1.4 包含空白作品、手工写作、SQLite 草稿、版本保存/恢复/比较、CREATE/EXPAND/REWRITE/CONTINUE、独立 Writer/Validator、候选隔离、安全重新审核、Hash/CAS、保守 Story Memory 与 Markdown 导出。人物关系树已从界面移除，可靠记忆能力保留。

## V1.4 开发入口

Windows 10/11、Node.js 24.18+（需要 node:sqlite）、pnpm；Electron 固定 44.7.0。包元数据仍保留 0.5.0，不代表源码是旧工作台。

```powershell
git clone https://github.com/Huidian-drumer/dramago-v14-public-staging.git
cd dramago-v14-public-staging
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm validate
pnpm db:validate
pnpm audit:l2
pnpm docs:validate
pnpm claims:validate
pnpm links:validate
```

核心测试使用合成故事、受控 Provider 和临时数据库，不需要真实 API Key。`pnpm desktop:start` 为开发启动；若安装策略未执行 Electron 下载脚本，应按 Electron 官方说明安装锁定运行时。开发与 QA 必须使用隔离数据目录。名称含 real 的脚本不属于默认无费用测试，未经授权不要运行。

Windows 打包入口 `pnpm desktop:package` 仅保留源码能力；本阶段不执行打包。不得直接把本地服务开放到公网。真实文学质量、Validator 语义精度、市场验证、公开稳定性和多租户安全不由本次工程测试证明。没有视频/TTS。

- [V1.4 版本说明](RELEASE_NOTES_V1.4.md)
- [V1.4 开发与数据安全](docs/V1_4_TEXT_STUDIO.md)
- [第三方许可](THIRD_PARTY_NOTICES.md) · [项目许可](LICENSE)

以下是已公开的 v0.5.0 历史介绍，不是 V1.4 当前安装说明或验收结论；其中旧仓库、Pages 和审计对象仅作历史引用。

<details>
<summary>v0.5.0 历史介绍与实验记录</summary>

<div align="center">

# 开戏 DramaGo

**AI short-drama creative workbench that turns one-shot LLM generation into an editable, traceable and validated creative workflow.**

面向短剧作者的 AI 文字创作工作台：让一次性生成变成可编辑、可追踪、可校验的创作流程。

[![Version](https://img.shields.io/badge/version-v0.5.0-0969da?style=flat-square)](RELEASE_NOTES_V0.5.0.md)
[![Status](https://img.shields.io/badge/status-Validated%20Portfolio%20MVP-1a7f37?style=flat-square)](docs/CAPABILITY_BOUNDARIES.md#meaning-of-validated-portfolio-mvp)
[![Node](https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](package.json)
[![License](https://img.shields.io/badge/license-MIT-8250df?style=flat-square)](LICENSE)

[Historical project site](https://huidian-drumer.github.io/dramago/) · [Documentation](DOCUMENTATION.md) · [Experiments](portfolio-evidence/PORTFOLIO_EVIDENCE_PACKAGE.md) · Historical hosted demo URL omitted

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
| `CREATE` | `full` | 建立完整候选稿；默认 UI 走 Direct Writer |
| `EXPAND` | `segment`（选区） | 按可靠字符范围合并，保留范围外正文 |
| `REWRITE` | `full` / `segment` | 管理目标范围、来源版本与候选稿 |
| `CONTINUE` | `continuation` | 程序追加，前文不会被模型整篇重写 |

## More than prompt instructions

- 选区操作使用 character range，不靠全文搜索定位重复句。
- 输出类型不匹配、空响应和异常超长内容不会进入可采用候选。
- 生成期间源版本变化时，旧候选不能覆盖新版本。
- checks 与 candidate content hash 绑定；采用执行 compare-and-swap。
- Provider 失败明确进入 failed，不使用 fixture 或固定正文冒充成功。
- Semantic Validator 是独立执行阶段的模型辅助校验；程序负责 finding allowlist、证据门槛、hash 绑定、`can_auto_apply` 与 CAS 采用控制。它不是独立真值系统、文学评分器或形式化证明。

当前工程成熟度按 **DramaGo 项目内部定义的 L2 工作流等级**评估：具备程序化 scope、version、candidate 与 adopt 保护，并带最小内容保护层；这不是行业认证，也不是生产 SaaS。

Content Intelligence V0.1 是 **experimental、optional 的 API / benchmark 结构增强路径**。Planner 选择机制、Writer 是否落实机制仍由模型完成；程序只执行已知 ID allowlist、去重、最多 5 条、持久化与 trace。v0.5.0 前台没有该开关，用户从当前 UI 点击 CREATE 默认进入 Direct Writer。人工盲评只显示 selective—not universal—benefit。详见 [Capability Boundaries](docs/CAPABILITY_BOUNDARIES.md) 与 [Experiments](docs/experiments/index.html)。

## What the experiments showed

- DeepSeek Flash 在 3 次作品集 Demo stability 运行中均建立真实 candidate；其中 1 个被 Validator 阻断。这个小样本不构成生产稳定性或 SLA 声明。
- Validator V2 的 20-case controlled regression 中，normal false blocking 从 `3/5` 降为 `0/5`，`13/13` hard blocking 保留，`2/2` expected warnings 继续保持 warning；这不是通用语义准确率。
- Writer latency 审计将旧约 90 秒失败边界定位为应用自身 `45s × 2 attempts`。180 秒实验窗口内，冻结的 2000 字输入两次成功，其中一次用时 94,406 ms。
- 3-case human blind A/B 显示 **selective—not universal—benefit**：隐藏豪门继承人偏好 Content Intelligence，17 岁新帝与“看见别人即将后悔选择”的大学生偏好 Direct Writer。

因此，Content Intelligence 是 **Optional Structural Enhancement**，不是默认 CREATE Pipeline，也不是自研叙事模型或确定性规划算法。

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
script-writer/        Legacy V0.1 text experiment; not current runtime
dist/index.html       Legacy prototype source packaged at /experience
dist/                 Generated release artifacts (including the legacy source above)
drizzle/meta/         Generated migration metadata
```

The current v0.5.0 runtime is `worker/ + web/ + db/`. Legacy components are retained for history and provenance but are outside the current authoring call path.

## Documentation

- [Documentation index](DOCUMENTATION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Capability Boundaries](docs/CAPABILITY_BOUNDARIES.md)
- [Repository Provenance](docs/PROVENANCE.md)
- [Product decisions](docs/PRODUCT_DECISIONS.md)
- [Wrapper Audit](WRAPPER_AUDIT_REPORT.md)
- [L2 Hardening](L2_HARDENING_REPORT.md)
- [Portfolio Evidence](portfolio-evidence/PORTFOLIO_EVIDENCE_PACKAGE.md)
- [Non-wrapper Red-Team Audit](reports/audit/DRAMAGO_FULL_NON_WRAPPER_RED_TEAM_AUDIT_V1.md)
- [P1 Credibility Alignment](reports/audit/P1_CREDIBILITY_ALIGNMENT_REPORT.md)
- [Release notes](RELEASE_NOTES_V0.5.0.md)
- [Roadmap](portfolio-evidence/FUTURE_ROADMAP.md)

## Scope and limits

DramaGo v0.5.0 is a validated portfolio MVP. Here, “validated” means engineering workflow validation, controlled real-model experiments and a small-sample human blind review. It does not mean market validation, large-scale creator validation, production reliability validation, an SLA or statistical content superiority. Production-scale async execution, authentication, billing, high concurrency and multimedia generation remain roadmap items.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Do not report secrets in a public issue; follow [SECURITY.md](SECURITY.md).

Released under the [MIT License](LICENSE).

</details>

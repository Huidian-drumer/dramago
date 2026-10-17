# DRAMAGO_FULL_NON_WRAPPER_RED_TEAM_AUDIT_V1

审计日期：2026-10-10  
审计方式：只读、对抗式、从代码与可复现测试出发  
审计对象：公开仓库 `Huidian-drumer/dramago` 的 v0.5.0 release tree，以及可访问的内部开发 Git 历史  
公开审计基线：`release/v0.5.0@7a8aa396ef2c705fd59067e6993d8c7343007da4`；其 tree 与 `origin/main@b6375ce95a23719518e7ffbc71b8429ed58fa10f` / tag `v0.5.0` 对应的发布内容一致  

> 本报告优先寻找“开源换皮、Prompt Wrapper、Agent Wrapper、无产品逻辑 Demo”的证据。结论不是原创性法律鉴定，也不是安全审计证书。GitHub 全局代码检索不能证明绝对原创；真实模型小样本不能证明普遍语义准确率或内容质量。

## Executive verdict

**主分类：D — AI APPLICATION WITH MEANINGFUL PROGRAM LOGIC。**

次级分类：**领域适配的、模型依赖的 L2 文本创作工作流**。它不是完整领域 AI 系统，也不是自研叙事模型。

红队未找到 DramaGo 建立在某个完整 OSS AI writing product 上并换名发布的证据。去掉模型智能后，选区绑定、程序替换/追加、候选隔离、版本/哈希绑定、CAS 采用、阶段状态机、失败保护和审计记录仍然存在；因此它不符合 `UI → Prompt → LLM → Text` 的纯 Wrapper 定义。

但是，去掉模型后不会剩下短剧创作智能。正文质量、ContentPlan 的内容、机制选择、事实/时间线语义判断和 Story Facts 提取仍主要来自 LLM。Content Intelligence 当前是“结构化 Prompt 编排 + 人工机制目录 + 程序白名单/持久化”，不是确定性叙事规划算法。Story Facts 不进入 Writer，仅进入 Validator，所以不是 Narrative Memory。

---

## PART 1 — Repository Provenance Map

### 1.1 公开仓库

| 项目 | 观察 |
|---|---|
| Remote | 只有 `origin = https://github.com/Huidian-drumer/dramago.git` |
| 当前审计分支 | `release/v0.5.0@7a8aa39`，与远端 release 分支一致 |
| 公共主分支 | `origin/main@b6375ce` |
| Tag | `v0.5.0` 指向公共发布合并提交 |
| 公共根提交 | `ab1b65a Initialize DramaGo repository` |
| 首次公开代码快照 | `9f0b837 Open source DramaGo creative workbench` |
| 发布快照同步 | `3130a63 feat: sync validated DramaGo MVP snapshot` |
| 唯一 merge | `b6375ce`，父提交为公共 main 与 `release/v0.5.0`，即 PR #1 正常合并 |
| Upstream / fork remote | 未发现 |
| 无关 OSS merge | 未发现提交图证据 |

公开历史是发布历史，不是完整开发历史。`RELEASE_NOTES_V0.5.0.md` 也明确承认内部迭代被整理为 public release snapshot，没有伪造逐步迁移的公共 commits。

### 1.2 内部开发历史

可访问的内部仓库显示连续产品演进：

```text
cc59a64  Build DramaWorld interactive prototype
d9d2f4f  Upgrade DramaWorld prototype to V0.2 autonomous world
854ef2f  Add Script Writer V0.1 text pipeline
1780731  Turn DramaWorld into AI script workbench
5edd2bd  Expose workbench runtime version
15b7329  Harden and open source DramaWorld workbench
f59d8f7  Adopt DramaGo product branding
0988fd1  Add professional README and GitHub Pages site
...       Sites source updates
dd3a8be  Update Site source
```

内部仓库同时 fetch 了公共 GitHub 历史，因而能看到另一个根 `ab1b65a`。`f59d8f7` 与公共 `9f0b837` 的 tree 相同，`0988fd1` 与公共 `a765031` 的 tree 相同；这是并行发布历史的证据，不是把两个无关项目 merge 到一起的证据。内部 `origin` 是项目托管 Git，`github` 是 DramaGo 公共仓库，没有第三方 upstream。

### 1.3 红队判断

- **支持项目自身迭代的证据存在**：互动原型 → Script Writer → Workbench → hardening → branding。
- **不能从 Git 单独证明所有文件法律意义上的原创**：公共仓库主要是快照；内部提交作者身份和外部粘贴来源不能仅凭 Git 自证。
- **未发现完整 OSS 产品导入、无关历史 merge、upstream 跟踪或 fork 同步证据。**

## PART 2 — Open Source Repackage Audit

扫描范围：`worker/`、`web/`、`db/`、`scripts/`、`script-writer/src/`、`script-writer/test/`、`test/`、`audit/`。

### 2.1 定向扫描结果

| 检查项 | 命中 |
|---|---|
| copyright headers | 0 |
| third-party / SPDX license headers | 0 |
| copied/adapted/upstream/fork banners | 0 |
| foreign project comments | 0 |
| `novel-studio` / `doc-storygen` / `StoryDaemon` / `Concordia` / `Dramatron` | 0 |
| `DSPy` / `LangChain` / `LangGraph` / `CrewAI` / `AutoGen` | 0 |
| GitHub URLs in audited source | 0 |

### 2.2 所有 URL 命中

| 文件 | 命中 | 判断 |
|---|---|---|
| `scripts/preview.mjs:28` | `http://127.0.0.1:${port}` | 本地预览地址 |
| `worker/index.mjs:409,448,500` | OpenAI chat-completions 默认 endpoint | Provider 协议地址，不是上游项目 |
| `test/runtime-reliability.test.mjs:11,15` | `provider.invalid`、`workbench.test` | 测试保留域名 |
| `audit/run-wrapper-audit.mjs:115` | `audit.invalid` | 测试保留域名 |
| `web/index.html:9` | SVG XML namespace | 内联 favicon 标准 namespace |

### 2.3 历史名称命中

- `web/app.js:3`：`dramaworld-creative-workbench-draft-v01`，浏览器本地存储旧 key。
- `script-writer/src/writer.mjs:9`：`DramaWorld Script Writer V0.1`。
- `script-writer/test/run-tests.mjs:73`：临时目录前缀 `dramaworld-writer-`。
- 当前工作台、构建日志和页面使用 DramaGo。

这些命中与仓库已披露的自有产品改名历史一致，不指向外国项目。

**结论：没有发现 OSS 产品换皮证据。** 这仍是“未发现”，不是数学上证明不存在未索引或手工改写的来源。

## PART 3 — Dependency Audit

### 3.1 直接依赖

| 依赖 | 版本 | License | 分类 | 是否提供 DramaGo 产品行为 |
|---|---:|---|---|---|
| `drizzle-orm` | 0.45.2 | Apache-2.0 | Infrastructure Library | 只用于 schema 描述；Worker 运行逻辑直接调用 D1-compatible SQL |
| `drizzle-kit` | 0.31.10 | MIT | Infrastructure Tool / dev dependency | migration 生成工具，不是运行时产品 |

`script-writer/package.json` 没有第三方依赖。

### 3.2 Nested dependency inventory

`pnpm list --depth 5` 展开为 89 个解析包，均来自 `drizzle-kit` 工具链：`@drizzle-team/brocli`、`@esbuild-kit/*`、多个平台的 `@esbuild/*`、`esbuild`、`tsx`、`get-tsconfig`、`resolve-pkg-maps`、`source-map-support`、`source-map`、`buffer-from`、`fsevents` 等。

`pnpm licenses list --json` 汇总到的 license 组为 Apache-2.0、MIT、BSD-3-Clause。没有 AI Framework、Application Framework、Domain Engine 或 Copied Product 依赖。

### 3.3 删除第三方依赖思想实验

删除全部第三方依赖后：

- `db/schema.ts` 的 Drizzle schema 声明和自动 migration 生成不可用；
- 已有 SQL migrations、Worker 直接 SQL、Provider 调用、合并、校验、CAS、前端和测试 harness 的主体仍是仓库自有 JavaScript；
- 因此仍留下大部分产品逻辑，无法仅靠依赖还原 DramaGo。

**结论：第三方依赖是基础设施，不是被换皮的应用。**

## PART 4 — Source Ownership Map

“出现在项目 Git”不自动等于“已证明原创”。以下按用户要求采用保守标签。

| 文件 | 公开首次出现 | 分类 | 依据 |
|---|---|---|---|
| `worker/core.mjs` | `9f0b837` | **UNKNOWN** | 有内部项目演进与专有命名，无第三方命中；但快照历史不能独立证明作者来源 |
| `worker/index.mjs` | `9f0b837` | **UNKNOWN** | 同上 |
| `worker/content-mechanisms.mjs` | `3130a63` | **UNKNOWN** | 项目特定机制目录；没有独立来源证明 |
| `web/app.js` | `9f0b837` | **UNKNOWN** | 项目工作流代码，仍按证据标准保守处理 |
| `db/schema.ts` | `9f0b837` | **UNKNOWN** | 项目 schema；使用 Drizzle API 不等于第三方应用代码 |
| `audit/run-wrapper-audit.mjs` | `9f0b837` | **UNKNOWN** | 高度贴合产品 API，但作者来源仍未被第三方证明 |
| `test/creative-workbench.test.mjs` | `9f0b837` | **UNKNOWN** | 产品专用测试；同上 |
| `test/runtime-reliability.test.mjs` | `3130a63` | **UNKNOWN** | 产品专用测试；同上 |
| `script-writer/src/contracts.mjs` | `9f0b837` | **LEGACY** | V0.1 独立模块，不在当前 Worker 正式路径 |
| `script-writer/src/index.mjs` | `9f0b837` | **LEGACY** | barrel export |
| `script-writer/src/persistence.mjs` | `9f0b837` | **LEGACY** | `LOCAL_TEST_ONLY` JSON store |
| `script-writer/src/providers.mjs` | `9f0b837` | **LEGACY** | 旧 Provider adapter |
| `script-writer/src/utils.mjs` | `9f0b837` | **LEGACY** | 旧模块工具 |
| `script-writer/src/validators.mjs` | `9f0b837` | **LEGACY** | 旧 marker/regex-based validator |
| `script-writer/src/writer.mjs` | `9f0b837` | **LEGACY** | 旧全稿 writer，不是当前 API pipeline |
| `dist/**` | 构建提交 | **BUILD-ARTIFACT** | `scripts/build.mjs` 从 `web/`、`worker/` 等复制/组装 |
| `drizzle/meta/*.json` | migration commits | **GENERATED** | Drizzle snapshot |

这里没有文件被标成 `third-party`，不是因为默认相信项目，而是因为 source header、依赖、Git 图和外部搜索均未给出该证据。`UNKNOWN` 表示来源证据不足，不表示已发现复制。

## PART 5 — Global Code Similarity Check

### 5.1 方法

对 GitHub 默认分支代码索引做 exact-token / exact-phrase 搜索，选取 16 个标识符：

`VALIDATOR_BLOCKING_CONFIDENCE_THRESHOLD`、`CONTENT_INTELLIGENCE_PIPELINE_ID`、`PROGRAM_REPLACE_RANGE`、`candidate_content_hash`、`SOURCE_VERSION_CONFLICT`、`VALIDATION_STALE`、`audience_leads_information_gap`、`conflict_creates_payoff_opportunity`、`autonomy_payoff`、`content-semantic-v2`、`creative-writer-v3-content-plan`、`source_is_current`、`STORY_FACT_CONFLICT`、`SELECTION_SOURCE_MISMATCH`、`candidate_internal_consistency`、`selected_mechanisms_json`。

### 5.2 结果概览

| 结果类型 | 标识符 |
|---|---|
| 没有外部结果 | `VALIDATOR_BLOCKING_CONFIDENCE_THRESHOLD`、`CONTENT_INTELLIGENCE_PIPELINE_ID`、`PROGRAM_REPLACE_RANGE`、`audience_leads_information_gap`、`conflict_creates_payoff_opportunity`、`content-semantic-v2`、`creative-writer-v3-content-plan`、`selected_mechanisms_json` |
| 有通用语义命中 | `candidate_content_hash`、`SOURCE_VERSION_CONFLICT`、`VALIDATION_STALE`、`source_is_current`、`SELECTION_SOURCE_MISMATCH`、`candidate_internal_consistency` |
| 有单一/少量无关词组命中 | `autonomy_payoff`、`STORY_FACT_CONFLICT` |

### 5.3 外部匹配逐项判断

| DramaGo token | 外部 repository / file（代表性命中） | License metadata | 相似性 | 复制判断 |
|---|---|---|---|---|
| `candidate_content_hash` | `tajemniktv/TajsAnagrams/archive/anagram_run_cache.py` | 未检测到 | 同名 hash helper；Python/anagram cache | 通用巧合 |
| 同上 | `drussell23/JARVIS/.../forward_progress.py` | 未确认 | 同名候选内容 hash；实现/领域不同 | 通用巧合 |
| 同上 | `lolismek/syscall/.../hashing.py` | 未确认 | 同名候选 hash；Python evolution | 通用巧合 |
| 同上 | `xueyufish/hecate/.../gate.py` | 未确认 | candidate + validation hash 语义接近，但代码和产品结构不同 | 无文件级复制证据 |
| 同上 | `xiemonb666/EvoAgent-Core/.../candidate_generator.py` | 未确认 | 同名 helper；Agent evolution | 通用巧合 |
| `SOURCE_VERSION_CONFLICT` | `NVIDIA/OpenShell/crates/openshell-core/src/rpc_error.rs` | Apache-2.0 | 实际字符串为 `RESOURCE_VERSION_CONFLICT` 的并发错误 | 通用并发术语 |
| 同上 | `cropflre/nowen-note/backend/src/services/noteTransfer.ts` | 未确认 | 相同错误码，用于笔记版本冲突 | 通用并发术语 |
| 同上 | `allisoneer/agentic_auxilary/.../error.rs` | 未确认 | 相同常量名，无 DramaGo 调用图相似性 | 不足以判复制 |
| `SELECTION_SOURCE_MISMATCH` | `Devin-AXIS/iPolloWork/.../openai-image-generation.ts` | NOASSERTION | 图片选区归属错误 | 通用校验术语 |
| 同上 | `xang1234/stock-screener/.../translation_selection_store.py` | 未确认 | 翻译选区 hash mismatch | 通用校验术语 |
| 同上 | `bcorfman/freytag-forge/.../narration_safety.py` | 未确认 | 叙事知识选区错误码；其余实现不同 | 名称相似，不构成复制证据 |
| `candidate_internal_consistency` | `ShaneLogic/SolarLab/.../one_dimensional_mechanism_r1_binding.py` | 未检测到 | 科研记录布尔字段 | 无关巧合 |
| 同上 | `lorselq/enochian_language_modeling/.../test_dictionary_word_break_cases.py` | 未确认 | 测试 helper 名 | 无关巧合 |
| `autonomy_payoff` | `issdandavis/SCBE-AETHERMOORE/tests/test_squad_autonomy_sim.py` | MIT | 测试名中的“autonomy payoff”，非叙事机制 | 无关词组 |
| `STORY_FACT_CONFLICT` | `jerry3816111/uruharemake2/uruha_social_reasoning.py` | 未检测到 | 更长字符串的子串 | 无关词组 |
| `VALIDATION_STALE` / `source_is_current` | 多个数据库、认证、文档项目 | 混合/NOASSERTION | 常见状态命名 | 通用巧合 |

### 5.4 限制

- GitHub 搜索只覆盖已索引的公开默认分支，结果数和排序会变化；top-N 不是全网穷举。
- 标识符搜索不能发现被大幅改名、翻译或重构的复制。
- License 栏只记录本轮可见仓库 metadata；`未确认` 不推断为无 license。

**结论：外部命中均是单个通用标识符或无关词组，没有出现相同文件、同一调用图、同一机制目录组合或成段代码。未发现复制已有 OSS AI writing system 的证据。**

## PART 6 — LLM Wrapper Call Graph

真实默认 UI 调用图如下：

```text
web/index.html Generate button
  → web/app.js::generate()
  → ensureSaved() / saveCurrent()（需要时 POST /api/versions/save）
  → buildBrief(sourceVersion)
  → POST /api/generate
  → worker/index.mjs::handleApi()
  → createGenerationTask()
      → core.mjs::createCreativeBrief()
      → assertSourceVersionHash()
      → createTask() 写 generation_tasks
  → [仅请求显式 create_pipeline=content_intelligence_v0.1]
      POST /api/tasks/:id/plan
      → runPlanStage()
      → callContentPlanner()
      → requestProviderOnce()
      → parseContentPlanJson()
      → resolveContentMechanisms() 白名单/去重/最多5条
      → 保存 ContentPlan 与 selected mechanisms
  → POST /api/tasks/:id/write
  → runWriteStage()
      → claimTaskStage() 条件更新
      → buildProviderMessages()
      → callProvider()
      → requestProviderOnce()（最多2次 transport）
      → parseModelJson() / 最多2轮 format repair
      → core.mjs::mergeModelResult()
          CREATE/full rewrite = model full replace into candidate
          selection = PROGRAM_REPLACE_RANGE
          CONTINUE = PROGRAM_APPEND
      → sha256(candidate.content)
      → runDeterministicChecks()
      → INSERT versions(status=candidate)
      → UPDATE generation_tasks(result_version_id/hash/source_is_current/...)
  → POST /api/tasks/:id/validate
  → runValidateStage()
      → candidate hash 校验
      → getStoryFacts(source version, source hash)
      → buildSemanticValidatorMessages()
      → callSemanticValidator() → requestProviderOnce()
      → parseSemanticValidationJson()
      → qualifyingBlockingFindings()
      → 程序 allowlist/severity/confidence/evidence/source-priority gate
      → UPDATE candidate checks/hash binding/validation_status/can_auto_apply
      → INSERT/UPDATE story_facts_snapshots
  → web/app.js::showCandidate() / renderChecks() / diff view
  → 用户点击 Adopt
  → web/app.js::adoptCandidate()
  → POST /api/versions/adopt
  → worker/index.mjs::adoptVersion()
      → 重算 content hash
      → 检查每项 check 绑定 candidate_version_id + content_hash
      → 检查 validator version/status/can_auto_apply
      → 检查 parent_version_id == current_version_id
      → conditional UPDATE works ... WHERE current_version_id = parent
      → INSERT adoption_events
```

重要边界：当前 `web/app.js::generate()` **没有发送 `create_pipeline`**。因此用户从现有工作台点击 Generate 时走 Direct Writer；Content Intelligence 是 API 支持路径，不是当前 UI 中可选择的功能。

## PART 7 — Model vs Program Responsibility Matrix

| 能力 | 分类 | 实际责任边界 |
|---|---|---|
| CREATE | HYBRID | 模型生成全文；程序建立 task/candidate/version |
| EXPAND | HYBRID | 模型写 segment；程序验证 selection 并 splice |
| REWRITE | HYBRID | 模型写 full/segment；程序决定 merge strategy |
| CONTINUE | HYBRID | 模型只产 continuation；程序 append |
| Selection capture/binding | PROGRAM_ONLY | 字符 start/end/text/sourceVersionId |
| Range replacement | PROGRAM_ONLY | `slice(0,start)+segment+slice(end)` |
| Append | PROGRAM_ONLY | 原文 + 两个换行 + continuation |
| Expected output kind | PROGRAM_ONLY | 由 operation/scope 推导并强制匹配 |
| Version safety | PROGRAM_ONLY | source id/hash/current pointer |
| Candidate isolation | PROGRAM_ONLY | Writer 不更新 `works.current_version_id` |
| Hash binding | PROGRAM_ONLY | SHA-256 + candidate/check binding |
| CAS adopt | PROGRAM_ONLY | 条件 UPDATE，affected rows 必须为 1 |
| Story Facts extraction | MODEL_ONLY | Validator LLM 返回五类 facts |
| Story Facts binding/storage | PROGRAM_ONLY | version/content hash/versioned snapshot |
| Story Facts overall | HYBRID | 模型抽取，程序绑定；仅 Validator 消费 |
| Semantic judgment | MODEL_ONLY | 冲突、时间线、完成度的发现来自 LLM |
| Semantic enforcement | PROGRAM_ONLY | finding type allowlist、阈值、evidence、来源优先级、adopt gate |
| Semantic validation overall | HYBRID | 判断和执行分层 |
| ContentPlan narrative content | MODEL_ONLY | 六个文本字段、promise/payoff、机制 ID 由 Planner 生成 |
| ContentPlan schema/persistence | PROGRAM_ONLY | parser、字段长度、状态和 D1 |
| Mechanism selection | MODEL_ONLY | Planner 选择 ID |
| Mechanism allowlisting | PROGRAM_ONLY | 只接受 8 个已知 ID、去重、最多 5 个 |
| Mechanism 对正文的约束力 | PROMPT_ONLY | Writer 可忽略；无程序级 mechanism verifier |
| Provider retry | PROGRAM_ONLY | 最多 2 次独立 transport attempt |
| Format repair | HYBRID | 程序有限循环；修复内容仍由模型生成 |
| Task recovery/idempotency | PROGRAM_ONLY | stage CAS、failed_stage、abandoned、existing result reuse |

当模型完全不听 Prompt 时，程序仍能保证：范围定位、范围外字节级保持、append、不匹配 output kind 拒绝、绝对尺寸限制、源版本冲突保护、候选隔离、hash/checks 绑定、CAS 和失败不覆盖 current。程序不能保证：故事好看、要求真的完成、事实真的一致、机制真正兑现、Validator 判断正确。

## PART 8 — Model-Off Capability Matrix

执行方式：确定性 fake Provider + built Worker 入口 + D1-compatible in-memory adapter；没有调用真实 LLM。正式 audit runner 的文件输出语句在内存加载时被禁用，因此仓库未生成额外 artifacts。`node --test test/*.test.mjs` 结果为 22/22 PASS。

| 能力 | Model-off 结果 | 证据 |
|---|---|---|
| operation separation | PASS | CREATE/full、selection/segment、CONTINUE/continuation 走不同 merge |
| duplicate selection safety | PASS | 三个相同句子中按 range 只替换第二处 |
| range replacement | PASS | 前后 slice 保持 |
| continuation append | PASS | candidate 以 source 原文开头 |
| output contract | PASS | full 冒充 segment、segment 冒充 continuation 均拒绝 |
| max output protection | PASS | 40,000 字符 segment 返回 `OUTPUT_TOO_LARGE`，无 candidate |
| source version race | PASS | 旧 candidate 保留但 `source_is_current=false`，不能 adopt |
| candidate isolation | PASS | Writer 成功后 current pointer 不变 |
| hash binding | PASS | candidate 被篡改后 `VALIDATION_STALE` |
| validation stale protection | PASS | 旧 checks 不能放行新正文 |
| CAS adopt | PASS | 第一次成功，重复/竞争采用冲突 |
| failure safety | PASS | 空/坏 JSON/timeout/500 不改变源版本 |
| idempotent task stages | PASS | 已有 result 重读，不再调用 Writer/不重复建 candidate |
| semantic correctness | **NOT PROVIDED** | fake verdict 只能验证管线，不验证模型识别能力 |
| content quality | **NOT PROVIDED** | 无智能 Provider 可输出合法但无意义文本 |

这组结果证明“模型之外有产品控制”，不证明创作内容质量。

## PART 9 — Hostile Provider Test

| # | 故障 | 结果 | current version 是否安全 |
|---:|---|---|---|
| 1 | `full` 冒充 `segment` | PASS：`OUTPUT_KIND_MISMATCH`，无 candidate | 是 |
| 2 | `segment` 冒充 `continuation` | PASS：`OUTPUT_KIND_MISMATCH`，无 candidate | 是 |
| 3 | 空内容 | PASS：任务 failed，无 candidate | 是 |
| 4 | 非法 JSON | PASS：有限 repair 后 `PROVIDER_FORMAT_INVALID` | 是 |
| 5 | 超长内容 | PASS：绝对上限拒绝 | 是 |
| 6 | 极短 `OK` | PASS：`OUTPUT_TOO_SHORT` | 是 |
| 7 | HTTP 500 | PASS：2 attempts 后失败，无无限重试 | 是 |
| 8 | timeout | PASS：2 attempts 后 `PROVIDER_TIMEOUT` | 是 |
| 9 | source 改变后返回 | PASS：candidate 可留存，`source_is_current=false`，adopt 冲突 | 是 |
| 10 | validation 后 candidate 被篡改 | PASS：重算 hash，`VALIDATION_STALE` | 是 |
| 11 | Validator unavailable | PASS：candidate 可查看，validation unavailable，不能采用 | 是 |
| 12 | duplicate source selection | PASS：按字符范围，仅目标实例变化 | 是 |
| 13 | stale task retry | PASS：stale → abandoned，按 failed stage 重试；随后读取幂等 | 是 |
| 14 | repeated adopt | PASS：第二次 `SOURCE_VERSION_CONFLICT`，无重复推进 | 是 |
| 15 | concurrent stage execution | PASS：条件 claim；第二请求 `STAGE_IN_PROGRESS`，仅一次 provider/candidate | 是 |

**未发现 CRITICAL WRAPPER RISK：被测 Provider 响应不能直接写入 current version。**

边界必须同时说明：若 Writer 与 Validator 都给出结构合法但语义错误的结果，程序不能识别语义真相；候选可能被标记可采用。它仍需用户/API 显式 adopt 才成为 current。v0.5.0 没有认证，因而不是生产环境的授权安全保证。

## PART 10 — Prompt Removal Test

思想实验：仅将 Writer system prompt 弱化为 `Write text and return JSON.`，不改变程序代码。

### 仍然存在的 PRODUCT CONTROL

- operation/scope 解析；
- selection start/end/exact-text 绑定；
- `full/segment/continuation` 类型契约；
- replace-range / append；
- 绝对尺寸和最小长度；
- task stage、candidate、version/hash；
- source race、validation stale、CAS adopt；
- provider failure/retry/format parsing。

### 会明显消失或退化的 CONTENT QUALITY

- 作者要求优先级；
- 角色、事实、时间线和 negative constraints 的遵循；
- 短剧结构、promise/payoff、机制使用；
- 不复述、信息差、情绪回收等叙事效果；
- 输出 schema 的服从概率也会下降，但错误格式会被程序拒绝。

结论：**产品控制 Prompt-independent；内容智能高度 Prompt/model-dependent。**

## PART 11 — Agent Wrapper Audit

| 角色 | 红队判断 |
|---|---|
| Planner | 是一次额外 LLM call。它产出结构化 ContentPlan 和机制 ID；没有搜索、优化或可证明规划算法。 |
| Writer | 是 OpenAI-compatible Provider call。正文创作能力来自外部模型。 |
| Validator | 是第二类 LLM call，可与 Writer 使用相同 Provider，模型可不同；语义判断并非程序推理。 |

围绕调用存在真实程序行为：`created → planning → planned → generating → generated → validating → completed/failed/abandoned` 状态机、条件 stage claim、持久化、source priority 过滤、blocking confidence threshold、evidence contract、candidate/hash binding 和 adopt gate。

**回答：Multi-Agent 不只是增加调用次数，因为 Validator 的输出会经过程序 gate 并改变 `can_auto_apply`，Plan/Write/Validate 也可独立恢复；但新增的“智能”主要仍来自更多 Prompt/LLM 调用。** 它是受程序约束的多模型工作流，不是自主 Agent 系统，也不是自研 Agent runtime。

## PART 12 — Domain Specificity Audit

### 12.1 Domain Specificity Matrix

| 能力/代码 | 通用 AI text editor | 短剧领域专属 | 判断 |
|---|---:|---:|---|
| works/versions/candidate/history | 高 | 低 | 通用内容编辑 |
| selection/range merge/append | 高 | 低 | 通用编辑器 |
| hash/CAS/retry/task stages | 高 | 低 | 通用可靠性基础设施 |
| output `full/segment/continuation` | 中 | 低 | 长文本工具通用 |
| CreativeBrief 的 operation/scope/preserve | 高 | 中 | 通用 authoring workflow |
| Story Facts 五字段 | 中 | 中高 | 叙事内容特化，但 schema 很轻 |
| ContentPlan identity/conflict/payoff | 低 | 高 | 短剧/故事特化 |
| opening promises / required payoffs | 中 | 高 | 叙事特化 |
| 8 条 Mechanism Library | 低 | 高 | 短剧策划特化 |
| Validator 的事实/时间线/角色一致性 | 中 | 中高 | 长篇创作通用，非短剧独占 |
| 第二人称、系列开场、短剧 UI 文案 | 低 | 高 | 表层领域适配 |

### 12.2 改名为 AI Long Text Editor 的改动估计

以 primary runtime/schema 的约 2,415 行（`worker/`、`web/app.js`、`db/schema.ts`）为基准，函数内部混合了通用控制和领域 Prompt，无法做精确 LOC 二分。保守估计：

- **约 65%–75% 的程序结构无需改变**：Provider transport、任务状态、versions/candidates、selection、merge、hash、CAS、adopt、错误处理、前端候选/历史。
- **约 25%–35% 需要替换或重命名**：短剧 Prompt、CreativeBrief 文案/字段、Story Facts 语义、ContentPlan、Mechanism catalog、Validator domain instructions 和 UI copy。

因此 DramaGo 有真实产品工作流，但短剧 domain model 不是代码主体。Domain specificity 属于中低水平。

## PART 13 — Content Intelligence Audit

1. **算法还是 Prompt orchestration？** 主要是 Prompt orchestration。程序提供 schema、解析、白名单、上限、持久化和 stage；叙事内容由 Planner LLM 生成。
2. **mechanism selection 是否程序决定？** 否。Planner 返回 ID，程序只执行 `resolveContentMechanisms()` 的存在性过滤、去重和最多 5 条限制。
3. **Writer 是否必须服从 mechanism？** 否。机制被加入 Prompt；没有 deterministic verifier 证明机制被使用。
4. **deterministic narrative planning？** 没有。
5. **graph search / constraint solver / scoring？** 没有。
6. **blind A/B 是否支持普遍增益？** 不支持。Flash 三例人工盲评只偏好 enhanced 1 例，direct 2 例；样本为 3，评审者数量/一致性统计未披露，不能外推。

8 条 mechanism 是人工策划的抽象提示目录，不是训练数据、叙事知识图谱或自研叙事模型。真实价值在于把提示策略产品化、可审计化；技术边界是轻量结构增强。

额外事实：当前前端没有传 `create_pipeline`，所以 Content Intelligence 不是 UI 可直接使用的 optional toggle，而是后端 API 能力和实验路径。

## PART 14 — Story Facts Audit

真实数据流：

```text
Validator LLM response.source_story_facts / candidate_story_facts
  → parseSemanticValidationJson()
  → normalizeStoryFacts()
  → story_facts_snapshots(version_id UNIQUE, content_hash, validator_version)
  → 下一次 runValidateStage()::getStoryFacts(source.id, sourceHash)
  → buildSemanticValidatorMessages(sourceFacts)
```

`runWriteStage()` 调用 `buildProviderMessages()` 时没有读取或传入 Story Facts。Writer 只看到 CreativeBrief、context 和完整 source version（以及可选 ContentPlan/mechanisms）。

因此当前分类是：

- A. 真正参与生成长期记忆：**否**；
- B. 主要参与 Validator：**是**；
- C. 只是记录：**不只是记录**，会被后续 Validator 读取，但不影响 Writer 生成。

准确名称是“version/hash-bound validation fact snapshot”。禁止称为完整 Narrative Memory 或 Writer long-term memory。

## PART 15 — Semantic Validator Audit

### Model Judgment

LLM 判断 Story Facts 冲突、时间线、required outcomes、hard/soft preserve、promise/payoff、negative constraints、候选内部一致性、operation completion，并抽取 source/candidate Story Facts。

### Program Enforcement

- blocking finding type 只能属于 8 项 allowlist；
- `severity=blocking`；
- `confidence >= 0.85`；
- evidence 非空、reason 非空；
- ContentPlan/mechanism/soft constraint 来源不能独立 blocking；
- hard constraint finding 必须来自 explicit user hard constraint；
- 与 soft presentation requirement 重复的 finding 被降级；
- checks 绑定 candidate ID + content hash + validator version；
- unavailable 不伪装 passed；
- `can_auto_apply` 与 adopt gate 强制执行。

若 Validator 判断错：

- 程序能保证错误结论不会脱离当前 candidate/hash、证据字段和允许类别，并能限制无证据/低置信/低优先级的误阻断；
- 程序不能保证 evidence 是真实支持、confidence 校准可靠、漏判不存在，或 Writer 与 Validator 不会共同犯错；
- 校准回归改善的是固定样本 precision，不是形式化语义正确性。

## PART 16 — Database Originality Audit

| 表 | 如果没有 DramaGo workflow 是否必要 | 判断 |
|---|---|---|
| `works` | 普通文档编辑器也需要 | generic content root + current pointer |
| `versions` | 版本化编辑器需要；`operation/generated_segment/brief/checks/model/hash/validation/adopted` 是 AI editing workflow 特化 | content workflow model |
| `generation_tasks` | 普通 chat 不需要完整 stage/source hash/merge/output/attempt/validation trace | AI generation workflow model，最强程序证据之一 |
| `story_facts_snapshots` | 普通编辑器不需要；叙事校验需要 | 轻量 domain table，但 facts 仍以 JSON 存储 |
| `adoption_events` | 普通 chat 不需要 candidate/current CAS 审计 | controlled adoption workflow |

这不是 generic chat database：没有 conversation/messages/tool-calls 主模型。它是版本化内容创作 workflow database；短剧领域只在 facts/brief/plan JSON 中较明显，关系型结构本身仍通用。

## PART 17 — Frontend Product Audit

前端不只是 textarea + Generate：

- `bindSelection()` 保存 start/end/text/sourceVersionId；
- 版本变化后旧 selection 被清除；
- CREATE/EXPAND/REWRITE/CONTINUE 构建不同 scope；
- 自动保存 source version 后再生成；
- request snapshot 比较 editor revision/source ID/server `source_is_current`；
- Writer 完成即展示 candidate，Validator 失败仍保留候选；
- candidate 与 source 显示 diff、generated segment、checks、model；
- stale/blocked/unavailable 时禁用 Adopt；
- version history 可加载；本地 draft 与 server version 区分；
- Adopt 单独触发，而非生成结果直接覆盖编辑器。

限制：编辑体验仍是单页轻量工作台；Content Intelligence API 路径没有 UI 开关；没有协作、评论、权限或生产级恢复界面。

## PART 18 — Legacy / Stitched Product Risk

### `script-writer/`

- 不被当前 `worker/index.mjs` import；
- 使用另一套 WritingPacket、Markdown draft parser、marker/regex validator 和 `LOCAL_TEST_ONLY` JSON store；
- artifacts 的正文通过 `ExternalDraftAdapter` 导入，README 明确不是产品 Provider 生成；
- 仍保留 `DramaWorld Script Writer V0.1` 名称。

判定：**legacy experiment / duplicate implementation，不是当前正式架构。**

### `/experience`

Worker 仍公开 `/experience` 和 `/experience/app.js`，它是早期互动实验。当前工作台生成只走 `/api/generate`，没有 API 串路，但它仍是可访问旁路产品。

外部开发者如果只看目录，会合理怀疑这是多个原型拼接：互动 StoryWorld、旧 Script Writer、当前 Workbench 同仓存在。文档虽有解释，但架构边界不够一眼清晰。这是可信度问题，不是 OSS 复制证据。

## PART 19 — Test Evidence Integrity

| 证据类型 | 当前证据 | 能证明 | 不能证明 |
|---|---|---|---|
| PROGRAM LOGIC TEST | `test/*.test.mjs` 22/22 | pure functions、contract、threshold、retry/stage 逻辑 | 真实模型质量 |
| PIPELINE TEST | built Worker + in-memory D1 audit | 真实 API 路由、DB 写入、merge、candidate/adopt gate | 生产 D1/host 全部行为 |
| FAKE PROVIDER TEST | fault A–H、race/tamper/concurrency | 恶意格式和错误不会直接破坏 current | 真实模型语义召回 |
| REAL MODEL TEST | Golden、latency、Flash、Validator calibration | 指定模型在固定输入/环境中的观测结果 | SLA、普遍准确率、普遍内容质量 |
| HUMAN EVALUATION | 3-case blind preference | 这 3 对正文的人工偏好与产品决策 | 统计显著性、广泛作者偏好 |

`PASS_PIPELINE_ONLY` 的精确定义：测试 Provider 被预设为返回某个 semantic finding；测试证明系统能解析、绑定、阻断或降级该 finding，**不证明真实 Validator 模型能从正文中发现问题**。

公开报告大体遵守这一区分，尤其没有把 fake-provider audit 宣传为真实模型准确率。

## PART 20 — Real Model Evidence

| 实验 | 实际结果 | 证明了什么 | 没证明什么 |
|---|---|---|---|
| Golden Set G01–G08 | G01–G07 建 candidate；G08 timeout；未 adopt | 7 条真实 Writer→Validator→candidate 链路与失败隔离 | 8/8 稳定、内容优质 |
| 初始 20-case Validator | 应阻断 15 条实际阻断 9；正常误阻断 0/5；3 条在 Validator 前未评估 | 初版有真实召回缺口且没有掩盖 | 通用准确率 |
| Validator V2 calibration | 固定样本 hard 13/13；normal false blocking 3/5→0/5；2 条 soft warning 保持 | 固定回归 severity precision 改善 | 新数据泛化、事实完整召回 |
| Writer latency | 500/1000/1500/2000 各 2 次共 8/8；2000 平均 78,412 ms，最高 94,406 ms | 旧约90秒来自 45s×2 app timeout；180s 可跨过旧边界 | SLA、P95/P99、host 永不超时 |
| Runtime reliability benchmark | 冻结 8 次 2000字 A/B 全无 candidate；7 timeout、1 stale recovery | stage/失败保护有效；同步长写不稳定 | 可用吞吐 |
| V4-Pro official rerun | 4/8 建 candidate；只有 CI01 有完整 A/B 对 | 失败被保留；不能算全量 A/B 增益 | Content Intelligence 普遍提升 |
| Flash demo stability | 3/3 建 candidate；1 个被 Validator 阻断 | Flash 可作作品集 Demo 候选 | 内容 3/3 通过或生产稳定 |
| Flash independent A/B | 6/6 candidate；同模型/同输入；人工偏好 enhanced 1、direct 2 | 选择性价值与额外延迟 | 胜率、显著性、普遍增益 |

需要注意：这些是不同阶段、不同模型或不同运行的证据，不能把成功数拼成一个统一准确率。

## PART 21 — Remove-the-LLM Thought Experiment

如果 DeepSeek/OpenAI 明天都不存在，仓库仍保留：

- Editor 与本地 draft；
- works/version history；
- selection engine；
- operation/scope router；
- task state machine 与 stale recovery；
- candidate system；
- range merge / continuation append；
- output-kind/size/JSON contracts（没有模型时只能用于其他 deterministic provider）；
- SHA-256 binding；
- CAS adopt 与 adoption audit；
- D1 persistence/migrations；
- fake-provider regression、故障注入和文档。

失去：自动正文创作、内容规划、Story Facts 抽取、语义冲突判断、格式 repair 的智能部分。

剩余部分是有意义的版本化 AI-assisted editor workflow infrastructure，但不是一个能独立创作短剧的完整终端产品。它足以否定“零程序逻辑”，不足以支持“AI 独立”。

## PART 22 — Remove-our-code Thought Experiment

如果删除 DramaGo 自己的代码，只留下 `drizzle-orm`、`drizzle-kit` 和其工具链：

- 得到的是 ORM/schema 工具和构建依赖；
- 得不到工作台 UI、四类 operation、selection merge、candidate、Validator gate、Story Facts、ContentPlan、CAS 或 benchmark。

因此 DramaGo 核心不来自第三方 OSS application。

## PART 23 — Competitive Reproducibility

| 时间 | 优秀团队可复制范围 | 难点/差距 |
|---|---|---|
| 1 day | textarea + Provider + 基础 CREATE/REWRITE，简单保存 | 很难同时做好精确 selection、candidate、CAS、错误注入和 evidence-bound validation |
| 1 week | 可达到多数 L2 workflow：版本、选区 splice、append、output contract、candidate/adopt、基础 tests | 需要复现边界条件、race、stale recovery、报告和前端状态一致性 |
| 1 month | 可达到或超过当前产品，并加 auth/queue/observability/更强 UI；公开代码会进一步降低复制成本 | 真正差异取决于领域数据、真实作者反馈与更强叙事模型，目前这些都弱 |

结论：有工程产品逻辑不等于有强 moat。当前可复制性中高。

## PART 24 — Moat Audit

| Moat | 0–5 | 理由 |
|---|---:|---|
| Workflow moat | 2.0 | 边界处理完整但模式可复制，且代码已开源 |
| Domain model moat | 1.5 | 有 Facts/Plan/Promise/Mechanism，但 schema 轻、模型依赖高 |
| Evaluation moat | 2.0 | 有 Golden、fault injection、latency、blind review 纪律；样本仍小 |
| Data moat | 0.5 | 无规模化私有创作/反馈数据；8 条人工机制不是数据壁垒 |
| Model moat | 0.0 | 使用外部 OpenAI-compatible / DeepSeek 模型，无训练或权重资产 |
| User feedback moat | 0.5 | 有一次小型人工盲评，未见持续真实作者反馈闭环 |
| Engineering moat | 2.5 | CAS/hash/stage/fault tests 有实质，但同步执行、无 auth/queue/SLA |

## PART 25 — License / Attribution Audit

- 项目根 `LICENSE` 为 MIT，copyright `2026 Huidian-drumer`。
- 直接依赖：`drizzle-orm` Apache-2.0；`drizzle-kit` MIT。
- nested 工具依赖为 MIT/Apache-2.0/BSD-3-Clause。
- audited source 未发现第三方版权 header、复制 banner 或外部项目 URL。
- `dist/` 是项目 build artifact；没有发现打包进来的第三方 UI bundle、字体或图片资产。
- 内联 SVG favicon 是项目小型图形代码，没有来源声明命中。

当前证据下没有必须新增 `THIRD_PARTY_NOTICES` 才能继续发布的明确 P0。作为透明度增强，可以在未来加入依赖 license inventory，但不要用 notices 反向暗示复制了完整第三方产品。

## PART 26 — Claim Audit

| Claim | 位置 | 分类 | 证据/问题 |
|---|---|---|---|
| “turns one-shot generation into editable, traceable, validated workflow” | README/Release | SUPPORTED | candidate/version/checks/adopt 均有代码 |
| 四种 operation 有真实差异 | README/Pages | SUPPORTED | selection splice、append、full replace 不同 |
| “More than prompt instructions” | README | SUPPORTED | model-off matrix 与 hostile tests |
| “可靠 L2 + 最小内容保护层” | README/L2 report | AMBIGUOUS | 符合项目自定义 L0–L4 rubric；不是行业认证等级 |
| independent Semantic Validator | README/docs | SUPPORTED WITH QUALIFIER | 独立 stage/call/gate；可使用同一 Provider/甚至同一 fallback model，不是独立真值系统 |
| Semantic Validator 不是形式化证明 | 多处 | SUPPORTED | 与代码/证据一致 |
| Story Facts snapshot + version/hash binding | Release/docs | SUPPORTED | 表与读取路径存在 |
| “上一集事实通过 source version 和 Story Facts 提供约束” | `docs/guide/operations.html` | **OVERSTATED** | source text 进入 Writer；Story Facts 只进入 Validator，不直接约束生成 |
| 没有 Narrative Memory | Release/Roadmap | SUPPORTED | 与调用图一致 |
| Content Intelligence 是 optional CREATE enhancement | README/docs | AMBIGUOUS | API 支持且实验使用；当前 UI 不发送 pipeline flag |
| Content Intelligence 由 real-model + human blind review 验证 | Pages | AMBIGUOUS | 只支持三案例 qualitative/selective 结论；不能理解为普遍提升 |
| 3-case selective—not-universal | README/Pages | SUPPORTED | 与盲评 summary 一致，但 evaluator 数量和一致性未披露 |
| Validator 3/5→0/5、13/13 | README/Pages | SUPPORTED WITH SAMPLE LIMIT | 固定 20 条 regression，不是通用准确率 |
| 45s×2 解释约90秒 | README/Release | SUPPORTED | 代码 timeout/retry 与 94,406 ms 成功实验一致 |
| “real-model experiments complete” | README/Release | AMBIGUOUS | 计划内实验已结束；不能理解为产品质量验证完成 |
| “Validated Portfolio MVP” | 全站 | AMBIGUOUS | 工程验证充分；真实作者/规模化内容验证不足，必须保留 portfolio qualifier |

必须禁止的宣传：自研叙事模型、完整 Narrative Memory、Validator 100% 准确、Content Intelligence 普遍提升、生产级稳定/SLA、无法被 Prompt Wrapper 复刻、强数据/模型 moat。

## PART 27 — Final Classification

### 主分类

**D. AI APPLICATION WITH MEANINGFUL PROGRAM LOGIC**

### 为什么不是其他类别

- **不是 A OPEN_SOURCE_REPACKAGE**：没有 upstream/fork/import/依赖/相似代码证据指向完整 OSS 产品。
- **不是 B PURE_LLM_WRAPPER**：range/append/version/candidate/hash/CAS/stage/failure safety 独立于模型。
- **不是 C AGENT_ORCHESTRATION_WRAPPER**：Planner/Writer/Validator 确实是 LLM calls，但外围程序决定持久化、范围和 adopt，产生了模型外产品行为。
- **不是 E DOMAIN AI SYSTEM**：领域规划、事实提取和语义判断没有独立算法，短剧 schema 轻且大部分控制可泛化到文本编辑器。
- **不是 F PROPRIETARY AI ENGINE**：没有自研模型、训练、推理引擎、constraint solver 或专有数据闭环。

Secondary classification：**domain-adapted L2 AI text-editing workflow with model-mediated semantics**。

## PART 28 — Score

分数方向：风险项 5 为高风险；能力项 5 为强。

| 维度 | 分数 | 理由 |
|---|---:|---|
| Open-source repackage risk | **0.5/5** | 没发现产品级来源；保留 0.5 因快照历史不能证明绝对原创 |
| Prompt-wrapper risk | **2.0/5** | 内容智能依赖 Prompt/LLM，但核心编辑/采用安全不是 Prompt |
| Program logic independence | **4.0/5** | model-off 下大多数 workflow guarantees 成立；语义正确性不成立 |
| Domain specificity | **2.0/5** | 有 Plan/Facts/Mechanisms，但 65%–75% 结构可改名复用 |
| AI independence | **3.0/5** | 无模型仍有可用 workflow infrastructure，但不能完成核心自动创作 |
| Data moat | **0.5/5** | 无规模专有数据/反馈 |
| Model moat | **0.0/5** | 完全依赖外部模型 |
| Engineering robustness | **3.0/5** | race/hash/CAS/fault/stage 做得扎实；同步、无 auth/durable execution |
| Evidence integrity | **4.0/5** | 失败和小样本限制被保留；仍缺外部复现、多人评审和完整 provenance |
| Product differentiation | **2.5/5** | candidate/adopt + scope safety 有辨识度；短剧智能层差异化有限 |

## PART 29 — Red Team Verdict

1. **是不是开源项目换皮？** 未发现证据；当前应答是“不是”，置信度高但非法律证明。
2. **是不是 Prompt Wrapper？** 不是纯 Prompt Wrapper；生成与语义层仍有显著 Prompt-wrapper 成分。
3. **是不是 Agent Wrapper？** 不是只有多 Agent 名字的壳；但 Planner/Writer/Validator 的智能本身就是多次 LLM 调用，不应包装成自主 Agent engine。
4. **最核心的原创产品逻辑是什么？** 精确 scope → 程序 merge/append → isolated candidate → hash-bound validation → source-aware CAS adopt 的闭环，以及 stage/failure/idempotency 控制。
5. **哪部分主要由 LLM 提供？** 正文、ContentPlan 内容、机制选择、Story Facts 抽取、事实/时间线/完成度判断和 format repair。
6. **最容易被面试官质疑什么？** “Content Intelligence”名称大于算法含量；Story Facts 不是 Writer memory；公开快照和遗留双实现使原创演进/架构边界不够直观。
7. **哪些宣传必须禁止？** 自研叙事模型、完整 Narrative Memory、通用准确 Validator、普遍内容提升、生产 SLA、强 moat、100% 非套壳。
8. **哪些能力可以理直气壮展示？** duplicate-safe selection、programmatic splice/append、output-kind/size contracts、candidate isolation、race/hash/CAS、validator evidence gate、fault injection、真实失败记录。
9. **是否需要重构才能摆脱“套壳”评价？** 不需要为了否定“纯套壳”而重构；现有 model-off 证据已足够。若要升级为 Domain AI System，才需要更深的领域状态/因果模型、generation memory、可验证 planning 与真实反馈数据。
10. **当前属于什么层级？** 可靠的作品集级 AI application / L2 content workflow；不是生产 SaaS、领域 AI engine 或 proprietary model。

## PART 30 — Remediation

### P0 — 不修不能继续公开宣传（0）

未发现必须立即撤下仓库、license 违规、直接 current overwrite 或被复制产品的 P0。

### P1 — 影响产品可信度（4）

1. **纠正 Story Facts 能力边界**：公开文案不得暗示它进入 Writer 或形成长期生成记忆。当前只给 Validator 提供 version-bound facts。
2. **明确 Content Intelligence 的真实可达性和技术形态**：后端 API 支持但 UI 未暴露；机制选择由 Planner 模型完成，Writer 服从仅靠 Prompt。避免把它称为自研算法/模型。
3. **隔离或显著标记 legacy surface**：`script-writer/` 与 `/experience` 会制造“拼接原型”观感。当前不要求删除，但架构图/目录说明应把它们从正式路径中清楚分离。
4. **加强 provenance 可验证性**：public snapshot 与内部演进能说明来源路线，但 major files 仍无法被独立证明为 project-original。未来可保留设计记录、带日期 ADR、作者签名/attestation 或更连续的公开开发历史；不要伪造历史。

### P2 — 提升长期壁垒（5）

1. 若追求 E 类 Domain AI System，让 typed Story Facts/character/time state 进入 Writer，并保持 author override/version semantics。
2. 为 ContentPlan 增加可验证的 causal constraints / payoff coverage，而不是只把机制注入 Prompt。
3. 建立多作者、盲评、多轮修改的持续 evaluation/data loop；保存评审一致性与失败分布。
4. 增加 durable execution、auth、权限和 observability 后再讨论生产稳健性。
5. 可选增加 dependency/license inventory 或 `THIRD_PARTY_NOTICES`，作为透明度而非“原创证明”。

---

## Final concise finding

- Final classification：**D — AI APPLICATION WITH MEANINGFUL PROGRAM LOGIC**
- Open-source repackage risk：**0.5/5（低）**
- Prompt-wrapper risk：**2.0/5（存在于内容/语义层，但不是产品整体）**
- Program-logic independence：**4.0/5**
- Domain specificity：**2.0/5**
- P0：**0**
- P1：**4**


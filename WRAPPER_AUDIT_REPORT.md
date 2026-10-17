# CREATIVE_WORKBENCH_WRAPPER_AUDIT

审计时间：2026-09-25  
审计对象：开戏 DramaGo AI 短剧创作工作台当前仓库与 `dist/server/index.js` 构建产物
审计方式：白盒代码追踪；通过真实 Worker `fetch` 入口调用 `/api/generate`、`/api/versions/save`、`/api/versions/adopt`；内存 D1 兼容适配器；可控 OpenAI-compatible Test Provider 进行黑盒故障注入  
生产实现修改：**无**。仅新增 `audit/` 下的审计夹具、结果和本报告；未发布、未改 UI、未改业务行为。

## 结论

当前系统不是单纯的 `UI → Prompt → LLM → Text`。选区定位、选区替换、续写追加、不可变候选版本、显式采用和错误保护都是真实程序逻辑，因此评级为：

> **L2（下沿）**：已有 operation、scope、程序合并、candidate/adopt 和失败保护；但版本并发保护存在可复现漏洞，内容事实与上下文判断主要依赖模型，片段输出契约也未被程序强制。

换句话说，去掉模型智能后，产品仍剩下一个可用的“版本化文本编辑执行框架”，但还不是可靠的“创作逻辑系统”。它可以准确地把某段文本替换到指定字符区间，或把新增段落追加到末尾；它不能判断新内容是否违背人物事实、时间线、作者意图，也不能阻止模型用整篇正文冒充片段。

最严重的三个风险：

1. **旧候选覆盖新版本（严重）**：基于 V5 的生成在 V6 保存后仍会返回 `source_is_current=true`，`adopt` 也不检查候选父版本是否等于当前版本；实测可用 V5 候选覆盖 V6。
2. **内容级越界没有程序防线（高）**：事实冲突、时间线冲突、prompt injection 后的异常输出、`preserve` 语义改写都不会阻断采用。
3. **片段/全文契约不受控（高）**：选区 EXPAND/REWRITE 返回整篇时，系统会把整篇插进选区，造成前后文重复，仍标记 `can_auto_apply=true`。

## 1. 四种操作的真实调用链

### 1.1 公共链路

| 阶段 | 真实文件与函数 | 实际数据/行为 |
|---|---|---|
| Frontend component | `web/index.html` 的操作按钮、正文编辑器、选区工具栏；`web/app.js:97 setOperation`、`:130 bindSelection`、`:336 generate` | 前端状态结构包含 `operation/work/currentVersion/versions/candidate/selection/editorRevision`。选区绑定保存 `start/end/text/sourceVersionId`。 |
| request payload | `web/app.js:316 buildBrief`、`:370 generate` | POST `/api/generate`：`{work_id, context, brief, source_hash}`。`brief` 包含 operation、source_version_id、target_scope、user_instruction、preserve、freedom、output_preferences。 |
| API endpoint | `worker/index.mjs:309 handleApi`、`:318 fetch` | `/api/generate` 唯一生成入口；`/api/versions/save` 保存手动版本；`/api/versions/adopt` 采用候选。 |
| CreativeBrief creation | `worker/core.mjs:44 createCreativeBrief` | 校验 operation 和 instruction，归一化 `required_outcomes`、`preserve`、`freedom`、输出偏好。 |
| operation routing | `worker/core.mjs:171 buildProviderMessages`；`:99 mergeModelResult` | operation 同时影响系统提示和程序合并分支，不只是提示词字段。 |
| source version loading | `worker/index.mjs:72 getVersion`；`:235 generateCandidate` | 按 `source_version_id` 读取不可变版本，校验 `work_id`；非 CREATE 必须有源版本。 |
| source hash | `worker/core.mjs:77 assertSourceVersionHash` | 验证客户端提交的 hash 是否匹配被点名的版本内容；**不验证该版本仍是作品 current version**。 |
| target scope resolution | `web/app.js:316 buildBrief`；`worker/core.mjs:85 assertSelection` | 前端将选择转为 start/end/selected_text；后端用字符范围和原文逐字验证，不做全文搜索。 |
| prompt construction | `worker/core.mjs:171 buildProviderMessages` | system 里放 operation 规则、素材注入隔离声明和 JSON schema；user 里放 CreativeBrief、context、完整 source version。无 `prompt_template_id`。 |
| provider call | `worker/index.mjs:147 requestProviderOnce`、`:185 callProvider` | 一个 OpenAI-compatible chat-completions 调用；传输最多两次，格式修复最多两轮；未配置时明确失败。 |
| provider response | `worker/core.mjs:196 parseModelJson` | 仅验证可解析 JSON 且 `content` 是 string；不验证长度、片段/全文类型、事实一致性。 |
| merge/append | `worker/core.mjs:99 mergeModelResult` | CREATE/full scope 直接取模型全文；selection 用 start/end 替换；CONTINUE 程序追加并记录 `generated_segment`。 |
| validation | `worker/core.mjs:127 runDeterministicChecks` | 仅逐字 preserve、选区外前后缀、续写前缀、简单重复开头；作者意图与质量固定为 `unassessed`。 |
| candidate save | `worker/index.mjs:235 generateCandidate`；`db/schema.ts:11 versions`、`:32 generationTasks` | 候选写入 `versions(status=candidate,parent_version_id=source)`；任务写入 result_version_id/provider/model/usage。 |
| adopt | `web/app.js:400 adoptCandidate`；`worker/index.mjs:295 adoptVersion` | 检查版本属于 work 且 checks 无 `fail`，然后更新 `works.current_version_id`。未检查父版本是否仍为 current，也未验证 task→candidate 来源。 |

### 1.2 CREATE

真实路径：

`setOperation('CREATE') → generate → buildBrief(target_scope=full) → POST /api/generate → handleApi → generateCandidate → createCreativeBrief → 可选加载 source → buildProviderMessages(CREATE) → callProvider → parseModelJson → mergeModelResult(CREATE) → runDeterministicChecks → INSERT candidate → 用户 adopt`

程序行为：模型返回的 `content` 被视为完整作品并直接成为候选全文。若当前编辑器有脏内容，前端会先保存，CREATE 也可能携带 source 作为提示上下文，但合并阶段仍是模型全文替换。

### 1.3 EXPAND

选区路径：

`bindSelection(start,end,text,sourceVersionId) → buildBrief(target_scope=selection) → generateCandidate 加载精确 source → assertSelection → Provider 只被提示返回目标内容 → mergeModelResult 用 slice(0,start)+segment+slice(end) → SELECTION_SCOPE 检查 → candidate → adopt`

程序行为：**选区定位与合并是真程序逻辑**。但“只返回片段”“不改变事实”是提示约束；若 Provider 返回整篇，程序仍把它当片段插入。

全篇 EXPAND：`target_scope=full` 时没有程序局部合并，模型全文直接替换候选内容。

### 1.4 REWRITE

链路与 EXPAND 共用同一 endpoint、Provider 调用和合并函数。不同点有两处：

- `buildProviderMessages` 使用 REWRITE 专属规则，明确作者新要求优先于旧设定。
- selection 时仍按精确范围替换；full 时模型全文直接替换。

因此 REWRITE 具有真实范围管理，但“如何改变目标范围、需要联动哪些事实”完全依赖模型，没有修改影响分析器。

### 1.5 CONTINUE

真实路径：

`buildBrief(target_scope=next_segment) → generateCandidate 加载 source → buildProviderMessages(CONTINUE，只要求新增段落) → callProvider → mergeModelResult 执行 source.rstrip + 两个换行 + generated → generated_segment 单独入库 → CONTINUATION_PRESERVES_SOURCE → candidate → adopt`

程序行为：**前文不会交给模型重写后再整体保存，而是由程序 append**。这是与普通 Prompt Wrapper 的实质差异。

## 2. 四种操作是否只是同一个 Wrapper

判定：**不是纯 WRAPPER_RISK，但存在局部 WRAPPER_RISK。**

- CREATE：同一个 Provider，模型全文直接作为候选；属于典型全文生成路径。
- EXPAND：selection 情况有精确字符范围和程序合并；full 情况退化为模型全文替换。
- REWRITE：selection 情况有程序合并；full 情况退化为模型全文替换。
- CONTINUE：模型只返回新增段落，程序 append，且保存 `generated_segment`。

四种 operation 的 Provider endpoint 和 JSON schema相同，这本身不是问题；关键是 selection 和 CONTINUE 有不同的确定性后处理。真正的 Wrapper 风险位于内容理解、语义保护、全篇操作和输出契约验证。

## 3. 黑盒 + 白盒测试结果

测试执行的是构建后的 `dist/server/index.js` Worker 入口，不是另写一套合并实现。D1 用接口兼容的内存适配器隔离数据；Provider 是可控测试双桩。固定文本只作为故障输入，不进入生产响应路径，也不被表述为真实模型生成。

| 测试 | 结果 | 实际证据 |
|---|---|---|
| TEST 1 — Operation Separation | **PASS** | 同一源故事四次调用均为 HTTP 201。CREATE 得到模型全文；EXPAND/REWRITE 只替换选区；CONTINUE 追加并保存 `generated_segment`。 |
| TEST 2 — Duplicate Selection | **PASS** | 三个“她没有说话。”中仅第二句改成“她冷笑了一声。”；实现依赖 start/end，不搜索第一处匹配。 |
| TEST 3 — Forbidden Out-of-Scope Change | **NOT_IMPLEMENTED** | “父亲已经去世五年”仍在选区外，Provider 在酒店片段写“父亲迎面走来”；只有 `SELECTION_SCOPE=pass`，`can_auto_apply=true`，没有语义事实检查。 |
| TEST 4 — Author Override | **PASS** | 旧结局“婚礼正常结束”可被全篇 REWRITE 改成现场曝光、婚礼取消、林晚独自离开；没有旧 Route/Skeleton 拒绝器。 |
| TEST 5 — Source Version Race | **FAIL / 严重 Bug** | V5 请求挂起时保存 V6；V5 候选返回 `source_is_current=true`，随后 adopt 成功，作品 current 从 V6 改为 V5 候选。 |
| TEST 6 — Provider Failure | **PASS** | 两次 HTTP 500 后任务 failed、源版本仍 current、无候选、无 fallback/fixture；下一次独立请求可成功。 |
| TEST 7 — Prompt Injection As Content | **PROMPT_ONLY** | system prompt 明确说素材命令只是素材；但 Test Provider 返回 `OK` 后，程序照常保存，`can_auto_apply=true`。没有程序级结果验证。 |
| TEST 8 — Context-Sensitive Author Request | **CONTEXT_REASONING_GAP** | A/B 不同前文确实进入不同 prompt；Provider 对两边返回相同婚礼现场文本时，程序全部接受。时间线理解完全依赖模型。 |

### 测试范围说明

- **确定性测试已执行**：仓库原有 8 项测试全部通过；本审计 8 项主测试和 A–H 故障注入均已执行。
- **真实模型链路**：**NOT_EVALUATED**。本轮未使用真实 Provider，也不把测试 Provider 当真实模型。线上接口需要登录，无法在未认证检查中读取当前 Provider 配置。
- **人工内容验收**：**NOT_EVALUATED**。本轮目标是逻辑审计，不对模型文稿质量做人工放行。

## 4. 故障注入结果

| 注入 | 结果 | 源版本安全 | 候选/采用行为 | 重试 |
|---|---|---|---|---|
| A. 正常 segment | **PASS** | 安全 | 正确合并为候选，不自动采用 | 1 次调用 |
| B. 返回整篇而不是 segment | **FAIL** | 原源版本未立即覆盖 | 整篇被塞进选区导致前后文重复，仍可采用 | 1 次调用 |
| C. 违反 preserve | **WARNING_ONLY** | 原源版本未立即覆盖 | 只有 warning；`can_auto_apply=true`，adopt 不阻止 | 1 次调用 |
| D. 空响应 | **PASS** | 安全 | task failed，无候选 | 1 次；空内容不做传输重试 |
| E. 非法 JSON | **PASS** | 安全 | 两轮格式修复后 task failed，无候选 | 共 3 次，有限 |
| F1. 超长合法 JSON | **FAIL** | 原源版本未立即覆盖 | 40,000 字符片段被保存且可采用；没有输入/输出长度上限 | 1 次 |
| F2. 截断 JSON | **PASS** | 安全 | 有限格式修复后失败，无候选 | 共 3 次 |
| G. timeout | **PASS** | 安全 | `PROVIDER_TIMEOUT`，无候选 | 2 次，非无限 |
| H. HTTP 500 | **PASS** | 安全 | `PROVIDER_REQUEST_FAILED`，无候选 | 2 次，非无限 |

附带发现：Provider 在失败路径上的真实尝试次数没有写入任务。`generateCandidate` 只有在 `callProvider` 整体成功后才拿到 `providerCall.attempts`；失败时 `failTask(..., providerCall?.attempts || 0)` 会记录 0，即使实际已经请求两次。

## 5. Creative Trace

### 生产数据当前实际覆盖

`generation_tasks` 已记录 task_id、work_id、source_version_id、creative_brief_json、source_hash、status、provider、model、usage、result_version_id、attempt_count、错误；`versions` 已记录 parent_version_id、operation、完整候选、generated_segment、CreativeBrief、checks、model、usage、adopted_at。

但生产系统没有一个完整的开发态 Creative Trace，也缺少这些明确字段：

- `prompt_template_id`
- 显式 `merge_strategy`
- 独立、脱敏的 `selection_range`
- validator 与候选正文 hash 的绑定
- `adopt_status` 事件记录
- 对 required_outcomes/preserve 的脱敏摘要策略

本轮审计工具从实际 task/version 行派生出脱敏 Trace；本次 22 个生成任务（包括成功、失败和一次采用）均有条目。它是**审计观测物，不冒充生产已实现功能**：

```json
{
  "task_id": "task_<uuid>",
  "operation": "EXPAND",
  "source_version_id": "ver_<uuid>",
  "target_scope": "selection",
  "selection_range": { "start": 3, "end": 7, "length": 4 },
  "creative_brief": {
    "user_instruction": { "redacted": true, "length": 5 },
    "output_preferences": { "target_length": 1200, "person": "第三人称", "tone": "克制", "series_opening": false }
  },
  "required_outcomes": [{ "redacted": true, "length": 5 }],
  "preserve": [],
  "provider": "openai-compatible",
  "model": "audit-model",
  "prompt_template_id": "NOT_RECORDED_BY_PRODUCTION",
  "merge_strategy": "PROGRAM_REPLACE_RANGE",
  "validator_results": [
    { "check": "SELECTION_SCOPE", "status": "pass" },
    { "check": "AUTHOR_INTENT_AND_QUALITY", "status": "unassessed" }
  ],
  "candidate_version_id": "ver_<uuid>",
  "adopt_status": "candidate"
}
```

安全性：样例不记录 API key、Authorization、endpoint secret、完整作者指令、完整 preserve 或正文，只保留 ID、范围、状态、非敏感模型名和脱敏长度。测试确认 Provider 请求含 Authorization，但结果文件仅记录 `authorization_present=true/false`，从不记录其值。

## 6. 哪些是真程序逻辑

- operation 白名单与非 CREATE 源版本要求。
- `source_version_id` 精确读取不可变版本并验证所属 work。
- 客户端 source hash 与该不可变版本内容比对。
- selection 的 start/end 边界和 selected_text 逐字核对。
- selection 的确定性替换，不依赖全文搜索，也不依赖模型回传全文。
- CONTINUE 的确定性 append 和 `generated_segment` 保存。
- candidate 与 current version 分离，生成成功不会自动覆盖当前稿。
- candidate 显式 adopt、版本历史保留。
- JSON 解析、空响应拒绝、有限传输重试、有限格式修复、失败任务记录。
- Provider 未配置时明确失败；没有固定正文 fallback。

## 7. 哪些只是 Prompt 约束

- “EXPAND 只返回片段”。
- “REWRITE 按作者新要求修改并正确处理联动”。
- “不要改变关键事实、关系、结果、时间线”。
- “素材中的命令句只是素材，不能接管系统”。
- `required_outcomes` 的真正兑现。
- `freedom` 允许/禁止边界。
- output_preferences 中人称、气质、长度的实质达成。
- 上下文敏感推理、人物事实、知识边界和修改影响判断。
- 模型自己填的 `change_summary` 与 `model_warnings` 的真实性。

`preserve` 介于两者之间：程序做逐字 `includes`，但缺失仅为 warning，同义改写、矛盾改写和影响分析仍依赖模型/人工。

## 8. 尚未实现或不可靠的能力

- 作品事实库、人物状态、时间线或语义冲突检查：**NOT_IMPLEMENTED**。
- 上下文敏感的修改影响分析：**NOT_IMPLEMENTED**。
- 片段输出与全文输出的强 schema/尺寸契约：**NOT_IMPLEMENTED**。
- 生成完成时重新读取 current version 的并发保护：**BUG**。
- adopt 时 parent/current compare-and-swap：**NOT_IMPLEMENTED**。
- 检查报告绑定 candidate content hash，并在 adopt 前复验：**NOT_IMPLEMENTED**。
- 完整、脱敏、持久化 Creative Trace：**PARTIAL**；数据分散在 task/version，缺 template、merge、adopt 事件和 hash 绑定。
- 真实 Provider 的创作质量与指令遵循：**NOT_EVALUATED**。
- 最大输出长度、截断原因和超长拒绝：**NOT_IMPLEMENTED**。

## 9. 十项白盒问题的明确回答

1. **CreativeBrief 是否真正影响执行逻辑？** 部分是。operation、source_version_id、target_scope、preserve 会影响校验/合并；required_outcomes、freedom、输出偏好主要只进入 Prompt。
2. **source_version_id 是否用于并发保护？** 只用于加载与验证指定源版本，不足以保护 current 指针。它没有在生成完成或 adopt 时与 `works.current_version_id` 比较。
3. **selection_range 是否参与程序合并？** 是。start/end 和 selected_text 均校验，随后用字符串切片精确替换。
4. **EXPAND/REWRITE 的模型输出是否能直接覆盖全文？** 能。`target_scope=full` 时模型 content 直接成为候选全文；selection 时不会直接覆盖全文，但能以“整篇冒充片段”的方式污染选区。
5. **CONTINUE 是否程序 append？** 是。程序追加，模型不提交重写后的全文；同时保存 generated_segment。
6. **Provider 失败是否有假成功 fallback？** 未发现。空响应、无配置、非法 JSON、timeout、HTTP 500 都失败且不建候选。
7. **fixture 是否可能进入正式响应路径？** 未发现生产代码中的 fixture/fixed正文分支。审计 Test Provider 只存在 `audit/`，不会被构建脚本打包进生产 Worker。
8. **检查报告是否绑定候选正文 hash/version？** 不可靠。checks JSON 与候选内容同处一个 version 行，但没有 content hash、validator version 或 adopt 前复验。
9. **adopt 是否验证 candidate 来源与当前作品？** 只验证 `version.work_id === input.work_id` 和没有 fail；不验证该版本由哪个 task 产生、不要求 status=candidate、不验证 parent 等于 current。
10. **`/experience` 旧 Resolver 是否还能收到创作请求？** 主工作台不会把 CREATE/EXPAND/REWRITE/CONTINUE 发给旧 Resolver；所有生成请求只走 `/api/generate`。但 `/experience` 路由仍公开提供独立 legacy 页面，其 `resolvePlayerAction` 仍可处理该页面自己的输入。两者没有 API 级串路，旧功能仍是可访问的旁路界面。

## 10. 当前 Wrapper 等级

| 等级 | 判定 |
|---|---|
| L0：UI → Prompt → LLM → Text | 不符合；已有确定性 scope/merge/version/error 逻辑。 |
| L1：不同 Prompt 和保存，编辑范围主要依赖模型自律 | 部分符合全篇操作和语义层。 |
| **L2：operation、scope、程序合并、版本保护、candidate/adopt、错误保护** | **当前总体等级，但为下沿**。版本保护的核心 race 有漏洞。 |
| L3：可靠事实、影响分析、连续记忆、内容级验证 | 不符合。 |
| L4：参考机制、反馈学习、批量多样性控制 | 不符合，且不在本轮范围。 |

评级不依据 PRD、旧报告或模型自评，只依据本次代码定位和可复现测试。

## 11. 下一步最小修复建议

本轮不实施修复。按风险优先级，最小修复应是：

1. **先修并发采用**：生成返回前重新读取 work；若 current_version_id 不等于 source.id，则 `source_is_current=false`。adopt 使用条件更新/CAS：仅当 `works.current_version_id == candidate.parent_version_id` 时采用，否则返回 `SOURCE_VERSION_CONFLICT`，候选继续保留。
2. **强制片段契约和尺寸上限**：Provider schema 明确 `output_kind=segment|full`；selection 操作拒绝疑似整篇/超限返回；设置最大响应体和生成段长度。不要靠 Prompt 说明。
3. **增加最小内容保护层**：先实现显式事实锁/时间锚点/作者 required_outcomes 的结构化检查，并把检查结果绑定 `candidate_version_id + content_hash + validator_version`；严重冲突阻断 adopt，不能只 warning。

Creative Trace 的最小补齐可以随上述修复一起做：生成时写入 `prompt_template_id` 与 `merge_strategy`，adopt 单独记录事件；指令与正文默认只保存 hash、长度和必要的脱敏摘要。

## 12. 可复核材料

- 审计脚本：`audit/run-wrapper-audit.mjs`
- D1 测试适配器：`audit/fake-d1.mjs`
- 逐项机器结果：`audit/WRAPPER_AUDIT_RESULTS.json`
- 脱敏 Trace 样例：`audit/CREATIVE_TRACE_SAMPLE.json`
- 生产核心：`worker/core.mjs`、`worker/index.mjs`
- 前端链路：`web/app.js`
- 持久化结构：`db/schema.ts`

复核命令：`node audit/run-wrapper-audit.mjs`。本轮同时执行 `npm test`、`npm run build`、`npm run validate`，均通过；审计中的 FAIL/NOT_IMPLEMENTED 是被保留的真实产品缺口，不通过修改测试数据或降低标准消除。

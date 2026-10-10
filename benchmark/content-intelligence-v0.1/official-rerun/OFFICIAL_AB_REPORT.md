# CONTENT_INTELLIGENCE_V0.1 — OFFICIAL A/B RERUN

执行日期：2026-10-08
生产地址：https://dramaworld-v01.huidian31.chatgpt.site
正式调用数：8
候选建立数：4
无候选失败数：4
内容质量结论：等待人工 Blind Content Review

## 1. 冻结环境

- Workbench：`0.5.0-writer-latency-validator-calibration-v0.3`
- 用户指定基线：Sites v11 runtime
- 实际 live version：Sites v12
- 运行时等价说明：v11 与 v12 的部署产物 SHA-256 均为 `2f7a86e01303c3203e4f7616ab322bb50b8cf8ef3b09e60aa5b07884a3811ef1`；v12 仅增加基准报告并清理源码仓库中的临时发布压缩包，没有改变 Worker 运行代码
- 环境变量 revision：4
- Writer：`deepseek-v4-pro`
- Planner：`deepseek-flash`
- Validator：`deepseek-flash`
- `PROVIDER_TIMEOUT_MS=180000`
- Golden 输入 SHA-256：`8340cf7403b2fd7c97c9c8130f185f13603b98e3d3f4bf446dd29ba0ada072a0`
- `target_length=2000`
- 全部调用严格串行
- 没有修改代码、Prompt、ContentPlan、机制库、机制召回、模型、Validator 或 CI01–CI04 输入

## 2. A/B 执行定义

A：

`CreativeBrief → creative-writer-v2 → Validator V2`

未调用 Planner，未注入机制库。

B：

`CreativeBrief → ContentPlan → Mechanism Retrieval → creative-writer-v3-content-plan → Validator V2`

8 次正式任务各执行一次。没有补跑、人工续写、fixture、Codex 补稿、缩短篇幅或临时换模型。

## 3. 正式结果

Token 列顺序为 Writer 的 `prompt/completion/reasoning/total`。Planner 与 Validator 用量保存在 `machine_results.json` 的独立字段中。

| Case | Group | Result | Task ID | Candidate | Plan ms | Write ms | Validate ms | Total ms | Writer tokens | Validation | Auto apply |
|---|---|---|---|---|---:|---:|---:|---:|---|---|---|
| CI01 | A | CANDIDATE_CREATED | task_e985dd82c93640c183c5b37404b07eb8 | ver_c8f4272e839d417587ea1a1af0ef5b46 | — | 105548 | 9101 | 122279 | 783/6667/5463/7450 | passed | true |
| CI01 | B | CANDIDATE_CREATED | task_8fac036392e24b1a9306b9778d84dc6c | ver_9ba4fcd485ac4e279a6a38e46ac8000c | 6665 | 119134 | 11485 | 144484 | 2932/7386/6153/10318 | passed | true |
| CI02 | A | FAILED_NO_CANDIDATE | task_54f05af0d88640428e0d511e5e40abf8 | — | — | 76542 | — | 80965 | —/—/—/— | pending | false |
| CI02 | B | FAILED_NO_CANDIDATE | task_a4d3897bd50048ccb59dcf8b829e4a5b | — | 12293 | 180991 | — | 198866 | —/—/—/— | pending | false |
| CI03 | A | CANDIDATE_CREATED | task_2b18566edeb94d4daff1832e749532a7 | ver_b51d3c6c836f4178b09783870e8f0fbb | — | 63504 | 16441 | 85694 | 879/2692/1347/3571 | passed | true |
| CI03 | B | FAILED_NO_CANDIDATE | task_e76596b635cb402b9bef38ac7604f7f6 | — | 10020 | 27228 | — | 48045 | —/—/—/— | pending | false |
| CI04 | A | CANDIDATE_CREATED | task_10b4d48632cb44e5ae8b34acecae9359 | ver_292be980e5774bfc9d7bf56c25bd062c | — | 82439 | 43810 | 133965 | 867/3767/2800/4634 | passed | true |
| CI04 | B | FAILED_NO_CANDIDATE | task_a9b7288392a6443191b9abd03e3b2b88 | — | 8105 | 64396 | — | 80381 | —/—/—/— | pending | false |

结果计数：

- A：3/4 建立候选。
- B：1/4 建立候选。
- 共 4 个候选正文，全部原样保留、未采用、未人工修改。
- 成功建立的 4 个候选 Validation 均为 `passed`。
- 其余 4 次正式调用没有候选正文，未运行 Validator。

## 4. Validator 记录

| Run | Blocking findings | Warnings | Validator |
|---|---:|---:|---|
| CI01-A | 0 | 0 | deepseek-flash |
| CI01-B | 0 | 2 | deepseek-flash |
| CI02-A | 0 | 0 | 未运行 |
| CI02-B | 0 | 0 | 未运行 |
| CI03-A | 0 | 2 | deepseek-flash |
| CI03-B | 0 | 0 | 未运行 |
| CI04-A | 0 | 4 | deepseek-flash |
| CI04-B | 0 | 0 | 未运行 |

`validation=passed` 只表示当前事实和约束保护检查没有形成程序阻断，不表示正文质量优秀。

## 5. 工程失败记录

### CI02-A

- WRITE Worker 日志：`outcome=canceled`
- Worker wall time：75,644 ms
- CPU time：7 ms
- 没有候选版本
- 最终任务状态：`abandoned / STAGE_STALE`

### CI02-B

- PLAN 成功，ContentPlan 与机制召回已保存
- WRITE Worker 日志：`outcome=canceled`
- Worker wall time：122,633 ms
- 客户端观察 WRITE 请求：180,991 ms
- 没有候选版本
- 最终任务状态：`abandoned / STAGE_STALE`

### CI03-B

- PLAN 成功，ContentPlan 与机制召回已保存
- WRITE Worker 日志：`outcome=canceled`
- Worker wall time：30,795 ms
- 客户端错误：`TypeError: fetch failed`
- 没有候选版本
- 最终任务状态：`abandoned / STAGE_STALE`

### CI04-B

- PLAN 成功，ContentPlan 与机制召回已保存
- WRITE 客户端 HTTP：500
- 没有候选版本
- 最终任务状态：`abandoned / STAGE_STALE`

以上均保留为真实失败，没有重新触发 WRITE。

## 6. 指定结构记录

### CI01

“是否仍出现明显通用苦难模板”：`NOT_AUTOMATICALLY_EVALUATED`。该问题留给人工盲评，不由 Codex 或 Validator 判断。

### CI02-B

ContentPlan 的 `opening_promises`：

- 观众先知道你是低调进入普通公司的豪门继承人，而公司同事不知道。
- 你会把底牌留到关键处，但延后公开有与目标相关的理由，不靠角色突然失去常识来维持误会。
- 故事会出现一件只有你能解决或处理得更好的具体事务，且解决必须由你的行动推动。
- 身份优势会发挥作用，但不会完全替代你的判断、选择和执行。

ContentPlan 的 `required_payoffs`：

- 身份信息差在关键节点兑现：观众已知的底牌影响你的判断、资源或责任选择，并产生可观察结果。
- 核心事务由你亲自推进并解决或处理更好，身份资源只作辅助杠杆。
- 公司内部态度变化通过称呼、站位、授权、回应速度等具体行为呈现，而非旁白宣布或集体道歉。
- 避开大客户突然上门、舅舅大伯轮流出场、车队堵门、所有人集体道歉等俗套兑现方式。
- 结尾完整收束，不强行加神秘短信。

这里只确认 Plan 已记录 identity promise / payoff，不判断正文是否完成；本次 B 的 WRITE 没有建立候选。

### CI03-B

`selected_mechanism_ids`：

- `conflict_creates_payoff_opportunity`
- `observable_status_change`
- `growth_compounding`
- `autonomy_payoff`

这些机制是否构成错误的隐藏身份/打脸偏向：`NOT_AUTOMATICALLY_EVALUATED`。仅保存召回结构；本次 B 的 WRITE 没有建立候选。

### CI04-B

ContentPlan `core_conflict`：

> 你越是想用这条信息帮人避开后悔，就越要面对“你凭什么替我决定”的质问：你无法交代信息来源，帮助常常换来怀疑、迁怒与关系裂缝。当你自以为阻止了一次错误选择却引发新的关系压力时，真正的对手不再是“别人会不会后悔”，而是你自己是否要继续替别人做决定。

ContentPlan `main_payoff`：

> 高潮中你面对一个与你有关的、必须开口的抉择场景：你终于把“哪个会后悔”说出口，但把落点交给对方——不解释、不劝说、不代替选择。对方在知情的前提下自己走，你可能失去这段关系，也可能被重新接纳；而能力依然在，你只是第一次知道该怎么用它。

这里只确认能力设定进入了 Plan 的 core conflict 与 payoff 字段，不判断内容质量；本次 B 的 WRITE 没有建立候选。

## 7. Blind Review Package

- 每个 Case 的 X/Y 映射使用运行时随机数独立生成。
- 映射只保存在 `blind_mapping.json`。
- `blind-review/` 文档只包含案例、X/Y 与候选正文。
- 盲评正文不包含组别、ContentPlan、Mechanism、Prompt 版本或 selected mechanisms。
- 对没有候选的正式调用，盲评正文明确标记“本次正式调用未生成候选正文”，没有使用替代稿。

由于 CI02、CI03、CI04 的 B 组没有建立候选，本轮只有 CI01 具备完整的 A/B 正文对。报告不据此推断哪组更好，也不计算 Content Intelligence 提升幅度。

## 8. 输出与停止点

已输出：

- `machine_results.json`
- `blind_mapping.json`
- 8 个 `raw/*.md`
- 4 个 `plans/*-B.json`
- 8 个 `blind-review/*.md`

本轮没有执行第二轮生成，没有调整 Prompt、机制或 Validator，没有进入 Narrative Memory、图片、视频或 TTS。等待人工 Blind Content Review。

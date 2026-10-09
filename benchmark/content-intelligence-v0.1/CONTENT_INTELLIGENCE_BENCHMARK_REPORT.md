# CONTENT_INTELLIGENCE_V0.1 A/B Benchmark Report

## 1. 运行环境与冻结项

- 产品：DramaGo AI 短剧创作工作台
- 产品 API：`https://dramaworld-v01.huidian31.chatgpt.site`
- Workbench：`0.3.0-content-intelligence-v0.1`
- 冻结提交：`a5621e6e83af7265f47e6ffb93532e996431c0e0`
- Writer：`deepseek-v4-pro`
- Validator：`deepseek-flash`
- A 组：`creative-writer-v2`，不使用 ContentPlan/Mechanism
- B 组：ContentPlan + Mechanism Retrieval + `creative-writer-v3-content-plan`
- 所有调用均通过产品真实 API；未使用 Test Provider、fixture、固定稿或 Codex 代写。
- 所有成功结果均只保存 candidate，未 adopt，未人工修改正文。

## 2. 四组 A/B 结果

| Case | 组别 | 执行结果 | HTTP | Candidate | Validation | 错误 |
|---|---|---|---:|---|---|---|
| CI01 | A | FAILED_NO_CANDIDATE | 504 | — | failed | PROVIDER_TIMEOUT |
| CI01 | B | FAILED_NO_CANDIDATE | 0 | — | pending | TypeError |
| CI02 | A | SUCCESS | 201 | ver_cfeb4863622b42c18b5b1f4bc73bbb78 | passed | — |
| CI02 | B | FAILED_NO_CANDIDATE | 0 | — | pending | TypeError |
| CI03 | A | FAILED_NO_CANDIDATE | 504 | — | failed | PROVIDER_TIMEOUT |
| CI03 | B | FAILED_NO_CANDIDATE | 0 | — | pending | TypeError |
| CI04 | A | FAILED_NO_CANDIDATE | 503 | — | pending | worker_exceeded_resources |
| CI04 | B | FAILED_NO_CANDIDATE | 504 | — | failed | PROVIDER_TIMEOUT |

汇总：8 次冻结调用中 1 次生成候选、7 次未生成候选。唯一成功候选为 CI02-A，状态仍为 `candidate`。

这组结果不足以进行 A/B 内容质量比较。失败正文未用任何替代稿补齐。

## 3. ContentPlan 与 Mechanism Retrieval

- CI01-B：Plan 已进入 D1 脱敏审计快照；机制为 `observable_status_change`、`growth_compounding`、`autonomy_payoff`、`promise_payoff`。
- CI02-B：Plan 已进入 D1 脱敏审计快照；机制为 `audience_leads_information_gap`、`conflict_creates_payoff_opportunity`、`observable_status_change`、`promise_payoff`。
- CI03-B：Plan 已进入 D1 脱敏审计快照；机制为 `promise_payoff`、`conflict_creates_payoff_opportunity`、`observable_status_change`、`autonomy_payoff`。
- CI04-B：ContentPlan 调用超时，未获得计划。

失败请求没有返回完整 ContentPlan；D1 Creative Trace 按安全规则只保存 Promise/Payoff 长度与机制 ID，故报告没有反推或伪造被脱敏的计划文本。逐例快照见 `plans/`。

从已完成的计划选择看，只有 CI02 选择了信息差机制；不能据此验证 B 组正文不会统一变成“隐藏身份/打脸”，因为所有 B 组均未生成正文。

## 4. Token usage

| Case | prompt_tokens | completion_tokens | reasoning_tokens | total_tokens | cost |
|---|---:|---:|---:|---:|---|
| CI01-A | unknown | unknown | unknown | unknown | unknown |
| CI01-B | unknown | unknown | unknown | unknown | unknown |
| CI02-A | 731 | 2679 | 1241 | 3410 | unknown |
| CI02-B | unknown | unknown | unknown | unknown | unknown |
| CI03-A | unknown | unknown | unknown | unknown | unknown |
| CI03-B | unknown | unknown | unknown | unknown | unknown |
| CI04-A | unknown | unknown | unknown | unknown | unknown |
| CI04-B | unknown | unknown | unknown | unknown | unknown |

失败调用没有返回 Provider usage，标记为 `unknown`；不估造成本。Validator usage 当前产品未单独保存。

## 5. Validator 定向回归

### G04 类 negative constraint

- 已从作者要求规范化 4 条约束：减少专业原理和操作步骤；不要写成事故调查报告；不要立即制造大型事故；不要由突然出现的专家证明主角正确。
- 真实 EXPAND 候选：`ver_e5ef6903937e4a1ab238aeca2b2b4518`。
- Validator：`passed`；`NEGATIVE_CONSTRAINTS=pass`。
- 该结果仅说明 Validator 未发现明确违反，不是内容质量评分。

### G05 类 candidate internal consistency

- Writer 两次 transport attempt 后返回 `PROVIDER_TIMEOUT`，未建立候选。
- Validator V2 未运行，`INTERNAL_FACT_CONFLICT` 能力本轮为 `NOT_EVALUATED`。
- 未通过修改样本、降低标准或固定 Validator 输出补齐结果。

### G02 B 组 Promise/Payoff

- CI02-B 的 ContentPlan 确实选择 `promise_payoff`，且审计快照包含 opening promises 与 required payoffs。
- Writer 阶段连接中断，D1 没有候选，故“B 组是否真正产生身份 Payoff”为 `NOT_EVALUATED`。
- CI02-A 的 Validator V2 给出 `PROMISE_PAYOFF=pass`，但这不能替代 B 组结论。

## 6. 工程异常

1. A 组出现 3 类实际结果：成功、`PROVIDER_TIMEOUT`、Cloudflare `1102 Worker exceeded resource limits`。
2. CI01-B、CI02-B、CI03-B 的客户端连接在长链路完成前断开；D1 任务停留在 `planning/generating + pending`，且同一 work 下没有候选。
3. CI04-B 在 ContentPlan 阶段发生 `PROVIDER_TIMEOUT`，任务正确记录为 failed。
4. B 链路串行增加 Planner 调用后，当前 Sites 执行窗口下无法完成任一 2000 字 CREATE。这是本轮最主要的工程基线结果。
5. CI04-A 的 Worker 1102 使任务记录停留在 generating/pending；本轮按冻结要求未修改清理逻辑。

## 7. 当前结论与未评估项

- CREATE ContentPlan、机制召回与 Validator V2 已部署，且 D1 证明确有独立规划阶段，不只是 Writer Prompt 字符串切换。
- 当前生产执行预算不足以完成 B 组真实内容闭环，因此不能宣称 Content Intelligence 提升了内容质量。
- 未评估：四组正文人工 A/B、G02-B 身份兑现、B 组结构同质化、G05 实际语义冲突识别。
- 已验证：CI02-A 真实候选与 Validator V2；G04 negative constraint 规范化和语义检查链路。

真实内容质量：等待产品负责人审阅已生成的 CI02-A；其余案例需要先解决运行时可靠性后才能形成可比较样本。

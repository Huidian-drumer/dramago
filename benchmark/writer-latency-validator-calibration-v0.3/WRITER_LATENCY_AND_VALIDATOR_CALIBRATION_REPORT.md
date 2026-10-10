# WRITER_LATENCY_AND_VALIDATOR_CALIBRATION_V0.3

执行日期：2026-10-08
生产站点：https://dramaworld-v01.huidian31.chatgpt.site
最终部署版本：Sites v11 / commit `26f1544e08e4633739077d4b2e1d3bfe38d4dfff`
环境变量版本：revision 4
Writer：`deepseek-v4-pro`
Planner / Validator：`deepseek-flash`

## 1. 结论

- Writer 约 90 秒失败边界来自 DramaGo 应用自身：原配置为单次 transport attempt 45,000 ms，`requestProviderOnce` 最多执行两次独立计时的 transport attempt，纯超时因此集中在约 90 秒。
- 180 秒实验窗口下，同一个冻结的 2000 字 CREATE WRITE 输入两次均成功建立候选；其中一次用时 94,406 ms，明确越过旧边界且未达到 180 秒。结论：`APPLICATION_TIMEOUT_CONFIRMED`。
- Writer 长度实验 8/8 成功。2000 字组平均 78,412 ms，最高 94,406 ms；目标长度影响延迟，但同长度的 reasoning/completion 波动也很明显，不能用字数单独预测耗时。
- Validator 最终回归：硬阻断 13/13，遗漏 0；两条预期 warning 均保持 warning；正常样本误阻断从 3/5 降为 0/5。
- CI01–CI04 A/B 没有重跑。本轮已达到“可申请重跑”的 Decision Gate，等待产品负责人确认。

## 2. 冻结项核对

本轮没有修改 ContentPlan schema、Mechanism Library、Mechanism Retrieval、`creative-writer-v2`、`creative-writer-v3-content-plan`、CI01–CI04 输入、Writer/Planner/Validator 模型、L2 CAS/hash/candidate/adopt，也没有改变 PLAN → WRITE → VALIDATE 阶段结构。

改动只位于：

- Provider timeout 的集中配置入口；
- Validator V2 的严重度说明、来源优先级、证据契约与程序阻断门槛；
- 对应确定性测试与审计期望。

无数据库迁移。

## 3. Phase 1 — Timeout Source Audit

| 层级 | 实际配置 | 证据与结论 |
|---|---|---|
| `requestProviderOnce` | 默认 45,000 ms；实验 180,000 ms；允许范围 1,000–180,000 ms | `worker/core.mjs` 的 `providerTimeoutMs`；`worker/index.mjs` 每次 attempt 创建独立 AbortController 与 timer |
| transport retry | 每次 `requestProviderOnce` 最多 2 次；无 backoff | 纯超时为 2 × 单次 timeout；默认约 90 秒，实验理论上最多约 360 秒 |
| `callProvider` format repair | 默认最多 2 次 repair | 只有拿到响应但 JSON 格式错误才进入 repair；纯 transport timeout 在第一次 `requestProviderOnce` 耗尽两次 attempt 后直接退出 |
| AbortSignal | 每个 transport attempt 独立 | timer 在 `finally` 清除，下一次 attempt 重新计时 |
| Worker / Sites | 项目未配置 90 秒 wall timeout；精确托管 CPU 配额未暴露 | 旧日志中多次 504 wall time 为 90,111–90,608 ms，但 Worker outcome=`ok`、CPU 仅 7–16 ms；这是应用返回 504，不是宿主杀死 |
| 前端 fetch | 无 timeout，无 AbortSignal | `web/app.js::api` 直接调用 fetch |
| 外部 benchmark runner | fetch 无 AbortController；外层工具 300,000 ms | 60 秒轮询只读取进度，不会取消请求 |

Cloudflare 官方说明 HTTP-triggered Worker 在客户端保持连接时没有固定 wall-duration 上限，等待上游 fetch 不计入 CPU 时间：[Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)。

旧生产日志还存在 32,917 ms 与 77,777 ms 的成功 WRITE，进一步说明宿主没有固定 90 秒终止规则。

Phase 1 结论：`APPLICATION_TIMEOUT_SOURCE_CONFIRMED`。

## 4. Phase 2 — Controlled Timeout Experiment

固定条件：CI01 原始输入、CREATE、target_length=2000、`creative-writer-v2`、`deepseek-v4-pro`、无 ContentPlan、无机制注入；串行执行；只运行 WRITE，不执行 Validator。

| Trial | HTTP | request duration_ms | persisted WRITE stage_ms | transport attempts | candidate | prompt | completion | reasoning | total | error |
|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---|
| 1 | 201 | 62418 | 61302 | 1 | 是 | 783 | 3573 | 2691 | 4356 | 无 |
| 2 | 201 | 94406 | 93289 | 1 | 是 | 783 | 5683 | 4445 | 6466 | 无 |

两次均保存为未采用候选，没有自动 adopt。Trial 2 在 94,406 ms 成功，满足“91 秒以后、180 秒以前完成”的判定条件。

Phase 2 结论：`APPLICATION_TIMEOUT_CONFIRMED`。

## 5. Phase 3 — Writer Latency Characterization

固定条件与 Phase 2 相同，只改变 target_length。每档 2 次，全部串行。2000 字档复用 Phase 2 的两次合法实验结果，没有额外重复消耗。

| target_length | run | duration_ms | result | transport | prompt | completion | reasoning | total | first token | error |
|---:|---|---:|---|---:|---:|---:|---:|---:|---|---|
| 500 | latency_500_1 | 38969 | 成功 | 1 | 782 | 1734 | 1027 | 2516 | NOT_AVAILABLE | 无 |
| 500 | latency_500_2 | 45609 | 成功 | 1 | 782 | 2082 | 982 | 2864 | NOT_AVAILABLE | 无 |
| 1000 | latency_1000_1 | 52138 | 成功 | 1 | 783 | 2286 | 998 | 3069 | NOT_AVAILABLE | 无 |
| 1000 | latency_1000_2 | 64063 | 成功 | 1 | 783 | 3505 | 2582 | 4288 | NOT_AVAILABLE | 无 |
| 1500 | latency_1500_1 | 53098 | 成功 | 1 | 783 | 3078 | 2270 | 3861 | NOT_AVAILABLE | 无 |
| 1500 | latency_1500_2 | 36537 | 成功 | 1 | 783 | 1561 | 457 | 2344 | NOT_AVAILABLE | 无 |
| 2000 | phase2_trial1 | 62418 | 成功 | 1 | 783 | 3573 | 2691 | 4356 | NOT_AVAILABLE | 无 |
| 2000 | phase2_trial2 | 94406 | 成功 | 1 | 783 | 5683 | 4445 | 6466 | NOT_AVAILABLE | 无 |

汇总：

| target_length | success | avg duration_ms | range_ms | avg completion | avg reasoning |
|---:|---:|---:|---:|---:|---:|
| 500 | 2/2 | 42289 | 38969–45609 | 1908 | 1005 |
| 1000 | 2/2 | 58101 | 52138–64063 | 2896 | 1790 |
| 1500 | 2/2 | 44818 | 36537–53098 | 2320 | 1364 |
| 2000 | 2/2 | 78412 | 62418–94406 | 4628 | 3568 |

观察：

- 2000 字组平均耗时最高，且第二次越过旧 90 秒边界。
- 1500 字组比 1000 字组更快，说明 target_length 与延迟不是单调关系。
- 延迟更接近实际 completion/reasoning token 开销；同长度下仍有显著随机波动。
- 当前 Provider/API 不返回首 token 时间，统一记录为 `NOT_AVAILABLE`，没有估造。

## 6. Phase 4–6 — Validator Severity / Priority / Evidence

### 严重度权限

允许 blocking 的类别集中配置为：

- `STORY_FACT_CONFLICT`
- `TIMELINE_CONFLICT`
- `HARD_PRESERVE_VIOLATION`
- `EXPLICIT_HARD_CONSTRAINT_VIOLATION`
- `REQUIRED_OUTCOME_MISSING`
- `OPERATION_NOT_COMPLETED`
- `INTERNAL_FACT_CONFLICT`
- `SELECTION_SCOPE_VIOLATION`

“减少/尽量/避免/不要太”、文风、篇幅、节奏、技术信息比例、场景化充分度、ContentPlan 推断、机制建议默认只进入 warning。

### 来源优先级

1. 用户本轮显式 hard constraint
2. 用户本轮其他显式要求
3. source/version 已成立事实
4. ContentPlan 推断
5. Mechanism Library 建议

低优先级 finding 不得覆盖高优先级。ContentPlan 与机制来源不能单独触发 blocking。

### 程序阻断门槛

置信度阈值集中为 `0.85`。一个 finding 只有同时满足以下条件才阻断：

- finding_type 在允许列表；
- severity 为 `blocking`；
- confidence ≥ 0.85；
- evidence 非空；
- reason 非空；
- 来源不是 ContentPlan、机制或显式 soft constraint；
- hard constraint / hard preserve 的 finding 确实来自 `explicit_user_hard_constraint`；
- 不允许把已经识别为软呈现要求的问题改名为 `REQUIRED_OUTCOME_MISSING`、`OPERATION_NOT_COMPLETED` 或 `EXPLICIT_HARD_CONSTRAINT_VIOLATION` 绕过分级。

不满足契约的模型 finding 会保留为 warning，不会静默删除，也不会设置候选 blocking。Validator 不修改正文。

## 7. Phase 7 — Validator Regression

样本完全复用上一轮的 20 条固定输入，没有修改内容。所有调用均为真实 `deepseek-flash`。

### Before

- 硬阻断：13/13 检出。
- 预期 warning：严重度过严，两条都被升级为 blocking。
- 正常样本误阻断：3/5。
- 正常样本 warning only：2/5。

### After

- true blocking：13/13
- missed blocking：0
- expected warning：2/2
- warning promoted to blocking：0
- normal false blocking：0/5
- normal warning：5/5

| Case | Group | Expected | Actual | Blocking | duration_ms |
|---|---|---|---|---|---:|
| V2-A01 | internal_fact_conflict | blocking | blocking | 是 | 11276 |
| V2-A02 | internal_fact_conflict | blocking | blocking | 是 | 9320 |
| V2-A03 | internal_fact_conflict | blocking | blocking | 是 | 6158 |
| V2-A04 | internal_fact_conflict | blocking | blocking | 是 | 9534 |
| V2-A05 | internal_fact_conflict | blocking | blocking | 是 | 15336 |
| V2-B01 | promise_missing | blocking | blocking | 是 | 16848 |
| V2-B02 | promise_missing | blocking | blocking | 是 | 7071 |
| V2-B03 | promise_missing | blocking | blocking | 是 | 7180 |
| V2-B04 | promise_missing | blocking | blocking | 是 | 13164 |
| V2-B05 | promise_missing | blocking | blocking | 是 | 21964 |
| V2-C01 | negative_constraint_violation | blocking | blocking | 是 | 9689 |
| V2-C02 | negative_constraint_violation | warning | warning | 否 | 21362 |
| V2-C03 | negative_constraint_violation | blocking | blocking | 是 | 6273 |
| V2-C04 | negative_constraint_violation | blocking | blocking | 是 | 20510 |
| V2-C05 | negative_constraint_violation | warning | warning | 否 | 19588 |
| V2-D01 | normal | normal | warning | 否 | 15372 |
| V2-D02 | normal | normal | warning | 否 | 8420 |
| V2-D03 | normal | normal | warning | 否 | 12891 |
| V2-D04 | normal | normal | warning | 否 | 12864 |
| V2-D05 | normal | normal | warning | 否 | 22452 |

重点回归：

- V2-A01 “没有告诉任何人”与“昨天已经告诉母亲”仍为 `INTERNAL_FACT_CONFLICT`，blocking。
- V2-C01 “不要突然出现专家证明主角正确”被正文直接违反，仍为 blocking。
- V2-C02 “减少专业原理和操作步骤 / 不要写成事故调查报告”产生明确 warning，不 blocking。
- V2-C05 “避免逐日写三个月”产生 warning，不 blocking。
- 5 条正常样本均无 blocking；5/5 仍有非阻断 warning，主要来自固定输入中的人称/目标篇幅与短候选之间的偏差。

这是 20 条小样本结果，不是 Validator 通用准确率，也不代表内容质量评估。

## 8. 验证结果

- 单元/集成测试：22/22 PASS。
- L2 Wrapper Audit：8 项主测试、hardening 与 Fault A–H 全部达到既定结果；Fault C preserve 继续阻断。
- 数据库迁移验证：PASS，5 张表、41 个 generation task 字段、20 个 version 字段。
- 部署产物校验：PASS，无客户端密钥输入。
- Sites v11 部署：succeeded，环境 revision 4。
- `PROVIDER_TIMEOUT_MS=180000` 当前保留为生产实验后的合法执行窗口。
- API Key、Authorization 与 secret 未写入报告、Git、前端或数据库。

## 9. 未评估与限制

- 每个目标长度只有两次样本，不能据此建立可靠的延迟分布或 SLA。
- 未获得 time-to-first-token。
- Sites 托管层精确 CPU 配额未由当前接口暴露；只能依据官方限制说明与 Worker 日志判断。
- 没有自动评价正文是否好看、爆款或创意优秀。
- 没有重跑 CI01–CI04 A/B，也没有修改任何 Golden 输入。
- 没有实现 durable async background execution 或 chunked writer；本轮证据不要求进入这两个架构分支。

## 10. Decision Gate

状态：`ELIGIBLE_TO_REQUEST_CI01_CI04_AB_RERUN`。

冻结的 2000 字 CREATE 输入在 180 秒窗口内 2/2 成功，其中一次 94,406 ms，说明当前同步链路能够越过旧应用超时并完成候选持久化。按照停止条件，本轮到此结束；在产品负责人明确确认前，不重新执行 CI01–CI04 A/B。

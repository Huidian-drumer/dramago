# RUNTIME_RELIABILITY_V0.2 报告

## 1. 结论

本轮只改造运行时可靠性，Content Intelligence V0.1 的机制库、ContentPlan 字段语义、Writer/Validator Prompt、Golden Set、模型配置以及既有 L2 CAS/hash/candidate/adopt 安全逻辑均未调整。

分阶段持久化链路已发布到现有 DramaGo 站点第 8 版：

- 线上地址：https://dramaworld-v01.huidian31.chatgpt.site
- 源码提交：`7b307391a461bcb83f41d24b20df3b69bb9050f8`
- Writer：`deepseek-v4-pro`
- Planner / Validator：`deepseek-flash`
- Provider endpoint：`https://api.deepseek.com/chat/completions`

工程 Smoke 通过，但冻结的 2000 字 CI01–CI04 A/B 基准没有产生任何候选正文：7 个任务以 `PROVIDER_TIMEOUT` 结束，1 个正文请求返回 503 后由陈旧任务回收为 `abandoned / STAGE_STALE`。因此，本轮证明了阶段拆分与失败保护有效，但没有证明 2000 字真实内容基准具备可用吞吐。

## 2. 实现项

- CREATE B 链路拆为持久化的 `PLAN → WRITE → VALIDATE`；A 路径跳过 PLAN。
- 新增独立接口：
  - `POST /api/tasks/:task_id/plan`
  - `POST /api/tasks/:task_id/write`
  - `POST /api/tasks/:task_id/validate`
  - `GET /api/tasks/:task_id`
- WRITE 成功后立即保存 candidate，初始 `validation_status=pending`、`can_auto_apply=false`，不等待 Validator。
- VALIDATE 单独读取已保存候选、源版本、ContentPlan、事实与约束；Validator 不可用时候选保留。
- 阶段状态包含：`created`、`planning`、`planned`、`generating`、`generated`、`validating`、`completed`、`failed`、`abandoned`。
- 活跃阶段超过恢复窗口后，在读取任务时通过条件更新标记 `abandoned`。
- PLAN、WRITE、VALIDATE 均具备阶段级幂等保护；重复请求返回既有结果，不重复调用模型或创建候选。
- 前端仅增加三段状态文案：正在理解创作意图、正在生成正文、正在检查内容。Validator 失败时保留正文并禁用自动采用。

关键实现位于：

- `worker/index.mjs`：`createGenerationTask`、`runPlanStage`、`runWriteStage`、`runValidateStage`、`claimTaskStage`、`abandonTaskIfStale`
- `web/app.js`：分阶段调用与候选展示
- `db/schema.ts` 与 `drizzle/0002_conscious_oracle.sql`：任务阶段和候选校验持久化
- `test/runtime-reliability.test.mjs`：幂等、Validator 失败保留、陈旧任务回收
- `audit/run-wrapper-audit.mjs`：原 L2 审计适配分阶段接口

## 3. 数据结构变化

`generation_tasks` 新增：

- `execution_input_json`
- `content_plan_json`
- `selected_mechanisms_json`
- `stage`
- `failed_stage`
- `stage_started_at`
- `stage_finished_at`
- `stage_timings_json`
- `last_error_code`
- `updated_at`
- `plan_model_name`
- `plan_usage_json`
- `validator_model_name`
- `validator_usage_json`
- `semantic_validation_json`

`versions` 新增：

- `validation_status`
- `can_auto_apply`

迁移在空库顺序执行后验证为 5 张表、`generation_tasks` 41 列、`versions` 20 列。

## 4. 安全与幂等证据

- 18 项自动测试通过。
- 原 Wrapper Audit 的 8 项测试、3 项加固验证及 A–H 故障注入全部通过；语义类受控测试继续标记为 `PASS_PIPELINE_ONLY`，不冒充真实模型准确率。
- Source Version Race 返回 `SOURCE_VERSION_CONFLICT`，旧候选保留且无法覆盖新版本。
- adopt 仍校验 candidate/content hash、Validator 版本、校验状态，并通过数据库条件更新执行 CAS。
- WRITE 阶段落库后才进入 VALIDATE；校验失败不会删除候选。
- 阶段重试只允许从对应的 `failed_stage` 或 `abandoned` 恢复。

## 5. 真实 Provider Smoke

| 路径 | PLAN | WRITE | VALIDATE | 最终候选 | validation | can_auto_apply |
|---|---:|---:|---:|---|---|---|
| A / direct | 不适用 | 201 / 43168 ms | 200 / 12722 ms | `ver_c1fa2bfc96cc404796aee48f37466a50` | passed | true |
| B / Content Intelligence | 200 / 12745 ms | 201 / 81188 ms | 200 / 18103 ms | `ver_7d9442fbd5a745a188b1e7efceef9eb6` | blocked | false |

B 路径的模型顺序实测为 `deepseek-flash → deepseek-v4-pro → deepseek-flash`。B 正文已在 Validator 前以 `pending` 候选保存；最终 Validator 给出 `blocked`，候选仍可查看但不可自动采用。这是语义保护结果，不是链路失败。

完整模型 usage 见 [smoke_results.json](./smoke_results.json)。

## 6. 冻结 A/B 基准结果

严格复用 `benchmark/content-intelligence-v0.1/golden_inputs.json`，目标 2000 字，A/B 各一次，串行执行；未重跑、未改 Prompt、未改模型、未人工补正文。

| Case | 组 | 结果 | 最终阶段 | 错误 | PLAN ms | WRITE ms | 候选 |
|---|---|---|---|---|---:|---:|---|
| CI01 | A | FAILED_NO_CANDIDATE | failed | PROVIDER_TIMEOUT | — | 91204 | — |
| CI01 | B | FAILED_NO_CANDIDATE | abandoned | STAGE_STALE | 12867 | 39554 | — |
| CI02 | A | FAILED_NO_CANDIDATE | failed | PROVIDER_TIMEOUT | — | 91379 | — |
| CI02 | B | FAILED_NO_CANDIDATE | failed | PROVIDER_TIMEOUT | 8688 | 93904 | — |
| CI03 | A | FAILED_NO_CANDIDATE | failed | PROVIDER_TIMEOUT | — | 90997 | — |
| CI03 | B | FAILED_NO_CANDIDATE | failed | PROVIDER_TIMEOUT | 20612 | 91126 | — |
| CI04 | A | FAILED_NO_CANDIDATE | failed | PROVIDER_TIMEOUT | — | 91334 | — |
| CI04 | B | FAILED_NO_CANDIDATE | failed | PROVIDER_TIMEOUT | 8093 | 91610 | — |

- 成功候选：0/8
- `PROVIDER_TIMEOUT`：7/8
- 503 后陈旧任务回收：1/8
- B 组 PLAN 成功持久化：4/4
- 未运行 Validator：8/8（因为 Writer 没有建立候选）
- 未进行自动采用：8/8
- 成本：unknown；Provider 未返回成本，本报告不估算

B 组 ContentPlan 与机制召回保存在 `plans/`；失败案例在 `cases/` 中明确标记 `NOT_CREATED`，没有 fixture 或固定正文补齐。

## 7. Validator V2 直接回归

固定 20 条候选只调用真实 `deepseek-flash` Validator，不经过 Writer：

- 预期阻断：13/13 被阻断。
- 预期 warning：1/2 出现 warning 信号，但 warning-only 分类为 0/2；两条均被额外升级为 blocking。
- 正常文本：错误阻断 3/5；其余 2/5 出现 warning。
- “她没有告诉任何人 / 妈，我昨天已经说过”矛盾被阻断。
- “突然出现专家证明主角正确”被阻断。
- “大量技术参数和处置流程”案例预期 warning，实际 blocking。

这是 20 条固定小样本结果，不是 Validator 通用准确率。结果显示冲突召回较强，但当前误杀和 severity 过严都很明显；不能据此宣称 Validator V2 已达到通用可用水平。

详细输入、原始 findings 和 usage 见 [validator_v2_regression.json](./validator_v2_regression.json)。

## 8. 工程异常与未评估项

- 目标 2000 字时 Writer 仍无法在当前 Provider/Worker 超时窗口内稳定完成，分阶段只隔离了 PLAN、WRITE、VALIDATE，尚未解决单次 WRITE 本身的长耗时。
- 一次 503 没有返回产品 JSON 错误体；任务随后由读取时的陈旧阶段回收机制安全标记为 `abandoned`。
- 本轮没有候选正文，因此无法进行 CI01–CI04 的人工 A/B 内容比较，也无法验证 CI02 B 的身份 Payoff。
- 未测试多实例同时抢占同一阶段时的高并发压力，只验证了数据库条件更新与重复请求幂等。
- 未评估 DeepSeek 服务在更长时间窗口、不同地域或更高配额下的稳定性。
- 内容质量仍等待人工验收；`validation passed` 只代表现有语义保护未阻断，不代表作品优质。

## 9. 停止点

已完成代码加固、发布、真实 Smoke、冻结的 8 次 A/B 调用以及 20 条 Validator 固定回归。本轮到此停止；未改 Content Intelligence 内容逻辑，未新增其他创作功能。


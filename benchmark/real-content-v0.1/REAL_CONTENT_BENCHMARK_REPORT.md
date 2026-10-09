# REAL_CONTENT_BENCHMARK_V0.1

## 1. 运行环境

- 执行日期：2026-10-08
- 产品：DramaGo AI 短剧创作工作台
- 前端与 API：<https://dramaworld-v01.huidian31.chatgpt.site>
- 持久化：Sites 生产环境 Cloudflare D1
- 调用路径：全部案例经产品真实 API 执行；未使用 Test Provider、fixture、固定稿或 Codex 会话正文。
- 候选策略：生成结果仅保存为 candidate，未 adopt，未人工修改。
- 工程链路：已验证（G01–G07 完成真实 Writer → Validator → candidate 保存；G08 的超时失败路径也已验证为不创建候选）。
- 真实内容质量：等待人工验收。

## 2. 固定模型配置

- OPENAI_ENDPOINT：`https://api.deepseek.com/chat/completions`
- Writer：`deepseek-v4-pro`
- Validator：`deepseek-flash`
- Writer Prompt、Validator Prompt、模型配置与 Golden Set 输入在执行期间保持冻结。
- API Key：仅作为 Sites 服务端 Secret 使用，未写入本报告、日志、Git、前端或数据库导出。

## 3. G01–G08 成功/失败状态

| Case | Operation | 运行状态 | HTTP | Candidate Version | Validation | Can Auto Apply | Output Kind | Writer tokens（prompt / completion / reasoning / total） | Attempts（transport / format repair / validator） |
|---|---|---:|---:|---|---|---:|---|---|---|
| G01 | CREATE | success | 201 | ver_69c69fd35b2a45a2a5840a7a76c059c9 | passed | true | full | 782 / 5319 / 3911 / 6101 | 2 / 0 / 1 |
| G02 | CREATE | success | 201 | ver_b7a69d890adf4f508e62c9dd241a71b6 | passed | true | full | 730 / 2819 / 1812 / 3549 | 1 / 0 / 1 |
| G03 | EXPAND | success | 201 | ver_2770c9da1ffd419c8a9de8fd18ed2d10 | passed | true | segment | 896 / 5290 / 4230 / 6186 | 1 / 0 / 1 |
| G04 | EXPAND | success | 201 | ver_8f122737dbf44853977fc6b3f1a60fbf | passed | true | segment | 816 / 3780 / 2161 / 4596 | 1 / 0 / 1 |
| G05 | REWRITE | success | 201 | ver_8ae76ae64ca54b358ca5331286a1a4ca | passed | true | full | 840 / 4202 / 3123 / 5042 | 2 / 0 / 1 |
| G06 | REWRITE | success | 201 | ver_82f08a8ee58f407f86a0fc71f9132166 | passed | true | full | 798 / 3269 / 2184 / 4067 | 1 / 0 / 1 |
| G07 | CONTINUE | success | 201 | ver_dac5e6dd158e437fa4b8c383616c7711 | passed | true | continuation | 810 / 3833 / 2741 / 4643 | 1 / 0 / 1 |
| G08 | CONTINUE | failed | 504 | NOT_CREATED | failed | false | NOT_AVAILABLE | NOT_AVAILABLE | 2 / 0 / 0 |

- G01–G07：真实模型调用成功并保存 candidate，均未 adopt。
- G08：产品内置两次 transport attempt 后返回 `PROVIDER_TIMEOUT`；未创建 candidate，源版本保持不变，未补写、未人工重跑。

## 4. 每例 token usage

上表记录 Writer 的 Provider usage。`reasoning_tokens` 仅在 Provider 返回时记录。Validator usage 当前产品未单独保存，全部标记为 `NOT_RECORDED`。Provider 与产品均未返回可直接使用的成本，cost 统一为 `unknown`，未估算。

## 5. Validation 状态

- G01–G07：`passed`。这只表示现有语义保护职责未给出阻断结论，不代表内容质量优秀。
- G08：`failed`，原因是 `PROVIDER_TIMEOUT`，Validator 未调用。
- 所有成功候选均保留了 candidate content hash、source content hash（CREATE 无 source）和版本 ID；`source_is_current=true`。

## 6. Validator 20条统计

- Story Fact Conflict × 5
- Timeline Conflict × 5
- Hard Preserve Violation × 5
- Normal × 5
- 应阻断 15 条中：实际阻断 **9/15**。
- 正常 5 条中：错误阻断 **0/5**。
- 其中 A01、B01、B02 在进入 Validator 前被 Writer 输出契约以 `OUTPUT_TOO_SHORT` 拦截，因此记录为 `NOT_EVALUATED`，未冒充 Validator 判断。
- 这是20条小样本结果，不是Validator通用准确率。

## 7. 工程异常

- G08：Provider 超时，产品已有重试耗尽后返回 `PROVIDER_TIMEOUT`；无候选、无自动采用。
- Validator A01、B01、B02：Writer 返回空内容，被 `OUTPUT_TOO_SHORT` 拦截，未进入 deepseek-flash Validator。
- 外部基准执行器最初把 CREATE 的空 source ID 错当成需要保存源版本，G01、G02 因此在模型调用前收到 `CONTENT_REQUIRED`。仅修正外部执行器的空值映射后执行有效调用；产品代码、Prompt、模型和 Golden 输入均未改变。该前置执行器错误不计为产品模型结果。
- Validator 执行器在 D02 后发生一次本地 EOF；仅从尚未产生产品响应的 D03–D05 继续，没有重跑既有样本。

## 8. 当前未评估项

- G01–G08 的文学质量、可看性、人物可信度和人工产品通过结论：未评估，等待产品负责人阅读原始正文。
- G08 的真实正文与语义校验：未产生，无法评估。
- Validator 对开放域故事事实与时间线的通用准确率：未评估；本报告仅呈现 20 条固定小样本。
- Validator token usage：现有产品未单独保存，`NOT_RECORDED`。
- 实际成本：Provider 未返回且产品无可靠现成计费字段，`unknown`。

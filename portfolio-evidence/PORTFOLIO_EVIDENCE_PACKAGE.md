# DramaGo Portfolio Evidence Package

更新日期：2026-10-10  
当前定位：AI 产品经理求职作品集 / 可演示产品 Demo  
证据原则：保留失败案例，不用模型自评分替代人工内容判断。

## 1. Product Problem

DramaGo 要解决的不是“把用户输入拼成 Prompt”这一单点问题，而是让短剧创作中的生成、局部编辑、版本管理和内容保护形成可验证的产品闭环。

最初的 Wrapper Audit 将系统评为 **L2 下沿**：产品已经具备 operation、scope、程序合并、candidate/adopt 和失败保护，但存在 source-version race、片段输出契约缺失、超长输出可采用，以及事实冲突主要依赖模型自律等问题。

对应证据：

- [`WRAPPER_AUDIT_REPORT.md`](../WRAPPER_AUDIT_REPORT.md)

## 2. User Workflow

当前工作流为：

1. 作者输入背景、创作要求和目标篇幅。
2. 选择 CREATE、EXPAND、REWRITE 或 CONTINUE。
3. CREATE 可在确有结构缺口时选择 Content Intelligence 路径，先生成轻量 ContentPlan 并召回少量机制；默认路径与其他操作直接进入 Writer。
4. Writer 输出必须符合 `full / segment / continuation` 契约。
5. 程序完成片段替换或 continuation append，并立即保存 candidate。
6. 独立 Validator 检查事实、时间线、hard preserve、required outcomes 和内部一致性。
7. candidate 只有在校验、正文 hash 和 source version 都有效时才允许 adopt。

该流程将“生成正文”和“采用正文”分离，模型失败或 Validator 阻断不会覆盖源稿。

## 3. Architecture

当前演示环境：

- Web 前端与 API：OpenAI Sites / Cloudflare Worker runtime
- 持久化：Sites 管理的 Cloudflare D1
- 已验证 Provider：DeepSeek OpenAI-compatible API
- 历史长文 Writer 实验：`deepseek-v4-pro`
- 作品集 Demo Writer 候选与 Planner / Validator：`deepseek-flash`
- 阶段：`PLAN → WRITE → VALIDATE`

核心代码：

- [`worker/index.mjs`](../worker/index.mjs)：任务、Provider、候选、校验、采用
- [`worker/core.mjs`](../worker/core.mjs)：输出契约、Prompt、Validator 阻断规则
- [`web/app.js`](../web/app.js)：创作工作流与状态展示
- [`db/schema.ts`](../db/schema.ts)：作品、版本、任务、事实快照、采用事件

当前已知运行限制：WRITE 仍是长同步 HTTP。此前已经评估 Queue / durable execution，但由于产品当前定位调整为求职 Demo，该基础设施路线已停止实施。

## 4. Wrapper Audit

审计证明四种操作不是单纯修改 operation 字符串：

- selection EXPAND / REWRITE 使用字符范围做程序合并。
- CONTINUE 使用程序 append，不允许模型重写前文。
- candidate 与 adopt 分离。
- Provider 失败不生成固定 fallback。

审计也保留了真实缺陷：

- Source Version Race：FAIL。
- 全文冒充 segment：FAIL。
- 40,000 字符异常片段仍可采用：FAIL。
- 父亲已去世却重新出现：语义事实检查未实现。

这些失败成为后续 L2 Hardening 的输入，没有通过降低测试标准消除。

## 5. L2 Hardening

L2 加固完成了：

- source/current compare-and-swap；
- `output_kind` 强契约；
- 集中式输出尺寸限制；
- candidate content hash 与 checks 绑定；
- 轻量 StoryFacts Snapshot；
- 独立 Semantic Validator；
- hard / soft preserve 分级；
- 真实 transport、format repair、validator attempts；
- adoption event 与脱敏 Creative Trace。

关键回归变化：

| 项目 | 加固前 | 加固后 |
|---|---|---|
| Source Version Race | FAIL | PASS |
| full 冒充 segment | FAIL | PASS |
| 40,000 字符片段 | FAIL | PASS |
| 旧检查放行新正文 | 未保护 | `VALIDATION_STALE` |
| Provider 两次失败 attempt | 可能记录 0 | 正确记录 2 |

系统结论为“可靠 L2 + 最小内容保护层”，不宣称 L3。

对应证据：[`L2_HARDENING_REPORT.md`](../L2_HARDENING_REPORT.md)。

## 6. Golden Set

REAL_CONTENT_BENCHMARK_V0.1 使用真实产品 API、真实 DeepSeek Provider，未使用 fixture、固定稿或 Codex 补稿。

| 范围 | 真实结果 |
|---|---|
| G01–G07 | 7/7 建立 candidate 并完成 Validator |
| G08 | `PROVIDER_TIMEOUT`，无 candidate |
| 8 个案例合计 | 7 成功 / 1 失败 |
| 成功候选 | 全部保留，未自动 adopt |

当时的 20 条 Validator 小样本中，应阻断 15 条实际阻断 9 条；正常 5 条错误阻断 0 条。另有 3 条在进入 Validator 前被 Writer 输出契约拦截，明确记为 `NOT_EVALUATED`。后续 Validator V2 校准使用另一组固定 20 条样本，结果见下一节。

对应证据：

- [`benchmark/real-content-v0.1/REAL_CONTENT_BENCHMARK_REPORT.md`](../benchmark/real-content-v0.1/REAL_CONTENT_BENCHMARK_REPORT.md)

## 7. Validator Evolution

Validator V2 初始回归的事实冲突召回较强，但 severity 过严：

| 指标 | 校准前 | 校准后 |
|---|---:|---:|
| 预期 hard blocking | 13/13 | 13/13 |
| missed blocking | 0 | 0 |
| normal false blocking | 3/5 | 0/5 |
| warning 被升级为 blocking | 2/2 中有 2 条 | 0/2 |

校准后正常文本仍有 5/5 warning，说明系统降低了错误阻断，但并不代表 Validator 已达到通用准确率。阻断必须同时满足允许类别、`severity=blocking`、置信阈值和非空 evidence。

对应证据：[`benchmark/writer-latency-validator-calibration-v0.3/WRITER_LATENCY_AND_VALIDATOR_CALIBRATION_REPORT.md`](../benchmark/writer-latency-validator-calibration-v0.3/WRITER_LATENCY_AND_VALIDATOR_CALIBRATION_REPORT.md)。

## 8. Content Intelligence

### 历史 V4-Pro 正式实验

正式 CI01–CI04 A/B rerun 共执行 8 次：

| 组别 | 建立 candidate | 失败 |
|---|---:|---:|
| A：直接 Writer | 3/4 | 1/4 |
| B：ContentPlan + Mechanism + Writer | 1/4 | 3/4 |
| 合计 | 4/8 | 4/8 |

真实失败包括：

- Worker `outcome=canceled`；
- `TypeError: fetch failed`；
- HTTP 500；
- 最终任务被安全回收为 `abandoned / STAGE_STALE`。

只有 CI01 同时获得 A/B 两篇正文，因此没有计算“Content Intelligence 提升百分比”，也没有宣称 B 组更好。

对应证据：

- [`benchmark/content-intelligence-v0.1/official-rerun/OFFICIAL_AB_REPORT.md`](../benchmark/content-intelligence-v0.1/official-rerun/OFFICIAL_AB_REPORT.md)

### 作品集 Demo 的 Flash 独立实验

本轮没有改动线上 Sites 配置，而是在本地隔离的产品 Worker API 链路中使用真实 DeepSeek 官方 API；Writer、Planner、Validator 均为 `deepseek-flash`，目标长度保持 2000 字。

稳定性门槛结果：

| 案例 | 候选 | 总耗时 | Validation |
|---|---:|---:|---|
| 隐藏豪门继承人 | 成功 | 66,224 ms | blocked |
| 17 岁刚登基的皇帝 | 成功 | 56,083 ms | passed |
| 看见别人即将后悔的选择 | 成功 | 56,716 ms | passed |

3/3 都建立了真实候选。首例阻断原因是正文内部同时出现“入职第十八天”“第七周周三”以及会议当天仍为“十八天”的时间陈述冲突；该候选被保留，没有把阻断隐藏为通过。

通过门槛后重新独立调用的 A/B 共 6 篇，结果为 6/6 建立候选、6/6 Validator passed：

| 案例 | A 总耗时 | B 总耗时 |
|---|---:|---:|
| 隐藏豪门继承人 | 48,086 ms | 86,369 ms |
| 17 岁刚登基的皇帝 | 46,320 ms | 70,881 ms |
| 看见别人即将后悔的选择 | 53,746 ms | 86,682 ms |

A 组平均总耗时约 49,384 ms；B 组平均总耗时约 81,311 ms。B 组多出的 ContentPlan 阶段与更长 Writer 上下文带来了可观察的延迟成本。该数字只描述工程运行结果，不代表 B 组内容更好或更差。

人工盲评完成后：隐藏豪门继承人案例偏好 Content Intelligence；17 岁新帝和“看见即将后悔选择”案例偏好 Direct Writer。正确产品结论是 **selective—not universal—benefit**，而不是胜率或统计显著性声明。

对应证据：

- [`portfolio-benchmark/report.md`](../portfolio-benchmark/report.md)
- [`CONTENT_INTELLIGENCE_BLIND_REVIEW_SUMMARY.md`](CONTENT_INTELLIGENCE_BLIND_REVIEW_SUMMARY.md)

## 9. Writer Latency Findings

超时审计确认原应用限制为每次 transport attempt 45 秒，最多两次独立 attempt，因此失败集中在约 90 秒，而不是一个已证明的宿主 90 秒硬限制。

将单次实验窗口提高到 180 秒后，同一冻结 2000 字输入两次均成功：

- 62,418 ms；
- 94,406 ms，明确越过旧的约 90 秒边界。

长度实验全部成功：

| target_length | 成功 | 平均耗时 | 范围 |
|---:|---:|---:|---:|
| 500 | 2/2 | 42,289 ms | 38,969–45,609 ms |
| 1000 | 2/2 | 58,101 ms | 52,138–64,063 ms |
| 1500 | 2/2 | 44,818 ms | 36,537–53,098 ms |
| 2000 | 2/2 | 78,412 ms | 62,418–94,406 ms |

耗时与目标字数并非严格单调关系；completion 和 reasoning token 波动同样显著。

对应证据：[`benchmark/writer-latency-validator-calibration-v0.3/WRITER_LATENCY_AND_VALIDATOR_CALIBRATION_REPORT.md`](../benchmark/writer-latency-validator-calibration-v0.3/WRITER_LATENCY_AND_VALIDATOR_CALIBRATION_REPORT.md)。

## 10. Product Trade-off

本项目当前选择“可信、可解释的作品集 Demo”，而不是继续追求生产 SaaS 基础设施：

- 保留 L2 的 scope、merge、CAS、hash、candidate/adopt 和 Validator 安全逻辑；
- 接受当前演示环境的同步 WRITE 限制；
- 用更轻量的 Writer 模型实验判断 Demo 稳定性；
- 不因演示目的删除超时、取消、500 或误判记录；
- 不实施账号、支付、高并发、多媒体和长期记忆。

基于本轮 3/3 真实候选成功，`deepseek-flash` 足以作为当前作品集 Demo 的默认 Writer 候选：它显著降低了等待失败的不确定性，并完成了 6/6 独立 A/B 调用。这个判断仅覆盖演示稳定性，不等同于内容质量已通过；首轮稳定性测试仍有 1/3 被 Validator 正确阻断。人工盲评进一步说明 Content Intelligence 只在部分结构场景中带来价值，因此不设为默认 CREATE Pipeline。现有线上模型配置没有在本轮被替换。


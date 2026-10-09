# DramaGo Portfolio Benchmark

## 运行边界

- 运行日期：2026-10-09T11:27:06.283Z
- 调用链：当前产品 Worker API（本地隔离运行）→ DeepSeek 官方 API
- 存储：独立的本地 D1 兼容临时存储；未读取、修改或迁移线上 Sites 数据
- Endpoint：https://api.deepseek.com/chat/completions
- Writer：deepseek-flash
- Planner：deepseek-flash
- Validator：deepseek-flash
- target_length：2000
- Prompt、ContentPlan schema、Mechanism Library、Validator 逻辑：未修改
- 自动内容评分：未执行

## TASK 1 — Demo Stability

Decision Gate：PASSED — Flash 3/3 建立候选，允许执行独立 A/B。

工程稳定性结论：`deepseek-flash` 足以作为当前作品集 Demo 的默认 Writer 候选。3/3 均在 180 秒窗口内建立真实候选，最长 66,224 ms；但 case01 因候选内部时间陈述冲突被 Validator 阻断，因此该结论不代表内容质量通过，也未替换现有产品配置。

Token 格式为 prompt/completion/reasoning/total。

| Case | 冻结输入 | 总耗时 ms | Writer | Writer tokens | Validation | Error |
|---|---|---:|---|---|---|---|
| case01 | CI02 | 66224 | SUCCESS | 679/6975/—/7654 | blocked | — |
| case02 | CI03 | 56083 | SUCCESS | 827/5556/—/6383 | passed | — |
| case03 | CI04 | 56716 | SUCCESS | 815/8801/—/9616 | passed | — |

“SUCCESS”仅表示真实 Provider 已建立正文候选，不代表内容质量优秀；内容质量等待人工评审。

## TASK 2 — Lightweight Content Intelligence A/B

A：CreativeBrief → Writer → Validator。  
B：CreativeBrief → ContentPlan → Mechanism Retrieval → Writer → Validator。

| Case | Group | Result | Plan ms | Write ms | Validate ms | Total ms | Writer tokens | Validation | Error |
|---|---|---|---:|---:|---:|---:|---|---|---|
| case01 | A | CANDIDATE_CREATED | — | 32583 | 15439 | 48086 | 679/5168/—/5847 | passed | — |
| case01 | B | CANDIDATE_CREATED | 22370 | 53409 | 10585 | 86369 | 3685/9117/—/12802 | passed | — |
| case02 | A | CANDIDATE_CREATED | — | 37546 | 8771 | 46320 | 827/6219/—/7046 | passed | — |
| case02 | B | CANDIDATE_CREATED | 7169 | 47478 | 16232 | 70881 | 3011/7954/—/10965 | passed | — |
| case03 | A | CANDIDATE_CREATED | — | 39933 | 13810 | 53746 | 815/6908/—/7723 | passed | — |
| case03 | B | CANDIDATE_CREATED | 10977 | 54496 | 21206 | 86682 | 3623/9893/—/13516 | passed | — |

盲评映射已单独保存于 `blind_mapping.json`，盲评正文不含 A/B、ContentPlan、Mechanism 或 Prompt 信息。

本报告不判断 A/B 哪组更好，不提供爆款分、创意分、可看性评分或提升百分比。

## TASK 3 / TASK 4

工程证据见 [PORTFOLIO_EVIDENCE_PACKAGE.md](../portfolio-evidence/PORTFOLIO_EVIDENCE_PACKAGE.md)。  
未来路线图见 [FUTURE_ROADMAP.md](../portfolio-evidence/FUTURE_ROADMAP.md)。路线图项目均未在本轮实现。

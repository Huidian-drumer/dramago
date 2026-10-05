# Contributing to DramaGo

感谢你帮助改进开戏 DramaGo。

## 开始之前

1. 先搜索现有 Issue，避免重复工作。
2. Bug 报告请包含复现步骤、期望结果、实际结果和运行环境。
3. 影响创作行为的改动应先说明操作语义、失败方式与兼容范围。

## 本地验证

```bash
pnpm install
pnpm test
pnpm audit:l2
pnpm build
pnpm validate
pnpm db:validate
```

## Pull Request 要求

- 保持改动聚焦，不混入无关重构。
- 不提交 API Key、`.env`、用户素材或未脱敏 Trace。
- 不通过修改 fixture、降低断言或把 warning 政名为 pass 来让测试变绿。
- 修改候选正文、检查结果或采用流程时，必须补充版本与 hash 绑定测试。
- UI 改动需保持键盘可用、移动端可读和明确的错误状态。

## 设计原则

- 程序负责范围、版本、合并、保存与失败安全；模型负责生成和有限语义判断。
- Prompt 约束不能冒充程序约束。
- 用户明确的新要求优先于旧的 Story Facts；历史事实是上下文，不是不可变规则。
- 无法可靠判断时应诚实标记 unavailable 或 warning。

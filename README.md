# 开戏 DramaGo｜AI 短剧创作工作台

开戏 DramaGo 是一个面向作者的纯文字 AI 短剧创作工作台。它支持生成、扩写、改写和续写，同时用程序化的范围合并、版本保护、候选稿采用和独立语义校验，降低“整篇重写”“旧版本覆盖新版本”和模型失败伪成功等风险。

当前项目聚焦文字创作，不包含图片、视频、配音、实时 StoryWorld 或批量生成能力。

## 已实现能力

- `CREATE`：生成完整作品并保存为候选版本。
- `EXPAND`：支持全文扩写与可靠选区扩写；选区结果由程序合并。
- `REWRITE`：支持全文或选区改写，并保留来源版本和影响范围。
- `CONTINUE`：模型只返回续写内容，程序负责追加。
- 输出类型契约：区分 `full`、`segment` 和 `continuation`，类型错误会阻止自动采用。
- 版本安全：生成期间检测来源版本变化，采用候选稿时使用 compare-and-swap。
- 内容保护：保存轻量 Story Facts，并在写作完成后执行独立语义校验。
- 失败保护：Provider 未配置、超时、空响应、非法格式或超长输出均不会伪装成成功。
- Creative Trace：记录脱敏后的执行链路、合并策略、校验状态和采用事件。

旧互动原型保留在 `/experience`，继续使用原有 `dramaworld-v02` 浏览器数据，不参与创作请求。

## 项目结构

```text
web/                 作者工作台前端
worker/              API、创作路由、Provider、合并与校验逻辑
db/                  Drizzle 数据结构
drizzle/             数据库迁移
test/                单元与回归测试
audit/               Wrapper Audit 与故障注入测试
script-writer/       Script Writer V0.1 文字链路
```

## 本地运行

需要 Node.js 20+ 和 pnpm。

```bash
pnpm install
pnpm db:generate
pnpm test
pnpm build
pnpm validate
pnpm preview
```

额外审计命令：

```bash
pnpm audit:l2
pnpm db:validate
```

## 服务端配置

真实文本模型只从服务端环境变量读取：

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 是 | OpenAI-compatible Provider 密钥 |
| `OPENAI_MODEL` | 是 | Writer 使用的模型 |
| `OPENAI_ENDPOINT` | 否 | Provider 地址；未设置时使用默认兼容端点 |
| `VALIDATOR_MODEL` | 否 | 独立语义校验模型；默认复用 `OPENAI_MODEL` |
| `MAX_AUTO_REPAIRS` | 否 | 格式修复次数，默认 2，最大 2 |

前端没有密钥输入框。配置值不会写入日志、版本、导出稿件或 Git。未配置 Provider 时接口返回 `PROVIDER_NOT_CONFIGURED`，不会用 fixture 或固定正文冒充真实生成。

版本、候选稿、任务状态、模型标识和 Provider 返回的用量保存在 D1。正文输入同时在浏览器保存一份未提交草稿，以便失败后恢复；它不是权威版本存储。

## 设计边界

语义校验是最小内容保护层，不承诺识别所有事实或时间线冲突。用户明确要求修改既有事实时，旧 Story Facts 不会被当作不可变规则。普通文艺质量问题只产生警告，严重事实冲突和硬性保留项违规则阻止自动采用。

实现证据与已知限制见：

- [L2 Hardening 报告](L2_HARDENING_REPORT.md)
- [Wrapper Audit 报告](WRAPPER_AUDIT_REPORT.md)
- [创作工作台报告](CREATIVE_WORKBENCH_REPORT.md)

## 安全说明

请不要提交 API Key、Authorization Header、`.env` 或其他 Secret。公开问题中也不要粘贴未脱敏的 Provider 配置、提示词原文或用户素材。

## License

[MIT](LICENSE)


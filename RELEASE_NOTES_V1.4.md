# DramaGo V1.4 — Windows Text Studio Public Preview

状态：源码 Pre-release。公开标签：`v1.4.0-text-studio-public-preview`。不是生产级 SaaS，也不是公开稳定安装版；没有 Windows 下载资产。GitHub 自动生成的源码压缩包不能作为已验收 EXE 使用。

## 能力与边界

- 作品管理、空白作品、手工创作、SQLite 草稿、版本比较、历史恢复及 Markdown 导出。
- CREATE / EXPAND / REWRITE / CONTINUE、独立 Writer / Validator、候选隔离、审核恢复和 Hash / CAS 采用保护。
- Story Memory 使用保守的证据和状态可信策略；不能保证任意复杂中文事实的识别准确率。
- 人物关系树已从 UI 移除，可靠记忆能力保留。
- 不包含视频生成、TTS、分镜或生产级多租户 SaaS。
- 真实模型文学质量与 Validator 语义准确率尚未系统验收。受控测试、历史模型实验和个人操作验收不能混为通用质量保证。
- GitHub Pages 仅提供静态说明，不运行创作 API，也不存放服务端密钥。

本源码快照保留冻结版 desktop、local、worker、web、db、drizzle 和核心测试代码。新 Git 根不继承历史。仅调整文档与脱敏配置元数据，排除私人报告、运行结果与非必要实验产物。

新增入口文档不替代历史 v0.5.0 审计；原审计原文、Hash 和实验数字不改写。本次不声明新的真实模型测试、质量提升、完整版权原创证明或生产安全认证。

SQLite 迁移 0000–0009 保留。升级前需要备份；不支持把升级后的数据库直接交给旧程序。内部 Windows ZIP 尚未公开安全验收，不上传、不重新打包。MIT 适用于项目有权许可的源码，第三方适用各自许可证。

查看 [开发说明](docs/V1_4_TEXT_STUDIO.md) 和 [第三方许可](THIRD_PARTY_NOTICES.md)。

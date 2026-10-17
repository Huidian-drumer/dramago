# Security Policy

## Supported version

当前仅维护 `main` 分支的最新版本。

## Reporting a vulnerability

请不要在公开 Issue 中披露 API Key、用户素材、Provider 配置、认证信息或可利用的漏洞细节。

请通过 GitHub 仓库所有者主页提供的私下联系方式报告，并包含：

- 受影响的文件、接口或版本；
- 可复现的最小步骤；
- 可能影响；
- 已知缓解方式（如有）。

项目会优先处理以下问题：

- Secret 被写入前端、日志、版本或 Creative Trace；
- 旧候选稿绕过 CAS 覆盖新版本；
- candidate、checks 或 adopt 跨作品串用；
- Provider 失败被错误记录为成功；
- Prompt Injection 导致越权操作或敏感数据泄露。

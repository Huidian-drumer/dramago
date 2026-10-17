# Windows Text Studio V1.4 开发说明

## 运行边界

desktop/main.mjs 为 Electron 壳；utilityProcess 启动 local/server.mjs。本地服务绑定回环地址并校验随机会话 Token、Host 与 Origin。local/sqlite-d1.mjs 提供 SQLite 事务；worker 实现操作、候选、审核、Hash/CAS 及 Story Memory。这不是多租户授权服务。

Windows 开发需要 Node.js 24.18+ 和锁文件对应依赖。Electron 44.7.0 自带其 Node 运行时；不能以开发机 Node 版本推断最终 EXE。真实 DPAPI 凭据与正式数据库不得作为夹具。

## 构建与测试

`pnpm build` 从 web/worker 构建 dist/server；dist/index.html 和 dist/app.js 是 Legacy 输入，不可把整个 dist 当成纯生成目录删除。`.openai/hosting.json` 只保留 DB 绑定，没有真实托管项目标识，不构成部署授权。

`pnpm test` 保留全部既有 test/*.test.mjs；`audit:l2` 使用受控模型。生成的 JSON、日志、截图、node_modules、缓存与 ZIP 不应提交。Windows 打包代码、Fuses 配置、主进程、安全错误页和全部迁移保留。本轮不重新打包。

## 版本、审核和记忆

已有作品 CREATE 整篇重生成需明确确认；EXPAND/REWRITE 使用可靠选区；CONTINUE 必须 PROGRAM_APPEND。候选保存与采用分离，Validator 不可用不能由 UI 模拟通过。审核复用需可信绑定和明确兼容规则；重新审核需确认第三方发送及费用，未知结果不自动重试。

Story Memory 只从正式采用版本形成有效上下文，旧记忆和复杂状态保守降级；不是任意中文语义的真值系统。

## 数据与回退

0000–0009 是本地迁移链。迁移/恢复前保留独立备份；程序与数据目录分离。回退应恢复匹配旧程序的数据备份，不仅替换 EXE 后继续写新数据库。禁止把真实数据库、WAL/SHM、DPAPI 文件或 Key 导出到 Git。

## 来源与限制

源码来自负责人授权的冻结文件，新仓库不含其 Git 历史、私人验收报告、截图或生产遥测。测试使用合成文本；保留的 v0.5.0 公共摘要按其日期理解，不冒充 V1.4 结果。

真实模型质量、完整 IME/休眠/干净系统矩阵、二进制签名、云端隔离和预算不由源码测试证明。视频分镜、角色一致性及视频 API 未实现。Pages 首页说明当前 V1.4；保留的 v0.5.0 文档带历史提示，不作为新版安装指引。Pages 不承载服务端密钥或创作 API。

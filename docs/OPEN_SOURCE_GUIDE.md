# 开源说明 / Open Source Guide

## 简体中文

这份说明面向准备使用、fork、贡献或发布 Novel Director 的开源参与者。它补充 README、CONTRIBUTING、SECURITY 和 TESTING 中的规则，帮助大家理解仓库边界。

### 项目定位

Novel Director 是一个实验性的、本地优先桌面工作台，用于 AI 辅助长篇小说创作管理。当前版本是 `0.1.0` 预览版，优先服务本地试用、功能验证和社区贡献。

它不是：

- 云同步服务。
- 多账号协作平台。
- 托管 AI provider。
- 稳定公共数据交换协议。
- 已签名的商业发行包。

### 仓库包含什么

- Electron + React + TypeScript 源码。
- 本地 SQLite 存储后端和 JSON fallback。
- Prompt 构建、生产流水线、质量门禁、修订和版本链相关代码。
- 验证脚本、CI workflow、公开文档和许可证。
- synthetic demo data 和 fixture 脚本。

### 仓库不应包含什么

- 真实 API Key、bearer token 或 `.env` 文件。
- 私有小说稿件、客户数据、完整 prompt 或 Run Trace。
- 本地数据库、导出的 AppData JSON、章节正文导出文件。
- 打包后的 `.exe`、`.msi`、`.zip`、`release/` 或 `win-unpacked/`。
- 带有私有稿件内容的截图。
- 开发者本机绝对路径。

### 许可证

源码以 MIT License 发布。第三方依赖许可证见 `THIRD_PARTY_NOTICES.md`。如果你发布二进制包，请同时提供源码链接、许可证、构建说明和校验和。

### 隐私和 AI Provider 边界

应用默认在本机保存项目数据。配置远程 AI provider 后，所选上下文和 prompt 会发送到你配置的服务。贡献者不应假设用户稿件可以公开、上传或用于训练。

安全问题请按 `SECURITY.md` 私下报告，不要在公开 issue 中贴真实密钥或私有数据。

### 推荐贡献路径

1. 先阅读 `README.md` 和 `docs/BEGINNER_TUTORIAL.md`，理解作者主流程。
2. 阅读 `ROADMAP.md`，选择一个范围小、可验证的任务。
3. 修改前运行：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

4. 修改后补充或更新验证脚本。
5. PR 中说明用户可见行为、数据兼容性影响和测试结果。

### 发布二进制包

源码仓库不跟踪打包产物。发布安装包时建议：

1. 从干净 checkout 构建。
2. 运行 `npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build`。
3. 运行 `npm.cmd run dist:win`。
4. 运行打包后 smoke test。
5. 生成 SHA256 校验和。
6. 把安装包、校验和和变更说明上传到 GitHub Releases。

未签名 Windows 安装包可能触发 SmartScreen。正式公开分发建议配置代码签名证书。

### Issue 和讨论建议

提交问题时请包含：

- 版本号或 commit。
- 操作系统。
- 复现步骤。
- 脱敏日志或截图。
- 是否使用远程 AI provider。

请不要包含：

- API Key。
- 完整私有稿件。
- 本地数据库或 AppData JSON。
- 未脱敏 Run Trace。

---

## English

This guide is for people who want to use, fork, contribute to, or release Novel Director. It complements README, CONTRIBUTING, SECURITY, and TESTING.

### Project Positioning

Novel Director is an experimental, local-first desktop workbench for AI-assisted long-form fiction management. Version `0.1.0` is a preview for local trials, validation, and community contribution.

It is not:

- a cloud sync service,
- a multi-account collaboration platform,
- a hosted AI provider,
- a stable public data exchange protocol,
- or a signed commercial release package.

### What the Repository Contains

- Electron + React + TypeScript source code.
- Local SQLite storage backend and JSON fallback.
- Prompt building, generation pipeline, quality gate, revision, and version-chain code.
- Validation scripts, CI workflow, public docs, and license files.
- Synthetic demo data and fixture scripts.

### What the Repository Should Not Contain

- Real API keys, bearer tokens, or `.env` files.
- Private manuscripts, customer data, full prompts, or full Run Trace payloads.
- Local databases, exported AppData JSON, or manuscript export files.
- Packaged `.exe`, `.msi`, `.zip`, `release/`, or `win-unpacked/` artifacts.
- Screenshots containing private manuscript text.
- Developer-machine absolute paths.

### License

The source code is released under the MIT License. See `THIRD_PARTY_NOTICES.md` for third-party dependency notices. If you distribute binaries, include the source link, license, build notes, and checksums.

### Privacy and AI Provider Boundary

Project data is stored locally by default. If a remote AI provider is configured, selected context and prompts are sent to that provider. Contributors should never assume user manuscripts may be uploaded, published, or used for training.

Report security issues privately according to `SECURITY.md`. Do not post real keys or private data in public issues.

### Recommended Contribution Flow

1. Read `README.md` and `docs/BEGINNER_TUTORIAL.md` to understand the author workflow.
2. Read `ROADMAP.md` and pick a narrow, verifiable task.
3. Before editing, run:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

4. Add or update validation scripts with your change.
5. In the PR, describe user-visible behavior, data compatibility impact, and validation results.

### Releasing Binaries

Build artifacts are not tracked in source. For release packages:

1. Build from a clean checkout.
2. Run `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build`.
3. Run `npm.cmd run dist:win`.
4. Run packaged smoke tests.
5. Generate SHA256 checksums.
6. Upload installer, checksum, and release notes to GitHub Releases.

Unsigned Windows installers may trigger SmartScreen. Configure code signing for public distribution.

### Issues and Discussions

Include:

- app version or commit,
- operating system,
- reproduction steps,
- redacted logs or screenshots,
- whether a remote AI provider was used.

Do not include:

- API keys,
- full private manuscripts,
- local databases or AppData JSON,
- unredacted Run Trace content.

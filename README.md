# Novel Director

## 简体中文

Novel Director 是一个实验性的、本地优先的 AI 长篇小说工作台。它是面向长篇创作的“小说导演台”：管理项目圣经、章节连续性、角色状态账本、伏笔调度、Prompt 上下文、生成追踪、质量门禁和修订流程。

当前仓库是早期 `0.1.0` 预览版，适合本地试用和开发验证。数据格式和交互体验仍在演进中，请在真实稿件上使用前做好备份。

### 项目状态

- 实验性本地优先桌面应用。
- Windows 是主要开发和验证平台。
- 项目数据默认以本地 JSON 保存。
- AI 功能是可选的，取决于你配置的模型供应商。
- 源码仓库不跟踪预构建 `.exe` 或打包产物。

### 核心能力

- 长篇小说项目管理。
- 小说圣经，用于稳定长期设定。
- 章节编辑器，支持复盘字段、章节衔接桥、复制和导出。
- 角色卡、角色状态账本、伏笔账本、时间线和阶段摘要。
- Prompt 构建器，支持 token 预算、上下文快照、伏笔处理方式和优先级 Prompt 组装。
- 章节生产流水线，包含章节计划、正文草稿、章节复盘、记忆候选、一致性审稿、质量门禁和 Run Trace。
- 修订工作台，支持版本历史和差异对比。
- 本地数据路径管理，支持备份、迁移和合并预览。
- 在 Electron `safeStorage` 可用时，使用安全存储保存 API Key。

### 安装

```bash
npm install
```

Windows PowerShell 中，如果脚本执行策略阻止 `npm.ps1`，通常使用 `npm.cmd` 更稳：

```bash
npm.cmd install
```

### 启动开发版

```bash
npm.cmd run dev
```

### 验证

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

### 打包 Windows 安装包

```bash
npm.cmd run dist:win
```

生成产物位于：

- `release/Novel Director Setup 0.1.0.exe`
- `release/win-unpacked/Novel Director.exe`

当前默认生成未签名试用包，Windows 可能显示 SmartScreen 提醒。正式发布建议配置代码签名证书、应用图标和校验和。

### AI Provider 设置

在应用的设置页中配置：

- Provider
- Base URL
- Model name
- Temperature
- Max tokens
- API key

API Key 不应持久化到主 AppData JSON。桌面应用通过 Electron 安全存储保存密钥，renderer 进程只应知道“是否已保存密钥”，不应读取完整明文 key。

启用远程 AI 后，被选中的项目上下文和 prompt 内容会发送给你配置的供应商。请在使用真实稿件前阅读供应商的条款和隐私政策。

### 隐私和本地数据边界

Novel Director 是本地优先工具。项目数据存储在你的机器上，通常位于 Electron `userData`，也可以在设置页选择自定义数据路径。

重要边界：

- renderer 不直接获得 Node `fs` 访问能力。
- 文件操作通过受控 IPC 处理。
- API Key 不应出现在导出的项目 JSON 中。
- 如果使用远程 AI provider，prompt 上下文会在该请求中离开本机。
- 请不要在公开 issue 中粘贴真实 API Key、私有稿件或本地数据文件。

### 构建产物

本仓库不跟踪生成的 `.exe`、安装包或打包后的应用目录。分发产物应通过 GitHub Releases 发布，并附带构建说明和校验和。

轻量 launcher 源码位于 `tools/`。它会从 `NOVEL_DIRECTOR_PROJECT_PATH` 或 launcher 所在位置向上搜索项目路径，不应包含开发者本机绝对路径。

### 虚构测试数据声明

测试、文档、fixture、截图或回归脚本中出现的小说标题、角色名、剧情片段和故事摘录均为 synthetic demo data。它们不是客户稿件，也不应被视为真实创作文本。

回归项目可能显示为 `Fog City Test Draft` / `《雾城测试稿》`。如果未来加入公开截图，应使用干净的虚构样例重新生成，并放在 `docs/assets/`。

### 文档

- [快速开始](./QUICKSTART.md)
- [测试指南](./TESTING.md)
- [路线图](./ROADMAP.md)
- [安全策略](./SECURITY.md)
- [贡献指南](./CONTRIBUTING.md)
- [更新日志](./CHANGELOG.md)
- [第三方声明](./THIRD_PARTY_NOTICES.md)

### 贡献

请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。提交 PR 前至少运行：

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

### 安全

请私下报告安全问题。详见 [SECURITY.md](./SECURITY.md)。不要在公开 issue 中提交 API Key、私有项目数据、生成正文或本地数据文件。

### 许可证

Novel Director 使用 [MIT License](./LICENSE) 发布。

---

## English

Novel Director is an experimental, local-first desktop workbench for managing AI-assisted long-form fiction projects. It is designed for authors who need more than a text editor: project bibles, chapter continuity, character state, foreshadowing schedules, prompt context control, generation traces, quality gates, and revision workflows.

This repository is an early `0.1.0` preview. It is useful for local trials and development, but the data format and UX are still evolving.

### Status

- Experimental local-first desktop app.
- Windows is the primary development target.
- Data is stored locally as JSON.
- AI features are optional and depend on the provider you configure.
- No prebuilt binaries are tracked in this source repository.

### Features

- Project management for long-form fiction.
- Story bible for stable long-term canon.
- Chapter editor with recap fields, continuity bridge, copy, and export.
- Character cards, character state ledger, foreshadowing ledger, timeline, and stage summaries.
- Prompt Builder with token budgeting, context snapshots, foreshadowing treatment modes, and priority-ordered prompt assembly.
- Generation Pipeline for chapter plan, draft, review, memory candidates, consistency review, quality gate, and run trace.
- Revision workbench with version history and diff view.
- Local data path management with backup, migration, and merge preview.
- Secure API key storage through Electron `safeStorage` when available.

### Install

```bash
npm install
```

On Windows PowerShell, `npm.cmd` is often more reliable than `npm` if script execution policies block `npm.ps1`:

```bash
npm.cmd install
```

### Run

```bash
npm.cmd run dev
```

### Validate

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

### Package for Windows

```bash
npm.cmd run dist:win
```

Generated artifacts are written to:

- `release/Novel Director Setup 0.1.0.exe`
- `release/win-unpacked/Novel Director.exe`

The default package is an unsigned trial build. Windows may show a SmartScreen warning. For public releases, configure code signing, an application icon, and checksums.

### AI Provider Setup

Open Settings in the app and configure:

- Provider
- Base URL
- Model name
- Temperature
- Max tokens
- API key

The API key is not intended to be persisted in the main AppData JSON. The desktop app stores it through Electron secure storage and only exposes key presence to the renderer process.

When AI generation is enabled, selected project context and prompt content may be sent to the configured provider. Review your provider's terms and privacy policy before using real manuscript data.

### Privacy and Local Data Boundary

Novel Director is local-first. Project data is stored on your machine, normally in Electron `userData`, unless you choose a custom data path in Settings.

Important boundaries:

- The renderer does not receive direct Node `fs` access.
- File operations go through controlled IPC handlers.
- API keys should not appear in exported project JSON.
- If you use a remote AI provider, prompt context leaves your machine for that request.
- Do not paste real API keys, private manuscripts, or local data files into public issues.

### Build Artifacts

This repository does not track generated `.exe` files or packaged app binaries. Build artifacts should be produced from source and distributed through GitHub Releases with checksums.

The lightweight launcher source is in `tools/`. It resolves the project path from `NOVEL_DIRECTOR_PROJECT_PATH` or by searching upward from the launcher location; it should not contain developer-machine absolute paths.

### Synthetic Test Data

All novel titles, characters, plot fragments, and story excerpts used in tests, docs, fixtures, screenshots, or regression scripts are synthetic demo data. They are not customer manuscripts and should not be treated as production writing.

The regression project sometimes appears as `Fog City Test Draft` / `《雾城测试稿》`; it is a fictional fixture created only for testing. Public screenshots are not tracked in this repository. If screenshots are added later, they should be regenerated from clean synthetic demo data and placed under `docs/assets/`.

### Documentation

- [Quickstart](./QUICKSTART.md)
- [Testing guide](./TESTING.md)
- [Roadmap](./ROADMAP.md)
- [Security policy](./SECURITY.md)
- [Contributing guide](./CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)
- [Third-party notices](./THIRD_PARTY_NOTICES.md)

### Contributing

Please read [CONTRIBUTING.md](./CONTRIBUTING.md). The minimum checks before opening a pull request are:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

### Security

Please report vulnerabilities privately. See [SECURITY.md](./SECURITY.md). Do not open public issues containing API keys, private project data, generated manuscripts, or local data files.

### License

Novel Director is released under the [MIT License](./LICENSE).

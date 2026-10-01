# Novel Director

## 简体中文

Novel Director 是一个实验性的、本地优先的 AI 长篇小说工作台。它是面向长篇创作的“小说导演台”：管理项目圣经、章节连续性、角色状态账本、伏笔调度、Prompt 上下文、生成追踪、质量门禁和修订流程。

当前仓库是早期 `0.1.6-preview.18` 本地试用候选，适合本地试用和开发验证，不表示已发布 GitHub Release。数据格式和交互体验仍在演进中，请在真实稿件上使用前做好备份。

Preview.18 将当前 Ink Desk 界面更新纳入安装包与 `win-unpacked`，统一导航、页面、正文区域和操作反馈。发行路径、验证和旧包清理范围见 [发行产物说明](./docs/RELEASE_ARTIFACTS.md)；不迁移或删除作者的小说数据。

Preview.17 针对后端实测热点减少每日备份检查的全库读取、旧任务恢复和 Novelty 审计的重复计算，修补 SQLite 首次打开及迁移失败路径，并保留现有事务、JSON fallback 和生成行为。范围、前后实测与复现命令见 [后端性能复核](./docs/BACKEND_PERFORMANCE_REVIEW.md)。

Preview.16 修复角色之间的新建状态输入串用，以及日志/状态保存回执清掉新输入的问题。角色切换保留各自页内草稿，保存中防重复点击，失败可继续编辑和重试；不自动入账或接受候选。见 [角色编辑反馈验收](./docs/UI_HIG_CHARACTER_DRAFTS.md)。

Preview.15 补齐官方 DeepSeek V4.1 Flash 的 `deepseek-flash` 名称兼容，保持与旧 Flash 名称一致的非思考请求参数，不改作者保存的模型和第三方端点。真实模型对照本轮按作者要求跳过，未产生费用；见 [检查与修复记录](./docs/DEEPSEEK_FLASH_COMPATIBILITY.md)。

Preview.14 将角色页整理为角色资料、动态账本和状态日志，加入角色搜索、键盘页签和按需展开的新建状态表单。账本先呈现已生效状态，不改变候选确认和保存逻辑。见 [角色工作区验收](./docs/UI_HIG_CHARACTER_WORKSPACE.md)。

Preview.13 延续 HIG 工作区优化：项目列表优先展示，Prompt 分为任务、编辑、上下文和历史，保留手动编辑及准确的快照来源；修订保存不覆盖新输入。页面变化、验证范围与实际包状态见 [作者工作区验收](./docs/UI_HIG_AUTHOR_WORKSPACE.md)。

Preview.12 统一明暗主题、按钮和文字层级，顶部可收起侧栏，窄窗口保留章节列表与正文并排，修复深色角色页的可读性。借鉴 Apple HIG，保留 Windows 使用习惯；详见 [界面验收记录](./docs/UI_HIG_WORKSPACE.md)。

Preview.11 修复采纳草稿时因默认字段差异误报生成记录不可变的问题；无需重新生成正文。修复边界与验证见 [采纳误冲突记录](./docs/FIX_DRAFT_ACCEPTANCE_TRACE.md)。

Agent 四个项目概览工具已改为定向读取，500 章摘要中位耗时约从 397ms 降到 32ms，信息不减少。见 [Agent 概览实测](./docs/OPTIMIZATION_AGENT_OVERVIEW_READ.md)。需重新连接常驻的仓库 MCP 服务；本批不改变桌面全量刷新，也不宣称减少模型 token。

本批针对实测瓶颈改善长篇保存：编辑一章不再重写全部历史，生成步骤校验不再加载整本小说。新增 10/100/500 章真实存储与 Electron 基准、正式采纳链成本归集；全量读取和真实模型质量/费用仍有待改进或对照，不夸大收益。数据与复现命令见 [W09/W10 实测记录](./docs/OPTIMIZATION_W09_W10_MEASUREMENT.md)。

本批补齐 Agent 的任务、世界资料编辑和可撤回项目授权。作者在 Agent 页授予范围，Codex 可在范围内逐章生成、审阅、决定和提交，作者通过“读取最新结果”接手同一份数据。授权不随小说备份导入。操作见 [项目授权指南](./docs/AGENT_PROJECT_AUTHORIZATION.md)；是否已打包以同版本的 `release/BUILD_INFO.json` 为准。

此前正文优先布局、配置与报告折叠见 [W07 试用记录](./docs/OPTIMIZATION_W07_TRIAL.md)，九字段编辑及上下文复用见 [任务编辑试用记录](./docs/OPTIMIZATION_W06_TRIAL.md)。

此前已支持候选处理历史、部分选择、伏笔/时间线筛选，以及可预览、保留历史的撤销；Agent 共享同一事务命令。操作、边界和验收见 [第五批 W03 试用记录](./docs/OPTIMIZATION_W03_TRIAL.md)。跨页重写暂存、调用状态和 Agent 修订见 [第四批试用记录](./docs/OPTIMIZATION_W04_W05_W08_TRIAL.md)。

### 项目状态

- 实验性本地优先桌面应用。
- Windows 是主要开发和验证平台。
- 项目数据默认保存到本地 SQLite 数据库；JSON 导入、导出和 fallback 仍然保留。
- AI 功能是可选的，取决于你配置的模型供应商。
- 源码仓库不跟踪预构建 `.exe` 或打包产物。

### 核心能力

- 长篇小说项目管理。
- 小说圣经，用于稳定长期设定。
- 章节编辑器，支持复盘字段、章节衔接桥、复制和导出。
- 角色卡、角色状态账本、伏笔账本、时间线和阶段摘要。
- Prompt 构建器，支持 token 预算、上下文快照、伏笔处理方式和优先级 Prompt 组装。
- 章节生产流水线，包含章节计划、正文草稿、章节复盘、记忆候选、一致性审稿、质量门禁和 Run Trace。
- 运行时写作 Prompt Guard，会清理占位符、重复禁令和审稿口吻，并把有价值的风险提示转译成当前写作限制。
- 质量门禁、Novelty Audit 和冗余诊断通过 main process 诊断接口执行，renderer 只接收结构化报告。
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

Runtime performance and Chinese Novelty Audit baselines:

```bash
npm.cmd run perf:novelty
npm.cmd run native:electron
npm.cmd run perf:ui
npm.cmd run native:node
```

真实性能与中文 Novelty Audit 基线：

```bash
npm.cmd run perf:novelty
# UI 基准需要 Electron ABI 的 SQLite native binding
npm.cmd run native:electron
npm.cmd run perf:ui
npm.cmd run native:node
```

### 打包 Windows 安装包

```bash
npm.cmd run dist:win
```

生成产物位于：

- `release/Novel Director Setup 0.1.6-preview.7.exe`
- `release/win-unpacked/Novel Director.exe`

`release/` 始终只保留当前可分发版本；历史安装包会集中归档到 `releases/archive/`。每次成功打包还会生成 `BUILD_INFO.json` 和 `SHA256SUMS.txt`，用于确认版本、构建时间与安装包校验值。详见 [发行产物说明](docs/RELEASE_ARTIFACTS.md)。

当前默认生成未签名试用包，Windows 可能显示 SmartScreen 提醒。正式发布建议配置代码签名证书、应用图标和校验和。

### Windows 打包、SQLite 与 native 依赖

Novel Director 使用 `better-sqlite3` 作为 main process 的 SQLite 后端。它是 native 依赖，在 Windows 上可能需要 Visual Studio C++ Build Tools（含 MSVC、Windows SDK 和 C++ CMake tools）才能重新编译 Electron 绑定。

建议：

- 开发机先运行 `npm.cmd install`，再运行 `npm.cmd run build`。
- 运行 Electron 预览并连接 SQLite 前，先运行 `npm.cmd run native:electron`，或直接使用 `npm.cmd run preview:sqlite`。
- 跑 Agent CLI、验证脚本或 Node.js 侧 SQLite 测试前，运行 `npm.cmd run native:node`，把 `better-sqlite3` 恢复为本机 Node.js ABI。
- 打包使用 `npm.cmd run dist:win`，脚本会使用仓库内 `.electron-cache` 和 `.electron-builder-cache`，减少 C 盘缓存压力。
- 打包流程会在生成 `release/win-unpacked/Novel Director.exe` 后运行 `npm.cmd run smoke:packaged`，检查图标、preload API、SQLite 默认路径、导入导出 API 和无 API Key 状态。
- 如果 `better-sqlite3` rebuild 失败，先安装 Visual Studio C++ Build Tools；应用代码仍保留 JsonStorageService fallback，但正式安装包应优先修复 native 绑定后再发布。

单独运行打包后烟测：

```bash
npm.cmd run smoke:packaged
```

### 数据恢复与旧数据导入

首次打开如果项目列表为空，可以在首页点击“导入旧数据 JSON”，选择旧版导出的 AppData JSON。已有项目时，首页默认执行保守合并；设置页明确区分“合并导入 JSON”和需要危险确认的“覆盖导入 JSON”。无法自动解决的合并冲突不会写入数据库，覆盖前会创建恢复备份，导入文件中的旧 API Key 会被忽略。设置页仍提供导出、备份、恢复和数据路径迁移。

排查建议：

- 如果 SQLite 数据库损坏，先备份当前 `novel-director-data.sqlite`，再尝试从设置页恢复最近备份或导入旧 JSON。
- 如果 JSON 导入失败，确认文件来自 Novel Director 导出或旧版 `novel-director-data.json`，不要直接导入章节 TXT/Markdown。
- 如果迁移或合并失败，不要删除源文件；检查自动生成的 `.bak` 或迁移前备份。
- 如果备份恢复失败，保留失败文件和日志，通过 Settings 的日志导出或 issue 模板提交脱敏信息。

### AI Provider 设置

在应用的设置页中配置：

- Provider
- Base URL
- Model name
- Temperature
- Max tokens
- API key

也可以选择 `Codex CLI（订阅登录）`，复用本机 Codex CLI 的 ChatGPT 登录态，不需要把 API Key 交给工作台：

1. 安装 Codex CLI：`npm install -g @openai/codex`。
2. 在终端运行 `codex login`，按提示使用 ChatGPT 账号登录。
3. 在设置页选择 `Codex CLI（订阅登录）`，点击“检测 Codex CLI”。
4. 模型留空会使用 CLI 默认模型；单次调用超时建议至少设为 300 秒。

CLI 模式由 Electron 主进程在空临时目录中调用 `codex exec`，使用只读沙箱和一次性会话。工作台不读取或保存 Codex 登录令牌，但发送给模型的章节上下文仍会交给 OpenAI；可用计划、额度和速率限制以当前 ChatGPT/Codex 账号为准。详见 [Codex CLI Provider](./docs/CODEX_CLI_PROVIDER.md)。

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
- [新手教程](./docs/BEGINNER_TUTORIAL.md)
- [开源说明](./docs/OPEN_SOURCE_GUIDE.md)
- [全盘优化施工计划](./docs/PRODUCT_OPTIMIZATION_MASTER_PLAN.md)
- [AI 工作流与 Prompt 风险施工计划](./docs/AI_WORKFLOW_PROMPT_REPAIR_PLAN.md)
- [AI 代理运行层施工计划](./docs/AGENT_RUNTIME_PLAN.md)
- [Agent Tool API 与无界面单章生产](./docs/AGENT_TOOL_API.md)
- [性能测量与本机基线](./docs/PERFORMANCE.md)
- [Novelty Audit 中文匹配边界](./docs/NOVELTY_AUDIT.md)
- [流水线诊断可靠性](./docs/PIPELINE_RELIABILITY.md)
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

This repository is an early `0.1.6-preview.18` local trial candidate, not a claim of a published GitHub release. Preview.18 packages the current Ink Desk UI updates for navigation, pages, manuscript surfaces and interaction feedback; see [release artifacts](./docs/RELEASE_ARTIFACTS.md) for paths, verification and cleanup scope. Author data is not migrated or deleted. Preview.17 reduces measured backend overhead in backup checks, legacy normalization and Novelty matching, and fixes SQLite initialization failure paths without changing generation or persistence contracts; see the [backend review](./docs/BACKEND_PERFORMANCE_REVIEW.md). Preview.16 isolates page-local character drafts and protects newer input from late save receipts; see the [editing record](./docs/UI_HIG_CHARACTER_DRAFTS.md). Preview.15 keeps the official `deepseek-flash` name and legacy aliases on the same non-thinking request path; see the [compatibility record](./docs/DEEPSEEK_FLASH_COMPATIBILITY.md). No paid model comparison was run this round. Preview.14 adds searchable characters and separate profile, ledger and log tabs; see the [character workspace checks](./docs/UI_HIG_CHARACTER_WORKSPACE.md). It builds on the project-first home, tabbed Prompt editor and safer editing feedback from [Preview.13](./docs/UI_HIG_AUTHOR_WORKSPACE.md), the shared [HIG workspaces](./docs/UI_HIG_WORKSPACE.md), and the [draft-acceptance fix](./docs/FIX_DRAFT_ACCEPTANCE_TRACE.md).

Four compact Agent entry tools use scoped reads; the measured 500-chapter digest median falls from 397ms to 32ms with identical output. Reconnect an existing repository MCP process to load this change. Desktop refresh and full-detail reads are unchanged. See the [Agent overview measurement](./docs/OPTIMIZATION_AGENT_OVERVIEW_READ.md) and prior [storage/UI measurements](./docs/OPTIMIZATION_W09_W10_MEASUREMENT.md). Synthetic tests do not prove literary quality or provider-cost savings. Agent task/world editing and revocable project grants remain available; see the [authorization guide](./docs/AGENT_PROJECT_AUTHORIZATION.md). Packaging status is recorded separately in the matching `release/BUILD_INFO.json`.

The [W07 trial record](./docs/OPTIMIZATION_W07_TRIAL.md) covers prose-first workspaces; the [task-editing trial record](./docs/OPTIMIZATION_W06_TRIAL.md) covers scoped context reuse. Candidate history and transaction-backed undo remain in the [fifth trial record](./docs/OPTIMIZATION_W03_TRIAL.md), and quick-rewrite candidates and Agent revision in the [fourth trial record](./docs/OPTIMIZATION_W04_W05_W08_TRIAL.md).

### Status

- Experimental local-first desktop app.
- Windows is the primary development target.
- Data is stored locally in SQLite by default; JSON import, export, and fallback remain available.
- AI features are optional and depend on the provider you configure.
- No prebuilt binaries are tracked in this source repository.

### Features

- Project management for long-form fiction.
- Story bible for stable long-term canon.
- Chapter editor with recap fields, continuity bridge, copy, and export.
- Character cards, character state ledger, foreshadowing ledger, timeline, and stage summaries.
- Prompt Builder with token budgeting, context snapshots, foreshadowing treatment modes, and priority-ordered prompt assembly.
- Generation Pipeline for chapter plan, draft, review, memory candidates, consistency review, quality gate, and run trace.
- Runtime writing prompt guard that removes placeholders, duplicate guardrails, and review-tone text, while rewriting useful risks into current writing constraints.
- Quality Gate, Novelty Audit, and redundancy diagnostics run through the main-process diagnostics API; the renderer receives structured reports.
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

- `release/Novel Director Setup 0.1.6-preview.7.exe`
- `release/win-unpacked/Novel Director.exe`

`release/` contains only the current distributable build. Historical artifacts are kept under `releases/archive/`. Successful packaging also writes `BUILD_INFO.json` and `SHA256SUMS.txt` for version and integrity checks. See [Release Artifacts](docs/RELEASE_ARTIFACTS.md).

The default package is an unsigned trial build. Windows may show a SmartScreen warning. For public releases, configure code signing, an application icon, and checksums.

### Windows Packaging, SQLite, and Native Dependencies

Novel Director uses `better-sqlite3` as the main-process SQLite backend. It is a native dependency, so Windows builds may require Visual Studio C++ Build Tools, including MSVC, Windows SDK, and C++ CMake tools, to rebuild Electron bindings.

Recommendations:

- Run `npm.cmd install`, then `npm.cmd run build` on the development machine.
- Before running Electron preview against SQLite, run `npm.cmd run native:electron`, or use `npm.cmd run preview:sqlite`.
- Before running Agent CLI, validation scripts, or Node-side SQLite tests, run `npm.cmd run native:node` to restore the `better-sqlite3` binding for the local Node.js ABI.
- Use `npm.cmd run dist:win` for packaging. The script uses repository-local `.electron-cache` and `.electron-builder-cache` directories to reduce C drive pressure.
- The packaging flow runs `npm.cmd run smoke:packaged` after creating `release/win-unpacked/Novel Director.exe`; the smoke test checks the icon, preload API, SQLite default path, import/export API, and no-key state.
- If `better-sqlite3` rebuild fails, install Visual Studio C++ Build Tools first. The app retains JsonStorageService fallback in code, but release packages should be shipped only after the native binding is healthy.

Run packaged smoke test separately:

```bash
npm.cmd run smoke:packaged
```

### Recovery and Old Data Import

If the project list is empty on first launch, click `导入旧数据 JSON` and select an older exported AppData JSON file. When projects already exist, Home uses conservative merge import. Settings separates `合并导入 JSON` from the explicitly confirmed `覆盖导入 JSON`. Unresolved merge conflicts do not write anything, replacement creates a recovery backup first, and legacy API keys found in imported files are ignored. Settings also provides export, backup, restore, and storage-path migration.

Troubleshooting:

- If the SQLite database is corrupted, back up `novel-director-data.sqlite` first, then restore a recent backup or import old JSON from Settings.
- If JSON import fails, make sure the file is a Novel Director export or legacy `novel-director-data.json`, not a chapter TXT/Markdown export.
- If migration or merge fails, do not delete the source file; check the generated `.bak` files or pre-migration backups.
- If backup restore fails, keep the failed file and logs, then share redacted diagnostics through the security or issue process.

### AI Provider Setup

Open Settings in the app and configure:

- Provider
- Base URL
- Model name
- Temperature
- Max tokens
- API key

Alternatively, choose `Codex CLI (subscription sign-in)` to reuse the local Codex CLI login without storing an API key in Novel Director. Install `@openai/codex`, run `codex login`, select the provider, and use the built-in status check. The main process runs `codex exec` in an empty temporary directory with a read-only sandbox and an ephemeral session. Account availability and limits remain governed by the active ChatGPT/Codex plan. See [Codex CLI Provider](./docs/CODEX_CLI_PROVIDER.md).

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
- [Beginner tutorial](./docs/BEGINNER_TUTORIAL.md)
- [Open source guide](./docs/OPEN_SOURCE_GUIDE.md)
- [AI workflow and prompt repair plan](./docs/AI_WORKFLOW_PROMPT_REPAIR_PLAN.md)
- [Agent Runtime implementation plan](./docs/AGENT_RUNTIME_PLAN.md)
- [Performance measurement](./docs/PERFORMANCE.md)
- [Novelty Audit Chinese matching boundaries](./docs/NOVELTY_AUDIT.md)
- [Pipeline diagnostic reliability](./docs/PIPELINE_RELIABILITY.md)
- [Testing guide](./TESTING.md)
- [Roadmap](./ROADMAP.md)
- [Product optimization master plan](./docs/PRODUCT_OPTIMIZATION_MASTER_PLAN.md)
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

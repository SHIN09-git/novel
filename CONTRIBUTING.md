# 贡献指南 / Contributing to Novel Director

## 简体中文

感谢你帮助改进 Novel Director。这个项目是一个本地优先的 Electron + React + TypeScript 桌面工作台，面向 AI 辅助长篇小说创作。

### 开发环境

```bash
npm install
npm run dev
```

Windows PowerShell 中，如果脚本执行策略阻止 `npm.ps1`，建议使用 `npm.cmd`：

```powershell
npm.cmd install
npm.cmd run dev
```

### 必跑检查

提交 pull request 前运行：

```bash
npm run typecheck
npm test
npm run build
```

Windows 等价命令：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

### Pull Request 要求

- 保持改动范围清晰，并说明用户可见行为。
- 不要提交本地数据文件、导出的正文、带有私有文本的截图、生成的 launcher 或打包二进制。
- 不要提交 API Key、`.env` 文件或本机绝对路径。
- 保持本地数据兼容。如果持久化类型发生变化，请更新 normalize 和验证脚本。
- renderer 文件访问必须经过 preload/main IPC 边界。
- 涉及数据安全的改动需要新增或更新验证脚本。
- AI 输出写入项目数据前必须先校验和 normalize。

### 打包和二进制

不要把 `.exe`、`.msi`、`.zip` 或生成的 launcher 二进制提交到源码仓库。构建产物应发布到 GitHub Releases，并附带构建说明和校验和。

### 数据安全

涉及 storage、migration、backup、API credentials、prompt building、generation pipeline、revision acceptance 或 memory candidates 的改动都应视为高风险。优先使用小补丁、回归脚本和明确的用户确认。

---

## English

Thanks for helping improve Novel Director. This project is a local-first Electron + React + TypeScript desktop workbench for long-form AI-assisted fiction writing.

### Development Setup

```bash
npm install
npm run dev
```

On Windows PowerShell, prefer `npm.cmd` if script execution policy blocks `npm.ps1`:

```powershell
npm.cmd install
npm.cmd run dev
```

### Required Checks

Before opening a pull request, run:

```bash
npm run typecheck
npm test
npm run build
```

Windows equivalent:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

### Pull Request Guidelines

- Keep changes narrow and explain the user-facing behavior.
- Do not commit local data files, exported manuscripts, screenshots with private text, generated launchers, or packaged binaries.
- Do not commit API keys, `.env` files, or local machine paths.
- Preserve local data compatibility. If a persisted type changes, update normalization and validation scripts.
- Keep renderer file access behind the preload/main IPC boundary.
- Add or update validation scripts for safety-sensitive changes.
- For AI output handling, validate and normalize model responses before writing project data.

### Packaging and Binaries

Do not commit `.exe`, `.msi`, `.zip`, or generated launcher binaries to the source repository. Build artifacts should be attached to GitHub Releases with build instructions and checksums.

### Data Safety

Changes that touch storage, migration, backups, API credentials, prompt building, generation pipeline, revision acceptance, or memory candidates should be treated as high risk. Prefer small patches, regression scripts, and explicit user confirmation for destructive actions.

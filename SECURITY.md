# 安全策略 / Security Policy

## 简体中文

Novel Director 是本地优先的桌面写作工作台。它会在用户机器上保存小说项目、草稿、prompt、Run Trace 和设置。

### 支持版本

当前仓库仍处于 pre-1.0 阶段。除非明确维护 release branch，否则安全修复面向当前 `main` 分支。

### 报告漏洞

请通过 GitHub Security Advisories 私下报告安全问题。如果仓库尚未启用 advisories，请开一个最小公开 issue，只说明需要私密联系方式，不要贴出密钥、数据文件或完整草稿。

请不要包含：

- 真实 API Key 或 bearer token。
- 真实项目的 `novel-director-data.json`。
- 包含私有故事内容的完整 prompt、章节草稿或 Run Trace。
- 暴露 key、本地路径或私有稿件内容的截图。

安全报告可以包含：

- 简短的问题描述。
- 使用虚构数据的复现步骤。
- 预期行为和实际行为。
- 相关版本、操作系统，以及问题是否影响 storage、IPC、AI calls、export 或 packaging。

### API Key 边界

API Key 不应保存在 AppData JSON 中。当前构建使用主进程里的 Electron `safeStorage` 保存 API Key。renderer 可以设置、删除或检查是否存在 key，但不应读回完整明文 key。

项目包含明文 key 持久化回归检查。测试哨兵使用非真实 provider 格式，避免触发 secret scanner 误报。

### 本地数据边界

Novel Director 默认本地保存数据。用户可以在设置页修改数据文件路径。数据迁移、导出、备份和合并路径应在写出当前版本 JSON 前清理凭据。

旧备份可能包含历史明文数据，尤其是来自旧版本或导入文件的备份。请把备份文件当作敏感文件处理，避免公开分享。

### 文件和 IPC 边界

renderer 代码不得直接访问 Node `fs`、`path`、`shell` 或 `ipcRenderer`。文件选择、导出、剪贴板、数据迁移和凭据操作应通过 typed preload API 和主进程 IPC handler。

### 负责任披露

我们会尽量及时确认有效报告。由于这是早期开源项目，响应时间可能变化；但保护用户稿件、API Key 和本地文件的问题会被优先处理。

---

## English

Novel Director is a local-first desktop writing workbench. It stores novel projects, drafts, prompts, run traces, and settings on the user's machine.

### Supported Versions

This repository is pre-1.0. Security fixes target the current `main` branch unless a release branch is explicitly documented.

### Reporting a Vulnerability

Please report security issues privately through GitHub Security Advisories if available. If advisories are not enabled yet, open a minimal issue that asks for a private contact channel without posting secrets, API keys, data files, or full drafts.

Do not include:

- Real API keys or bearer tokens.
- `novel-director-data.json` files from real projects.
- Full generated prompts, chapter drafts, or run traces containing private story material.
- Screenshots that expose keys, local paths, or private manuscript text.

Safe reports should include:

- A concise description of the issue.
- Reproduction steps using dummy data.
- Expected and actual behavior.
- Relevant version, operating system, and whether the issue affects storage, IPC, AI calls, export, or packaging.

### API Key Boundary

API keys should not be stored in AppData JSON. Current builds use Electron `safeStorage` in the main process for saved API keys. Renderer code can set, delete, or check whether a key exists, but should not read back the full plaintext key.

The project includes regression checks for plaintext key persistence. Test sentinels intentionally use non-provider-shaped strings to avoid secret scanner false positives.

### Local Data Boundary

Novel Director data is local by default. Users can change the data file path in Settings. Data migration, export, backup, and merge paths should sanitize credentials before writing current-version JSON files.

Legacy backups may contain old plaintext data if they were created from older versions or imported files. Treat backup files as sensitive and avoid sharing them publicly.

### File and IPC Boundary

Renderer code must not access Node `fs`, `path`, `shell`, or `ipcRenderer` directly. File selection, export, clipboard, storage migration, and credential operations should go through the typed preload API and main-process IPC handlers.

### Responsible Disclosure Expectations

We aim to acknowledge valid reports promptly. Because this is an early open-source project, response timelines may vary, but reports that protect user manuscripts, API keys, or local files are treated as high priority.

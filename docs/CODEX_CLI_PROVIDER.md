# Codex CLI Provider

## 简体中文

Novel Director 可以把本机 Codex CLI 当作 AI Provider，复用 `codex login` 的登录态。该模式适合已经拥有可用 ChatGPT/Codex 计划、又不希望在工作台单独配置 API Key 的用户。

### 配置

```powershell
npm install -g @openai/codex
codex login
codex login status
```

随后在工作台“设置 -> AI 模型接入”中选择 `Codex CLI（订阅登录）`，点击“检测 Codex CLI”。如果从桌面启动应用后 PATH 中找不到 `codex`，可填写 `codex.exe`、`codex.cmd` 或 `codex` 的绝对路径。

“Codex 模型”留空时使用 CLI 默认模型。只有在你确认账号可使用某个模型时才填写模型名。建议把单次超时设为 300 秒或更长；流水线的“取消”会终止对应 CLI 进程。

### 安全边界

- CLI 只在 Electron main process 启动，renderer 不能执行本机命令。
- 每次请求使用空临时目录、`read-only` sandbox、ephemeral session，并禁止读取工作区或调用工具。
- Prompt 通过 stdin 发送，最终回答通过临时文件读取；临时目录随后删除。
- 工作台不读取、不导出、不写入 SQLite 任何 Codex 登录令牌。
- CLI 的认证、计划额度、速率限制和数据处理规则由当前 OpenAI/ChatGPT 账号控制。
- 章节 Prompt 和被选中的小说上下文仍会发送给 OpenAI。请勿把不允许离开本机的稿件交给远程模型。

### 已知限制

- Codex CLI 不是 Chat Completions API 的一比一替代品，`temperature` 和硬 `max_tokens` 不可直接映射。
- CLI 输出仍需通过现有 JSON 解析与 fallback；复杂结构化任务可能比 API Provider 更慢。
- 本版每次调用都会启动独立的 CLI 进程，优先保证运行隔离和取消语义，尚未做常驻进程池。
- 工作台不会代替用户安装、登录、购买额度或选择计划。

## English

Novel Director can use a locally installed Codex CLI as an AI provider and reuse its `codex login` session. Select `Codex CLI (subscription sign-in)` in Settings, run the status check, and leave the model blank to use the CLI default.

The CLI runs only in the Electron main process, inside an empty temporary directory with a read-only sandbox and an ephemeral session. Novel Director does not read or persist Codex authentication tokens. Prompt context is still sent to OpenAI, and usage remains subject to the active account's plan and limits.

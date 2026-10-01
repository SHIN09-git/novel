# Agent Tool API / MCP-Compatible Stdio

## 简体中文

Novel Director 现在提供一个面向 Codex/Agent 的结构化工具入口。它复用桌面工作台的同一份 SQLite/JSON 数据、同一套 Agent Runtime、同一套事务化提交链路，不需要通过 Computer Use 读取 UI。

W08 新增任务编辑、世界资料管理和可撤回项目授权。以 [项目授权与逐章创作指南](./AGENT_PROJECT_AUTHORIZATION.md) 为当前操作说明；下文旧接口中的 `confirm` 仍是普通动作确认，不等同于作者授权。新的 `agent.applyChapterAcceptance` 使用实际正文/报告绑定和项目授权，不能经旧采纳工具绕过。

### 启动

首次接入 Codex，直接运行：

```powershell
npm.cmd run agent:setup:codex
```

重新打开一个 Codex 任务后，`novel-director` 会作为 MCP 工具服务出现。Codex 可以直接读取项目、章节、版本链、诊断和候选，并通过事务化预览执行正式采纳，不需要用 Computer Use 识别界面。

检查注册状态：

```powershell
npm.cmd run agent:check:codex
```

仅手动调试 stdio 服务时才需要下面的命令：

```powershell
npm.cmd run agent:tools
```

该命令会启动 `src/agent/mcp/server.ts`，支持两种调用形态：

- MCP 风格 JSON-RPC：`initialize`、`tools/list`、`tools/call`
- 轻量 JSON-RPC：`agent/listTools`、`agent/callTool`

当前实现使用 stdio，不在 renderer 暴露 SQLite，也不直接导入 `better-sqlite3`。

### 常用工具

只读：

- `agent.listProjects`
- `agent.getProjectDigest`
- `agent.getNextChapterTarget`
- `agent.getArchivedChapters`
- `agent.getChapterProductionState`
- `agent.getChapterVersionChain`
- `agent.getChapterText`
- `agent.getDraftText`
- `agent.getPromptSnapshot`
- `agent.getGenerationPrompt`
- `agent.getVersionDetail`
- `agent.getVersionDiff`
- `agent.getRunDiagnostics`
- `agent.getFullRunTrace`
- `agent.getCandidateDetail`
- `agent.getDecisionInbox`
- `agent.previewCandidateDecisions`
- `agent.getPendingHumanReviewItems`
- `agent.getAcceptanceRecommendation`
- `agent.getAgentRunSummary`

写入/预览：

- `agent.startAgentRun`
- `agent.runChapterPipeline`
- `agent.retryChapterPipeline`
- `agent.getPipelineProgress`
- `agent.cancelChapterPipeline`
- `agent.continueAgentRun`
- `agent.recordAcceptanceDecision`
- `agent.getActionPreviews`

`agent.runChapterPipeline` 会真实执行一轮标准单章流程：上下文需求规划、预算选择、上下文构建、任务书、计划后二次补全、正文、章节复盘、角色/伏笔候选、一致性审稿、质量门禁，最后停在 `await_user_confirmation`。它不会自动把草稿写入正式章节，也不会自动接受记忆候选。

如果某一步失败，使用 `agent.retryChapterPipeline` 并传入原 `agentRunId` 与 `jobId`。它会从首个失败或未完成步骤继续，恢复之前步骤的结构化输出，不重新生成已经完成的任务书或上下文。已完成且等待采纳的 Job 会拒绝重复重试，避免产生重复草稿和报告。

长请求运行期间可调用 `agent.getPipelineProgress`，读取当前步骤、步骤耗时、完成比例、取消状态和可恢复起点。`agent.cancelChapterPipeline` 使用独立控制标记通知执行进程，不会并发改写整份 AppData；执行器收到请求后会终止当前 HTTP/Codex CLI 调用、保存已完成步骤，并把 Job 留在可恢复的暂停状态。MCP 服务允许查询/取消请求与长流水线请求并发派发。

命令行示例：

```powershell
npm.cmd run agent -- run-chapter --project-id <id> --chapter 18 --pipeline-mode standard --estimated-words 3000-5000 --reader-emotion "紧张后获得短暂释然"
npm.cmd run agent -- retry-chapter --agent-run-id <agent-run-id> --job-id <job-id>
npm.cmd run agent -- pipeline-progress --job-id <job-id>
npm.cmd run agent -- cancel-chapter --job-id <job-id> --reason "切换模型后重试"
```

远程 OpenAI/兼容 Provider 的无界面进程不能读取 Electron 桌面安全存储中的明文密钥。运行前请在当前终端设置 `NOVEL_DIRECTOR_API_KEY`，或者改用已登录的 Codex CLI / 本地模型。密钥只进入进程内存，不写入 AppData、SQLite、Run Trace 或工具返回值。

事务化提交：

- `agent.applyApprovedChapterCommit`
- `agent.applyCandidateDecisions`
- `agent.archiveChapter`
- `agent.restoreArchivedChapter`

章节归档/恢复可传入普通动作确认 `confirm: true` 或 `approvalToken`，也可使用覆盖对应章节的 `manage_chapters` 项目授权；高风险候选接受则必须有作者授予的实际权限。草稿采纳仍走 `ChapterCommitBundle`；章节归档/恢复走带 revision 校验的 StorageService 原子保存。归档不会删除正文、版本链、提交或诊断记录，恢复时若原章序已被占用，会移动到当前末尾，授权需同时覆盖原章序和新章序。

### 候选决策

候选决策复用桌面端/共享的 `CandidateDecisionService` 和
`Storage.executeCandidateDecision`，不由 Agent 自己改写记忆或角色状态。所有工具响应都包含
`storage.revision`；需要乐观并发保护时，保留 preview 返回的 revision。

1. `agent.getDecisionInbox`：传入 `projectId`（或 `project`）读取共享事件分组。只返回该项目的待处理候选；可用 `chapterOrder` 过滤，`limit` 默认 20（最大 100），`offset` 默认 0。分组包含 `total`、`nextOffset`、`memoryCandidateIds` 和 `characterStateCandidateIds`，分组本身不代表批量批准。
2. `agent.previewCandidateDecisions`：传入项目和 1-100 个 `decisions`。每项包含 `kind`、`candidateId`、`decision`；接受时可附带 `amendment`。memory 编辑的 `patch.kind` 支持 `chapter_review_update`、`character_state_update`、`foreshadowing_create`、`foreshadowing_status_update`、`stage_summary_create`、`timeline_event_create`，各分支只接受合同定义的可编辑字段。`stage_summary_create.stageSummary` 只允许新的作者字段：`compressedPlotSummary`、`irreversibleChanges`、`endingCarryoverState`、`emotionalAftertaste`、`pacingState`；`coveredChapterRange`、`plotProgress`、`characterRelations`、`secrets`、`foreshadowingPlanted`、`foreshadowingResolved`、`unresolvedQuestions`、`nextStageDirection` 等 legacy 字段不能新增编辑。character-state 编辑可传 `label`、`category`、`targetValue`、`linkedCardFields`；其中 `targetValue` 表示目标最终值，preview 返回的 `amendmentPreview.after.targetValue` 是实际采用的最终值。

   preview 是只读的，返回 normalized `amendment`、`expectedFingerprint`、summary、evidence、risk、warnings、`amendmentPreview.before/after`，以及 `requiresConfirmation`、`agentCanApply` 和 `authorization`。amendment 只做递归脱敏，不做 compact 或 `maxChars` 截断，因此结构、类型和可执行值长度保持不变。`amendmentPreview.before/after` 只用于展示，可以按 `detail`/`maxChars` 截短文本。若返回 `amendmentRedacted: true`，不要把脱敏占位符当作目标值自动 apply；应保留已授权的原始 amendment，使用它重新 preview/apply，或转交用户确认。它不会创建独立的 action-preview 记录。
3. `agent.applyCandidateDecisions`：使用 preview 返回的 normalized `amendment`，复制每项的 `kind`、`candidateId`、`decision`、`amendment`、`expectedFingerprint`，再传入非空 `reason` 和稳定的 `operationId`。如果 preview 标记了 `amendmentRedacted`，不得复制其中的脱敏 amendment；必须保留已授权原始输入并重新 preview/apply，或转交用户确认。同一 preview 到 apply、以及 retry，都必须复用同一个 `operationId` 和命令字段；不要重新拼装 amendment 或复制展示字段。`expectedRevision` 可选，默认使用新加载的 revision；显式传入时必须同时匹配运行时和原子 Storage snapshot，否则返回 `STORAGE_REVISION_CONFLICT`。

```json
{"name":"agent.previewCandidateDecisions","arguments":{"projectId":"project-1","decisions":[{"kind":"character_state","candidateId":"state-1","decision":"accept","amendment":{"kind":"character_state","label":"已确认消息","category":"knowledge","targetValue":"Confirmed","linkedCardFields":["futureHooks"]}}]}}
```

```json
{"name":"agent.applyCandidateDecisions","arguments":{"projectId":"project-1","operationId":"review-batch-001","reason":"Checked against chapter evidence.","expectedRevision":"<storage.revision from preview>","decisions":[{"kind":"character_state","candidateId":"state-1","decision":"accept","amendment":{"kind":"character_state","label":"已确认消息","category":"knowledge","targetValue":"Confirmed","linkedCardFields":["futureHooks"]},"expectedFingerprint":"<preview fingerprint>"}]}}
```

The handler always binds `actor.kind` to `agent`. A client-supplied `actor` or any
unsupported command field is rejected. Optional `agentRunId` must belong to the
selected project for new commands. Existing receipts bind historical run identity,
so an exact replay remains possible after its AgentRun is removed.

**高风险接受需要作者授予的项目权限。** W08 在实际事务写入时核对数据源、项目和候选来源章节的 `accept_high_risk_candidates` 授权；有授权时可连续决定，没有授权则返回 `AGENT_CANDIDATE_AUTHORIZATION_REQUIRED`，留给作者处理。`confirmedHighRisk: true`、`confirm: true` 和客户端 `approvalToken` 本身不能提权。低风险命令和历史 Agent receipt 的精确 replay 保持兼容；授权编号随决定留存，撤回后不重放已提交的世界变化。

retry 时保持 `operationId`、normalized decisions、fingerprints、reason、actor/run 和 acknowledgement 不变。可选的 `decidedAt` 可以固定为 ISO 时间戳；省略时，handler 在已有 receipt 上复用原时间，否则使用当前时间。并发首次请求或 receipt 尚未可见时，传入同一个固定时间。传入的时间不会被静默替换为 receipt 时间。同一 operation ID 如果命令指纹不同会失败；命令完全相同则 replay 已存 receipt，不重复写入。
Do not re-preview already decided candidates to retry a committed operation.
Already accepted/rejected candidates are a successful no-write replay only under
the original matching operation. A new operation receives
`CANDIDATE_ALREADY_DECIDED`, including mixed batches; it never partially reapplies
pending items or reverses prior acceptance.

Application returns `{ receipt, replayed, saved }`; `saved` includes the resulting
storage revision. 有 amendment 时，`receipt.amendments[]` 保存每项的 `kind`、`candidateId`、normalized `amendment` 以及 `before`/`after` 快照；state 快照中的 `after.targetValue` 是最终值。Agent 返回的 amendment 和新增嵌套原文会递归脱敏；若因此改变返回值，会额外返回 `amendmentRedacted: true`。这只影响返回副本，不改变已存储的 amendment、fingerprint 或 operationId；同一原始命令仍可稳定 replay。Record deltas are merged into the runtime using the shared kernel and are not returned as full AppData. Replay reloads a current, consistent Storage snapshot rather than pairing cached data with the returned revision.
`saved.revision` describes the operation result; `storage.revision` describes the
runtime's refreshed snapshot and can be newer if another writer intervenes.
Invalid batches fail atomically. Storage owns replay ordering, including retries
with an older explicit revision. Retain the preview revision for writes: the
shared target-fingerprint coverage limitation below remains unresolved.

Inbox and preview reads default to compact text (320 characters per text field).
`detail: "full"` includes the full inbox candidate references and unshortened
available text; the shared preview itself may already summarize evidence. Use
`agent.getCandidateDetail` with `detail: "full"` for the underlying candidate.
`maxChars` bounds individual text fields, never identifiers or fingerprints.
Compact/summary output is capped at 320 text characters (plus an ellipsis), even
with a larger `maxChars`. Only explicit `detail: "full"` expands it. Known settings
credentials and bearer/token patterns are redacted in either mode. These modes
control disclosure size, not authorization to apply decisions.

Run isolated behavior checks with:

```powershell
node scripts/validate-agent-candidate-decisions.mjs
```

Tests use generated JSON/SQLite fixtures under the repository's temporary
directory, never the production novel store.

### 世界资料管理

世界资料工具只允许读取和经作者项目级 `edit_world` 授权后的明确导演动作；不提供删除、任意集合写入或由检测结果自动生成 canon 的入口。

1. `agent.getWorldRecords` 与 `agent.getWorldRecord`：读取角色、角色状态、伏笔、时间线、HardCanon 或剧情导向。默认 compact，`detail: "full"` 才返回未截断的许可字段。
2. `agent.getWorldActionReceipt`：按 `operationId` 读取一条已落盘的世界资料操作记录，含脱敏后的 `before`、`after`、command/preview 指纹、导演来源和实际授权 grant ID。
3. `agent.getWorldActionHistory`：按项目分页读取上述 receipt；`limit` 默认 20、最大 100，返回 `total`、`offset`、`nextOffset` 和 `receipts`。
4. `agent.previewWorldAction` 与 `agent.applyWorldAction`：支持 create、update、set_status、archive。apply 必须原样携带 preview 的 `expectedFingerprint` 与稳定 `operationId`，并在当前落盘快照上重新校验后保存。

`source` 必须是 `{ kind: "agent_director", reason }`。`agentRunId` 是可选来源关联：提供时必须属于目标项目；省略时允许作者 Agent 独立维护角色、HardCanon 等项目级资料，不会为了审计而创建空 AgentRun 或章节 Job。每条已落盘 receipt 都有 `agent_director` 来源、真实 project-wide grant ID 和不可变 before/after 快照；同一命令的后续 retry 才会 replay 该 receipt。

compact 输出会保留 ID、枚举、operationId 和全部指纹，不截断；若文本被截短，返回 `truncated`、`truncatedFields` 以及 full 读取入口。无论 compact 或 full，已知凭证和 bearer/token 模式都按共享脱敏规则处理。

`previewWorldAction` 和 `applyWorldAction` 返回的 `before`/`after` 也使用同一脱敏规则；保存的 command、receipt 和 fingerprint 仍基于原始内容，不会因展示脱敏而改变。两个写工具的 `patch` schema 提供 `x-worldEditableFieldsByEntity`：它列出每种实体允许的字段、角色九项卡字段以及状态/伏笔/HardCanon/剧情导向的枚举值，实际写入仍由共享服务按实体严格校验。

角色和时间线没有已注册的归档生命周期，归档/状态动作会明确拒绝。角色状态的 `sourceChapterId`（及同时提供的 `sourceChapterOrder`）必须定位到同项目同一章节。激活剧情导向时，`endChapterOrder` 必须等于 `startChapterOrder + horizonChapters - 1`，每个节拍必须位于该范围并与自身 offset 一致。

### Shared-Kernel Review Handoff (2026-09-06)

Historical review notes below describe the earlier handoff, not current release status. W08 now enforces author-issued project grants on the Agent high-risk write path and records the matching grant in the decision receipt. The other notes require their own current-code verification; they are not a request to bypass existing checks.

Agent-only fixes are complete; the following shared/main/storage changes are
recommendations for the owning controller, not edits made by this task.

- **P1: trusted high-risk authorization is missing.**
  `src/services/CandidateDecisionService.ts`, `applyCandidateDecisionCommand`,
  accepts high risk solely from `command.confirmedHighRisk`. SQLite calls that
  kernel without adding authorization. Introduce a persisted project policy or
  trusted human approval bound to project, actor, operation and decision
  fingerprints, and enforce it in the transaction. The Agent's fail-closed guard
  is an interim boundary, not a substitute for shared authorization.
- **P1: actual chapter target is not always fingerprinted.** In `targetContext`,
  a missing explicit chapter ID falls back to `job.targetChapterOrder`, while
  `MemoryCandidateService` may apply to `patch.targetChapterOrder` or
  `patch.relatedChapterOrder`. The isolated JSON and SQLite probes both reproduced
  unchanged fingerprints and successful application of an old preview after the
  actual target chapter was rewritten. Share one target resolver between preview
  and application, and fingerprint every actual affected target. Until fixed,
  callers should provide the preview's `expectedRevision`.
- **P1: SQLite read-only snapshots are not transaction-consistent.**
  `loadSqliteSnapshotReadonly` reads data and revision in separate statements
  outside a read transaction. Another process can commit between them, producing
  old data paired with a newer revision. Wrap both reads in one read transaction,
  preserving readonly/query-only behavior. Agent application now reassesses
  `Storage.loadSnapshot()` before CAS; the shared read API still needs correction.
- **P2: character-state audit times diverge from command time.** The shared
  command invokes state mutations that generate their own wall-clock timestamps.
  JSON and SQLite probes reproduce `fact.updatedAt` and transaction times different
  from receipt `decidedAt`. Pass the command timestamp through the shared state
  mutation API so one decision has consistent audit times.

Confirmed non-issues: SQLite receipt replay returns current data semantics with
empty deltas and does not rewrite accepted records or advance revision. The old
Agent runtime cache/revision pairing bug is fixed. New operation IDs for terminal
candidates deliberately fail without side effects; only matching receipts replay.
The shared fingerprint uses a non-cryptographic FNV hash and must not be treated
as an authentication token or signed human approval.

Reproduce the two shared behavioral observations without modifying production:

```powershell
node scripts/validate-agent-candidate-decisions.mjs --audit-shared
```

The optional probes report observations, not regression assertions that require
known shared defects to remain present.

### 默认输出内容

读取工具默认返回 compact JSON：

- 不默认返回完整正文；
- 不默认返回完整 Prompt；
- 不默认返回完整诊断 JSON；
- 如需完整内容，需要显式传入 `detail: "full"` 或对应 `includeProse` / `includePrompt` / `includeDiagnostics`；
- 可用 `maxChars` 控制最大返回长度。

### JSON-RPC 示例

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
```

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"agent.listProjects","arguments":{"storagePath":"G:/novel/novel-director-data.sqlite"}}}
```

### 数据安全边界

- Agent Tool API 不直接操作 renderer。
- Agent Tool API 的只读命令以 SQLite 原生只读模式打开现有数据库，不初始化 schema、不切换 WAL，也不创建数据文件。
- 桌面端 API Key 仍由安全凭据链路处理；无界面 Agent 的远程 Provider 只读取进程环境变量 `NOVEL_DIRECTOR_API_KEY`，不会把密钥写入项目数据。
- 正式接受草稿必须通过提交 bundle。
- 新设定、记忆候选、角色状态候选不会通过读取工具自动污染 canon。

## English

Novel Director now exposes a structured Agent Tool API for Codex/Agent use. It shares the desktop app's SQLite/JSON data, Agent Runtime, and transaction-backed commit pipeline without requiring Computer Use to read the UI.

### Start

```powershell
npm.cmd run agent:tools
```

The command starts `src/agent/mcp/server.ts` over stdio. It supports MCP-style `initialize`, `tools/list`, `tools/call`, plus lightweight `agent/listTools` and `agent/callTool`.

Tools return compact JSON by default. Full prose, full prompts, or full diagnostics require explicit `detail: "full"` or the relevant include flag.

`agent.runChapterPipeline` executes the complete standard single-chapter workflow and stops at `await_user_confirmation`; it never accepts the draft automatically. `agent.getPipelineProgress` exposes current step timing and recovery state. `agent.cancelChapterPipeline` uses a side-channel marker so it never races a full AppData write; the executor aborts the active request and persists a recoverable paused job. `agent.retryChapterPipeline` reuses the existing AgentRun and job, resumes from the first failed or unfinished step, and rejects retries after the workflow is already complete. Headless OpenAI-compatible runs read `NOVEL_DIRECTOR_API_KEY` from the current process environment because they cannot access Electron's desktop credential store. Codex CLI and local providers do not require that environment variable.

Archived chapters are available through `agent.getArchivedChapters`. `agent.archiveChapter` and `agent.restoreArchivedChapter` require explicit confirmation, preserve prose and version history, and use revision-protected atomic storage writes.

### Candidate Decisions (brief)

`agent.previewCandidateDecisions` accepts optional normalized amendments. Memory patches support `chapter_review_update`, `character_state_update`, `foreshadowing_create`, `foreshadowing_status_update`, `stage_summary_create`, and `timeline_event_create`. Stage-summary edits are limited to the new author fields `compressedPlotSummary`, `irreversibleChanges`, `endingCarryoverState`, `emotionalAftertaste`, and `pacingState`; legacy fields are not editable. Character-state amendments use `label`, `category`, `targetValue`, and `linkedCardFields`; `amendmentPreview.after.targetValue` is the effective final value. Amendments are recursively redacted without truncation; read-only before/after snapshots may be shortened for display. If `amendmentRedacted` is true, do not apply the redacted placeholder as a target value: retain the authorized original, re-preview/apply it, or ask the user to confirm.

Copy the normalized `amendment` and `expectedFingerprint` from preview items into `agent.applyCandidateDecisions` only when the amendment was not redacted. Keep the same `operationId` and command fields for retries. Receipts include amendment `before`/`after` snapshots and are redacted in the Agent response without changing storage or replay identity. New high-risk acceptance remains denied at the Agent boundary: `confirm`, `confirmedHighRisk`, and client `approvalToken` cannot authorize it; use the human decision path.

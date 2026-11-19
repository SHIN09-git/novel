# Agent Tool API / MCP-Compatible Stdio

## 简体中文

Novel Director 现在提供一个面向 Codex/Agent 的结构化工具入口。它复用桌面工作台的同一份 SQLite/JSON 数据、同一套 Agent Runtime、同一套事务化提交链路，不需要通过 Computer Use 读取 UI。

以 [项目授权与逐章创作指南](./AGENT_PROJECT_AUTHORIZATION.md) 为当前操作说明。全库管理权和全书创作权都不接受调用方自行填写的 `confirm` 作为授权；草稿采纳使用实际正文、当前审稿报告和作者授权，不能经旧采纳工具绕过。

### 启动

使用 Preview.22 或更新的 Windows 成品时，在「Agent 批次」点击「复制一键接入命令」，然后在 PowerShell 中运行。命令会用当前工作台启动随包分发的 MCP 服务，不需要源码或单独安装 Node。若已有同名旧服务，请先用 `codex mcp remove novel-director` 移除旧入口，再注册。移动程序后也要重新注册。

从源码运行时，可以用下面的命令接入：

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

### 可恢复章节工作单

连接或重连后，调用 `agent.getChapterWorkItem`，传 `projectId`（或 `project`）。只有一个未完成批次时，它会定位第一处未正式写回的目标章。有多个批次时，它返回 `select_run` 和可选批次；用选中的 `agentRunId` 再读。不需要记住上次窗口里的 job ID，也不需要再调用 `continueAgentRun` 创建新批次。读工作单不保存，也不调用模型。指定过 `storagePath` / `userDataPath` 时，后续操作沿用同一套书库参数。

- `prepare_task` 给出本章任务摘要和任务预览参数；`resume_pipeline` 给出原 job、恢复步骤和重试参数。确实要改任务时，用 `editTask`（如有）进入原有预览和提交。
- 只在准备任务时显示一句目标；运行、重试和审稿时，`task.read` 直接定位本章任务。要核对冲突、伏笔许可、结尾钩子、字数或文风时，调用这个入口读取完整任务，不需要从工作单的短摘要推断。
- `running` 先查询进度。Agent 正在执行时，同一书库和 job 的重复续跑返回 `alreadyRunning: true`、`progress`，以及请求的工作单，不重复调用模型。若检测到执行者已退出，工作单返回 `resume_pipeline`，可用同一 job 接着跑。旧版没有登记执行者的运行仍要确认旧进程已停止，才可用 `recoverIfStopped`；连接断开不等于生成停止。
- `review_draft` 给出当前稿、审核结论、证据节选、报告引用及采纳所需授权。用 `draft.read` 读取完整正文；要展开某份报告，用 `review.readReport` 加该引用的 `kind` 和 `reportId`。临时中断的正文片段不会出现在 `draft`。
- `draft_deferred` 保留原稿、理由和审阅入口，不自动继续；`draft_rejected` 保留稿件和理由，工作单指向重新准备本章任务。用 `decide` 给出的 `agent.recordDraftDecision` 参数，补齐 `decision`（`reject` 或 `defer`）、理由和操作 ID；同一命令可安全重试。新正文不会沿用旧稿的暂缓理由。
- `continuity` 列出本章确实可能用到、且仍待确认的前章硬状态或伏笔候选。用每项的 `read` 打开证据，再选择确认、拒绝，或避开依赖该变化的情节。未确认的候选不是正式事实；这份提示不拦截生成。
- `lastReceipt` 是通过正式版本核对的最近一笔提交。只有这些回执才算完成；`check_writeback` 提示核查现有正文或修订，不开新稿。正文采纳不会自动确认任何长期记忆候选。

`startAgentRun`、`continueAgentRun`、`runChapterPipeline`、`retryChapterPipeline` 和 `applyChapterAcceptance` 可传 `responseMode: "work_item"`，从 `data.workItem` 直接取得同一份工作单。未传时返回兼容旧格式。按工作单的 `nextAction` 调用时，补齐 `requiresInput` 中由导演决定的字段。采纳前读完稿，再按 `acceptance.preview` 提供理由和操作 ID、确认预览、正式提交；工作单不会替导演接受草稿。

`agent.getDraftReviewReport` 按项目、job 与 draft 读取匹配当前正文的**完整报告**，不按字数截短。支持 `quality_gate`、`consistency`、`novelty`、`redundancy`、`editorial`、`hard_canon`。历史质量报告按当时规则保存，`hard_canon` 单独返回按现行规则核查的结果。复制工作单给出的正文指纹和报告 ID；正文或报告被替换时，MCP 的 `error.data.code` 会给出 `DRAFT_VERSION_CHANGED`、`DRAFT_REPORT_CHANGED` 或 `DRAFT_REPORT_UNAVAILABLE`，应刷新工作单，而不是继续用旧证据。完整 Trace 和 Prompt 仍用原工具按需读取。

当前待采纳稿需要修订时，用 `agent.getRevisionSessions` 读取该稿的来源指纹，创建修订请求并生成候选，或用 `agent.createManualRevisionVersion` 保存手改。审阅候选后调用 `agent.applyRevisionToDraft`，传项目、批次、`versionId`、`expectedVersionHash`、`expectedSourceHash`、`expectedChapterHash`（未建章时显式传 `null`）、`operationId` 和 `reason`。它只更新同一草稿，不提交正式章节。正文变化会使旧审稿失效；返回的工作单提供 `resume`，从复盘、审稿开始，不重新生成正文。之后按正常流程预览和采纳。

命令行可用 `npm.cmd run agent -- chapter-work-item --project-id <id>`。如果 Codex 仍显示旧工具列表，重连仓库的 MCP 服务或打开一个新的 Codex 任务。

### 按需读取小说设定与阶段摘要

- `agent.getStoryBible`：传 `projectId`（或 `project`）。默认返回已填写字段、核心故事与不可改写事项的摘录。传 `detail: "full"` 或调用返回的 `fullRead`，读取保存的全部编辑字段，保留原文换行。不把本次 Prompt 当作小说圣经；没有已保存的记录时返回 `bible: null`。
- `agent.getStageSummaries`：按覆盖的章段倒序列出摘要。可传 `fromChapter` / `toChapter`，返回与范围有交集的摘要；分段只筛选记录，不裁剪原文。默认每页 10 条，最多 50 条，使用 `nextOffset` 翻页。默认仅显示章段、ID 和摘录；使用该条的 `fullRead`，或传 `summaryId` 和 `detail: "full"`，读取完整摘要。全量字段包括旧数据保留的关系、秘密和伏笔等备注，旧备注不自动成为现行设定。

例如：`{"projectId":"project-1","fromChapter":30,"toChapter":48,"limit":5}` 用于查阅相关章段。两个工具都只读指定项目，不调用模型；SQLite 不读取章节正文或过程记录。使用自定义书库路径时，执行 `fullRead` 也沿用原来的 `storagePath` / `userDataPath`。

### 全书创作入口

- **开书**：作者在桌面授予开书名额。调用 `agent.listBookCreationSlots` 取得预留的 `projectId`，再用 `agent.createProject` 传该编号、书名 `name`、稳定的 `operationId` 和 `reason`。只有一个可用名额时可省略 `projectId`；可用 `storyBible` 一并填写初始设定。
- **改小说圣经或阶段摘要**：`agent.previewBookReferenceEdit` 接收 `projectId`、`operationId`、`reason`、`entity`（`story_bible` 或 `stage_summary`）及 `patch`。改摘要时带 `summaryId`；新建摘要时不带，在 patch 中给 `chapterStart`、`chapterEnd` 和 `compressedPlotSummary`。核对前后内容后，把原参数及返回的 `fingerprint`（放在 `expectedFingerprint`）传给 `agent.applyBookReferenceEdit`。回退时用 `restoreOperationId` 替代 `entity`、`summaryId` 和 `patch`，同样先预览。读 `agent.getWorldActionHistory` 展开记录。
- **跨章修订**：`agent.startBookRevisionBatch` 接收 `projectId`、`chapterIds`、`goal` 和 `operationId`。记住返回的 `agentRunId`，用 `agent.getChapterWorkItem` 跟踪。每章用已有修订工具准备候选，调用 `agent.reviewRevisionVersion`；可用 `agent.getRevisionReview` 查看完整报告。把通过门禁的报告 ID 作为 `expectedQualityGateReportId` 传入 `agent.previewRevisionCommit`，再用预览返回的凭据调用 `agent.applyApprovedRevisionCommit`。正文、版本、审稿证据和提交理由随版本保留。恢复历史正文同样创建新修订，不覆盖历史。

### 全库管理入口

- `agent.getLibraryAuthorization` 查询桌面是否为当前书库授予了全库管理权。只有桌面作者能授予或撤回；`agent.getProjectAuthorization` 在书库授权有效时返回 `libraryGrant`。跨作品操作请始终用稳定的 `projectId`，不要用同名作品的标题。
- `agent.listProjects` 默认只列未归档项目。用 `status: "archived"` 查看归档项目，或用 `status: "all"` 查看全部。归档作品的正文、设定和审稿仍可读取；章节工作单显示 `project_archived`，恢复后继续原批次。
- 有全库管理权时，调用 `agent.createProject` 可直接开书：传 `name`、`reason` 和本书库唯一的 `operationId`，不传 `projectId`，无需申请单书名额。重试使用原操作编号；保持原参数不会重复开书。
- `agent.previewProjectAction` 传 `projectId`、`action`、`operationId`、`reason`。 `update` 的 `patch` 可包含 `name`、`genre`、`description`、`targetReaders`、`coreAppeal`、`style`；`archive` 归档，`restore` 恢复。 `revert` 另传 `restoreOperationId`，用于回退已有项目操作。核对预览后，把原参数及 `fingerprint`（放在 `expectedFingerprint`）传给 `agent.applyProjectAction`。回退开书请用归档，以保留已经写过的内容。
- `agent.getLibraryActionHistory` 列出开书、项目资料、归档和恢复记录。可传 `projectId` 筛选，使用 `limit`、`offset` 翻页；沿每条记录的 `read` 读取完整前后值。设定改动仍查 `agent.getWorldActionHistory`，正文查章节版本链。

### 常用工具

只读：

- `agent.listProjects`
- `agent.getProjectDigest`
- `agent.getNextChapterTarget`
- `agent.getStoryBible` / `agent.getStageSummaries`：查阅已保存的小说圣经和阶段摘要；默认简略，按需展开全文。
- `agent.getProjectUsage`：按项目和工作环节读取实际请求、已知 token、已知费用和未覆盖范围。不含正文，不调用模型。未上报的用量和账户余额都是未知。
- `agent.estimateProjectUsage`：预估单次请求；传 `projectId`、`provider`、`endpoint`（订阅 CLI 无需）、`model`、可选 `maxOutputTokens`。输入用 `inputTokens` 或本项目的 `snapshotId`，二选一；不提供则输入未知。快照只代表该段文字，不是整条流水线。只有配置了匹配的价目才能估算金额。
- `agent.getBookProgress`：核对全书正式字数、距作者目标的差额、缺章和写回情况。传 `projectId` 或 `project`；可选 `fromChapter` / `toChapter`（含两端）、`issuesOnly`、`offset`、`limit`（默认 50，最多 200）。`totalWords` 是全书字数，`range.totalWords` 是所选章段字数，均不随分页变化。它不返回整段正文。`nextAssignableOrder` 是可分配的新章号；`completeThrough` 才是从第 1 章起连续有正文的末章。
- `agent.getArchivedChapters`
- `agent.getBookContinuityReport`：只读核对本项目的当前正式正文和已确认记录。传 `projectId` 或 `project`，可选 `from`、`to`、`kind`、`status`、`offset` 和 `limit`（默认 10、最多 50）。例：`{"projectId":"你的项目ID","from":80,"to":96,"kind":"money","status":"conflict"}`。可保留第 80 章之前的比较依据，但不会使用第 96 章之后的事件。结果包含章 ID、正文指纹、可核实的版本 ID 和原句节选，不返回整章或写入正史。`needs_evidence` 是待核线索，`open` 是未结事项，不是采纳否决。
- `agent.getChapterProductionState`
- `agent.getChapterWorkItem`
- `agent.getChapterVersionChain`
- `agent.getChapterText`
- `agent.getDraftText`
- `agent.getDraftReviewReport`
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

正式改章名：先用 `agent.previewChapterTitleRename`，传 `projectId`、唯一的 `operationId`、`prefixMode`（`manual`、`keep` 或 `strip`）和 `edits`（稳定章节 ID、拟用标题）。核对返回的章号、旧名和新名后，用 `agent.applyChapterTitleRename` 发同一命令，附预览的版本与指纹（`expectedRevision`、`expectedPreviewHash`）。必须有覆盖全部所选章节的有效 `manage_chapters` 授权。重试同一提交请复用操作 ID。读 `agent.getChapterTitleHistory` 可按项目或章节查旧名，不需读取正文。

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

新提取的候选绑定来源稿和正文指纹。候选预览的 `sourceStatus` 区分当前草稿、当前正式正文、失效及旧记录待核。若正文被改写、拒绝或移除，已确认失效的候选可查看或拒绝，不能接受；即使有项目授权，提交仍返回 `CANDIDATE_SOURCE_STALE`，且不会写入批量操作中的其他条目。请按当前正文重新提取。旧候选缺少版本记录时标记 `unverified`，继续原有人工核对和授权流程，不自动重绑或改账。

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

1. `agent.getWorldRecords` 与 `agent.getWorldRecord`：读取角色、角色状态、伏笔、时间线、HardCanon 或剧情导向。单读角色时，`cardReview` 区分最后变化章、核对章、最近确认事实章，`detail: "full"` 另给短引文和来源。可用 `asOfChapterOrder` 限定核对截止章；这不会把可编辑原卡还原到当时，也不会将卡标为已核对。
2. `agent.getWorldActionReceipt`：按 `operationId` 读取一条已落盘的世界资料操作记录，含脱敏后的 `before`、`after`、command/preview 指纹、导演来源和实际授权 grant ID。
3. `agent.getWorldActionHistory`：按项目分页读取上述 receipt；`limit` 默认 20、最大 100，返回 `total`、`offset`、`nextOffset` 和 `receipts`。
4. `agent.previewWorldAction` 与 `agent.applyWorldAction`：支持 create、update、set_status、archive。apply 必须原样携带 preview 的 `expectedFingerprint` 与稳定 `operationId`，并在当前落盘快照上重新校验后保存。

`source` 必须是 `{ kind: "agent_director", reason }`。`agentRunId` 是可选来源关联：提供时必须属于目标项目；省略时允许作者 Agent 独立维护角色、HardCanon 等项目级资料，不会为了审计而创建空 AgentRun 或章节 Job。每条已落盘 receipt 都有 `agent_director` 来源、真实 project-wide grant ID 和不可变 before/after 快照；同一命令的后续 retry 才会 replay 该 receipt。

compact 输出会保留 ID、枚举、operationId 和全部指纹，不截断；若文本被截短，返回 `truncated`、`truncatedFields` 以及 full 读取入口。无论 compact 或 full，已知凭证和 bearer/token 模式都按共享脱敏规则处理。

`previewWorldAction` 和 `applyWorldAction` 返回的 `before`/`after` 也使用同一脱敏规则；保存的 command、receipt 和 fingerprint 仍基于原始内容，不会因展示脱敏而改变。两个写工具的 `patch` schema 提供 `x-worldEditableFieldsByEntity`：它列出每种实体允许的字段、角色九项卡字段以及状态/伏笔/HardCanon/剧情导向的枚举值，实际写入仍由共享服务按实体严格校验。

角色和时间线没有已注册的归档生命周期，归档/状态动作会明确拒绝。角色状态的 `sourceChapterId`（及同时提供的 `sourceChapterOrder`）必须定位到同项目同一章节。剧情导向以起止章为准，含两端，一条导向可覆盖 1–30 章；5 和 10 只是快捷选项。第 91–96 章的长度是 6，第 96–96 章的长度是 1。节拍的章号和 offset 须与区间一致。

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

Library managers can use `agent.createProject` without a project ID or a reservation. Use `agent.previewProjectAction` and `agent.applyProjectAction` to edit project metadata, archive or restore a book, or revert a previous project change. Read project receipts through `agent.getLibraryActionHistory` and include archived books with `agent.listProjects` using `status: "all"`. A library grant does not waive per-chapter review and quality checks.

With the author's full-book creator grant, use `agent.listBookCreationSlots` and `agent.createProject` for a reserved book, or `agent.previewBookReferenceEdit` and `agent.applyBookReferenceEdit` for Story Bible and stage-summary changes or restores. For an ordered revision batch, use `agent.startBookRevisionBatch` and `agent.getChapterWorkItem`. Each revision must pass `agent.reviewRevisionVersion` before preview and commit. See the Chinese section for the exact arguments.

Use `agent.getProjectUsage` for the book's recorded usage and `agent.estimateProjectUsage` for an offline, single-request estimate. Neither can read a provider balance. Story direction accepts inclusive ranges of 1–30 chapters. For official chapter titles use `agent.previewChapterTitleRename`, then `agent.applyChapterTitleRename` with the returned revision and fingerprint and a current `manage_chapters` grant. Read prior titles with `agent.getChapterTitleHistory`; renames do not create prose revisions.

For manuscript coverage, use `agent.getBookProgress` with a project, optional chapter range and `issuesOnly: true`. A nonblank historical manuscript counts even without a formal receipt; an old manuscript does not prove that a failed revision was applied. `agent.getNextChapterTarget` returns an available order, not proof that the manuscript is complete through that point.

For cross-chapter consistency, call `agent.getBookContinuityReport` with an optional inclusive `from` / `to`, category and status. Earlier evidence can support an in-range finding; later chapters cannot. Results reference current manuscript evidence and distinguish conflicts, missing evidence and open questions. This local read does not change the acceptance decision.

For a single character, `agent.getWorldRecord` includes a compact `cardReview`: when the card changed, when an author last checked it, and when a confirmed fact last changed. Use `detail: "full"` for short evidence excerpts. The optional `asOfChapterOrder` limits this review, not the editable profile; reading never marks it reviewed.

### Start

With the Windows build (Preview.22 or newer), use the Agent Runs page to copy the Codex setup command and run it in PowerShell. It uses the bundled MCP server without requiring Node or a source checkout. Remove an older entry with `codex mcp remove novel-director` before registering the replacement. Register again if you move the application.

To launch MCP directly from a source checkout for debugging:

```powershell
npm.cmd run agent:tools
```

The command starts `src/agent/mcp/server.ts` over stdio. It supports MCP-style `initialize`, `tools/list`, `tools/call`, plus lightweight `agent/listTools` and `agent/callTool`.

Tools return compact JSON by default. Full prose, full prompts, or full diagnostics require explicit `detail: "full"` or the relevant include flag.

To reconnect, use `agent.getChapterWorkItem` with the project ID and optionally the selected run ID. It returns the persisted draft/report references, the last verified commit and the next tool. Follow the pinned draft read and use `agent.getDraftReviewReport` to expand a current report without truncation. Registration, execution, retry and normal acceptance support `responseMode: "work_item"`; legacy callers keep the original responses. A work item never accepts a draft or a memory candidate.

The task goal appears when preparing a chapter. Use `task.read` for the complete task from the current source. Use `agent.getStoryBible` and `agent.getStageSummaries` for saved reference materials; both are compact by default. Pass `detail: "full"` for all saved fields, and `summaryId` to open one stage summary. Stage summaries can also be filtered by overlapping `fromChapter` / `toChapter` and paged with `nextOffset`.

Use `agent.recordDraftDecision` to persist a reason for rejecting or deferring the exact draft. To apply a revision without publishing, use `agent.applyRevisionToDraft`, then follow the work item's `resume` to review the same draft again. A concurrent retry of an active Agent job returns existing progress with `alreadyRunning: true`. When the executor has stopped, resume its original job. A work item's optional `continuity` section points to relevant, still-pending facts from the prior committed text; it does not apply them.

`agent.runChapterPipeline` executes the complete standard single-chapter workflow and stops at `await_user_confirmation`; it never accepts the draft automatically. `agent.getPipelineProgress` exposes current step timing and recovery state. `agent.cancelChapterPipeline` uses a side-channel marker so it never races a full AppData write; the executor aborts the active request and persists a recoverable paused job. `agent.retryChapterPipeline` reuses the existing AgentRun and job, resumes from the first failed or unfinished step, and rejects retries after the workflow is already complete. Headless OpenAI-compatible runs read `NOVEL_DIRECTOR_API_KEY` from the current process environment because they cannot access Electron's desktop credential store. Codex CLI and local providers do not require that environment variable.

Archived chapters are available through `agent.getArchivedChapters`. `agent.archiveChapter` and `agent.restoreArchivedChapter` require explicit confirmation, preserve prose and version history, and use revision-protected atomic storage writes.

### Candidate Decisions (brief)

`agent.previewCandidateDecisions` accepts optional normalized amendments. Memory patches support `chapter_review_update`, `character_state_update`, `foreshadowing_create`, `foreshadowing_status_update`, `stage_summary_create`, and `timeline_event_create`. Stage-summary edits are limited to the new author fields `compressedPlotSummary`, `irreversibleChanges`, `endingCarryoverState`, `emotionalAftertaste`, and `pacingState`; legacy fields are not editable. Character-state amendments use `label`, `category`, `targetValue`, and `linkedCardFields`; `amendmentPreview.after.targetValue` is the effective final value. Amendments are recursively redacted without truncation; read-only before/after snapshots may be shortened for display. If `amendmentRedacted` is true, do not apply the redacted placeholder as a target value: retain the authorized original, re-preview/apply it, or ask the user to confirm.

Copy the normalized `amendment` and `expectedFingerprint` from preview items into `agent.applyCandidateDecisions` only when the amendment was not redacted. Keep the same `operationId` and command fields for retries. Receipts include amendment `before`/`after` snapshots and are redacted in the Agent response without changing storage or replay identity. New high-risk acceptance requires an author grant; `confirm`, `confirmedHighRisk`, and client `approvalToken` cannot authorize it. A candidate whose source prose changed is not eligible for acceptance even with a grant. It may still be read or rejected; older unbound candidates are marked `unverified`.

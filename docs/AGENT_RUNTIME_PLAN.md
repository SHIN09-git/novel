# AI 代理运行层施工计划 / Agent Runtime Implementation Plan

## 简体中文

当前增量：W08 已接入任务/世界资料管理和项目授权，具体可调用能力见 [项目授权指南](./AGENT_PROJECT_AUTHORIZATION.md)。本文保留原阶段设计；当前执行顺序和验收进展以 [全盘施工计划](./PRODUCT_OPTIMIZATION_MASTER_PLAN.md) 为准，不因旧文中的“人工确认”重复要求已获授权的动作逐次等待作者。

### 目标

Novel Director 继续保持一个统一产品：桌面 UI 给人类作者使用，Agent Runtime 给 Codex 或其他自动化代理使用。两者共享同一个 SQLite 数据库、AppData 结构、PromptBuilder、ContextNeedPlanner、QualityGate、Run Trace、版本链和提交事务。

Agent Runtime 的目标不是让 Codex 直接写小说正文，而是让 Codex 不再通过 Computer Use 读取 UI，改为通过结构化接口调度现有工作台模型完成小说生产：

- 选择项目和下一章。
- 触发章节生产流水线。
- 读取质量门禁、Novelty Audit、冗余诊断、Run Trace 作者摘要。
- 决定重试、修订、接受、保留待审或进入下一章。
- 管理角色状态候选、伏笔候选、记忆候选和 HardCanon 候选。
- 支持 Codex 连续生产 5 章、10 章甚至几十章，但执行单位仍然是一章：每章都按人类导演同款流程生成、审稿、质量门禁、修订/接受，然后再进入下一章。
- 让人类作者最终审核和抽检。

### 信息权原则

如果 Codex 被作为创作者 / 代理导演使用，它必须拥有与人类导演同等的信息权。凡是人类作者可以在桌面 UI 中查看并用于创作判断的信息，Agent Runtime 都应该提供结构化读取能力：

- 已提交章节正文、草稿正文、修订版本正文和版本差异。
- 最终写作 Prompt、Prompt block 顺序、上下文选择结果、被省略上下文和压缩记录。
- 章节任务书、Context Need Plan、Story Direction、HardCanonPack、角色状态账本、伏笔 treatmentMode、时间线锚点。
- 质量门禁、一致性审稿、Novelty Audit、冗余报告、Run Trace 作者摘要和原始 Run Trace。
- 记忆候选、角色状态候选、伏笔候选及其证据、风险和状态。

因此，默认 compact JSON 输出只是省 token 模式，不是权限边界。Agent 工具应提供 `summary` / `compact` / `full` 三种信息粒度，或通过 `includeProse`、`includePrompt`、`includeDiagnostics`、`maxChars` 等参数显式控制。

真正的边界是：

- 不暴露 API Key、模型密钥、安全存储内容和底层数据库细节。
- 不让 Agent 绕过提交事务、版本链和候选确认边界。
- 不把高风险新设定、HardCanon、长期记忆或不可逆状态静默写成 canon。

### 人类导演同构工作流原则

Agent Runtime 的工作流必须与人类导演在桌面 UI 中执行的工作流同构。这里的“同构”不是限制 Codex 一次只能做一章，而是限制每一章都必须走同一套生产和验收边界。

Agent 可以连续完成很多章，例如 5 章、10 章甚至几十章；但它不能用一个正文生成请求一次性写完多章并绕过中间判断。正确形态是：循环执行标准单章流程，当前章节完成诊断、修订/接受判断和提交后，再进入下一章。

每一章都必须经过：

```text
选择目标章节
→ 构建 / 复用上下文
→ 生成章节任务书
→ 计划后上下文补全
→ 生成正文草稿
→ 章节复盘和候选提取
→ 一致性审稿
→ 质量门禁
→ Novelty / 冗余 / Run Trace 诊断
→ 接受、修订、重跑或暂停
→ ChapterCommitBundle / RevisionCommitBundle 正式提交
→ 处理低风险候选，高风险候选保留待审
→ 进入下一章
```

因此，允许的是“连续多章自动化”，不是“单次多章正文生成”。每章都必须拥有自己的：

- `ChapterGenerationJob`
- `ChapterGenerationStep[]`
- `GeneratedChapterDraft`
- `GenerationRunTrace`
- `QualityGateReport`
- `ConsistencyReviewReport`
- Novelty / Redundancy 诊断
- `ChapterCommitBundle` 或 `RevisionCommitBundle`
- 版本链记录
- `AgentDecision`

连续多章模式允许：

- 一个 `AgentRun` 管理 5/10/几十章的总目标、范围、策略和总评。
- Agent 自动重复执行单章流程，不需要人类逐章点击。
- 每章完成后自动读取诊断、做接受/修订/重跑判断。
- 低风险章节可以自动提交，高风险章节暂停待审。
- 当前章通过后自动进入下一章。

禁止的快捷路径：

- 一个正文生成 Prompt 要求模型连续写第 N 到第 N+10 章。
- 多章共用一个质量门禁或一个 Run Trace。
- 批量接受多个章节草稿而没有逐章风险摘要、逐章版本记录和可回滚提交。
- 跳过候选记忆、角色状态、伏笔候选的风险分级。
- 直接修改章节正文后普通 full save，而不创建提交 bundle。

Agent 的优势应体现在自动循环、自动等待、自动诊断、自动修订、自动提交低风险章节和自动暂停高风险章节；工作台的底线是每章仍然可被人类按正常 UI 逐章理解、审核和回滚。

### 非目标

- 不做第二套桌面 UI。
- 不 fork 新仓库。
- 不让 Codex 绕过工作台提交事务直接落库；但作为创作者时，Codex 可以读取完整创作材料，生成章节任务、修订指令、局部改写建议、验收判断和提交决策。
- 不让 Agent 直接写 SQLite 表。
- 不绕过 `GenerationRunBundle`、`ChapterCommitBundle`、`RevisionCommitBundle` 和版本链。
- 不自动把高风险记忆、HardCanon 或重大新设定写成正式 canon。
- 不破坏现有 JSON 导入导出、SQLite fallback 和桌面 UI 流程。

### 总体架构

```text
Novel Director
├─ Desktop UI
│  └─ 给人类作者查看、编辑、审核、回滚和继续生成
├─ Agent Runtime
│  ├─ CLI：本地命令行和调试入口
│  ├─ MCP / Tool API：给 Codex 调用的结构化工具入口
│  └─ Agent Loop：多章自动生产调度
└─ Shared Core
   ├─ SQLiteStorageService / JsonStorageService fallback
   ├─ PromptBuilderService
   ├─ ContextNeedPlannerService
   ├─ ContextBudgetManager
   ├─ QualityGateService / NoveltyDetector / RedundancyService
   ├─ CharacterStateService / HardCanonPackService / StoryDirectionService
   ├─ GenerationRunBundle
   ├─ ChapterCommitBundle
   ├─ RevisionCommitBundle
   └─ Version Chain / Run Trace / Author Summary
```

核心原则：Agent Runtime 只能调用 Shared Core 和 main-process storage/API，不能复制业务逻辑，也不能绕开提交事务。

### 权限模式

第一版建议内置三档 Agent 模式：

| 模式 | 用途 | 自动接受 | 暂停条件 |
|---|---|---|---|
| `conservative` | 真实稿件安全模式 | 只自动接受低风险、质量明显达标的草稿 | Novelty fail、HardCanon 冲突、质量低于 80、高风险记忆候选 |
| `autonomous` | 连续创作常用模式 | 质量达标后可自动接受草稿，低风险候选可批量处理 | Novelty fail、重大设定、连续修订失败 |
| `experimental` | 测试和 demo | 允许更激进推进 | 存储错误、API 错误、无法恢复的上下文缺口 |

所有模式都必须保留版本链和 Run Trace。高风险写入默认进入候选或待人工审核。

### 功能开放策略

当前计划的安全边界是正确的，但初版略偏保守。Agent Runtime 的目标不是只做“只读看板”，而是成为 Codex 使用 Novel Director 的结构化生产入口。因此后续阶段应采用“默认安全、显式授权后更开放”的策略：

1. **MCP / Tool API 前置。**<br>
   CLI 适合调试，但 Codex 真正高效使用时应尽早使用 MCP / JSON-RPC 工具。MCP 不必等到 P5，可以在 P1 后半段作为 `P1B` 接入，只暴露只读和单章生产工具，写入工具继续走 preview / commit 边界。

2. **允许 Agent 做创作判断，不只是读取报告。**<br>
   Agent 可以基于 Run Trace 作者摘要、质量门禁、Novelty、冗余检测、版本链和差异，给出“接受 / 修订 / 重跑 / 暂停”的明确建议。它不直接绕过工作台写正文，但可以生成任务书修补、局部修订指令和下一章推进策略。

3. **低风险写入可以自动执行。**<br>
   在 `autonomous` 模式下，以下动作可以默认自动执行：接受质量达标草稿、接受低风险角色状态候选、接受低风险记忆候选、拒绝明显重复候选、归档无效候选。所有动作仍然记录 `AgentDecision`，并可从 UI 回看。

4. **中风险写入可使用批量预览。**<br>
   中风险记忆、伏笔状态更新、HardCanon 候选不必一律卡死人工确认。可以生成 `AgentActionPreview`，并允许用户一次批准一组；实验模式下可以用显式 `confirm: true` 或策略文件授权自动应用。

5. **高风险不等于永远禁止。**<br>
   Novelty fail、HardCanon 冲突、重大新设定、不可逆角色状态仍然必须暂停或进入候选。但计划应支持“用户授权后继续”的机制，例如 approval token、一次性确认、或项目级 agent policy。

6. **创作者模式下拥有完整读取权。**<br>
   默认输出 compact JSON 是为了省 token，不是为了限制 Codex。Agent 做最终创作判断时，必须能按需读取完整章节、完整草稿、完整修订版本、完整 diff、完整写作 Prompt 和完整诊断。建议每个读取工具都支持 `detail: 'summary' | 'compact' | 'full'`，并提供 `maxChars` 作为成本护栏。

7. **Agent 可管理创作控制面。**<br>
   Agent 应能新增或修改 Story Direction draft、创建 HardCanon 候选、补充角色状态候选、调整下一章任务草案、创建 Prompt 快照候选。默认不直接写 active canon，但可以维护待审队列和预览。

8. **连续多章自动化应提前进入 MVP。**<br>
   如果只做一次单章生产，节省 token 的收益有限。建议 P2 就开始支持“小批次连续章节生产”：Codex 可以连续执行 5/10/几十次标准单章流程，但每一章都必须完整经历上下文构建、任务书、正文草稿、复盘、审稿、质量门禁、修订/接受判断和提交记录。P4 再扩展到更长批次、恢复能力、失败续跑和更完整的暂停 / 继续策略。

换句话说，安全边界应放在“提交与 canon 污染”上，而不是放在“Agent 能不能看、判断和调度功能”上。功能读取、诊断、建议、预览、低风险自动处理都可以更开放。

### 新增核心类型

#### AgentRun

记录一次 Codex 自动生产批次。

```ts
export interface AgentRun {
  id: ID
  projectId: ID
  goal: string
  mode: 'single_chapter' | 'multi_chapter' | 'arc'
  safetyMode: 'conservative' | 'autonomous' | 'experimental'
  targetChapterOrders: number[]
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  createdJobIds: ID[]
  createdDraftIds: ID[]
  createdCommitIds: ID[]
  pendingHumanReviewItemIds: ID[]
  decisions: AgentDecision[]
  summary: string
  warnings: string[]
  startedAt: string
  updatedAt: string
  completedAt?: string | null
  schemaVersion: number
}
```

#### AgentDecision

记录 Agent 每一步为什么这么做。

```ts
export interface AgentDecision {
  id: ID
  agentRunId: ID
  projectId: ID
  chapterId?: ID | null
  jobId?: ID | null
  step: string
  action:
    | 'run_pipeline'
    | 'retry_step'
    | 'revise_draft'
    | 'accept_draft'
    | 'reject_draft'
    | 'accept_memory_candidate'
    | 'reject_memory_candidate'
    | 'propose_hard_canon_candidate'
    | 'continue_next_chapter'
    | 'pause_for_human'
  reason: string
  evidence: string[]
  riskLevel: 'low' | 'medium' | 'high'
  result: 'applied' | 'skipped' | 'failed' | 'pending_human'
  createdAt: string
}
```

#### AgentActionPreview

所有正式写入前都先形成预览。

```ts
export interface AgentActionPreview {
  id: ID
  agentRunId: ID
  actionType:
    | 'chapter_commit'
    | 'revision_commit'
    | 'memory_candidate_batch'
    | 'character_state_candidate_batch'
    | 'foreshadowing_candidate_batch'
    | 'hard_canon_candidate'
  summary: string
  riskLevel: 'low' | 'medium' | 'high'
  diffSummary: string[]
  affectedIds: ID[]
  requiresHumanApproval: boolean
  createdAt: string
}
```

### 写入边界

Agent Runtime 产生的数据必须能在现有 UI 里查看。

- AI 生成过程：写入 `GenerationRunBundle`。
- 接受草稿：写入 `ChapterCommitBundle`。
- 应用修订：写入 `RevisionCommitBundle`。
- 角色状态变化：先进入 `CharacterStateChangeCandidate`，低风险可按策略接受，高风险保留待审。
- 记忆变化：先进入 `MemoryUpdateCandidate`，高风险和 Novelty fail 默认不自动接受。
- HardCanon：第一版只允许生成候选或 action preview，不自动写 active hard canon。
- 版本恢复：继续走 `RevisionCommitBundle`。

建议在相关记录上增加可选来源字段：

```ts
actor?: 'user' | 'agent' | 'system'
agentName?: 'codex'
agentRunId?: ID | null
```

UI 只需轻量显示“来源：Codex Agent”。

### Agent 工具接口

P0/P1 阶段建议先做 CLI，稳定后再暴露 MCP。

#### 只读工具

```text
agent.listProjects
agent.getProjectDigest
agent.getNextChapterTarget
agent.getChapterProductionState
agent.getChapterVersionChain
agent.getChapterText
agent.getDraftText
agent.getPromptSnapshot
agent.getGenerationPrompt
agent.getVersionDetail
agent.getVersionDiff
agent.getRunDiagnostics
agent.getFullRunTrace
agent.getCandidateDetail
agent.getPendingHumanReviewItems
```

#### 生产工具

```text
agent.runChapterPipeline
agent.retryFailedStep
agent.inspectPipelineJob
agent.proposeRevision
agent.runRevision
agent.getAcceptanceRecommendation
```

#### 提交工具

```text
agent.previewAcceptDraft
agent.applyApprovedChapterCommit
agent.previewRevisionCommit
agent.applyApprovedRevisionCommit
agent.previewMemoryCandidateBatch
agent.applyApprovedMemoryCandidateBatch
```

#### 连续创作工具

```text
agent.startAgentRun
agent.continueAgentRun
agent.pauseAgentRun
agent.resumeAgentRun
agent.cancelAgentRun
agent.getAgentRunSummary
```

### CLI 形态

```powershell
npm.cmd run agent -- list-projects
npm.cmd run agent -- project-digest --project-id <id>
npm.cmd run agent -- run-chapter --project-id <id> --chapter 18 --mode conservative
npm.cmd run agent -- continue --project-id <id> --start-chapter 18 --chapters 10 --mode autonomous
npm.cmd run agent -- inspect-run --agent-run-id <id>
npm.cmd run agent -- pending-review --project-id <id>
```

CLI 输出默认是结构化 JSON；必要时提供 `--pretty` 输出作者摘要。

CLI / MCP 读取工具建议统一支持：

```text
--detail summary|compact|full
--include-prose
--include-prompt
--include-diagnostics
--max-chars <number>
```

默认用 `compact` 节省 token；当 Codex 正在承担创作者职责时，可以显式请求 `full`。这与人类导演在 UI 中打开详情、正文和 Prompt 是同等权限。

### 连续多章创作循环

```text
1. 读取项目摘要和下一章目标
2. 读取 Story Direction / HardCanon / ContextNeedPlan 相关状态
3. 启动第 N 章标准章节生产流水线
4. 等待第 N 章 job 完成或失败
5. 读取第 N 章 Run Trace 作者摘要、质量门禁、Novelty Audit、冗余诊断
6. 如果失败且可恢复：重试第 N 章失败 step
7. 如果质量不足：为第 N 章生成修订候选并应用安全修订
8. 如果达标：预览并提交第 N 章 ChapterCommitBundle 或 RevisionCommitBundle
9. 处理第 N 章低风险候选；高风险候选保留待审
10. 记录第 N 章 AgentDecision
11. 只有第 N 章完成提交或明确暂停后，才进入第 N+1 章
12. 重复直到达到章节数、风险阈值、失败阈值或人工暂停条件
```

连续多章模式可以让 Codex 自动生产 5/10/几十章，但不是一次性生成多章正文。批次级 `AgentRun` 负责统筹总目标和进度；章节级 job / trace / commit 负责让桌面 UI 和人类作者逐章检查、回滚和继续修订。某一章触发高风险时，默认暂停整个批次，除非项目级 agent policy 明确允许跳过该章或保留为待审后继续。

### 阶段计划

#### P0：只读 Agent Runtime

目标：Codex 不看 UI 就能理解项目状态。

施工：

- 新增 `src/agent/AgentRuntime.ts`。
- 新增 `src/agent/AgentReadableSummaryService.ts`。
- 新增 `src/agent/cli.ts`。
- 新增只读命令：项目列表、项目摘要、章节生产状态、版本链、诊断摘要、待审核项。
- AppData 新增 `agentRuns: AgentRun[]`，旧数据 normalize 为空数组。

验收：

- Codex 能通过 CLI 获取项目、下一章、当前风险、待处理候选。
- 默认输出不包含完整 prompt、完整正文或 API Key；显式 `full` / `includeProse` / `includePrompt` 模式可以读取人类 UI 可见的正文与 Prompt，但永远不包含 API Key。
- UI 数据不变。

#### P1：单章自动生产

目标：Agent 可触发单章生产并读取结构化结果。

施工：

- 新增 `AgentRunService`。
- 封装 `runChapterPipeline`，复用现有 pipeline runner / main-process API。
- 生成 `AgentRun` 和 `AgentDecision`。
- 失败时返回可重试 step 和原因。
- 增加 `P1B MCP / Tool API` 薄层：先暴露只读工具、单章生产、检查 job 状态和读取诊断，不开放提交写入。
- 支持同等信息权读取：默认返回 compact 摘要，但允许 Agent 显式读取完整章节、草稿、修订版本、diff、写作 Prompt、Prompt block 和诊断报告。

验收：

- 单章生成后，UI 能看到 job、draft、Run Trace、质量门禁和候选。
- AgentRun 记录 createdJobIds / createdDraftIds。
- 失败不会半写入。
- Codex 可通过工具而不是 Computer Use 触发单章生产并读取结果。
- Codex 可在不打开 UI 的情况下读取与人类导演同等的信息来判断是否接受、修订或重跑。

#### P2：自动审稿、接受建议与连续章节雏形

目标：Codex 能基于结构化报告决定接受、修订或暂停，并可以连续执行多个标准单章流程。

施工：

- 新增 `AgentDecisionService`。
- 聚合 Run Trace 作者摘要、QualityGate、ConsistencyReview、NoveltyAudit、RedundancyReport。
- 生成 acceptance recommendation。
- 新增 `AgentActionPreview`。
- 新增低风险自动处理策略：质量达标且无 high risk 时可自动接受当前章节；低风险记忆/角色状态候选可在当前章节提交后批量处理；明显重复候选可自动拒绝。
- 新增小批次连续章节雏形：允许 AgentRun 目标覆盖 5/10/几十章，但实际执行仍是一章一章生成、审稿、修订/接受和提交。遇到 Novelty fail、HardCanon 冲突、连续修订失败或中高风险候选过多时，暂停当前章节和整个批次。

验收：

- 质量达标时能建议接受。
- Novelty fail / HardCanon 冲突时必须暂停。
- 建议动作有 evidence、riskLevel 和 reason。
- 低风险自动动作可在 UI 中追溯为 Codex Agent 决策。
- 连续生产的每一章都能在 UI 中作为独立草稿、独立诊断和独立提交预览查看。

#### P3：事务化提交接入

目标：Agent 可以在策略允许时自动提交低风险结果。

施工：

- 接入 `saveChapterCommitBundle`。
- 接入 `saveRevisionCommitBundle`。
- 低风险记忆候选支持批量接受；高风险保留 pending。
- 所有提交写入 actor / agentRunId。
- 支持用户授权的中风险批量应用：通过 action preview、approval token 或项目级策略显式放行。
- 支持 Story Direction draft、HardCanon 候选、Prompt 快照候选的 agent-created 来源标记。

验收：

- UI 能看到 Codex Agent 生成的章节和版本链。
- 恢复、diff、Run Trace 仍然可用。
- 重复执行同一提交不重复写入。

#### P4：多章 Agent Loop

目标：支持长批次 5/10/12 章甚至几十章的连续单章生产、诊断、修订和提交预览。

施工：

- 新增 `continueAgentRun`。
- 新增 `continueAgentRun` 的恢复 / 续跑能力，而不是新增一次性多章正文生成工具。
- 每章必须独立生成 job、draft、diagnostics、trace 和 commit preview。
- 每章完成后才能继续下一章；批次可以整体暂停、恢复或取消。
- 支持最大章节数、最大连续失败次数、最大高风险候选数。
- 输出批次摘要。
- 支持自动生成下一章任务修补建议和 Story Direction delta，不只机械递增章节号。
- 支持章节质量不达标时自动进入一次或多次修订循环，再重新评估。

验收：

- 自动完成多章后，UI 能看到每章独立的正式版本、trace、质量门禁和 AgentDecision。
- 高风险章节会停在 pending human review，并默认暂停 AgentRun，避免后续章节建立在不稳定 canon 上。
- AgentRun summary 能列出完成章节、暂停原因、待审项。

#### P5：更完整的 MCP / Tool API

目标：把 P1B 的薄 MCP 扩展成完整 Agent 工具层，而不是通过 shell 解析 CLI。

施工：

- 新增 `src/agent/mcp/` 或等价 stdio JSON-RPC 层。
- 将 CLI commands 封装为工具 schema。
- 工具默认返回 compact JSON。
- 高风险 apply 工具要求显式 `approvalToken` 或 `confirm: true`。

验收：

- Codex 可调用工具完成项目读取、单章生成、审稿和提交预览。
- 不通过 Computer Use 也能完成核心生产循环。

#### P6：轻量 UI 可视化

目标：让人类作者能在现有 UI 里查看 Agent 批次。

施工：

- 新增 Agent Runs 面板或设置页 tab。
- 展示批次目标、章节范围、状态、完成章节、待审项、风险摘要。
- 在版本历史、流水线历史、记忆候选上显示 `Codex Agent` 来源。

验收：

- 人类作者能快速知道 Codex 做了什么。
- 所有 Agent 写入都能从 UI 追溯和回滚。

### 测试计划

新增验证脚本：

- `validate-agent-runtime-readonly.mjs`
- `validate-agent-run-single-chapter.mjs`
- `validate-agent-decision-policy.mjs`
- `validate-agent-commit-boundary.mjs`
- `validate-agent-multi-chapter-loop.mjs`
- `validate-agent-ui-visibility.mjs`

核心断言：

1. Agent Runtime 不直接 import renderer UI。
2. Agent Runtime 不直接 import `better-sqlite3`。
3. Agent 写入必须走 bundle / commit service。
4. Agent 输出不包含 API Key、完整 prompt、完整正文。
5. Agent 生成章节可在现有 UI 查看。
6. Agent 接受草稿会创建版本链。
7. Agent 修订会创建 RevisionCommitBundle。
8. 高风险候选默认保留待审。
9. 多章自动运行可暂停、恢复、取消。
10. JSON 导入导出和 SQLite round-trip 保持正常。

每阶段至少运行：

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

### 风险与防护

| 风险 | 防护 |
|---|---|
| Agent 自动污染长期记忆 | 高风险候选 pending，Novelty fail 不自动接受 |
| Agent 绕过版本链 | 所有正文写入必须走 ChapterCommitBundle / RevisionCommitBundle |
| UI 和 Agent 互相覆盖 | 使用 main-process transaction 和现有 save queue；高风险写入不走普通 full save |
| Codex 消耗过多 token | 默认 compact JSON；创作者模式可显式读取 full 正文 / prompt，并用 maxChars 做成本护栏 |
| Agent 自动把新规则写成 canon | HardCanon 第一版只生成候选或 action preview |
| 多章跑偏 | 质量阈值、Novelty fail、连续失败次数和高风险候选数量触发暂停 |

### 推荐第一轮施工范围

第一轮已完成 P0，只读 CLI 可以理解项目状态。下一轮建议直接做更开放的 P1/P1B，而不是继续停留在只读层：

1. 新增 `AgentRunService`，创建 / 更新 AgentRun 和 AgentDecision。
2. 新增单章 `run-chapter` 命令，只调用现有生产流水线，不自动接受。
3. 新增 `inspect-job` / `watch-job`，让 Codex 等待 job 完成并读取结构化结果。
4. 新增 `acceptance-recommendation`，输出接受 / 修订 / 重跑 / 暂停建议。
5. 新增 P1B MCP 薄层，至少暴露只读、单章生产、诊断读取三类工具。
6. 新增 `detail`、`includeProse`、`includePrompt`、`includeDiagnostics`、`maxChars` 参数，确保 Codex 作为创作者时不需要打开 UI 也能读取完整创作材料。
7. 新增验证脚本锁定“不读 UI、不直接写 DB、不泄露 key、不绕过 bundle/commit 边界”。

完成后，Codex 就能不看 UI 地理解项目、触发单章生产、做初步审稿判断，并在低风险场景进入自动提交预览。后续再逐步开放自动接受和多章循环。

---

## English

This plan adds an Agent Runtime to the existing Novel Director product. It is not a fork and not a second desktop UI. The desktop UI and the agent share the same SQLite database, AppData model, prompt pipeline, diagnostics, commit bundles, version chain, and import/export behavior.

The agent should not write prose itself. It should orchestrate the existing configured AI provider, inspect structured diagnostics, make decisions, prepare commits, and leave high-risk changes for human review.

When Codex acts as a creator or proxy director, it should have the same information rights as the human director. Compact output is a token-saving default, not a permission boundary. Tools should support summary, compact, and full detail levels, including full prose, prompts, diffs, version details, and diagnostics when explicitly requested. The hard boundary remains secrets, direct database writes, bypassing commit bundles, and silent canon pollution.

Recommended sequence:

1. P0 read-only Agent Runtime: project digest, chapter state, version chain, diagnostics, pending review items.
2. P1 single-chapter production: run one chapter through the existing pipeline and record `AgentRun` / `AgentDecision`.
3. P2 decision policy and sequential multi-chapter automation: recommend accept, revise, reject, or pause based on Quality Gate, Novelty, Run Trace, redundancy, and state checks. Codex may produce 5, 10, or dozens of chapters in one AgentRun, but execution remains chapter-by-chapter: each chapter is generated, reviewed, quality-gated, revised/accepted, and committed before the next chapter starts.
4. P3 transactional commits: approved draft and revision commits go through existing commit bundle services.
5. P4 multi-chapter loop: support long sequential chapter runs with resume, pause, failure recovery, and per-chapter version-chain records.
6. P5 MCP / tool API: expose compact structured tools for Codex.
7. P6 UI visibility: show Agent Runs and Codex-origin records in the existing desktop UI.

The first implementation slice should cover P0 + a thin P1: add the agent types, read-only summaries, CLI commands, and one safe single-chapter command without automatic acceptance.

Human-parity workflow rule: agent automation mirrors the human director's production workflow, not the human click-by-click cadence. Codex may automatically continue for many chapters, but each chapter still runs through the same generate, review, quality gate, revise/accept, commit, and version-chain path before the next chapter begins.

# AI 工作流与 Prompt 风险施工计划 / AI Workflow and Prompt Repair Plan

## 简体中文

### 背景

Novel Director 已经具备 Context Need Planner、ContextBudgetManager、Prompt Priority Stack、质量门禁、Novelty Audit、冗余检测、Run Trace 和作者摘要。剩余风险主要集中在三处：

1. 生产流水线页面和 runner 仍可能过早加载上下文构建、审稿和诊断服务。
2. 质量门禁、Novelty 和冗余检测仍在 renderer 可用链路中执行，后续应继续收窄边界。
3. Prompt 约束体系已经很强，但仍需要持续防止同类禁令重复出现，以及低价值诊断文字进入正文写作 prompt。

### 施工原则

- 不改变章节生成语义。
- 不删除质量门禁、Novelty Audit、冗余检测或 Run Trace。
- 先做可验证的依赖边界瘦身，再考虑 main process 下沉。
- 每一阶段都用验证脚本锁定边界，防止重服务重新回到默认页面加载路径。

### Phase 1：生产流水线 step 懒加载与边界锁定（已完成）

目标：

- `pipelineRunnerEngine` 不再静态 import 所有 `pipelineSteps/*`。
- 打开生产流水线页面时，不提前加载质量门禁、Novelty、冗余检测等 step 专属逻辑。
- `usePipelineRunnerCore` 只保留 hook 状态管理和持久化协调，不再 import 重型 AI / prompt 服务。
- 保留所有 step 的原业务行为。

已完成：

- 新增轻量 `contextBudgetProfile` 工具，避免 runner engine 为创建预算 profile 引入完整 `promptContext`。
- `pipelineRunnerEngine` 改为按 step 动态 `import()` 对应处理模块。
- `usePipelineRunnerCore` 移除未使用的重型 service import。
- 新增 `validate-ai-workflow-prompt-boundaries.mjs` 锁定边界。

### Phase 2：修订候选上下文构建懒加载（已完成）

目标：

- `GenerationPipelineView` 不再静态 import `promptContext`、ContextBudgetManager 或 PromptBuilder 相关链路。
- 只有用户点击“生成修订候选”时，才加载修订候选上下文重建逻辑。
- 继续复用当前 job 的 `build_context` 输出、Prompt 快照、explicit selection、forced quality gate issue block 和 compressionRecords。

已完成：

- 新增 `generation/revisionCandidateContext.ts`，集中承接修订候选上下文解析与重建。
- `GenerationPipelineView` 改为在 `generateRevisionCandidate` 内动态加载该 helper。
- 更新相关验证脚本，确保页面不再静态导入 prompt context builders。

### Phase 3：本地审稿 / 诊断 main process 下沉（已完成核心版）

目标：

- 将纯规则的 NoveltyDetector、RedundancyService、QualityGate fallback 逐步下沉到 main process IPC。
- renderer 只接收结构化报告，不直接携带完整诊断实现。
- 保留 JSON fallback、SQLite 事务化写入和现有 AppData save queue。

已完成：

- 新增 diagnostics IPC：冗余分析、Novelty Audit、质量门禁评估。
- main process 通过 `DiagnosticsService` 执行诊断，renderer 通过 `diagnosticsApi` 获取结构化报告。
- `QualityGateAI` 改为依赖通用 JSON client interface，main process 使用 `MainAIJsonClient` 复用同一套质量门禁 prompt 与 schema。
- renderer 仍保留动态 fallback，以兼容旧 preload 或开发中断场景。

### Phase 4：Prompt Lint 与写作 Prompt 单源防护

目标：

- 在最终正文 prompt 生成后执行轻量 lint。
- 检查占位符、重复禁令、审稿口吻、英文重复 guardrail、过量伏笔、低价值诊断文本。
- lint 只产生 warning，不自动改写作者填写的真实任务。

现有基础：

- `validate-writing-prompt-hygiene.mjs`
- `validate-foreshadowing-prompt-limit.mjs`
- Prompt Priority Stack 与 promptBlockOrder

### Phase 5：作者摘要与修复入口联动

目标：

- Run Trace 作者摘要不只指出问题，还能引导到对应修复入口。
- 上下文缺失 -> Prompt Builder / Context Need Plan。
- 角色状态问题 -> 角色状态账本。
- 新规则漂移 -> Hard Canon / Novelty Policy。
- 重复描写 -> 修订工作台。

---

## English

### Background

Novel Director already has Context Need Planner, ContextBudgetManager, Prompt Priority Stack, Quality Gate, Novelty Audit, Redundancy Report, Run Trace, and author summaries. Remaining risks:

1. The generation pipeline can still load heavy workflow and diagnostic services too early.
2. Quality Gate, Novelty, and redundancy checks still run in renderer-accessible code paths.
3. Prompt constraints are strong, but duplicate guardrails and low-value diagnostic text must stay out of writing prompts.

### Principles

- Do not change chapter generation semantics.
- Do not remove existing diagnostics.
- Reduce dependency boundaries first, then consider main-process migration.
- Add validation scripts for every phase.

### Phase 1: Lazy Step Loading and Boundary Lock (done)

- `pipelineRunnerEngine` lazy-loads step modules.
- `usePipelineRunnerCore` no longer imports heavy AI / prompt services.
- A lightweight context budget profile helper avoids pulling the full prompt context into the runner engine.
- `validate-ai-workflow-prompt-boundaries.mjs` locks the boundary.

### Phase 2: Lazy Revision Candidate Context (done)

- `GenerationPipelineView` no longer statically imports prompt context builders.
- Revision candidate context rebuilding now lives in `generation/revisionCandidateContext.ts`.
- The helper is loaded only when the author generates a revision candidate.

### Phase 3: Move Local Diagnostics to Main Process (core done)

Move pure-rule Novelty, redundancy, and quality fallback diagnostics behind main-process IPC while preserving renderer UI behavior.

Completed:

- Added diagnostics IPC for redundancy, Novelty Audit, and Quality Gate evaluation.
- Added a main-process `DiagnosticsService`.
- `QualityGateAI` now depends on a transport-agnostic JSON client interface, allowing the main process to reuse the same quality gate prompt and schema.
- Renderer diagnostics calls now go through `diagnosticsApi`, with dynamic fallback for older preload surfaces.

### Phase 4: Prompt Lint

Run a lightweight lint on final writing prompts to detect placeholders, duplicate guardrails, audit tone, overlong foreshadowing blocks, and low-value diagnostic text.

### Phase 5: Author Summary Repair Links

Connect Run Trace author summaries to concrete repair surfaces: Prompt Builder, state ledger, Hard Canon, Novelty Policy, and Revision Workbench.

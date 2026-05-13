# 路线图 / Roadmap

最后审阅日期：2026-05-13

这份路线图基于当前仓库代码、验证脚本、公开文档和本轮重新检测结果整理。它面向公开读者、贡献者和后续维护者，不包含本机路径、私有稿件、真实密钥或内部敏感细节。

---

## 简体中文

### 本轮检测摘要

本轮重新检查了：

- `package.json` 与 `scripts/run-tests.mjs`
- 核心存储、IPC、preload、AI 调用、安全与发布脚本
- 生成流水线、PromptBuilder、Context Need Planner、ContextBudgetManager、NoveltyDetector、QualityGate
- 公开文档与最大源码文件体量

当前验证基线：

- `npm.cmd run typecheck`：通过
- `npm.cmd test`：通过，当前 44 个验证脚本
- `npm.cmd run build`：通过
- `validate-no-mojibake.mjs`：通过
- `validate-release-p0-readiness.mjs`：通过
- `validate-electron-security-p0.mjs`：通过
- `validate-sqlite-storage.mjs`：通过
- `validate-novelty-guardrails.mjs`：通过

当前最大源码文件约为：

- `src/renderer/src/views/ChaptersView.tsx`：约 767 行
- `src/renderer/src/views/PromptBuilderView.tsx`：约 741 行
- `src/main/ipc/registerIpcHandlers.ts`：约 694 行
- `src/renderer/src/views/CharactersView.tsx`：约 665 行
- `src/renderer/src/views/GenerationPipelineView.tsx`：约 653 行
- `src/services/ContextNeedPlannerService.ts`：约 651 行
- `src/services/NoveltyDetector.ts`：约 640 行
- `src/storage/SqliteStorageService.ts`：约 619 行
- `src/renderer/src/views/RevisionStudioView.tsx`：约 619 行
- `src/main/DataMergeService.ts`：约 544 行

结构性进展：

- `src/shared/types.ts` 已拆成 `src/shared/types/*`，原文件保留兼容导出。
- `src/shared/defaults.ts` 已拆成 `src/shared/defaults/index.ts` 与 `src/shared/normalizers/*`，原文件保留兼容导出。
- `PromptBuilderService.ts` 已拆出 `src/services/promptFormatters/*`。
- `ContextBudgetManager.ts` 已拆出 `src/services/contextBudget/*`。
- 生成流水线执行器已拆成 `pipelineRunnerEngine.ts`、`pipelineRunnerTypes.ts` 和 `pipelineSteps/*`，`usePipelineRunnerCore.ts` 已降到可维护体量。
- NoveltyDetector 已从简单关键词命中升级为分层判定：任务书许可、已有上下文、显式禁止、代价/限制、机械降神便利性会共同决定风险等级。

### 当前产品状态

Novel Director 是 `0.1.x` 实验性预览阶段的本地优先 AI 长篇小说工作台。

当前已具备：

- Electron + React + TypeScript 桌面应用，Windows 为主要开发和验证平台。
- SQLite P0 后端，renderer 仍通过 `load()/save(AppData)` 兼容 API 工作。
- JsonStorageService fallback、JSON 导入导出、旧 JSON 首次迁移、数据路径迁移和合并预览。
- API Key 使用 Electron `safeStorage`，不应写入 AppData、SQLite、JSON 导出或日志。
- main process sandbox、context isolation、CSP、导航限制、单实例锁和受控 preload API。
- AI HTTP 调用在 main process 执行，支持限流、指数退避重试、`response_format` 降级和错误脱敏。
- renderer 保存队列和函数式保存，降低旧闭包覆盖新数据的风险。
- 关键写入聚合或事务化：
  - `GenerationRunBundle` 记录 AI 生成过程。
  - `ChapterCommitBundle` 记录用户首次采纳草稿。
  - `RevisionCommitBundle` 记录正式修订提交。
  - 版本链、历史版本查看、Diff 和恢复 UI 已有基础实现。
- Context Need Planner、ContextBudgetManager、计划后二次上下文补全、Prompt Priority Stack、上下文压缩替换、伏笔 treatmentMode 操作表、HardCanonPack、Story Direction Guide、Novelty Guardrails、Quality Gate 和 Run Trace。
- Character State Ledger 覆盖位置、伤势、资源、物品、知识、承诺、能力限制等硬状态，并支持从日志转入账本或候选。
- 记忆候选结构化，支持批量确认，仍以用户确认为长期记忆写入边界。
- 质量门禁通过分数为 50，需要人工确认审核的门槛为 80。
- 最终写作 Prompt 中可推进伏笔数量限制为 10，并按状态、权重和 treatmentMode 排序。
- 公开发布材料已具备：MIT License、README、SECURITY、CONTRIBUTING、CHANGELOG、THIRD_PARTY_NOTICES、GitHub Actions 与发布检查脚本。
- Windows 打包流程包含本地 Electron 缓存目录、`better-sqlite3` native 依赖说明和 packaged smoke test。
- 首页空项目状态提供旧数据 JSON 导入口。

### P0：发布与数据安全回归

状态：P0 基线已完成，后续作为每次发布前的硬门禁维护。

继续保持：

1. 文档和用户可见中文文案保持 UTF-8，无 mojibake。
2. Electron sandbox、CSP、导航限制、preload API 收敛和单实例锁保持开启。
3. API Key 不落盘回归持续覆盖保存、导出、导入、迁移、SQLite、日志和错误路径。
4. SQLite、JSON fallback、导入导出、旧 JSON 迁移、事务写入保持验证。
5. Windows packaged smoke test 持续验证图标、preload API、SQLite 默认路径、导入导出和无 API Key 状态。

每次发布前必须运行：

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run smoke:packaged
```

公开发布前还应运行第三方 secret scanner，例如 gitleaks 或 trufflehog，并确认 GitHub secret scanning、Dependabot alerts、branch protection 和 required checks 已启用。

### P1：核心可维护性

目标：继续降低最大文件复杂度，让贡献者能安全修改高频页面和关键服务。

优先事项：

1. 拆分 `ChaptersView.tsx`
   - 建议拆成章节列表、章节编辑器、章节 AI 草稿/复盘面板、版本历史入口、导出操作。
   - 验收：主文件降到 350 行以内；章节倒序列表、编辑保存、导出、版本恢复入口不回归。

2. 拆分 `PromptBuilderView.tsx`
   - 建议拆成目标章节配置、上下文需求计划、上下文选择、伏笔选择、快照管理、Prompt 预览。
   - 验收：主文件降到 350 行以内；快照保存、手动伏笔选择、Story Direction / HardCanon / ContextNeedPlan 接入不回归。

3. 拆分 `registerIpcHandlers.ts`
   - 建议拆成 storage handlers、credential handlers、AI handlers、backup/log handlers、app/window handlers。
   - 验收：主注册文件只负责组合注册；IPC channel 名称和 preload API 不变。

4. 拆分 `CharactersView.tsx`
   - 建议拆成角色卡九项模板、动态状态账本、状态日志、状态候选、关系/状态分组。
   - 验收：日志转状态事实、转候选、未归类状态显示、Prompt 状态账本链路不回归。

5. 拆分 `GenerationPipelineView.tsx`
   - 生成流水线执行器已拆分，下一步应继续拆页面层。
   - 建议保留页面 shell，把配置、主产物区、诊断 inspector、Job 历史、记忆候选处理移到独立组件。

6. 拆分 `NoveltyDetector.ts`
   - 当前精度已提升，但文件体量进入高风险区。
   - 建议拆成 `keywordCatalog.ts`、`noveltyPolicy.ts`、`nameDetection.ts`、`findingScoring.ts`、`NoveltyDetector.ts`。
   - 验收：新增规则、新角色、新组织、重大设定、机械降神检测行为保持现有验证脚本通过。

### P2：上下文与 Prompt 质量

目标：让模型更少吃书、更少临时发明规则、更稳定承接上一章。

已完成基础：

- Context Need Planner 能识别角色硬状态、伏笔、时间线、HardCanon、Story Direction 需求，并能给出 reason 与 priority。
- ContextBudgetManager 有评分、选择、trace 和压缩模块。
- Prompt Priority Stack 已将上一章衔接、本章任务、角色硬状态、伏笔规则和 HardCanon 前置。
- StageSummary 职责已收窄为远期剧情压缩背景。
- 写作 Prompt 已去除空字段、占位符、重复英文 guardrail 和风险审稿口吻。
- 伏笔按 treatmentMode 分组，可推进数量限制为 10。
- NoveltyDetector 已能区分：
  - 任务书许可的新信息；
  - 已在上下文或伏笔中出现的规则复用；
  - 带明确代价/限制的新规则；
  - 未授权、无铺垫、无代价且刚好解围的机械降神式规则补丁；
  - 编号管理员/组织层级与普通命名角色。

下一步：

1. 给 Context Need Planner 增加更强的“不确定性”表达。
   - 区分“角色被提及”“角色在场”“角色必须行动”“角色状态必须检查”。
   - 对 uncertain 需求避免强行挤入 prompt，但要进入 trace。

2. 让 ContextBudgetManager 的 dropped / unmet reason 更细。
   - 预算不足。
   - 低相关。
   - 已被压缩替代。
   - 被 forbidden 排除。
   - 被用户手动排除。
   - 被 Prompt snapshot 固定。

3. 增加 Prompt block 预览。
   - 展示每块 token 估算、来源、优先级、是否截断、是否 forced、是否 compressed。
   - 帮助作者理解为什么某些上下文进入或没有进入 prompt。

4. 继续降低 NoveltyDetector 漏判。
   - 增加“规则变体同义词”与“规则作用对象”识别。
   - 对“系统提示、广播、票据、公告、环境线索”作为合理新规则媒介进行更细分判断。
   - 对“揭露章 / 新副本开场章 / 高潮解法章”采用不同风险阈值。

### P3：作者体验

目标：降低复杂 AI 工作流的认知负担，让真实写作更顺。

优先方向：

- 提供干净的 synthetic demo project，避免首次打开完全空白。
- 做旧数据导入向导，自动发现旧 JSON、旧 SQLite、备份文件和常见数据目录。
- 优化 Version Chain 恢复说明，让作者明确“恢复会创建新版本，不会删除当前正文”。
- 优化 Revision Workbench 的 issue 来源、diff 范围、接受风险和回滚入口。
- 让 Run Trace 作者摘要成为默认阅读入口，原始 JSON 作为高级详情。
- 改善长文本编辑体验：章节内搜索、滚动定位、保存状态、快捷键、错误边界恢复。
- 增强无障碍：焦点样式、按钮可读标签、键盘导航和对比度。

### P4：存储、查询与搜索

目标：在保持 AppData 兼容的前提下，让 SQLite 后端逐步发挥查询价值。

建议方向：

- 增加 main-process 只读查询 API，不让 renderer 直接访问 SQLite。
- 为章节、角色、伏笔、时间线、角色状态事实增加常用查询索引。
- 增加可选 SQLite FTS，用于章节正文、阶段摘要、角色状态、伏笔和 HardCanon 搜索。
- 提供只读搜索和引用跳转，不直接改写业务数据。
- 保留 JSON 导入导出和备份能力。

暂不建议：

- 立即把所有 AppData 拆成完整关系型模型。
- 移除 JSON fallback。
- 让 renderer 直接读写数据库。

### P5：扩展能力

长期方向：

- 多 provider adapter 和 provider capability matrix。
- 可选流式输出、取消请求和更细粒度重试策略。
- Prompt 模板可视化编辑器和调试器。
- 时间线图、伏笔网络、角色关系图和角色状态图谱。
- 项目打包格式和更完整的导入导出协议。
- 正式代码签名、release checksums 和自动发布流水线。
- 可选插件或脚本扩展点。

### 暂不计划

近期不做：

- 云同步、账号系统、多设备协作。
- 自动把 AI 输出直接写入长期记忆或 HardCanon。
- 远程托管用户稿件。
- 一次性重写 PromptBuilder、生成流水线或整个 UI。
- 用大型依赖替代现有轻量规则系统。

### 工程守则

- 本地优先，用户数据默认保留在本机。
- 密钥只由 main process 和安全存储处理，不写入普通数据文件。
- 高风险写入必须可追踪、可回滚、幂等。
- AI 输出只能成为候选，进入长期记忆或硬设定前需要用户确认。
- Prompt 优先级必须保护上一章衔接、本章任务、角色硬状态、伏笔 treatmentMode 和 HardCanon。
- renderer 不直接访问文件系统、SQLite 或 API Key。
- 每轮小版本都应通过 `npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build`。

---

## English

Last reviewed: 2026-05-13.

This roadmap reflects the current repository, validation scripts, public documentation, and this review pass. It is public-facing and avoids local paths, private manuscripts, real credentials, and internal sensitive details.

### Review Summary

This pass reviewed:

- `package.json` and `scripts/run-tests.mjs`
- Storage, IPC, preload, AI transport, security, and release scripts
- Generation Pipeline, PromptBuilder, Context Need Planner, ContextBudgetManager, NoveltyDetector, and QualityGate
- Public documentation and largest source files

Current validation baseline:

- `npm.cmd run typecheck`: passing
- `npm.cmd test`: passing, currently 44 validation scripts
- `npm.cmd run build`: passing
- `validate-no-mojibake.mjs`: passing
- `validate-release-p0-readiness.mjs`: passing
- `validate-electron-security-p0.mjs`: passing
- `validate-sqlite-storage.mjs`: passing
- `validate-novelty-guardrails.mjs`: passing

Largest remaining source files:

- `ChaptersView.tsx`: about 767 lines
- `PromptBuilderView.tsx`: about 741 lines
- `registerIpcHandlers.ts`: about 694 lines
- `CharactersView.tsx`: about 665 lines
- `GenerationPipelineView.tsx`: about 653 lines
- `ContextNeedPlannerService.ts`: about 651 lines
- `NoveltyDetector.ts`: about 640 lines
- `SqliteStorageService.ts`: about 619 lines
- `RevisionStudioView.tsx`: about 619 lines
- `DataMergeService.ts`: about 544 lines

Structural progress:

- Shared types and defaults have been split into domain modules with compatibility exports.
- Prompt formatting and context budget logic have been split into focused modules.
- The generation pipeline runner has been split into an engine, shared runner types, and phase-specific step handlers.
- Novelty detection has moved from simple keyword hits toward layered judgment using chapter permission, prior context, explicit forbiddance, cost/limits, and deus-ex convenience signals.

### Current State

Novel Director is an experimental `0.1.x` local-first AI workbench for long-form fiction.

It currently includes:

- Electron + React + TypeScript desktop app, primarily validated on Windows.
- P0 SQLite backend with renderer-facing `load()/save(AppData)` compatibility.
- JSON fallback, JSON import/export, legacy JSON migration, storage migration, and merge preview.
- API keys stored through Electron `safeStorage`; keys should not persist into AppData, SQLite, JSON exports, or logs.
- Main-process sandboxing, context isolation, CSP, navigation restrictions, single-instance lock, and controlled preload API.
- Main-process AI transport with rate limiting, exponential backoff retry, `response_format` fallback, and error redaction.
- Renderer save queue and functional save updates.
- Transactional or bundled critical writes: generation runs, accepted drafts, accepted revisions, version chain, diff, and restore.
- Context Need Planner, ContextBudgetManager, post-plan context gap closure, Prompt Priority Stack, compression, foreshadowing treatment tables, HardCanonPack, Story Direction Guide, Novelty Guardrails, Quality Gate, and Run Trace.
- Character State Ledger for location, injury, resources, inventory, knowledge, promises, and ability limits.
- Structured memory candidates that require user confirmation.
- Quality Gate pass threshold at 50 and human review threshold at 80.
- Final writing prompt foreshadowing progression limit of 10 items.
- Public release materials: MIT license, README, SECURITY, CONTRIBUTING, CHANGELOG, THIRD_PARTY_NOTICES, GitHub Actions, and release checks.

### P0: Release And Data Safety

Status: the P0 baseline is complete and should remain a hard release gate.

Keep maintaining:

1. UTF-8 / mojibake checks for docs and user-visible copy.
2. Electron sandbox, CSP, navigation restrictions, narrowed preload API, and single-instance lock.
3. Credential persistence regression checks across save, export, import, migration, SQLite, logs, and errors.
4. SQLite, JSON fallback, import/export, legacy JSON migration, and transactional-write checks.
5. Packaged app smoke checks for icon, preload API, SQLite default path, import/export, and no-key state.

Before every release:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run smoke:packaged
```

Before public release, also run a third-party secret scanner and enable GitHub secret scanning, Dependabot alerts, branch protection, and required checks.

### P1: Maintainability

Goal: reduce the remaining large files so contributors can safely work on high-frequency pages and core services.

Priorities:

1. Split `ChaptersView.tsx`.
2. Split `PromptBuilderView.tsx`.
3. Split `registerIpcHandlers.ts`.
4. Split `CharactersView.tsx`.
5. Continue splitting the page layer of `GenerationPipelineView.tsx`.
6. Split `NoveltyDetector.ts` into keyword catalog, policy helpers, name detection, scoring, and orchestration.

### P2: Context And Prompt Quality

Goal: reduce continuity drift, unhelpful context bloat, and unearned new rules.

Completed baseline:

- Context Need Planner can identify character hard-state, foreshadowing, timeline, HardCanon, and Story Direction needs with reasons and priorities.
- ContextBudgetManager has scoring, selection, trace, and compression modules.
- Prompt Priority Stack protects previous-chapter bridge, chapter task, character hard state, foreshadowing rules, and HardCanon.
- StageSummary has been narrowed to long-range plot compression.
- Writing prompts remove empty placeholders, duplicate English guardrails, and review-tone risk text.
- Foreshadowing is grouped by treatmentMode and progression is capped at 10 items.
- NoveltyDetector now separates task-authorized novelty, previously traced rule reuse, costly-but-unauthorized novelty, and unearned deus-ex rule patches.

Next:

1. Add stronger uncertainty handling to Context Need Planner.
2. Improve ContextBudgetManager dropped / unmet explanations.
3. Add prompt block preview with token estimates, source, priority, truncation, forced state, and compression state.
4. Continue improving NoveltyDetector with rule synonyms, rule targets, media/source channels, and chapter-type-specific thresholds.

### P3: Author Experience

Goal: make the complex AI workflow easier to understand and safer to use.

Priorities:

- Add a clean synthetic demo project.
- Add an old-data import wizard.
- Improve Version Chain restore copy and linked report entry points.
- Improve Revision Workbench issue provenance and rollback guidance.
- Make Run Trace author summary the default surface.
- Improve long-text editing, keyboard shortcuts, save state, and error recovery.
- Improve accessibility: focus styles, readable button labels, keyboard navigation, and contrast.

### P4: Storage And Search

Goal: let the SQLite backend provide more value while keeping AppData compatibility.

Future work:

- Add main-process read APIs for focused queries.
- Add SQLite indexes for common entity lookups.
- Add optional SQLite FTS for chapter text, summaries, character state, foreshadowing, and HardCanon.
- Keep renderer away from direct SQLite access.
- Keep JSON import/export and backups.

Not recommended yet:

- Fully relational rewrite of all AppData collections.
- Removing JSON fallback.
- Direct renderer database access.

### P5: Expansion

Long-term:

- Provider adapter matrix.
- Optional streaming and cancellation.
- Visual prompt template editor.
- Timeline, foreshadowing, relationship, and character-state graph views.
- Project package format and richer import/export.
- Code signing, release checksums, and automated release workflow.
- Optional plugin or scripting extension points.

### Not Planned Short-Term

- Cloud sync or accounts.
- Automatic AI writes into long-term memory or HardCanon.
- Remote manuscript hosting.
- Full rewrite of PromptBuilder, the generation pipeline, or the full UI.
- Replacing the lightweight rule system with large dependencies.

### Engineering Guardrails

- Local-first by default.
- Credentials stay in secure main-process storage.
- High-risk writes must be traceable, recoverable, and idempotent.
- AI output remains a candidate until the user confirms it.
- Prompt priority protects previous-chapter continuity, chapter task, character hard state, foreshadowing treatment mode, and HardCanon.
- Renderer must not directly access filesystem, SQLite, or API keys.
- Every small release should pass `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build`.

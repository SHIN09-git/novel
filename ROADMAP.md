# 路线图 / Roadmap

## 简体中文

这份路线图面向公开读者和贡献者。它描述当前仓库的真实能力、近期优先级和长期方向，不包含私有安全备注、本地开发路径或内部审计细节。

### 当前状态快照

Novel Director 目前处于 `0.1.x` 实验性预览阶段。核心架构已经从“单文件 JSON 原型”推进到“SQLite 后端 + JSON 导入导出兼容 + 事务化关键写入”的本地优先桌面工作台。

已经完成的主要能力：

- 本地优先 Electron + React + TypeScript 桌面应用。
- SQLite P0 存储后端，renderer 仍通过 `load()/save(AppData)` 兼容 API 工作。
- JSON 存储 fallback、JSON 导入导出、旧 JSON 首次迁移、数据路径迁移与合并预览。
- API Key 通过 Electron `safeStorage` 保存，持久化 AppData 前会清空明文 key。
- 保存队列与函数式 `saveData((current) => next)`，降低旧闭包覆盖新状态的风险。
- `GenerationRunBundle`：记录一次 AI 生成过程。
- `ChapterCommitBundle`：记录用户首次采纳草稿并写入正式章节。
- `RevisionCommitBundle`：记录用户接受修订后的正式版本变更。
- Prompt Builder：上下文快照、预算选择、Context Need Planner、计划后二次上下文补全、Prompt Priority Stack、伏笔 treatment mode、上下文压缩替换。
- 生产流水线：章节计划、正文草稿、章节复盘、记忆候选、一致性审稿、质量门禁、Novelty audit、Run Trace。
- Story Direction Board：未来 5/10 章中期剧情导向，可影响章节任务和最终 prompt。
- Character State Ledger MVP：追踪位置、伤势、资源、物品、知识、承诺、能力限制等硬状态。
- 修订工作台：安全局部修订合并、差异对比、版本链、事务化修订提交。
- UI 结构优化：重页面 lazy loading、拆分样式、生产流水线控制台化、侧边栏图标更新。
- 公开仓库基础文档：README、QUICKSTART、TESTING、SECURITY、CONTRIBUTING、CHANGELOG、第三方声明和 CI。

### P0：稳定性与数据安全

P0 的目标是继续保护用户正文、项目数据和本地凭据。短期内不应引入会扩大数据风险的大功能。

- 增加 SQLite 数据库损坏、迁移失败、native dependency 不可用时的用户恢复指引。
- 为 SQLite 后端补充更多真实数据 round-trip fixture，覆盖更旧版本 AppData。
- 增加“版本链恢复 / 回滚”最小 UI，让 `ChapterCommitBundle` 和 `RevisionCommitBundle` 不只可追踪，也可安全恢复。
- 评估多窗口或重复实例运行时的保存冲突保护。
- 补充 release 包的 SQLite / better-sqlite3 native dependency 验证说明。
- 继续确保 `settings.apiKey` 不进入 SQLite、JSON 导出、迁移合并结果或日志。

### P1：生成质量与长篇一致性

P1 的目标是让模型更少吃书、更少临时发明规则、更稳定地承接上一章。

- 继续改进 Context Need Planner 的场景识别、角色出场判断和 hard-state 需求推断。
- 改进 ContextBudgetManager 的相关性评分，减少低相关章节回顾挤占关键状态和伏笔规则。
- 细化 HardCanonPack：把“不可违背设定”从长篇 Bible 中抽出，降低 prompt 噪声。
- 提升 NoveltyDetector 对新规则、新系统机制、新组织层级、新命名角色的识别精度。
- 让质量门禁更好区分“合理新信息”和“机械降神式补丁规则”。
- 增强 Run Trace 的回放能力，帮助用户判断问题来自上下文、任务书、模型输出还是修订不足。
- 改进记忆候选风险提示，避免未授权新设定被误写入长期记忆。

### P2：作者体验与可用性

P2 的目标是降低复杂功能的认知负担，让真实试用更顺手。

- 为生成流水线继续做渐进式信息层级优化：当前任务、当前产物、当前风险优先展示。
- 增加 Commit History / Version Chain 面板，集中展示草稿采纳与修订提交记录。
- 将 Run Trace 从调试 JSON 进一步整理成作者可读摘要。
- 增强修订工作台的 issue 来源、diff 范围、接受风险和版本恢复提示。
- 提供更清晰的新项目向导和 synthetic demo project。
- 改进长文本编辑体验、键盘操作和无障碍可用性。
- 继续精简 StageSummary，使它只承担远期剧情压缩，不重复角色、伏笔和规划职责。

### P3：扩展能力

P3 只在 P0/P1/P2 稳定后推进。

- 多 AI provider adapter 和 provider 能力差异说明。
- SQLite 细粒度查询 API、全文搜索和可选索引。
- 更丰富的时间线、关系图、伏笔网络和角色状态图谱。
- 可配置的 prompt block 可视化与模板调试器。
- 更完整的导入导出格式与项目打包。
- 正式代码签名、自动 release checksums 和更稳定的安装包发布流程。

### 已知限制

- 当前仍是实验性预览版，数据结构通过 normalize 保持兼容，但尚未承诺长期稳定交换格式。
- SQLite 后端第一阶段仍采用“实体表 + JSON payload”策略，不是完整关系型业务模型。
- AI 输出质量取决于用户配置的 provider、模型和项目上下文质量。
- Novelty audit、质量门禁、角色状态检查仍包含启发式规则，可能误报或漏报。
- 本地优先不等于远程隐私；启用远程 AI provider 后，选中的 prompt 上下文会发送给该 provider。

### 下一版建议范围

建议下一轮小版本聚焦三件事：

1. 版本链恢复 UI：让事务化提交真正成为用户可用的安全网。
2. HardCanonPack 编辑与压缩：减少正文 prompt 中设定噪声。
3. Run Trace 作者摘要：把“为什么这一章写歪了”变成可读诊断。

---

## English

This roadmap is public-facing. It describes the current implementation, near-term priorities, and longer-term direction without exposing private security notes, local development paths, or internal audit details.

### Current Snapshot

Novel Director is currently an experimental `0.1.x` preview. The project has moved from a single-file JSON prototype toward a local-first desktop workbench with a SQLite backend, JSON import/export compatibility, and transactional writes for critical author decisions.

Completed major capabilities:

- Local-first Electron + React + TypeScript desktop app.
- P0 SQLite storage backend while keeping renderer-facing `load()/save(AppData)` compatibility.
- JSON fallback, JSON import/export, legacy JSON migration, storage path migration, and merge preview.
- API key storage through Electron `safeStorage`; plaintext keys are stripped before AppData persistence.
- Save queue and functional `saveData((current) => next)` to reduce stale-closure overwrites.
- `GenerationRunBundle` for AI generation records.
- `ChapterCommitBundle` for the user's first accepted draft commit.
- `RevisionCommitBundle` for later accepted revision commits.
- Prompt Builder with context snapshots, budget selection, Context Need Planner, post-plan gap closure, Prompt Priority Stack, foreshadowing treatment modes, and context compression replacement.
- Generation Pipeline with chapter planning, draft generation, chapter review, memory candidates, consistency review, quality gate, novelty audit, and Run Trace.
- Story Direction Board for 5/10-chapter mid-term direction that affects chapter tasks and final prompts.
- Character State Ledger MVP for hard-state tracking: location, injury, resources, inventory, knowledge, promises, and ability limits.
- Revision Workbench with safe local merge, diff view, version chain, and transactional revision commits.
- UI structure work: lazy-loaded heavy views, split styles, generation console layout, and updated sidebar icons.
- Public repository docs: README, QUICKSTART, TESTING, SECURITY, CONTRIBUTING, CHANGELOG, third-party notices, and CI.

### P0: Stability And Data Safety

P0 remains focused on protecting manuscripts, project data, and local credentials.

- Add clearer recovery guidance for SQLite corruption, migration failure, and unavailable native dependencies.
- Add more real-data round-trip fixtures for older AppData versions.
- Add minimal restore / rollback UI for `ChapterCommitBundle` and `RevisionCommitBundle`.
- Evaluate save conflict protection for multi-window or duplicate app instances.
- Document release-package validation for SQLite / better-sqlite3 native dependencies.
- Continue asserting that `settings.apiKey` never reaches SQLite payloads, JSON exports, merge results, or logs.

### P1: Generation Quality And Long-Form Consistency

P1 is about reducing continuity breaks, rule drift, and ad hoc worldbuilding.

- Improve Context Need Planner scene detection, cast planning, and hard-state retrieval.
- Refine ContextBudgetManager relevance scoring so key state and foreshadowing rules beat low-value recaps.
- Introduce a clearer HardCanonPack so immutable canon is compact and less noisy.
- Improve NoveltyDetector precision for new rules, system mechanics, organizations, ranks, and named characters.
- Help Quality Gate distinguish reasonable new information from deus-ex rule patches.
- Improve Run Trace replay so users can tell whether a bad chapter came from context, task planning, model output, or insufficient revision.
- Improve memory-candidate risk labeling so unauthorized new canon does not enter long-term memory casually.

### P2: Author Experience And Usability

P2 lowers cognitive load around complex workflows.

- Continue simplifying the Generation Pipeline around current task, current artifact, and current risk.
- Add a Commit History / Version Chain panel for accepted drafts and accepted revisions.
- Turn Run Trace JSON into more author-readable summaries.
- Improve Revision Workbench issue source, diff range, acceptance risk, and restore hints.
- Add a clearer new-project flow and synthetic demo project.
- Improve long-text editing, keyboard workflows, and accessibility.
- Keep StageSummary focused on long-range plot compression instead of duplicating characters, foreshadowing, and planning.

### P3: Expansion

P3 should wait until the data and workflow foundations are stable.

- Multiple AI provider adapters and provider capability notes.
- Granular SQLite query APIs, full-text search, and optional indexes.
- Richer timeline, relationship, foreshadowing network, and character-state graph views.
- Configurable prompt-block visualization and template debugging.
- More complete project import/export packaging.
- Code signing, release checksums, and more reliable installer publishing.

### Known Limits

- This is still an experimental preview. Data is normalized for compatibility, but the public interchange format is not yet stable.
- The SQLite backend currently uses an entity-table plus JSON payload approach, not a fully relational domain model.
- AI quality depends on the configured provider, model, and project context quality.
- Novelty audit, quality gate, and character-state checks use heuristics and may produce false positives or false negatives.
- Local-first does not mean remote-private: if a remote AI provider is enabled, selected prompt context is sent to that provider.

### Suggested Next Release Scope

The next small release should focus on:

1. Version-chain restore UI, making transactional commits directly useful to authors.
2. HardCanonPack editing and compression, reducing canon noise in final prompts.
3. Author-readable Run Trace summaries, explaining why a chapter drifted.

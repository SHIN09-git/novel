# 路线图 / Roadmap

计划复核日期：2026-09-28。最近验证本地包：`0.1.6-preview.17`。新增后端维护批次已完成：每日备份检查不再先读全库，SQLite 初始化与失败迁移可重试，旧任务恢复和 Novelty 审计去除重复计算，进度/日志/并发限流完成小修。149/149 验证脚本、类型检查、生产构建、Windows 打包及包内 SQLite smoke 通过，见 [后端性能复核](./docs/BACKEND_PERFORMANCE_REVIEW.md)。500 章主进程步骤保存 p50 为 599ms -> 1.44ms，完整保存为 1076ms -> 253ms；不把后端耗时当作 UI 或模型生成时间。下一步只按实际慢入口补定向读取与同步诊断测量，不恢复全库 CRUD/线程池等大改。

上一批收尾（2026-09-22，Preview.16）：四项收敛主线的交付范围、证据和保留边界见 [优化验收收尾](./docs/OPTIMIZATION_CLOSEOUT.md)。角色页跨角色输入与迟到保存回执误清草稿已修复，当时 144/144 验证脚本、类型检查、构建、包内 SQLite smoke 通过；实际 EXE 七页、双主题与窄窗口验收共 40 张截图。本轮后端维护没有重做该 UI 视觉验收。作者指定的 DeepSeek V4.1 Flash、上限 5 元对照，因隔离执行器无凭据按要求跳过，费用 0 元，不宣称文学质量或模型费用收益。模型名称兼容修复见 [检查记录](./docs/DEEPSEEK_FLASH_COMPATIBILITY.md)。

最新性能证据：Preview.14 的 10/100/500 章真实 EXE 操作全部通过，500 章冷启动/打开项目/编辑至已保存的 p50 为 1.54/1.58/1.61 秒。见 [长篇界面复测](./docs/PREVIEW14_LONG_NOVEL_PERFORMANCE.md)；不把历史数值差异当成本轮 UI 改造的因果收益，也不恢复已暂缓的全库重构。

完整工作包、代码边界、任务影响表和验收要求见 [全盘优化施工计划](./docs/PRODUCT_OPTIMIZATION_MASTER_PLAN.md)。该文档第三节只保留四项优先事项，第六节是当前收尾施工卡；W01-W10 仅作范围索引，不再把全部工作包列为必做，也不并列使用旧计划的 P0-P7、批次 A-F 等顺序。

## 当前方向

让作者和 Codex 顺畅完成“任务 -> 生成 -> 阅读 -> 修改 -> 采纳 -> 下一章”。保留已有 Prompt、事务保存、版本链和 Agent Runtime，以减少返工和重复操作为目标，不以增加门禁、页面或减少源码行数为目标。

| 优先顺序 | 范围 | 必须完成的结果 |
| --- | --- | --- |
| 1. 任务编辑与保存 | W06 + W01 接线 | 已完成并交付 Preview.6：九字段编辑、按影响更新上下文、通用任务校验与专用事务验证 |
| 2. 正文优先界面 | W07，回归 W02/W04 | 已完成并交付 Preview.7：三页正文优先，配置/报告折叠，双主题与窄窗口、阅读位置实测 |
| 3. Agent 创作能力 | W08，按需补 W03 | 已完成并交付 Preview.8：任务和六类世界资料管理、可撤回项目授权、逐章审阅提交、主动读取同一数据 |
| 4. 质量、费用与长篇实测 | W05/W10 + W09 | 长篇保存及 Agent 概览读取已局部优化，成本归集已验证。本轮付费对照按授权跳过，费用 0 元；只补有证据的兼容问题，不扩大为全库读取重构 |

本轮按上述收敛范围交付试用包；后续按实际试用反馈另开具体问题，不继续扩大待办。付费质量对照按作者许可跳过，不阻塞收尾。候选历史、采纳、版本恢复等已完成能力以回归为主，不重复开发。

### 降级或暂缓

- 自动时间线提取、全部旧候选入口统一：不再独立排主线，只补阻塞当前采纳或 Agent 操作的入口。
- 全站视觉改版、首用向导重做、资料/设置页美化：先让三个高频页面好用。
- 新多模型路由、默认多轮会审、全面扩充 Novelty/评分规则：实测或可复现问题证明有必要再做。
- 流式传输重写、全文/向量检索、图谱、全库 CRUD、项目级 store、为行数或 chunk 拆模块：不纳入本轮。
- 复杂权限平台、插件平台、云同步、新看板：不是 Agent 项目授权的前置条件。

事务保存、版本链、JSON 导入导出、旧数据兼容、密钥保护和发布检查不降级。新工作必须能说明解决哪个实际痛点；没有证据的不自动加入施工范围。

候选决定历史、部分选择和补偿撤销已在第五批本地试用中交付；具体范围见 [W03 试用记录](./docs/OPTIMIZATION_W03_TRIAL.md)。旧直接保存入口、项目授权、任务编辑和真实模型效果对照不能被该批验收替代。

### 当前施工状态

最新界面收尾：Preview.16 已同步安装包和 unpacked；角色页按项目和角色保留页内事实、日志、转换草稿，保存回执只清理本次实际提交且未再修改的输入。12 项行为回归、实际包 40 张截图通过，主题通过真实设置页保存后验证，见 [角色输入验收](./docs/UI_HIG_CHARACTER_DRAFTS.md)。Preview.14 的角色搜索与页签见 [角色工作区验收](./docs/UI_HIG_CHARACTER_WORKSPACE.md)；Preview.13 的项目入口、Prompt 页签等见 [作者工作区验收](./docs/UI_HIG_AUTHOR_WORKSPACE.md)。下面的旧版本数字只代表各批当时的结果，不是当前缺项。

后续 Agent 概览优化：四个项目入口仅读取所需集合，500 章项目摘要 p50 从 397ms 降到 32ms，输出逐轮一致。完整读取和界面刷新未改，不宣称同步变快；135/135 脚本、类型检查、生产构建、Preview.10 打包与 SQLite smoke 通过。原始数据、旧记录兼容和 MCP 重连说明见 [Agent 概览实测](./docs/OPTIMIZATION_AGENT_OVERVIEW_READ.md)。

第四项新进展：500 章样本的步骤保存 p50 从 393ms 降到 1ms，编辑保存从 826ms 降到 309ms，保留完整 API、事务与历史。匹配驱动的实际 Preview.9 包内对照：编辑到已保存从 2.10s 降到 1.56s，返回项目从 1.57s 降到 1.01s；启动和 Agent 刷新未明显改善，全量读取仍约 400ms。成本归集沿正式版本链去重，缺失遥测明确标记未知。134/134 脚本、类型检查、构建、打包与 SQLite smoke 通过。详见 [W09/W10 实测记录](./docs/OPTIMIZATION_W09_W10_MEASUREMENT.md)。

第一项的代码和生产 Electron 操作验收已完成。作者可以直接修改本章九项任务，保存为新运行而不调用模型；表达/篇幅小改按条件复用计划和事实切片，情节变化重新准备上下文。旧草稿、报告和手动快照保留；保存队列校验来源，避免新上下文基于已变化的资料落盘。具体边界见 [W06 试用记录](./docs/OPTIMIZATION_W06_TRIAL.md)。

第二项三页正文优先布局已交付 Preview.7。新布局、目录坐标和阅读位置的生产/包内验收范围见 [W07 试用记录](./docs/OPTIMIZATION_W07_TRIAL.md)。

2026-09-07 新结果：第三项已交付 Preview.8，类型检查、131/131 验证脚本、生产构建、Windows 打包和 SQLite smoke 通过。生产 Electron 与实际 unpacked 授权页各通过 60 项检查、22 张截图；五章顺序旅程含暂停恢复和作者中途更新，使用 21 次本地模拟响应。重复提交、撤回和 HardCanon 来源去重已回归。见 [W08 试用记录](./docs/OPTIMIZATION_W08_TRIAL.md)。下一项仅测最终采纳质量/成本与 10/100/500 章性能；不把 mock 创作当成真实文学质量结论。

## English Current Direction

Current verified local package: Preview.17 (2026-09-28), with measured backend optimization, safer backup publication and SQLite initialization, all 149 scripts, typecheck, build, Windows packaging and packaged SQLite smoke passing. See the [backend review](./docs/BACKEND_PERFORMANCE_REVIEW.md). Targeted reads and synchronous diagnostic hotspots remain follow-up work, not a broad CRUD or worker-pool rewrite.

The previous Preview.16 UI batch (2026-09-22) passed 144 scripts and actual executable QA across seven routes, both persisted themes and narrow windows in 40 screenshots; see the [character draft record](./docs/UI_HIG_CHARACTER_DRAFTS.md). Those screenshots were not rerun for this backend-only round. The narrowed round is delivered within the limits in the [closeout matrix](./docs/OPTIMIZATION_CLOSEOUT.md). The author specified DeepSeek V4.1 Flash and a CNY 5 cap; paid comparison was skipped as permitted because the isolated runner has no credential. Historical milestones below remain evidence, not unfinished tasks.

The fourth priority now has real 10/100/500-chapter storage/UI measurements, differential snapshot writes, job-scoped checkpoint validation and accepted-chapter accounting. A follow-up scopes four Agent overview reads: 500-chapter digest median 397ms -> 32ms, with identical responses and 135/135 scripts passing. Full-detail reads and desktop refresh remain unchanged. See the [overview measurement](./docs/OPTIMIZATION_AGENT_OVERVIEW_READ.md); Preview.9's actual packaged long-novel workflows remain in the [earlier record](./docs/OPTIMIZATION_W09_W10_MEASUREMENT.md). No paid quality/cost conclusion is claimed this round.

See the master plan for four priorities: task editing and bundle-save integration; prose-first pipeline, revision and reading UI; Agent world-management and project grants; measured quality/cost and long-novel performance. These are delivered within the closeout scope, with paid comparison explicitly skipped rather than claimed. Preview.8 authorization QA and its five-chapter local-mock journey remain earlier evidence; subsequent releases add measured persistence improvements. Broader full-read work remains deferred, not a new completion requirement.

Automatic timeline extraction, exhaustive legacy cleanup, site-wide redesign, new routing, streaming, search/graphs and broad storage refactors are deferred, not hidden release requirements. Fix demonstrated blockers, reuse completed features, and retain persistence, version-history, credential and compatibility checks.

Reuse completed capabilities. Creative disagreements remain director decisions; failed persistence and stale writes remain technical errors. The linked W06 record distinguishes source, production-preview and packaged evidence; historical counts below are not current results.

## 历史实施与检测记录

以下保留既有批次和检测原文，便于核对当时的范围。旧记录中的“下一批”“尚未实现”和数字仅适用于其标注日期；当前待办以本页上方和全盘计划为准，不按历史顺序重复施工。

<details>
<summary>展开历史施工与验证记录（不作为当前待办）</summary>

### 首批施工进展（2026-09-06）

- 共享候选预览与真正入账目标/结果保持一致，来源不明的旧报告不会冒充当前通过结果。
- 修订页候选正文和接受按钮前置，首次修订前正文可在版本历史中恢复。
- 直接 AI 重写新增“取消本次”，按章节/修订对象隔离迟到结果；真实 Electron 的本地请求取消与再次重写已通过。
- 设置页新增可折叠运行信息，区分程序版本、构建时间和运行位置。
- 下一批优先补显式未审稿采纳、候选编辑后接受、阅读位置恢复；完整 M1-M3 与 W01-W10 范围不变。

English: The first integration batch adds accurate candidate previews, candidate-first revision layout, restorable pre-revision snapshots, per-call rewrite cancellation and runtime identity. The full roadmap remains active; see the linked trial record for current verification and artifact status. A local trial is not a published GitHub release.

### 第二批施工进展（2026-09-06）

- 未完成审稿时可由作者明确采纳，提交和历史显示真实状态；失败审稿步骤不再挡住已采纳章节的下一章入口。
- 收件箱支持类型化编辑后接受，取消不落盘，保留原建议与实际采用值。修复余额重复扣减、空数字归零等问题。
- Agent 对应预览/接受共用现有事务命令；可执行修改不因 compact 截断，敏感返回脱敏并标记。高风险项目授权仍未完成。
- 首份当前版本正确计入已保存历史，紧凑窗口的版本标题与状态标签不再互相挤占。
- `0.1.6-preview.2` 已本地打包；108/108 验证脚本、127/127 采纳检查和 22 项 Agent 候选检查通过。生产 Electron 与实际 unpacked 各通过 16 项旅程检查，使用隔离数据。
- 下一批进入 W04 阅读位置返回、旧要求重新定位、快捷改写结果保留；专项候选、授权、全站界面和长篇性能工作继续推进。

English: Preview.2 is locally packaged and verified, adding explicit unreviewed acceptance, edited candidate decisions and reliable continuation after acceptance. Full scope remains active. See the second trial record for exact evidence; installer lifecycle, signing and GitHub publication are not claimed.

---

## 简体中文

### 历史检测基线（2026-09-05）

本轮重新检查了：

- `package.json` 与 `scripts/run-tests.mjs`
- 核心存储、IPC、preload、AI 调用、安全与发布脚本
- 生成流水线、PromptBuilder、Context Need Planner、ContextBudgetManager、NoveltyDetector、QualityGate
- 公开文档与最大源码文件体量

当时记录的验证基线（不是本次规划重跑结果）：

- `npm.cmd run typecheck`：通过
- `npm.cmd test`：通过，当前 72 个验证脚本
- `npm.cmd run build`：通过
- `validate-no-mojibake.mjs`：通过
- `validate-release-p0-readiness.mjs`：通过
- `validate-electron-security-p0.mjs`：通过
- `validate-sqlite-storage.mjs`：通过
- `validate-novelty-guardrails.mjs`：通过

当前较大的源码文件约为：

- `src/renderer/src/views/ChaptersView.tsx`：约 453 行（正文状态机与 AI 协调已拆分）
- `src/renderer/src/views/revision/revisionStudioActionHandlers.ts`：约 438 行
- `src/renderer/src/views/PromptBuilderView.tsx`：约 418 行
- `src/renderer/src/views/generation/pipelineSteps/chapterGeneration.ts`：约 383 行
- `src/services/PromptBuilderService.ts`：约 381 行（格式化职责已拆分）
- `src/renderer/src/views/CharactersView.tsx`：约 373 行

结构性进展：

- `src/shared/types.ts` 已拆成 `src/shared/types/*`，原文件保留兼容导出。
- `src/shared/defaults.ts` 已拆成 `src/shared/defaults/index.ts` 与 `src/shared/normalizers/*`，原文件保留兼容导出。
- 上下文规范化已进一步拆成预算、需求计划、基础枚举兼容和选择/trace 四个纯模块；原 `normalizers/context.ts` 从约 459 行降为 6 行兼容门面，并由模块化行数门禁保护。
- `PromptBuilderService.ts` 已拆出 `src/services/promptFormatters/*`。
- `ContextBudgetManager.ts` 已拆出评分、选择、预算收尾和 trace 模块；主协调器约 257 行，结构化省略与预算裁剪集中在 `selectionFinalizer.ts`。
- 生成流水线执行器已拆成 `pipelineRunnerEngine.ts`、`pipelineRunnerTypes.ts` 和 `pipelineSteps/*`，`usePipelineRunnerCore.ts` 已降到可维护体量。
- 生产流水线的执行引擎、修订动作、生成记录聚合、草稿提交、记忆候选动作和作者诊断摘要已改为按需加载；`GenerationPipelineView` 生产 chunk 从 179.61 kB 降至 82.98 kB，减少约 53.8%，且生成、重试、修订与事务保存仍由完整回归测试覆盖。
- 章节创作台的 AI 草稿、复盘、版本历史、版本恢复和角色/伏笔候选写入已按使用时机拆分；正文缓冲保存与 AI 草稿协调也已移入独立 Hook。加入外部正文冲突状态机后，`ChaptersView` 生产 chunk 为 50.03 kB，仍比最初 83.35 kB 低约 40%。
- 连贯阅读页已从约 474 行降至约 290 行；滚动定位、章节横栏、正文分段偏移、AI 重写菜单分别由独立 Hook/组件/纯工具维护。初始章节只定位一次，正文更新不再把读者拉回入口章节；横栏显示真实章序，未保存的行内编辑离开前会确认，直接 AI 重写支持一次安全撤销。
- 角色页已从约 469 行降至约 395 行，状态日志与转换表单由独立面板维护。切换角色会清理上一角色的日志草稿并恢复“仅记录日志”安全默认；状态事实输入使用去除显示单位的缓冲值，避免逐键完整保存及资源数值被误解析为 `0`。
- 章节 AI 操作现在严格使用当前 `bodyDraft`；作者主动清空正文后立即复盘或提取时，不会再因 truthy fallback 误用保存前的旧正文。
- 当前章节被流水线采纳、历史恢复或其他入口更新时，编辑器会区分干净同步、保存确认和真实分叉；发生分叉会暂停自动保存并让作者选择最新正文或明确覆盖。切换章节后的迟到 AI 响应也不会再写入新章节面板。
- 修订工作台已拆成约 284 行协调器、来源侧栏和版本对比面板；动作层进一步分成共享类型、AI 生成动作与正式版本动作。生产构建中主 chunk 为 35.52 kB，生成/版本动作分别为 9.51/10.39 kB；生成候选不再加载 `RevisionCommitBundleService`，复制、拒绝和正式接受也不再加载 AI 生成实现。编辑正文仍会在接受、切换版本或切换来源前先落盘。
- 数据合并核心已拆出集合清单、实体判等/冲突工具、引用重映射和数据文件备份层；`DataMergeService.ts` 从 655 行降至 346 行。合并写入后会返回同一次读取的完整 data/revision 快照，避免并发写入窗口产生不一致快照。
- SQLite 后端已拆出 schema、实体索引映射和三类 bundle entry 规划模块；`SqliteStorageService.ts` 从 675 行降至 390 行。bundle 的 revision 校验、当前数据读取、引用校验与 upsert 现在位于同一个短事务内，且成功加载后的 `better-sqlite3` 构造器会复用，减少重复 native 探测。
- Agent 可读摘要已拆成 160 行稳定门面，以及项目、章节诊断、版本链和长文本读取模块；原服务从 651 行降至 160 行。Agent 现在复用 UI 的正式版本链语义，可显式读取归档章节，并按 project/job/chapter 严格限定诊断报告，避免跨项目结果污染。
- `PromptBuilderView.tsx` 已从约 566 行降至 446 行。上下文需求、衔接、角色选择和历史动作已拆为独立组件/Hook；载入上下文快照会恢复任务书、模式、模块、预算、选择集和衔接设置，需求计划移除角色或禁止伏笔时也会同步显式选择，避免被预算选择器重新强制纳入。
- `ContextNeedPlannerService.ts` 已把角色点名窗口分析和角色需求切片拆到两个纯模块，主服务从约 424 行降至 343 行。需求计划现在区分“仅被提及 / 预计在场 / 必须行动”和“是否必须核对状态”；Story Direction 或伏笔弱关联产生的 uncertain 角色只参与评分，不再被预算器强制纳入。
- `SettingsView.tsx` 已从约 549 行降至 73 行协调器。凭据、数据路径/导入导出、备份/日志分别由独立控制器管理；高风险操作有 busy 防重复、可读错误反馈和保存失败边界，API Key 安全存储成功但元数据同步失败时不会再伪报完整成功。
- `AIResponseNormalizer.ts` 已从约 517 行降为 4 行兼容门面，章节/伏笔、角色状态、质量/修订和基础值规范化拆成 4 个纯模块，最大领域实现约 194 行；现有调用 import 保持不变。
- NoveltyDetector 已拆出策略、命名实体、关键词、逐次扫描、语义关联和 finding 构建模块，主编排器降至约 232 行；任务书许可、已有上下文/HardCanon、同义规则、来源媒介、章节模式、数量上限、关联代价和危机解除方式共同决定风险等级。
- `CharacterStateService.ts` 已降为约 68 行兼容门面，日志推断、状态选择、规则校验和值/事务变更分开维护。候选写入会校验 project/character 归属，多条物品事实会聚合，知识泄露判断不再把“已知事实”反向误报。
- `QualityGateService.ts` 已降至约 143 行编排器。结构化角色状态、本地连续性/伏笔/长度/冗余硬规则现在无论 AI 报告是否存在都会执行，并复用流水线同一份 NoveltyAuditResult，避免门禁与 Run Trace 结论分叉。
- `AgentToolService.ts` 已降为约 50 行稳定门面，工具定义、严格参数校验、只读查询和事务写入分别维护。Agent 显式请求 `full` 时会获得脱敏后的完整正文/Prompt，只有显式 `maxChars` 才截断；默认读取仍保持摘要模式。
- `RunTraceAuthorSummaryService.ts` 已拆出来源查找、通用诊断和上下文诊断模块，主编排器约 315 行。报告关联必须同时匹配 project/job；任务书已授权的 info 级新信息只保留 trace，手动排除和快照固定也不会被误报成系统漏选。
- 质量门禁、Novelty Audit 和冗余诊断已收敛到 main process diagnostics IPC；renderer 侧不再保留重型服务动态 fallback。
- 写作 Prompt Guard 已升级为运行时防护：清理占位符、重复禁令和审稿口吻，并把有价值的风险提示转译成当前写作限制。
- 数据迁移合并已增加仅作用于源记录的类型化引用重映射，覆盖嵌套/前向 ID、以 ID 为键的字典和旧数据跨集合 ID 碰撞，同时不改写目标库原有记录。
- UI、preload、SQLite/JSON 存储与 Agent Runtime 已共享乐观 revision 保护；旧快照的 full save 或 bundle save 会被拒绝，不再覆盖另一进程刚写入的数据。
- revision 冲突会在项目页和项目列表显示全局恢复提示；作者确认后通过同一保存队列重新加载最新数据，不会自动把旧内存写回磁盘。
- GenerationRun / ChapterCommit / RevisionCommit 的 IPC 写入失败不再被 renderer 静默降级成完整 AppData 保存；只有旧 preload 确实缺少对应 API 时才允许兼容回退，事务校验与 revision 冲突不能再被绕过。
- ChapterCommit 现在同时保存被替换的提交前快照和正式采纳版本；旧提交仍可在版本链中查看和恢复，正式提交版本受到删除保护。
- RevisionCommit 与 ChapterCommit 增加不可变性、引用一致性和 stale baseline 校验，重复接受保持幂等，旧正文不能覆盖已更新章节。
- ChapterCommit 与 RevisionCommit 现已复用同一组提交不变量：稳定幂等 upsert、完整提交不可变校验、项目归属和跨项目同 ID 防覆盖。构建器按 project/job/chapter 限定报告、草稿、trace 和版本来源；AI 辅助修订会正确记录为 `user_with_ai_revision`，不会再误标为纯 AI 修订。
- ChapterCommit 与 RevisionCommit 的纯校验已进一步拆到 `commitBundles/*Validation.ts`；公开服务分别降至约 266/238 行，只负责构建、委派校验和内存应用。模块化门禁锁定了主服务与校验器体量，SQLite/JSON 事务入口和 renderer API 保持不变。
- 章节正文的 debounce 保存现在会跟踪待写内容；章节切换、定时保存失败和组件卸载均不会静默丢弃最后一次编辑。
- 最终 `promptBlockOrder` 会按运行时 Prompt Guard 清理后的正文重新计算 included/tokenEstimate；冲突优先级声明已显式纳入 HardCanon 与 Story Direction。
- 章节删除已替换为可逆归档：正文、版本链、提交和诊断记录继续保留；阅读、Prompt、预算选择、生成目标和 Agent 常规读取只使用活跃章节。恢复时若原章序已被占用，会安全移动到末尾。
- UI 与 Agent Runtime 共用 `ChapterLifecycleService`；Agent 可查询、归档和恢复章节，高风险动作要求显式确认，下一章序不会复用归档章序。

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
- JSON 导入已区分安全合并与确认覆盖：非空工作台默认保留当前数据，无法自动解决的冲突在写入前停止；覆盖前创建恢复备份，外部文件中的旧 API Key 一律忽略。导入、完整保存和事务 bundle 共用 renderer 串行队列，不再把主进程已持久化的导入结果重复完整保存一次。
- 备份恢复、数据路径迁移、恢复默认路径和合并迁移也已接入同一 renderer 操作队列；主进程成功落盘后只采纳返回快照，不再通过 `replaceData` 做第二次完整保存。
- 章节页支持归档与恢复，不再通过硬删除制造不可达版本历史。

### P0：发布与数据安全回归

状态：P0 基线已完成，后续作为每次发布前的硬门禁维护。

继续保持：

1. 文档和用户可见中文文案保持 UTF-8，无 mojibake。
2. Electron sandbox、CSP、导航限制、preload API 收敛和单实例锁保持开启。
3. API Key 不落盘回归持续覆盖保存、导出、导入、迁移、SQLite、日志和错误路径。
4. SQLite、JSON fallback、导入导出、旧 JSON 迁移、事务写入保持验证。
5. UI 与 Agent 并发写入持续验证 revision 冲突会阻止旧 AppData 或旧 bundle 覆盖新数据。
6. 数据合并持续验证项目 ID 冲突、嵌套提交对象、Prompt 快照和版本链引用不会跨项目串联。
7. Windows packaged smoke test 持续验证图标、preload API、SQLite 默认路径、导入导出和无 API Key 状态。
8. 导入安全回归持续验证合并不覆盖现有项目、冲突不写入、覆盖需确认、导入凭据不进入 safeStorage，以及导入、备份恢复、路径迁移与其他写入严格串行。

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

1. 已完成 `RevisionStudioView.tsx` 的协调器、侧栏、版本对比及生成/版本双 lazy boundary 拆分；架构门禁明确禁止 AI 生成路径重新依赖正式提交服务，也禁止版本动作重新承载 AI 生成行为。继续用回归测试锁定编辑内容先落盘、局部修订安全合并和 `RevisionCommitBundle` 正式提交语义。
2. 已完成 `DataMergeService.ts` 的集合元数据、实体冲突、引用重映射和文件备份边界拆分；继续用完整集合覆盖、SQLite/JSON 合并和 revision 冲突测试保护导入兼容性。
3. 已完成 `SqliteStorageService.ts` 的 schema、实体索引序列化和三类 bundle entry 规划拆分；继续用 rollback、旧 JSON 迁移、密钥不落盘和并发 revision 测试保护 main-process-only 事务边界。
4. 已完成 `AgentReadableSummaryService.ts` 的项目摘要、章节诊断、版本链和长文本读取拆分；继续保持 CLI/MCP 门面稳定，并用归档章节读取、跨项目诊断隔离和敏感文本脱敏测试保护代理信息权。
5. 已完成 `PromptBuilderView.tsx` 的上下文需求、衔接、角色选择和历史动作拆分；继续用快照完整恢复、显式选择同步和 Prompt Guard 回归保护其状态语义。
6. 已完成 `NoveltyDetector`、`CharacterStateService`、`QualityGateService`、`RunTraceAuthorSummaryService` 与 `AgentToolService` 的领域边界拆分，并将最大行数和委派关系加入 `validate-core-modularization.mjs`，防止重新合并成巨型服务。
7. 已完成 `ReadingView.tsx`、`CharactersView.tsx` 与 `ChaptersView.tsx` 的首轮状态/协调拆分；章节正文冲突保护、AI 响应代际隔离和章序交换规则已有独立回归。后续如继续收窄 473 行章节协调器，应优先抽离纯展示装配，而不是拆散已经清晰的状态边界。
8. 控制 `ChaptersView` 当前约 50.03 kB 的编辑首屏边界；AI 草稿、复盘、版本历史和候选写入不得重新静态并入正文编辑路径，并优先通过交互性能测量判断是否值得继续拆包。
9. `GenerationPipelineView` 当前约 83.11 kB，仍是最大的业务页面 chunk。依赖图复核显示 `promptContext.ts` 本体仅约 150 行，其 113.60 kB 共享 chunk 主要来自同阶段确实需要的 `PromptBuilderService` 与 `ContextBudgetManager`；继续优化前应先测量控制台首开和步骤切换延迟，不为 chunk 数字机械碎片化共同执行路径。
10. 已完成 `ChapterCommitBundleService.ts` 与 `RevisionCommitBundleService.ts` 的共享不变量和纯校验器拆分；继续用项目隔离、不可变提交、stale baseline、SQLite rollback 和版本链恢复回归保护正式写入语义。
11. 如果后续需要严格审计章节生命周期，再引入轻量 `ChapterLifecycleCommit`；当前归档已具备原子保存、revision 冲突保护和恢复能力，不应为尚未出现的审计需求提前扩张 schema。

### P2：上下文与 Prompt 质量

目标：让模型更少吃书、更少临时发明规则、更稳定承接上一章。

已完成基础：

- Context Need Planner 能识别角色硬状态、伏笔、时间线、HardCanon、Story Direction 需求，并能给出 reason 与 priority。
- 角色需求已显式区分提及、在场、必须行动和状态核对；uncertain 候选会保留在 selection trace，但不会被升级成确定缺口或强制挤入 prompt。
- ContextBudgetManager 有评分、选择、trace 和压缩模块。
- Prompt Priority Stack 已将上一章衔接、本章任务、角色硬状态、伏笔规则和 HardCanon 前置。
- StageSummary 职责已收窄为远期剧情压缩背景。
- 写作 Prompt 已去除空字段、占位符、重复英文 guardrail 和风险审稿口吻。
- 运行时 Prompt Guard 会在最终正文 prompt 生成后执行 lint，阻止诊断文字回流，并在 Run Trace 中记录 prompt lint 结果。
- 伏笔按 treatmentMode 分组，可推进数量限制为 10。
- Context selection 已使用结构化 reason code 区分预算不足、低相关、压缩替代、规则禁止、用户排除、数量上限、配置过滤、状态不适用、快照固定和来源缺失。
- 最终 Run Trace 会按 Prompt Guard 后的真实 prompt 复核角色状态事实与 HardCanon 条目；只存在于当前账本、但没有进入冻结快照或最终 prompt 的内容不再被误记为已纳入。
- 计划后二次补选不再把 uncertain 角色或计划要求伏笔伪装成手动强选；确认在场的角色仍受保护，纯提及候选只参与评分。
- Run Trace Inspector 已加入 Prompt block 预览与运行时契约回放：按最终顺序展示 token、来源、权威级、forced、compressed、遗漏原因和高优先级未满足需求，不复制完整 Prompt 或正文。
- 快照或旧 Prompt 缺失 Bridge 时，流水线会在本章任务契约之前补入；优先级声明中的“上一章结尾衔接”文字不再被误判为真实 Bridge 区块。
- 已移除无入口的旧 Run Trace 面板，作者摘要、Novelty 审计、压缩记录、forced context 和高级 JSON 统一收敛到实际使用的 Inspector。
- NoveltyDetector 已能区分：
  - 任务书许可的新信息；
  - 已在上下文或伏笔中出现的规则复用；
  - 通过系统提示、广播、票据、公告、环境线索等合理媒介出现的新规则；
  - 新副本开场、揭露章和高潮解法章的不同风险阈值；
  - 带明确代价/限制的新规则；
  - 未授权、无铺垫、无代价且刚好解围的机械降神式规则补丁；
  - 编号管理员/组织层级与普通命名角色。
- Novelty 语义层会扫描同一关键词的每次出现，识别同义规则、作用/受益对象、危机线索、解除动作、来源媒介和与规则直接关联的代价；普通系统面板、物理距离、感官“源头”和日常汇报不再被默认当成新机制。
- Novelty 中文匹配已改为 NFKC offset 映射、词典 Trie 单次扫描和 `Intl.Segmenter` 中文边界；`管理员工位`、`总部署`、`回收站台`、否定句、被否认引用及专名不再因裸子串误报。160,000 字 synthetic 样本 p50 从约 4.47s 降到约 0.21s，完整原始基线见 `docs/PERFORMANCE.md`。
- 生产性能测量已覆盖 Electron 进程冷启动、项目工作台、生产流水线首次/缓存进入、Prompt 构建器重型边界以及 Novelty 三档语料。UI 时延作为观测基线，算法级长文本预算作为稳定门禁，不再用源码行数或 chunk 大小替代真实性能。
- Quality Gate 与 Run Trace 会保留结构化 Novelty 证据；附近无关的“代价”“档案”不能再替临时救命规则降级。
- 同一危机补丁只生成一个主机械降神 finding；质量门禁、记忆候选风险和 Run Trace 共用复核汇总策略，不再为同一事件重复堆叠普通规则告警。
- 章节号/范围解析已提升为 shared 纯工具；伏笔页改用 3.81 kB 的轻量推荐模块，不再因“预计回收章节”筛选拉入 PromptBuilder 与 ContextBudgetManager。`promptContext` 共享 chunk 从约 116.69 kB 降至 113.60 kB。

下一步：

1. 用可公开的 synthetic 章节语料持续校准 NoveltyDetector，并把题材特有词汇做成可维护配置；避免为单部小说不断扩张全局关键词表。
2. 为作者确认过的误报/漏报设计轻量反馈记录，但不要直接自动改写 HardCanon 或长期记忆。

### P3：作者体验

目标：降低复杂 AI 工作流的认知负担，让真实写作更顺。

优先方向：

- 提供干净的 synthetic demo project，避免首次打开完全空白。
- 安全合并/确认覆盖的旧 JSON 导入基础已完成；下一步做恢复向导，自动发现旧 JSON、旧 SQLite、备份文件和常见数据目录，并为无法自动合并的冲突提供只读详情。
- 优化 Version Chain 恢复说明，让作者明确“恢复会创建新版本，不会删除当前正文”。
- 优化 Revision Workbench 的 issue 来源、diff 范围、接受风险和回滚入口。
- 让 Run Trace 作者摘要成为默认阅读入口，原始 JSON 作为高级详情。
- 继续改善长文本编辑体验：连续阅读定位、未保存离开保护、快速重写撤销和章节正文保存状态已完成；下一步补章节内搜索和键盘快捷键。
- 继续增强冲突恢复：在重新加载前列出各页面尚未提交的字段，并支持逐项复制或重新应用。
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
- 可选流式输出、步骤内更细粒度进度和更细粒度重试策略。
- Prompt 模板可视化编辑器和调试器。
- 时间线图、伏笔网络、角色关系图和角色状态图谱。
- 项目打包格式和更完整的导入导出协议。
- 正式代码签名、release checksums 和自动发布流水线。
- Agent Runtime / CLI / MCP 工具入口，让 Codex 不读取 UI 也能调度同一套生产流水线、诊断、提交和版本链。
- Agent 单章流水线已支持复用原 AgentRun/Job，从首个失败或未完成步骤恢复；已完成 Job 拒绝重复重试，避免重复草稿与诊断记录。
- Agent 长请求已支持结构化进度查询与跨工具取消；取消使用独立控制通道终止当前 AI 请求，不与完整 AppData 保存竞争，并保留可恢复步骤。
- 可选插件或脚本扩展点。

参考：[AI 代理运行层施工计划](./docs/AGENT_RUNTIME_PLAN.md)。

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

Last reviewed: 2026-07-15.

This roadmap reflects the current repository, validation scripts, public documentation, and this review pass. It is public-facing and avoids local paths, private manuscripts, real credentials, and internal sensitive details.

### Review Summary

This pass reviewed:

- `package.json` and `scripts/run-tests.mjs`
- Storage, IPC, preload, AI transport, security, and release scripts
- Generation Pipeline, PromptBuilder, Context Need Planner, ContextBudgetManager, NoveltyDetector, and QualityGate
- Public documentation and largest source files

Current validation baseline:

- `npm.cmd run typecheck`: passing
- `npm.cmd test`: passing, currently 66 validation scripts
- `npm.cmd run build`: passing
- `validate-no-mojibake.mjs`: passing
- `validate-release-p0-readiness.mjs`: passing
- `validate-electron-security-p0.mjs`: passing
- `validate-sqlite-storage.mjs`: passing
- `validate-novelty-guardrails.mjs`: passing

Largest remaining source files include:

- `ChaptersView.tsx`: about 453 lines, with prose state and AI coordination delegated
- `revisionStudioActionHandlers.ts`: about 438 lines
- `PromptBuilderView.tsx`: about 418 lines
- `pipelineSteps/chapterGeneration.ts`: about 383 lines
- `PromptBuilderService.ts`: about 381 lines, with formatting delegated

Structural progress:

- Shared types and defaults have been split into domain modules with compatibility exports.
- Prompt formatting and context budget logic have been split into focused modules. `ContextBudgetManager.ts` is now a roughly 257-line coordinator over scoring, selection, finalization, and trace construction.
- The generation pipeline runner has been split into an engine, shared runner types, and phase-specific step handlers.
- The pipeline engine, revision actions, run-bundle assembly, draft commits, memory-candidate actions, and author diagnostics now load on demand. The production `GenerationPipelineView` chunk fell from 179.61 kB to 82.98 kB, a reduction of about 53.8%, while generation, retry, revision, and transactional persistence remain covered by the full regression suite.
- Chapter AI drafts, review fields, version history, restore actions, and character / foreshadowing candidate writes load only when used; buffered prose persistence and AI draft coordination now have focused hooks. With the external-update conflict state machine included, the production `ChaptersView` chunk is 50.03 kB, still about 40% below its original 83.35 kB.
- The continuous reader fell from about 474 to 290 lines. Scroll tracking, chapter rails, prose offsets, and the shared AI rewrite menu now have focused hooks/components/helpers. Initial navigation runs once, chapter prose updates no longer reset reading position, rail labels use real chapter order, unsaved inline edits are guarded, and direct AI rewrites offer a safe one-step undo.
- The character view fell from about 469 to 395 lines by delegating state logs and conversion forms. Character switches clear stale log drafts and restore log-only mode; state-fact editors debounce raw values without display units, preventing per-keystroke full saves and accidental numeric coercion to zero.
- Chapter AI actions now use the current `bodyDraft` even when it is intentionally empty, so clearing prose can no longer fall back to stale saved text during review or extraction.
- When pipeline acceptance, version restore, or another path updates the active chapter, the editor distinguishes clean synchronization, save acknowledgement, and true divergence. Divergence pauses autosave and asks the author which body to keep; late AI responses after chapter navigation are discarded.
- The revision workbench now uses a roughly 284-line coordinator plus source and comparison panels, while its actions are split into shared types, AI generation, and formal version operations. The production main chunk is 35.52 kB and the generation/version action chunks are 9.51/10.39 kB. Candidate generation no longer loads `RevisionCommitBundleService`, and copy/reject/formal acceptance no longer load AI-generation behavior; edits still flush before acceptance or navigation.
- The data-merge core now separates collection metadata, entity equality/conflict helpers, reference remapping, and data-file backup/storage. `DataMergeService.ts` fell from 655 to 346 lines, and post-merge reads now return a coherent data/revision snapshot from the same load.
- The SQLite backend now separates schema setup, indexed entity mapping, and bundle-entry planning. `SqliteStorageService.ts` fell from 675 to 390 lines. Bundle revision checks, current-data reads, reference validation, and upserts now share one short transaction, while a successfully loaded `better-sqlite3` constructor is cached to avoid repeated native probes.
- Agent-readable summaries now use a 160-line stable facade plus project, chapter-diagnostics, version-chain, and long-text reader modules. The service fell from 651 to 160 lines. Agent reads now reuse the UI's formal version-chain semantics, support explicit archived-chapter reads, and strictly scope diagnostics by project/job/chapter to prevent cross-project contamination.
- `PromptBuilderView.tsx` fell from about 566 to 446 lines. Context needs, continuity, character selection, and history actions now have focused components/hooks. Loading a context snapshot restores task, modes, modules, budget, selections, and continuity settings, while need-plan removals stay aligned with explicit selection.
- `ContextNeedPlannerService.ts` now delegates character mention-window inference and character need-slice assembly to two pure modules, reducing the coordinator from about 424 to 343 lines. Needs distinguish mention-only, expected presence, required action, and state checks; uncertain Story Direction or foreshadowing candidates are scored without becoming forced context.
- `SettingsView.tsx` fell from about 549 lines to a 73-line coordinator. Credentials, storage/import-export, backup, and logs use focused controllers with busy guards, readable error states, and explicit persistence-failure handling. Credential metadata sync can no longer be reported as fully successful when its AppData save fails.
- `AIResponseNormalizer.ts` fell from about 517 lines to a four-line compatibility facade. Primitive, chapter/foreshadowing, character-state, and quality/revision normalization now live in four pure domain modules, the largest of which is about 194 lines, without changing existing import paths.
- Novelty detection now uses focused policy, name, keyword, occurrence scanning, semantic-linking, and finding modules behind a roughly 232-line orchestrator. Chapter permission, known context/HardCanon, rule synonyms, source media, chapter mode, quotas, linked costs, and crisis resolution all affect severity.
- `CharacterStateService.ts` is now a roughly 68-line compatibility facade over log inference, prompt selection, validation, value handling, and mutations. Candidate ownership is checked, inventory facts aggregate correctly, and known information no longer causes reversed knowledge-leak findings.
- `QualityGateService.ts` is now a roughly 143-line orchestrator. Deterministic state, continuity, foreshadowing, length, and redundancy rules always run even when an AI evaluation exists, and the pipeline's NoveltyAuditResult is reused instead of recomputed independently.
- `AgentToolService.ts` is now a roughly 50-line stable facade over definitions, strict argument parsing, reads, and transaction-backed writes. Explicit full reads return complete redacted prose/prompts unless the caller supplies `maxChars`; compact defaults remain unchanged.
- `RunTraceAuthorSummaryService.ts` now delegates source lookup, shared diagnostics, and context diagnostics; its coordinator is roughly 315 lines. Linked reports must match project/job, task-authorized info novelty stays traceable without becoming a false risk, and manual exclusions or frozen snapshots are no longer mislabeled as automatic selection failures.
- Quality Gate, Novelty Audit, and redundancy diagnostics now go through main-process diagnostics IPC; renderer-side heavy-service fallback has been removed.
- Runtime Prompt Guard now lints final writing prompts, removes placeholders / duplicate guardrails / review tone, and rewrites useful risks into current writing constraints.
- Migration merge now performs a source-only typed reference pass for nested / forward IDs, ID-keyed records, and legacy cross-collection ID collisions without rewriting existing target records.
- UI, preload, SQLite/JSON storage, and Agent Runtime now share optimistic revision checks; stale full-data or bundle writes are rejected instead of overwriting another process's newer data.
- Revision conflicts now surface a global recovery notice on project and home screens; confirmed reloads run through the same queue and never write stale memory back automatically.
- GenerationRun / ChapterCommit / RevisionCommit IPC failures can no longer be silently bypassed by a full AppData save. Compatibility fallback is allowed only when an older preload genuinely lacks the bundle API.
- Chapter commits now retain both the pre-commit snapshot and the formally accepted version. Legacy commits remain readable and restorable, while formal commit versions are protected from deletion.
- Chapter and revision commits now enforce immutable IDs, reference consistency, stale-baseline protection, and idempotent repeated acceptance.
- Chapter and revision commits now share stable idempotent upserts, full immutable-commit checks, project ownership checks, and cross-project ID-collision guards. Builders scope reports, drafts, traces, and version ancestry by project/job/chapter, and AI-assisted revisions are recorded as `user_with_ai_revision` rather than pure AI revisions.
- Pure chapter/revision commit validation now lives in `commitBundles/*Validation.ts`. The public services fell to roughly 266 and 238 lines and only build bundles, delegate validation, and apply them in memory; SQLite/JSON transaction entry points and renderer APIs remain unchanged.
- Debounced chapter editing now tracks pending text through chapter switches, save failures, and component unmounts instead of silently dropping the latest edit.
- `promptBlockOrder` is reconciled against the post-lint writing prompt, and the conflict-priority declaration now explicitly includes HardCanon and Story Direction.
- Destructive chapter deletion has been replaced with reversible archive semantics. Prose, versions, commits, and diagnostics are retained, while reading, prompt selection, budgeting, generation targets, and normal Agent reads use active chapters only. Restore safely moves a chapter when its former order is occupied.
- The desktop UI and Agent Runtime share `ChapterLifecycleService`. Agent tools can inspect, archive, and restore chapters behind explicit confirmation, and next-order calculation never reuses archived orders.
- AppData collection ownership now has one shared metadata source for import/merge, SQLite serialization, renderer project scoping, and project deletion. Project removal is a tested pure lifecycle operation, follows generation/revision dependencies, preserves other projects, and shows authors a concrete deletion-impact summary before the irreversible save.

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
- Reversible chapter archive and restore without losing version history.
- Public release materials: MIT license, README, SECURITY, CONTRIBUTING, CHANGELOG, THIRD_PARTY_NOTICES, GitHub Actions, and release checks.

### P0: Release And Data Safety

Status: the P0 baseline is complete and should remain a hard release gate.

Keep maintaining:

1. UTF-8 / mojibake checks for docs and user-visible copy.
2. Electron sandbox, CSP, navigation restrictions, narrowed preload API, and single-instance lock.
3. Credential persistence regression checks across save, export, import, migration, SQLite, logs, and errors.
4. SQLite, JSON fallback, import/export, legacy JSON migration, and transactional-write checks.
5. UI/Agent concurrent-write regressions that reject stale AppData and bundle snapshots.
6. Merge regressions for conflicting project IDs, nested commit payloads, prompt snapshots, and version-chain references.
7. Packaged app smoke checks for icon, preload API, SQLite default path, import/export, and no-key state.

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

1. Completed the `RevisionStudioView.tsx` coordinator/sidebar/comparison split and separate generation/version lazy boundaries. Architecture checks now forbid AI generation from importing formal commit persistence and forbid version actions from absorbing AI generation again. Keep regression coverage around edit flushing, safe local merge, and formal `RevisionCommitBundle` semantics.
2. Completed the `DataMergeService.ts` collection metadata, entity conflict, reference-remapping, and file-storage split. Keep full collection coverage, SQLite/JSON merge, and revision-conflict tests as the compatibility boundary.
3. Completed the `SqliteStorageService.ts` schema, indexed entity serialization, and bundle-entry planning split. Keep rollback, legacy JSON migration, credential redaction, and concurrent-revision tests as the main-process-only transaction boundary.
4. Completed the `AgentReadableSummaryService.ts` project-summary, chapter-diagnostics, version-chain, and long-text reader split. Keep the CLI/MCP facade stable and protect Agent information parity with archived-read, cross-project diagnostic isolation, and sensitive-text redaction tests.
5. Completed the `PromptBuilderView.tsx` context-needs, continuity, character-selection, and history-action split. Keep full snapshot restore, explicit-selection alignment, and Prompt Guard regressions as its state boundary.
6. Completed the domain splits for `NoveltyDetector`, `CharacterStateService`, `QualityGateService`, `RunTraceAuthorSummaryService`, and `AgentToolService`; `validate-core-modularization.mjs` now guards their line limits and delegation boundaries.
7. Completed the first state/coordination split for `ReadingView.tsx`, `CharactersView.tsx`, and `ChaptersView.tsx`. Prose conflicts, stale AI-response isolation, and safe chapter-order swaps now have focused regressions. Any further reduction of the 473-line chapter coordinator should extract presentation assembly without breaking these state boundaries.
8. Keep the current roughly 50.03 kB `ChaptersView` editing boundary under observation. AI drafts, review fields, version history, and candidate mutations must not drift back into the static prose-editing path; profile interaction latency before pursuing another bundle split.
9. At 83.11 kB, `GenerationPipelineView` remains the largest business-view chunk. Dependency review shows that `promptContext.ts` itself is only about 150 lines; its 113.60 kB shared chunk is dominated by `PromptBuilderService` and `ContextBudgetManager`, which are genuinely used together in the same execution phases. Profile console-open and step-transition latency before splitting this path for bundle-size optics.
10. Completed the shared-invariant and pure-validator split for chapter and revision commit services. Keep project isolation, immutable commits, stale baselines, SQLite rollback, and version restore as the regression boundary for formal writes.
11. Add a lightweight `ChapterLifecycleCommit` only if formal archive auditing becomes a real requirement. The current implementation already has atomic persistence, optimistic revision protection, and reversible restore, so the schema should not expand speculatively.
12. Keep `appDataCollections.ts` as the only collection-ownership registry. New AppData arrays must declare their project/dependency scope and user-facing label there; source-regex copies in views or storage modules are not acceptable.

### P2: Context And Prompt Quality

Goal: reduce continuity drift, unhelpful context bloat, and unearned new rules.

Completed baseline:

- Context Need Planner can identify character hard-state, foreshadowing, timeline, HardCanon, and Story Direction needs with reasons and priorities.
- Character needs explicitly distinguish mention, presence, required action, and state checks. Uncertain candidates remain visible in selection trace without being mislabeled as confirmed gaps or forced into the prompt.
- ContextBudgetManager has scoring, selection, trace, and compression modules.
- Prompt Priority Stack protects previous-chapter bridge, chapter task, character hard state, foreshadowing rules, and HardCanon.
- StageSummary has been narrowed to long-range plot compression.
- Writing prompts remove empty placeholders, duplicate English guardrails, and review-tone risk text.
- Runtime Prompt Guard runs after final writing prompt assembly and records prompt lint results in Run Trace.
- Foreshadowing is grouped by treatmentMode and progression is capped at 10 items.
- Context selection now uses structured reason codes for budget pressure, low relevance, compressed replacement, forbidden content, manual exclusion, item caps, profile filtering, ineligible status, frozen snapshots, and missing sources.
- Final Run Trace enrichment verifies character-state facts and HardCanon items against the actual post-guard prompt. Ledger facts that exist in current data but are absent from a frozen snapshot or final prompt are no longer reported as included.
- Post-plan delta selection no longer disguises uncertain characters or plan-required foreshadowings as manual selections; confirmed present characters remain protected while mention-only candidates remain advisory.
- The active Run Trace Inspector now includes prompt-block preview and runtime contract replay with final order, token estimates, source, authority priority, forced/compressed state, omission reasons, and confirmed unmet needs without copying the full prompt or draft.
- When a snapshot or legacy prompt lacks a real continuity section, the pipeline inserts the Bridge before the chapter-task contract; text inside the priority declaration can no longer masquerade as the actual Bridge block.
- The unused duplicate Run Trace panel has been removed. Author diagnosis, Novelty audit, compression, forced context, and advanced JSON now live in the active Inspector.
- NoveltyDetector now separates task-authorized novelty, synonymous traced-rule reuse, source-media-supported rules, chapter-mode allowances, linked-cost novelty, mundane wording, and unearned deus-ex patches. Quality Gate and Run Trace retain structured beneficiary, resolution, source-medium, and cost evidence.
- One rescue-rule incident now produces one primary deus-ex finding. Quality Gate, memory-candidate warnings, and Run Trace share one author-review consolidation policy instead of repeating ordinary rule findings for the same event.
- Chapter-number/range parsing now lives in a shared pure utility. ForeshadowingView uses a 3.81 kB recommendation helper instead of pulling PromptBuilder and ContextBudgetManager through `promptContext`; the shared chunk fell from about 116.69 kB to 113.60 kB.

Next:

1. Calibrate NoveltyDetector against public synthetic chapter fixtures and move genre-specific vocabulary into maintainable configuration instead of growing one global keyword list.
2. Add lightweight author feedback records for confirmed false positives / negatives without automatically mutating HardCanon or long-term memory.

### P3: Author Experience

Goal: make the complex AI workflow easier to understand and safer to use.

Priorities:

- Add a clean synthetic demo project.
- Add an old-data import wizard.
- Improve Version Chain restore copy and linked report entry points.
- Improve Revision Workbench issue provenance and rollback guidance.
- Make Run Trace author summary the default surface.
- Continuous-reader navigation, unsaved-exit protection, quick-rewrite undo, and chapter save-state feedback are complete; next add in-chapter search and keyboard shortcuts.
- Continue conflict recovery by listing dirty fields before reload and allowing selective copy or re-apply.
- Improve accessibility: focus styles, readable button labels, keyboard navigation, and contrast.
- Project deletion now explains its chapter, character, foreshadowing, draft, version, and trace impact and recommends exporting a backup. A future reversible project archive should be considered only together with a clear storage-retention policy.

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
- Agent Runtime / CLI / MCP tool entry points so Codex can orchestrate the same generation pipeline, diagnostics, commits, and version chain without reading the UI.
- Optional plugin or scripting extension points.

See [Agent Runtime implementation plan](./docs/AGENT_RUNTIME_PLAN.md).

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

</details>

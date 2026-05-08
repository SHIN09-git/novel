# Novel Director UI 可用性审计与重构方案

审计日期：2026-05-08

## 1. 当前 UI 总体评价

Novel Director 已经具备完整的“小说导演台”能力：项目、章节、小说圣经、角色、伏笔、Prompt 构建器、生产流水线、修订工作台、质量门禁、Run Trace 和本地数据管理都已形成闭环。当前 UI 的优点是功能完整、信息透明、数据安全边界较清楚；主要问题是复杂流程页面把“配置、执行、诊断、候选、追踪、修订入口”平铺在同一个长页面里，用户需要自己判断当前应该看哪里、下一步该做什么。

截图已保存到：

- `ui-audit/screenshots/current/01-dashboard.png`
- `ui-audit/screenshots/current/02-chapters.png`
- `ui-audit/screenshots/current/03-prompt-builder.png`
- `ui-audit/screenshots/current/04-generation-pipeline.png`
- `ui-audit/screenshots/current/05-revision-studio.png`
- `ui-audit/screenshots/current/06-settings.png`

截图使用隐藏 Electron 窗口加载生产构建和 `tmp/rc-regression/novel-director-data.json` 回归项目生成。沙箱内 Electron smoke 因 GPU/cache 权限失败，沙箱外 smoke 和截图均可运行。

## 2. 用户主路径

从“准备生成下一章”到“接受修订正文”的主路径应是：

1. Dashboard 看到“准备第 N 章”的入口。
2. Prompt 构建器调整上下文、预算、章节任务、角色、伏笔 treatmentMode 和章节衔接。
3. 保存上下文快照或直接发送到生产流水线。
4. 生产流水线选择目标章节、模式、字数、读者情绪和上下文来源。
5. 运行流水线，得到章节任务书、正文草稿、章节复盘、角色/伏笔候选、一致性审稿、质量门禁和 Run Trace。
6. 先看质量门禁和一致性审稿的高风险问题。
7. 必要时从 issue 进入修订工作台。
8. 在修订工作台比较原文、修订稿和 diff。
9. 接受修订版本，旧正文保存为 ChapterVersion。
10. 回到流水线或章节页，确认是否接受草稿和长期记忆候选。

高频操作：

- 选择目标章节、模式、字数、读者情绪。
- 选择自动上下文或 Prompt 快照。
- 开始生成 / 重试失败步骤。
- 读章节草稿、复制草稿、接受或拒绝草稿。
- 查看质量门禁高风险 issue，并进入修订。
- 接受或拒绝少量关键记忆候选。

低频但高风险操作：

- 强制接受低质量草稿。
- 覆盖已有章节。
- 接受长期记忆候选。
- 忽略 high severity 一致性问题。
- 从草稿修订写回正式章节。
- 数据路径迁移、覆盖、合并。

默认应该显示：

- 当前目标章节和上下文来源。
- 当前 job 状态、当前步骤、失败原因。
- 当前最重要产物：任务书或正文草稿。
- 质量门禁总分、是否放行、高风险 issue 数量。
- 待用户处理事项：接受草稿、进入修订、处理记忆候选。

应该折叠到详情：

- 完整 Run Trace JSON。
- 每一步完整输出 JSON。
- 全量 omitted context 列表。
- 全量伏笔 treatmentMode 规则。
- 已接受 / 已拒绝的历史候选。
- 低风险 quality issue 和冗余说明。

## 3. 生产流水线页面当前信息结构

当前 `GenerationPipelineView` 的结构大致是：

1. 页面 Header。
2. 顶部 `pipeline-start pipeline-command-panel`：
   - 目标章节、生成模式、预计字数、读者情绪。
   - 读者情绪快捷预设。
   - 上下文预算模式、token 预算。
   - 上下文来源与 Prompt 快照选择。
   - 开始生成按钮、job 状态、消息提示。
3. 下方 `pipeline-workbench`：
   - 左侧 job 列表。
   - 右侧主区域包含：
     - 流程状态 Stepper。
     - Run Trace 面板。
     - 步骤输出面板。
     - 正文草稿面板。
     - 质量门禁报告。
     - 修订候选。
     - 记忆更新候选。
     - 一致性审稿报告。

这个结构的优势是透明；问题是所有信息同时出现，用户必须滚动和阅读多个同质卡片才能找到“当前该做什么”。

## 4. 生产流水线最影响易用性的 10 个问题

1. 主动作不聚焦：配置、开始生成、重试、跳过、接受草稿、拒绝草稿、生成修订、接受候选都在同一长页面里竞争注意力。
2. 产物和诊断混排：正文草稿、质量门禁、一致性审稿、Run Trace、记忆候选都是同级 `panel`，没有决策层级。
3. Run Trace 过早占据核心区域：它对调试很重要，但不是大多数作者第一眼需要处理的内容。
4. 步骤输出过重：每一步都展示 `pre` 截断 JSON，适合开发调试，不适合创作者判断状态。
5. 当前步骤不够突出：Stepper 有状态，但没有“正在做什么 / 下一步要用户做什么”的明确控制台提示。
6. 上下文来源不够持久可见：用户需要回到顶部配置或 Run Trace 才能确认本次用的是自动上下文还是 Prompt 快照。
7. 高风险操作与普通操作视觉距离太近：接受低质量草稿、覆盖章节、接受长期记忆候选需要更强的风险分区。
8. 记忆候选列表缺少摘要门槛：候选一多，用户会被迫阅读大量细节，难以先筛 high impact 更新。
9. 一致性审稿和质量门禁职责在 UI 上仍接近：虽然底层职责已拆，但页面呈现仍像两份同级报告。
10. Job 历史与当前执行混在同屏：左侧历史 job 列表有用，但当前 job 的执行状态应该更突出，历史记录应弱化。

## 5. Prompt 构建器与生产流水线衔接问题

Prompt 构建器已经具备“上下文控制台”雏形：预算选择、章节衔接、手动角色/伏笔、treatment override、上下文快照和发送到流水线都已存在。但衔接仍有体验问题：

- “保存 Prompt 版本”和“保存上下文快照”概念容易混淆。
- “发送到生产流水线”只是一个按钮，缺少发送后的确认摘要。
- 生产流水线顶部会再次展示大量配置，用户可能不确定快照里的设置是否已经接管。
- Prompt 快照详情用 `details + pre` 展示，偏开发调试，不够作者友好。

建议把 Prompt 构建器定位为“上下文控制台”，发送前显示一张确认卡：

- 第 N 章。
- 使用模式与预算。
- 纳入章节/阶段摘要/角色/伏笔数量。
- treatment override 数量。
- 章节衔接是否启用。
- 预计 token。
- 发送到流水线。

## 6. 修订工作台易用性问题

修订工作台目前比流水线更清晰，核心问题是入口和状态：

- 从质量门禁 issue / 一致性 issue 进入修订后，用户需要确认当前修订来源是正式章节还是草稿。
- 修订类型很多，但没有按“去 AI 味 / 连续性 / 伏笔 / 角色 / 节奏”分组。
- 原文、修订稿、diff 已具备，但接受动作与“将写回哪里”仍应更醒目。
- 质量 issue 列表在页面下方，用户可能需要滚动才发现可定向修订。

建议新增一个顶部来源条：

`修订来源：第 N 章正式正文 / 流水线草稿 · 写回目标：正式章节 / 仅更新草稿 · 旧版本保护：已启用`

## 7. 新生产流水线信息架构

比较两种方案：

### 方案 A：三栏执行控制台

- 左侧：配置与上下文来源。
- 中间：步骤状态与当前主要产物。
- 右侧：诊断、风险、Run Trace、记忆候选摘要。

优点：上下文来源、当前产物、风险一直可见。适合桌面应用和长流程控制台。

缺点：在 1280px 宽度下容易挤压正文草稿；需要响应式折叠右侧。

### 方案 B：顶部步骤条 + 下方 Tab

- 顶部：目标章节、上下文来源、开始生成、步骤条。
- 下方 Tab：配置 / 上下文 / 草稿 / 诊断 / 记忆 / 追踪。

优点：信息密度可控，认知负担低。

缺点：关键风险可能藏在 Tab 里；用户需要来回切换才能同时对照草稿和质量结果。

### 推荐：A 的桌面控制台 + B 的局部 Tab

最适合当前项目的是混合方案：

- 顶部 sticky 状态条：目标章节、job 状态、上下文来源、质量门禁状态、主动作。
- 左侧窄栏：配置 + job 历史。
- 中间主栏：当前步骤与主要产物，使用 Tab 切换“任务书 / 草稿 / 步骤输出”。
- 右侧 Inspector：质量门禁、一致性审稿、记忆候选、Run Trace，以摘要卡 + 展开详情呈现。

这样既保留桌面工作台感，又避免所有报告平铺。

### ASCII wireframe

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 第 5 章 · 标准 · 自动上下文/Prompt 快照 · running/completed · [开始/重试]  │
└─────────────────────────────────────────────────────────────────────────────┘
┌───────────────┬──────────────────────────────────────────────┬──────────────┐
│ 配置与历史     │ 当前执行区                                     │ 风险与追踪     │
│               │                                              │              │
│ 目标章节       │ Step Rail: 预算 → 上下文 → 任务书 → 正文 ...    │ 质量门禁 82/过 │
│ 模式/字数      │                                              │ high issue 0  │
│ 读者情绪       │ [Tab] 任务书 | 草稿 | 步骤输出                  │              │
│ 上下文来源     │                                              │ 一致性审稿     │
│ 快照摘要       │ 草稿标题 / 正文预览 / token / 状态              │ 0 high         │
│               │ [接受草稿] [拒绝] [重新生成] [进入修订]          │              │
│ Job 历史       │                                              │ 记忆候选 3 待审 │
│               │                                              │ Run Trace 摘要 │
└───────────────┴──────────────────────────────────────────────┴──────────────┘
```

## 8. 组件拆分计划

当前 `GenerationPipelineView.tsx` 仍约 877 行，`usePipelineRunner.ts` 约 780 行。业务逻辑已有初步 hook 化，但展示层仍重。

建议拆分：

```text
src/renderer/src/views/GenerationPipelineView.tsx
  只负责组装数据、调用 hooks、布局容器。

src/renderer/src/components/pipeline/
  PipelineLayout.tsx
  PipelineTopStatusBar.tsx
  PipelineConfigPanel.tsx
  PipelineJobList.tsx
  PipelineStepRail.tsx
  PipelineCurrentArtifactPanel.tsx
  PipelineDraftPanel.tsx
  PipelineDiagnosticsPanel.tsx
  PipelineMemoryCandidatesPanel.tsx
  PipelineTracePanel.tsx
  PipelineContextSnapshotPanel.tsx
  PipelineActionBar.tsx
  PipelineRiskBanner.tsx
  PipelineEmptyState.tsx

src/renderer/src/hooks/
  useGenerationPipelineUiState.ts
```

迁移顺序：

1. 先抽纯展示组件：TopStatusBar、ConfigPanel、JobList。
2. 再抽 Inspector：DiagnosticsPanel、MemoryCandidatesPanel、TracePanel。
3. 最后抽 CurrentArtifactPanel，把草稿、任务书、步骤输出放入局部 Tab。
4. 业务 hook 暂时不动，避免影响 AI 流水线逻辑。

## 9. Novel Director 复杂 AI 流水线 UI 原则

1. 每个页面只突出一个主动作。
2. 高风险操作必须视觉上区分。
3. AI 生成结果、诊断问题、用户确认操作必须分区。
4. 默认显示摘要，详情可展开。
5. 不要让用户同时面对 5 个报告。
6. 当前状态要比历史记录更突出。
7. 失败和可重试状态必须明确。
8. 上下文来源必须始终可见。
9. 正式章节与草稿必须视觉区分。
10. 诊断结果必须能直接进入修订行动。
11. Run Trace 默认服务于解释，不应抢占创作主视野。
12. 长期记忆候选必须明确“未确认不会写入”。

## 10. 分阶段实施计划

### Phase 1：只改生产流水线布局

范围：

- 不改数据结构。
- 不改 `usePipelineRunner` 核心逻辑。
- 把页面拆成 TopStatusBar / ConfigPanel / StepRail / CurrentArtifact / Inspector。
- 默认展示当前主要产物，报告与 trace 折叠到 Inspector。

验收：

- 可以开始生成。
- 步骤状态正常变化。
- 草稿接受/拒绝逻辑不变。
- 质量门禁和一致性审稿仍可进入修订。
- Run Trace 仍可复制。
- `npm.cmd run typecheck` 和 `npm.cmd test` 通过。

回滚：

- 保留旧 `GenerationPipelineView` 的渲染顺序在一个提交内，可直接 revert Phase 1。

### Phase 2：改 Prompt 构建器和生产流水线衔接

范围：

- 不改 PromptBuilderService。
- 增加发送前摘要卡。
- 生产流水线使用快照时，把快照摘要放进顶部状态条。
- 明确 PromptVersion 与 PromptContextSnapshot 的区别。

验收：

- Prompt 构建器发送快照后，流水线顶部显示“使用 Prompt 快照”。
- 用户能看到快照目标章节、token、角色/伏笔数量。
- 目标章节不一致提示明显。

### Phase 3：改修订工作台问题入口

范围：

- 顶部加入来源/写回目标/旧版本保护提示。
- 质量门禁 issue 与一致性 issue 用统一“进入修订”动作样式。
- 修订类型分组。

验收：

- 从质量门禁 issue 进入修订不迷路。
- 从一致性 issue 进入修订不迷路。
- 草稿来源不会误写正式章节。

### Phase 4：整体视觉统一

范围：

- 统一报告卡、候选卡、风险卡、状态条。
- 统一列表空状态。
- 收敛按钮层级：primary / secondary / danger / quiet。
- 补充响应式。

验收：

- Dashboard、Prompt、Pipeline、Revision 视觉层级一致。
- 低频调试信息默认不抢占主视图。
- 长文本区域仍舒适可读。

## 11. 风险点

- 生产流水线是最复杂页面，布局重构容易误碰接受草稿、记忆候选和 trace 更新逻辑。
- 右侧 Inspector 如果默认折叠过多，可能隐藏高风险 issue。
- Tab 化会降低信息同时可见性，需要顶部风险条补偿。
- 当前截图基于回归 fixture；真实长篇项目有更多章节/候选时，列表密度仍需二次验证。
- Electron smoke 在沙箱内 GPU/cache 初始化失败，UI 自动化截图需要沙箱外运行。

## 12. 下一步建议

下一步先做 Phase 1：生产流水线布局重构。不要先改 Prompt 或 Revision，因为流水线是当前信息过载的核心页面，也是“生成下一章”的决策中心。Phase 1 成功后，再把 Prompt 快照摘要和 Revision issue 入口接进新布局。

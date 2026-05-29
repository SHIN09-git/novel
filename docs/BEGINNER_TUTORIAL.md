# 新手教程 / Beginner Tutorial

## 简体中文

这份教程面向第一次打开 Novel Director 的作者。它不会假设你已经了解 Prompt Builder、生产流水线、角色状态账本或 Run Trace。目标是帮你用一个干净的虚构项目跑通“准备资料 → 生成草稿 → 审查 → 修订 → 接受”的完整闭环。

所有示例都属于 synthetic demo data。不要把真实 API Key、私有稿件或本地数据文件贴到公开 issue、截图或讨论中。

### 0. 先理解三个边界

- Novel Director 是本地优先工具。项目数据默认保存在本机 SQLite 数据库中，JSON 导入导出仍然保留。
- 远程 AI 只在你配置 provider 并发起生成时使用。被选中的上下文和 prompt 会发送给你配置的 provider。
- AI 生成内容只是候选。草稿、记忆候选、角色状态变化和新设定都应该经过作者确认。

### 1. 启动应用

如果你使用源码开发版：

```powershell
npm.cmd install
npm.cmd run dev
```

如果你使用安装包：

1. 从 GitHub Releases 下载 `Novel Director Setup 0.1.0.exe`。
2. 运行安装器。
3. 从桌面或开始菜单打开 `Novel Director`。

首次打开为空是正常的。你可以创建新项目，也可以导入旧版 AppData JSON。

### 2. 配置 AI Provider

打开“设置”页，填写：

- Provider
- Base URL
- Model
- Temperature
- Max tokens
- API Key

API Key 通过 Electron 安全存储保存，不应进入 AppData JSON 或导出文件。没有 API Key 时，部分 AI 调用会失败或降级为本地模板。

### 3. 创建第一个项目

在工作台首页创建项目。可以先用一个虚构示例：

- 项目名：`Fog City Echo`
- 类型：都市悬疑 / 规则怪谈 / 无限流
- 核心读者情绪：压迫、好奇、紧张
- 文风：克制、电影感、少解释、多动作和细节

如果你已有旧数据，首页为空时点击“导入旧数据 JSON”，选择旧版导出的 AppData JSON 或旧的 `novel-director-data.json`。

### 4. 填写小说圣经与硬设定

“小说圣经”适合写长期背景，例如世界基线、主线冲突、题材边界和文风。

“硬设定包 / Hard Canon”只放不可违背的短规则，例如：

- 规则系统不能无代价救命。
- 主角右臂结晶化后不能无解释恢复。
- 某角色已死亡，不得复活，除非正文明确进入回忆或幻觉。

不要把完整剧情回顾塞进硬设定包。它应该短、硬、稳定。

### 5. 创建角色和动态状态账本

先创建 2 到 4 个核心角色。角色卡的九项模板用于长期人物理解：

- 角色定位
- 表层目标
- 深层需求
- 核心恐惧
- 行动逻辑
- 能力与资源
- 弱点与代价
- 关系张力
- 后续钩子

然后添加“动态状态账本”事实。状态账本负责防止硬伤：

- 当前位置
- 伤势 / 身体状态
- 持有物品
- 现金或资源
- 已知秘密
- 承诺 / 债务
- 能力限制

如果你只在“状态日志 / 历史记录”里写了一句话，它不会自动进入 prompt。需要点击“转为状态事实”或“转为候选”。

### 6. 创建伏笔

每条伏笔至少包含标题、描述、权重和 treatment mode。

常用模式：

- `hidden`：本章默认不提。
- `pause`：暂时冻结，不推进。
- `hint`：只能轻微暗示。
- `advance`：可以推进线索，但不能揭底。
- `mislead`：可以制造误导，但不能改写真相。
- `payoff`：允许回收或揭示。

正文 prompt 默认最多推进 10 条相关伏笔，并按权重优先排序。不要把所有伏笔都强塞进一章。

### 7. 用 Prompt 构建器准备上下文

Prompt 构建器适合你想精确控制上下文时使用。

推荐步骤：

1. 选择目标章节。
2. 生成或编辑 Context Need Plan。
3. 检查本章需要哪些角色状态、伏笔、时间线、硬设定和阶段摘要。
4. 检查被省略的上下文及原因。
5. 填写本章任务字段。
6. 生成最终 prompt。
7. 如果想让生产流水线严格复用这份上下文，保存 Prompt Context Snapshot。

### 8. 使用生产流水线生成草稿

生产流水线适合完整自动流程：

1. 选择目标章节。
2. 选择自动构建上下文或 Prompt 快照。
3. 选择生成模式。
4. 设置预计字数和读者情绪目标。
5. 点击开始生成。

流水线会依次执行上下文规划、预算选择、prompt 构建、章节计划、正文草稿、章节复盘、记忆候选、一致性审稿、质量门禁和 Run Trace。

### 9. 接受草稿前看三件事

接受草稿前，至少检查：

- 质量门禁：低于通过线或存在高风险时，不要直接接受。
- Novelty Audit：有没有临时新增未授权规则、新角色、新组织或机械降神式补丁。
- Run Trace 作者摘要：问题更可能来自上下文缺失、任务书、角色状态、伏笔，还是模型输出。

质量门禁通过不等于正文已经完美。它只是降低明显硬伤的风险。

### 10. 处理记忆候选

章节复盘会生成长期记忆候选，例如角色变化、伏笔状态变化、章节复盘和时间线事件。

原则：

- 未确认的候选不会写入长期记忆。
- Novelty 风险较高的候选要格外谨慎。
- 可以一键接受低风险候选，但仍建议先看摘要和 evidence。

### 11. 修订和版本恢复

如果草稿方向基本正确但文本有问题，进入修订工作台：

- 使用差异视图比较原文和修订稿。
- 接受修订会创建新的版本记录，不会静默覆盖旧正文。
- 章节页的版本历史可以查看、对比和恢复历史版本。
- 恢复历史版本也会创建新的 RevisionCommitBundle，而不是删除当前版本。

### 12. 备份、导出和迁移

建议在真实稿件使用前养成三个习惯：

- 定期导出 AppData JSON。
- 重大生成或迁移前先备份。
- 章节正文可以导出 TXT 或 Markdown，但这些不是完整项目备份。

如果迁移数据路径时目标位置已有数据，优先使用“合并已有数据”，不要直接覆盖。

### 常见问题

#### 打开应用后项目为空

检查是否切换了数据路径或使用了新的 SQLite 数据库。可以在首页或设置页导入旧 AppData JSON。

#### AI 返回结构不符合要求

这通常是模型没有遵守 strict JSON schema。可以重试；如果频繁出现，换更稳定的模型或降低输出长度。

#### 生成内容乱加规则

检查 Hard Canon、伏笔 treatment mode、Novelty Audit 和本章任务书的 allowedNovelty / forbiddenNovelty。

#### 角色状态没有进入 prompt

确认该状态已经进入 CharacterStateFact，而不只是 CharacterStateLog。状态日志需要“转为状态事实”后才会被上下文选择。

---

## English

This tutorial is for authors opening Novel Director for the first time. It walks through the full loop: prepare project data, generate a draft, inspect risks, revise, and accept.

All examples are synthetic demo data. Do not post real API keys, private manuscripts, local data files, or private screenshots in public issues.

### 0. Understand the Boundaries

- Novel Director is local-first. Project data is stored in a local SQLite database by default; JSON import/export remains available.
- Remote AI is used only after you configure a provider and start generation. Selected context and prompts are sent to that provider.
- AI output is a candidate. Drafts, memory updates, state changes, and new canon should be reviewed by the author.

### 1. Start the App

From source:

```powershell
npm.cmd install
npm.cmd run dev
```

From a release:

1. Download `Novel Director Setup 0.1.0.exe` from GitHub Releases.
2. Run the installer.
3. Open `Novel Director` from the desktop or Start menu.

An empty first launch is normal. Create a new project or import an old AppData JSON file.

### 2. Configure an AI Provider

Open Settings and fill in provider, base URL, model, temperature, max tokens, and API key.

The API key is stored through Electron secure storage and should not be written to AppData JSON or exported project files.

### 3. Create a Project

Start with a fictional sample if needed:

- Name: `Fog City Echo`
- Genre: urban mystery / weird rules / infinite flow
- Reader emotion: pressure, curiosity, tension
- Style: restrained, cinematic, concrete, low exposition

If you already have old data, import an exported AppData JSON or legacy `novel-director-data.json`.

### 4. Fill Story Bible and Hard Canon

Use Story Bible for long-term background. Use Hard Canon only for short, non-negotiable facts and rules.

Good Hard Canon items are concise:

- The rule system must not create free rescue patches.
- The protagonist's crystallized arm cannot heal without explanation.
- A dead character cannot return unless the scene is memory, hallucination, or explicitly justified.

### 5. Add Characters and State Facts

Create core characters, then add state ledger facts such as location, injury, inventory, resources, known secrets, promises, and ability limits.

State logs are only history notes. To affect prompts, convert a log into a state fact or candidate.

### 6. Add Foreshadowing

Set title, description, weight, and treatment mode:

- `hidden`: do not mention.
- `pause`: keep frozen.
- `hint`: light signal only.
- `advance`: move forward without revealing the truth.
- `mislead`: create a false lead.
- `payoff`: reveal or resolve.

Each writing prompt should advance at most 10 relevant foreshadowing items, sorted by weight.

### 7. Build Context with Prompt Builder

Use Prompt Builder when you want precise context control:

1. Select target chapter.
2. Generate or edit Context Need Plan.
3. Review selected and omitted context.
4. Fill chapter task fields.
5. Generate final prompt.
6. Save a Prompt Context Snapshot if the pipeline should reuse this exact context.

### 8. Generate with the Pipeline

Use Generation Pipeline for the full automated flow: context planning, budget selection, prompt construction, chapter plan, draft, chapter review, memory candidates, consistency review, quality gate, and Run Trace.

### 9. Review Before Accepting

Before accepting a draft, check:

- Quality Gate.
- Novelty Audit.
- Run Trace Author Summary.

A passing quality gate lowers risk, but does not replace author judgment.

### 10. Handle Memory Candidates

Pending memory candidates do not update long-term memory until accepted. Review evidence and novelty warnings before applying them.

### 11. Revise and Restore Versions

Use Revision Workbench for targeted changes. Accepted revisions create version records. The chapter Version History can compare and restore old versions safely.

### 12. Back Up and Export

Export AppData JSON regularly. TXT and Markdown exports are manuscript exports, not full project backups.

When moving storage paths, prefer merge preview over overwrite.

### Troubleshooting

- Empty project list: check storage path or import old JSON.
- Invalid AI schema: retry, use a more reliable model, or reduce output length.
- New unplanned rules: check Hard Canon, treatment modes, Novelty Audit, and chapter novelty policy.
- Character state missing from prompt: convert the state log into a state fact.

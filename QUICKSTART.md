# 快速开始 / Quickstart

## 简体中文

这份指南会带你创建一个小型虚构小说项目，准备上下文，生成第一章草稿，并进入修订流程。所有示例名称和故事片段都是 synthetic demo data。如果你在 fixture 或文档中看到 `Fog City Test Draft` / `《雾城测试稿》`，它只是公开测试用的虚构项目。

### 1. 启动应用

```bash
npm.cmd install
npm.cmd run dev
```

可选验证：

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

### 2. 创建项目

在首页创建一个项目。

如果你已经有旧版数据，首页为空时可以先点击“导入旧数据 JSON”，选择旧版导出的 AppData JSON 或旧的 `novel-director-data.json`。导入成功后会直接进入第一个项目；如果导入失败，请保留源文件并到设置页检查备份、日志和数据路径。

建议使用虚构示例：

- 名称：`Fog City Echo`
- 类型：都市悬疑 / 规则怪谈 / 无限流
- 目标读者：喜欢线索控制和人物张力的长篇悬疑读者
- 核心情绪：压迫、好奇、延迟揭示
- 文风：克制、电影感、具体细节、低解释量

### 3. 填写小说圣经

小说圣经用于稳定长期事实，不适合记录每章流水账。

可以先填写：

- 世界基线
- 核心前提
- 主角欲望与恐惧
- 主冲突
- 规则或能力系统
- 禁止套路
- 叙事基调
- 不可违背的设定

### 4. 创建角色

至少创建：

- 主角
- 盟友或情感关系角色
- 反派或制度压力来源

优先填写当前戏剧状态，而不是百科式履历。尽量补全九项角色模板：

- 角色定位
- 表层目标
- 深层需求
- 核心恐惧
- 行动逻辑
- 能力与资源
- 弱点与代价
- 关系张力
- 后续钩子

### 5. 添加角色状态账本事实

添加几条容易造成连续性 bug 的硬状态：

- 当前位置
- 伤势或身体状态
- 重要持有物
- 已知秘密
- 金钱或资源数量
- 能力限制

Context Need Planner 可以选择这些事实，并把它们作为硬约束放入 prompt。

### 6. 添加伏笔

先创建两到三条伏笔，并设置 treatment mode：

- `hint`：只轻微暗示
- `advance`：可以推进但不能揭底
- `mislead`：可以制造误导
- `payoff`：可以揭示或回收
- `pause`：冻结，不推进
- `hidden`：除非强制选择，否则不提及

早期章节建议使用 `hint` 或 `pause`。除非该章明确用于兑现线索，否则不要轻易设为 `payoff`。

### 7. 构建第一章 Prompt

打开 Prompt 构建器：

1. 选择目标章节 `1`。
2. 选择 `standard` 模式。
3. 生成或编辑 Context Need Plan。
4. 检查被选中的角色、状态事实、伏笔和被省略的上下文。
5. 填写章节任务字段。
6. 生成最终 prompt。
7. 如果希望生产流水线严格使用这份上下文，保存 Prompt Context Snapshot。

### 8. 生成草稿

打开生产流水线：

1. 选择目标章节 `1`。
2. 选择自动构建上下文，或选择已保存的 Prompt Context Snapshot。
3. 选择保守或标准生成模式。
4. 设置预计字数和读者情绪目标。
5. 开始生成。

流水线会展示：

- 上下文需求规划
- 上下文预算选择
- prompt 构建
- 章节任务书
- 正文草稿
- 章节复盘
- 记忆候选
- 一致性审稿
- 质量门禁
- Run Trace

没有 API Key 时，AI 调用应优雅失败；部分位置会使用本地模板兜底。

### 9. 接受前检查

接受草稿前，请检查：

- 正文草稿本身。
- 质量门禁和一致性审稿。
- Novelty audit 是否发现未授权新规则、角色或设定。
- Run Trace 是否能解释实际使用了哪些上下文。
- 长期记忆候选是否正确；不要盲目接受。

### 10. 修订

打开修订工作台：

1. 选择章节或草稿。
2. 选择修订类型，例如去 AI 味、加强冲突、加强章节衔接、减少冗余。
3. 生成修订版本。
4. 对比原文、修订稿和差异视图。
5. 满意后再接受。

接受修订会先把旧正文保存为 `ChapterVersion`。

### 11. 导出

在章节页，你可以：

- 复制正文。
- 复制标题 + 正文。
- 导出单章 TXT。
- 导出单章 Markdown。
- 批量导出全部章节 TXT 或 Markdown。

导出通过 Electron IPC 写入文件，不让 renderer 直接访问文件系统。

---

## English

This walkthrough creates a small synthetic fiction project, prepares context, generates a first draft, and revises it. All example names and story fragments are synthetic demo data. If you see `Fog City Test Draft` / `《雾城测试稿》` in fixtures or docs, it is a fictional public test project.

### 1. Start the App

```bash
npm.cmd install
npm.cmd run dev
```

Optional validation:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

### 2. Create a Project

On the home screen, create a project.

If you already have old data, click `导入旧数据 JSON` on the empty home screen and select an exported AppData JSON file or legacy `novel-director-data.json`. After a successful import, the app opens the first project. If import fails, keep the source file and use Settings to inspect backups, logs, and data paths.

Suggested synthetic example:

- Name: `Fog City Echo`
- Genre: urban mystery / weird rules / suspense
- Target readers: long-form suspense readers who enjoy clue control and character tension
- Core emotion: pressure, curiosity, delayed revelation
- Style: restrained, cinematic, concrete details, low exposition

### 3. Fill the Story Bible

Use the Story Bible for stable long-term facts, not chapter-by-chapter notes.

Start with:

- World baseline
- Central premise
- Protagonist desire and fear
- Main conflict
- Rule or power system
- Forbidden tropes
- Narrative tone
- Non-negotiable canon

### 4. Create Characters

Create at least:

- Protagonist
- Ally or love interest
- Antagonist or institutional pressure

Focus on current dramatic state rather than encyclopedia biography. Fill the nine-card template where possible:

- Role function
- Surface goal
- Deep need
- Core fear
- Decision logic
- Abilities and resources
- Weakness and cost
- Relationship tension
- Future hooks

### 5. Add State Ledger Facts

Add a few hard facts that can cause continuity bugs:

- Current location
- Injury or physical condition
- Important inventory
- Known secrets
- Money or resource amount
- Ability limitation

These facts can be selected by the Context Need Planner and included in the prompt as hard constraints.

### 6. Add Foreshadowing

Create two or three foreshadowing entries first. Set a treatment mode:

- `hint`: light signal only
- `advance`: can move forward but not reveal the truth
- `mislead`: can create a false lead
- `payoff`: can reveal or resolve
- `pause`: keep frozen
- `hidden`: do not mention unless forced

For early chapters, prefer `hint` or `pause`. Avoid `payoff` unless the chapter is meant to resolve that clue.

### 7. Build the First Prompt

Open Prompt Builder:

1. Choose target chapter `1`.
2. Choose mode `standard`.
3. Generate or edit the Context Need Plan.
4. Review selected characters, state facts, foreshadowing, and omitted context.
5. Fill the chapter task fields.
6. Generate the final prompt.
7. Save a Prompt Context Snapshot if you want the pipeline to use exactly this context.

### 8. Generate a Draft

Open Generation Pipeline:

1. Choose target chapter `1`.
2. Choose automatic context or a saved Prompt Context Snapshot.
3. Choose conservative or standard mode.
4. Set expected word count and reader emotion.
5. Start generation.

The pipeline shows:

- context planning
- context budget selection
- prompt construction
- chapter plan
- draft
- chapter review
- memory candidates
- consistency review
- quality gate
- run trace

Without an API key, AI calls should fail gracefully or use local templates where implemented.

### 9. Review Before Accepting

Before accepting a draft:

- Read the draft.
- Check quality gate and consistency review.
- Check novelty audit for unapproved new rules, characters, or lore.
- Check Run Trace to confirm what context was actually used.
- Do not accept long-term memory candidates unless they are correct.

### 10. Revise

Open Revision Workbench:

1. Select the chapter or draft.
2. Choose a revision type such as reduce AI tone, strengthen conflict, improve continuity, or reduce redundancy.
3. Generate a revision.
4. Compare original, revised, and diff view.
5. Accept only when satisfied.

Accepting a revision saves the previous chapter body as a `ChapterVersion`.

### 11. Export

In Chapters, you can:

- Copy body.
- Copy title plus body.
- Export one chapter as TXT or Markdown.
- Export all chapters as TXT or Markdown.

Exports are written through Electron IPC, not direct renderer file-system access.

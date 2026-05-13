# 测试指南 / Testing Guide

## 简体中文

这份指南描述 Novel Director 在公开预览版发布前的轻量验证流程。

这里使用的故事内容均为 synthetic test data。fixture 标题 `Fog City Test Draft` / `《雾城测试稿》`、所有角色名和剧情片段都是虚构示例。请不要把客户稿件、私有草稿或真实 API Key 放进公开 fixture、截图、issue 或测试产物中。

### 必跑命令

发布或提交 PR 前运行：

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

生成回归 fixture：

```bash
npm.cmd run rc:fixture
```

fixture 写入：

```text
tmp/rc-regression/novel-director-data.json
```

### 五章压测流程

使用一个小型虚构项目跑完整链路：

1. 创建项目，例如 `Fog City Test Draft`。
2. 填写小说圣经。
3. 创建三个关键角色：主角、盟友、反派。
4. 创建至少五条伏笔：
   - 低权重伏笔
   - 高权重伏笔
   - payoff 权重伏笔
   - 一条预计第 5 章附近回收的伏笔
   - 一条 hidden 或 pause 伏笔
5. 创建第 1-3 章。
6. 为第 1-3 章创建阶段摘要。
7. 使用 Prompt 构建器准备第 4 章。
8. 将上下文快照发送到生产流水线。
9. 生成或模拟一章草稿。
10. 检查一致性审稿、质量门禁、Novelty audit 和 Run Trace。
11. 在修订工作台修订草稿。
12. 接受修订，并确认保存了 `ChapterVersion`。
13. 导出当前章节和全部章节。
14. 只在一次性测试数据上测试数据路径迁移或合并。

### 章节检查

每章生成后检查：

- 如果有章节衔接桥，开头是否承接上一章。
- 角色硬状态是否被遵守：位置、伤势、物品、知识、承诺、资源、能力限制。
- 伏笔 treatment mode 是否被遵守：hidden、pause、hint、advance、mislead、payoff。
- 是否引入了未授权救命规则、命名角色、组织层级或重大设定揭示。
- 长期记忆候选是否在用户明确接受前保持 pending。
- 质量门禁和一致性 issue 是否能进入修订流程。
- Run Trace 是否解释了 selected context、forced context blocks、compression records、prompt block order 和 novelty audit。

### 数据安全检查

破坏性测试只使用一次性副本。

1. 确认应用能加载已有数据。
2. 修改数据路径。
3. 如果目标位置已有数据，先检查合并预览再确认。
4. 确认覆盖或合并前会创建备份。
5. 破坏一次性 JSON 副本，确认会生成 `.corrupt.<timestamp>.json` 备份。
6. 确认保存或导出的 AppData JSON 中不含 API Key。

### 发布烟测

生成安装包后运行：

```bash
npm.cmd run smoke:packaged
```

该检查会启动 `release/win-unpacked/Novel Director.exe`，使用一次性 `tmp/packaged-smoke-user-data`，并验证：

- 应用图标资源存在。
- `window.novelDirector` preload API 可用。
- data load/save/import/export API 可见。
- 默认本地数据路径可解析为 SQLite / JSON 数据文件。
- 首次启动无 API Key 状态不会崩溃。
- SQLite 默认数据库会在隔离 userData 中创建。

### 导出检查

在章节页检查：

- 复制正文。
- 复制标题 + 正文。
- 导出当前章节 TXT。
- 导出当前章节 Markdown。
- 批量导出全部章节 TXT。
- 批量导出全部章节 Markdown。

Windows 非法文件名字符应被清理。

### 通过标准

候选版本应满足：

- `npm.cmd run typecheck` 通过。
- `npm.cmd test` 通过。
- `npm.cmd run build` 通过。
- 旧数据能打开。
- 空项目或缺少可选记录时不白屏。
- AI 失败不会写入未确认长期记忆。
- 接受草稿和接受修订前会保留旧章节版本。
- 导出和数据路径操作安全、显式。

---

## English

This guide describes the lightweight validation flow for Novel Director before public preview releases.

All story content used here is synthetic test data. The fixture title `Fog City Test Draft` / `《雾城测试稿》`, all character names, and all plot fragments are fictional examples. Do not use customer manuscripts, private drafts, or real API keys in public fixtures, screenshots, issue reports, or test artifacts.

### Required Commands

Run these before a release or pull request:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Generate the regression fixture:

```bash
npm.cmd run rc:fixture
```

The fixture is written to:

```text
tmp/rc-regression/novel-director-data.json
```

### Five-Chapter Trial Flow

Use a small synthetic project to exercise the whole loop:

1. Create a project such as `Fog City Test Draft`.
2. Fill in the story bible.
3. Create three key characters: protagonist, ally, antagonist.
4. Create at least five foreshadowing entries:
   - low weight
   - high weight
   - payoff weight
   - one expected around chapter 5
   - one hidden or paused item
5. Create chapters 1-3.
6. Create a stage summary for chapters 1-3.
7. Use Prompt Builder for chapter 4.
8. Send a context snapshot to the Generation Pipeline.
9. Generate or simulate a chapter draft.
10. Review consistency, quality gate, novelty audit, and run trace.
11. Revise the draft in Revision Workbench.
12. Accept a revision and confirm a `ChapterVersion` is saved.
13. Export the current chapter and all chapters.
14. Test data path migration or merge on disposable fixture data only.

### Chapter Checks

For each generated chapter, verify:

- The opening continues from the previous chapter when a continuity bridge exists.
- Character hard states are respected: location, injury, inventory, knowledge, promises, resources, ability limits.
- Foreshadowing treatment modes are followed: hidden, pause, hint, advance, mislead, payoff.
- No unapproved rescue rule, named character, organization tier, or major lore reveal is introduced.
- Long-term memory candidates remain pending until explicitly accepted.
- Quality gate and consistency issues can enter revision.
- Run Trace explains selected context, forced context blocks, compression records, prompt block order, and novelty audit.

### Data Safety Checks

Use only disposable copies for destructive tests.

1. Confirm the app can load existing data.
2. Change the data path.
3. If the destination already contains data, test merge preview before confirming.
4. Confirm backups are created before overwrite or merge.
5. Corrupt a disposable JSON copy and confirm a `.corrupt.<timestamp>.json` backup is created.
6. Confirm API keys are not persisted in exported or saved AppData JSON.

### Release Smoke Test

After packaging, run:

```bash
npm.cmd run smoke:packaged
```

This starts `release/win-unpacked/Novel Director.exe` with disposable `tmp/packaged-smoke-user-data` and verifies:

- Application icon resources exist.
- `window.novelDirector` preload API is available.
- data load/save/import/export APIs are visible.
- The default local data path resolves to a SQLite / JSON data file.
- First launch without an API key does not crash.
- The default SQLite database is created in the isolated userData directory.

### Export Checks

In Chapters:

- Copy body.
- Copy title plus body.
- Export current chapter as TXT.
- Export current chapter as Markdown.
- Export all chapters as TXT.
- Export all chapters as Markdown.

Windows-invalid filename characters should be sanitized.

### Pass Criteria

A release candidate should pass when:

- `npm.cmd run typecheck` passes.
- `npm.cmd test` passes.
- `npm.cmd run build` passes.
- Old data can load.
- The app does not white-screen on empty projects or missing optional records.
- AI failures do not write unconfirmed long-term memory.
- Draft acceptance and revision acceptance preserve old chapter versions.
- Export and data-path operations are safe and explicit.

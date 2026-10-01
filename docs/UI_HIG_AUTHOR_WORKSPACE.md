# 作者工作区 HIG 优化 / Author Workspace HIG Update

## 简体中文

后续角色页优化见 [Preview.14 角色工作区](./UI_HIG_CHARACTER_WORKSPACE.md)。本文保留 Preview.13 的历史交付与验收记录。

2026-09-22。本次在既有 HIG 主题和侧栏基础上优化项目入口、Prompt 构建器与编辑反馈，遵循 `apple-hig-design` 的 WebView 适配方式。保留 Windows 操作习惯、青绿色强调色和现有业务流程，不引入苹果专用字体、窗口控件或新的 UI 框架。

### 页面变化

- 项目入口先展示最近打开的项目，支持搜索。新建和导入在标题栏；创建表单按需展开并聚焦，完整项目资料仍可编辑。
- Prompt 构建器分为“任务、Prompt、上下文、历史”。构建、复制、保存和发送集中在一处；构建后直接打开成品编辑区。手动修改后再次构建会先确认，取消时保留文本。
- 页签使用原生按钮和 ARIA 关联，支持方向键、Home、End。隐藏面板保留挂载，切换不会清空输入。
- 预算和模块配置按需展开；上下文诊断与成品编辑分开，手动伏笔选择保留在上下文页底部。
- 编辑区改用明暗主题色，移除浅色硬编码；减少浮动卡片和重复按钮，紧凑标题不抢占正文空间。输入框占位文字也使用主题色，修复深色搜索框默认灰字的低对比度。

### 保存与编辑

项目创建、打开、编辑和导入均等待保存成功再跳转；失败保留输入并明确提示。进行中的写操作使用同步锁，编辑表单暂时禁用，防止重复保存或回执丢弃新输入。

已构建的 Prompt 同时绑定其任务与上下文元数据。调整配置后仍保留作者编辑的文本，并提示重新构建；保存旧文本不会把新章节的元数据错误地拼进去。恢复旧的纯文本版本后仍可另存版本；由于它没有完整上下文凭据，发送流水线前需要重新构建，或加载已有完整快照。

修订工作台区分候选切换、持久化回执和新的本地输入。保存 B 期间输入 C，B 的回执不能把编辑区恢复为 B；切换时仍会保存当前候选，失败不切换。没有改变正式修订的事务协议。

### 可重复验证

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
node scripts/qa-hig-workspace.mjs
node scripts/qa-author-workspace.mjs
git diff --check
```

UI QA 使用生产构建的隔离 Electron 副本、匹配的 SQLite 绑定和虚构项目，不读取真实小说数据，不消费模型额度，不替换仓库原生绑定。与其他 Electron 测试串行运行，避免窗口焦点争用。

- 综合 UI QA：七页、明暗主题、1440/1024px，以及收起导航、800px 和文字放大检查，共 32 张截图。证据：`tmp/visual-qa/hig-workspace/after-2xSsEQ/report.json`。
- 作者工作区 QA：项目列表明暗主题及 1440/1024/800px、新建/编辑/搜索、九项任务输入、页签保值与真实键盘切换、重建取消确认、实际 SQLite 快照保存及 125% 放大，共 13 张截图。证据：`tmp/visual-qa/author-workspace/out-FQXkXK/report.json`。
- Prompt 编辑区及标题静态对比度：浅色 15.46:1、深色 13.84:1。检查在主题切换动画结束后执行；这是取样，不是全站可访问性认证。
- 两轮通过的 UI QA 均无 renderer 异常、外网/AI 请求或遗留测试进程。
- 保存失败路径由 `validate-home-workspace.mjs` 与 `validate-prompt-snapshot-consistency.mjs` 隔离行为测试覆盖；不修改冻结的 preload API 来伪造浏览器故障。
- `validate-revision-editor-save-race.mjs` 的 19 项检查覆盖延迟保存、保存失败、候选切换、撤销输入和快捷改写回执。

首轮源码验收的类型检查、生产构建、全部 141 个验证脚本与 `git diff --check` 通过。历史日志：`tmp/hig-author-tests.log`、`tmp/hig-author-build.log`。两次早期 UI 检查分别采样到了主题过渡色和弹窗归还焦点的中间状态；脚本已改为等待过渡与归焦完成后再检查，不把那两次结果计入通过记录。

### 边界

首轮仅更新生产 `out/`，后续 Preview.13 才同步安装包，见下方包内验收记录。未测试真实屏幕阅读器、触屏设备或全站 200% 放大；800px 是桌面窄窗口验收，不代表完整移动端适配。

### Preview.13 收尾修补

后续审阅的两项问题已用小范围修改处理：

- 空正文允许作为恢复操作的原始状态；缺省、null 或与当前正文不一致的 `beforeText` 仍拒绝。恢复继续走 RevisionCommitBundle，保留旧版本和幂等行为。
- 历史版本优先显示正式采纳时关联的报告。通过可变 Run Trace 查找的后备报告必须匹配正文 hash、草稿、运行、章节和项目；修订或恢复版本不继承另一份正文的审稿结论。旧提交有明确报告引用时保持兼容。
- 无版本 ID 的当前正文不再意外关联第一条旧提交记录。没有可靠来源时显示无关联记录，不生成假的通过结果。

新增 `validate-empty-chapter-restore.mjs`（10 项检查）和 `validate-version-report-provenance.mjs`，并扩展既有版本链 fixture。测试使用隔离 JSON/SQLite，不改用户数据库。

Preview.13 源码生产窗口复验：`tmp/visual-qa/hig-workspace/after-I9vC2N/report.json`（32 张）；最后补充占位文字对比度后的作者工作区：`tmp/visual-qa/author-workspace/out-8cZVqA/report.json`（13 张）。搜索提示在浅色为 5.51:1、深色为 5.42:1，修复前深色为 2.97:1。此数字仅是静态取样，不是全站可访问性认证。

### 最终安装包验收

- `0.1.6-preview.13` 的安装包和 `release/win-unpacked/Novel Director.exe` 已更新，2026-09-22 16:04（北京时间）完成最终打包。
- 实际 EXE 综合 QA：`tmp/visual-qa/hig-workspace/after-hY1Etp/report.json`，32 张截图。
- 实际 EXE 作者工作区 QA：`tmp/visual-qa/author-workspace/packaged-w4FQf7/report.json`，13 张截图，包含稳定主题下的搜索、占位文字和标题栏按钮对比度。
- 两套 QA 无 renderer 异常、模型请求或遗留测试进程。启动/SQLite smoke、Node 原生绑定检查、类型检查、完整 143/143 验证脚本和生产构建均通过。
- 日志：`tmp/hig-preview13-tests.log`、`tmp/hig-preview13-typecheck.log`、`tmp/hig-preview13-build.log`、`tmp/hig-preview13-package.log`。
- 安装包：`release/Novel Director Setup 0.1.6-preview.13.exe`。SHA-256：`ACE325834A40DFD78A928012B5905BBD5C61B884B052355FEE82BE7B1691E602`，与 `release/SHA256SUMS.txt` 一致。

打包使用隔离依赖副本及匹配的 Electron 39.8.9 SQLite 绑定，不替换仓库 Node 绑定。上一版 Preview.12 完整保留在 `releases/archive/v0.1.6-preview.12-2026-09-22T07-57-59-574Z/`；补充占位文字修补前的 Preview.13 也保留在归档。未上传 GitHub，安装包未配置代码签名。真实项目未参与测试。

## English

This update adapts Apple HIG hierarchy, navigation and editing feedback to the existing Windows Electron application. Projects come first with search and on-demand creation. The Prompt workspace now has four accessible tabs, one command area and theme-aware editing surfaces. Existing controls and data remain available.

Snapshot metadata stays bound to its authored Prompt; failed saves do not navigate. Revision save acknowledgements no longer overwrite newer typing. Production Electron QA uses synthetic isolated SQLite profiles with no model calls and cleans up its processes. The reports above contain 32 general-workspace and 13 focused screenshots. Run the commands above to reproduce.

The initial source-only pass is now included in the local Preview.13 installer and unpacked EXE. Both final packaged QA runs passed (32 general-workspace and 13 author-workspace screenshots), along with 143 validation scripts, typecheck, build and SQLite startup smoke. Placeholder contrast is now theme-aware: 5.51:1 in light mode and 5.42:1 in dark mode. Historical review provenance and empty-manuscript restoration received focused regression fixes. See the paths and checksum above.

The previous Preview.12 remains archived. No user data, model credits or root Node native binding were changed. The installer is unsigned and has not been uploaded to GitHub. Full screen-reader, touch and 200% zoom coverage remain outside this pass.

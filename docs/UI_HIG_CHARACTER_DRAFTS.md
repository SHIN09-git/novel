# 角色编辑输入与保存反馈 / Character Drafts

## 简体中文

2026-09-22。本轮延续 [角色工作区](./UI_HIG_CHARACTER_WORKSPACE.md) 的 HIG 分组与反馈设计，修复实际编辑问题，不另做界面换肤或扩张故事数据结构。

### 根因与修复

1. 新建状态表单原先由所有角色共用，切换角色后余额等内容会留在新角色的输入框中。现在按项目和角色保存页内草稿，角色之间不共享输入，切换回来仍可继续填写。
2. 日志、状态和日志转换的保存回执原先直接清空表单。现在提交时记录该表单的身份；只有同一份未修改输入才会清空。保存期间继续编辑、切换角色再返回，都不会被旧回执擦掉。
3. 保存 A 日志转换草稿与直接将 B 日志转成候选，必须分别识别。回执除检查表单身份，还核对转换的日志 ID，不清理不相关的 A 草稿。
4. 保存按钮显示进行中并防止同一动作重复提交；失败保留输入，允许重试。反馈留在对应表单旁，使用现有明暗主题文字色和可访问状态区域。
5. 共享输入控件的缓冲 key 包含项目、角色，转换表单还包含日志；避免外层草稿正确而输入框仍显示旧内容。日志转换表单的追踪等级和 Prompt 策略改为中文标签。

### 范围

- 页签和角色切换保留页内未提交输入；这不是持久化草稿系统，退出角色页或关闭程序后不保证恢复这些输入。
- 手动点击保存才写日志或事实，AI 候选仍需确认；默认仅记日志，不自动入账。
- 保留共享保存队列、SQLite/JSON、角色卡、状态推断和候选服务，没有新增数据库字段或模型调用。
- 本轮不改变已有状态值解析、已生效事实的自动保存或角色删除语义。

### 代码与复现

- `useCharacterWorkspaceDraft.ts`：按项目/角色隔离 fact、log、conversion 表单，保护迟到回执并记录保存反馈。
- `CharactersView.tsx`：沿用原有服务和队列，提交、清理与实际来源绑定。
- `CharacterStateLedgerPanel.tsx`、`CharacterStateLogPanel.tsx`、`characters.css`：进行中、失败/成功状态、输入缓冲 key 和中文选项。
- `validate-character-workspace-drafts.mjs`：运行实际视图动作，模拟延迟、失败和串行队列，不用源码匹配代替行为断言。
- `qa-hig-workspace.mjs`、`utils/qa-character-workspace.mjs`：真实 Electron 中切换两个虚构角色、填写、保存及回读隔离 SQLite。

```powershell
npm.cmd run test:single -- character-workspace-drafts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
node scripts/qa-hig-workspace.mjs
node scripts/qa-hig-workspace.mjs --packaged
```

### 验证与交付

- 12/12 实际视图行为测试通过，完整 `npm test` 为 144/144 验证脚本；类型检查和生产构建通过。
- 原架构检查依赖 `setLogSaveMode` 函数名，现改为检查作用域职责；“保存后恢复仅日志模式”的正确性由真实动作测试验证，且覆盖保存期间已选择新模式的例外。
- 生产 Electron 初测：`tmp/visual-qa/hig-workspace/after-DLqSL5/report.json`。截图复核发现脚本临时设定的深色会在保存后被持久化设置覆盖，因此不将该轮截图标签视为双主题保存的证据。
- 最终真实 Preview.16 EXE：`tmp/visual-qa/hig-workspace/after-AE8whB/report.json`，40 张截图。通过设置页真实选择并保存主题，每张截图前校验主题，浅/深色均完成 A/B 草稿隔离、事实与日志保存回读。七页在 1440/1024px 打开，角色三面板额外检查 800px；状态反馈在视口内且不遮挡控件。
- 全部使用隔离虚构 SQLite；没有 AI 请求、renderer 异常或剩余测试进程。没有触碰用户小说，没有消耗模型额度。
- `release/win-unpacked/Novel Director.exe` 与 `release/Novel Director Setup 0.1.6-preview.16.exe` 已同步；SQLite 启动 smoke 和仓库 Node 原生绑定检查通过。
- 安装包 SHA-256：`4299700C8E872A95A0C3B7CC126C91841C52326E43AFFB1120C8E03A78A3E5F6`。Preview.15 归档于 `releases/archive/v0.1.6-preview.15-2026-09-22T10-28-51-942Z/`。未签名、未上传 GitHub。
- 本地日志：`tmp/character-drafts-tests.log`、`tmp/character-drafts-build.log`、`tmp/character-drafts-package.log`、`tmp/character-drafts-packaged-ui.log`。

## English

This focused HIG follow-up isolates unsubmitted character forms by project and character, preserves newer edits across late save receipts, and binds log conversions to the submitted log. Pending saves cannot be duplicated; failure retains input and gives local feedback. Existing buffered inputs also receive scope keys. No generation, storage schema or candidate-confirmation rules change.

Drafts are page-local, not recovery across closing the page or application. Verification uses the real view actions with delayed queued saves and actual Electron operations against isolated synthetic SQLite data; no author data or model credits are used.

Preview.16 passes 12 behavioral cases, all 144 validation scripts, typecheck, build and packaged SQLite smoke. The final actual EXE run uses the real settings control for persistent light/dark themes, verifies each screenshot's theme and exercises scoped saves in both themes. It produces 40 screenshots, no AI calls, renderer errors or leftover processes. The installer and unpacked app are updated; the previous package is archived. Signing and GitHub publication are not claimed.

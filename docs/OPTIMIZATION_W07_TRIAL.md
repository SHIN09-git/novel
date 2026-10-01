# W07 正文优先工作区 / Prose-First Workspaces

更新日期：2026-09-07。范围仅限生产流水线、修订工作台和连续阅读，不做全站重设计。

## 简体中文

### 本批变化

- 流水线：生成配置和运行历史默认折叠为顶部工具条；正文成为主栏，诊断保留在右侧，窄窗口移到下方。没有草稿时显示任务区，任务输入不因页签切换而卸载。
- 修订：修改要求靠近生成按钮；有候选时优先展示候选、对比和接受操作。原文、审稿提示可展开，历史版本与事务提交保持不变。
- 阅读：保持多章连续滚动和正文居中，右侧保留简洁章号目录，窄窗口改为横向目录。字号、摘要和返回编辑集中在顶部；未保存编辑、候选暂存和版本恢复沿用原逻辑。
- 视觉：三个工作区使用统一的中性背景与文字层级，减少面板阴影和重复标题，保留浅色、深色主题。深色主按钮改用深色文字，避免浅底白字。
- 回归修补：目录跳转和当前章节判断统一使用阅读滚动区坐标，不再依赖外层 CSS 的 `offsetParent`；旧 `pending` 修订状态显示为“待确认”。

### 验收方式

使用仓库 `tmp` 下的隔离 SQLite、虚构长正文和真实 Electron 生产构建，不接触实际小说。测试会还原临时样例，并退出 Electron 和本地测试服务。

| 项目 | 本次结果 |
| --- | --- |
| 浅色/深色 × 四档窗口 × 三页 | 24 组，1280×720、1440×900、1920×1080、1024×768 |
| 仅任务书、无正文的切换 | 8 组主题/窗口组合，任务保持可见 |
| 默认正文和主动作 | 检查可见正文、相对宽度、遮挡、横向溢出和按钮文字对比度 |
| 折叠工具 | 使用真实指针展开配置、历史、目录、原文和报告，再还原状态 |
| W07 只读布局旅程 | 0 HTTP 请求、0 新 AI 调用；读取真实 main-process 调用状态验证 |
| 完整生产构建 UI 回归 | 56 项旅程、111 张截图，覆盖采纳、修订、恢复、阅读重写、候选撤销和任务编辑 |
| Windows 包内复测 | Preview.7 实际 unpacked 通过同一套 56 项旅程、111 张截图；SQLite 已确认 |
| 类型检查 / 全套验证 / 构建 | 均通过；125/125 验证脚本，W07 专项包含 12 组检查 |
| 乱码与发布检查 | 646 个文件扫描通过；发布准备 39 项、公开清理 31 项通过；`git diff --check` 通过 |

初轮截图复核发现深色按钮对比度不足，已修正；复测的启用主按钮最低对比度为 7.46:1。这个数字来自实际渲染颜色，不是源码颜色推测。它不是全站无障碍认证。

阅读测试明确区分“返回上次阅读位置”和“主动点击目录跳到章首”，等待平滑滚动停止后再断言，避免靠动画尚未执行时的瞬间位置误判通过。

### 复现与证据

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run native:electron
node scripts/qa-candidate-decisions-ui.mjs --prose-only
node scripts/qa-candidate-decisions-ui.mjs
npm.cmd run native:node
```

对安装包内的程序使用 `node scripts/qa-candidate-decisions-ui.mjs --packaged`；只查三页布局可再加 `--prose-only`。切换原生模块前先退出测试进程，不同时运行连接真实数据的预览。

- `scripts/validate-prose-first-workspaces.mjs`：12 组轻量组件、隔离与负向布局验证，已加入 `npm test`。
- `scripts/utils/qa-prose-first-workspaces.mjs`：真实窗口布局、颜色、指针与只读数据断言。
- `scripts/utils/qa-prose-first-fixture.mjs`：隔离长正文、任务和修订样例，零调用观测与恢复。
- `tmp/visual-qa/candidate-decisions/result.json`：生产构建原始结果；同目录保存截图。
- `tmp/visual-qa/candidate-decisions-packaged/result.json`：本批实际包内结果，以文件中的版本和日期为准。
- `tmp/w07-test.log`、`tmp/w07-build.log`、`tmp/w07-full-ui-qa.log`：本批验证输出。
- `tmp/w07-package.log`、`tmp/w07-packaged-ui-qa.log`：Windows 打包与实际包内操作输出。

本地交付（相对仓库根目录）：`release/win-unpacked/Novel Director.exe`；安装包：`release/Novel Director Setup 0.1.6-preview.7.exe`。构建于 2026-09-07，Electron 39.8.9；SQLite 打包启动检查通过。安装包 SHA-256：

```text
646CD517F0A38D6454472AFA0F61CB521765134B4CFBC63792539E66F862D11A
```

实际包内验收记录日期为 `2026-09-07T07:48:36.201Z`。打包后已恢复本机 Node 原生模块，测试 Electron 与临时服务均已退出。

### 保留边界

不改变正文生成、Prompt、审稿阈值、候选确认、Agent 权限和存储协议。UI 旅程里的生成/重写使用本地假服务，因此不能证明真实模型的写作质量、费用或响应速度。安装/卸载生命周期、代码签名、GitHub 上传和全站可访问性不在本批完成声明内。

下一优先项为 W08 的 Agent 世界资料管理与可撤回项目授权；之后才做质量/成本和长篇性能实测。其余范围继续按主计划暂缓。

## English

This batch focuses on the pipeline, revision and continuous-reading workspaces. Configuration and historical reports become disclosures, prose gains space, and revision actions stay near the candidate. Existing task persistence, candidate decisions, version commits and JSON/SQLite behavior are retained.

Production Electron QA covers three pages in light/dark themes at four viewport sizes, plus plan-only jobs. Pointer-driven disclosures, visible prose, overflow, button contrast and zero AI transport calls are checked against isolated synthetic SQLite data. Both the production-preview run and actual Preview.7 unpacked executable passed 56 journeys with 111 screenshots. Typecheck, all 125 validation scripts, build and packaged SQLite smoke passed. Artifact paths and SHA-256 are recorded above; GitHub publication is not claimed.

Reading navigation now measures chapter offsets relative to its actual scroll container. Regression checks distinguish anchor restoration from an explicit directory jump and wait for scrolling to settle. This is local UI verification, not a claim about paid-model quality, installer lifecycle or GitHub publication. Agent world management/project grants remain the next priority.

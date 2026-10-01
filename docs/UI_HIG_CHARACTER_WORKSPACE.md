# 角色工作区 HIG 优化 / Character Workspace

## 简体中文

2026-09-22，`0.1.6-preview.14`。在既有明暗主题、项目列表和 Prompt 页签基础上，继续使用 Apple HIG 的层级、分组、渐进展开和键盘可访问性原则，保留 Windows Electron 操作习惯。

### 改动

- 角色页拆成“角色资料 / 动态账本 / 状态日志”三个页签，账本和日志不再埋在长表单底部。页签保留表单挂载，切换不清空输入。
- 角色列表支持姓名、定位搜索；过滤不改变正在编辑的角色。选中项有持续高亮及 `aria-pressed` 状态。
- 账本先显示已生效状态，新建表单按需展开。追踪等级和引入策略使用中文；待确认候选数显示在账本页签。
- 移除角色编辑区多余外框，缩短默认文本框高度；长内容仍能滚动、换行和手动拉高。明暗主题使用既有令牌。
- 页签支持方向键、Home、End；日志章节、内容、保存方式有独立可访问名称。窄窗口改为单列，不挤压表单。

这次没有改变角色数据结构、生成逻辑、账本确认规则或 SQLite 保存协议。日志默认仍只记录日志；不自动生成事实，也不自动接受 AI 候选。

### 代码位置

- `CharactersView.tsx`：三个常驻页签面板及简化标题。
- `CharacterWorkspaceTabs.tsx`：页签、候选计数、键盘焦点。
- `CharacterListPane.tsx`：本地搜索及选中状态。
- `CharacterStateLedgerPanel.tsx` / `CharacterStateLogPanel.tsx`：账本分组、按需创建、中文标签及输入名称。
- `styles/views/characters.css`：主题、状态行、表单与窄窗口排版。
- `validate-hig-workspace.mjs`：14 项静态/组件检查。
- `qa-hig-workspace.mjs` / `utils/qa-character-workspace.mjs`：真实 Electron 交互、截图和隔离 SQLite 验证。

### 复现

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
node scripts/qa-hig-workspace.mjs
node scripts/qa-hig-workspace.mjs --packaged
```

源码生产窗口验收：`tmp/visual-qa/hig-workspace/after-FhDHYp/report.json`，40 张截图；七页明暗主题、1440/1024px，角色三个面板额外检查 800px，另含侧栏收起、减少动效及工作台 125% 放大。角色搜索、真实键盘页签、输入保留、日志单独保存均通过。测试使用虚构项目和隔离 SQLite，没有模型请求、renderer 异常或遗留测试进程。

不声称全站 WCAG 认证；真实读屏、触屏和全站 200% 缩放未包含在本轮验收内。

### 本地安装包

- `release/Novel Director Setup 0.1.6-preview.14.exe` 和 `release/win-unpacked/Novel Director.exe` 已同步。
- 包内七页/角色交互验收：`tmp/visual-qa/hig-workspace/after-ReKFuz/report.json`，40 张截图。
- 包内项目列表/Prompt 验收：`tmp/visual-qa/author-workspace/packaged-QtTJ04/report.json`，13 张截图。
- 两轮通过且无 AI/外网请求、renderer 异常或遗留进程。包内 SQLite 启动 smoke 和仓库 Node 原生绑定检查通过。
- 安装包 SHA-256：`D88127D0CC03B4DA1D713ECB883A464730B7D18CF0DA4B10EA0E8DFB05DAE97E`。
- 原 Preview.13 保留在 `releases/archive/v0.1.6-preview.13-2026-09-22T08-27-57-156Z/`。打包在隔离依赖副本中复用匹配的 Electron SQLite 绑定，没有替换仓库 Node 绑定。未上传 GitHub。

验证日志：`tmp/hig-characters-tests.log`、`tmp/hig-characters-build.log`、`tmp/hig-characters-package.log`。

最终 `npm.cmd run typecheck`、`npm.cmd test`（143/143 验证脚本）、生产构建和 `git diff --check` 通过；乱码扫描覆盖 724 个文件。安装包校验和与 `BUILD_INFO.json` 一致，尚未配置代码签名。

## English

Preview.14 extends the existing HIG-inspired Windows workspaces with a searchable character list and separate profile, ledger and log tabs. Forms remain mounted across tab changes. Existing facts come before an on-demand creation form; status labels are localized and keyboard/accessible input names are retained.

No character schema, generation, persistence or candidate-acceptance rules changed. The production Electron QA uses synthetic isolated SQLite data and no model calls. It covers seven routes, both themes, narrow character panels, real keyboard interaction and log-only persistence. See the report and reproduction commands above. Full assistive-device and 200% zoom coverage remain outside this pass.

The local Preview.14 installer and unpacked executable are updated. Packaged QA passed with 40 general/character screenshots and 13 project/Prompt screenshots; SQLite startup smoke also passed. The previous Preview.13 remains archived. No user data, model credits or root Node native binding were changed, and nothing was uploaded to GitHub.

Typecheck, all 143 validation scripts, production build and whitespace checks passed. The installer checksum matches its build metadata; the installer remains unsigned.

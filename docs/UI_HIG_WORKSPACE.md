# HIG 工作区优化 / HIG Workspace Adaptation

## 简体中文

后续更新（2026-09-22）：[作者工作区优化](./UI_HIG_AUTHOR_WORKSPACE.md) 覆盖项目入口、Prompt 页签、快照保存与修订编辑反馈，已随 Preview.13 安装包交付。以下 Preview.12 打包记录属于 9 月 14 日，作为历史验收保留。

2026-09-14，Preview.12。采用 `apple-hig-design` 的 WebView 适配路径，借鉴内容层级、可预期导航和可读性；不是 Apple 原生组件移植，也不是 macOS 仿制皮肤。

### 改动与边界

| 位置 | 原问题 | 本轮处理 |
| --- | --- | --- |
| 共用主题 | 浅色内容搭深色侧栏，写作页面另有配色 | 中性明暗底色，保留原有青绿色强调；共用语义色，不按页面重定义 |
| 导航 | 侧栏常驻占位，返回项目在底部 | 顶部收起/展开，返回项目入口前置；保留原分组与图标 |
| 工具栏 | 标题与保存状态抢占注意力 | 项目名、当前位置、保存状态分级，单一保存状态显示 |
| 角色 | 深色主题下浅色渐变底造成文字不可读 | 当前状态改为无框内容带，用分隔线组织信息 |
| 章节 | 1024px 时章节列表堆在正文前 | 列表与正文保持双列；更窄窗口仍可重排和收起侧栏 |
| 按钮 | 深色主按钮白字对比不足，部分次按钮无样式 | 明暗分别配置按钮前景色，补齐 secondary-button，移除位移动效 |
| 写作页面 | 独立配色容易与其他页面脱节 | 保留正文优先的布局规则，删除重复主题覆盖 |

侧栏展开宽度 220px、窄桌面 208px；工具按钮 36px、导航项最小 34px。以上是本项目的鼠标/键盘桌面取值，不是 Apple 的统一尺寸要求。系统字体优先使用当前平台字体，不引入 SF Pro 或苹果窗口按钮。

只更改表现与本地侧栏开合状态；生成、Prompt、审核、事务保存和版本链没有改动。侧栏开合不写入 AppData，退出项目后恢复展开。新工具栏图标使用 Lucide，原有用户指定导航图标保留，许可见第三方声明。

### 验证

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run qa:hig
# 打包后，直接检查 release/win-unpacked 中的实际 EXE
npm.cmd run qa:hig -- --packaged
```

轻量回归 `validate-hig-workspace.mjs` 已加入完整测试，覆盖语义、颜色对比、共享主题和隐藏导航。完整测试 138/138 通过，类型检查与生产构建通过。

真实 UI 使用生产 `out/` 的隔离副本启动 Electron 39.8.9，复用已验证的 Electron SQLite 绑定，不更换仓库 Node 绑定。虚构项目“钟楼来信”写入独立临时数据库；网络出口禁用，AI 接口仅接拒绝请求的本地服务。没有打开 F: 数据库，没有模型消费。

- 工作台、章节、角色、Prompt 构建器、生产流水线、修订工作台、连贯阅读共七页。
- 浅色/深色，各 1440×900、1024×900，共 28 张基础截图。
- 另有收起导航、键盘焦点/减少动态、800px 窗口和 125% 放大，共 32 张截图。
- 实测可用主按钮前景/背景对比度最低 7.40:1；门限为 4.5:1，不是全站 WCAG 合规声明。
- 生产、修订、阅读正文前两行可见、未遮挡，内容无横向溢出；导航展开/收起及键盘空格激活正常。
- 零 renderer 异常、零 AI 请求，所有测试 Electron 子进程已退出。

本机证据（忽略目录，不向源码提交虚构数据库）：

- 修改前：`tmp/visual-qa/hig-workspace/before-twIQvq/report.json`
- 修改后：`tmp/visual-qa/hig-workspace/after-c6Wux3/report.json`；同目录包含逐页截图。
- 实际发行 EXE：`tmp/visual-qa/hig-workspace/after-jIijBh/report.json`；再次完成同样的 32 张截图及全部检查，确认运行版本为 Preview.12。
- 完整测试：`tmp/hig-full-test.log`；构建：`tmp/hig-build.log`。

安装包和 `release/win-unpacked/Novel Director.exe` 均已更新为 Preview.12，独立用户目录的启动/SQLite smoke 通过。打包在隔离依赖副本中复用匹配的 Electron 绑定，仓库 Node 绑定仍通过检查。上一份 Preview.11 完整保留在 `releases/archive/v0.1.6-preview.11-2026-09-14T10-58-40-420Z/`。包信息与校验值见 `release/BUILD_INFO.json`、`release/SHA256SUMS.txt`；未上传 GitHub，未新增代码签名。

一次与完整测试同时运行的 UI QA 遇到 CDP 超时，记录在 `after-fuLsU6/report.json`，未记为通过；完整测试结束后单独重跑通过。建议单独运行 UI QA，不与其他 Electron 测试争用窗口焦点。工具有超时与进程清理，不自动点击 AI 或接受按钮。

### 保留限制

未执行真实屏幕阅读器、触屏设备、所有页面 200% 放大和高对比强制颜色测试；800px/125% 验证针对收起导航后的工作台，不能代替所有页面的移动端验收。现有大型表单仍可继续精简，本轮不重新组织业务页面。构建仍提示既有 `ChapterTaskEditService` 同时静态/动态导入，与本次视觉变更无关。

## English

Preview.12 adapts Apple HIG hierarchy, navigation and readability to the existing Windows Electron app. It retains the brand accent and existing navigation, unifies light/dark surfaces, adds a collapsible sidebar, improves chapter layout at 1024px and fixes dark character/primary-button readability. Dimensions are project choices, not Apple mandates. No model, approval, persistence or version-chain behavior changed.

Run the commands above. All 138 validation scripts, typecheck and production build passed. Real Electron QA uses an isolated synthetic SQLite profile and a matching packaged native binding without replacing the repository's Node binding. Seven routes × two themes × two desktop sizes plus collapse/keyboard/narrow checks yield 32 screenshots. Minimum sampled enabled-primary text contrast is 7.40:1; prose visibility and layout checks passed. No AI calls, renderer exceptions or surviving test processes. Paths above contain before/after evidence.

Run UI QA separately from other Electron tests: one concurrent attempt timed out and was not counted as a pass. Screen-reader, touch, forced-colors and full 200% zoom coverage remain unverified; narrow 125% checks cover the collapsed dashboard, not mobile support for every route. This is not a whole-application accessibility certification.

The Preview.12 installer and unpacked EXE are updated. Packaged startup/SQLite smoke and a second 32-screenshot QA run against the actual EXE passed; see `after-jIijBh/report.json`. The previous Preview.11 release is archived, the repository Node native binding remains unchanged, and no GitHub upload or new code signature was performed.

# 作者决定闭环 / Author Decision Trial

日期：2026-09-06。源码版本：`0.1.6-preview.2`。范围：全盘优化计划 W02/W03 的第二批可用切片，不代表 M1-M3 或全部 W01-W10 已完成。

## 简体中文

### 本批功能

- 草稿还没完成审稿时，可以明确选择“未完成审稿，直接采纳”。正式章节、提交和版本历史保留未审稿标记，已有失败报告仍在，不会变成虚假的通过报告。
- 当前采纳严格使用同项目、同任务、匹配当前正文的报告。严重问题与一般建议合并在一次确认里，不会由较轻提示掩盖较重问题。
- 采纳与生成过程分开：旧审稿步骤可以继续显示失败，但正文已被作者采纳后，顶部主动作仍可继续下一章。
- 收件箱支持“编辑后接受”：记忆、伏笔、时间线、阶段摘要与角色状态按作者字段编辑，不要求手改 JSON。取消不落盘；预览、实际值与变更前后记录保持一致。
- 角色状态按原值类型处理。数字空白或非数字不能默默归零；编辑余额是设置最终值，不会再执行旧扣减；列表去空去重，布尔值保持布尔语义。
- UI 和 Agent 的候选操作复用现有共享命令、指纹、SQLite 短事务和 JSON fallback。编辑不改变目标项目、来源身份或原风险证据。
- Agent 预览的可执行 amendment 不被摘要长度截断；展示快照可压缩，敏感文本递归脱敏并明确标记，原始命令的重试身份不变。
- 第一份已采纳的当前版本计入已保存历史，不再一边显示版本一边提示“暂无历史版本”；窄栏的标题与状态分行，避免互相挤占。

### 实现边界

| 文件/模块 | 目的 |
| --- | --- |
| `ChapterAcceptanceReviewService`、共享 trace 类型 | 定义并构建采纳时的真实审稿状态快照 |
| `ChapterCommitBundleService`、`commitBundles/chapterAcceptanceReviewValidation` | 校验当前正文、报告、版本与提交，保留旧数据兼容和幂等回放 |
| 采纳 Hook、主动作 Hook、草稿及版本历史面板 | 一次确认、未审稿标记、采纳后继续下一章 |
| `CandidateDecisionService`、`candidateDecisionAmendments`、normalizer | 类型化编辑、最终值计算、预览与原子接受 |
| 收件箱编辑器与样式 | 作者字段表单、变更预览、中文类别和挂接字段 |
| Agent 候选工具及文档 | 同义编辑/预览/接受、可重试命令、结构化返回边界 |
| 定向脚本、真实 Electron QA、发布脚本 | 回归与隔离桌面验收，区分源码和包内结果 |

### 验收与复现

本批的过程日志与最终结果分开记录，不能把失败重跑算作通过。定向脚本覆盖正文/报告绑定、取消、并发修改、原子回滚、幂等、类型值、跨项目隔离与旧数据；真实界面覆盖作者操作。

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run native:electron
node scripts/qa-candidate-decisions-ui.mjs
npm.cmd run native:node
npm.cmd run dist:win
node scripts/qa-candidate-decisions-ui.mjs --packaged
```

| 证据 | 本批状态 |
| --- | --- |
| 未审稿采纳定向测试 | 127/127 通过，无跳过；包括真实隔离 Node SQLite、首份版本计数和空状态 |
| 候选编辑定向测试 | 核心和 UI 定向脚本通过；Agent 22 项行为检查通过，包含长文本、数字/布尔/列表、脱敏与重放 |
| 真实生产 Electron | 最终 preview.2 的 16 项旅程检查通过、17 张截图；已采纳主动作与首份版本展示均回归 |
| 最终全套 typecheck/test/build | 均通过；108/108 验证脚本，不是 108 个断言 |
| `0.1.6-preview.2` 包内 smoke/UI | NSIS 打包与 smoke 通过；实际 unpacked 同一套 16 项旅程通过、17 张截图 |
| 公开扫描与运行环境 | 566 文件编码扫描、31 项公开清理检查通过；打包后 Node SQLite 探测通过 |

原始结果目录：`tmp/visual-qa/candidate-decisions/` 与 `tmp/visual-qa/candidate-decisions-packaged/`。重跑会更新这两个目录，发行身份必须结合 `result.json.runtimeInfo` 和 `release/BUILD_INFO.json` 核对。测试仅创建隔离 SQLite 和虚构故事内容，远程收费模型不参与，测试进程退出时清理自身 Electron/HTTP 服务。

本轮早期 UI 脚本两次失败分别来自项目进入后的等待不足、测试默认选中了旧任务；已改为等待页面和明确选择目标章节任务，不放松业务断言。另一处测试按不存在的固定按钮文案查找续写入口，现验证实际的“生成第 N 章”。同时添加真实 failed step fixture，避免仅凭“按钮存在”掩盖优先级错误。

最终截图复核另外发现首份当前版本未计入历史、窄栏标签挤压标题，均已修复并补回归。公开扫描也曾拦截仿 provider 密钥的测试常量，现仅在运行时拼出虚构测试值；检测规则和脱敏覆盖未放宽。

### 本地试用产物

- 安装包：`release/Novel Director Setup 0.1.6-preview.2.exe`。
- 免安装目录入口：`release/win-unpacked/Novel Director.exe`；使用整个目录，不单独复制该 EXE。
- 构建记录时间（UTC）：`2026-09-05T21:09:18.975Z`；Electron `39.8.9`。
- 包内界面实际读取版本 `0.1.6-preview.2`、模式 `packaged`、main 构建时间 `2026-09-05T21:08:49.979Z`。
- 旧 preview.1 已归档到 `releases/archive/`。新包未签名、未上传 GitHub；真实安装/卸载和跨版本升级尚未验收。

安装包 SHA-256（同时保存在 `release/SHA256SUMS.txt`）：

```text
28F682D755A507C05764957C55EF16927211C67AE378C9802A06CC889C8ACCCE
```

包内本地请求取消到连接关闭为 2ms；1280x720 候选正文顶部 442px、接受按钮顶部 248px。它们是本机功能验收观测，不是远程模型速度、文学质量或稳定性能分位数。QA 进程已退出，Node SQLite 绑定已恢复，不保留后台测试应用。

### 剩余范围

1. 高风险 Agent 项目授权与所有提交的真实 actor 收口仍属 W08，本批不放开自填确认标志。
2. 候选撤销的补偿提交、专项候选全部收口仍未完成；本批不能代替这些能力。
3. 阅读位置恢复、过期要求重新定位、快捷改写超范围结果保留继续按 W04 施工。
4. W05-W10 的其余调用体验、任务编辑、全站界面、长篇保存与效果评估继续保留完整范围。
5. 既有无采纳状态字段的历史提交按 legacy 兼容，不追写或伪造当时的审稿结果。
6. 真实安装/卸载/跨版本升级、代码签名与远程模型文学质量不由隔离 unpacked 测试证明。

## English

This second author-workflow slice adds explicit unreviewed acceptance, provenance visible in version history, typed edited-candidate decisions, before/after receipts and a next-chapter action that takes precedence over retained failed review steps after acceptance. It preserves the existing shared commands, short SQLite transactions and JSON fallback.

Verification uses synthetic data in isolated local databases and loopback AI only. Typecheck, all 108 validation scripts, the production build, NSIS packaging and packaged smoke passed. Final source and packaged Electron each passed 16 workflow checks with 17 screenshots. The focused acceptance suite passed 127/127 with no skipped native SQLite checks; Agent candidate decisions passed 22 behavior checks. The unsigned preview.2 installer is local only, not a GitHub release or an installer-lifecycle certification.

The full optimization goal remains active, including reading/revision continuity, broader Agent authority, UI consistency and measured long-novel performance.

# 候选暂存、调用状态与 Agent 修订 / W04-W05-W08 Trial

## 简体中文

日期：2026-09-06。目标版本：`0.1.6-preview.4`。这是全盘计划的第四批可试用切片，不代表 M1-M3 或完整 Agent 同权已经完成。包内状态、最终测试数量及校验和见下方验收记录；未自动上传 GitHub。

### 作者能用到的变化

1. 快捷重写候选自动暂存到现有本地项目数据。切换页面、重新打开程序后可以继续编辑。看到“候选已暂存”才表示保存完成；“暂存候选”可立即保存，失败时可重试。
2. 章节编辑与正式阅读共享同一章的候选；不同章节隔离。阅读页内联编辑与修订候选编辑有各自的目标，不互相覆盖。点击阅读栏的章号会切换对应候选，自然滚动不打断正在处理的候选。
3. 生成、编辑、暂存和放弃候选都不自动写入角色、伏笔或硬设定。章节编辑器应用时等待正文保存成功再清理候选；阅读页正式应用继续创建 RevisionCommit 和版本链。阅读内联编辑需另点“保存本章”。
4. 流水线和快捷重写可显示真实的等待响应、读取响应、退避重试与格式重试状态，以及模型和耗时。不用虚构百分比。取消沿用已有单次/整次运行取消逻辑。
5. 等待中的右键菜单收起不可操作的选项，只保留本次动作、状态、耗时和取消。
6. 未配置模型或未实际调用 AI 时，保留原文的本地模板不再冒充新重写结果，也不会替换已编辑的候选。

### Agent 修订入口

| 工具 | 用途 |
| --- | --- |
| `agent.getRevisionSessions` | 读取项目内修订会话、要求、候选及当前来源指纹 |
| `agent.getRevisionVersion` | 读取候选、来源是否过期、要求和版本指纹；全文显式选择 `detail: "full"` |
| `agent.createRevisionRequest` | 建立绑定当前正文的局部或整章修订要求 |
| `agent.generateRevisionVersion` | 通过工作台 AIService 生成待确认修订，重建现有修订上下文 |
| `agent.editRevisionVersion` | 编辑时派生新候选，保留被取代版本，不覆盖历史 |
| `agent.previewRevisionCommit` | 生成绑定精确正文和候选的提交预览 |
| `agent.applyApprovedRevisionCommit` | 明确确认预览后，通过现有 RevisionCommit 事务提交 |

先读取来源指纹，再创建要求、生成候选、审阅并预览提交，也可直接审阅界面内已有且来源有效的候选，无需伪造一次改写。`operationId` 用于同一命令重试，参数改变时用新的 ID。`confirm: true` 是 Agent 自身确认，不是人工审核。正式版本标记为“Agent 采纳修订”，提交内结构化 actor 关联 AgentRun 和预览；不伪造人工批准。仅有未关联草稿时可以生成候选，但正式章节提交仍需要有效章节目标。

工具与现有人类界面共享 revisionSessions/Requests/Versions、正文绑定、修订合并、AIService 和事务提交。新增工具需要重启已连接的 MCP 服务才能在客户端出现。无需 Computer Use，也无需 Agent 自己代替工作台模型生成正文。

### 实现边界

- `shared/types/quickRewrite.ts`、defaults/normalizer/collection 清单：兼容旧项目，增加 `quickRewriteDrafts`；SQLite 沿用通用 entity payload，无 schema 迁移。
- `QuickRewriteDraftService`、`quickRewriteDraftStore`、根级 Provider：同目标只保留一份暂存候选，编辑合并保存；晚返回的旧写入不能清掉新编辑。复用完整数据与 bundle 的共享保存队列。
- `useAiRewriteCandidate` 与三个编辑入口：恢复候选、使用新上下文继续改写、原文变化后保留结果并显式重新定位；不把完整 Prompt 存到候选。
- `AiCallProgressStore`、AIService/AIHttpClient、IPC/preload：主进程只保留短期调用元数据，终态数量和保留时间有界，无正文、推理文本或密钥。
- `AiCallProgress` 与流水线/右键菜单：仅正在运行时按作用域轮询，旧步骤结果不会冒充当前调用，旧桥接缺接口时只显示本地计时与不可用状态。
- `agent/revision/*` 与工具定义：实现七个修订工具；复用原持久化，不新建平行修订系统。
- `commitBundles/revisionCommitActor.ts`：集中校验正式采纳者及项目内运行/预览引用；旧的人类或模型辅助修订继续兼容。历史重放依据不可变提交，不重新套用后来的正文。
- 失败的候选清理保留最新编辑作为恢复内容；切页回来仍可读取，不把未落盘的放弃操作伪报为已完成。

### 验收命令

```powershell
node scripts/validate-quick-rewrite-persistence.mjs
node scripts/validate-ai-call-progress.mjs
node scripts/validate-ai-call-progress-ui.mjs
node scripts/validate-agent-revision-tools.mjs --require-native
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run native:electron
node scripts/qa-candidate-decisions-ui.mjs
npm.cmd run native:node
npm.cmd run dist:win
node scripts/qa-candidate-decisions-ui.mjs --packaged
git diff --check
```

隔离数据均位于仓库 `tmp/`，使用虚构中文小说和 loopback HTTP stub，不连接真实小说或付费模型。Native Agent 验证与模拟事务故障验证分别报告，模拟结果不冒充真实 SQLite。UI 原始记录：`tmp/visual-qa/candidate-decisions/result.json`、`tmp/visual-qa/candidate-decisions-packaged/result.json`，截图在对应目录；重复运行会替换本批临时结果。

### 本批验收记录

验收日期：2026-09-06（UTC+8）。本次修改后实际执行，不沿用早期 preview 的通过结果。

| 验证 | 结果 |
| --- | --- |
| 类型检查 | 通过 |
| 完整 `npm.cmd test` | 115/115 个验证脚本通过，不将脚本数当作断言数 |
| 快捷候选持久化 | 9 条行为检查通过，含保存失败、失败清理、并发较新编辑及 JSON/SQLite |
| 快捷重写结果 | 15 条行为检查通过，含离线模板不能覆盖已有候选、继续改写失败保留结果 |
| AI 调用阶段 | 13 条检查通过；另有 UI 状态/清理契约验证 |
| Agent 修订 | 54 条检查通过，包含 3 条真实 native SQLite；故障注入另用模拟事务边界 |
| 生产构建与 Windows 打包 | `dist:win` 中的 build、native rebuild、NSIS 与 packaged smoke 均通过 |
| 最新 unpacked 真实 UI | 31 条旅程检查、21 张截图；隔离 SQLite，实际候选输入、导航、reload、接受和放弃 |
| 架构、乱码与公开清理 | 全量测试内通过；乱码扫描 604 个文件，公开清理 31 项 |
| Native 收尾 | 打包后恢复 Node 绑定，`native:check:node` 通过；测试 Electron 已退出 |

原始日志：`tmp/preview4-final-tests.log`、`tmp/preview4-agent-native.log`、`tmp/preview4-dist-win.log`、`tmp/preview4-packaged-qa.log`。最新包内结果为 `tmp/visual-qa/candidate-decisions-packaged/result.json`，时间 `2026-09-05T22:48:44.742Z`。此前 production preview 截图仅作历史对照，最新发行代码的界面结论以上述 packaged 运行结果为准。

人工复看了等待菜单与 1024x720 阅读候选截图：等待菜单不再陈列不可操作项，候选正文/对比与底部应用动作均可见。最新 UI 测试的取消到连接关闭为 3ms，整条取消后重试场景为 2707ms；这是本地 loopback stub，不代表 DeepSeek 或 Codex 的真实延迟，也不是文学质量测量。

### 本地试用产物

- 直接运行：`release/win-unpacked/Novel Director.exe`。
- 安装包：`release/Novel Director Setup 0.1.6-preview.4.exe`。
- 校验和与身份：`release/SHA256SUMS.txt`、`release/BUILD_INFO.json`。
- 包生成时间：`2026-09-05T22:48:34.389Z`；应用内源码构建时间：`2026-09-05T22:48:09.838Z`。
- Electron：39.8.9。安装包未签名（`NotSigned`）；尚未上传 GitHub，不声称完成真实升级/卸载验证。

安装包 SHA-256：

```text
F051F2A86B67CC8D9B2D01728CF038B2FBFD2E02FD1B6067EDDF54BA6130A7B9
```

### 仍需继续的工作

- 快捷候选是每个编辑目标一份的暂存，不是另一个候选版本库。会保存原文基线与候选正文以便比对，长期大型项目仍需测量全量 AppData 保存成本。
- 自动保存有短暂合并窗口。看到保存成功再关闭；保存失败应先重试或复制。切换数据位置前仍应处理未保存内容。
- 调用状态不等于 token 流或模型思考过程。部分 CLI 调用只提供等待和终态；不能据此承诺真实服务商的生成速度或文风质量。
- Agent 局部修订目前要求目标文本唯一；重复片段需给更明确范围。独立草稿可以修订，但未关联章节时不能伪造正式章节提交。
- 正式 Agent 修订正文/版本是一笔数据库事务，预览回执另存；崩溃后重试可修复回执，不回滚后来正文。尚非跨正文、全部 Agent 日志的单一事务。
- 项目级高风险授权、候选撤销、更多世界状态编辑、真实模型质量 A/B 仍按主计划推进。没有完成真实安装/卸载/跨版升级、签名和 GitHub 发布。

## English

This preview adds durable quick-rewrite editing drafts, scoped live AI call status and seven Agent revision tools. Pending text never becomes canon automatically. Reader adoption remains a versioned RevisionCommit; Agent acknowledgement is explicitly not human approval.

Candidates use the existing AppData/SQLite/JSON path and shared save queue. Progress retains only bounded metadata, never prose, prompts, reasoning or credentials. Agent revision generation reuses the existing AI service, source binding, merge and transaction paths. Restart an existing MCP connection to discover new tools.

The commands above distinguish native SQLite checks, simulated failure injection and real Electron UI QA. Synthetic fixtures and loopback providers prove workflow behaviour, not paid-provider quality or speed. Full-plan completion, cross-device persistence, signed distribution and installer upgrade testing are not claimed.

Preview.4 is locally packaged: typecheck, all 115 validation scripts, build and packaged smoke passed. The actual unpacked app passed 31 journey checks with 21 screenshots; Agent revision validation passed 54 checks including 3 native SQLite cases. Packaging restored the Node binding, and test processes exited. The unsigned installer and SHA-256 above identify this exact local build. The full optimisation plan remains active.

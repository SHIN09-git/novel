# 首批作者闭环试用 / First Author-Workflow Trial

日期：2026-09-06。版本：`0.1.6-preview.1`。这是全盘优化计划的首批集成切片，不是 M1-M3 或 W01-W10 全部完成。

本页保留 preview.1 当时的验收历史，旧包现已归档。当前第二批 preview.2 的功能、测试和产物见 [作者决定闭环试用](./OPTIMIZATION_W02_W03_TRIAL.md)。下方共享的 `release/`、QA 结果路径会随新批次更新，核对历史时必须看版本和时间，不能把最新文件当成本页原始证据。

## 简体中文

### 本批交付

- **候选决定**：记忆和角色状态复用共享预览/提交命令、SQLite 事务和 JSON fallback；幂等重放不会重复入账。接受候选不会自动采纳正文。
- **预览可信**：按补丁指定的章节 ID/章序定位目标，不误用 job 的默认章序。目标正文变化会使预览失效。物品移除、物品新增和资源增减复用真正入账计算，不把操作数显示为剩余值。
- **报告来源**：候选报告限定项目、来源草稿和正文。历史/无法核实来源的结果明确提示，不冒充当前通过；单纯缺失旧字段不新增阻断规则。
- **修订可用**：问题可直达修订要求；待接受正文和操作前置，原文折叠保留。模型在修订工作台返回超出选区的内容时保留为整章候选，由作者明确决定，不丢掉结果。
- **历史恢复**：首次修订前保存在 commit `beforeText` 中的正文可直接从 UI 恢复，形成一个新提交，旧版本保留。
- **请求取消**：章节、阅读、修订候选编辑器的直接 AI 重写支持“取消本次”；旧 bridge 没有单请求取消能力时保留兼容提示。切换对象后迟到结果不会落到新章节/修订版本。
- **运行可辨认**：设置页的“运行信息”显示应用版本、构建时间、Electron、程序位置、数据位置。桌面发行版不凭路径猜测是安装版还是 unpacked。

### 代码边界

| 文件/模块 | 目的 |
| --- | --- |
| `CandidateDecisionService`、`MemoryCandidateService`、`AuthorDecisionPolicyService` | 统一候选目标、来源风险与预览指纹 |
| `characterState/stateMutations`、`CharacterStateService` | 预览和入账共用状态事务计算 |
| `useMemoryCandidates` | 旧候选入口接入来源说明，兼容缺字段数据 |
| `ChapterVersionChainService`、章节版本 UI/动作 | 展示并恢复提交中的首次修订前正文 |
| 修订生成/接受动作、`RevisionComparisonPanel`、修订样式 | 超范围候选保留、一次确认、候选优先布局 |
| AI main service/IPC/preload、`AITransport`、重写组件与请求 Hook | run/call 级取消、旧 bridge 兼容、对象切换隔离 |
| `RuntimeInfoService`、运行信息 IPC、设置面板、Vite main define | 显示实际运行版本和构建时间 |
| 验证脚本、隔离 Electron QA、发布扫描 | 行为回归、真实桌面验证及扫描误报修复 |

### 验证记录

| 验证 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd test` | 106/106 验证脚本通过；不是 106 个断言 |
| `npm.cmd run build` | 通过，真实生产构建 |
| 中文编码扫描 | 通过；完整回归时 557 个文件，补充本文后复扫 558 个文件 |
| 公开发布清理检查 | 31 项通过，包括正常文件名阴性与独立 token 阳性样本；不等于第三方历史 secret scan |
| 生产构建 Electron UI | 12 项旅程检查、13 张截图通过；隔离 SQLite |
| Windows 打包/包内 UI | NSIS 打包、包内 smoke 通过；连续两轮 12 项旅程检查通过；未上传 GitHub |

生产构建 UI 的原始数据：`tmp/visual-qa/candidate-decisions/result.json`。

| 实测项 | 本机结果 | 定义 |
| --- | --- | --- |
| 小屏候选正文顶部 | 442 px | 1280x720，不通过自动滚动伪装首屏可达 |
| 小屏接受按钮顶部 | 248 px | 待接受候选主操作 |
| 小屏空状态修改要求顶部 | 552 px | 输入高度 89 px |
| 取消到 HTTP 连接关闭 | 3 ms | 真实 Electron/preload/main，loopback 服务保持连接等待 |
| 取消后再次重写 | 通过 | 共两次本地请求，仅替换选区，持久化后重读一致 |
| 历史恢复 | 通过 | UI 点击、确认、事务保存，恰好新增一个章节版本，旧版本仍在 |

以上是一次本地功能实测，不是远程模型延迟统计，也不能推导生成质量或整体性能提升百分比。等待时显示取消按钮；取消成功不能承诺服务商已经停止计费。

### 可复现命令

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

QA 仅使用 `tmp/visual-qa/` 内的新建虚构项目和本机 HTTP stub；没有读取或写入真实小说数据库，没有调用收费模型。脚本退出时清理自己启动的 Electron 和本地服务，保留用户原有进程。`dist:win` 会在结束时恢复 Node 的 SQLite 绑定。

### 产物状态

本批已生成本地试用产物，并从 `release/win-unpacked/Novel Director.exe` 完成同一套旅程验证。安装包为 `release/Novel Director Setup 0.1.6-preview.1.exe`；构建时间（UTC）为 `2026-09-05T19:45:37.563Z`，SHA-256：

```text
1B17084F7DAB64D150F90E8F437B9658F5D5CBEC51C7885E7290A929E7F87F07
```

原始记录见 `release/BUILD_INFO.json`、`release/SHA256SUMS.txt` 和 `tmp/visual-qa/candidate-decisions-packaged/result.json`。旧 `0.1.5` 产物已移入 `releases/archive/`。安装包尚未签名，也未上传 GitHub。

两轮包内旅程分别记录于 `tmp/optimization-packaged-ui-run1.json` 与上述最终 `result.json`；均使用新建隔离库，测试结束后没有遗留测试 Electron/HTTP 服务。Node `v24.14.0`（ABI 137）的 SQLite 内存库探测通过。

包内首次 UI 测试曾在候选编辑保存处超时：脚本直接修改 DOM 值并依赖 50ms 后失焦。已改为 CDP 原生文本输入与鼠标焦点切换，不放宽保存断言；同一个包随后完成编辑、事务保存、重载与恢复。另一次测试窗口连接中断已作为失败处理，未记为通过。

### 明确未完成

1. 显式“未审稿直接采纳”及对应审计语义仍待 W02 实施。
2. 候选编辑后接受、专项候选撤销、项目级 Agent 创作授权仍待 W03/W08。
3. 阅读位置恢复、过期修订要求重新定位、直接文本重写的超范围结果保留仍待 W04；本批整章候选保留针对修订工作台主流程，不能泛化为全部快捷入口。
4. 单请求取消已覆盖直接重写入口，其他 AI 入口的精细等待阶段和取消仍按 W05 推进。
5. Windows 签名、真实安装/卸载和跨版本升级未包含在本批隔离 unpacked 验收中；不声称已安装版完整验收。
6. 新布局已验证 1280x720 与 1440x900，但尚未做所有 DPI、全部页面或辅助技术矩阵。
7. W06-W10 继续按原计划执行；不以这次 UI 改善代替生成质量 A/B、长篇保存或检索效果测量。

## English

This local trial integrates existing workflow components without rewriting generation or touching real project data. Candidate previews share target resolution and state arithmetic with persistence. Revision candidates and acceptance controls are visible in compact windows. Pre-revision text retained in commits can be restored as a new version. Direct text rewrites support scoped per-call cancellation and ignore stale responses after switching editing objects. Settings exposes runtime identity.

Typecheck, production build and all 106 validation scripts passed. The isolated production Electron journey passed 12 checks with 13 screenshots. Loopback cancellation closed the held HTTP connection in 3 ms in this single functional run; this is not a remote-provider performance or quality claim. JSON fallback, SQLite transactions and existing version history remain covered.

Artifact readiness is recorded separately in build metadata and packaged UI results. This is not a GitHub release, and the full optimization roadmap remains active. Unreviewed acceptance, edited-candidate decisions, undo, reading-position restoration, broader quick-rewrite responses, complete Agent authorization and measured long-novel performance remain explicit follow-up work.

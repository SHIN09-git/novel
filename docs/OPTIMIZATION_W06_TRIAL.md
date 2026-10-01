# 章节任务编辑与保存闭环 / W06 Trial

## 简体中文

日期：2026-09-06。目标版本：`0.1.6-preview.6`。本批收尾全盘计划的第一优先项 W06/W01，不表示剩余三项已经完成，也不表示已经发布 GitHub Release。

### 作者操作

1. 打开生产流水线，选择一次已有运行，再切到“任务书”。直接编辑本章目标、核心冲突、结尾、字数或表达要求。“更多任务要求”中保留悬念、允许回收、禁止揭示和读者情绪。
2. 点击“保存任务”。系统另建一次待生成任务，原任务、草稿、报告和正式正文保留。这个动作只准备上下文，不调用模型。
3. 查看准备结果。仅改文风时，完整的旧计划和事实切片可以复用；改篇幅会更新预算；改目标、冲突或伏笔要求则重新选择相关资料，再生成计划。旧上下文不完整、预算放不下或旧首章缺任务快照时，明确改为重新准备。
4. 点击“按此任务生成”，才开始模型调用。失败后可以重试失败步骤，已经完成的前序步骤保留。
5. 想写另一章时，在配置里选择目标章号，或点击“编辑新章节任务”。选择新的手动快照会切换到该快照任务，不会继续旧的自动任务。

编辑中的任务不会自动保存。切换“任务书/草稿”标签保留本地输入；切换运行前会询问是否放弃。任务未保存时，生成、重试和跳过不会偷偷使用旧要求，章号/快照配置暂时锁定。保存失败仍保留输入，可以继续修改或重试。

### 复用边界

- 作者任务仍是本次运行的明确要求，沿用现有 PromptBuilder、需求规划、预算选择和计划后二次补全，不另造简化 Prompt。
- 文风/篇幅分支冻结原事实上下文，不自动把期间新增资料混进来；需要最新资料时另建任务。历史报告可查看，但不作为新运行的通过结果。
- 手动快照不被改写；在快照任务上改要求，需明确同意另建自动上下文。原快照继续保留。
- 新准备上下文时，排队保存发现同项目相关资料已变化，会保留编辑并提示再次保存，不悄悄提交过期事实。无关项目变化不构成冲突。
- 从旧运行派生时保留原模型配置和输出上限；仅增加目标字数不会暗中切模型或提高模型上限。
- 首章旧运行没有独立任务快照时，不复用可能混入后期事实的上下文。

### 实现范围

| 文件/模块 | 目的 |
| --- | --- |
| `ChapterTaskEditService`、`chapterTaskEdit/prepareTaskContext` | 分类任务影响、派生新运行、复用或重建上下文，保存时不调用模型 |
| `chapterTaskEdit/contextSourceBinding` | 保存队列内验证新上下文的数据来源，签名不写入历史 |
| `shared/types/generation`、`normalizers/generation/appData` | 任务编辑来源和恢复步骤；旧数据默认空编辑记录 |
| `GenerationPipelineView`、`useChapterTaskEditing`、`useSelectedPipelineJob`、`usePipelinePrimaryAction` | 编辑、快照、生成与重试接线；专用 bundle 保存透传 |
| `PipelineTaskEditor`、`PipelineCurrentArtifactPanel`、`PipelineConfigPanel`、相关样式 | 九字段表单、未保存提醒、隐藏保留输入、窄窗口布局 |
| `ChapterTaskContractService`、三个 `chapterTaskContract*` 工具 | 只把明确字数/字面约束作为本地硬检查，情节语义与软建议留给审阅 |
| `main/ipc/aiChatValidation` | 修复普通 HTTP 模型被未使用的空 Codex CLI 配置阻断；CLI 自身配置仍严格验证 |
| 新验证脚本和真实 Electron QA helper | 事务回读、故障注入、任务复用、页面保存/切换/重试 |

专用链路沿用 `GenerationPipelineView -> usePipelineRunner / useChapterTaskEditing -> useAppData -> preload / IPC -> StorageService`。每次 bundle 是短事务，不是整章生成长事务；JSON fallback、共同保存队列和 revision 校验继续使用。专用接口失败不通过普通保存绕过校验，只有旧桥缺少方法时才走兼容路径。

### 验证与复现

```powershell
node scripts/validate-pipeline-bundle-handoff.mjs --require-native
node scripts/validate-chapter-task-editing.mjs
node scripts/validate-pipeline-task-editor.mjs
node scripts/validate-chapter-task-contract-generic.mjs
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run native:electron
node scripts/qa-candidate-decisions-ui.mjs --task-editor-only
npm.cmd run native:node
npm.cmd run dist:win
node scripts/qa-candidate-decisions-ui.mjs --packaged
git diff --check
```

QA 使用仓库 `tmp/` 下的隔离 SQLite、虚构任务和仅监听回环地址的模型 stub。页面测试实际输入、点击、刷新，不以种入成功结果代替操作。Node 与 Electron 的 SQLite 绑定不同，不能在测试运行期间切换；打包脚本完成后恢复 Node 绑定。

本批源码验收：`typecheck`、完整 `npm test` 的 124/124 个脚本、生产 `build` 均通过。专用保存交接包含 22 项检查，其中 12 项实际使用原生 SQLite；任务编辑专项 16 项通过，没有跳过原生存储用例。

生产 Electron 任务编辑 QA 通过 9 项旅程、保存 5 张截图。编辑、保存、重置、刷新和窄窗口检查期间模型请求为 0；明确生成后，回环 stub 收到 `plan 200 -> draft 503`，重试只增加 `draft 503`。三个请求均携带九项当前任务和冻结模型，七个成功上游步骤没有重算。这验证请求与恢复链路，不证明远程模型的成文质量。

2026-09-06 已完成 Windows 打包和包内启动检查，实际 unpacked 完整 QA 通过 53 项旅程，保存 31 张截图。包内任务编辑再次验证了零自动请求和 `plan -> draft -> draft` 的失败恢复链路。安装包为 `release/Novel Director Setup 0.1.6-preview.6.exe`，直接运行目录为 `release/win-unpacked/Novel Director.exe`；SHA-256 已与 `release/BUILD_INFO.json` 核对。未执行安装/卸载生命周期测试，也未上传 GitHub。

原始输出：`tmp/w06-test.log`、`tmp/w06-build.log`、`tmp/w06-package.log`、`tmp/visual-qa/pipeline-task-editor/result.json`、`tmp/visual-qa/candidate-decisions-packaged/result.json`。640 文件乱码扫描、31 项公开清理检查、39 项发布就绪检查与 `git diff --check` 通过；Node 原生绑定已恢复。测试数据库和日志不提交仓库。

### 仍保留的限制

本地任务校验不是通用中文语义理解。人物决定、禁写情节等无法可靠确定的条件只给待核对提示；明确字数、引号短语次数和禁词仍可检查。单一字数目标沿用产品 80% 明显不足策略，并说明这不是作者明示下限。

不把“生成配置”的模型上限自动调整为目标篇幅，也不自动重新创作已完成计划。真实远程模型的成文质量与最终采纳成本仍待第四优先项实测。未保存任务跨整个页面关闭的恢复、Agent 专用任务编辑工具与项目授权属于后续工作。

## English

Preview.6 finishes the first narrowed priority: editable chapter tasks and transaction-backed run checkpoints. Edit nine task fields in the pipeline task tab, save a separate idle run without an AI call, then explicitly generate. Style-only edits can reuse a complete prior plan and frozen fact slice; length edits update budget metadata; plot edits prepare fresh needs and context. Missing history, oversized prompts and legacy opening-chapter context fall back to fresh preparation.

Manual snapshots stay unchanged. New runs never inherit old draft/report acceptance. Unsaved input survives artifact-tab switches; generation, retry and skip require saved input. Snapshot and target changes select a new task instead of launching a previously selected automatic run. A fresh-context save rejects changed relevant source data after queueing; unrelated projects do not invalidate it.

The shared bundle queue, short SQLite transactions, JSON fallback and revision checks remain in use. Deterministic contract checks now separate literal author constraints from uncertain story semantics and suggestions. HTTP providers no longer reject unused blank Codex CLI settings; the CLI provider still validates them.

Typecheck, all 124 validation scripts and production build passed. The production Electron task journey passed 9 checks with 5 screenshots: no AI requests during editing or saving, then one plan request and two prose attempts across an explicit generation and retry. All requests carried the saved task and frozen model; completed upstream steps were preserved. Tests use isolated native SQLite and a loopback stub, not paid generation or user data. Windows Preview.6 packaging and startup smoke passed on September 6; the actual unpacked application passed 53 journeys with 31 screenshots. Installer lifecycle and GitHub publication are not claimed.

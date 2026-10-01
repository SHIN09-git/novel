# 更新日志 / Changelog

## 简体中文

### 0.1.6-preview.18 - 界面更新打包

- 将本轮已有的 Ink Desk 界面改动纳入安装包和 `win-unpacked`：深色导航、雾蓝操作色、正文纸面，以及页面、弹窗、进度反馈的统一样式和动效。
- 同步角色、伏笔、剧情导向、硬设定、阶段摘要、流水线、修订和阅读等页面的现有布局调整，保留已有业务流程与小说数据。
- 当前发行目录只保留新版；清理更早的重复发行产物，保留 Preview.17 回退包。验证与清理范围见 [发行产物说明](./docs/RELEASE_ARTIFACTS.md)，实际包状态以 `release/BUILD_INFO.json` 为准。

### 0.1.6-preview.17 - 后端性能与初始化稳定性

- 自动备份先判断是否到期，避免每次步骤保存都读整本小说；备份使用临时文件发布，按存储实例隔离在途请求，切库后的旧保存明确失败。
- 旧任务模式恢复使用一次索引；进度轮询避免重复排序，日志省去逐行目录检查，并发限流等待者分别预留额度。
- Novelty 审计只在单次同步调用内复用相同文本匹配，正文变化后重新计算，不缓存旧报告。
- SQLite 首次打开与迁移去除重复连接，迁移读写/备份失败不再误用空数据覆盖，保留 JSON fallback、版本校验和短事务。
- 新增隔离后端基准与行为回归，详情见 [后端性能复核](./docs/BACKEND_PERFORMANCE_REVIEW.md)。

### 0.1.6-preview.16 - 角色输入隔离与保存反馈

- 新建状态、日志及转换表单按项目/角色保留页内草稿，切换角色不再串用内容。
- 保存回执绑定本次输入和来源日志，保留保存期间新写的内容；失败保留输入，同一操作保存中防重复点击。
- 补齐中文选项和就近保存反馈，不改变日志、候选和正式账本的确认规则。

### 0.1.6-preview.15 - DeepSeek Flash 名称兼容

- 官方 `deepseek-flash` 和旧 Vision Flash 别名沿用原有非思考请求模式，避免仅改模型名就意外开启服务商默认思考。
- 保留官方主机限定，不向第三方兼容端点或未知模型添加该参数；不修改作者已保存的模型设置。
- 新增实际请求体回归；付费模型对照因隔离执行器缺少凭据，按作者许可跳过，费用 0 元，不宣称质量或时延收益。

### 0.1.6-preview.14 - 角色工作区

- 角色资料、动态账本与状态日志改为独立页签，支持方向键、Home/End，切换保留输入。
- 新增姓名/定位搜索，账本先呈现已有状态；新建状态表单按需展开。
- 状态标签使用中文，补齐日志输入的可访问名称、明暗主题和窄窗口布局。
- 仅调整界面组织；未修改生成、存储、候选确认或角色卡内容。

### 0.1.6-preview.13 - 作者工作区与编辑反馈

- 项目列表前置并增加搜索，新建按需展开；保存失败不跳页、不丢输入。
- Prompt 构建器分为任务、Prompt、上下文和历史，统一操作区，支持键盘切换。明暗主题和窄窗口沿用既有 HIG 设计。
- Prompt 文本和任务/快照来源保持绑定，手动编辑后重建先确认；修订保存的迟到回执不再覆盖较新的输入。
- 历史版本详情使用对应版本的审稿来源，避免把后续报告冒充当时结果；空正文可以恢复已有历史版本，仍保留版本链和过期提交校验。
- 采用隔离虚构数据验收，不读取或迁移用户小说，不调用模型。实际包状态见 `release/BUILD_INFO.json`，操作证据见 [作者工作区验收](./docs/UI_HIG_AUTHOR_WORKSPACE.md)。

### 0.1.6-preview.12 - 统一工作区与写作视野

- 参考 Apple HIG 的层级、导航与可读性原则，适配 Windows Electron，而不是模拟 macOS 窗口。
- 侧栏跟随浅色/深色主题，可通过顶部图标收起；返回项目入口前置。收起后隐藏导航退出键盘焦点顺序，保留跳转工作区入口。
- 统一按钮、文字与表单配色，修复深色角色状态区域的浅色背景、章节标题栏和 Prompt 页次要按钮的显示问题。
- 1024px 窗口下章节列表保留在正文左侧；生产流水线、修订和连贯阅读沿用正文优先布局。生成、审核、保存及版本链规则不变。
- 验证方法与真实 Electron 截图见 [HIG 界面验收](./docs/UI_HIG_WORKSPACE.md)。无用户数据迁移或模型调用。

### 0.1.6-preview.11 - 修复草稿采纳的生成记录误冲突

- 修复运行时记录与数据库标准化字段不同，导致采纳草稿误报 `GenerationRunTrace is immutable`。提交和校验共用既有标准化规则，不要求重新生成正文。
- 同时统一质量、一致性和冗余报告的提交形态；仍核对当前正文、最新报告、真实证据和上下文，不放宽历史提交的不可变性。
- 增加运行时记录到 SQLite/JSON 的采纳回归，保留重复提交、事务失败回滚和跨项目保护。没有改写作者数据或自动接受候选。
- 根因、复现和验证范围见 [采纳误冲突修复记录](./docs/FIX_DRAFT_ACCEPTANCE_TRACE.md)。

### 0.1.6-preview.10 - Agent 项目概览读取优化

- 项目列表、摘要、下一章目标与待确认计数仅读取所需集合，不再展开全书历史 Prompt、版本和生成步骤；完整详情和写入不变。
- 数据与 revision 使用同一个只读 SQLite 事务，JSON fallback 保留。概览类型与完整 AppData 隔离，不用于保存。
- 同条件 500 章项目摘要 p50 从约 397ms 降到 32ms，四个工具输出保持一致。不是界面启动或模型生成性能结论。
- 回归、原始结果和启动边界见 [Agent 概览实测](./docs/OPTIMIZATION_AGENT_OVERVIEW_READ.md)。本批没有付费模型调用。

### 0.1.6-preview.9 - 长篇保存实测与局部优化

- 完整 AppData 保存保持原 API 与短事务，只改动发生变化的实体，不再因编辑一章重写全书历史；删除、导入、重复 ID 拒绝和 revision 冲突保护保持原语义。
- 生成步骤保存仅读取当前 job 校验所需的四类报告/草稿，不再加载全部历史正文。正式采纳与修订仍走既有提交链。
- 新增 10/100/500 章实际 SQLite 与生产 Electron 基准，保留逐轮数据；界面指标不拿纯函数测试代替。
- 新增正式采纳链成本归集工具，按调用 ID 去重，旧修订/缺失 usage 标为未知，不把模拟样本宣传成真实模型省费或提质。
- 结果与限制见 [W09/W10 实测记录](./docs/OPTIMIZATION_W09_W10_MEASUREMENT.md)。没有新增 AI 调用或扩大业务流程。

### 0.1.6-preview.8 - Agent 创作与项目授权

- 作者可在 Agent 页按项目、数据源、章节范围和动作授予或撤回权限；范围内不需要逐次人工批准，撤回不删除已有版本。
- Agent 可以读写角色九项字段、动态状态、伏笔、时间线、HardCanon 和剧情导向；预览、变更前后和操作来源保留为项目记录，不自动把模型建议变成设定。
- 任务修改复用桌面编辑逻辑，保存独立的新运行并返回继续执行入口，不调用模型、不覆盖旧草稿和快照。
- 明确采纳绑定当前正文、报告和目标章节；获授权的导演可以不同意失败报告或选择未审稿采纳，但不能伪造通过。正式写入和重复重试沿用事务与版本链。
- Agent 页可读取最新数据，供作者接手；授权不随项目 JSON 导入导出迁移。操作说明见 [项目授权指南](./docs/AGENT_PROJECT_AUTHORIZATION.md)。

本地包与验收状态以匹配版本的 `release/BUILD_INFO.json` 为准，不代表已经上传 GitHub。

### 0.1.6-preview.7 - 正文优先的工作区

- 流水线的配置与历史收为顶部工具条，正文和任务优先；无草稿时不再因残留页签显示空白。
- 修订页将候选、对比和接受操作前置；原文与审稿提示按需展开，保留既有事务保存和版本链。
- 阅读页正文居中、简洁目录与统一工具栏；跳章改用滚动区相对坐标，保留选区重写与阅读位置恢复。
- 三页统一浅色/深色样式，修复深色主按钮文字对比度和旧状态英文标签。
- 增加真实 Electron 四档窗口、双主题和完整流程回归，范围与限制见 [W07 试用记录](./docs/OPTIMIZATION_W07_TRIAL.md)。

### 0.1.6-preview.6 - 章节任务编辑与保存闭环

- 生产流水线增加九字段任务编辑；保存另建待生成运行，不调用模型，不覆盖旧草稿和报告。
- 文风/篇幅修改可复用完整的旧计划和事实切片；剧情目标变化、旧首章上下文或不完整历史会重新准备上下文。
- 新任务经专用 bundle 事务保存，排队时检查相关资料是否变化；手动快照保留，换章或换快照不会启动旧自动任务。
- 未保存输入在任务书/草稿间切换不丢；生成、重试、跳过统一提醒保存，修复窄窗口横向溢出。
- 通用任务校验区分明确字面要求和不确定情节语义；HTTP 模型不再被无关的空 Codex CLI 路径挡住。
- 操作与实际验收见 [W06 试用记录](./docs/OPTIMIZATION_W06_TRIAL.md)。未自动上传 GitHub，不改变既有小说数据。

### 0.1.6-preview.5 - 候选处理历史与撤销

- 决策收件箱增加处理记录、伏笔/时间线筛选和事件内部分选择；沿用类型化编辑后接受。
- 撤销先显示当时写入、当前值和恢复值；只补偿本次决定的字段。后续冲突需明确选择，原回执、日志和流水保留。
- 新建状态撤销后停用并产生补偿流水；重复操作幂等，再次接受建立独立决定，不重复扣款。
- UI 与三个新增 Agent 历史/撤销工具共享短事务、JSON fallback 和保存队列。原角色归属改变后不跨角色恢复，跨集合同编号不误判为引用。
- 修复空状态事实编号；受损导入回执不能删除章节。敏感内容不通过候选落盘，脱敏后的历史不伪装为可还原原值。
- 测试与本地包内验收见 [W03 试用记录](./docs/OPTIMIZATION_W03_TRIAL.md)。自动时间线提取、旧入口统一和项目级 Agent 授权仍未完成；未自动发布 GitHub。

### 0.1.6-preview.4 - 暂存、调用状态与 Agent 修订

- 快捷重写候选进入本地项目暂存，跨页和重新加载后可恢复；不自动变为正文或设定。编辑合并保存，明确应用后才清理候选。
- 章节编辑、阅读和修订候选分别绑定目标；阅读栏手动切章可恢复对应候选，自然滚动不取消请求。
- AI 等待显示实际模型、耗时、读取响应、退避与格式重试状态；紧凑菜单只保留当前动作和取消。旧步骤终态不冒充当前调用。
- 新增七个 Agent 修订工具，覆盖来源读取、要求、候选生成/派生编辑、预览和事务提交；不冒充人工确认，不自动更改世界设定。
- 真实 Native SQLite、共享队列、JSON 往返、晚写入、重试回放和隔离 Electron UI 分别验证，详见 [第四批试用记录](./docs/OPTIMIZATION_W04_W05_W08_TRIAL.md)。本地构建不等于 GitHub 已发布。

### 0.1.6-preview.3 - 阅读与就地修订

- 章节、阅读页与可编辑文本区的 AI 快捷重写先展示候选，支持编辑、原文对比、继续改写、复制和放弃；明确应用后才修改原文。
- 超范围返回保留为整章候选，采用整章需要明确确认；重新定位或继续改写不会静默把整章降为局部片段。
- 原文变化后保留当前候选并提供重新定位与重新选区；保存失败不清空结果。快捷候选目前仅在当前页面保留，跨页前应应用或复制。
- 旧修订请求可以重新绑定到最新正文；原请求、旧候选和报告仍保留，不把旧审稿伪装成当前通过。
- 阅读页按项目记住本次窗口内的段落位置，返回阅读或前文变长后尽量恢复原位置；锚点缺失时回到该章附近。
- 阅读页保存绑定开始编辑时的原文，保存期间锁定编辑；局部应用和撤销继续创建正式修订版本。阅读区域与候选浮层改善紧凑窗口布局。

这是本地试用增量；是否已打包以匹配版本的 `release/BUILD_INFO.json` 和验收记录为准，未自动发布 GitHub。

### 0.1.6-preview.2 - 作者决定闭环

这是本地试用增量，产物是否可用以 `release/BUILD_INFO.json` 和匹配版本的验收记录为准；未自动发布到 GitHub。

- 审稿尚未完成时，作者可明确选择“未完成审稿，直接采纳”。提交与版本历史保留未审稿标记，不伪造通过报告，也不自动接受故事状态候选。
- 采纳只使用匹配当前项目、任务和正文的报告；已有严重问题与一般建议在一次确认中完整保留。
- 草稿已采纳后，顶部主动作转为下一章；保留的失败审稿步骤不再抢占续写入口。
- 决策收件箱增加候选编辑后接受，显示变更前后内容与挂接字段，取消不写入。最终值、原建议、来源风险和决定记录一起事务保存。
- 修复数字状态空值被当作零、余额编辑后重复扣减等类型与算术问题；物品列表、布尔和文本按原状态类型处理。
- Agent 候选工具复用同一编辑与接受命令，保留幂等重放；高风险项目授权仍在后续计划中。
- Agent 可执行修改不因摘要长度而截断，敏感输出递归脱敏并标记；展示快照与实际命令区分处理。
- 修复首份已采纳版本被显示为零条历史的问题，紧凑窗口中版本标题与状态标签分行显示。

### 0.1.6-preview.1 - 本地试用候选

本批面向作者操作闭环；是否已生成可用安装包，以 `release/BUILD_INFO.json` 与当批验收记录为准，不表示已发布 GitHub Release。

- 将记忆与角色状态候选接入共享决定命令，支持事件级接受、拒绝、幂等重放与 SQLite/JSON 事务保存；接受候选不会自动采纳章节。
- 候选风险引用限定当前项目和来源草稿；旧数据来源无法核实会明确提示，不仅因缺少来源字段增加强制门禁。
- 候选预览使用补丁实际指向的章节；物品增减与现金支出显示真正入账后的值，避免预览与应用不一致。
- AI 局部修订返回整章时保留候选，允许编辑和明确按整章接受；修订迟到结果不覆盖当前编辑对象。
- 修订接受核对作者确认的正文与来源，合并必要确认；未关联正式章节的修订只更新草稿。
- 首次修订前保存在提交记录中的原文进入版本历史，可查看和恢复；修订来源标签不再误标为草稿采纳。
- 收件箱和修订工作台改善紧凑窗口布局、候选对比、键盘焦点和持久化反馈。
- 直接文本 AI 重写提供“取消本次”，后端按运行与请求标识隔离取消；切换章节/修订对象后的迟到响应不会写入新对象。
- 设置页新增运行版本、构建时间、程序位置与数据路径，便于辨认旧包与新构建。
- 修正发布扫描把正常截图文件名误识别为密钥的边界，并保留实际 token 检测。

### 0.1.5 - 上一预览版

#### 可靠性修复

- 修复官方 DeepSeek V4 Flash / Pro 可能只返回推理内容、正文为空，并在无格式重试中耗尽剩余超时的问题；章节生产现在显式使用非思考模式，推理-only 响应会快速失败并给出明确建议。
- 统一显示整次调用配置的硬超时，不再把首次请求后剩余的 `259 秒` 误报为用户配置值。
- 审稿、一致性、Novelty Audit、冗余报告和质量门禁绑定当前草稿与正文指纹；正文修订后，旧报告保留为历史但不再参与展示或采纳。
- 修复多轮“失败 → 修订 → 通过 → 采纳”流程可能选中旧质量报告的问题。
- 收紧中文新角色识别，普通短语和低置信度动作片段不再阻断采纳。
- 流水线冻结单次运行的 Provider、模型、超时和取消配置，诊断步骤继承相同配置并可从最后成功步骤恢复。

### 0.1.4

#### 主要变化

- 使用 SQLite 作为默认本地存储，并保留 JSON 导入、导出与 fallback。
- 生成、草稿采纳和正式修订采用事务化提交，保留版本链、差异和历史恢复。
- 完善 Context Need Planner、上下文预算、HardCanonPack、角色状态账本、Novelty Audit、质量门禁和 Run Trace 作者摘要。
- 增加连续阅读、短文本 AI 重写、剧情导向和 Codex Agent Runtime / Tool API。
- 支持 API Provider 与 Codex CLI Provider；默认单次 AI 请求硬超时调整为 5 分钟。
- 统一 Windows 发行产物：`release/` 只保留当前版本，历史构建归档到 `releases/archive/`，并自动生成构建信息与 SHA-256 校验值。

#### 版本说明

- `0.1.1`、`0.1.2` 和 `0.1.3` 是早期本地打包迭代，并非继续维护的独立发行线。
- 这些安装包已保留在本地历史归档中；新的测试、分发和 GitHub Release 应以 `0.1.5` 为准。

#### 已知限制

- 当前应用仍是实验性预览版，数据结构和工作流可能继续演进。
- AI Provider 的输出质量和响应时间取决于模型与服务状态。
- 质量门禁、Novelty Audit 和一致性检查属于辅助判断，正式采纳前仍需作者审核。
- Windows 安装包尚未配置商业代码签名证书，SmartScreen 可能显示未知发布者提示。

### 0.1.0 - Public Preview

- 发布本地优先的 Novel Director 桌面 MVP。
- 提供项目、小说圣经、章节、角色、伏笔、时间线、阶段摘要、Prompt 构建器、生产流水线和修订工作台。
- API Key 在 Electron `safeStorage` 可用时安全保存。
- 建立公开文档、安全策略、贡献指南、CI 和第三方许可说明。

---

## English

### 0.1.6-preview.18 - Packaged UI Refresh

- Package the existing Ink Desk UI changes into the installer and `win-unpacked`: dark navigation, blue-grey controls, manuscript surfaces, and coordinated page, dialog and progress styling and motion.
- Include the current layout updates across character, foreshadowing, direction, canon, summary, pipeline, revision and reader workspaces without changing story data or workflows.
- Keep the current release and a Preview.17 rollback package; remove older duplicate release artifacts. See [release artifacts](./docs/RELEASE_ARTIFACTS.md) for verification and cleanup scope, and `release/BUILD_INFO.json` for the actual package status.

### 0.1.6-preview.17 - Backend Performance and Initialization

- Defer full-data backup reads until due, publish completed backup files atomically, isolate pending requests by storage instance, and reject stale saves after a storage switch.
- Index legacy job-mode recovery, remove progress-poll sorting and redundant log directory checks, and reserve concurrent rate-limit slots before waiting.
- Reuse Novelty text matches only within one synchronous audit; preserve report semantics and draft-revision isolation.
- Share SQLite initialization, retain retryable migration failures without empty-data overwrite, and keep JSON fallback, revision checks and short transactions. See the [measured review](./docs/BACKEND_PERFORMANCE_REVIEW.md).

### 0.1.6-preview.16 - Scoped Character Drafts and Save Feedback

- Keep page-local fact, log and conversion drafts separate by project and character.
- Bind receipts to submitted input and source logs; preserve newer edits and failed input, and prevent duplicate pending submissions.
- Add local save feedback and Chinese labels without changing candidate acceptance or ledger semantics.

### 0.1.6-preview.15 - DeepSeek Flash Alias Compatibility

- Keep official `deepseek-flash` and legacy Vision Flash requests on the existing non-thinking path; changing the model name alone no longer changes this behavior.
- Preserve the exact official-host check, third-party compatibility and saved settings. Add request-body regression coverage.
- Paid comparison was skipped as permitted because the isolated runner has no credential. No model cost or literary-quality improvement is claimed.

### 0.1.6-preview.14 - Character Workspace

- Separate profile, ledger and log tabs with keyboard navigation and preserved inputs.
- Search characters by name/role; show existing facts before the on-demand creation form.
- Improve localized status labels, input names, themed surfaces and narrow-window layout.
- No generation, persistence or candidate-acceptance behavior changes.

### 0.1.6-preview.13 - Author Workspace and Editing Feedback

- Projects come first with search and on-demand creation. Failed saves retain input and do not navigate.
- Prompt editing uses four keyboard-accessible tabs and a shared command area, with light/dark and narrow-window support.
- Authored Prompt text keeps its source metadata; rebuilding asks before overwriting edits. Late revision save acknowledgements preserve newer typing.
- Historical review details stay bound to their version. Empty manuscripts can restore saved history without weakening stale-write checks.
- Verification uses isolated synthetic data and no model calls. See the [author workspace record](./docs/UI_HIG_AUTHOR_WORKSPACE.md); actual packaging status is in `release/BUILD_INFO.json`.

### 0.1.6-preview.12 - Consistent Writing Workspaces

- Adapt Apple HIG hierarchy, navigation and readability principles to Windows Electron, without imitating macOS window chrome.
- Theme-aware collapsible sidebar, an earlier project-back action, labelled icon buttons and keyboard skip navigation.
- Shared contrast-safe button/text tokens; fix the pale dark-mode character header, chapter heading surface and unstyled secondary Prompt command.
- Keep the chapter list beside prose at 1024px; preserve prose-first generation, revision and reading. No changes to models, approval rules, storage or version chains.
- Repeatable production Electron QA and limitations: [HIG workspace record](./docs/UI_HIG_WORKSPACE.md).

### 0.1.6-preview.11 - Draft Acceptance Trace Compatibility

Canonicalize diagnostics when building chapter commits and when deriving the expected stored snapshot. Optional defaults added during database reads no longer cause false immutable-trace conflicts. Real evidence changes, stale reports, repeated commits and transaction boundaries remain checked; no author data is migrated or automatically accepted. Packaging status is recorded in the matching `release/BUILD_INFO.json`.

### 0.1.6-preview.9 - Measured Long-Novel Persistence

Full AppData saves now write only changed entities within the existing revision-checked transaction. Generation checkpoint validation reads four job-scoped collections instead of loading all prose/history. Existing import, deletion, acceptance, revision and JSON fallback behavior remains intact. New real SQLite and production Electron benchmarks cover 10/100/500 chapters. Accepted-chapter accounting deduplicates call IDs and marks missing usage as unknown; synthetic tests do not establish literary-quality or real provider-cost improvements. See the [measurement record](./docs/OPTIMIZATION_W09_W10_MEASUREMENT.md).

### 0.1.6-preview.8 - Agent Creation and Project Grants

- Grant or revoke project/database/action/chapter-scoped authority from the Agent page, without repeated human approval within scope. Revocation preserves committed versions.
- Read and edit character cards, states, foreshadowing, timeline, HardCanon and story direction with explicit previews and persisted before/after receipts.
- Task edits reuse the desktop service and create a separate idle job without calling a model or replacing existing artifacts.
- Accept exact current prose with its actual review status; authorized director disagreement does not falsify a failed report. Transactional versions and idempotent retries remain intact.
- Reload shared data from the Agent page for author handoff. Grants remain local to the application profile, outside story exports. See the [authorization guide](./docs/AGENT_PROJECT_AUTHORIZATION.md).

Local artifact status is recorded in the matching `release/BUILD_INFO.json`; no GitHub publication is implied.

### 0.1.6-preview.7 - Prose-First Workspaces

- Pipeline configuration/history become compact tools; plan-only jobs keep the task editor visible.
- Revision candidates and acceptance actions take priority, while original prose and reports remain accessible.
- Continuous reading keeps centered prose, compact navigation and container-relative chapter jumps.
- Light/dark workspace styles include readable primary-button contrast and author-facing status labels.
- See the [W07 trial record](./docs/OPTIMIZATION_W07_TRIAL.md) for real Electron coverage and limits.

### 0.1.6-preview.6 - Editable Chapter Tasks and Run Checkpoints

- Edit nine task fields in the pipeline and save a separate idle run without an AI call; retain old drafts and reports.
- Reuse complete plans and frozen facts for style/length changes; re-prepare context for plot edits, legacy opening chapters or incomplete history.
- Save through the dedicated bundle transaction and check fresh-context inputs after queueing. Preserve manual snapshots and select new targets correctly.
- Keep unsaved input across artifact tabs and guard generation/retry/skip; correct narrow-window overflow.
- Separate literal task checks from uncertain story semantics. Ignore unused empty CLI fields for HTTP providers.
- See the [W06 trial record](./docs/OPTIMIZATION_W06_TRIAL.md) for verification and limits; no automatic GitHub publication.

### 0.1.6-preview.5 - Candidate History and Undo

- Adds partial event selection, specialty filters and receipt history with field-level undo previews.
- Undo preserves unrelated later edits and original history, requires explicit conflict acknowledgement and commits one atomic compensation. UI and three Agent tools share the existing storage path.
- Fixes empty fact IDs, reassigned-character undo and cross-collection reference collisions. Corrupt journals cannot delete chapters; credential-bearing changes are not persisted through candidate decisions.
- See the [W03 trial record](./docs/OPTIMIZATION_W03_TRIAL.md) for verification and limitations. Automatic timeline extraction and project-level Agent authorization remain separate work; this is not an automatic GitHub release.

### 0.1.6-preview.4 - Durable Drafts, Call Status and Agent Revision

Quick-rewrite candidates now persist across views and reloads without becoming canon. Live call status shows the actual model, elapsed time and transport phases. Seven Agent revision tools share source binding, existing candidates and transaction-backed version history; Agent acknowledgement is not human approval. See the [fourth trial record](./docs/OPTIMIZATION_W04_W05_W08_TRIAL.md) for native tests, isolated Electron QA and distribution boundaries.

### 0.1.6-preview.3 - Reading and In-Place Revision

- Quick AI rewrites now stay in an editable candidate panel with comparison, refinement, copy and discard actions until explicitly applied.
- Broad responses remain whole-chapter candidates and require explicit adoption; relocation and refinement cannot silently insert an entire chapter into a local range.
- Stale candidates can be reanchored without overwriting newer prose. Quick candidates currently survive only within the mounted page; apply or copy before leaving.
- Old revision requests can be rebound to current prose while preserving original requests, candidates and report provenance.
- Project-local reading anchors restore the current session's position, including after earlier text changes. Inline saves retain their original baseline and lock editing while saving.
- Formal reading revisions still use versioned commits. Compact reading layouts and candidate controls have been refined.

Local trial build only; verify matching build metadata before distribution. No automatic GitHub release.

### 0.1.6-preview.2 - Author Decisions

Local trial only. Artifact readiness is recorded in the matching build metadata and validation report; this does not publish a GitHub release.

- Explicit unreviewed acceptance preserves its status in commits and version history without inventing passing reports or accepting pending world-state changes.
- Acceptance uses current project/job/prose-bound reports and retains serious findings alongside advisory warnings in one confirmation.
- Accepted drafts offer the next chapter even when failed review steps remain in generation history.
- The decision inbox supports typed edits followed by atomic acceptance, with before/after previews and receipts. Cancelling does not persist edits.
- Numeric blanks cannot become zero, and edited final balances do not apply an old decrement again. Lists, booleans and prose retain their state-value semantics.
- Agent tools share the same edited-candidate commands and idempotency; scoped high-risk authorization remains future work.
- Executable amendments are never compacted; sensitive response text is recursively redacted and flagged separately from display snapshots.
- A first accepted current version now counts as saved history. Compact version-list layouts separate titles from status badges.

### 0.1.6-preview.1 - Local Trial Candidate

This batch improves the author workflow. Consult `release/BUILD_INFO.json` and the matching validation record for artifact readiness; this entry does not imply a GitHub release.

- Memory and character-state decisions share an idempotent command with atomic SQLite/JSON persistence. Deciding candidates does not automatically accept a chapter.
- Candidate risk reports are scoped to the project and source draft. Unverifiable legacy provenance remains visible without becoming a new blocking rule by itself.
- Candidate previews resolve the actual target chapter and share inventory/resource calculations with persistence.
- Broader-than-requested AI revisions remain editable candidates with explicit whole-chapter acceptance; late results do not overwrite the current editing target.
- Revision acceptance verifies the confirmed text and source with one combined confirmation. Unlinked drafts remain drafts.
- Pre-revision prose retained in commit records is visible and restorable in version history, with corrected revision source labels.
- Inbox and revision layouts improve compact-window usability, candidate comparison, keyboard focus, and persistence feedback.
- Direct text rewrites expose per-call cancellation. Late responses cannot land in a newly selected chapter or revision object.
- Settings displays the running version, build time, executable and data path.
- The release scanner no longer mistakes ordinary screenshot filenames for credentials, while retaining standalone token detection.

### 0.1.5 - Previous Preview

#### Reliability fixes

- Fixed official DeepSeek V4 Flash / Pro responses that could contain reasoning without prose and then spend the remaining deadline on a format fallback. Chapter production now requests non-thinking mode, and reasoning-only responses fail fast with an actionable message.
- Timeout errors now report the configured run budget instead of a misleading remaining value such as `259 seconds`.
- Consistency review, Novelty Audit, redundancy, and quality-gate reports are bound to the current draft and content fingerprint. Editing prose preserves old reports as history but prevents them from being displayed or accepted as current.
- Fixed stale quality-report selection across fail, revise, pass, and accept cycles.
- Tightened Chinese named-character detection so ordinary phrases and low-confidence action fragments cannot block acceptance.
- Pipeline runs snapshot provider, model, timeout, and cancellation settings; diagnostic steps inherit the same configuration and can resume from the last successful step.

### 0.1.4

#### Highlights

- SQLite is now the default local storage backend, with JSON import, export, and fallback retained.
- Generation runs, accepted drafts, and formal revisions use transactional commits with version history, diffs, and restore support.
- Context Need Planner, context budgeting, HardCanonPack, character state ledger, Novelty Audit, quality gates, and author-facing Run Trace summaries have been expanded.
- Added continuous reading, short-text AI rewrite, Story Direction, and the Codex Agent Runtime / Tool API.
- Supports API providers and the Codex CLI provider. The default hard timeout for a single AI request is now five minutes.
- Windows artifacts are consolidated: `release/` contains only the current build, historical builds live in `releases/archive/`, and packaging writes build metadata and a SHA-256 checksum.

#### Version Note

- `0.1.1`, `0.1.2`, and `0.1.3` were local packaging iterations, not separately maintained release lines.
- Those installers remain in the local archive. New testing, distribution, and GitHub Releases should use `0.1.5`.

#### Known Limitations

- The application remains an experimental preview, and its data contracts and workflows may continue to evolve.
- AI output quality and latency depend on the selected model and provider.
- Quality gates, Novelty Audit, and consistency checks assist author judgment; accepted prose still requires human review.
- The Windows installer is not yet signed with a commercial code-signing certificate, so SmartScreen may show an unknown-publisher warning.

### 0.1.0 - Public Preview

- Released the local-first Novel Director desktop MVP.
- Included project, story bible, chapter, character, foreshadowing, timeline, stage summary, Prompt Builder, generation pipeline, and revision workbench features.
- Stored API keys through Electron `safeStorage` where available.
- Added public documentation, a security policy, contribution guidance, CI, and third-party notices.

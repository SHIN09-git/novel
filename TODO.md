# Novel Director TODO 档案

本文件用于记录真实试用版之后的工程与产品待办。优先级定义：

- P0：数据安全 / 破坏性 bug。任何可能导致正文丢失、项目数据被覆盖、长期记忆被污染、API Key 泄露的问题。
- P1：生成质量 / 连贯性。影响章节可读性、上下文一致性、伏笔节奏、AI 输出可信度的问题。
- P2：UI 体验。影响长时间写作舒适度、操作效率、可解释性的体验优化。
- P3：未来功能。值得做，但不阻塞真实试用。

## P0 数据安全 / 破坏性 Bug

### 已完成

- 保存队列：`useAppData.saveData` 已通过队列按顺序落盘，降低连续保存时旧写入覆盖新写入的风险。
- 函数式保存：`saveData((current) => next)` 已可用，主流水线、章节页、修订写回、设置页核心保存链路已开始迁移。
- P0.5 追加迁移：首页、角色页、小说圣经、Dashboard、Prompt 构建器、伏笔页、时间线页、阶段摘要页等视图写入已改为函数式保存，避免旧闭包 `data` 覆盖并发更新。
- 流水线运行锁：生产流水线启动期间会阻止重复点击创建多条并发任务，异常路径会释放锁。
- 草稿覆盖保护：接受 AI 草稿覆盖已有章节前，会保存旧正文到 `ChapterVersion`。
- 修订局部合并安全：局部修订必须唯一匹配原文片段；匹配失败或多处匹配时阻止保存版本，避免片段覆盖整章。
- 草稿修订写回安全：`draft.chapterId = null` 时不会 fallback 到第一章，也不会直接写入任何已有章节。
- API Key 安全存储：API Key 已迁移到 Electron `safeStorage`，持久化 / 导出 / 合并后的 AppData 会清空 `settings.apiKey`。
- App 配置安全写入：`app-config.json` 已改为 tmp 写入、旧配置 `.bak` 备份、损坏配置 `.corrupt.<timestamp>.json` 备份后回退默认路径，降低数据路径配置损坏导致的“误以为数据丢失”风险。
- 数据路径迁移合并：目标路径已有数据时支持“合并已有数据 / 覆盖 / 取消”，合并前生成预览并备份源和目标。
- MemoryUpdateCandidate 结构化：`proposedPatch` 已从字符串 JSON 升级为结构化 `MemoryUpdatePatch`，旧数据通过 normalize 兼容。
- IPC 常量与 preload API 整理：主进程 / preload / renderer 通过集中 channel 和类型约束通信，不暴露 `ipcRenderer`、`fs`、`path`。
- AI JSON Schema Validator 核心版：章节任务书等关键 AI 输出已有结构校验与字段级错误提示。
- AI Schema Validator 扩展：质量门禁 issue、修订结果元数据、结构化长期记忆补丁已纳入核心校验。
- 统一危险操作确认：当前 renderer 侧危险操作已接入共享 ConfirmDialog，原生 `confirm()` 只保留在组件 fallback 中。
- 回归脚本：P0 稳定性、凭据安全、数据合并、结构化记忆补丁、修订写回等关键路径已纳入 `npm test`。

### 未完成 / 仍需加固

- 继续迁移低风险旧式保存调用：视图层已清掉 `saveData({ ...data })`，后续仍应检查设置导入、外部 IPC 回填等非典型路径是否需要字段级合并。
- 全局危险操作确认统一：ConfirmDialog 已落地，后续可继续增强键盘焦点管理、ESC 关闭和更细的风险文案。
- 更细粒度的写入冲突检测：当前以函数式保存降低旧闭包覆盖风险，但还没有版本号 / 乐观锁 / 字段级合并冲突提示。
- 备份可视化管理：目前已有 `.bak`、merge backup 和 corrupt backup，但缺少统一备份列表、恢复预览、备份清理策略。
- AI 输出污染防护扩展：已有 schema validator 核心版和部分扩展，但还应继续覆盖候选应用前的跨字段校验和 provider-specific 返回异常。

## P1 生成质量 / 连贯性

### 已完成

- ContextSelectionResult 真源链路：流水线上下文预算选择结果已作为最终 prompt 构建依据，Run Trace 与真实 prompt 选择保持一致。
- PromptBuilder 显式上下文：支持 `explicitContextSelection`，避免预算裁剪后又被二次自动推荐绕过。
- Prompt 压缩真实替换核心版：预算不足时，旧章节详细回顾会优先替换为阶段摘要、一句话摘要或摘要摘录，并在 Run Trace 记录 `compressionRecords`。
- Run Trace：记录上下文来源、选中章节 / 角色 / 伏笔、treatment override、强制上下文块、质量链路、记忆候选接受 / 拒绝等信息。
- forcedContextBlocks：连续性桥接、质量门禁 issue 等额外强制上下文不会污染 selection IDs，但会进入 trace 解释 token 差异。
- 伏笔 treatmentMode：伏笔支持隐藏、暗示、推进、误导、暂停、回收；Prompt 和质量门禁会约束越权推进 / 提前回收。
- 章节连续性桥接：生成第 N 章时会优先接住第 N-1 章结尾状态；无 bridge 时使用上一章结尾片段兜底。
- 冗余描写控制：质量门禁增加章节连续性与冗余控制维度，修订工作台支持减少冗余、压缩描写、删除重复解释等类型。
- 一致性审稿与质量门禁职责拆分：一致性审稿负责诊断，质量门禁负责放行 / 拦截；一致性 issue 可进入修订。
- 修订工作台 Diff：接受修订前可查看原文、修订后、差异对比，提升作者对 AI 改动范围的信任。
- 局部 / 全文修订合约：RevisionAI 明确区分 `full` 和 `local`，局部修订只返回片段，由 UI 安全合并。

### 未完成 / 仍需优化

- 上下文相关性评分仍偏规则化：ContextBudgetManager 还可以进一步读取章节任务书、角色出场计划、伏笔回收范围，做更细的相关性排序。
- 质量门禁阈值不可配置：当前阈值偏固定，后续可按项目风格、题材、生成模式配置。
- 质量趋势缺少历史视图：QualityGateReport 已能拦截单章问题，但缺少跨章节趋势，例如连续 OOC、节奏拖沓、重复环境描写。
- RedundancyReport 仍偏粗粒度：后续可升级为段落级报告，并支持点击建议直接进入对应段落修订。
- continuity bridge 置信度不足：目前可记录桥接状态，但还缺少“AI 提取是否可信”的置信度与前后章冲突链路可视化。
- 伏笔 treatmentMode 节奏历史不足：还没有展示某个高权重伏笔连续几章被 hint / advance / pause 的趋势。
- 修订后自动复检未闭环：接受修订后尚未自动重新跑质量门禁或一致性审稿。

## P2 UI 体验

### 已完成

- UI 基础升级：整体从表单后台感转向小说工作台风格，章节页、流水线、修订、Prompt 构建器等重点页面完成首轮优化。
- App.tsx 渲染优化：当前视图通过 switch / renderCurrentView 渲染，不再每次 render 创建所有 View element。
- 重页面 Lazy Loading：生产流水线、修订工作台、设置页等重页面已使用 `React.lazy + Suspense`。
- CSS 第一阶段拆分：样式入口从单一 `styles.css` 拆成 `styles/index.css` 与 base/layout/views/features 等结构。
- 局部样式 scope：generation、revision、settings、run trace、storage migration、revision diff 等高风险区域已做局部作用域加固。
- 正文复制 / 导出：章节正文支持复制、复制标题+正文、导出当前章 TXT/MD、批量导出所有章节。
- 数据路径设置：设置页可查看、选择、迁移、恢复默认数据路径，并通过安全 IPC 访问文件系统。
- 快捷启动：已提供 `dist-launcher/Novel Director Workbench.exe` 用于启动工作台。

### 未完成 / 仍需优化

- 统一 Toast：复制、导出、保存、应用候选等操作仍有分散提示，需统一非阻塞反馈。
- 统一 ConfirmDialog：危险操作仍可继续从原生 confirm 迁移到统一弹窗。
- 章节编辑器高级体验：专注模式、搜索、段落导航、快捷键、字数目标、编辑位置恢复仍可增强。
- Run Trace 摘要视图：目前 trace 可解释，但仍偏工程化，后续应减少用户查看 JSON 的需求。
- 快照 / Prompt 压缩详情弹窗：上下文快照、压缩记录和省略项可以增加更清晰的详情对比。
- 视觉回归自动化：已有结构验证脚本，但缺少截图级 UI 回归测试。

## P3 未来功能

- SQLite Repository：将 JSON Storage 替换为 SQLite，同时保留 Repository 抽象和迁移工具。
- Provider Adapter：为 OpenAI、Compatible API、本地模型建立更清晰的 provider adapter 和模型能力探测。
- AI 调用队列与取消：增加请求取消、重试队列、脱敏调用日志面板。
- 数据库级备份 / 版本控制：支持项目级快照、章节级 diff 存档、备份清理策略。
- 时间线可视化：把列表式时间线升级为轴视图或事件图谱。
- 角色 / 伏笔 / 世界观图谱：展示角色关系、伏笔网络、世界规则依赖关系。
- 卷 / 幕 / 篇章结构管理：为超长篇项目增加多层结构。
- E2E UI 冒烟测试：覆盖创建项目、写章、流水线、修订、导出、迁移数据路径的真实桌面流程。

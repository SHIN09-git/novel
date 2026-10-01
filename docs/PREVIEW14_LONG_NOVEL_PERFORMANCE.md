# Preview.14 长篇界面复测 / Long-Novel UI Baseline

## 简体中文

测量日期：2026-09-22。直接运行 `release/win-unpacked/Novel Director.exe`（`0.1.6-preview.14`），没有使用开发服务器或纯函数计时替代页面操作。目标是检查界面更新后，长篇项目的打开、编辑保存与返回是否仍可用；本批没有修改运行时代码或数据库结构。

### 方法与环境

- Windows 11 `10.0.26100`，Ryzen 7 7800X3D，约 32 GB RAM；Node 24.14.0，Electron 39.8.9，Chromium 142.0.7444.265。
- 每档 1 次热身、3 次正式操作，串行运行。视口 1280×900。p95 是这 3 次的最大值，不代表稳定的总体尾延迟。
- 每次使用全新进程与隔离 profile，从已迁移的虚构 SQLite 副本启动；迁移和复制时间不计入，未清空操作系统缓存。
- 同一个虚构 fixture：10/100/500 章，每章约 3000 字，包含版本、草稿、14 步生成记录、Prompt 快照和采纳历史。完整 JSON 分别约 1.52/14.84/73.96 MiB。不是作者真实小说，也不代表所有项目分布。
- 真正发送鼠标、键盘和文字输入；等待对应项目、章节数量、完整正文及保存状态连续两帧稳定。保存后通过 preload 只读回查 SQLite，核对正文及 revision。
- Agent 刷新测已保存的虚构结果，不是外部 Agent 并发写入测试，也不是 MCP 工具的服务端读取基准。

### 结果

单位：毫秒；每格为 **p50 / p95**，四舍五入。

| 操作 | 10 章 | 100 章 | 500 章 |
| --- | ---: | ---: | ---: |
| 新进程启动至项目列表可操作 | 824 / 832 | 927 / 932 | 1542 / 1561 |
| 进入项目工作台 | 379 / 387 | 583 / 593 | 1579 / 1600 |
| 首次进入章节列表 | 335 / 343 | 348 / 351 | 385 / 386 |
| 编辑至显示已保存，含 500ms debounce | 540 / 541 | 722 / 725 | 1613 / 1636 |
| 编辑至保存并完成完整数据回读 | 555 / 557 | 844 / 845 | 2313 / 2386 |
| 从另一项目切回 | 49 / 50 | 201 / 203 | 986 / 986 |
| 再次进入章节列表 | 15 / 15 | 25 / 25 | 73 / 74 |
| Agent 确认后重新加载 | 49 / 50 | 194 / 194 | 1091 / 1107 |

9 次正式操作、3 次热身以及 3 次隔离迁移检查全部通过；没有 renderer 异常、AI 请求或遗留测试进程，仓库 Node 原生绑定 hash 未改变。首次进入页面包含 lazy 模块加载，重复进入则命中缓存，不应把两者当成同一指标。

500 章时保存及完整回读仍是主要本地等待来源。它们还受完整 AppData 边界影响，但本次数据没有提供理由把现有接口改成全库 CRUD；继续按总计划暂缓这类架构扩展。

### 与旧基线核对

当前与 Preview.9 的 harness、fixture、normalizer 指纹相同；三档 raw fixture、JSON 字节数、集合计数及正文字符数也相同。运行时 reject-only 测试端口不同，因此 overlay hash 不同，不能将其误判为小说样本变化。两端都是同机真实包内运行，可以作观察性对照；它们不是同日交替实验。

上表的核心端到端指标没有超过 25% 的退化。500 章编辑至已保存从历史 1562ms 到本次 1613ms，约 +3.2%；完整回读约 +1.7%，确认后刷新约 -2.0%。不能据此声称整个界面所有指标都改善了：

| 次级操作 p50 | Preview.9 | Preview.14 | 解释边界 |
| --- | ---: | ---: | --- |
| 10 章，打开 Agent 刷新确认框 | 9.89ms | 77.47ms | 增加约 68ms，非数据库加载耗时 |
| 100 章，打开同一确认框 | 51.71ms | 77.48ms | 增加约 26ms |
| 500 章，打开同一确认框 | 52.66ms | 88.07ms | 增加约 35ms |
| 10 章，返回编辑正文就绪 | 6.74ms | 9.79ms | 比例较大，但绝对差约 3ms |
| 100 章，退出项目 | 9.98ms | 14.91ms | 绝对差约 5ms |

这些小操作保留为候选回归信号，不通过删动画、跳过检查或改 readiness 定义来换数字。若作者感到明显迟滞或同日成对复测持续恶化，再定位具体原因；本轮不声称已经证明这些差异的根因。

### 证据与复现

- [完整原始 JSON](./performance/long-novel-ui-preview14.json)：包含逐轮耗时、环境、fixture/harness/normalizer 指纹、存储回查和清理结果。
- 本地原始输出：`tmp/performance/preview14-long-ui-20260922.json`。
- 隔离工作目录：`tmp/performance/long-novel-ui/run-homcye`，只包含本次虚构样本；未来可清理，不把该目录存在当作验收证据。
- 既往对照及解释边界见 [W09/W10 测量记录](./OPTIMIZATION_W09_W10_MEASUREMENT.md)。历史记录不是本轮同日成对复测，不把数值变化归因于某一次 UI 修改，也不据此宣称文学质量或模型费用改善。

```powershell
node scripts/benchmark-long-novel-ui.mjs --check
node scripts/benchmark-long-novel-ui.mjs --run --label current --runs 3 --packaged-dir release/win-unpacked --output tmp/performance/long-ui-new-run.json
```

输出文件须使用新名称；与其他 UI 测试、打包和大量磁盘任务串行运行。出现同机连续复测偏离匹配基线超过 25% 时再调查，不把这些单机毫秒值作为容易抖动的 CI 硬门禁。

本轮剩余主线仍是真实模型质量与最终采纳成本对照。作者已原则同意，尚待供应商、模型和费用上限；本次没有发出付费请求，也没有用 mock 代替该验收。

### 模型对照准备状态

已运行既有 `compare:prepare`，产出 `tmp/model-comparison-preview14-20260922/manifest.json`、虚构 seed、规划前上下文及空白盲审表：3 个任务 × standard/fast 共 6 份准备结果，关键材料全部命中，网络和付费调用均为 0。

这不是一个已经接通的付费执行器。选定模型后，还需按实际费率确定试验矩阵与停止口径，沿现有生成/修订/采纳流程保留 run/commit/usage，并将盲审意见与匿名正文绑定；缺失 usage 仍记未知。当前没有通用硬限费保证，也不能给混合模型套一份统一价格。优先使用现有流程及少量结果收集，不以这次试验为由新建大型评测平台。

```powershell
npm.cmd run compare:prepare -- --output tmp/model-comparison-new-run
npm.cmd run test:single -- model-comparison-preparation
```

## English

Measured on 2026-09-22 against the actual Preview.14 Windows package, using isolated synthetic 10/100/500-chapter profiles, one warmup and three measured runs per size. Native input and persisted body/revision checks are included. Startup means a fresh process/profile, not a cold OS cache. With three samples, p95 is the maximum observation.

At 500 chapters the median startup, project entry, edit-to-saved and confirmed reload latencies were 1542, 1579, 1613 and 1091 ms. Edit-to-saved includes the existing 500 ms debounce; complete persistence readback brings the edit measurement to 2313 ms. All workflows passed with zero AI requests, renderer exceptions or leftover processes; the root Node SQLite binding was unchanged.

The linked raw JSON retains measurements and fingerprints. Historical results are not a same-day paired experiment; no causal UI speedup, literary-quality or provider-cost claim is made. Full-AppData save/read waits remain a known boundary, not authorization to expand into a new CRUD architecture. Paid model comparison still awaits the selected models and spending cap.

Some small controls are slower than the historical baseline: opening the Agent refresh confirmation now takes about 77–88 ms, versus 10–53 ms previously. These observations are retained, not hidden by changing readiness or disabling behavior. Offline comparison preparation produced three synthetic tasks across two recipes with zero calls; real execution, pricing/stop rules and blind-review/result linkage remain to be completed for the chosen configuration.

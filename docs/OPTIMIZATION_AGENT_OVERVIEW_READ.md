# Agent 项目概览定向读取

## 简体中文

测量日期：2026-09-07。接续 [W09/W10 实测](./OPTIMIZATION_W09_W10_MEASUREMENT.md) 中约 400ms 的 Agent 概览读取热点。本批只优化项目入口读取，不改生成、Prompt、审稿、采纳或授权。

### 改动范围

此前，即便只问“下一章写第几章”，也会读取并规范化整库 AppData，包含全部历史正文、版本、Prompt 和步骤输出。现在下列四个工具只读取统计所需的 12 个集合：

- `agent.listProjects`
- `agent.getProjectDigest`
- `agent.getNextChapterTarget`
- `agent.getPendingHumanReviewItems`

这些集合是项目、当前章节、角色、状态事实、伏笔、时间线、阶段摘要、HardCanon、剧情导向、生成任务及两类候选。沿用原有统计和排序，输出结构、归档章序处理与项目名称匹配不变。没有截断工具本来能返回的信息，也没有新增持久化缓存。

`AgentProjectOverviewData` 明确区分概览与完整 AppData，不能作为保存输入。正文、版本、详细审稿、候选预览、授权和全部写入工具仍走原完整读取路径。SQLite 的数据与 revision 在同一个只读事务内取得；不初始化 schema、不切换 WAL、不连接作者测试数据。JSON fallback 仍用原完整解析，然后返回同样的概览。

概览中的 job 不用于恢复执行：旧任务由步骤恢复的 `pipelineMode` 仍只在完整读取路径补齐。四个概览输出本来不包含该字段，测试专门核对这种旧记录的输出等价性。

### 同条件实测

Windows 11 x64、Ryzen 7 7800X3D、32 GB RAM、Node 24.14.0 / ABI 137、SQLite 3.53.0。沿用虚构 10/100/500 章 fixture，500 章完整 JSON 约 73.96 MiB。每个工具热身 2 轮、正式 9 轮；每轮交替先运行旧完整读取或新定向读取，并核对整个工具响应深度相等。

下表为 p50/p95 毫秒，四舍五入到两位：

| 工具 | 10 章 before -> after | 100 章 before -> after | 500 章 before -> after |
| --- | ---: | ---: | ---: |
| 项目列表 | 9.97/13.19 -> 2.69/3.11 | 76.75/94.24 -> 7.57/10.16 | 419.30/431.92 -> 31.68/35.79 |
| 项目摘要 | 9.51/11.71 -> 2.50/3.31 | 73.64/79.73 -> 7.77/8.34 | 397.37/422.40 -> 32.04/33.29 |
| 下一章目标 | 10.23/12.85 -> 2.71/3.19 | 77.09/81.60 -> 7.30/10.94 | 404.75/434.84 -> 29.46/40.08 |
| 待确认计数 | 8.64/11.45 -> 2.66/2.91 | 74.27/87.78 -> 7.57/10.04 | 396.44/422.67 -> 29.74/46.76 |

500 章项目摘要中位耗时减少约 92%，读取的实体 JSON 字节约为完整集合的 8%。这是同一进程内真实原生 SQLite 服务的成对比较，不是两个历史 EXE 的界面比较。两端使用相同规范化和输出函数；完整读取基线也使用本批一致性修复后的只读事务。

计时包括打开数据库、查询、解析、规范化和格式化，不包括 MCP/CLI 进程冷启动、协议传输、Electron 页面或模型请求。不清 OS 缓存，不强制 GC；内存未作硬结论。返回文字保持一致，因此不宣称节省模型 token 或提升小说质量。

### 复现

```powershell
npm.cmd run native:check:node
npm.cmd run test:single -- agent-overview-scoped-read agent-runtime-p0 agent-runtime-p5
npm.cmd run perf:agent-overview -- --output tmp/performance/agent-overview-current.json
```

请勿与打包、原生重建或其他基准同时运行。数据库和脚本产物在仓库 `tmp` 的独立子目录；测量结束关闭全部连接并清理数据库。原始结果见 [agent-overview-paired.json](./performance/agent-overview-paired.json)，含日期、环境、源码指纹、逐轮耗时和返回等价检查，不含正文或完整工具响应。

回归以确定行为为门禁：四输出相等、SQL 只查指定集合、数据/revision 原子一致、其他工具保留完整信息、JSON/空目录兼容及只读不落盘。时延仅作观测基线，同机连续两轮退化超过 25% 再调查，避免以单次抖动判失败。

### 使用与边界

验证：专项定向读取脚本、135/135 全部验证、类型检查和生产构建通过。专项使用真实 SQLite，覆盖并发第二连接保存时数据与 revision 一致、旧 job、存档章、多项目、缺表错误与句柄清理；修订/撤销测试替身已同步新增只读接口，没有跳过原验证。

CLI/MCP 从仓库入口启动，更新源码后新进程自动使用本批实现。已经常驻的 MCP 进程需重新连接；只替换桌面 EXE 不会更新旧仓库里的 Agent 服务。桌面继续访问同一数据库，本批没有改变界面刷新方式。

仍保留的限制：

- 概览读取全部项目的这 12 个集合，当前章节正文仍随章节 payload 解析；大型多项目库还会线性增长。
- JSON fallback、正文详情、版本/审稿读取及桌面完整刷新仍走全量路径，不宣称同步提速。
- 不引入投影表、缓存失效系统或全库 CRUD；后续只在实测需要时继续缩小读取范围。
- 真实模型对照已获原则同意，但模型名称与费用上限尚未提供，本批工作台模型调用为零。

## 本地试用产物

- 版本：`0.1.6-preview.10`，2026-09-07 18:56（UTC+8）构建完成。
- 解包版（相对仓库）：`release/win-unpacked/Novel Director.exe`。
- 安装包（相对仓库）：`release/Novel Director Setup 0.1.6-preview.10.exe`。
- SHA-256：`CFAF6C8C9696227D9F010A1167534DA62476CB5D6EAD381C31CCF693F8F81CEF`。
- 包内 SQLite smoke 通过，Node ABI 137 绑定已恢复，Electron 39.8.9 / ABI 140 包内绑定独立。
- 未数字签名、未上传 GitHub，未执行安装/卸载生命周期测试。桌面包不携带仓库常驻 MCP 进程；本轮 Agent 优化由更新后的仓库服务加载。
- Preview.9 旧包保留于 `releases/archive/v0.1.6-preview.9-2026-09-07_10-56-17-382/`，没有清理用户数据。

## English

Four compact Agent entry tools now read a typed, 12-collection overview instead of all historical payloads. Output, ordering, project lookup and archived chapter allocation are preserved. Full-detail tools and all writes still use full AppData. SQLite payload and revision are obtained in one read-only transaction; JSON keeps its existing fallback parser. No runtime schema changes or persistent caches are added.

Paired native SQLite measurements on 2026-09-07 use synthetic 10/100/500-chapter fixtures, two warmups and nine alternating baseline/new pairs per tool. At 500 chapters, project digest median latency falls from 397.37ms to 32.04ms; all responses are deeply equal. These are Node service timings, not UI, process-startup, token-cost or literary-quality claims. Reconnect an already-running repository MCP server to load the new code. Raw results and reproduction commands are above; paid model comparisons still await model names and a spending cap.

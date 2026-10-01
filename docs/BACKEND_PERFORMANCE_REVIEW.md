# 后端架构与性能复核 / Backend Performance Review

复核日期：2026-09-28。版本：`0.1.6-preview.17`。本轮只优化有复现证据的后端开销与失败路径，不改 UI、Prompt、生成配方或小说数据。

## 当前架构

- 桌面保存由 renderer 的共享保存队列进入 preload/IPC，再由 main process 的 StorageService 执行。完整 AppData API、JSON 导入导出和 JSON fallback 保留。
- SQLite 使用实体 JSON payload、差量快照写入、revision 冲突校验和短事务。生成检查点已经按 job 读取校验材料；正式章节/修订提交仍读取完整资料，以校验跨集合关联。
- Agent Runtime 是独立 Node 入口，复用领域服务和存储事务。四个项目概览工具已有定向只读查询；其他完整详情仍可能读取全库。
- AI 请求统一经过主进程传输、凭据服务、限流、重试、取消和读取超时。Novelty/冗余/质量诊断按需加载；已有正文 hash 关联和报告复用，不新增跨正文的报告缓存。

## 本轮修复

| 问题 | 处理 | 边界 |
| --- | --- | --- |
| 每次保存先读完整 AppData，再发现每日备份无需执行 | 先检查备份日期，需要时才调用数据加载器；并发检查共享同一次备份 | 首次或到期备份仍读全库，未减少备份频率 |
| 备份写盘中断后半截 JSON 可能被当作有效备份 | 写唯一临时文件，完成后 rename 发布，失败清理临时文件 | 不承诺突然断电时的硬件级持久性 |
| 切换数据路径时在途备份与保存继续访问旧实例；同时发布可能撞名 | pending 按存储实例隔离，正式写入前再次核对实例，备份正式名称带唯一后缀 | 保留原有每日备份周期，不新增全局调度平台 |
| SQLite 并发首次打开产生多个连接，迁移保存/备份错误误走空数据分支 | 初始化共享一次执行，关闭可取消待完成初始化；读/复制/保存失败明确传播，可重试 | 不修改 schema，不删除旧 JSON；显式完整导入仍保留替换语义 |
| Novelty 对同一上下文和关键词重复分词匹配 | 仅在一次同步 audit 内复用相同原始 `(source, term)`，包括 false；finally 清理，嵌套隔离 | 不改变分词规则、审计级别或证据 offset，不跨正文缓存 |
| 旧任务模式恢复对每个 job 扫描全部 steps | 单次规范化建立索引，保留原有优先级、相同时间排序和无效日期规则 | 不修改旧记录的业务语义 |
| 进度轮询反复创建数组并排序 | 精确查找使用 Map，其余单遍选取，只有终态超限时排序淘汰 | 活动请求不被逐出，保留既有命名空间与保留时间 |
| 多个限流等待者消费同一次令牌补充 | 在等待前预留令牌，分别安排等待 | 不修改模型、重试次数或单请求超时 |
| 每行日志重复检查/创建目录 | 正常路径只检查大小并追加，目录丢失时才重建 | 仍同步写日志，保留轮转、错误处理和脱敏 |

数据安全优先级最高的是迁移失败覆盖风险和切库后旧写入。本轮只把连接/初始化生命周期提取为小型 helper，事务写入与领域校验继续复用原实现。空库判断改为 `SELECT 1 ... LIMIT 1`，已有设置行时不再查询或计数全部 entities。

## 测量方法

`scripts/benchmark-backend-checkpoints.mjs` 调用实际注册的 main 数据处理器和实际原生 SQLite；Electron 仅替换 handler 注册，日志文件写入关闭。每档 2 次热身、7 次测量，使用 `performance.now()`，p50/p95 采用 nearest-rank。

样本为现有虚构长篇 fixture 的 10/100/500 章，提前创建真实的当日自动备份。分别测量备份检查、生成检查点保存和改动一章的完整 AppData 保存。数据库、备份和构建临时文件均位于仓库 `tmp`，退出时关闭连接并清理；不访问真实稿件、不调用模型。

原始结果同时记录日期、机器、Node ABI、输入 JSON 字节数、源码 hash、逐轮耗时与全量读取次数。heapBefore/heapAfter 只是端点观察，受 GC 影响，不是峰值内存结论。这里不包含 renderer 渲染、Electron IPC 序列化或模型响应时间，不能当成整页速度或生成质量收益。

```powershell
npm.cmd run perf:backend -- --label current --output tmp/performance/backend-checkpoints.json
node scripts/validate-backend-ai-performance.mjs --benchmark
node scripts/validate-legacy-pipeline-mode-index.mjs --benchmark --jobs=2000 --steps-per-job=8 --iterations=5
node scripts/validate-novelty-audit-memo.mjs --benchmark
```

### 保存链路实测

环境：Windows 11 / Ryzen 7 7800X3D / 约 32 GB RAM / Node 24.14.0 ABI 137；使用当前 Node `better-sqlite3`。Electron 包独立使用 ABI 140 绑定，不为基准替换根目录 native 模块。

表中耗时单位为 ms，单元格为 p50 / p95：

| 章数 | 检查点保存：修改前 | 检查点保存：修改后 | 完整保存：修改前 | 完整保存：修改后 |
| --- | --- | --- | --- | --- |
| 10 | 10.721 / 12.601 | 1.296 / 1.521 | 16.540 / 19.855 | 5.535 / 6.138 |
| 100 | 84.690 / 94.978 | 1.226 / 1.397 | 176.631 / 226.790 | 51.928 / 53.709 |
| 500 | 598.537 / 639.167 | 1.443 / 1.892 | 1076.222 / 1238.967 | 252.549 / 258.324 |

500 章样本备份检查 p50 从 570.655ms 降为 0.282ms。所有档位的 7 次测量，备份 guard 导致的全库读取从 7 次降为 0 次；保存 API 自身必要的解析、规范化和事务成本仍计入。首次/到期的真实全库备份不在这组收益范围内。

原始数据：[修改前](./performance/backend-checkpoints-before.json)、[修改后](./performance/backend-checkpoints-after.json)。日期用 UTC 保存，对应本地 2026-09-28；源码 hash 记录各次测量的实现状态，不以当前脏树对 HEAD 的总差异归因。

### Novelty 请求内复用

固定 2,000 字合成正文，上下文分三档。基线与新实现从同一份源码构建，基线仅绕过 memo wrapper；交替先后顺序，2 次热身、7 次测量，每轮深比较完整结果。

| 上下文字数 | 原实现 p50 / p95 ms | 请求内复用 p50 / p95 ms |
| --- | --- | --- |
| 1,000 | 24.531 / 26.298 | 11.480 / 12.413 |
| 8,000 | 190.644 / 197.303 | 81.028 / 81.624 |
| 24,000 | 592.965 / 686.976 | 255.035 / 280.650 |

单次审计分词调用从 83 次降到 35 次；90 组不同正文、许可和上下文的结果保持一致。详见 [原始 JSON](./performance/novelty-audit-memo.json)。大档仍约 255ms 同步计算，不能据此声称主进程已无阻塞。

## 回归策略

CI 使用确定性的行为/复杂度断言，不把机器耗时直接设成易抖动的门禁：

- 备份未到期时，实际 main 检查点和完整保存处理器不得调用 `storage.load()`。
- 12 个并发备份检查只取一次快照；读失败、写失败、实际部分写入失败后都可重试。
- 不同 scope 同毫秒备份不覆盖；5 类写入在备份后的微任务切库窗口不会调用旧实例，候选 actor 仍由 main 绑定为 user。
- SQLite 初始化 27 项故障/并发验证使用 Node 内置 SQLite 适配器控制时序；实际 better-sqlite3 保存链路、事务回滚及包内 SQLite smoke 另行验证，不混称为同一种驱动测试。
- 旧模式索引做 468 组完整 AppData 深比较，并断言 512 个 job / 2,048 个 step 的访问次数从 1,048,576 降为 2,048。
- 正常进度查询排序次数为零；每 1,000 行日志正常路径为 1,000 次 stat 加 1,000 次 append，无逐行 mkdir/exists。
- 并发限流等待者分别预留第 1/2/3 秒的额度；HTTP 完成、失败、取消和超时不残留定时器与外部 abort 监听。

同一机器同一 fixture 的 p50 持续回退超过 25% 才值得复测调查；单次 p95 波动不直接判失败。操作次数、数据一致性与事务回滚是硬回归条件。

## 文件范围

- `src/main/BackupService.ts`、`src/main/ipc/storageDataOperations.ts`、`src/main/ipc/dataIpcHandlers.ts`：懒加载备份、完整文件发布、存储实例绑定。
- `src/storage/SqliteStorageService.ts`、`src/storage/sqlite/sqliteInitialization.ts`：连接/迁移生命周期，保持写入事务 API。
- `src/shared/normalizers/appData.ts`：旧模式索引。
- `src/main/RateLimiter.ts`、`src/main/services/AiCallProgressStore.ts`、`src/main/LogService.ts`：并发额度、轮询与日志开销。
- `src/services/NoveltyDetector.ts`、`src/services/novelty/noveltyText.ts`：单次匹配结果复用。
- 新增 `validate-backend-backup-laziness`、`validate-backend-ai-performance`、`validate-sqlite-initialization`、`validate-legacy-pipeline-mode-index`、`validate-novelty-audit-memo` 五个脚本；旧候选撤销脚本继续校验 main 可信 actor 与 revision，适配捕获实例的新调用形式。
- `scripts/benchmark-backend-checkpoints.mjs`、`scripts/run-tests.mjs`、package 版本与脚本、README/ROADMAP/CHANGELOG 和本记录：基准、回归注册及发布说明。

## 验收与本地包

- `npm.cmd test`：149/149 脚本通过。新增备份链路 14 项、初始化 27 项、AI 资源/轮询 13 项，以及旧模式 468 组、Novelty 90 组等价对照。
- `npm.cmd run typecheck`、`npm.cmd run build`：通过。
- 全量套件中的架构、模块化、密钥、乱码与公开发布检查通过；`git diff --check` 通过。
- Windows NSIS 安装包与 unpacked 已更新到 Preview.17，包内 SQLite smoke 通过；根目录 Node 绑定复验通过。只读/写入业务、Agent、版本链、导入导出、事务回滚和冲突拒绝仍由原有套件覆盖。
- 此次没有重新做全站视觉 QA，也没有验证安装向导的完整安装/卸载旅程或调用真实模型。

本地文件：`release/Novel Director Setup 0.1.6-preview.17.exe`、`release/win-unpacked/Novel Director.exe`、`release/BUILD_INFO.json`、`release/SHA256SUMS.txt`。旧 Preview.16 已复制到 `releases/archive/`。安装包 SHA256：`B4B334684DF4B6C229E0F245482B6D7E8F476C7DD6AC12F1F156A931D876C963`。这不表示已上传 GitHub Release。

## 仍需关注

1. 完整 AppData load/save 仍有 JSON 解析、规范化与跨进程序列化开销。下一步按实际最慢入口补定向读取，保留导入导出语义，不一次性拆全部业务接口。
2. 正式采纳、修订和候选决定仍需跨集合校验。只有证明可覆盖全部关联后，才缩小事务校验读取范围。
3. Novelty/冗余检测和 better-sqlite3 是同步 CPU 工作，较大输入仍可能短暂占用 main。先测最坏输入，再决定是否使用 worker，不为分层而引入线程池。
4. 日志仍同步追加；本轮只去掉可证明冗余的文件系统调用，没有引入可能丢日志的异步队列。
5. 本轮不减少 AI 调用数量，不改变写作判断，不宣称节省模型 token 或改善文学质量。

## English

This round keeps existing storage/IPC and generation contracts. It removes eager backup reads, publishes complete backups with unique names, rejects saves after a storage switch, shares retryable SQLite initialization, indexes legacy recovery, avoids progress-poll sorting, reserves concurrent rate-limit tokens, and removes redundant log directory operations. Novelty memoization is strictly scoped to one synchronous audit, preserving all results. The 500-chapter checkpoint median changed from 598.537ms to 1.443ms; full-save median from 1076.222ms to 252.549ms. A 24,000-character-context Novelty audit changed from 592.965ms to 255.035ms. These are isolated backend measurements, not UI or model latency. Deterministic operation counts and consistency checks are regression gates; wall-clock timing is observational. No user data or paid model calls were used.

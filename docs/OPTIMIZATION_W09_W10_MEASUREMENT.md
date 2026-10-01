# W09/W10：长篇性能与采纳成本实测

测量日期：2026-09-07。范围是四项优先事项中的第四项，不新增生成步骤、审稿规则或页面。前三项的交付记录仍分别保留。

后续更新：本文保留 Preview.9 的原始对照；其中 Agent 概览全量读取热点已由 [定向读取补丁](./OPTIMIZATION_AGENT_OVERVIEW_READ.md) 改善，500 章摘要约 397ms -> 32ms。桌面完整刷新与其他 full-detail 读取仍不变。

## 已确认的瓶颈与修复

500 章样本的完整 AppData 约 73.96 MiB。每章不仅有正文，还包含两份版本、草稿、14 个步骤、Prompt 快照和正式提交的历史副本。因此，用“正文只有多少字”估计保存成本会低估实际负载。

1. 原完整保存先删除全部实体再插入，修改一章也会重写全部历史。现在保留完整 AppData API，在同一 revision 校验事务内只插入、更新或删除实际变化的记录；未变化的历史正文与索引时间不重写。重复 ID 仍报错，不能由 UPSERT 静默吞掉。
2. 原生成步骤保存先加载全书 AppData，只为校验几个报告引用。现在仅读取本次 job 的草稿、一致性报告、质量报告和综合结论；旧行缺索引时，限定在这四个集合内按 payload 兼容。读取、校验和写入仍处于同一个短事务。
3. 正式采纳、修订、完整导出、JSON fallback 和 renderer 保存队列不改。没有删掉任何历史，也没有把整次生成包进长事务。

## 存储对照

Windows 11 x64、Ryzen 7 7800X3D、约 32 GB RAM、Node 24.14.0 / ABI 137、SQLite 3.53.0。每档热身 2 次、正式 9 次，使用单调时钟与 nearest-rank p50/p95。下表单位为毫秒。

| 场景 | 章数 | before p50 / p95 | after p50 / p95 |
| --- | ---: | ---: | ---: |
| 保存生成步骤 bundle | 10 | 7.589 / 8.709 | 0.914 / 1.005 |
| 保存生成步骤 bundle | 100 | 68.895 / 75.715 | 0.839 / 0.891 |
| 保存生成步骤 bundle | 500 | 392.962 / 410.621 | 1.029 / 1.218 |
| 修改一章后完整保存 | 10 | 8.709 / 15.702 | 5.022 / 12.379 |
| 修改一章后完整保存 | 100 | 122.322 / 130.423 | 52.024 / 54.067 |
| 修改一章后完整保存 | 500 | 826.074 / 852.457 | 309.431 / 375.850 |
| 读取完整快照 | 500 | 399.950 / 414.927 | 400.268 / 453.804 |
| Agent 简短项目摘要（含读取） | 500 | 402.162 / 421.717 | 423.755 / 480.499 |

500 章的生成步骤保存 p50 减少约 99.7%，单章编辑保存约 62.5%。**全量读取没有改善**，不能把写入收益宣传成整个软件提速。Agent 返回文字虽短，当前仍加载全库，后续应针对这条已测出的路径评估定向读取。

`total_changes()` 观测到：完整保存从每次约 25,833 次行变更降至约 4.09 次，包含 meta；不是磁盘写入字节数。10 项实体触发器测试另行验证“完全相同快照零实体写入、单章修改只更新该章”。基准首次保存还复原上一项测量的 job 时间字段，因此平均数不是整数。

这些数据测的是实际原生 SQLite 服务及真实 Agent 工具，但不含 Electron IPC、renderer 序列化、界面刷新或自动保存等待。界面收益必须单独测量。

## 真实界面口径

`benchmark-long-novel-ui.mjs` 启动真实生产 Electron，通过 CDP 发送鼠标和键盘事件；不用 jsdom、不模拟 preload。每档热身 1 次、正式 3 次，独立 profile，先完成迁移再开始计时；不清 OS 缓存。三次样本的 p95 就是最大值，不足以得出跨机器结论。

- 冷启动：新进程到项目列表及“进入”按钮可用。
- 进入项目：点击进入到项目工作台显示。
- 章节：进入章节页到全部章节列表显示，编辑正文并等待“正文已保存”，再经现有 API 回读核对。
- 切换项目：进入另一个项目后返回原项目。
- Agent：进入 Agent 页与点击“读取最新结果”。本项检查已有持久化结果，不是外部写入并发测试。
- 编辑保存包含现有 500ms 自动保存等待。CDP heap/RSS 只作观测，不视为全进程峰值或硬预算。

Preview.8 包内 before 的 500 章 p50：冷启动 1,743ms、进入项目 2,233ms、编辑到已保存 2,152ms、保存并回读 2,891ms、切回项目 1,597ms。优化后的生产 out 隔离副本分别为 1,648ms、1,703ms、1,575ms、2,296ms、1,017ms；Agent 主动刷新仍为约 1,127ms。源码生产副本与 asar 封装不同，因此另做下方实际包内复测，不用这组冷启动变化单独宣称收益。

### 实际安装包内对照

已完成 Preview.8 -> Preview.9 的实际 unpacked 对照。发现中途增加窗口激活后，又用最终驱动重测归档的 Preview.8；两端 harness、fixture、normalizer 哈希一致，均为 Electron 39.8.9 / Chromium 142。下表采用这组匹配后的 before；最初 before 和生产 out 数字仅保留作中间记录。每格为 p50/p95，单位毫秒。

| 场景 | 10章 before -> after | 100章 before -> after | 500章 before -> after |
| --- | ---: | ---: | ---: |
| 冷启动可交互 | 822/1000 -> 965/999 | 956/958 -> 925/1134 | 1608/1795 -> 1788/1795 |
| 进入项目 | 385/393 -> 383/411 | 690/716 -> 620/627 | 2247/2257 -> 1643/1702 |
| 章节列表就绪 | 333/337 -> 336/345 | 346/347 -> 342/347 | 383/388 -> 384/384 |
| 编辑到已保存 | 542/544 -> 541/560 | 767/796 -> 732/736 | 2095/2116 -> 1562/1576 |
| 编辑到保存并回读 | 558/562 -> 559/579 | 897/923 -> 864/873 | 2803/2826 -> 2274/2308 |
| 从另一项目返回 | 53/54 -> 53/54 | 280/290 -> 220/223 | 1567/1577 -> 1014/1030 |
| 进入 Agent | 327/334 -> 327/332 | 392/395 -> 402/404 | 727/761 -> 737/748 |
| Agent 确认刷新 | 50/58 -> 48/53 | 207/211 -> 204/213 | 1145/1167 -> 1114/1150 |

500 章的保存就绪约快 25%、保存并回读约快 19%、返回项目约快 35%。10 章规模基本没有保存收益，启动与 Agent 刷新没有稳定改善；启动三次样本存在调度波动，10/500 章 p50 反而较高，不宣称变快。项目打开/切换会保存最近访问时间，因此也受益于差异写入。

## 最终采纳成本的边界

新增确定性 `AcceptedChapterCostService`，沿当前正文的正式版本与提交关系追溯生成任务、任务编辑来源及修订。调用按 `callId` 去重，不把 trace、质量报告和提交副本重复累计。

- 分开报告规划、正文、提取、审稿、修订的已知 token、调用耗时、失败、重试与缺失项。
- 没有 usage、没有可追溯来源或旧修订缺遥测时标为 partial/unknown，不当作零成本。
- 同章序的旧失败运行不凭猜测并入；可显式提供关联 job，仍检查项目与章序。
- 没有提供价格就不计算金额。显式统一费率仅用于调用方指定的对照口径，不是各供应商的实际账单。
- 调用耗时总和不等于作者从开始到愿意采纳的墙钟时间；它不包含人工阅读、决策等待及无法恢复的旧记录。

当前成本样本完全虚构、usage 为固定 mock，只证明归集正确和本地运算耗时。**尚未进行付费模型的质量/费用对照，不能据此宣称文学质量提升或省下多少模型费用。** 真实对照需要先确定样本、模型和费用范围，不自动读取作者小说。

成本归集本地基准热身 3 次、正式 20 次：10/100/500 章库中统计最后一章的 p50/p95 分别为 0.054/0.154ms、0.213/0.315ms、0.703/1.040ms。输入已在内存中，不含数据库读取、模型请求或计费；原始样本为 `tmp/performance/accepted-chapter-cost.json`。当时模型和费用上限尚待明确。2026-09-22 更新：作者已指定 DeepSeek V4.1 Flash、5 元上限；隔离执行器没有可用凭据，本轮按许可跳过，费用 0 元，见 [检查记录](./DEEPSEEK_FLASH_COMPATIBILITY.md)。

## 复现与验收

```powershell
# Node 原生绑定；不与 UI 测量、测试或打包同时运行
npm.cmd run native:check:node
npm.cmd run perf:storage -- --label current --output tmp/performance/long-novel-storage-current.json
npm.cmd run perf:accepted-cost

# 直接测已有生产包，不下载、不切换根目录的 Node 绑定
npm.cmd run perf:long-ui -- --run --label current --packaged-dir release/win-unpacked --output tmp/performance/long-novel-ui-current.json

# 测生产 out 的隔离副本，借用已有包内 Electron 绑定，不连接作者数据
npm.cmd run build
npm.cmd run perf:long-ui -- --run --label source --out-dir out --output tmp/performance/long-novel-ui-source.json

npm.cmd run test:single -- sqlite-differential generation-bundle-scoped accepted-chapter-cost
```

UI 输出文件若已存在需另取名字，避免覆盖前次比较。脚本保留逐轮样本、环境、代码/构建指纹、规模、数据校验和进程退出记录。所有 profile/数据库都在 `tmp`，AI 请求计数必须为零。

原始报告已保留到文档目录：

- [存储 before](./performance/long-novel-storage-before.json)、[存储 after](./performance/long-novel-storage-after.json)。
- [匹配驱动后的 Preview.8 UI before](./performance/long-novel-ui-before-matched.json)、[Preview.9 包内 UI after](./performance/long-novel-ui-packaged-after.json)；[最初 UI before](./performance/long-novel-ui-before.json) 仅供追溯。
- [采纳成本归集](./performance/accepted-chapter-cost.json)。

原始测量 JSON 与日志仍在 `tmp/performance/`。2026-09-12 清理了已完成测试的重复样本数据库、迁移副本及自动备份，未改变下列结果；重跑时由基准脚本重新生成样本库。文档中的原始文件只含虚构样本的计数、校验、环境、耗时和源码/构建指纹；其中本机临时 profile/log 路径是当时的测量索引，不是作者数据路径，也不保证样本数据库永久保留。不要拿旧版本性能文档中的小样本数值替代 500 章结果。

回归优先断言实际行为：单章修改不写历史、相同快照不写实体、重复 ID 拒绝、更新/删除失败整体回滚、旧 revision 不覆盖新 bundle、JSON 往返与密钥脱敏。UI 时延先作为观测基线；同机连续复测偏离基线超过 25% 时再调查，不设容易受系统抖动影响的 CI 毫秒门禁。

## 本地发行

`0.1.6-preview.9` 的类型检查、134/134 验证脚本、生产构建、Windows 打包和包内 SQLite smoke 已通过。专项包括差异保存 10 项、采纳成本 11 项、定向校验读取，以及既有 SQLite 31 项和 bundle 交接 22 项。整套包含乱码扫描、架构边界和公开文档检查。

- 直接运行：`release/win-unpacked/Novel Director.exe`。
- 安装包：`release/Novel Director Setup 0.1.6-preview.9.exe`，107,767,716 字节（约 102.78 MiB）。
- 构建完成时间：2026-09-07 18:22（UTC+8）。
- SHA-256：`DEA6FBF478318A3CAF53F1D23F610D3B89BF13923E37584C6B10025EFD98134F`。
- 旧包保留于 `releases/archive/v0.1.6-preview.8-2026-09-07_10-21-31-049/`。
- 安装包未数字签名；没有发布 GitHub，也没有执行安装/卸载生命周期测试。
- Node ABI 137 绑定已恢复；包使用 Electron 39.8.9 / ABI 140。实际包内 10/100/500 章均完成热身及三次正式操作，保存和版本/集合回读正确，AI 请求为零；所有测量进程已退出。

## English

Measured on 2026-09-07 with isolated synthetic 10/100/500-chapter fixtures. Differential full-snapshot writes preserve AppData/transaction semantics while avoiding unchanged history rewrites. Generation checkpoint validation now reads only four collections for the current job inside the same transaction. At 500 chapters, storage-only median checkpoint saving fell from 392.962ms to 1.029ms, and single-chapter full-snapshot saving from 826.074ms to 309.431ms. Full reads and compact Agent digest reads remain around 400ms; no read-speed improvement is claimed.

Real production Electron UI measurements are separate from storage timing. They include native interaction, persistence readback, fresh isolated profiles and process cleanup. UI timing is observational, not a portable CI threshold. Accepted-chapter accounting follows explicit version/commit provenance, deduplicates call IDs, and marks missing usage as unknown. Synthetic usage validates accounting only; no paid literary-quality or real provider-cost comparison has been run.

Preview.9 passes typecheck, all 134 validation scripts, production build, Windows packaging and SQLite smoke. With matched harness/fixture hashes, actual packaged 500-chapter median edit-to-saved time improves from 2,095ms to 1,562ms, saved readback from 2,803ms to 2,274ms, and project return from 1,567ms to 1,014ms. Startup and Agent refresh do not show a stable gain; 10/500-chapter startup medians are higher in this small sample. Both package benchmarks finish all isolated workflows with zero AI requests and no leftover processes. The unsigned installer is a local trial, not a GitHub publication. Update on 2026-09-22: DeepSeek V4.1 Flash and a CNY 5 cap are now specified; this round skips paid comparison as permitted because the isolated runner has no credential. Cost remains zero.

# 重复计算与指令精简 / Redundant Work

日期：2026-10-31。性能优化完成后，按作者要求另行打包为本地 Preview.19，更新安装包及 `release/win-unpacked`；见 [发行产物说明](./RELEASE_ARTIFACTS.md)。没有调用模型或读取作者项目。

## 修改

1. **Novelty 审计**：旧实现只缓存同一词的匹配结果，不同词仍重复规范化和分词。现在同一次同步审计对同一原文只准备一次词边界、原文偏移和句子范围；结束或抛错后释放，嵌套审计互不共享。中文识别、证据和严重程度不变。
2. **Prompt 追踪**：复用第一次渲染结果，只对最终 Prompt 中的区块计数。删除无调用方的旧 HardCanon 格式化函数、重复伏笔排序常量和废弃类型导入。实际 HardCanon 服务和伏笔数量限制不变。
3. **token 估算**：用字符编码区间代替逐字符正则，保留原有中文、ASCII、其他字符权重和取整方式。
4. **修订指令**：公共事实约束只在 system 中出现；衔接、压缩、表达提示按所选类型加入，不再要求所有修订同时做所有事。全文修订不发送无用的 `targetRange: <none>`。去 AI 味合同、缺少输入处理、局部合并与正式提交未放宽。
5. **文档**：README 不再展示逐版本施工流水账，ROADMAP 不再把已完成能力和长期设想重复列成必做事项。原变更记录和验收文档仍可查。

事务、项目隔离、revision 冲突、正文与报告绑定、权限和密钥脱敏是有实际作用的校验，本轮没有删除。

## 实测

Windows x64，Ryzen 7 7800X3D，Node 24.14.0。基线是提交 `04e0a01` 中六个被修改模块；新旧实现使用同一套其余依赖。每项热身 3 轮、测量 15 轮，交替运行先后顺序。每轮深比较完整审计结果或最终 Prompt、区块记录、token 和 warnings。

单位 ms，单元格为 p50 / p95。这里测真实服务计算，不是页面交互或远程模型响应时间。

| 场景 | 修改前 | 修改后 |
| --- | --- | --- |
| 2,000 字正文 + 1,000 字上下文审计 | 15.621 / 22.111 | 3.234 / 4.424 |
| 2,000 字正文 + 8,000 字上下文审计 | 109.519 / 172.237 | 10.895 / 14.459 |
| 2,000 字正文 + 24,000 字上下文审计 | 288.227 / 542.124 | 25.513 / 42.600 |
| 24,000 字正文、短上下文审计 | 44.456 / 90.076 | 38.247 / 63.477 |
| 160,000 字正文、短上下文审计 | 107.146 / 200.670 | 107.196 / 191.921 |
| 10 章样本 Prompt 构建 | 1.919 / 3.498 | 1.172 / 1.410 |
| 100 章样本 Prompt 构建 | 3.716 / 8.004 | 2.201 / 4.053 |
| 500 章样本 Prompt 构建 | 19.099 / 21.912 | 11.081 / 15.487 |
| 24,000 字 token 估算 | 1.028 / 2.213 | 0.253 / 0.823 |

长上下文审计中位耗时约减少 91%，500 章 Prompt 构建约减少 42%。超长正文的中位耗时没有改善，不把尾部波动算作收益。

短合成修订请求中，system + user 的估算 token：润色 1,044 -> 649；认知修复 1,052 -> 604；去 AI 味 2,722 -> 2,274；衔接 1,048 -> 655；删冗余 1,045 -> 658。固定指令约减少 16%–43%，长正文中的占比会更低；不是模型账单或成文质量结论。

复现：

```powershell
npm.cmd run perf:redundancy
node scripts/validate-redundant-work.mjs
node scripts/validate-novelty-audit-memo.mjs
```

基准需要本地 Git 历史包含 `04e0a01`。原始样本、源码 hash 和环境见 [JSON](./performance/redundant-work.json)。自动化门槛检查语义等价与分词/渲染次数，不用毫秒数阻断不同机器上的 CI。

## 验证与限制

新增 5 组回归覆盖跨词分词复用、Unicode token 等价、Prompt 区块遗漏原因和按修订类型筛选指令。原有 Novelty 90 组对照及嵌套/异常清理检查通过；修订合同的 11 项检查通过。`npm.cmd test` 的 150 项验证脚本、`npm.cmd run typecheck` 和 `npm.cmd run build` 均通过，完整套件包含架构与乱码检查。额外只读代码审阅未发现本轮修改引入的回归。

额外使用新生产构建和隔离虚构数据启动 Electron。第二次检查完成启动、打开章节、编辑及 SQLite 保存回读，但项目切换后的按钮命中检查遇到遮挡；第一次则在自动化等待时超时。两次均无 renderer 异常、无 AI 请求，退出后没有遗留测试进程。这不是完整 UI 验收，也不是 UI 性能对照，不能用这些单次数据声明界面整体提速。记录位于 `tmp/performance/long-novel-ui/run-iIRAnL/report.json` 和 `tmp/performance/long-novel-ui/run-76e8J0/report.json`。

首次源码检查时，根目录 Electron 为 39.8.10，旧安装包及其 SQLite 绑定来自 39.8.9；当时使用隔离的 39.8.9 运行时。后续 Preview.19 使用 39.8.10 打包，SQLite 绑定先通过目标运行时查询，再通过成品程序的隔离启动检查。根目录 Node 绑定未替换。上述两次源码 UI 检查不冒充新版安装包验收。

缓存只在一次审计内，仍需扫描原文匹配不同词；超长正文和全量 AppData 读取的成本仍存在。本轮未改 UI 样式、存储协议或数据格式，未评估真实模型的文学质量。构建产物与安装包分开管理，使用旧 EXE 不会自动加载本轮源码。

## English

This source-only pass reuses prepared text within each synchronous Novelty audit, removes duplicate Prompt rendering for trace metadata, replaces per-character regular expressions in token estimation, and selects revision instructions by task type. Public documentation now separates current work from historical release logs.

Alternating before/after measurements use three warmups and fifteen iterations, with equivalent audit and writing-prompt outputs checked each time. Long-context audit median drops from 288.227ms to 25.513ms; the 500-chapter Prompt fixture drops from 19.099ms to 11.081ms. Very long body scans do not improve. Revision instruction estimates shrink 16%–43% on short synthetic requests, not on full production manuscripts. A subsequent author-requested local Preview.19 package includes these changes; see [release verification](./RELEASE_ARTIFACTS.md). No paid model calls, author data changes or GitHub publication occurred.

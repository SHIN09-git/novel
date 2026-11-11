# 路线图 / Roadmap

更新日期：2026-11-11。这里只保留当前方向和下一步，不再重复各版本的施工日志、源码行数和已完成待办。历史变更见 [CHANGELOG](./CHANGELOG.md)，包的实际状态见 [发行产物说明](./docs/RELEASE_ARTIFACTS.md)。

## 当前方向

让作者和 Codex 顺畅完成“任务 -> 生成 -> 阅读 -> 修改 -> 采纳 -> 下一章”。优先解决实测慢入口、重复操作和错误指令，不为缩小文件或增加保护层而重构。

## 已有基础

- 本地 SQLite、JSON 导入导出、备份和三类事务提交已接入。章节版本可查看、比较和恢复。
- Context Need Planner、预算选择、角色硬状态、伏笔操作规则和 HardCanon 共用最终 Prompt 与 Run Trace。
- 桌面和 Agent 共用生成、审稿、修订、候选决定及正式提交流程；项目权限可以撤回。
- 章节阅读、局部重写、任务编辑、候选历史和作者诊断摘要已有入口。

2026-10-31：复用单次 Novelty 审计的分词结果，去掉 Prompt 追踪的重复渲染，简化 token 扫描；修订指令按类型输出。范围、实测和限制见 [本轮性能记录](./docs/REDUNDANCY_PERFORMANCE.md)。已纳入本地 Preview.19 安装包和 `release/win-unpacked`，尚未上传 GitHub。

## 下一步优先事项

按[长篇完稿后的修复计划](./docs/LONG_NOVEL_COMPLETION_REPAIR_PLAN.md)，源码已支持保留超限稿、成稿硬规则核查、全书进度与连写顺序、按章取余额和跨章事实核对。P2 增加按书统计模型用量、调用前估算、连接诊断、按起止章编排导向，以及可预览和追溯的批量改名。尚不能从用量反推供应商余额或旧书缺失的账单。下表保留原有维护事项；安装包要单独更新。

| 优先级 | 工作 | 完成条件 |
| --- | --- | --- |
| 1 | 处理已报告的依赖安全告警 | 核对受影响调用，按兼容范围升级；完整回归和包内 SQLite 启动通过后再发包 |
| 2 | 继续压缩实际慢入口 | 复现具体操作，测量全量数据读取、跨进程传输或诊断耗时；只有可重复收益才新增定向查询或后台计算 |
| 3 | 用真实修订案例检查提示词 | 对比指定问题是否修好、无关段落是否保留；记录 Novelty 误报/漏报，避免继续堆全局禁令 |
| 4 | 修补高频操作中的阻碍 | 优先未保存输入恢复、采纳失败恢复、阅读和修订切换；按用户反馈选具体入口，不做全站重设计 |

真实模型对照需要另行确认供应商、模型和费用。本地性能基准不消耗模型额度，不能替代成文质量评估。

## 保留的必要校验

正式写入仍检查项目归属、当前正文与报告是否匹配、版本冲突和重复提交。事务回滚、备份、权限撤回及密钥脱敏继续保留。AI 候选只有经用户或授权 Agent 确认后才能成为正式数据。

改代码后运行：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

更新安装包时另跑 `npm.cmd run smoke:packaged`；公开发布前做密钥扫描。每项新优化必须有行为回归或实测依据，不新增只检查文案和文件行数的门槛。

## 暂缓

全库 CRUD/关系型重构、FTS、图谱、云同步、通用插件系统、多模型路由矩阵和全站视觉重做不作为本轮必做项。签名与自动发布在实际分发需要时推进。已有可用流程不因旧路线图中的长期设想重复施工。

## 参考

- [新手教程](./docs/BEGINNER_TUTORIAL.md)：如何使用现有能力。
- [Agent 授权指南](./docs/AGENT_PROJECT_AUTHORIZATION.md)：Codex 与桌面共享数据和权限。
- [后端性能复核](./docs/BACKEND_PERFORMANCE_REVIEW.md)：备份、保存、初始化的历史测量。
- [长篇界面实测](./docs/PREVIEW14_LONG_NOVEL_PERFORMANCE.md)：10/100/500 章真实应用基线。
- [原施工计划](./docs/PRODUCT_OPTIMIZATION_MASTER_PLAN.md)：已完成批次的背景，不作为新的待办清单。

## English

Updated 2026-11-11. The [long-novel repair plan](./docs/LONG_NOVEL_COMPLETION_REPAIR_PLAN.md) now includes project-level usage, single-request cost estimates, connection diagnoses, custom story-direction ranges and auditable chapter renames, in addition to draft retention, canon checks and cross-chapter continuity. Provider balances and unrecorded historical usage remain unknown. This describes the working tree, not a new installer.

Next: verify dependency advisories; profile concrete slow operations before redesigning storage or threading; evaluate task-specific revision instructions with real cases; repair reported editing and acceptance friction. The [current performance record](./docs/REDUNDANCY_PERFORMANCE.md) covers the optimizations now packaged locally as Preview.19, not a claim about model quality or a GitHub publication.

Keep project isolation, version conflict checks, idempotent commits, report provenance, rollback, backups, authorization and credential redaction. Full CRUD rewrites, FTS, graphs, cloud sync and generic extension systems remain deferred. Historical plans and measurements are references, not additional mandatory work.

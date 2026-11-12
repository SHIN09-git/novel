# 路线图 / Roadmap

更新日期：2026-11-13。这里只保留当前方向和下一步，不再重复各版本的施工日志、源码行数和已完成待办。历史变更见 [CHANGELOG](./CHANGELOG.md)，包的实际状态见 [发行产物说明](./docs/RELEASE_ARTIFACTS.md)。

## 当前方向

让作者和 Codex 顺畅完成“任务 -> 生成 -> 阅读 -> 修改 -> 采纳 -> 下一章”。优先解决实测慢入口、重复操作和错误指令，不为缩小文件或增加保护层而重构。

## 已有基础

- 本地 SQLite、JSON 导入导出、备份和三类事务提交已接入。章节版本可查看、比较和恢复。
- Context Need Planner、预算选择、角色硬状态、伏笔操作规则和 HardCanon 共用最终 Prompt 与 Run Trace。
- 桌面和 Agent 共用生成、审稿、修订、候选决定及正式提交流程；项目权限可以撤回。
- 章节阅读、局部重写、任务编辑、候选历史和作者诊断摘要已有入口。

[Preview.20](https://github.com/SHIN09-git/novel/releases/tag/v0.1.6-preview.20) 已公开发布，包含[长篇完稿修复](./docs/LONG_NOVEL_COMPLETION_REPAIR_PLAN.md)：超限保稿、成稿硬规则核查、跨章对账、按书统计用量和批量改名。用量不能反推供应商余额或缺失的历史账单。此前减少 Novelty 重复分词、Prompt 追踪重复渲染的实测见[性能记录](./docs/REDUNDANCY_PERFORMANCE.md)。

## 下一步优先事项

见[书库可靠性与长篇性能施工计划](./docs/LIBRARY_STABILITY_AND_PERFORMANCE_PLAN.md)。本轮候选为 **preview.21**；候选测试与公开发布分开，未替换已发布的 preview.20。

| 优先级 | 工作 | 完成条件 |
| --- | --- | --- |
| S0 / S1，本地完成 | 保留 preview.20 虚构库；区分书库未打开和空书库 | 从错误页重试、选择已有库、恢复至新文件或明确新建；不自动切换独立 JSON |
| S2，已验收 | 两台独立 Windows 虚拟机测试同一安装包 | [全新安装与原地升级均通过](./docs/S2_WINDOWS_QUALIFICATION.md)，包含重启、卸载及回退 |
| S3-A / S3-B | 打开项目只写最近打开时间；SQLite 按本次采纳或修订所需的记录校验 | 继续检查版本、项目归属、报告与正文；使用同一份虚构长篇书库对照 |
| S4 | 压缩新自动备份，保留可供旧版恢复的普通 JSON；手动备份不轮替 | 两种格式均可恢复；不删除历史步骤或改写现有提交回执。首屏历史按需加载继续暂缓 |

具体的修订质量、Novelty 误报和未保存输入仍按作者反馈跟进，不阻塞上述交付。本轮性能验收不消耗模型额度，也不替代成文质量评估。

## 保留的必要校验

正式写入仍检查项目归属、当前正文与报告是否匹配、版本冲突和重复提交。事务回滚、备份、权限撤回及密钥脱敏继续保留。AI 候选只有经用户或授权 Agent 确认后才能成为正式数据。

改代码后运行：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

发布候选包另跑 `npm.cmd run smoke:release` 检查解包程序，再用 Setup 验证实际安装和升级；两者不能互相替代。公开发布前做密钥扫描。每项新优化必须有行为回归或实测依据，不新增只检查文案和文件行数的门槛。

## 暂缓

全库 CRUD/关系型重构、FTS、图谱、云同步、通用插件系统、多模型路由矩阵和全站视觉重做不作为本轮必做项。签名与自动发布在实际分发需要时推进。已有可用流程不因旧路线图中的长期设想重复施工。

## 参考

- [新手教程](./docs/BEGINNER_TUTORIAL.md)：如何使用现有能力。
- [Agent 授权指南](./docs/AGENT_PROJECT_AUTHORIZATION.md)：Codex 与桌面共享数据和权限。
- [后端性能复核](./docs/BACKEND_PERFORMANCE_REVIEW.md)：备份、保存、初始化的历史测量。
- [长篇界面实测](./docs/PREVIEW14_LONG_NOVEL_PERFORMANCE.md)：10/100/500 章真实应用基线。
- [原施工计划](./docs/PRODUCT_OPTIMIZATION_MASTER_PLAN.md)：已完成批次的背景，不作为新的待办清单。

## English

Updated 2026-11-13. The [preview.20 prerelease](https://github.com/SHIN09-git/novel/releases/tag/v0.1.6-preview.20) includes the [long-novel fixes](./docs/LONG_NOVEL_COMPLETION_REPAIR_PLAN.md). Provider balances and unrecorded historical usage remain unknown.

The [library plan](./docs/LIBRARY_STABILITY_AND_PERFORMANCE_PLAN.md) qualifies preview.21 separately from public releases. Project opening no longer sends a full snapshot; SQLite commits load their validation inputs by scope. New automatic backups use compression where the file can be restored safely. Existing receipts and manual backups are retained. Full-library startup reads are a separate, deferred optimization.

Keep project isolation, version conflict checks, idempotent commits, report provenance, rollback, backups, authorization and credential redaction. Full CRUD rewrites, FTS, graphs, cloud sync and generic extension systems remain deferred. Historical plans and measurements are references, not additional mandatory work.

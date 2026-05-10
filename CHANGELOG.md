# 更新日志 / Changelog

## 简体中文

Novel Director 的重要变更会记录在这里。

### 0.1.0 - Public Preview

#### 新增

- 本地优先的 Novel Director 桌面 MVP。
- 项目、小说圣经、章节、角色、伏笔、时间线和阶段摘要管理。
- Prompt 构建器，支持 Context Need Planner、上下文预算选择、Prompt Priority Stack、上下文快照和 token 估算。
- 生产流水线，支持章节计划、正文草稿、复盘候选、一致性审稿、质量门禁、Novelty audit 和 Run Trace。
- Character State Ledger MVP，用于追踪角色硬状态。
- 修订工作台，支持安全局部修订合并、版本历史和差异视图。
- 章节复制/导出和数据路径管理。
- 在 Electron `safeStorage` 可用时安全保存 API Key。
- 公开文档、安全策略、贡献指南、CI 和第三方声明。

#### 已知限制

- 当前应用仍是实验性预览版。
- JSON 存储是本地优先且便于迁移的，但尚不是稳定公开数据交换协议。
- AI provider 行为会随模型和配置变化。
- 质量门禁、Novelty Detector 和状态校验使用保守确定性检查，并在可用时结合配置的 AI 调用；接受变更前请人工复核。
- 生成二进制不进入源码仓库。Release 产物应单独发布并附带校验和。

---

## English

All notable changes for Novel Director are documented here.

### 0.1.0 - Public Preview

#### Added

- Local-first Novel Director desktop MVP.
- Project, story bible, chapter, character, foreshadowing, timeline, and stage summary management.
- Prompt Builder with context need planning, context budget selection, prompt priority stack, context snapshots, and token estimates.
- Generation Pipeline with chapter planning, draft generation, review candidates, consistency review, quality gate, novelty audit, and run trace.
- Character State Ledger MVP for hard-state tracking.
- Revision Workbench with safe local revision merge, version history, and diff view.
- Chapter copy/export and data path management.
- Secure API key storage through Electron `safeStorage` where available.
- Public documentation, security policy, contribution guide, CI, and third-party notices.

#### Known Limitations

- The app is an experimental preview.
- JSON storage is local-first and portable, but not yet a stable public data interchange contract.
- AI provider behavior varies by model and configuration.
- Quality gate, novelty detection, and state validation use conservative deterministic checks plus configured AI calls where available; review results before accepting changes.
- Generated binaries are not tracked in the repository. Release artifacts should be distributed separately with checksums.

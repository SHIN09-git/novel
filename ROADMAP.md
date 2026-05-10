# 路线图 / Roadmap

## 简体中文

这份路线图面向公开读者，刻意避免暴露私有安全备注、本地开发路径或内部审计细节。

### 0.1.0 预览版范围

- 本地优先 Electron 桌面应用。
- JSON 持久化，包含备份和迁移保护。
- 项目、小说圣经、章节、角色、伏笔、时间线、阶段摘要和设置管理。
- Prompt 构建器，支持上下文快照、token 预算、Context Need Planner、Prompt Priority Stack 和伏笔 treatment mode。
- 生产流水线，支持草稿生成、章节复盘、记忆候选、一致性审稿、质量门禁、Novelty audit 和 Run Trace。
- 修订工作台，支持版本历史和差异对比。
- 章节复制/导出和数据路径迁移。

### 近期优先级

#### 数据安全

- 继续扩展保存顺序、迁移合并、备份恢复和导入导出边界的回归覆盖。
- 改进 JSON 损坏和迁移失败时的用户恢复指引。
- 为更旧的 AppData 版本补充 fixture 测试。

#### 生成质量

- 改进 Context Need Planner 在场景类型、出场角色、硬状态需求和禁止上下文上的启发式判断。
- 改进 Novelty Detector 对新规则、新组织、新系统机制和新命名角色的识别准确度。
- 优化 prompt 压缩，让远期摘要保留因果信息，同时不过载 prompt。

#### 可用性

- 继续简化生产流水线界面，围绕“当前唯一主动作”组织页面。
- 为报告和 trace 增加更清晰的空状态、摘要和渐进展开。
- 改进键盘操作和长文本编辑体验。

#### 打包和发布

- 仅通过 GitHub Releases 发布签名或带校验和的构建产物。
- 继续禁止生成二进制进入源码仓库。
- 记录构建来源和 release checksums。

### 长期方向

- 可选 SQLite 存储后端。
- 更细粒度的项目导入/导出。
- 多 AI API provider adapter。
- 更丰富的时间线和人物关系视图。
- 更强的结构化输出校验。
- 更好的无障碍和键盘导航。

### 已知限制

- 当前仍是早期预览版；数据格式通过 normalize 保持兼容，但长期 schema 稳定性尚未承诺。
- AI 输出质量取决于配置的模型和 provider。
- Novelty Detector 和质量门禁使用保守启发式，可能有误报或漏报。
- 本地优先不等于远程私密；启用远程 AI provider 时，prompt 上下文会发送给该 provider。

---

## English

This roadmap is intentionally public-facing. It lists planned product directions without exposing private security notes, local development paths, or internal audit details.

### 0.1.0 Preview Scope

- Local-first Electron desktop app.
- JSON persistence with backup and migration safeguards.
- Project, story bible, chapter, character, foreshadowing, timeline, stage summary, and settings management.
- Prompt Builder with context snapshots, token budgeting, context need planning, prompt priority stack, and foreshadowing treatment modes.
- Generation Pipeline with draft generation, chapter review, memory candidates, consistency review, quality gate, novelty audit, and run trace.
- Revision Workbench with version history and diff view.
- Chapter copy/export and data path migration.

### Near-Term Priorities

#### Data Safety

- Continue expanding regression coverage for save ordering, migration merge, backup restore, and import/export edge cases.
- Improve user-facing recovery guidance for corrupt JSON and failed migration attempts.
- Add fixture-based tests for older AppData versions.

#### Generation Quality

- Improve Context Need Planner heuristics for scene type, cast selection, hard-state requirements, and forbidden context.
- Improve novelty detection accuracy for new rules, organizations, system mechanics, and named characters.
- Refine prompt compression so long-range summaries preserve causality without overloading the prompt.

#### Usability

- Continue simplifying the Generation Pipeline interface around one primary action at a time.
- Add clearer empty states and progressive disclosure for reports and trace details.
- Improve keyboard and long-text editing ergonomics.

#### Packaging and Releases

- Publish signed or checksummed build artifacts through GitHub Releases only.
- Keep generated binaries out of the source repository.
- Document build provenance and release checksums.

### Longer-Term Ideas

- Optional SQLite storage backend.
- More granular project import/export.
- Provider adapters for multiple AI APIs.
- Richer visual timeline and relationship views.
- More robust structured-output validation.
- Better accessibility and keyboard navigation.

### Known Limits

- This is an early preview; data format compatibility is maintained through normalization, but long-term schema stability is not guaranteed yet.
- AI output quality depends on the configured model and provider.
- The novelty detector and quality gate use conservative heuristics and can produce false positives or false negatives.
- Local-first does not mean remote-private when a remote AI provider is enabled; prompt context can be sent to that provider.

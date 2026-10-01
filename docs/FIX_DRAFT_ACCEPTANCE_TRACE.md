# 草稿采纳误冲突修复 / Draft Acceptance Trace Fix

## 简体中文

日期：2026-09-08。源码版本：`0.1.6-preview.11`；实际安装包状态以 `release/BUILD_INFO.json` 为准。

### 原因

采纳时，`ChapterCommitBundleService` 从界面内存中的生成记录构建提交。SQLite/JSON 读取则先经过 `normalizeAppData`，补齐可选字段。校验将二者直接作严格内容比较，因而可能把表示形式的差异误判为历史记录被改写。

隔离样本已复现同样的 `GenerationRunTrace ... is immutable and cannot be replaced with different content`：运行时 Prompt block 没有 `sourceIds`、`compressed`、`forced`、`omittedReason`，读取后分别补为 `[]`、`false`、`false`、`null`。正文、报告和实际上下文均未改变。

### 修复范围

- 构建章节提交时，使用既有 normalizer 统一 trace、质量、一致性和冗余报告的表示形式。
- 校验端对从数据库推导的预期记录使用同样的 normalizer；收到的提交仍须严格相等，不能借标准化掩盖篡改。
- 只允许采纳本身已有的章节关联、最新匹配报告关联、过期 Novelty 脱离和提交时间变化。不删除旧报告，不伪造通过，不自动接受记忆候选。
- 不改数据库 schema，不批量迁移作者数据，不需要重新生成已有草稿。已保存的历史提交继续按原回执验证并幂等重放。

### 验证

```powershell
npm.cmd run test:single -- draft-acceptance-trace unreviewed-draft-acceptance chapter-commit-bundle
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

新增专项 12/12 场景通过，使用真实 Node SQLite 与 JSON，涵盖未标准化运行时数据到存储、重新读取后的采纳、有效/过期 Novelty、三种真实篡改拒绝，以及重复提交保留后续正文。原有采纳检查 127/127 通过，章节提交检查 17/17 通过；完整 137 个验证脚本、类型检查、生产构建通过。

测试仅使用仓库 `tmp` 下的虚构数据，没有调用远程模型，没有读取或改写作者小说。存储测试不等于真实作者项目已经执行采纳；是否成功采纳仍由作者在更新程序后确认。

边界：本次处理有效记录的可选默认字段差异。极旧或受损记录若缺少稳定 ID、创建时间，既有 normalizer 的动态补值仍可能产生额外冲突；本次没有自动重写这些历史记录。更新后若仍报错，应单独诊断缺失字段，不能跳过不可变校验。

## English

Runtime diagnostics and database reads previously used different representations of optional defaults. Exact trace validation could reject an otherwise unchanged draft acceptance. The builder and expected-snapshot validator now use the existing normalizers; incoming receipts remain strictly checked. No schema migration, automatic acceptance, report deletion or author-data rewrite is performed.

The regression covers raw runtime input, normalized reloads, SQLite/JSON saves, current and stale Novelty audits, evidence tampering and idempotent replay after later edits. The 12 new scenarios, 127 acceptance checks, 17 chapter-commit checks, all 137 validation scripts, typecheck and production build pass. Fixtures are isolated and synthetic. Source verification is not a claim that a running desktop executable has been replaced; inspect the matching release metadata.

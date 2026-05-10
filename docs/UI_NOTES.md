# UI 说明 / UI Notes

## 简体中文

这份公开说明概括 Novel Director 的界面方向，不包含内部审计细节。

Novel Director 应该像一个安静的小说生产控制台，而不是通用后台管理面板。核心交互路径是：

1. 准备上下文；
2. 生成或导入草稿；
3. 检查风险；
4. 修订；
5. 只接受作者信任的内容。

### 设计原则

- 每个页面状态只突出一个主动作。
- 草稿正文、诊断报告和记忆更新必须视觉分区。
- 默认展示摘要，trace/debug 信息通过展开查看。
- 始终显示上下文来源：自动选择或 Prompt Context Snapshot。
- 区分草稿和已接受章节。
- 长期记忆写入是高风险操作，必须显式确认。
- Run Trace 应可访问，但不抢占主视野。

### 关键工作区

- Dashboard：项目状态和下一步动作。
- Chapters：正文写作与章节复盘。
- Prompt Builder：上下文控制台。
- Generation Pipeline：章节生产执行控制台。
- Revision Workbench：对比、差异和接受。
- Settings：本地数据、API 配置和导入导出。

### 后续 UI 方向

- 继续围绕配置、当前产物、诊断和 trace 简化生产流水线。
- 改进一致性审稿、质量门禁、Novelty audit 和记忆候选的报告分组。
- 增加更多 scoped styles，降低全局 CSS 耦合。

---

## English

This public note summarizes the intended interface direction without exposing internal audit details.

Novel Director should feel like a calm fiction production console rather than a generic admin panel. The primary interaction pattern is:

1. prepare context,
2. generate or import a draft,
3. inspect risks,
4. revise,
5. accept only the parts the author trusts.

### Design Principles

- Show one primary action per page state.
- Keep draft text, diagnostic reports, and memory updates visually separate.
- Prefer summaries by default and expandable detail for trace/debug information.
- Make context source visible: automatic selection or Prompt Context Snapshot.
- Distinguish drafts from accepted chapters.
- Treat long-term memory writes as high-risk actions that require explicit confirmation.
- Keep Run Trace available but not dominant.

### Key Workspaces

- Dashboard: project status and next action.
- Chapters: writing and chapter review.
- Prompt Builder: context control console.
- Generation Pipeline: execution console.
- Revision Workbench: comparison, diff, and acceptance.
- Settings: local data, API configuration, and import/export.

### Future UI Direction

- Continue simplifying the Generation Pipeline around configuration, current artifact, diagnostics, and trace.
- Improve report grouping so consistency, quality gate, novelty audit, and memory candidates do not compete for attention.
- Add more scoped styles to reduce global CSS coupling.

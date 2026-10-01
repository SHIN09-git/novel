# 候选处理历史与撤销 / W03 Trial

## 简体中文

日期：2026-09-06。目标版本：`0.1.6-preview.5`。这是全盘优化的第五批切片，复用既有候选、事务保存和 Agent Runtime；不表示 W01-W10 全部完成，也不表示已上传 GitHub。

### 作者操作

1. 打开“决策收件箱”。通过“伏笔”“时间线”“角色状态”等筛选找到待确认事件；展开“逐条确认”可以选择部分候选，不必整组接受。
2. 沿用“编辑后接受”修改实际采用值。接受或拒绝都会留下处理记录；候选接受不等于章节采纳。
3. 切到“处理记录”，点击“预览撤销”。核对当时写入、当前值和撤销后的值，再点“确认撤销这次处理”。高风险说明放在预览内，不另加第二次撤销弹窗。
4. 如相关字段后来被修改，预览会标明冲突。仅明确勾选同意后才能恢复；未改动的其他字段保留。取消或关闭预览不写入数据。
5. 撤销后候选回到待确认，原决定及撤销决定都保留。可以重新编辑、接受或拒绝；重复点击不会重复入账。

### 撤销边界

- 修改已有记录时，只恢复该决定改动的字段，不恢复整份 AppData，不回退正文版本。
- 新建角色状态撤销后停用该事实，保留原流水并新增一笔补偿流水。再次接受创建新的生效事实，旧历史仍能追溯。
- 本次新建的伏笔、时间线事件、阶段摘要或衔接桥可以移除；完整原建议和字段变更仍留在处理回执。被其他故事记录明确引用时，需先处理关联。
- 原状态日志和原交易不删除。其他候选后来加入的 Run Trace 关联不会一起被移除。
- 旧回执没有变更前值时只能查看，系统不编造可撤销记录。导入合并发生 ID 重映射、或回执包含必须脱敏的原值时，保留历史但不自动恢复该回执。
- 候选不能删除章节；事实角色或记录归属改变后，旧撤销不跨对象恢复。创作分歧并不因此新增门禁。

### 共享实现

| 范围 | 主要文件与目的 |
| --- | --- |
| 类型与旧数据 | `shared/types/candidateDecision.ts`、两个 candidateDecision normalizer：可选字段差异、归属、撤销预览及原回执引用；旧数据继续打开 |
| 决定与补偿 | `CandidateDecisionService`、`CandidateDecisionUndoService`、`candidateDecisionEffects/UndoChecks/Primitives`：字段级差异、幂等、明确冲突恢复、依赖检查与补偿记录 |
| 状态事实 | `characterState/stateMutations.ts`：修复空事实编号，允许撤销后的候选重新入账且保留旧流水 |
| 原子保存 | `JsonStorageService`、`sqlite/sqliteCandidateDecisions.ts`、IPC 类型和 `useAppData`：原命令支持撤销删除集，SQLite 同一短事务写入；JSON fallback、共享队列与 revision 冲突校验保留 |
| 作者界面 | `DecisionInboxView`、`views/inbox/DecisionInboxHistory/UndoPreview/decisionInboxUiModel`、`inbox.css`：部分选择、专项筛选、处理历史、差异和内联确认 |
| Agent | `agentCandidateUndoTools/Definitions`、输出格式化、分发与 Runtime：三项工具复用相同预览、命令和事务，不直接修改数据文件 |
| 导入 | `dataMerge/referenceRemapping.ts`：保留原回执引用；ID 被重映射时不冒用旧字段日志 |

新增 Agent 工具：`agent.getCandidateDecisionHistory`、`agent.previewCandidateDecisionUndo`、`agent.undoCandidateDecision`。先 compact 查询历史，需要字段详情时用 `detail: "full"`；提交传入预览指纹、当前 revision 和独立 `operationId`。重试相同命令沿用 ID，重新决定使用新 ID。Agent 确认不冒充人工授权，项目级高风险授权仍在后续 W08。

### 验收方式

```powershell
node scripts/validate-candidate-decision-undo.mjs
node scripts/validate-candidate-specialty-coverage.mjs
node scripts/validate-candidate-decision-undo-storage.mjs
node scripts/validate-decision-inbox-history-ui.mjs
node scripts/validate-agent-candidate-undo.mjs --require-native
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run dist:win
node scripts/qa-candidate-decisions-ui.mjs --packaged
git diff --check
```

使用仓库 `tmp/` 下的隔离 SQLite/JSON、虚构文本及本地模型 stub，不连接真实项目或付费模型。UI QA 实际点击、编辑、刷新和保存；测试初始化候选不当作“AI 自动提取已通过”。

### 本批实测结果

验收日期：2026-09-06（UTC+8），以下均是本批修改后的实际执行，不沿用旧包结果。

| 验证 | 结果 |
| --- | --- |
| 类型检查 | 通过 |
| 完整测试 | 120/120 个验证脚本通过；脚本数不等于断言数 |
| 撤销核心 | 24 条行为检查通过，含跨角色、受损回执、跨集合同编号和补偿重放 |
| 伏笔/时间线候选 | 31 条通过；含真实生产伏笔提取步骤的 stub 结果，时间线从结构化 patch 边界开始 |
| 保存与故障注入 | 28 条通过，包含隔离 native SQLite、JSON、事务中途失败、过期 full save 和模拟 renderer 队列 |
| Agent 撤销工具 | 23 条通过，其中 11 条使用真实 native SQLite；另有原候选接口 22 条回归 |
| 收件箱 UI 定向检查 | 通过，覆盖选择、筛选、单次内联确认、差异、过期预览、卸载及防重入 |
| 生产构建与 Windows 打包 | build、native rebuild、NSIS 和 packaged smoke 均通过 |
| 最新 unpacked 真实 UI | 44 条旅程检查、26 张截图通过；SQLite 刷新后结果一致 |
| 公开文档与代码扫描 | 乱码扫描 622 个文件通过；公开清理 31 项通过；`git diff --check` 通过 |
| 收尾 | Node SQLite 绑定恢复并通过 probe；测试 Electron 已退出 |

真实 UI 包括：只接受本事件的两条伏笔、时间线仍待确认；三类专项候选编辑后接受、刷新读取历史、取消撤销、正式撤销后再次刷新；从伏笔页手工改备注制造冲突，明确勾选后仅恢复冲突字段，后来修改的说明保留。截图复看修正了作者预览中的内部字段名和复选框尺寸；最终构建已重新打包、重跑。

原始记录：`tmp/preview5-full-tests.log`、`tmp/preview5-build.log`、`tmp/preview5-dist-win.log`、`tmp/preview5-packaged-qa.log`。最终包内 UI JSON 为 `tmp/visual-qa/candidate-decisions-packaged/result.json`，时间 `2026-09-05T23:32:58.662Z`，截图在同目录。重跑会替换这些临时产物；源码验证脚本可复现。没有将本地 stub 成功当作真实服务商速度或文学质量结论。

### 本地试用产物

- 直接运行：`release/win-unpacked/Novel Director.exe`。
- 安装包：`release/Novel Director Setup 0.1.6-preview.5.exe`。
- 身份与校验：`release/BUILD_INFO.json`、`release/SHA256SUMS.txt`。
- 包生成时间：`2026-09-05T23:31:38.124Z`；包内源码构建时间：`2026-09-05T23:31:13.659Z`。
- Electron 39.8.9；未签名（`NotSigned`），未上传 GitHub。旧 preview.4 已由打包脚本移入 `releases/archive/`。

安装包 SHA-256：

```text
F19E02D8FA2F865322E835B3D5E39DCBF1967F50B3CABB22542F4C7D36AC768B
```

### 后续工作

- 时间线候选的处理、编辑、接受与撤销已纳入相同机制；生产流水线仍没有独立的自动时间线提取步骤，本批不声称补齐。
- 撤销覆盖共享候选命令形成的新回执。旧页面中仍有直接保存的历史入口，不能凭旧记录补造决定前值；需按后续统一入口工作逐步接入。
- 本批按字段记录差异，数组按字段整体恢复；关联 ID 数组仅对现有 Trace 成员做增量补偿。更细的数组项合并尚未实现。
- 项目级 Agent 授权、任务编辑与局部上下文重建、真实模型质量/成本对照、长篇数据实测继续按全盘计划执行。
- 未验证实际安装、卸载和跨版升级；未签名，不自动发布 GitHub。

## English

Preview.5 adds candidate history, partial event selection, specialty filters and explicit undo. Undo creates a compensating receipt, restores only affected fields and preserves unrelated later edits and ledger history. Conflicting fields require an inline acknowledgement; a second undo modal is not needed. Chapter prose is not rewound by a candidate decision.

UI and three Agent tools reuse the same transaction-backed decision command, JSON fallback, shared save queue and revision checks. Agent acknowledgement is not human approval. Legacy or remapped receipts without trustworthy before-values remain readable but are not automatically reversible.

The commands above use isolated synthetic data. Typecheck, all 120 validation scripts, production build and Windows packaging passed. The final unpacked app passed 44 real UI journey checks with 26 screenshots, including edited ledger conflicts and reload persistence. Core undo passed 24 checks, specialty handling 31, storage 28 and Agent undo 23 (11 native SQLite). Node bindings were restored and test processes exited.

The unsigned installer is identified by the timestamp and SHA-256 above. Automatic timeline extraction, legacy direct-save entry consolidation and project-level Agent authorization remain separate work. Local packaging is not a GitHub release or installer lifecycle test.

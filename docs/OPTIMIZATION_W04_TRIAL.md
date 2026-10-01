# 阅读与就地修订验收 / W04 Trial

## 简体中文

日期：2026-09-06。目标版本：`0.1.6-preview.3`。本文件记录 W04 的可试用切片，不表示全盘 M1-M3 或完整 Agent 同权已经完成。

### 本批变化

| 作者动作 | 当前行为 |
| --- | --- |
| 选区 AI 重写 | 返回后先展示可编辑候选；可对比、继续改写、复制或放弃，应用前不修改正文 |
| AI 返回整章 | 单独标记为整章候选；明确采用后才替换整章，重新定位与继续改写不静默降为局部 |
| 等待中原文变化 | 当前候选保留；唯一片段可明确重新定位，否则由作者重新选区，不猜测插入位置 |
| 保存失败 | 不清空候选；阅读页手动保存按开始编辑时的正文校验，等待保存时锁定输入 |
| 旧修订要求 | 可在最新正文重新定位或明确改为整章；追加新要求并保留来源链接，不覆盖旧要求、候选和审稿 |
| 返回阅读 | 按项目保存本次窗口的章节与段落锚点；前文长度变化后按文本恢复，缺失或重复时回到该章附近 |
| 正式应用与撤销 | 阅读页继续走 RevisionCommitBundle 与版本链；章节文本区先更新编辑草稿，再走既有保存流程 |

### 代码边界

- `components/aiRewriteResultModel.ts`：选区合法性、候选范围识别、精确替换与重新定位。
- `components/useAiRewriteCandidate.ts`、`AiRewriteResultPanel.tsx`：共享候选生命周期、取消、继续改写、对比与明确应用。
- `AiRewriteTextArea.tsx`、`reading/useReaderAiRewrite.ts`：接入共享候选，保留既有 AI 服务和正式修订提交链路。
- `ReadingView.tsx`、`reading/useReaderNavigation.ts`、`readerPosition.ts`、`readerText.ts`、`ReaderChapterArticle.tsx`：阅读锚点、编辑基线、保存状态和当前选区。
- `RevisionRequestRelocationService.ts`、`revision/revisionRequestRelocationActions.ts`、`useRevisionRequestRelocation.ts`、修订页相关组件及 `types/revision.ts`：旧请求重新定位及来源追踪。
- `styles/components.css`、`styles/features/revision-diff.css`、`styles/views/reader.css`：非模态候选面板、共享对比样式、紧凑窗口与独立阅读滚动。
- `scripts/run-tests.mjs`、三份专项脚本与 `scripts/utils/qa-reading-rewrite.mjs`：确定性回归及隔离 Electron 操作验证。

没有新增远程检测调用，没有改 PromptBuilder、生产主流程、SQLite schema 或真实项目数据。

### 验证方式

最终结果：`typecheck`、全部 **111 组**验证、生产构建、包内 smoke 均通过；生产预览与包内 EXE 各完成 **23 条**真实 UI 检查、**20 张**截图。中文扫描覆盖 578 个文件，公开发布检查 31 项通过，`git diff --check` 无错误。窗口检查包含 1440×900、1280×720 和阅读/候选的 1024×720。

最终包构建时间：`2026-09-05T21:49:11.903Z`（北京时间 2026-09-06 05:49）。安装包：`release/Novel Director Setup 0.1.6-preview.3.exe`。SHA-256：`AE88DE99E35FE070E38B03D937145DC985BCA70A95B55CC29B264D0D6C4366C6`。包内窗口报告同版本、SQLite backend 和构建时间；Authenticode 状态为 `NotSigned`。最终布局修补后重跑的是包内整套检查；此前生产预览已验证同一读改流程。

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run native:electron
node scripts/qa-candidate-decisions-ui.mjs
npm.cmd run native:node
npm.cmd run dist:win
node scripts/qa-candidate-decisions-ui.mjs --packaged
git diff --check
```

- `validate-ai-rewrite-result.mjs`：12 个行为用例，包括局部外文本不变、超范围、等待中改文、重复选区、保存失败、继续改写、取消与切换对象。Hook 状态模拟不冒充真实浏览器验收。
- `validate-revision-request-relocation.mjs`：11 个行为用例，包括跨项目隔离、旧证据保留、确认期间再次改文及新请求生成。
- `validate-reading-position.mjs`：唯一锚点、重复/缺失/删除锚点、项目隔离及存储不可用。
- 真实 UI 使用生产输出和包内 EXE、独立临时 SQLite、合成中文章节与本地 HTTP stub。检查局部/整章/重新选区应用后的正文、版本数和提交数；不调用付费模型，不接触真实小说。
- UI 原始结果与截图：`tmp/visual-qa/candidate-decisions/result.json`、`tmp/visual-qa/candidate-decisions-packaged/result.json` 及各自目录。每次复跑会替换该批临时验收资料。
- 发布标识与校验和以 `release/BUILD_INFO.json`、`release/SHA256SUMS.txt` 为准；源码通过不代表旧 EXE 自动更新。

### 边界与后续

1. 快捷重写候选目前只在当前页面保留；切换页面或退出前需要应用或复制。修订工作台的正式候选仍按原有数据结构保存。下一步补统一的跨页候选暂存，不自动把暂存候选写成正式章节。
2. 阅读位置是当前窗口的 sessionStorage，不承诺跨设备或关闭窗口后同步；段落被彻底改写时只能回到章节附近。
3. 整章识别是可解释启发式，不是语义保证；作者可手动调整范围，整章采用保留明确确认。
4. 本地 stub 证明调用与写入流程，不证明真实 provider 的文风质量、响应时延或节约比例。
5. 尚未执行真实安装/卸载/跨版本升级；安装包未签名，未上传 GitHub。W05 调用体验、W08 Agent 修订同权及长期暂存仍按主计划推进。

## English

This `0.1.6-preview.3` trial adds an editable quick-rewrite candidate panel, explicit whole-chapter adoption, stale-source reanchoring, revision-request relocation and session-local reading anchors. Formal reader edits still use versioned RevisionCommitBundle writes. No production pipeline, prompt builder or storage schema is replaced.

Focused behavior checks cover candidate composition, refinement, cancellation, scope changes, failed saves and relocation. Real production and packaged Electron QA use synthetic chapters, isolated SQLite and a loopback-only provider stub; they verify persisted prose and version chains, not just visible controls. See the commands and raw result paths above.

Quick candidates currently remain only within the mounted page; apply or copy before leaving. Reading anchors are local to the window session, broad-response detection is heuristic, and provider quality or performance gains are not inferred from stub tests. Installer upgrade/uninstall testing, code signing and GitHub publication are outside this trial.

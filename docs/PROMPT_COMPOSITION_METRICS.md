# Prompt Composition Metrics

## 中文说明

本基线用于测量最终章节写作 Prompt 的组成，不改变现有 Prompt 生成逻辑，也不把完整 Prompt 保存进指标结果。

指标服务位于 `src/services/PromptCompositionMetricsService.ts`，输入 `finalPrompt` 和 `promptBlockOrder`，输出：

- 最终 Prompt 总 token、已归因 token 和未归因 token；
- 正向任务、事实上下文、约束、审稿口吻及其他块的 token 数和占比；
- 每个 Prompt block 的 token、占比和分类；来源、优先级等信息继续由已有 `promptBlockOrder` 承担，避免重复持久化；
- 规范化后重复句子、高相似禁令的不可逆短指纹和关联 block；
- 不含完整 Prompt 或完整正文的摘要文本。

分类是可解释的启发式测量，不是语义质量评分：

- `positive_task`：写作任务、章节任务、剧情导向；
- `factual_context`：Bridge、角色状态、伏笔、时间线、章节回顾、HardCanon 等事实资料；
- `constraints`：优先级、NoveltyPolicy、输出格式、风格和禁止事项；
- `review_tone`：审稿、审计、质量、诊断等后台口吻；
- `other`：无法根据 block 元数据判断的内容。

重复检测先做 Unicode NFKC、大小写、空白和标点规范化，再检查完全重复句子。禁令提示使用轻量字符 n-gram 相似度，达到阈值时给出 warning。告警只持久化指纹，不保存原始 Prompt 句子。相似度比较预先计算 n-gram，并限制最多比较 160 条禁令、每类最多保留 16 条告警，避免异常长 Prompt 造成无界二次开销。它不能判断两条规则是否逻辑等价，也不会调用外部模型。

## 运行方式

基准使用虚构中文 Prompt，包含三个可复现场景：平衡、重复约束、回顾偏重。每个场景先热身 8 次，再测量 40 次，输出 p50/p95。

```powershell
node scripts/benchmark-prompt-composition.mjs --output tmp/performance/prompt-composition.json
node scripts/validate-prompt-composition-metrics.mjs
```

JSON 原始结果默认写入：

`tmp/performance/prompt-composition.json`

脚本会在 `tmp/performance/prompt-composition/` 生成临时的 Node bundle；这不是应用发布产物，也不读取用户项目数据。验证脚本的临时构建位于 `tmp/validation/prompt-composition-metrics/`。

## 解释基线

`totalTokenEstimate` 使用现有 `TokenEstimator` 计算最终 Prompt；运行时可复用流水线已经计算的总 token，避免重复扫描。每个 section 只会一对一归因给一个 block，找不到真实 section 的旧 block 不参与归因；分段取整造成的溢出也会在写入前对账。因此未结构化的 Prompt 头部或未匹配 section 会进入 `unattributedTokenEstimate`，且已归因 token 永远不会超过总 token。

指标已在首次 `build_context` 和计划后 `rebuild_context_with_plan` 写入同一条 Generation Run Trace，后者会覆盖成正文实际使用的最终 Prompt 指标。旧 trace 缺少该字段时规范化为 `null`。作者摘要只输出分类、block 数字和告警数量，不复制告警内容或 `finalPrompt`。

## English

This baseline measures the composition of the final chapter-writing prompt without changing prompt assembly or persisting the full prompt. It reports total tokens, attributed and unattributed tokens, category shares, per-block metadata, and short duplicate/near-duplicate constraint alerts.

Run:

```powershell
node scripts/benchmark-prompt-composition.mjs --output tmp/performance/prompt-composition.json
node scripts/validate-prompt-composition-metrics.mjs
```

The benchmark uses synthetic Chinese fixtures only and writes raw JSON under `tmp/performance/`.

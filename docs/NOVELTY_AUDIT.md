# Novelty Audit 中文匹配边界

Novelty Audit 是轻量、本地、确定性的风险筛查，不调用外部模型。它用于发现未授权新规则、新机制、新组织层级、重大设定揭示和机械降神式解法；它不是通用中文语义理解器。

## 当前匹配流程

1. 对原文逐 Unicode code point 做 NFKC 和小写规范化，同时保留规范化位置到原文 UTF-16 offset 的映射。
2. 用词典 Trie 一次扫描世界规则、系统机制、组织层级和重大设定词典，不再为每个关键词反复扫描全文。
3. 英文和数字遵守 word boundary；中文使用 `Intl.Segmenter('zh-CN', { granularity: 'word' })` 的起止边界。
4. 同一位置保留最长匹配，同一关键词在完全相同句子中只审计一次；每个关键词最多保留 256 个不同句子，避免恶意或异常长文本无界膨胀。
5. 语义层再判断任务书许可、已有上下文、HardCanon、同义词、规则来源、危机解除、受益对象、代价和限制。
6. 否定句、明确被否认/作废的引用、书名/店名/项目名等专名，以及普通物理距离会在生成 finding 前被过滤。
7. finding 继续保留原文 `index`、`matchEnd`、sentence 和 evidence excerpt；不会用规范化文本替换作者证据。

质量门禁、记忆候选、Inspector 和 Run Trace 复用同一份 `NoveltyAuditResult` 及 `collectNoveltyReviewFindings` 汇总策略，不会在下游重新按裸子串扫描，从而避免已消除的误报再次出现。

## 已覆盖语料

- 真阳性：附加/补充条款、临时权限、区域管理员、重大真相揭示、机械降神式脱困。
- 最小对照：相同关键词在否定句、引用和合理规则公告中的不同结论。
- 子串碰撞：`管理员工位`、`总部署`、`回收站台`。
- 专名：`源头书店`、书名《系统核心》。
- 否定和引用：`没有附加条款`、`不存在临时权限`、被记录明确否认的传言。
- 标点和宽度：中文标点、全角数字/拉丁字符保留正确 offset。
- 简繁范围：匹配器可处理显式提供的繁体词条，但默认 Novelty 关键词表仍以简体中文为主，不做自动简繁转换。
- 长文本：重复中文段落扫描和算法预算。

## 已知限制

- `Intl.Segmenter` 的词边界是启发式结果；新造专名、网络用语或题材术语仍可能需要词典配置。
- 跨句否定、反讽、梦境和复杂转述无法仅靠本地规则完全理解。
- 默认词典不自动进行简繁转换。需要繁体创作时，应增加经过测试的显式同义词，而不是在审计证据上做不可逆转换。
- 每个关键词最多保留 256 个不同句子。正常章节不会接近该上限；超长语料更适合分章审计。
- 轻量规则旨在提示作者，不替代人工判断。任务书许可、前文来源和明确代价仍会决定 finding 的最终风险等级。

## 验证

```powershell
npm.cmd run test:single -- novelty-chinese
npm.cmd run perf:novelty
```

真实 Electron 基准还会通过 preload diagnostics IPC 调用 Novelty Audit，并确认：正常中文样例为 `pass`、机械降神样例为 `fail`、质量门禁生成 `deus_ex_rule_patch`。

---

## English

Novelty Audit is a lightweight, deterministic, local guardrail. It does not call an external model and is not a general-purpose Chinese semantic parser.

The matcher now normalizes text with NFKC while preserving UTF-16 offsets, scans all novelty dictionaries once with a trie, applies ASCII word boundaries and `Intl.Segmenter` Chinese boundaries, keeps the longest overlapping match, and deduplicates identical keyword/sentence incidents before semantic analysis. Negated statements, explicitly rejected quotations, proper names, and ordinary physical ranges are filtered before findings are created.

Quality Gate, memory candidates, Inspector, and Run Trace reuse the same `NoveltyAuditResult`; they do not rescan the draft with raw substring checks. Evidence excerpts and offsets always point to the original text.

Known limits: segmentation remains heuristic, cross-sentence negation and irony are difficult, the default dictionary is Simplified Chinese, and Traditional Chinese requires explicit tested aliases. A keyword keeps at most 256 distinct sentence incidents to bound pathological input.

Run:

```powershell
npm.cmd run test:single -- novelty-chinese
npm.cmd run perf:novelty
```

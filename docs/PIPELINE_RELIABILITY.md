# 流水线诊断可靠性 / Pipeline Diagnostic Reliability

## 中文说明

### 0.1.6-preview.1 本地试用补充

本批把候选报告来源评估接入共享命令和旧候选 UI。预览按补丁的目标章节/章序校验正文，而不是一律使用生成 job 的章序；物品与资源变化的预览和真正入账使用同一套计算。旧报告仅作历史参考，缺失来源不会被解释为已通过。

直接文本重写增加单次取消，并用 run/call 标识及章节/修订对象身份隔离迟到响应。真实 Electron 和包内验证使用隔离 SQLite、本机 HTTP stub；没有操作真实小说或调用收费模型。修订正文编辑、一次接受、重载与“修订前正文”恢复均已完成桌面验证。完整结果和仍待实施的范围见 [首批试用验收](./OPTIMIZATION_M1_TRIAL.md)。

### 0.1.5 历史基线

`0.1.5` 将这组修复作为 Windows 补丁版本发布。旧的 `0.1.4` 安装包不包含 DeepSeek V4 空正文快速失败、正文指纹绑定和最新报告选择修复。

从本版本开始，一致性审稿、Novelty Audit、冗余报告和质量门禁都会绑定到生成草稿 ID 与稳定正文指纹。修订正文后：

- 旧报告仍作为历史记录保留，但不会再显示为当前结论，也不能参与草稿采纳。
- 流水线会从“章节复盘”恢复执行，重新生成与当前正文匹配的诊断和质量报告。
- 旧项目中的历史报告没有正文指纹，因此升级后会被视为历史结果；作者需要重跑诊断后再采纳修订正文。
- Run Trace 的旧报告引用和派生作者摘要会失效，避免删除段落继续出现在审计证据中。

每次 Pipeline Run 会冻结当次使用的服务商、Base URL、模型、采样参数、重试次数和硬超时。后续一致性审稿与质量门禁继承同一配置，不会因为设置页后来切换模型而发生分叉。

对于官方 `api.deepseek.com` 的 `deepseek-v4-flash` / `deepseek-v4-pro`，工作台会显式使用非思考模式。章节生产需要可解析的最终内容；默认思考模式可能先消耗大量输出 token，却只返回 `reasoning_content`。已经明确只有推理、没有正文的响应不会再次进行无格式重试，以免耗尽整次调用预算。

“设置 > AI 设置”中的“单次 AI 调用超时”覆盖连接和响应正文读取，范围为 5-900 秒，默认 300 秒。生产流水线运行时会显示当前步骤耗时，并允许取消正在进行的 AI 请求；取消或超时后可从最后成功步骤重试。

中文新角色检测采用以下置信度：

- 明确命名或自我介绍：高置信度。
- 已知角色名：不会重复标记。
- 仅根据“某人伸手/说道”等动作归属推测：低置信度，最多提示，不阻断采纳。
- “她没有”“然后她”“我伸手”等普通片段不会作为姓名。

回归命令：

```powershell
node scripts/validate-pipeline-diagnostic-reliability.mjs
node scripts/validate-novelty-chinese-matching.mjs
npm.cmd test
```

验证脚本只使用 `tmp/` 下的隔离数据，不读取或写入用户项目数据库。

### Agent Runtime 同步保证

`agent.runChapterPipeline` 与桌面工作台复用同一套 14 步单章执行器，而不是只登记一个 Job。每个成功步骤都会立即保存，失败时会把当前步骤和 Job 一起标记为失败。`agent.retryChapterPipeline` 复用原 AgentRun/Job，从首个失败或未完成步骤继续，并恢复之前步骤的输出；已经完成的任务书与上下文不会重跑。正文、Novelty Audit、一致性报告、冗余报告与质量门禁使用同一份草稿正文；质量门禁继续继承 Job 创建时冻结的模型与超时配置。

`agent.getPipelineProgress` 只读持久化状态，返回当前步骤、耗时、完成比例、取消请求和恢复起点。`agent.cancelChapterPipeline` 不与流水线争抢完整数据保存：它写入 userData 下的短生命周期控制标记，由原执行器取消当前 AI 请求并保存 `AgentRun=cancelled`、`Job=paused` 和失败步骤。标记在状态落盘后删除，之后可用同一 Job 重试。

Agent 的章节摘要、运行诊断和采纳建议只读取与当前草稿 ID、正文指纹匹配的最新报告。旧项目中没有正文指纹的报告会保留为历史记录，但不会作为当前分数或采纳依据。

隔离回归命令：

```powershell
node scripts/validate-agent-pipeline-execution.mjs
node scripts/validate-agent-runtime-p3.mjs
node scripts/validate-agent-runtime-p5.mjs
```

## English Summary

The `0.1.6-preview.1` local trial adds provenance-aware candidate previews, shared state arithmetic, per-call direct-rewrite cancellation and restoration of pre-revision text retained in commits. Isolated production and packaged Electron journeys verify edit, accept, reload and restore using a loopback HTTP stub. See the linked trial record for artifacts and remaining scope; this is not a public GitHub release.

Version `0.1.5` ships this reliability work as a Windows patch release. The previous `0.1.4` installer does not contain the DeepSeek V4 empty-prose handling, content-fingerprint binding, or latest-report selection fixes.

Consistency reviews, Novelty Audit, redundancy reports, and quality-gate reports are now bound to a draft ID and a stable content fingerprint. Editing a draft keeps old reports as history but prevents them from being displayed or accepted as current. Legacy reports without fingerprints are treated as historical and require a diagnostic rerun.

Each pipeline run snapshots its provider, model, generation settings, retry policy, and hard timeout. The timeout covers both connection setup and response-body streaming. Diagnostics inherit the same run configuration. Running requests can be cancelled, and failed runs can resume from the last successful step.

For the official `api.deepseek.com` endpoint, Novel Director explicitly uses non-thinking mode with `deepseek-v4-flash` and `deepseek-v4-pro`. Chapter production needs parseable final content; a reasoning-only response is not retried without `response_format`, because doing so can spend the remaining request budget on another chain of thought without producing prose.

Chinese name detection gives high confidence only to explicit introductions. Action-attribution guesses are low-confidence warnings and cannot block acceptance.

The headless Agent runtime reuses the same 14-step single-chapter engine as the desktop workflow and stops before acceptance. Each successful step is persisted. Progress reads are read-only, while cancellation uses a short-lived control marker rather than a competing AppData write. The executor aborts the active request, persists a cancelled/recoverable state, and removes the marker. A failed or cancelled job can be resumed with `agent.retryChapterPipeline` without rerunning completed planning/context steps; a completed job rejects duplicate retries. Agent summaries and acceptance recommendations ignore diagnostics whose draft ID or content fingerprint no longer matches the current draft.

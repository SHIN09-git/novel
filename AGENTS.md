# Novel Director Agent Guide

## 适用范围与优先级

本文件约束本仓库内的小说生产、审稿、修订、版本检查和候选确认。作者在当前任务中的明确要求优先于本文件和任何 skill；skill 只提供工作方法，不能扩大授权、改写作者意图或绕过项目事务。

涉及小说工作台数据时，优先使用已注册的 `novel-director` MCP 工具，不用 Computer Use 操作桌面 UI，也不直接修改 SQLite 或 JSON。首次配置在仓库根目录运行：

```powershell
npm.cmd run agent:setup:codex
```

## 标准流程

1. 用 `agent.listProjects` 定位项目，再用 `agent.getProjectDigest` 和 `agent.getNextChapterTarget` 读取当前权威状态。
2. 按章完成生成、审阅、决定和提交。提交后重新读取最新状态，再推进下一章；不能把旧 Prompt、旧草稿或本地镜像当作当前正史。
3. 用 `agent.getChapterProductionState`、`agent.getRunDiagnostics` 和 `agent.getAcceptanceRecommendation` 形成审稿判断。日常读取保持 compact；只有正文、Prompt、完整诊断或逐句证据确有需要时才传 `detail: "full"`。
4. 正式采纳、修订写回和高风险候选处理必须经过 action preview、revision 校验和事务化 commit。预览变化后再提交，不能把自填 `confirm`、口头推断或旧授权当成权限。
5. 用 `agent.getProjectAuthorization` 核对作者在桌面授予的项目权限。角色硬状态、伏笔、HardCanon、世界规则和记忆更新只有在授权范围内才能决定并提交；未获授权时保留人工确认。

任务、世界资料编辑和授权撤回见 [项目授权指南](./docs/AGENT_PROJECT_AUTHORIZATION.md)。只读工具必须只读打开现有数据，不初始化 schema、不切换 WAL、不写入用户数据。

## `lieflat-less-ai-tone` 的使用边界

作者明确要求“去 AI 味”“减少机器感”，或在成稿阶段选择工作台的 `reduce_ai_tone` 修订类型时，使用 `lieflat-less-ai-tone`。它只负责成稿后的语言清理，不代替章节规划、正文生成、剧情修订、一致性审稿或事实核查；默认不在初稿生成阶段调用。

使用顺序：

1. 先读取项目写作风格、语言特征和作者样稿。作者真实的标点、句长和修辞习惯优先于通用规则。
2. 锁定原文结构与事实，只按 skill 明列的 11 类白名单问题定位证据并做最小改动。未命中的句子逐字保留。
3. 不新增或删减人物、数字、时间、动作、感官细节、心理、潜台词、因果、设定、伏笔和判断强度；不改变标题层级、段落数量与顺序、列表、引用和对话位置。
4. 不能把句长、段长、问句、被动句、名词化、正文“首先/其次”、句内排比或普通比喻单独判成 AI 味。小说中的对话、口语和有意文学修辞要从严保护。
5. 去 AI 味与剧情、节奏、对白或衔接修订必须分开执行和验收，避免借“去 AI 味”重写剧情。提交前查看 diff，并确认每处改动都能对应 skill 的具体规则编号。

小说工作台已经把这套边界接入质量审查和 `reduce_ai_tone` 修订入口：审查只提供有原句证据的非阻断建议；实际修订仍需生成候选、人工或授权 Agent 审阅，再按事务流程写回。

## English summary

Use the registered `novel-director` tools for authoritative project reads and transactional writes. Explicit user instructions take precedence over repository guidance and skills. Apply `lieflat-less-ai-tone` only to finished-prose cleanup through its evidence-backed whitelist; preserve unmatched text, story facts, structure, character state, and foreshadowing. Review diffs and use preview/revision/commit flows for every formal writeback.

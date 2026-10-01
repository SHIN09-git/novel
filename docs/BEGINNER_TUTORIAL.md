# 新手教程 / Beginner Tutorial

## 简体中文

这份教程是 `QUICKSTART.md` 的练习与模板补充。`QUICKSTART.md` 已包含 OpenAI、DeepSeek、通义千问、OpenRouter、Ollama 的配置方法、设定去向判断、完整章节生成演练和修订实战；这里进一步解释“为什么要这样写资料、怎么判断该不该接受、怎么避免越写越乱”。第一次使用时请先完成 Quickstart 的 API 烟测和最小项目闭环。

所有示例都是 synthetic demo data。不要在公开 issue、截图、讨论或导出样例中包含真实 API Key、私有稿件或本地数据文件。

## 1. Novel Director 的核心工作流

Novel Director 的设计不是“让 AI 一次写完整本书”，而是把长篇小说拆成可审查的闭环：

1. 作者维护长期资料：小说圣经、角色卡、伏笔、时间线、硬设定。
2. 系统根据本章任务生成 Context Need Plan，判断本章需要查哪些资料。
3. ContextBudgetManager 在 token 预算内选择上下文。
4. 生产流水线生成章节计划，再根据章节计划做二次上下文补全。
5. AI 生成正文草稿。
6. 系统做章节复盘、一致性审稿、质量门禁、Novelty Audit、冗余检测。
7. 作者决定接受、修订、拒绝或把候选记忆写入长期资料。

你始终是最终导演。AI 输出、记忆候选和状态变化候选都只是候选。

## 2. API 配置细节

打开“设置 -> AI API 设置”。

最常见的错误是把 Base URL 填错。Base URL 只填服务根路径，例如：

- OpenAI 官方：`https://api.openai.com/v1`
- 本地兼容网关：`http://127.0.0.1:11434/v1`
- 第三方兼容服务：按服务商文档填写 `/v1` 地址

不要填：

```text
https://api.openai.com/v1/chat/completions
```

Model Name 必须和 provider 文档或后台显示一致。`gpt-4.1`、`gpt-4.1-mini`、第三方模型名、本地模型名都要完全匹配。

Temperature 建议：

| 用途 | 建议 |
| --- | --- |
| 正文生成 | 0.7-0.9 |
| 章节计划 | 0.5-0.8 |
| 审稿 / 结构化提取 | 0.2-0.5 |
| 去 AI 味重写 | 0.5-0.8 |

Max Tokens 建议：

- 短章测试：2000-4000。
- 普通长篇章节：8000 起步。
- 复杂章节：根据 provider 上限提高，但要注意成本。

如果生成像模板，先检查 Run Trace。常见原因不是“模型不会写”，而是 API 调用失败后用了 fallback，或 prompt 太长导致模型无法稳定遵守结构。

## 3. 资料最小集

第一次建项目时，不要追求资料完整。先写能防止硬伤的最小集。

### 必写

- 题材边界：这是悬疑、规则怪谈、奇幻、都市还是别的类型。
- 世界硬规则：哪些事绝不能被 AI 改写。
- 主角行动逻辑：高压下如何做选择。
- 当前关键状态：位置、伤势、物品、资源、秘密、能力限制。
- 本章任务：这一章必须完成什么，不能提前解释什么。

### 建议写

- 2-4 个核心角色的 9 项角色卡。
- 3-8 条真正会影响近期章节的伏笔。
- 关键时间线事件。
- 未来 5/10 章的剧情导向。

### 先别写

- 全世界百科。
- 所有支线角色履历。
- 远期结局细节。
- 大段文风口号。
- “待补充”“随便发挥”“以后再说”。

空字段留空即可。系统会跳过空字段；占位符反而会污染 prompt。

## 4. 硬设定包怎么写

HardCanonPack 是不可违背设定包，不是第二个小说圣经。

适合放：

- 世界规则底线。
- 系统机制边界。
- 角色身份不可逆事实。
- 已死亡 / 已失去 / 已发生的不可逆变化。
- 禁止机械降神的新规则。
- 关键时间锚点。

不适合放：

- 氛围描写。
- 普通剧情回顾。
- 尚未确认的新设定。
- 角色感想。
- 每章都可能变化的临时状态。

好例子：

```text
标题：副本规则不能无代价救命
分类：system_rule
优先级：must
内容：任何新副本规则如果用于解除当前危机，必须已有铺垫、任务书许可或带来明确代价。
```

坏例子：

```text
这个世界很压抑，人物要很有宿命感，城市有很多秘密，后面会有惊天反转。
```

这类内容可以放风格或剧情导向，不要放硬设定。

## 5. 角色状态账本怎么判断

状态账本只记录后续生成会用到的事实。

把下面这些写成状态事实：

- 右手结晶化。
- 现金剩余 5000。
- 持有黑色钥匙。
- 不知道广播源头身份。
- 承诺带韩笑颜离开车站。
- 能力每次使用后会灼痛 30 秒。

不要把下面这些写成状态事实：

- 他很难过。
- 她今天有点不安。
- 这一段写得很压抑。
- 可能以后会背叛。

如果只是自然语言记录，先写到“状态日志 / 历史记录”。需要影响生成时，再点击“转为状态事实”或“转为候选”。

## 6. 伏笔账本怎么判断

伏笔不是“灵感池”，而是可被章节计划调用的线索。

每条伏笔都要有当前处理方式：

- `hidden`：本章默认不提。
- `pause`：冻结，不推进。
- `hint`：轻微暗示。
- `advance`：推进线索但不揭底。
- `mislead`：制造误导但不改写真相。
- `payoff`：允许回收。

一个章节最多推进 10 条相关伏笔，并按权重排序。真正重要的伏笔应该提高权重；不重要的伏笔不要强塞进本章。

如果 AI 提前解释 hidden / pause 伏笔，优先走修订工作台删掉解释，而不是把错误解释写入长期记忆。

## 7. 生产流水线怎么看

流水线不是黑盒。每一步都有输出：

- 上下文需求规划：系统认为本章需要哪些资料。
- 上下文预算选择：哪些资料进入 prompt，哪些被省略。
- 构建 prompt：真正发给模型的上下文。
- 章节计划：正文前的结构化计划。
- 计划后补全：章节计划提出新需求后，补选上下文。
- 草稿生成：正文候选。
- 章节复盘：候选记忆和状态变化。
- 一致性审稿：角色、伏笔、时间线风险。
- 质量门禁：是否达到接受阈值。
- Run Trace 作者摘要：用作者能理解的话说明问题来源。

如果一章写歪了，优先看 Run Trace 作者摘要，不要只看模型输出。它通常能告诉你问题来自：

- 本章任务太空。
- 角色状态没进 prompt。
- 伏笔被预算省略。
- Novelty 发现了新规则风险。
- StageSummary 噪声太多。
- 模型输出本身跑偏。

## 8. 接受草稿的标准

可以接受：

- 章节接住上一章结尾。
- 主要任务完成。
- 没有重大硬伤。
- 质量门禁没有高风险失败项。
- Novelty Audit 没有未授权重大新规则。
- 记忆候选你已经看过并确认。

不要接受：

- 通过临时系统规则脱困。
- 新管理员、新组织层级突然出现并解决问题。
- 角色突然知道不该知道的秘密。
- 状态账本里的伤势、物品、资源被无解释重置。
- hidden / pause 伏笔被说破。
- 正文像大纲或解释稿，不像小说。

低于 80 分的质量报告建议人工二次确认。通过线较低只是为了避免阻塞试写，不代表应该自动接受。

## 9. 修订工作台怎么用

修订有两类：

1. 全章修订：方向正确但整体节奏、语言或结构需要改。
2. 局部修订：只改一段，保留其余正文。

局部修订优先。因为它更不容易破坏上下文、伏笔和状态账本。

自定义修订请求模板：

```text
只修订选中段落。
保留剧情事实、角色已知信息、伏笔 treatmentMode 和状态账本。
目标：减少 AI 味，压缩解释，增加动作和停顿。
禁止：不得新增规则，不得解释广播源头，不得改变右手结晶化状态。
```

接受修订后，系统会创建新的 RevisionCommitBundle 和 ChapterVersion。旧版本不会丢，你可以在版本历史中查看、对比、恢复。

## 10. 右键重写怎么用

右键重写适合短文本：

- 一句对白。
- 一小段描写。
- 去 AI 味。
- 压缩重复表达。
- 按自定义需求改语气。

返回后先看“重写候选”，可以编辑、与原文对比、继续改写、复制或放弃。点“应用到选区”才修改原文；如果模型返回整章，必须明确选择“作为整章采用”并确认，不能当作局部片段插入。

原文变化后，候选会保留并要求重新定位；重复片段由你重新选择。看到“候选已暂存”后，切换页面或重新打开程序仍能恢复；也可点击“暂存候选”立即保存。若提示保存失败，请先重试或复制。等待 AI 时可查看实际模型和耗时，或取消当前请求。

阅读页应用会创建正式修订版本；章节页先更新编辑区，再按原保存方式落盘。大范围剧情重构建议使用修订工作台；回收伏笔、修改角色状态或新增硬规则仍需单独检查账本，不会因应用正文自动入账。

## 11. 记忆候选怎么用

章节复盘会产生记忆候选，但不会自动污染长期资料。

你应该接受：

- 正文明确认定的角色状态。
- 明确发生的时间线事件。
- 已经回收或推进的伏笔状态。
- 确实需要后续引用的设定。

你应该拒绝或暂缓：

- 模型自己发明的新规则。
- Novelty Audit 标记 fail 的设定。
- 证据片段不充分的推断。
- 只是一时氛围，不是长期事实的内容。

## 12. 备份和迁移

默认数据存在本地 SQLite。设置页仍然提供 JSON 导入导出。

导入时有两种模式：

- **合并导入 JSON**：保留当前项目，把文件中的项目合并进工作台。工作台已有项目时默认使用此模式；无法自动解决的冲突会停止写入并显示原因。
- **覆盖导入 JSON**：用文件中的数据替换当前工作台数据。此操作需要二次确认，系统会先创建恢复备份。

空工作台可以直接导入旧 JSON；非空工作台应优先使用合并导入。JSON 中的 API Key 不会被导入或写入本地凭据存储，换机器后需要在设置页重新配置模型服务。

建议：

- 每次重要生成前导出 JSON。
- 换机器前导出 JSON。
- 开 issue 前只使用 synthetic demo data。
- 不公开真实项目 JSON。
- 不在截图、issue 或文档里贴 API Key。

## 13. 前三章练习路线

如果你是第一次使用，建议不要一上来导入整本书，也不要立刻生成 5000 字大章。先用前三章练习一次完整闭环。

### 第 1 章：建立基线

目标不是写得完美，而是让系统知道“这个故事是什么”。

操作：

1. 在小说圣经里写一句主线、题材边界和叙事基调。
2. 在 HardCanon 里写 1-3 条底线，例如“不得无铺垫新增救命规则”“已死亡角色不得无解释复活”。
3. 建立主角角色卡，只填 9 项里最关键的 4-5 项。
4. 给主角添加当前位置、一个能力限制或身体状态。
5. 写第 1 章任务：开场场景、主角目标、第一处规则压力、结尾钩子。
6. 用生产流水线生成短章，预计字数先控制在 `800-1200`。

检查：

- 草稿是否像小说，而不是设定说明。
- 主角是否有具体行动。
- 是否临时发明了规则来解决问题。
- Run Trace 是否显示 HardCanon 和关键角色状态进入了 prompt。

第 1 章完成后，只接受真正发生的状态候选。不要把模型顺手编出来的新规则直接写入 HardCanon。

### 第 2 章：验证连续性

目标是检查系统能否接住上一章结尾。

操作：

1. 在第 1 章结尾确认 Bridge：地点、未完成动作、身体状态、情绪压力、禁止重置点。
2. 添加 2-3 条伏笔，优先设为 `hint` 或 `pause`。
3. 如果第 1 章产生了物品、伤势、秘密或承诺，把它们转入动态状态账本。
4. 写第 2 章任务：必须接住上一章结尾，不得重置地点和伤势。
5. 生成第 2 章。

检查：

- 是否从第 1 章结尾自然接上。
- 是否忽略了状态账本里的伤势、物品或秘密。
- 是否提前解释了 `hidden` / `pause` 伏笔。
- 质量门禁问题是否适合局部修订，而不是整章重跑。

如果第 2 章频繁断线，优先补 Bridge 和状态账本，不要先补大段世界观。

### 第 3 章：验证伏笔与审稿

目标是让伏笔账本和 Novelty Audit 真正发挥作用。

操作：

1. 选择最多 3-5 条本章相关伏笔，不要试图推进全部伏笔。
2. 把其中最重要的一条设为 `advance`，其余保持 `hint` / `pause`。
3. 写清本章禁止回收的伏笔。
4. 生成第 3 章后，重点看 Novelty Audit 和一致性审稿。
5. 如果模型新增了管理员、系统权限、核心机制或救命规则，优先修订正文，而不是接受为新设定。

检查：

- 伏笔推进是否克制。
- 新信息是否有任务书许可、前文铺垫或明确代价。
- 记忆候选是否带有证据片段。
- 是否需要把某条反复出现的世界底线提升为 HardCanon。

前三章跑通后，再考虑增加更多角色、时间线、阶段摘要和剧情导向。

## 14. 资料补充决策表

每次生成歪了，不要第一反应就是“多塞设定”。先判断问题来源。

| 现象 | 优先补哪里 | 不建议先做什么 |
| --- | --- | --- |
| 章节开头接不上上一章 | Bridge / 本章任务 | 大量补世界观 |
| 角色突然恢复伤势 | 动态状态账本 physical / ability | 把伤势写进长篇角色传记 |
| 角色凭空拿出物品 | 动态状态账本 inventory | 在正文里追加解释性旁白 |
| 角色知道不该知道的秘密 | 动态状态账本 knowledge / secret | 接受错误记忆候选 |
| 伏笔提前揭底 | 伏笔 treatmentMode / 本章禁止回收 | 把错误揭底写入阶段摘要 |
| 新规则救场 | HardCanon / NoveltyPolicy / 修订正文 | 把新规则洗进长期设定 |
| 章节方向空泛 | 本章任务 / 剧情导向 | 增加更多旧章节回顾 |
| 文风像说明书 | 修订提示词 / 风格要求 | 改动硬设定 |
| Prompt 太长 | 压缩阶段摘要、减少低相关伏笔 | 删掉角色硬状态和 HardCanon |

一个实用顺序：

1. 先看 Run Trace 作者摘要。
2. 如果是上下文缺失，补状态、伏笔、时间线或 HardCanon。
3. 如果是任务不清，重写本章任务。
4. 如果是模型写歪但上下文足够，走修订工作台。
5. 如果是草稿方向完全错，拒绝草稿，改任务后重跑。

## 15. 修订提示词模板库

下面这些提示词适合直接粘到修订工作台的自定义需求里。

去 AI 味：

```text
保留剧情事实和对白信息。减少解释性总结、口号式心理描写和模板化转折。
增加具体动作、停顿、感官细节和对白潜台词。
不得新增规则、设定、人物或伏笔解释。
```

加强冲突：

```text
保留当前场景和既有事实。强化阻力、代价和角色选择。
让角色必须在两个不完美选项之间行动，而不是只描述紧张气氛。
不得改变角色状态账本中的伤势、物品、位置和已知信息。
```

修复衔接：

```text
从上一章结尾的地点、动作、身体状态和情绪压力接起。
不得跳过未完成动作，不得无解释重置伤势、位置或关系张力。
只修复衔接和必要过渡，不重写本章核心事件。
```

压缩重复：

```text
删减重复环境描写、重复心理总结和重复规则解释。
保留新信息、关键动作、关键对白和结尾钩子。
压缩后仍要保持小说连贯，不要改成大纲。
```

删除机械降神规则：

```text
删除选中段落里的临时新增救命规则、系统补充条款、无代价权限或新管理员干预。
改为使用已经出现的规则、角色已有能力、状态账本资源或已铺垫伏笔解决压力。
如果无法解决，允许让危机升级，但不得新增便利机制。
```

---

## English

This beginner tutorial complements `QUICKSTART.md`. It explains how to decide what data belongs in Novel Director, how to review AI drafts, and how to revise safely.

Novel Director is built around a reviewable loop:

1. Maintain long-term project data.
2. Let Context Need Planner decide what the target chapter needs.
3. Let ContextBudgetManager select context under a token budget.
4. Generate a chapter plan, then fill context gaps from that plan.
5. Generate a draft.
6. Review consistency, quality, novelty, redundancy, memory candidates, and state changes.
7. The author accepts, revises, rejects, or stores selected candidates.

AI output is always a candidate until the author accepts it.

### Provider Setup

In Settings, configure an OpenAI-compatible provider:

- Base URL should usually end at `/v1`, not `/chat/completions`.
- Model name must exactly match your provider.
- Use 0.7-0.9 temperature for prose and lower values for review/extraction.
- Keep API keys only in Settings.

### Minimum Project Data

Start with:

- Story premise and genre boundary.
- HardCanon rules that must not be violated.
- A few core characters.
- Character state facts for location, injuries, inventory, resources, secrets, promises, and ability limits.
- A small set of high-value foreshadowings.
- A clear chapter task.

Avoid encyclopedic lore dumps, unused biographies, far-future reveals, and `TBD` placeholders.

### Draft Review

Before accepting a draft, check:

- Does it continue the previous chapter?
- Did it complete the chapter task?
- Did Quality Gate and Consistency Review find high-risk issues?
- Did Novelty Audit flag unauthorized new rules, characters, organizations, or mechanisms?
- Does Run Trace Author Summary say the problem came from missing context, weak task instructions, state ledger gaps, or model output?

### Revision

Use the Revision Workbench for official edits. Prefer local passage revisions when possible. Accepting a revision creates a versioned commit; it does not silently overwrite history.

Right-click rewrite is for short text polishing only. Do not use it to change canon, recover foreshadowings, alter state facts, or rewrite full chapters.

### Backup

SQLite is the default local data store. Use JSON export/import for backup and migration. Never publish real project JSON or API keys.

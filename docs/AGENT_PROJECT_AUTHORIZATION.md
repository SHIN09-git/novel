# Agent 项目授权与章节自主流程

本文说明作者如何给 Codex 授权，以及 Agent 如何开书、编辑资料、逐章创作和提交修订。

> 本文描述当前仓库中的接口。WorldTools 仍在完善，调用前应以 MCP 标准 `tools/list` 返回的当前 descriptor 为准。`AgentToolService.listTools()` 是内部方法，不是名为 `agent.listTools` 的注册工具。文中的 ID、路径和作品内容都是模板或虚构示例，不代表真实项目，也不应直接当作作品设定使用。

已注册 MCP 客户端会通过协议自动调用 `tools/list`。也可以在仓库根目录用以下 PowerShell 命令直接查看实际工具 descriptor：

```powershell
'{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | npm.cmd run agent:tools
```

## 一、作者如何授予和撤回

项目授权由作者在 Agent 页的“项目授权”面板中授予或撤回。Codex 和普通工具调用不能自行给自己授权。

### 全库管理权

在项目列表点 **授予全库管理权**。一次授权覆盖当前书库中已有和以后新建的作品。Agent 可直接开书、修改书名和简介、编辑小说圣经与其他创作资料、归档和恢复项目，无需逐本授权。权限不包含永久删除、其他数据库文件、其他本地配置或应用设置。

归档保留正文、草稿、版本和审稿记录，默认不在项目列表的在写作品中显示。Agent 可继续读取归档作品；继续写作或修订前需先恢复。作者可从「已归档项目」恢复，也可请 Agent 按「书库改动记录」的操作编号回退。项目资料的回退只恢复当时改动的字段；同一字段有后续改动时不会覆盖。

最终审核时，在项目列表点「读取最新书库」，从「书库改动记录」核对项目变动。进入作品后，使用「资料改动记录」和「版本历史」查看设定变动、正文、审稿证据和版本。批量创作和修订仍是每章审稿、通过质量门禁、提交后再继续。撤回全库管理权不撤回作者另行授予的单书权限，也不会撤销已提交的结果。

### 全书创作权

- **已有作品**：打开作品，在 Agent 页的“项目授权”点击“授予全书创作权”。
- **新作品**：在项目列表点击“授权 Agent 开书”。Agent 用 `agent.listBookCreationSlots` 取得预留项目编号，再调用 `agent.createProject` 开书。该授权只开一本书，开完继续覆盖同一本书，不用再授权一次。

Agent 可以修改本书任务、角色、伏笔、时间线、HardCanon、剧情导向、小说圣经和阶段摘要，按既有流程处理候选，以及逐章提交正文和修订。作者不需要逐步确认；最终可在桌面版本历史核对正文和审稿证据，在 Agent 页的“资料改动记录”核对小说圣经和阶段摘要的修改前后及理由。权限不延伸到其他书或应用设置，也不允许跳过逐章门禁。

要撤回，打开该书的“项目授权”；尚未开书时可从项目列表撤回。已提交的改动和历史保留。

一次授权由以下范围共同确定：

- 当前项目 `projectId`；
- 当前项目实际使用的数据库文件 `storagePath`；
- 一个或多个动作 `actions`；
- 全部章节，或一个包含起止章节的范围。

项目 ID 相同但数据库文件不同，不视为同一授权。数据库文件相同但项目 ID 不同，也不视为同一授权。章节范围授权只覆盖该范围；不带章节号的全局写入只能使用“全部章节”的授权。

Agent 页目前可授予的动作如下：

| 动作 | 含义 | 典型范围 |
| --- | --- | --- |
| `edit_chapter_task` | 编辑章节任务并创建新的章节 job | 指定章节或章节范围 |
| `accept_draft` | 正式采纳章节草稿 | 指定章节或章节范围 |
| `accept_unreviewed_draft` | 允许采纳尚未完成审稿的草稿 | 与 `accept_draft` 一起授予 |
| `accept_high_risk_candidates` | 接受高风险候选更新 | 按实际候选工具要求 |
| `apply_revision` | 应用修订 | 指定章节或章节范围 |
| `manage_chapters` | 管理章节 | 指定章节或章节范围 |
| `edit_world` | 编辑世界资料和长期设定 | 全部章节，即项目全局授权 |

作者可以只勾选当前需要的动作，不需要一次开放全部能力。授权后，明确支持该授权机制的 apply 工具可以在范围内连续执行，不要求每次重复确认。撤回会阻止后续的新写入，但不会删除或回滚已经提交的数据。

没有启用过全库管理权或全书创作权时，如需开放未经完整审稿的旧采纳流程，请在同一条授权中同时包含 `accept_draft` 和 `accept_unreviewed_draft`。授权匹配要求一条有效授权覆盖请求所需的全部动作，不能把两个动作拆在两条授权中再合并使用。

## 二、授权保存在哪里

授权记录由 `AgentAuthorizationService` 保存在当前应用 `userData` profile 下的独立 `agent-authorizations.json` 中，不写进小说数据库，也不随 AppData 项目备份导出或导入。

这带来几个重要结果：

1. 导入备份、复制数据库或把数据源迁到新路径后，需要作者针对新的项目和数据库组合重新授权。
2. 桌面 Agent 页会从受信任的主进程取得当前数据库路径和 `userData`，作者无需手工填写。
3. CLI、MCP 或测试若显式传入 `storagePath`、`userDataPath`，必须指向同一个数据库和正确的 `userData` profile。profile 不一致时，应当得到“未授权”，不能改去读取另一个 profile 的授权文件。
4. 这是应用层的作者同意、范围控制和审计机制，不是操作系统沙箱。拥有宿主机相应文件权限的本机用户仍能访问或修改本机文件。

正式 apply 在短事务内重新检查授权并保存结果。AI 生成、网络请求、长时间审阅等工作不应包在授权锁里。

Agent 页右上角的“读取最新结果”用于手动接收 Codex 或其他窗口已写入磁盘的新结果。桌面不会自动用外部结果覆盖正在编辑的 dirty form，也不会在检测到 storage revision 冲突后把旧内存强写回磁盘。点击刷新会先要求确认；作者应先处理或保留未保存文本，再确认读取最新数据。

## 三、与普通确认机制的关系

项目授权没有替换所有既有确认流程，也没有引入角色、令牌或多级审批平台。

- 没有启用过全库管理权或全书创作权的项目，既有工具继续遵循原有的普通确认语义。启用后，Agent 的正式提交及其他纳入授权的旧写入入口不能用 `confirm` 或 `approvalToken` 代替当前授权；撤回后也不会退回旧的确认方式。
- 新的授权型 apply 工具不把调用方传入的 `confirm: true` 当作作者授权证明。
- 已获得项目授权的动作可以在其范围内自主执行；超出范围时应停下并请作者调整授权。
- read 和通常的 preview 不需要项目授权。正式写入是否需要授权，以该 apply 工具的当前定义为准。

因此，目标不是让所有操作反复弹窗，而是让作者先明确开放有限范围，然后让 Agent 在该范围内完成可审计的自主流程。

## 四、每章标准流程

一次连续创作可以覆盖 5 章、10 章或几十章；系统没有“每次最多 2 到 3 章”的硬限制。当前 `agent.continueAgentRun` 的 `chapterCount` 接口允许 1 到 1000，但每章仍应独立完成以下流程，不能用一次审阅或一次采纳替代整批章节的判断：

已有批次时先读 [章节工作单](./AGENT_TOOL_API.md#可恢复章节工作单)，不要重新登记。执行、重试和采纳时可传 `responseMode: "work_item"`，把工作单直接接到下一环节；旧工具仍可独立使用。

1. **生成当前章**：新章节可用 `agent.runChapterPipeline` 创建并执行；连续运行可先用 `agent.continueAgentRun` 登记目标章节。该调用只创建首章 job，不会自动创建后续 job 或自动续跑队列。使用返回的当前 `agentRunId` 和 `jobId` 调用 `agent.retryChapterPipeline`；首章正式提交后，再在同一 run 中通过任务编辑创建下一章 job。
2. **读取正文与审阅材料**：按工作单的 `draft.read` 读取完整正文，再看同版的审稿证据；有疑问时用 `agent.getDraftReviewReport` 展开报告，或另读完整 Trace。旧流程可分别读取生产状态、诊断和采纳建议。
3. **自主作出明确决定**：Codex 必须基于正文和报告明确选择采纳、修订、重试或暂停，并记录具体理由。报告是证据，不代替决定。
4. **preview 后 apply**：采纳或其他正式写入先生成绑定当前正文、报告和 revision 的 preview，再使用 preview 返回的 hash/revision apply。
5. **处理候选更新**：人物状态、伏笔、HardCanon、记忆等候选保持独立审核；采纳章节不会自动把候选写成 canon。
6. **进入下一章**：正式提交后重新读取当前项目状态和下一章目标，再开始下一章。

`agent.continueAgentRun` 只记录较长目标范围并准备首章，不是自动队列执行器。Agent 应按“生成 -> 阅读/审阅 -> 明确决定 -> preview/apply -> 下一章”的顺序推进；下一章 job 由 `agent.applyChapterTaskEdit` 在同一 run 中创建，再交给返回的 `agent.retryChapterPipeline` 执行。

### 跨章修订与回退

用 `agent.startBookRevisionBatch` 登记要改的正式章节 ID 和目标。系统按书中章序排列；重连用 `agent.getChapterWorkItem` 取得当前章。读原文后，生成修订稿或用 `agent.createManualRevisionVersion` 保存已有稿；再用 `agent.reviewRevisionVersion` 调用工作台审稿模型。核对报告后，用 `agent.previewRevisionCommit` 绑定这次通过门禁的报告，再调用 `agent.applyApprovedRevisionCommit`。未通过、本章稿件变动或审稿依据改变时，先处理本章，不能拿旧报告继续。

回退正文时，从版本链读取历史正文，把它保存为本章的新修订候选，走同一条审稿和提交链。系统新增版本，保留恢复前的正文、历史版本和此次审稿证据。

## 五、章节任务编辑

章节任务读取和 preview 不需要授权。正式 `agent.applyChapterTaskEdit` 需要作者授予当前项目、数据库和章节范围内的 `edit_chapter_task`。

任务编辑复用 UI 的 `ChapterTaskEditService` 语义：

- 普通任务修改是确定性数据操作，不调用 AI；
- apply 创建一个新的 idle job，并重建该 job 的上下文；
- 原 job、已有草稿和手工快照不会被覆盖；
- 若编辑以手工快照为来源，必须显式设置 `refreshContext: true`；
- preview 与 apply 使用 source 时间戳、快照信息、preview hash 和 storage revision 防止陈旧写入；
- 相同 `operationId` 的成功重试返回已有结果，不重复创建 job。

最重要的是：任务编辑 apply 返回 `nextExecution` 后，应调用其中指定的 `agent.retryChapterPipeline` 继续这个新 job。不要再调用 `agent.runChapterPipeline`，否则会额外创建另一个 job。

### 读取任务

```json
{
  "name": "agent.getChapterTask",
  "arguments": {
    "storagePath": "<PROJECT_DATABASE_PATH>",
    "userDataPath": "<USER_DATA_PROFILE_PATH>",
    "projectId": "demo-project",
    "chapterOrder": 8,
    "sourceJobId": "demo-job-007"
  }
}
```

返回值中的来源信息有两层，不要混用：

```json
{
  "source": {
    "kind": "job",
    "jobId": "demo-job-007",
    "jobUpdatedAt": "<SOURCE_JOB_TIMESTAMP>",
    "jobStatus": "idle",
    "promptSnapshotId": null,
    "promptSnapshotUpdatedAt": null,
    "contextSource": "auto",
    "manualSnapshotRequiresRefresh": false
  },
  "editReference": {
    "chapterOrder": 8,
    "sourceJobId": "demo-job-007",
    "sourceUpdatedAt": "<SOURCE_JOB_TIMESTAMP>",
    "sourceSnapshotId": null,
    "sourceSnapshotUpdatedAt": null
  }
}
```

`source` 是面向读取者的来源说明。后续 preview 使用的是 `editReference`：把其中适用的 `chapterOrder`、`sourceJobId`、`sourceUpdatedAt`、`sourceSnapshotId`、`sourceSnapshotUpdatedAt` 放到请求参数顶层。不要把整个 `source` 对象原样传给 preview；该对象不是 preview 参数。值为 `null` 的可选时间戳应省略，而不是作为字符串发送。

### 预览完整任务修改

`task` 是完整替换值，不是局部 patch：

```json
{
  "name": "agent.previewChapterTaskEdit",
  "arguments": {
    "storagePath": "<PROJECT_DATABASE_PATH>",
    "userDataPath": "<USER_DATA_PROFILE_PATH>",
    "projectId": "demo-project",
    "agentRunId": "demo-run-001",
    "operationId": "demo-task-edit-008-v1",
    "reason": "根据已读正文和诊断，明确调整第八章任务。",
    "chapterOrder": 8,
    "sourceJobId": "demo-job-007",
    "sourceUpdatedAt": "<FROM_GET_CHAPTER_TASK>",
    "sourceSnapshotId": null,
    "refreshContext": true,
    "task": {
      "goal": "<本章目标模板>",
      "conflict": "<本章冲突模板>",
      "suspenseToKeep": "<保留悬念模板>",
      "allowedPayoffs": "<允许兑现模板>",
      "forbiddenPayoffs": "<禁止提前兑现模板>",
      "endingHook": "<章末钩子模板>",
      "readerEmotion": "<目标读者情绪模板>",
      "targetWordCount": "3000",
      "styleRequirement": "<风格要求模板>"
    },
    "budgetMode": "standard",
    "budgetMaxTokens": 12000,
    "pipelineMode": "standard"
  }
}
```

### 应用并继续同一个新 job

调用 `agent.applyChapterTaskEdit` 时发送与 preview 相同的业务参数，并增加：

```json
{
  "expectedPreviewHash": "<FROM_PREVIEW>",
  "expectedRevision": "<FROM_PREVIEW_STORAGE_REVISION>"
}
```

apply 成功后，按返回值调用：

```json
{
  "name": "agent.retryChapterPipeline",
  "arguments": {
    "storagePath": "<PROJECT_DATABASE_PATH>",
    "userDataPath": "<USER_DATA_PROFILE_PATH>",
    "agentRunId": "<FROM_APPLY_NEXT_EXECUTION>",
    "jobId": "<FROM_APPLY_NEXT_EXECUTION>",
    "pipelineMode": "<FROM_APPLY_NEXT_EXECUTION>",
    "estimatedWordCount": "3000",
    "readerEmotionTarget": "<FROM_APPLY_NEXT_EXECUTION>",
    "budgetMaxTokens": 12000
  }
}
```

除路径字段外，优先直接使用 apply 返回的 `nextExecution.arguments`，避免抄错新 job ID。

## 六、章节采纳

`agent.previewChapterAcceptance` 把决定绑定到准确的 run、job、draft、正文、审稿报告和当前 revision。正式 `agent.applyChapterAcceptance` 使用 preview ID 和 hash 提交，并要求相应项目授权。

### 已完成审稿，但 Codex 不同意报告结论

只要审稿材料完整，就使用 `mode: "reviewed"`。**全库管理权和全书创作权**都要求当前稿通过门禁，且不能用占位审稿报告提交。未使用这两种授权的项目保留原有例外：拥有 `accept_draft` 权限时，可以说明为何不同意阻断结论。系统保留原报告的 `passed: false` 或 blocked 状态。

```json
{
  "name": "agent.previewChapterAcceptance",
  "arguments": {
    "storagePath": "<PROJECT_DATABASE_PATH>",
    "userDataPath": "<USER_DATA_PROFILE_PATH>",
    "projectId": "demo-project",
    "operationId": "demo-accept-008-v1",
    "agentRunId": "demo-run-001",
    "jobId": "demo-job-008",
    "draftId": "demo-draft-008",
    "mode": "reviewed",
    "reason": "已阅读全文和完整报告；明确不同意其中的阻断判断，理由为：<具体、可审计的判断依据>。"
  }
}
```

### 审稿尚未完成

全库管理权和全书创作权都不支持 `mode: "unreviewed"`。其他项目只有在审稿材料确实不完整、且同一条授权同时包含 `accept_draft` 和 `accept_unreviewed_draft` 时才可使用：

```json
{
  "name": "agent.previewChapterAcceptance",
  "arguments": {
    "storagePath": "<PROJECT_DATABASE_PATH>",
    "userDataPath": "<USER_DATA_PROFILE_PATH>",
    "projectId": "demo-project",
    "operationId": "demo-accept-unreviewed-008-v1",
    "agentRunId": "demo-run-001",
    "jobId": "demo-job-008",
    "draftId": "demo-draft-008",
    "mode": "unreviewed",
    "reason": "审稿尚未完成；仍决定采纳，具体依据与风险为：<明确说明>。"
  }
}
```

如果审稿已经完整，接口会拒绝把它伪装成 `unreviewed`。两种模式都不会自动采纳人物、伏笔、HardCanon 或记忆候选。

apply 示例：

```json
{
  "name": "agent.applyChapterAcceptance",
  "arguments": {
    "storagePath": "<PROJECT_DATABASE_PATH>",
    "userDataPath": "<USER_DATA_PROFILE_PATH>",
    "projectId": "demo-project",
    "previewId": "<FROM_PREVIEW>",
    "expectedPreviewHash": "<FROM_PREVIEW>"
  }
}
```

已经提交成功的 `operationId` 再次调用时只返回原提交结果，必要时补齐提交审计元数据。它不会重新执行世界变更，也不会把当前正文恢复成旧 draft。撤回授权同样不会让这种已提交重试“复活”旧正文。

## 七、世界资料工具

小说圣经和阶段摘要由 `agent.previewBookReferenceEdit` 预览，再用 `agent.applyBookReferenceEdit` 提交。用 `agent.getWorldActionHistory` 查每次改了什么。回退时以原操作编号重新预览和提交；如果同一条资料随后已被改过，系统会请 Agent 先核对当前内容，不会覆盖那次修改。详细参数见 [工具说明](./AGENT_TOOL_API.md#全书创作入口)。

当前 6 个世界资料工具是资料读取 `agent.getWorldRecords`、`agent.getWorldRecord`，操作记录读取 `agent.getWorldActionReceipt`、`agent.getWorldActionHistory`，以及 `agent.previewWorldAction`、`agent.applyWorldAction`。可用参数和每种实体的 `patch` 字段白名单以当前安装版本的 MCP `tools/list` 为准。世界实体包括 `character`、`character_state`、`foreshadowing`、`timeline_event`、`hard_canon`、`story_direction`；支持的写动作是 `create`、`update`、`set_status` 和 `archive`，不提供 delete。角色和时间线没有归档状态，不能对此二类调用 `set_status` 或 `archive`。

正式 world apply 需要 `edit_world` 的项目全局授权，也就是 Agent 页中选择“全部章节”。只授予某一章或某一段章节不能授权不带章节号的世界资料写入。

世界资料应先读、再 preview、后 apply。`source.kind` 使用当前定义要求的 `agent_director`，`source.reason` 记录明确决定。`source.agentRunId` 是可选的：独立编辑世界资料不需要先创建 chapter job 或调用 `agent.startAgentRun`；只有提供该字段时，工具才校验对应 AgentRun 属于同一项目。AI 生成或检测出的候选不能仅凭“模型认为正确”自动成为 canon。

```json
{
  "name": "agent.getWorldRecords",
  "arguments": {
    "storagePath": "<PROJECT_DATABASE_PATH>",
    "userDataPath": "<USER_DATA_PROFILE_PATH>",
    "projectId": "demo-project",
    "entity": "character",
    "detail": "compact",
    "limit": 20,
    "offset": 0,
    "includeArchived": false
  }
}
```

```json
{
  "name": "agent.previewWorldAction",
  "arguments": {
    "storagePath": "<PROJECT_DATABASE_PATH>",
    "userDataPath": "<USER_DATA_PROFILE_PATH>",
    "projectId": "demo-project",
    "entity": "character",
    "action": "create",
    "operationId": "demo-world-character-001",
    "patch": {
      "name": "<虚构示例角色名>",
      "role": "<角色定位模板>",
      "isMain": false
    },
    "source": {
      "kind": "agent_director",
      "reason": "导演明确决定：<基于已读材料的具体理由>。"
    }
  }
}
```

若该决定确实发生在某次 AgentRun 中，可以额外传入来自该项目的虚构模板字段 `"agentRunId": "demo-run-001"`。不要为了填写这个可选字段而新建章节 job。

`agent.applyWorldAction` 使用相同业务参数，并增加 preview 返回的指纹：

```json
{
  "expectedFingerprint": "<FROM_PREVIEW>"
}
```

相同 `operationId` 的成功重试返回原 receipt，不覆盖之后发生的新修改。HardCanon 若已有相同来源和内容，会提示已有条目 ID，要求显式修改该条目，不静默替换目标。

可以按以下模板读取单条 receipt 或分页 history；这两个调用是只读操作，不需要 `edit_world` 授权：

```json
{
  "name": "agent.getWorldActionReceipt",
  "arguments": {
    "storagePath": "<PROJECT_DATABASE_PATH>",
    "userDataPath": "<USER_DATA_PROFILE_PATH>",
    "projectId": "demo-project",
    "operationId": "demo-world-character-001"
  }
}
```

```json
{
  "name": "agent.getWorldActionHistory",
  "arguments": {
    "storagePath": "<PROJECT_DATABASE_PATH>",
    "userDataPath": "<USER_DATA_PROFILE_PATH>",
    "projectId": "demo-project",
    "detail": "compact",
    "limit": 20,
    "offset": 0
  }
}
```

## 八、可复现的现有检查命令

以下命令用于核对当前实现，不代表本文声称所有 W08 工作、打包或跨平台验证已经完成：

```powershell
npm.cmd run typecheck
node scripts/validate-agent-authorization.mjs
node scripts/validate-agent-authorization-ui.mjs
node scripts/validate-agent-project-grant-workflow.mjs
node scripts/validate-agent-chapter-task-tools.mjs --require-native
node scripts/validate-agent-director-journey.mjs
node scripts/validate-agent-director-journey.mjs --book-creative --sqlite
node scripts/validate-agent-director-journey.mjs --library-management --sqlite
node scripts/validate-agent-world-tools.mjs
node scripts/validate-agent-pipeline-execution.mjs
```

这些脚本应使用各自创建的隔离 JSON/SQLite 数据。`validate-agent-director-journey.mjs` 的五章正文和报告来自进程内本地 mock 响应器，用于验证真实工具 handler、标准 pipeline、授权与提交顺序；它不是付费模型真实创作或质量评测。不要把真实作品数据库、真实 `userData` profile、密钥或付费模型调用加入示例或验证流程。

---

# Agent Project Authorization and Autonomous Chapter Flow

This section is the English counterpart for authors and Codex. The Simplified Chinese section above is authoritative for the intended user-facing workflow.

> This document describes the implemented W08 interfaces. Check standard MCP `tools/list` for the installed version's schemas. `AgentToolService.listTools()` is an internal method, not a registered tool named `agent.listTools`. All IDs, paths, and story values below are fictional templates, not production data.

Registered MCP clients perform `tools/list` discovery through the protocol. From PowerShell at the repository root, the live descriptors can also be inspected with:

```powershell
'{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | npm.cmd run agent:tools
```

## 1. Granting and revoking access

The author grants or revokes access in the Agent page's Project Authorization panel. Codex and ordinary tool calls cannot grant access to themselves.

In the project list, **授予全库管理权** grants library management for every current and future book in that data file. The Agent can create books, edit project details and references, and archive or restore books. Archives keep manuscripts, drafts, versions, and reviews. Archived books remain readable; restore one before editing it. The grant excludes permanent deletion, other libraries and application settings. Use **书库改动记录** to audit project changes. A project revert restores only the affected fields and refuses to replace later changes to them.

For an existing book, choose **授予全书创作权** in Project Authorization. To authorize a new book, choose **授权 Agent 开书** in the project list and let the Agent create the reserved project. The same grant then covers that book, including Story Bible, stage summaries, and reviewed chapter revisions. It does not cover other projects or app settings. The author can review commits and the before/after reference edit history without confirming each operation.

A grant is matched against all of the following:

- the project ID;
- the canonical project database path;
- the requested action or actions;
- either a chapter range or an all-chapters scope.

The same project ID in another database is not covered. A chapter-bounded grant does not cover a global request with no chapter number. In particular, `edit_world` requires an all-chapters, project-wide grant.

Current actions are `edit_chapter_task`, `accept_draft`, `accept_unreviewed_draft`, `accept_high_risk_candidates`, `apply_revision`, `manage_chapters`, and `edit_world`. The author can grant only the actions needed. An unreviewed acceptance requires one active grant containing both `accept_draft` and `accept_unreviewed_draft`; separate grants are not combined.

Revocation blocks new writes but does not undo committed data. Grant and revoke operations come from trusted main-process UI handling, which derives the active database path instead of trusting a caller-supplied path.

## 2. Storage and host boundary

`AgentAuthorizationService` stores grants in a separate `agent-authorizations.json` under the active application `userData` profile. Grants are not stored in the novel database and do not travel with AppData backup export or import.

After importing a backup, copying a database, or moving to a different data-source path, the author must grant access again for the new project/database combination. Desktop UI derives `storagePath` and `userDataPath`; explicit CLI or MCP values must select the exact same database and profile. A mismatched profile should remain unauthorized.

This is an application-level consent and audit boundary, not an operating-system sandbox. A local user who has host file permissions can still access or modify local files. AI, network, and other long-running work must stay outside the short authorization-and-save transaction.

The “读取最新结果” button on the Agent page manually adopts results written to disk by Codex or another window. The desktop does not automatically overwrite a dirty form with external data, and a storage revision conflict prevents stale in-memory state from being forced back to disk. Reload asks for confirmation; preserve or resolve unsaved text before accepting the latest data.

## 3. Compatibility with ordinary confirmation

Existing tools that still expose `confirm` or `approvalToken` retain their legacy confirmation behavior for projects that have not opted into library management or full-book creator rights. Covered writes in an opted-in project require an active grant, even after revocation. Grant-aware applies run without separate author confirmation for each operation.

This is not a new role, token, or multi-stage permission platform. Read operations and ordinary previews do not require a project grant. The current apply definition determines whether a formal write consumes one.

## 4. Per-chapter autonomous workflow

There is no hard two- or three-chapter cap. An author may register targets for 5, 10, or dozens of chapters (`agent.continueAgentRun` currently accepts a `chapterCount` from 1 to 1000), while Codex still handles every chapter independently:

1. Generate the current chapter with `agent.runChapterPipeline`, or register a longer target range with `agent.continueAgentRun`. That call creates only the first job; it does not create or automatically execute later jobs. Execute the returned current job with `agent.retryChapterPipeline`. After formal acceptance, create the next job in the same run through the chapter-task edit flow.
2. Read the full draft with `agent.getDraftText` and `detail: "full"`, then read production state, diagnostics, trace, and acceptance recommendation.
3. Explicitly decide to accept, revise, retry, or pause. Reports are evidence; they do not make the decision.
4. Preview and apply the chosen formal write using the returned binding, hash, and revision values.
5. Review character, foreshadowing, HardCanon, and memory candidates separately. Chapter acceptance does not automatically promote candidates to canon.
6. Re-read project state and the next chapter target before advancing.

## 5. Chapter-task edits

`agent.getChapterTask` and `agent.previewChapterTaskEdit` do not require a grant. `agent.applyChapterTaskEdit` requires `edit_chapter_task` for the exact project, database, and chapter. The read result's descriptive `source` object is not a preview argument. Copy the applicable fields from its separate `editReference` object into the preview's top-level `chapterOrder`, `sourceJobId`, `sourceUpdatedAt`, `sourceSnapshotId`, and `sourceSnapshotUpdatedAt` arguments, omitting optional null timestamps.

A normal task edit is deterministic and does not call AI. Apply creates a new idle job and rebuilds its context while preserving the source job, drafts, and manual snapshots. Snapshot-based edits require `refreshContext: true`. Source timestamps, snapshot references, preview hash, and storage revision protect against stale writes. A successful retry with the same `operationId` returns the existing job.

After apply, use the returned `nextExecution` to call `agent.retryChapterPipeline` for that new job. Do not call `agent.runChapterPipeline`, because that would create another job. The complete request templates are shown in the Chinese section above.

## 6. Chapter acceptance

`agent.previewChapterAcceptance` binds the decision to the exact run, job, draft body, review reports, and current revision. `agent.applyChapterAcceptance` commits that preview under the applicable grant.

When review is complete, use `mode: "reviewed"`. Under library management or full-book creator rights, the exact draft or revision needs a passing quality gate and real review evidence. Other projects retain the existing reviewed exception: Codex may disagree with a failed or blocked report under `accept_draft`, but must record why. The original failed status remains intact.

Outside the creator workflow, `mode: "unreviewed"` is only for genuinely incomplete review. It requires one grant containing both `accept_draft` and `accept_unreviewed_draft`. Neither mode automatically accepts pending canon candidates.

Retrying an already committed operation only returns the existing commit and, when needed, repairs missing audit metadata. It does not replay world changes or restore an old draft over the current chapter body, even if the grant was later revoked.

## 7. World tools

The six world tools are `agent.getWorldRecords`, `agent.getWorldRecord`, `agent.getWorldActionReceipt`, `agent.getWorldActionHistory`, `agent.previewWorldAction`, and `agent.applyWorldAction`. Standard MCP `tools/list` provides each entity's editable `patch` fields. Write actions are `create`, `update`, `set_status`, and `archive`; there is no delete action. Characters and timeline events have no status/archive lifecycle. Duplicate sourced HardCanon content returns the existing ID for an explicit update instead of silently changing the receipt target.

Formal world apply requires the global `edit_world` grant. Read first, preview the explicit director decision, then apply with the returned fingerprint. `source.kind` is currently `agent_director` and `source.reason` records the concrete decision. `source.agentRunId` is optional: an independent world edit does not require a chapter job or a preceding `agent.startAgentRun`; when supplied, the run must belong to the same project. AI-generated or detected material must not become canon automatically. A successful retry with the same `operationId` returns the original receipt rather than overwriting later changes.

Use the JSON templates in the Chinese section and confirm the live schema through MCP `tools/list`, because this tool group is still evolving. Receipt and history reads are read-only and do not require `edit_world`.

## 8. Reproducible checks

The commands listed in the Chinese section are existing focused checks. They are not a claim that all W08 work, packaging, or platform verification is complete. The five-chapter director journey uses an in-process local mock responder to exercise the real handlers and pipeline order; it is not paid-model writing or a prose-quality evaluation. Run these checks only against their isolated JSON/SQLite fixtures; do not use a real novel database, a real user profile, secrets, or paid model calls.

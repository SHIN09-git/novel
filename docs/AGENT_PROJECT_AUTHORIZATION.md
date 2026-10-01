# Agent 项目授权与章节自主流程

本文面向使用 Agent 页的作者，以及通过 Novel Director 工具工作的 Codex。它说明当前 W08 项目授权模型、章节任务编辑、章节采纳和世界资料写入的实际边界。

> 本文描述当前仓库中的接口。WorldTools 仍在完善，调用前应以 MCP 标准 `tools/list` 返回的当前 descriptor 为准。`AgentToolService.listTools()` 是内部方法，不是名为 `agent.listTools` 的注册工具。文中的 ID、路径和作品内容都是模板或虚构示例，不代表真实项目，也不应直接当作作品设定使用。

已注册 MCP 客户端会通过协议自动调用 `tools/list`。也可以在仓库根目录用以下 PowerShell 命令直接查看实际工具 descriptor：

```powershell
'{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | npm.cmd run agent:tools
```

## 一、作者如何授予和撤回

项目授权由作者在 Agent 页的“项目授权”面板中授予或撤回。Codex 和普通工具调用不能自行给自己授权。

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

对于未经完整审稿的采纳，请在同一条授权中同时包含 `accept_draft` 和 `accept_unreviewed_draft`。当前授权匹配要求一条有效授权覆盖请求所需的全部动作，不能把两个动作拆在两条授权中再合并使用。

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

- 仍带有 `confirm` 或 `approvalToken` 参数的既有工具，继续遵循原来的普通确认语义。
- 新的授权型 apply 工具不把调用方传入的 `confirm: true` 当作作者授权证明。
- 已获得项目授权的动作可以在其范围内自主执行；超出范围时应停下并请作者调整授权。
- read 和通常的 preview 不需要项目授权。正式写入是否需要授权，以该 apply 工具的当前定义为准。

因此，目标不是让所有操作反复弹窗，而是让作者先明确开放有限范围，然后让 Agent 在该范围内完成可审计的自主流程。

## 四、每章标准流程

一次连续创作可以覆盖 5 章、10 章或几十章；系统没有“每次最多 2 到 3 章”的硬限制。当前 `agent.continueAgentRun` 的 `chapterCount` 接口允许 1 到 1000，但每章仍应独立完成以下流程，不能用一次审阅或一次采纳替代整批章节的判断：

1. **生成当前章**：新章节可用 `agent.runChapterPipeline` 创建并执行；连续运行可先用 `agent.continueAgentRun` 登记目标章节。该调用只创建首章 job，不会自动创建后续 job 或自动续跑队列。使用返回的当前 `agentRunId` 和 `jobId` 调用 `agent.retryChapterPipeline`；首章正式提交后，再在同一 run 中通过任务编辑创建下一章 job。
2. **读取正文与审阅材料**：用 `agent.getDraftText` 且显式传 `detail: "full"` 读取正文，并读取生产状态、诊断、完整 trace 和采纳建议。
3. **自主作出明确决定**：Codex 必须基于正文和报告明确选择采纳、修订、重试或暂停，并记录具体理由。报告是证据，不代替决定。
4. **preview 后 apply**：采纳或其他正式写入先生成绑定当前正文、报告和 revision 的 preview，再使用 preview 返回的 hash/revision apply。
5. **处理候选更新**：人物状态、伏笔、HardCanon、记忆等候选保持独立审核；采纳章节不会自动把候选写成 canon。
6. **进入下一章**：正式提交后重新读取当前项目状态和下一章目标，再开始下一章。

`agent.continueAgentRun` 只记录较长目标范围并准备首章，不是自动队列执行器。Agent 应按“生成 -> 阅读/审阅 -> 明确决定 -> preview/apply -> 下一章”的顺序推进；下一章 job 由 `agent.applyChapterTaskEdit` 在同一 run 中创建，再交给返回的 `agent.retryChapterPipeline` 执行。

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

只要审稿材料完整，就使用 `mode: "reviewed"`。即使质量报告为未通过，Codex 仍可在拥有 `accept_draft` 授权时明确选择采纳；理由必须说明为何不同意阻断结论。系统保留原报告的 `passed: false` 或 blocked 状态，不伪称审稿通过。

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

只有在审稿材料确实不完整时才使用 `mode: "unreviewed"`，并且同一条授权必须同时包含 `accept_draft` 和 `accept_unreviewed_draft`：

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

Existing tools that still expose `confirm` or `approvalToken` retain their existing confirmation behavior. Caller-provided confirmation is not proof of a project grant. Grant-aware apply tools can run repeatedly within the granted scope without asking for confirmation on every operation; out-of-scope writes must stop and ask the author for an appropriate grant.

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

When review is complete, use `mode: "reviewed"`. Codex may explicitly disagree with a failed or blocked report and accept under `accept_draft`, but it must record a concrete reason. The original failed status remains intact; the system does not claim that review passed.

When review is genuinely incomplete, use `mode: "unreviewed"`. This requires one grant containing both `accept_draft` and `accept_unreviewed_draft`. A completed review cannot be mislabeled as unreviewed. Neither mode automatically accepts pending canon candidates.

Retrying an already committed operation only returns the existing commit and, when needed, repairs missing audit metadata. It does not replay world changes or restore an old draft over the current chapter body, even if the grant was later revoked.

## 7. World tools

The six world tools are `agent.getWorldRecords`, `agent.getWorldRecord`, `agent.getWorldActionReceipt`, `agent.getWorldActionHistory`, `agent.previewWorldAction`, and `agent.applyWorldAction`. Standard MCP `tools/list` provides each entity's editable `patch` fields. Write actions are `create`, `update`, `set_status`, and `archive`; there is no delete action. Characters and timeline events have no status/archive lifecycle. Duplicate sourced HardCanon content returns the existing ID for an explicit update instead of silently changing the receipt target.

Formal world apply requires the global `edit_world` grant. Read first, preview the explicit director decision, then apply with the returned fingerprint. `source.kind` is currently `agent_director` and `source.reason` records the concrete decision. `source.agentRunId` is optional: an independent world edit does not require a chapter job or a preceding `agent.startAgentRun`; when supplied, the run must belong to the same project. AI-generated or detected material must not become canon automatically. A successful retry with the same `operationId` returns the original receipt rather than overwriting later changes.

Use the JSON templates in the Chinese section and confirm the live schema through MCP `tools/list`, because this tool group is still evolving. Receipt and history reads are read-only and do not require `edit_world`.

## 8. Reproducible checks

The commands listed in the Chinese section are existing focused checks. They are not a claim that all W08 work, packaging, or platform verification is complete. The five-chapter director journey uses an in-process local mock responder to exercise the real handlers and pipeline order; it is not paid-model writing or a prose-quality evaluation. Run these checks only against their isolated JSON/SQLite fixtures; do not use a real novel database, a real user profile, secrets, or paid model calls.

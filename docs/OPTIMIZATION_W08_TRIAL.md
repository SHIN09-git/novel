# W08 试用记录：Agent 创作与项目授权

日期：2026-09-07。候选版本：`0.1.6-preview.8`。

## 本批范围

作者在 Agent 页授予项目权限，Codex 通过同一份 SQLite/JSON 数据完成任务、资料管理和正式提交，不再依靠桌面点击执行这些动作。授权以数据源、项目、动作和章节范围共同确定，随时可撤回。它是应用级授权，不是宿主机文件权限隔离。

- 任务：读取九字段、预览影响、保存独立新运行，再明确开始生成。旧任务、草稿与手工快照保留。
- 世界资料：角色九项卡、动态状态、伏笔、时间线、HardCanon、剧情导向的读取、创建和编辑。独立资料编辑不要求先创建章节 job。
- 来源记录：`worldManagementReceipts` 保存操作前后、导演理由、实际授权和稳定操作编号；普通 JSON 导出/导入保留历史，但不携带项目授权。
- 采纳：明确绑定当前正文、报告和目标章节。允许获授权的导演不同意报告结论，不把失败报告改成通过；未审稿采纳需要额外许可。
- 候选、修订和章节管理：复用既有事务，授权范围内不必再等待逐条人工批准。章节采纳不会自动接受故事状态候选。
- 接手：Agent 页提供“读取最新结果”，经共享保存队列重新加载；不自动刷新并丢弃作者尚未保存的输入。

## 发现并修复

1. 世界资料的创建分支原先未检查预览指纹，重复操作还可能被误认成未落盘的成功重放。现在实际写入核对指纹，独立回执负责重放；新无变化操作也保存回执。
2. 旧工具文案仍宣称高风险动作不可由 Agent 执行，修订 schema 还强制额外确认。文案、schema、执行端与项目授权已对齐，普通确认不能自行提权。
3. 采纳的正式写入与批次元数据分开保存。若后者失败，重试只补缺失记录，不再写一次世界变更；即使作者后来改过正文，也不退回旧稿。
4. 旧 Agent 提交曾标为用户采纳。新提交记录真实 actor；桌面同时通过既有批次引用识别旧记录，避免历史统计突然归零。
5. 授权表单跨项目/数据源的迟到响应不回填新页面；未经审稿权限自动带上草稿采纳权限。项目级世界编辑不能误选成无效的章节范围授权。
6. 主进程从当前数据源获取授权范围，拒绝调用方夹带路径字段。授权不随小说数据备份导入，撤回在下一次实际写入前重新检查。
7. HardCanon 来源去重曾可能静默改写另一个 ID，导致操作回执指向不存在的目标。现在提示既有条目并要求显式修改；读写使用同一项目包，回执记录底层整理后的实际值和时间。
8. 实际深色窄窗口中，接入命令按钮白字浅底且折行。局部修复文字对比度和按钮宽度，四组主题/视口均验证对比度至少 4.5:1，不扩展全站样式。

## 针对性验证

使用独立临时项目，无真实小说数据库写入，无付费模型请求。

| 脚本 | 本次结果 | 说明 |
| --- | --- | --- |
| `validate-agent-authorization.mjs` | 16 组通过 | 实际授权文件、范围、撤回、跨进程写入锁 |
| `validate-agent-authorization-ui.mjs` | 28 项通过 | 表单解析、权限依赖、迟到响应边界、IPC 路径来源 |
| `validate-agent-project-grant-workflow.mjs` | 15 组通过 | JSON/原生 SQLite、正文与报告绑定、撤回、重试恢复、导入引用 |
| `validate-agent-chapter-task-tools.mjs` | 7 组通过 | 共享任务服务、新运行、旧产物保留、保存不调用模型 |
| `validate-agent-world-tools.mjs` | 21 项通过 | 六类资料、来源/范围、回执、重复操作、compact/full、HardCanon 来源去重 |
| `validate-agent-revision-tools.mjs` | 56 项通过 | 修订既有链路、项目授权、版本和迟到响应；含原生 SQLite 与独立故障模拟 |
| `validate-agent-director-journey.mjs` | 5 章顺序旅程通过 | 21 次进程内模拟响应；逐章审阅采纳、第三章暂停恢复、作者资料更新进入下一章 |

针对性结果不替代整套验收。五章旅程通过真实工具 handler 和标准生成流水线执行，但模型响应为本地固定样本，不代表文学质量评价。

## 发行验收

最终整套：131/131 验证脚本、类型检查、生产构建通过，含乱码扫描、架构边界、公开文档校验；`git diff --check` 通过。生产 Electron 和实际 Preview.8 unpacked 授权面板各通过 60 项检查、22 张截图，覆盖浅/深色和 1280x720、1024x768 两档视口。实际点击授予、取消、撤回、重启，以及外部写入后的主动读取；AppData 和授权文件边界保持正确，全部测试进程退出。

原始 UI 结果：`tmp/visual-qa/agent-authorizations/result.json`。可重复运行 `node scripts/qa-agent-authorization-ui.mjs`；包内验证使用 `node scripts/qa-agent-authorization-ui.mjs --packaged`，结果隔离保存到 `tmp/visual-qa/agent-authorizations-packaged/`。

Windows 包生成于 2026-09-07 17:41（UTC+8），release smoke 确认原生 SQLite 启动正常。开发侧 Node 24.14.0 / ABI 137 绑定已恢复，实际包使用 Electron 39.8.9 / ABI 140。包内运行身份与 `BUILD_INFO.json` 一致。

- 直接运行：`release/win-unpacked/Novel Director.exe`。
- 安装包：`release/Novel Director Setup 0.1.6-preview.8.exe`，102.77 MiB。
- SHA-256：`F419F4A85E5237B085DBD1B3F8E13E02F758DF2F64845089FE961F6C934DC1C4`，与 `release/SHA256SUMS.txt` 和文件实际哈希一致。
- Preview.7 保存在 `releases/archive/v0.1.6-preview.7-2026-09-07_09-40-32-688/`。
- 本地包未做数字签名；没有执行安装/卸载生命周期，也没有发布到 GitHub。

## 保留边界

- `continueAgentRun` 登记队列，仅创建第一章 job；Codex 每章审阅和提交后显式建立下一章任务，不是一次调用盲写整批。没有两三章的人工上限。
- 角色和时间线本身没有归档生命周期，本轮不伪造这类状态或增加删除接口。
- 世界资料写入仍是带 revision 的完整 AppData 短事务，细粒度保存是否值得增加，由第四优先项的性能实测决定。
- 回执保存历史，不等于长期设定自动得到许可；授权只在本机应用 profile 有效。移动数据库或换 profile 后需重新授权。
- 模拟模型验证流程顺序和数据变化，不评判真实小说质量，也不冒充模型费用对照。

详细操作：[Agent 项目授权指南](./AGENT_PROJECT_AUTHORIZATION.md)。下一主线是最终采纳质量/费用和 10/100/500 章读写测量，不扩张暂缓功能。

## English

W08 adds scoped, revocable author-issued project grants, deterministic task editing, six world-management entity types, persisted action receipts and explicit draft acceptance. It reuses existing JSON/SQLite transactions and version history. Grants remain outside story imports/exports; Agent decisions do not impersonate a user or silently promote pending candidates into canon.

The sequential five-chapter journey passes through real handlers with 21 in-process mock responses. Typecheck, all 131 validation scripts, production build, Windows packaging and native SQLite smoke pass. Production Electron and actual Preview.8 unpacked UI QA each pass 60 checks with 22 screenshots, without paid requests or remaining processes. The local unsigned installer and checksum are listed above; installer lifecycle and GitHub publication are not claimed. Mock-model checks verify workflow behavior, not prose quality or paid-model cost. World writes remain revision-checked full AppData saves; further persistence changes require measurements.

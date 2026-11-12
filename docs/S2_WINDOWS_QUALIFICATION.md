# S2：Windows Setup 验收

唯一的真实安装入口是 [S2 Windows Setup](../.github/workflows/library-s2-installer.yml)。它只响应 `SHIN09-git/novel` 的 `codex/library-s2-installer-qa` 分支推送。在 GitHub 托管的两台临时 Windows x64 上运行，不是发布流程。只改 `docs/**`、`ROADMAP.md` 或 `scripts/benchmark-*.mjs` 不会触发；根目录 `README.md` 不在排除范围。

**证据边界。** 本机只读检查未发现可确认的一次性 Windows 客户机：没有可用的 Hyper-V 管理命令或虚拟机 CIM 命名空间，未找到 Windows Sandbox 或常见桌面虚拟机管理程序。仅看到计算服务运行，不足以证明有可用客户机。未安装虚拟化组件，也未在作者账号运行 Setup。本页是复测说明，不替代某一次 CI 的验收记录。

## 如何运行

1. 由集成人确认候选提交，包含 S1、候选版本号及其锁文件、当前构建记录生成脚本和 S2 验收脚本。候选号必须高于 `0.1.6-preview.20`。只在获授权后推送到上述精确分支，不需要先修改默认分支、不需要创建 Release。
2. 矩阵的 `S2 clean` 用现有 `npm.cmd run dist:win` 打一次 x64 Setup；该命令自带解包成品启动检查，不是安装验收。`S2 upgrade` 不打包，只等同一次运行、同一次尝试的 artifact。两台机器都下载这一份，核实 Setup 的 SHA-256、`SHA256SUMS.txt`、`BUILD_INFO.json`、提交 SHA 和包名才安装。
3. 等两个任务结束。若需重跑，选择 **Re-run all jobs**；不要仅重跑失败的矩阵项。新尝试有独立的 artifact 名。要复核原来的安装包，保留原尝试的文件，不能用第二次构建的同版本包代替。

旧版取自[公开的 preview.20](https://github.com/SHIN09-git/novel/releases/tag/v0.1.6-preview.20)。`Novel.Director.Setup.0.1.6-preview.20.exe` 固定 SHA-256 为 `aa38b6dbcba629591113d928617f4ea82ee9c9dcfdfd199e67a7a9ce4c0d50ce`（与该发布的 [SHA256SUMS.txt](https://github.com/SHIN09-git/novel/releases/download/v0.1.6-preview.20/SHA256SUMS.txt) 一致）。每次执行 Setup 前重新算哈希，不下载“最新版”，不更新标签或附件。安装和卸载均为当前客户机用户的静默 NSIS 路径，不测试提升权限、全用户安装或交互向导。

## 验收判据

| 路径 | 实际动作及失败条件 |
| --- | --- |
| 全新安装 | 确认无既有安装或应用配置；运行候选 Setup；启动安装位置的应用，确认默认库为空。用桌面保存接口写入 S0 数据，在阅读页编辑并保存一章。关闭、重开，核对正文、三版版本链和独立 Agent 读数。运行真正的卸载器，检查程序和注册项消失；重装同一 Setup，默认路径和编辑仍在；再次卸载。 |
| 原地升级 | 在另一台机器安装固定的 preview.20；旧版通过桌面接口把固定 S0 备份写到非默认 SQLite 路径。关闭、重开旧版并备份已关闭的数据库。**不卸载旧版**，运行候选 Setup，不再传安装目录。候选必须接管旧位置，读到旧配置选择的原库；桌面编辑并重启后，随后运行的 Agent 必须读到同一路径和第三个版本。 |
| 回退 | 卸载候选、重装固定旧版。旧版先在单独配置目录打开升级后数据库的**副本**，验证编辑及三版链；另在新文件和新配置目录恢复升级前 SQLite 备份，验证原正文及两版链。两次均检查升级后原库的哈希不变。即使新版文件兼容性检查失败，也尝试备份恢复；前一失败不会因后一成功变绿，应记录为“仅备份回退已证实”，交由集成人判定。 |

每次启动都核对运行中的 exe、成品模式和 renderer 来源。应用版本以已安装 `app.asar/package.json` 和运行中应用报告为准；记录注册表 `DisplayVersion`，但不用它决定预发布后缀。候选应用的 asar 哈希、Electron 和 better-sqlite3 版本须与构建记录一致；依赖版本也与锁文件比对，记录实际原生绑定文件的校验值。只有安装后的界面能在 SQLite 上读写并在冷启动后读回才通过。

两本书的项目 ID、章节 ID、正文哈希、已采纳草稿、提交回执、版本 ID 和父版本、另一项目待续跑任务的步骤与检查点，均对照 [S0 清单](../scripts/fixtures/library-preview20/manifest.json)。编辑必须产生一条引用原第二版的新手动修订，原记录保留。Agent 在独立 Node 进程中仅指定应用配置目录，**不传数据库路径**；它自己选中的后端必须是 SQLite，不接受 JSON 回退。样本模型地址限制为回环拒绝端口；不启动生成任务，不携带模型凭据。

## 取回证据

在对应提交的 Actions 运行页下载以下三个 artifact，保留 **run ID、attempt、commit SHA、Setup SHA-256**：

- `s2-setup-<commit>-<attempt>`：实际分给两台机器的 Setup、`SHA256SUMS.txt`、`BUILD_INFO.json`。
- `s2-clean-report-<commit>-<attempt>` 和 `s2-upgrade-report-<commit>-<attempt>`：每台的 `qualification.json` 记录 NSIS 的命令、退出码、注册项、安装位置和哈希；各阶段 JSON 记录桌面及 Agent 回读、版本链、绑定、模型请求数和失败原因。若在安装前就失败，可能只有 job 记录；详见对应步骤日志。

按原始字节自行核对下载的 Setup、两份报告中的候选 SHA-256、构建记录中的提交与 asar 哈希。两份报告都须为 `passed`，关键阶段不能缺失。artifact 保留 14 天，长期留存由集成人负责。解包成品启动、静态检查、合成测试或单台成功都不能证明两条路径通过。

## 本地复测

只运行以下命令。它使用仓库内虚构样本的临时副本，通过真实的 SQLite 修订事务和 Node Agent 验证回读，不启动 Electron、不安装程序、不接触作者书库：

```powershell
node --test scripts/s2-windows/readback.test.mjs
```

该测试覆盖原始两版及修订后三版回读、损坏样本拒绝、升级前备份异地恢复、拒绝覆盖已有文件及拒绝复制尚有未写回日志的数据库。真实安装脚本有托管环境检查；不要在本机设置 CI 环境变量来绕过它。

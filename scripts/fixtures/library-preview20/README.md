# S0：preview.20 虚构旧库

`library.sqlite`（73,728 字节）是 Windows x64 公开版 Novel Director
`0.1.6-preview.20`、Electron `39.8.10`、better-sqlite3 `12.9.0` 写出的书库。
`backup.json` 是同一版本通过“手动备份”接口产生的完整 JSON，不是手工拼出的数据库副本。
`manifest.json` 记录这两份文件的 SHA-256，以及从窗口回读的正文、版本、回执、任务检查点。
正文按原始 UTF-8 字节计算 SHA-256，保留段间换行。清单不依赖本机文件路径。

两本书和全部正文均为虚构测试内容。没有作者项目、API 密钥、工作台授权或真实用户目录。
模型配置只指向回环地址；测试程序占用该端口，拒绝并统计任何请求，不代理请求。
样本本身不是运行中的服务。若端口被其他程序占用，复测会在启动 Electron 前退出。

**来源。** 在全新的临时用户目录中，通过公开版 preload 写入两本书、两份未采纳草稿和任务检查点。
在《纸灯码头》的生产流水线确认“未完成审稿，直接采纳”，再在连贯阅读页手动编辑并点“保存本章”。
两条正式提交回执都是旧版窗口生成的。用同一版本更改保存位置、创建手动备份并退出；
冷启动核对原路径和版本链，关闭应用且确认没有待写 WAL 后才复制 SQLite。库不是从真实用户目录裁剪而来。

| 项目 | 固定检查项 |
| --- | --- |
| 纸灯码头 `s0-quay` | `s0-quay-draft` 已采纳；`generated_draft` → `manual_revision`，第二版引用第一版；当前正文与修订后版本相同。 |
| 潮表留白 `s0-tide` | `s0-tide-job` 的写稿步骤已完成，`await_user_confirmation` 为失败步骤。检查点和草稿仍在；只在工作副本点击“重试失败步骤”，同一任务可无模型请求地完成。 |

**复测。** 从仓库根目录运行。传给两个版本的路径都是 **win-unpacked 目录**，不是 exe、Setup 或源码目录。

```powershell
# 用固定样本复现公开版问题；省略 --preview20 时读取当前仓库的 release/win-unpacked。
node scripts/qa-library-recovery.mjs s0 --preview20 '<公开版 win-unpacked 目录>' --fixture scripts/fixtures/library-preview20

# 重新制作一份等价样本；正式提交会生成新的版本 ID，既有样本不会被覆盖。
node scripts/qa-library-recovery.mjs s0 --preview20 '<公开版 win-unpacked 目录>'

# 用此工作区已构建的候选成品验收；默认使用本目录里的固定样本。
node scripts/qa-library-recovery.mjs s1 --candidate '<候选 win-unpacked 目录>'
```

每次运行使用独立的 `tmp/library-s0-*` 或 `tmp/library-s1-*`，保留报告、窗口截图和隔离用户目录。
新制作的样本在该次 S0 运行的 `fixture` 子目录。可给 S1 传 `--fixture '<该 fixture 子目录>'` 来验同一份新样本。
S2 安装升级测试应复制 SQLite 或 JSON 到它自己的临时书库，不直接打开此目录中的基准文件。

# S4 自动备份：兼容性与同机测量

本批次只改变新自动备份。手动备份、恢复或导入前的安全副本、作品导出仍是普通 JSON。备份只包含书库数据；不搬运本机凭据、授权文件或库外的 `.usage` 收据。

## 恢复与轮替

- 设置页列出并能恢复、删除旧 `.json` 和新 `.json.gz`。启动恢复及合并／覆盖导入的文件选择器也支持两种格式。压缩备份只作输入，不能选为可写书库。
- 自动备份到期时，先写普通 JSON 临时文件，再从同一文件生成 gzip。两个文件写完后，先公布普通回退副本，最后公布 gzip；成功后才轮替。失败不提前删除旧备份。若进程意外退出，未公布的临时文件不参与列表和到期判断。
- 新旧自动备份合计保留七份。七份都是 gzip 时，另有一份最新、完整、可用旧版 JSON 读取方式打开的 `novel-director-<时间>-rollback-<UUID>.json`。它不依赖碰巧存在的手动备份，也不占七个名额。只轮替程序命名的自动备份和回退副本。
- 压缩输入最多 385 MiB，解压后的 JSON 最多 384 MiB，按实际流过的字节数检查，包括多个 gzip 成员。超过 **384 MiB 的新库**自动改存旧格式普通 JSON，仍参与当天到期判断和七份轮替；此时新自动备份本身即可回退。手动和已有普通 JSON 不受 gzip 上限影响，仍受原有内存和 JSON 解析能力限制。
- 恢复、导入均在数据校验后才写目标库。设置页覆盖恢复现在必须先成功保存恢复前副本；磁盘满等错误会停止覆盖。常规保存仍沿用已有的自动备份错误处理，不因自动备份失败禁止作者保存书库。

## 测量

Windows x64，Node 24.14.0。使用 `createLongNovelFixture(500)` 的两个虚构项目；规范化后紧凑 UTF-8 JSON 为 77,569,300 字节，原格式含缩进的备份为 81,004,739 字节。相同配方、同机、各热身一次，再测七次。每轮把时钟推进 25 小时以触发真实备份，接着检查未到期路径，再读取备份并逐项核对全库。时间为毫秒，不含测试断言。基线为工作树起点 `804f738` 的备份实现。

| 指标 | 原普通 JSON | 新自动备份 |
| --- | ---: | ---: |
| 单份自动备份（字节） | 81,004,739 | 2,280,072 |
| 八次到期写入后实际保留（字节） | 567,033,173，7 个文件 | 96,965,243，8 个文件，含普通回退副本 |
| 到期：写入、公布及清理（中位／最慢） | 228.56 / 253.13 | 368.41 / 390.60 |
| 未到期：只检查目录（中位／最慢） | 0.53 / 0.69 | 0.85 / 1.10 |
| 读取并校验备份（中位／最慢） | 115.71 / 137.40 | 290.21 / 308.32 |

此样本长期占用减少 82.9%，但到期备份和读取都变慢。样本含重复的虚构正文、提示词和历史，不代表作者书库的压缩率。轮替期间还需要能同时容纳新普通副本和新 gzip 的额外空间。上表是文件字节数，不是文件系统分配的块数。

## 复测与交接

在被测工作树运行 `node scripts/benchmark-auto-backup.mjs`。同一脚本可分别搭配改前、改后的备份服务复测；临时库在本工作树的 `tmp` 内，结束后删除。不需要改包脚本。

```powershell
npm.cmd test -- validate-backend-backup-laziness validate-library-session validate-import-safety
$env:S4_TEST_LARGE = '1'
node --max-old-space-size=4096 scripts/validate-backend-backup-laziness.mjs
```

专项覆盖混合轮替、最后一份旧自动 JSON 退出后的普通回退副本、原手动文件不变、两处部分写入 ENOSPC、最终重命名失败、重试、损坏／截断、CRC、UTF-8、BOM、多成员超限、合并与覆盖的结构差异，以及真实 SQLite 恢复后重启。另用默认生产上限写出并恢复了 **402,674,364 字节**的普通自动备份，确认同日不重做。恢复样本取自仓库内 preview.20 虚构备份；没有运行旧发行程序或真实安装器。

生产入口：[写入与轮替](../src/main/BackupService.ts)、[格式识别与有界读取](../src/main/backupFileFormat.ts)、[书库痕迹](../src/main/libraryFiles.ts)、[启动恢复](../src/main/LibrarySession.ts)、[恢复选择器](../src/main/ipc/libraryRecoveryIpc.ts)、[设置恢复](../src/main/ipc/backupIpcHandlers.ts)、[数据导入](../src/main/ipc/dataIpcHandlers.ts)、[列表字段](../src/shared/ipc/ipcTypes.ts)、[设置列表](../src/renderer/src/views/settings/SettingsDataPanels.tsx)。

验证入口：[已有回归入口](../scripts/validate-backend-backup-laziness.mjs)、[S4 用例](../scripts/checks/backup-formats.mjs)、[计时脚本](../scripts/benchmark-auto-backup.mjs)。生产构建使用工作树临时输出目录，不生成安装包。

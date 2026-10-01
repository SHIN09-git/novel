# 发行产物说明 / Release Artifacts

## 简体中文

Novel Director 的本地目录按用途分为三层：

- `out/`：临时生产构建结果，由 Electron Vite 生成，不用于分发。
- `release/`：唯一的当前发行目录，只保留最新安装包和对应的 `win-unpacked` 可执行目录。
- `releases/archive/`：历史发行归档。版本升级打包时先保留旧的 `release/`；定期清理仅在明确授权后进行，并保留至少一个已验证的回退版本。

运行 `npm.cmd run dist:win` 后，当前发行目录应包含：

- `Novel Director Setup <版本号>.exe`：给普通用户安装的文件。
- `win-unpacked/Novel Director.exe`：无需安装的本地测试版本。
- `SHA256SUMS.txt`：安装包 SHA-256 校验值。
- `BUILD_INFO.json`：版本、构建时间、Electron 版本和打包烟雾测试状态。

同一版本重新打包时，旧的同版本构建产物会被替换。升级版本时，上一版本会自动归档。因此请始终从 `release/` 上传当前 GitHub Release，不要从 `releases/archive/` 选择安装包。

小说项目和 SQLite 用户数据库不存放在这些目录中，整理发行产物不会移动或删除用户数据。

### 当前本地发行与清理（2026-10-01）

- 当前版本：`0.1.6-preview.18`，包含 10 月 1 日已有的 Ink Desk 界面更新。本轮保留这些设计改动，没有重做界面或修改业务规则。
- 安装包：`release/Novel Director Setup 0.1.6-preview.18.exe`。
- 直接运行：`release/win-unpacked/Novel Director.exe`。
- 上一版完整回退包：`releases/archive/v0.1.6-preview.17-2026-10-01T08-15-54-270Z/`。
- 已删除 Preview.10 至 Preview.16 的 8 份旧归档（包含一次同版本重复构建），共 1,064 个文件、3.862 GiB。逐项记录在本机 `tmp/cleanup-20261001/result.json`；清理前后当前包与回退包的文件 SHA-256 一致。
- 另移除当前发行目录中仍指向 Preview.10 的过期 `latest.yml`；应用没有引用这个更新索引，不应随新版上传。
- 没有清空 `tmp/`，没有删除小说数据库、备份、创作资料、导出文件、模型试验、源代码、依赖或原生绑定；本轮临时打包目录已清除。

验收：类型检查、149/149 回归脚本、生产构建、Windows NSIS 打包、包内启动与 SQLite smoke 均通过。包内 110 个 `out/` 文件与本次构建逐项 SHA-256 一致，记录在 `release/BUNDLED_OUTPUT_SHA256.json`。Node SQLite 绑定仍可用，未被 Electron 绑定覆盖。

实际 `win-unpacked` 使用隔离虚构项目完成七个页面、明暗主题、1440/1024px 布局、800px/125% 缩放、侧栏收起和角色输入/保存检查，共 40 张截图。报告：`tmp/visual-qa/hig-workspace/after-OXLqPf/report.json`。旧截图用例在动效结束前读取侧栏宽度的问题已修正；保留新动效，检查仍要求收起后宽度为零。测试没有调用模型，也没有写入真实小说，验收进程已退出。

安装包 SHA-256：`DE58BE67C14100FD246DAA95B0A8B9C7D5E12DCCA4C5815CCDB514EE4A15FC70`。仍未代码签名，也未上传 GitHub。未对作者现有安装目录执行覆盖安装；若桌面快捷方式指向旧的已安装版，请运行新安装包更新，或使用上面的 `win-unpacked` 路径。

### 本地清理记录（2026-09-12）

本次按实际引用和文件用途清理，而不是按“未跟踪”或“名字像临时文件”直接删除：

| 已清理内容 | 文件数 | 文件大小合计 |
| --- | ---: | ---: |
| 13 份过期发行目录 | 1,787 | 6,517.53 MiB |
| 四轮已通过长篇性能测试的虚构样本库、迁移副本和自动备份 | 132 | 4,214.67 MiB |
| 根目录误生成、无引用的 `NUL.css` | 1 | 不到 1 MiB |

合计清理 1,920 个文件、10.48 GiB。当前 `release/` 的 Preview.11 和 `releases/archive/` 的 Preview.10 完整回退包保留。原始性能结果 JSON、测试日志和截图保留；性能报告中的旧 profile 路径仍是当时的测量索引，样本数据库需要通过基准脚本重新生成。本机逐项清单位于 `tmp/cleanup-20260912/result.json`，不纳入源码分发。

后续清理沿用以下边界：

- 保留当前可运行发行包与至少一份已验证的回退包；打包脚本仍然自动归档，不自动删除历史版本。
- `tmp/` 也可能含真实创作草稿、模型试验和恢复记录，不可整体清空。只清理能对应到已完成测试及虚构 fixture 的样本库。
- 不动 `authoring/`、`exports/`、`experiments/`、用户数据库及备份；不按文件扩展名批量删除整个仓库的 JSON/SQLite。
- 保留 `node_modules/`、Electron 下载缓存和 SQLite 原生绑定，避免清理后又触发下载或 ABI 重建。
- 源码兼容导出、测试入口和旧启动器仍有引用，不属于本次冗余删除范围。

清理后 64 组受保护文件的 SHA-256 汇总与清理前一致，包含源码、脚本、创作资料、导出文件、性能结果、当前包、回退包及 SQLite 原生绑定。本次不改应用行为，无需重新安装。

清理后验证：类型检查通过；完整回归 137/137 通过；生产构建通过；当前 Preview.11 安装目录的启动与 SQLite smoke 通过；`git diff --check` 通过。验证日志保存在本机 `tmp/cleanup-20260912/`。

## English

Novel Director keeps local build output in three clearly separated locations:

- `out/`: temporary Electron Vite production output; it is not distributed.
- `release/`: the single current release directory, containing only the latest installer and unpacked executable.
- `releases/archive/`: historical release archives. Keep the previous release when packaging; prune older archives only with explicit authorization and retain at least one verified rollback version.

After running `npm.cmd run dist:win`, `release/` contains the installer, `win-unpacked/Novel Director.exe`, `SHA256SUMS.txt`, and `BUILD_INFO.json`.

Rebuilding the same version replaces generated output. Building a newer version archives the previous release. Upload artifacts to GitHub Releases from `release/`, not from `releases/archive/`.

Novel projects and the SQLite user database are stored elsewhere. Organizing release artifacts does not move or delete user data.

### Current Local Release and Cleanup (2026-10-01)

Preview.18 packages the existing October 1 Ink Desk UI updates without replacing the design or changing business rules. The current installer is `release/Novel Director Setup 0.1.6-preview.18.exe`; the executable is `release/win-unpacked/Novel Director.exe`. The complete Preview.17 rollback package remains in `releases/archive/v0.1.6-preview.17-2026-10-01T08-15-54-270Z/`.

Removed eight older Preview.10-16 archive trees, including a duplicate build: 1,064 files totaling 3.862 GiB. Current and rollback file hashes remained unchanged. The local manifest is `tmp/cleanup-20261001/result.json`. Author databases, backups, exports, experiments, source, dependencies and native bindings were not removed; `tmp/` was not emptied. This run's temporary packaging directory was removed.

Also removed the stale `release/latest.yml` still pointing to Preview.10. The app does not consume this update index, and it should not accompany the new release.

Typecheck, all 149 regression scripts, production build, Windows NSIS packaging and packaged startup/SQLite smoke passed. All 110 bundled `out/` files match the build by SHA-256; see `release/BUNDLED_OUTPUT_SHA256.json`. The Node SQLite binding remains intact. The real unpacked executable passed seven-page checks in both themes, desktop and narrow/zoomed layouts, sidebar controls and character editing/saving, producing 40 screenshots in `tmp/visual-qa/hig-workspace/after-OXLqPf/`. Screenshot checks now wait for the new rail transition before requiring zero width. All fixture processes exited; no model calls or real novel writes occurred.

Installer SHA-256: `DE58BE67C14100FD246DAA95B0A8B9C7D5E12DCCA4C5815CCDB514EE4A15FC70`. The package remains unsigned and has not been uploaded to GitHub. Existing system installations were not overwritten: run the new installer to update an installed copy, or launch the current unpacked executable directly.

### Local Cleanup (2026-09-12)

Removed 13 obsolete release trees, 132 synthetic database/migration/backup files from four completed long-novel benchmarks, and the unreferenced generated root `NUL.css`: 1,920 files totaling 10.48 GiB. Preview.11 remains the current release; the complete Preview.10 rollback package remains archived. Raw performance reports, logs and screenshots are retained. Old profile references identify the original measurements, but cleaned synthetic databases must be regenerated with the benchmark script.

Do not empty `tmp/` indiscriminately: it also contains real authoring and model-trial artifacts. Keep authoring data, exports, experiments, dependencies, Electron caches and native bindings. Keep at least one verified rollback package; packaging still archives prior releases without automatic pruning. Compatibility exports and test entry points are not dead code merely because the application has no direct import.

Aggregate SHA-256 fingerprints for 64 protected groups were unchanged after cleanup. The local per-target record is `tmp/cleanup-20260912/result.json`. No application behavior or package bytes changed, so reinstalling is unnecessary.

Post-cleanup verification passed: typecheck, all 137 validation scripts, production build, the current Preview.11 packaged startup/SQLite smoke test, and `git diff --check`. Local logs are in `tmp/cleanup-20260912/`.

# 公开发布清单 / Public Release Checklist

## 简体中文

这份清单记录首次公开源码发布前，在仓库本地完成的检查项。

### 本地已完成

- 从源码树移除了已跟踪的 launcher 二进制。
- 从 `tools/NovelDirectorLauncher.cs` 移除了开发者本机 fallback 路径。
- 将看起来像 OpenAI key 的安全凭据测试哨兵替换为非 provider 格式字符串。
- 添加 `LICENSE`，并同步 `package.json.license`。
- 添加 `SECURITY.md`。
- 添加 `CONTRIBUTING.md`。
- 更新 `.gitignore`，覆盖本地 env 文件、launcher 构建产物、截图、临时文件、备份、损坏 JSON 备份和导出正文。
- 移除内部 `UI_AUDIT.md`，添加公开版 `docs/UI_NOTES.md`。
- 用公开版 `ROADMAP.md` 替换内部 `TODO.md`。
- 移除已跟踪的 `ui-audit/screenshots/**`。
- 声明 fixture 文本和 `《雾城测试稿》` / `Fog City Test Draft` 均为 synthetic test data。
- 强化 `README.md`，补充项目状态、许可证、贡献、安全、隐私、AI provider 边界和构建产物说明。
- 添加 GitHub Actions CI workflow。
- 添加 `CHANGELOG.md`。
- 添加 `THIRD_PARTY_NOTICES.md`。
- 添加 `scripts/validate-public-release-cleanup.mjs`，防止这些清理项回退。

### 需要在 GitHub 仓库设置中完成

- 启用 GitHub secret scanning。
- 启用 Dependabot alerts。
- 配置 branch protection。
- 要求 CI checks 通过后才能合并。
- 在可信环境中运行 Gitleaks、TruffleHog 或类似第三方 secret scanner，再打 tag 或发布 release。

### 备注

- 生成二进制应附加到 GitHub Releases，不应提交到源码仓库。
- Release artifact 应提供校验和。
- 如果未来添加公开截图，应使用干净的 synthetic demo，并放在 `docs/assets/`。

---

## English

This checklist records the repository-local checks before the first public source release.

### Completed Locally

- Removed the tracked launcher binary from the source tree.
- Removed the developer-machine fallback path from `tools/NovelDirectorLauncher.cs`.
- Replaced the OpenAI-looking secure-credentials test sentinel with a non-provider-shaped test string.
- Added `LICENSE` and synchronized `package.json.license`.
- Added `SECURITY.md`.
- Added `CONTRIBUTING.md`.
- Updated `.gitignore` for local env files, launcher builds, screenshots, temporary files, backups, corrupt JSON backups, and exported manuscripts.
- Removed internal `UI_AUDIT.md`; added public `docs/UI_NOTES.md`.
- Replaced internal `TODO.md` with public `ROADMAP.md`.
- Removed tracked `ui-audit/screenshots/**`.
- Declared fixture text and `《雾城测试稿》` / `Fog City Test Draft` as synthetic test data.
- Strengthened `README.md` with status, license, contribution, security, privacy, AI provider boundary, and build artifact notes.
- Added GitHub Actions CI workflow.
- Added `CHANGELOG.md`.
- Added `THIRD_PARTY_NOTICES.md`.
- Added `scripts/validate-public-release-cleanup.mjs` to keep these checks from regressing.

### Must Be Completed In GitHub Repository Settings

- Enable GitHub secret scanning.
- Enable Dependabot alerts.
- Configure branch protection.
- Require CI checks before merge.
- Run a third-party secret scanner such as Gitleaks or TruffleHog in a trusted environment before tagging a release.

### Notes

- Generated binaries should be attached to GitHub Releases, not committed to source.
- Release artifacts should include checksums.
- Public screenshots, if added later, should be clean synthetic demos under `docs/assets/`.

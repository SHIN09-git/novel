# Public Release Checklist

This checklist records the repository-local checks before the first public source release.

## Completed Locally

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

## Must Be Completed In GitHub Repository Settings

- Enable GitHub secret scanning.
- Enable Dependabot alerts.
- Configure branch protection.
- Require CI checks before merge.
- Run a third-party secret scanner such as Gitleaks or TruffleHog in a trusted environment before tagging a release.

## Notes

- Generated binaries should be attached to GitHub Releases, not committed to source.
- Release artifacts should include checksums.
- Public screenshots, if added later, should be clean synthetic demos under `docs/assets/`.

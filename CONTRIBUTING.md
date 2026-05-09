# Contributing to Novel Director

Thanks for helping improve Novel Director. This project is a local-first Electron + React + TypeScript desktop workbench for long-form AI-assisted fiction writing.

## Development Setup

```bash
npm install
npm run dev
```

On Windows PowerShell, prefer `npm.cmd` if script execution policy blocks `npm.ps1`:

```powershell
npm.cmd install
npm.cmd run dev
```

## Required Checks

Before opening a pull request, run:

```bash
npm run typecheck
npm test
npm run build
```

Windows equivalent:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

## Pull Request Guidelines

- Keep changes narrow and explain the user-facing behavior.
- Do not commit local data files, exported manuscripts, screenshots with private text, generated launchers, or packaged binaries.
- Do not commit API keys, `.env` files, or local machine paths.
- Preserve local data compatibility. If a persisted type changes, update normalization and validation scripts.
- Keep renderer file access behind the preload/main IPC boundary.
- Add or update validation scripts for safety-sensitive changes.
- For AI output handling, validate and normalize model responses before writing project data.

## Packaging and Binaries

Do not commit `.exe`, `.msi`, `.zip`, or generated launcher binaries to the source repository. Build artifacts should be attached to GitHub Releases with build instructions and checksums.

## Data Safety

Changes that touch storage, migration, backups, API credentials, prompt building, generation pipeline, revision acceptance, or memory candidates should be treated as high risk. Prefer small patches, regression scripts, and explicit user confirmation for destructive actions.

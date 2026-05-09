# Security Policy

Novel Director is a local-first desktop writing workbench. It stores novel projects, drafts, prompts, run traces, and settings on the user's machine.

## Supported Versions

This repository is pre-1.0. Security fixes target the current `main` branch unless a release branch is explicitly documented.

## Reporting a Vulnerability

Please report security issues privately through GitHub Security Advisories if available. If advisories are not enabled yet, open a minimal issue that asks for a private contact channel without posting secrets, API keys, data files, or full drafts.

Do not include:

- Real API keys or bearer tokens.
- `novel-director-data.json` files from real projects.
- Full generated prompts, chapter drafts, or run traces containing private story material.
- Screenshots that expose keys, local paths, or private manuscript text.

Safe reports should include:

- A concise description of the issue.
- Reproduction steps using dummy data.
- Expected and actual behavior.
- Relevant version, operating system, and whether the issue affects storage, IPC, AI calls, export, or packaging.

## API Key Boundary

API keys should not be stored in AppData JSON. Current builds use Electron `safeStorage` in the main process for saved API keys. Renderer code can set, delete, or check whether a key exists, but should not read back the full plaintext key.

The project includes regression checks for plaintext key persistence. Test sentinels intentionally use non-provider-shaped strings to avoid secret scanner false positives.

## Local Data Boundary

Novel Director data is local by default. Users can change the data file path in Settings. Data migration, export, backup, and merge paths should sanitize credentials before writing current-version JSON files.

Legacy backups may contain old plaintext data if they were created from older versions or imported files. Treat backup files as sensitive and avoid sharing them publicly.

## File and IPC Boundary

Renderer code must not access Node `fs`, `path`, `shell`, or `ipcRenderer` directly. File selection, export, clipboard, storage migration, and credential operations should go through the typed preload API and main-process IPC handlers.

## Responsible Disclosure Expectations

We aim to acknowledge valid reports promptly. Because this is an early open-source project, response timelines may vary, but reports that protect user manuscripts, API keys, or local files are treated as high priority.

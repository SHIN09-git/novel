# Novel Director

Novel Director is an experimental, local-first desktop workbench for managing AI-assisted long-form fiction projects. It is designed for authors who need more than a text editor: project bibles, chapter continuity, character state, foreshadowing schedules, prompt context control, generation traces, quality gates, and revision workflows.

This repository is an early `0.1.0` preview. It is useful for local trials and development, but the data format and UX are still evolving.

## Status

- Experimental local-first desktop app.
- Windows is the primary development target.
- Data is stored locally as JSON.
- AI features are optional and depend on the provider you configure.
- No prebuilt binaries are tracked in this source repository.

## Features

- Project management for long-form fiction.
- Story bible for stable long-term canon.
- Chapter editor with recap fields, continuity bridge, copy, and export.
- Character cards, character state ledger, foreshadowing ledger, timeline, and stage summaries.
- Prompt Builder with token budgeting, context snapshots, foreshadowing treatment modes, and priority-ordered prompt assembly.
- Generation Pipeline for chapter plan, draft, review, memory candidates, consistency review, quality gate, and run trace.
- Revision workbench with version history and diff view.
- Local data path management with backup, migration, and merge preview.
- Secure API key storage through Electron `safeStorage` when available.

## Install

```bash
npm install
```

On Windows PowerShell, `npm.cmd` is often more reliable than `npm` if script execution policies block `npm.ps1`:

```bash
npm.cmd install
```

## Run

```bash
npm.cmd run dev
```

## Validate

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

## AI Provider Setup

Open Settings in the app and configure:

- Provider
- Base URL
- Model name
- Temperature
- Max tokens
- API key

The API key is not intended to be persisted in the main AppData JSON. The desktop app stores it through Electron secure storage and only exposes key presence to the renderer process.

When AI generation is enabled, selected project context and prompt content may be sent to the configured provider. Review your provider's terms and privacy policy before using real manuscript data.

## Privacy and Local Data Boundary

Novel Director is local-first. Project data is stored on your machine, normally in Electron `userData`, unless you choose a custom data path in Settings.

Important boundaries:

- The renderer does not receive direct Node `fs` access.
- File operations go through controlled IPC handlers.
- API keys should not appear in exported project JSON.
- If you use a remote AI provider, prompt context leaves your machine for that request.
- Do not paste real API keys, private manuscripts, or local data files into public issues.

## Build Artifacts

This repository does not track generated `.exe` files or packaged app binaries. Build artifacts should be produced from source and distributed through GitHub Releases with checksums.

Local build:

```bash
npm.cmd run build
```

The lightweight launcher source is in `tools/`. It resolves the project path from `NOVEL_DIRECTOR_PROJECT_PATH` or by searching upward from the launcher location; it should not contain developer-machine absolute paths.

## Synthetic Test Data

All novel titles, characters, plot fragments, and story excerpts used in tests, docs, fixtures, screenshots, or regression scripts are synthetic demo data. They are not customer manuscripts and should not be treated as production writing.

The regression project sometimes appears as `Fog City Test Draft` / `《雾城测试稿》`; it is a fictional fixture created only for testing. Public screenshots are not tracked in this repository. If screenshots are added later, they should be regenerated from clean synthetic demo data and placed under `docs/assets/`.

## Documentation

- [Quickstart](./QUICKSTART.md)
- [Testing guide](./TESTING.md)
- [Roadmap](./ROADMAP.md)
- [Security policy](./SECURITY.md)
- [Contributing guide](./CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)
- [Third-party notices](./THIRD_PARTY_NOTICES.md)

## Contributing

Please read [CONTRIBUTING.md](./CONTRIBUTING.md). The minimum checks before opening a pull request are:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

## Security

Please report vulnerabilities privately. See [SECURITY.md](./SECURITY.md). Do not open public issues containing API keys, private project data, generated manuscripts, or local data files.

## License

Novel Director is released under the [MIT License](./LICENSE).

# Changelog

All notable changes for Novel Director are documented here.

## 0.1.0 - Public Preview

### Added

- Local-first Novel Director desktop MVP.
- Project, story bible, chapter, character, foreshadowing, timeline, and stage summary management.
- Prompt Builder with context need planning, context budget selection, prompt priority stack, context snapshots, and token estimates.
- Generation Pipeline with chapter planning, draft generation, review candidates, consistency review, quality gate, novelty audit, and run trace.
- Character State Ledger MVP for hard-state tracking.
- Revision Workbench with safe local revision merge, version history, and diff view.
- Chapter copy/export and data path management.
- Secure API key storage through Electron `safeStorage` where available.
- Public documentation, security policy, contribution guide, CI, and third-party notices.

### Known Limitations

- The app is an experimental preview.
- JSON storage is local-first and portable, but not yet a stable public data interchange contract.
- AI provider behavior varies by model and configuration.
- Quality gate, novelty detection, and state validation use conservative deterministic checks plus configured AI calls where available; review results before accepting changes.
- Generated binaries are not tracked in the repository. Release artifacts should be distributed separately with checksums.

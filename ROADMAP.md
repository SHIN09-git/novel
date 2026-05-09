# Roadmap

This roadmap is intentionally public-facing. It lists planned product directions without exposing private security notes, local development paths, or internal audit details.

## 0.1.0 Preview Scope

- Local-first Electron desktop app.
- JSON persistence with backup and migration safeguards.
- Project, story bible, chapter, character, foreshadowing, timeline, stage summary, and settings management.
- Prompt Builder with context snapshots, token budgeting, context need planning, prompt priority stack, and foreshadowing treatment modes.
- Generation Pipeline with draft generation, chapter review, memory candidates, consistency review, quality gate, novelty audit, and run trace.
- Revision Workbench with version history and diff view.
- Chapter copy/export and data path migration.

## Near-Term Priorities

### Data Safety

- Continue expanding regression coverage for save ordering, migration merge, backup restore, and import/export edge cases.
- Improve user-facing recovery guidance for corrupt JSON and failed migration attempts.
- Add fixture-based tests for older AppData versions.

### Generation Quality

- Improve Context Need Planner heuristics for scene type, cast selection, hard-state requirements, and forbidden context.
- Improve novelty detection accuracy for new rules, organizations, system mechanics, and named characters.
- Refine prompt compression so long-range summaries preserve causality without overloading the prompt.

### Usability

- Continue simplifying the Generation Pipeline interface around one primary action at a time.
- Add clearer empty states and progressive disclosure for reports and trace details.
- Improve keyboard and long-text editing ergonomics.

### Packaging and Releases

- Publish signed or checksummed build artifacts through GitHub Releases only.
- Keep generated binaries out of the source repository.
- Document build provenance and release checksums.

## Longer-Term Ideas

- Optional SQLite storage backend.
- More granular project import/export.
- Provider adapters for multiple AI APIs.
- Richer visual timeline and relationship views.
- More robust structured-output validation.
- Better accessibility and keyboard navigation.

## Known Limits

- This is an early preview; data format compatibility is maintained through normalization, but long-term schema stability is not guaranteed yet.
- AI output quality depends on the configured model and provider.
- The novelty detector and quality gate use conservative heuristics and can produce false positives or false negatives.
- Local-first does not mean remote-private when a remote AI provider is enabled; prompt context can be sent to that provider.

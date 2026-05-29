# Novel Director UI QA - Current Pass

Generated: 2026-05-29

This pass used a real Electron window with isolated test user data seeded from `tmp/rc-regression/novel-director-data.json`.
Screenshots are stored in `tmp/ui-qa-screenshots/current/` so public-release source checks stay clean.

## Screenshots

- Dashboard: `tmp/ui-qa-screenshots/current/dashboard.png`
- Chapters: `tmp/ui-qa-screenshots/current/chapters.png`
- Characters: `tmp/ui-qa-screenshots/current/characters.png`
- Prompt Builder: `tmp/ui-qa-screenshots/current/prompt-builder.png`
- Generation Pipeline: `tmp/ui-qa-screenshots/current/pipeline.png`
- Revision Studio: `tmp/ui-qa-screenshots/current/revision.png`

## Cross-Page Checks

- No horizontal overflow was detected at 1440x1000. Every captured page reported `scrollWidth === clientWidth`.
- The app shell is visually consistent across the six checked pages.
- The left navigation now fits the 1000px viewport without its own scroll range after tightening sidebar spacing.
- The workspace topbar remains stable and readable across the checked pages.
- Page-level hierarchy is clear: each page has one dominant title, and primary actions are placed in the upper right or page-specific action area.

## Page Notes

### Dashboard

Overall: strong first impression. The project overview, next action, production status, and risk radar read as a coherent control room.

Follow-up: the lower activity cards continue below the fold, which is expected. No urgent layout issue.

### Chapters

Overall: the three-zone structure is effective: chapter list, active editor, chapter review panel.

Follow-up: the right review panel has its own inner scroll. This is acceptable for dense editing, but later it may benefit from a sticky section index or collapsed review blocks.

### Characters

Overall: the character list and selected character state card make the current dramatic state visible quickly.

Follow-up: this page is still very long because the full character card and dynamic ledger live in one vertical flow. A future pass could introduce tabs or a sticky character summary rail.

### Prompt Builder

Overall: the two-column split makes context controls and budget results easier to scan than the old long-form layout.

Follow-up: this remains the densest page. Context modules, need planner, foreshadowing selection, and final prompt preview are all valuable but could use progressive disclosure in a later pass.

### Generation Pipeline

Overall: the production console is much clearer after the layout pass. The current artifact is prominent, and the top run status communicates the job state.

Follow-up: at 1440px desktop width, the inspector moves below the main work area rather than staying as a third column. This protects draft readability, but users on wide monitors may still expect a persistent right-side inspector.

### Revision Studio

Overall: the three-column revision layout is readable, with source, original text, and revision result clearly separated.

Follow-up: the empty revision result panel is clear, but the page could eventually surface recent version history or suggested next actions without forcing a scroll.

## Fix Applied During QA

Tightened sidebar vertical spacing in `src/renderer/src/styles/app-shell.css`:

- Reduced sidebar padding and gaps.
- Slightly reduced brand and project badge vertical footprint.
- Reduced navigation button vertical padding.

This removed the extra sidebar scroll range at 1440x1000 while keeping all navigation items visible.

## Remaining UI Risks

- Prompt Builder and Characters are still information-heavy and should be the next candidates for progressive disclosure.
- Generation Pipeline inspector behavior should be revisited for wide desktop layouts.
- This pass covered desktop 1440x1000 only. A separate mobile/narrow-window QA pass is still needed.

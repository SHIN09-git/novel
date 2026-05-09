# Testing Guide

This guide describes the lightweight validation flow for Novel Director before public preview releases.

All story content used here is synthetic test data. The fixture title `Fog City Test Draft` / `《雾城测试稿》`, all character names, and all plot fragments are fictional examples. Do not use customer manuscripts, private drafts, or real API keys in public fixtures, screenshots, issue reports, or test artifacts.

## Required Commands

Run these before a release or pull request:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Generate the regression fixture:

```bash
npm.cmd run rc:fixture
```

The fixture is written to:

```text
tmp/rc-regression/novel-director-data.json
```

## Five-Chapter Trial Flow

Use a small synthetic project to exercise the whole loop:

1. Create a project such as `Fog City Test Draft`.
2. Fill in the story bible.
3. Create three key characters: protagonist, ally, antagonist.
4. Create at least five foreshadowing entries:
   - low weight
   - high weight
   - payoff weight
   - one expected around chapter 5
   - one hidden or paused item
5. Create chapters 1-3.
6. Create a stage summary for chapters 1-3.
7. Use Prompt Builder for chapter 4.
8. Send a context snapshot to the Generation Pipeline.
9. Generate or simulate a chapter draft.
10. Review consistency, quality gate, novelty audit, and run trace.
11. Revise the draft in Revision Workbench.
12. Accept a revision and confirm a `ChapterVersion` is saved.
13. Export the current chapter and all chapters.
14. Test data path migration or merge on disposable fixture data only.

## Chapter Checks

For each generated chapter, verify:

- The opening continues from the previous chapter when a continuity bridge exists.
- Character hard states are respected: location, injury, inventory, knowledge, promises, resources, ability limits.
- Foreshadowing treatment modes are followed: hidden, pause, hint, advance, mislead, payoff.
- No unapproved rescue rule, named character, organization tier, or major lore reveal is introduced.
- Long-term memory candidates remain pending until explicitly accepted.
- Quality gate and consistency issues can enter revision.
- Run Trace explains selected context, forced context blocks, compression records, prompt block order, and novelty audit.

## Data Safety Checks

Use only disposable copies for destructive tests.

1. Confirm the app can load existing data.
2. Change the data path.
3. If the destination already contains data, test merge preview before confirming.
4. Confirm backups are created before overwrite or merge.
5. Corrupt a disposable JSON copy and confirm a `.corrupt.<timestamp>.json` backup is created.
6. Confirm API keys are not persisted in exported or saved AppData JSON.

## Export Checks

In Chapters:

- Copy body.
- Copy title plus body.
- Export current chapter as TXT.
- Export current chapter as Markdown.
- Export all chapters as TXT.
- Export all chapters as Markdown.

Windows-invalid filename characters should be sanitized.

## Pass Criteria

A release candidate should pass when:

- `npm.cmd run typecheck` passes.
- `npm.cmd test` passes.
- `npm.cmd run build` passes.
- Old data can load.
- The app does not white-screen on empty projects or missing optional records.
- AI failures do not write unconfirmed long-term memory.
- Draft acceptance and revision acceptance preserve old chapter versions.
- Export and data-path operations are safe and explicit.

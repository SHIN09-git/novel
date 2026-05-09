# Quickstart

This walkthrough creates a small synthetic fiction project, prepares context, generates a first draft, and revises it. All example names and story fragments are synthetic demo data. If you see `Fog City Test Draft` / `《雾城测试稿》` in fixtures or docs, it is a fictional public test project.

## 1. Start the App

```bash
npm.cmd install
npm.cmd run dev
```

Optional validation:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

## 2. Create a Project

On the home screen, create a project.

Suggested synthetic example:

- Name: `Fog City Echo`
- Genre: urban mystery / weird rules / suspense
- Target readers: long-form suspense readers who enjoy clue control and character tension
- Core emotion: pressure, curiosity, delayed revelation
- Style: restrained, cinematic, concrete details, low exposition

## 3. Fill the Story Bible

Use the Story Bible for stable long-term facts, not chapter-by-chapter notes.

Start with:

- World baseline
- Central premise
- Protagonist desire and fear
- Main conflict
- Rule or power system
- Forbidden tropes
- Narrative tone
- Non-negotiable canon

## 4. Create Characters

Create at least:

- Protagonist
- Ally or love interest
- Antagonist or institutional pressure

Focus on current dramatic state rather than encyclopedia biography. Fill the nine-card template where possible:

- Role function
- Surface goal
- Deep need
- Core fear
- Decision logic
- Abilities and resources
- Weakness and cost
- Relationship tension
- Future hooks

## 5. Add State Ledger Facts

Add a few hard facts that can cause continuity bugs:

- Current location
- Injury or physical condition
- Important inventory
- Known secrets
- Money or resource amount
- Ability limitation

These facts can be selected by the Context Need Planner and included in the prompt as hard constraints.

## 6. Add Foreshadowing

Create two or three foreshadowing entries first. Set a treatment mode:

- `hint`: light signal only
- `advance`: can move forward but not reveal the truth
- `mislead`: can create a false lead
- `payoff`: can reveal or resolve
- `pause`: keep frozen
- `hidden`: do not mention unless forced

For early chapters, prefer `hint` or `pause`. Avoid `payoff` unless the chapter is meant to resolve that clue.

## 7. Build the First Prompt

Open Prompt Builder:

1. Choose target chapter `1`.
2. Choose mode `standard`.
3. Generate or edit the Context Need Plan.
4. Review selected characters, state facts, foreshadowing, and omitted context.
5. Fill the chapter task fields.
6. Generate the final prompt.
7. Save a Prompt Context Snapshot if you want the pipeline to use exactly this context.

## 8. Generate a Draft

Open Generation Pipeline:

1. Choose target chapter `1`.
2. Choose automatic context or a saved Prompt Context Snapshot.
3. Choose conservative or standard mode.
4. Set expected word count and reader emotion.
5. Start generation.

The pipeline shows:

- context planning
- context budget selection
- prompt construction
- chapter plan
- draft
- chapter review
- memory candidates
- consistency review
- quality gate
- run trace

Without an API key, AI calls should fail gracefully or use local templates where implemented.

## 9. Review Before Accepting

Before accepting a draft:

- Read the draft.
- Check quality gate and consistency review.
- Check novelty audit for unapproved new rules, characters, or lore.
- Check Run Trace to confirm what context was actually used.
- Do not accept long-term memory candidates unless they are correct.

## 10. Revise

Open Revision Workbench:

1. Select the chapter or draft.
2. Choose a revision type such as reduce AI tone, strengthen conflict, improve continuity, or reduce redundancy.
3. Generate a revision.
4. Compare original, revised, and diff view.
5. Accept only when satisfied.

Accepting a revision saves the previous chapter body as a `ChapterVersion`.

## 11. Export

In Chapters, you can:

- Copy body.
- Copy title plus body.
- Export one chapter as TXT or Markdown.
- Export all chapters as TXT or Markdown.

Exports are written through Electron IPC, not direct renderer file-system access.

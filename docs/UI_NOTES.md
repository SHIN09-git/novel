# UI Notes

This public note summarizes the intended interface direction without exposing internal audit details.

Novel Director should feel like a calm fiction production console rather than a generic admin panel. The primary interaction pattern is:

1. prepare context,
2. generate or import a draft,
3. inspect risks,
4. revise,
5. accept only the parts the author trusts.

## Design Principles

- Show one primary action per page state.
- Keep draft text, diagnostic reports, and memory updates visually separate.
- Prefer summaries by default and expandable detail for trace/debug information.
- Make context source visible: automatic selection or Prompt Context Snapshot.
- Distinguish drafts from accepted chapters.
- Treat long-term memory writes as high-risk actions that require explicit confirmation.
- Keep Run Trace available but not dominant.

## Key Workspaces

- Dashboard: project status and next action.
- Chapters: writing and chapter review.
- Prompt Builder: context control console.
- Generation Pipeline: execution console.
- Revision Workbench: comparison, diff, and acceptance.
- Settings: local data, API configuration, and import/export.

## Future UI Direction

- Continue simplifying the Generation Pipeline around configuration, current artifact, diagnostics, and trace.
- Improve report grouping so consistency, quality gate, novelty audit, and memory candidates do not compete for attention.
- Add more scoped styles to reduce global CSS coupling.

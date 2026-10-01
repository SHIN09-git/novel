#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot

function check(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  const view = await readFile(join(root, 'src/renderer/src/views/DecisionInboxView.tsx'), 'utf8')
  const editor = await readFile(join(root, 'src/renderer/src/views/inbox/DecisionInboxAmendmentEditor.tsx'), 'utf8')
  const styles = await readFile(join(root, 'src/renderer/src/styles/views/inbox.css'), 'utf8')

  check(view.includes('<DecisionInboxAmendmentEditor'), 'Inbox does not render the amendment editor in the expanded candidate flow.')
  check(view.includes('...(amendment ? { amendment } : {})'), 'Inbox command construction drops a normalized amendment from preview items.')
  check(editor.includes("className=\"inbox-amendment-editor\""), 'Amendment editor lacks a stable CDP selector.')
  check(editor.includes('amendmentPreview.before') && editor.includes('amendmentPreview.after') && editor.includes('categoryLabel(snapshot.category)') && editor.includes('linkedFieldLabels(snapshot.linkedCardFields)'), 'Amendment editor does not render an author-readable before/after preview.')
  check(editor.includes('previewCandidateDecisions(data'), 'Amendment editor does not use the real decision preview.')
  check(editor.includes('stateListItems.map') && editor.includes('key={item.id}'), 'Editable state list does not use stable local item keys.')
  check(!editor.includes('key={`${index}-${item}`}'), 'Editable state list still remounts while typing.')
  check(editor.includes('stateFact.category === \'physical\'') && editor.includes('<textarea rows={3}'), 'Physical/text state values do not use a multiline author field.')
  check(editor.includes("['compressedPlotSummary', '压缩剧情']") && editor.includes("['pacingState', '节奏状态']"), 'Stage summary author fields are missing.')
  check(!editor.includes("['coveredChapterRange', '覆盖章节']") && !editor.includes("['nextStageDirection', '下阶段方向']"), 'Legacy stage summary fields are exposed for editing.')
  check(!editor.includes('JSON 编辑') && !editor.includes('JSON编辑') && !editor.includes('JSON.parse'), 'Editor must not provide a JSON editing control.')
  check(styles.includes('.inbox-amendment-editor') && styles.includes('.inbox-amendment-preview'), 'Inbox styles do not cover the amendment editor and preview.')
  console.log('validate-decision-inbox-amendment-ui: ok')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const stageBoard = await readFile(join(root, 'src/renderer/src/components/pipeline/PipelineStageBoard.tsx'), 'utf8')
const rail = await readFile(join(root, 'src/renderer/src/components/pipeline/PipelineStepRail.tsx'), 'utf8')
const diagnostics = await readFile(join(root, 'src/renderer/src/components/pipeline/PipelineDiagnosticsPanel.tsx'), 'utf8')
const pipelineView = await readFile(join(root, 'src/renderer/src/views/GenerationPipelineView.tsx'), 'utf8')
const consoleView = await readFile(join(root, 'src/renderer/src/views/generation/GenerationPipelineConsole.tsx'), 'utf8')
const styles = await readFile(join(root, 'src/renderer/src/styles/views/generation.css'), 'utf8')

const expectedStages = ['准备上下文', '生成正文', '审稿诊断', '等待决定']
const expectedSteps = [
  'context_need_planning',
  'context_budget_selection',
  'build_context',
  'generate_chapter_plan',
  'context_need_planning_from_plan',
  'context_budget_selection_delta',
  'rebuild_context_with_plan',
  'generate_chapter_draft',
  'generate_chapter_review',
  'propose_character_updates',
  'propose_foreshadowing_updates',
  'consistency_review',
  'quality_gate',
  'await_user_confirmation'
]

for (const title of expectedStages) {
  if (!stageBoard.includes(`title: '${title}'`)) throw new Error(`Missing pipeline stage: ${title}`)
}
for (const step of expectedSteps) {
  if (!stageBoard.includes(`'${step}'`)) throw new Error(`Stage mapping does not include ${step}`)
}
for (const source of [stageBoard, rail]) {
  if (!source.includes('getPipelineNextAction') && source === stageBoard) throw new Error('Missing next-action derivation')
}
if (!rail.includes('<PipelineStageBoard')) throw new Error('Pipeline step rail does not render the stage board')
if (!rail.includes('<details className="pipeline-raw-steps">')) throw new Error('Raw step detail disclosure is missing')
if (!rail.includes('onRetry(job, failedStep.type)')) throw new Error('Retry action was removed')
if (!rail.includes('onSkip(job, failedStep)')) throw new Error('Skip action was removed')
if (!rail.includes('onCancel(job)')) throw new Error('Cancel action was removed')
if (!stageBoard.includes("'ready_for_decision'") || !stageBoard.includes("'accepted'")) {
  throw new Error('Confirmation stage must distinguish a ready decision from an accepted commit')
}
if (!stageBoard.includes('generatedDraftId === draft.id') || !stageBoard.includes('bundle.jobId === draft.jobId')) {
  throw new Error('Accepted stage status must require a commit bound to the current draft and job')
}
if (!consoleView.includes('<PipelineStageDecisionProvider') || !consoleView.includes('chapterCommitBundles={diagnosticsPanel.chapterCommitBundles}')) {
  throw new Error('Decision status must be provided to the stage board from the current pipeline console')
}
if (!pipelineView.includes('getEditorialVerdictForDraft(data, latestDraft.id)') || !pipelineView.includes('editorialVerdict,')) {
  throw new Error('Pipeline view must look up and pass the verdict for the exact current draft')
}
for (const fragment of ['editorialVerdict: EditorialVerdict | null', 'editorialVerdict.summary', 'editorialVerdict.blockers', 'editorialVerdict.advisories', 'actions.slice(0, 3)', 'pipeline-original-reports', '质量报告 JSON', '审稿报告 JSON']) {
  if (!diagnostics.includes(fragment)) throw new Error(`Editorial diagnostics UI is missing: ${fragment}`)
}
for (const selector of ['.pipeline-stage-board', '.pipeline-stage-list', '.pipeline-raw-steps', '.pipeline-editorial-section', '.pipeline-original-reports', '@media (max-width: 620px)']) {
  if (!styles.includes(selector)) throw new Error(`Missing responsive stage UI style: ${selector}`)
}

console.log('Pipeline stage UI validation passed: editorial verdict, decision state, commit binding, original reports, and responsive styles are present.')

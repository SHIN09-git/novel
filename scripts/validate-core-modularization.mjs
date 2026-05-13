#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function pathFromRoot(relativePath) {
  return join(root, relativePath)
}

function read(relativePath) {
  return readFileSync(pathFromRoot(relativePath), 'utf8')
}

function lineCount(relativePath) {
  return read(relativePath).split(/\r?\n/).length
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function assertExists(relativePath) {
  assert(existsSync(pathFromRoot(relativePath)), `Expected ${relativePath} to exist.`)
}

function assertLineLimit(relativePath, maxLines) {
  const lines = lineCount(relativePath)
  assert(lines <= maxLines, `${relativePath} has ${lines} lines; expected <= ${maxLines}.`)
}

function assertIncludes(relativePath, expectedText) {
  const content = read(relativePath)
  assert(content.includes(expectedText), `Expected ${relativePath} to include ${expectedText}.`)
}

function assertDoesNotInclude(relativePath, unexpectedText) {
  const content = read(relativePath)
  assert(!content.includes(unexpectedText), `Expected ${relativePath} not to include ${unexpectedText}.`)
}

const requiredFiles = [
  'src/shared/defaults.ts',
  'src/shared/defaults/index.ts',
  'src/shared/normalizers/index.ts',
  'src/shared/normalizers/appData.ts',
  'src/shared/normalizers/memoryUpdate.ts',
  'src/shared/normalizers/characterState.ts',
  'src/shared/normalizers/foreshadowing.ts',
  'src/shared/normalizers/context.ts',
  'src/shared/normalizers/storyDirection.ts',
  'src/shared/normalizers/reports.ts',
  'src/shared/normalizers/runTrace.ts',
  'src/shared/types.ts',
  'src/shared/types/index.ts',
  'src/shared/types/project.ts',
  'src/shared/types/character.ts',
  'src/shared/types/foreshadowing.ts',
  'src/shared/types/context.ts',
  'src/shared/types/generation.ts',
  'src/shared/types/memory.ts',
  'src/shared/types/quality.ts',
  'src/shared/types/revision.ts',
  'src/shared/types/trace.ts',
  'src/services/promptFormatters/chapterFormatters.ts',
  'src/services/promptFormatters/characterFormatters.ts',
  'src/services/promptFormatters/foreshadowingFormatters.ts',
  'src/services/promptFormatters/promptUtils.ts',
  'src/services/contextBudget/scoringEngine.ts',
  'src/services/contextBudget/selectionEngine.ts',
  'src/services/contextBudget/traceBuilder.ts',
  'src/services/contextBudget/types.ts',
  'src/renderer/src/views/generation/usePipelineRunner.ts',
  'src/renderer/src/views/generation/usePipelineRunnerCore.ts',
  'src/renderer/src/views/generation/pipelineRunnerEngine.ts',
  'src/renderer/src/views/generation/pipelineRunnerTypes.ts',
  'src/renderer/src/views/generation/pipelineSteps/contextPlanning.ts',
  'src/renderer/src/views/generation/pipelineSteps/chapterGeneration.ts',
  'src/renderer/src/views/generation/pipelineSteps/memoryExtraction.ts',
  'src/renderer/src/views/generation/pipelineSteps/qualityCheck.ts',
  'src/renderer/src/views/generation/GenerationPipelineConsole.tsx',
  'src/renderer/src/views/generation/generationPipelineHelpers.ts',
  'src/renderer/src/views/generation/RunTraceAuthorSummaryCard.tsx',
  'src/renderer/src/views/generation/runTraceSummary.ts'
]

for (const file of requiredFiles) {
  assertExists(file)
}

assertLineLimit('src/shared/defaults.ts', 20)
assertLineLimit('src/shared/types.ts', 20)
assertLineLimit('src/services/PromptBuilderService.ts', 450)
assertLineLimit('src/services/ContextBudgetManager.ts', 320)
assertLineLimit('src/renderer/src/views/generation/usePipelineRunner.ts', 20)
assertLineLimit('src/renderer/src/views/generation/usePipelineRunnerCore.ts', 350)
assertLineLimit('src/renderer/src/views/generation/pipelineRunnerEngine.ts', 260)
assertLineLimit('src/renderer/src/views/generation/pipelineSteps/contextPlanning.ts', 320)
assertLineLimit('src/renderer/src/views/generation/pipelineSteps/chapterGeneration.ts', 400)
assertLineLimit('src/renderer/src/views/generation/pipelineSteps/memoryExtraction.ts', 260)
assertLineLimit('src/renderer/src/views/generation/pipelineSteps/qualityCheck.ts', 140)
assertLineLimit('src/renderer/src/views/generation/RunTracePanel.tsx', 320)

assertIncludes('src/shared/defaults.ts', "export * from './defaults/index'")
assertIncludes('src/shared/defaults.ts', "export * from './normalizers'")
assertIncludes('src/shared/types.ts', "export * from './types/index'")
assertIncludes('src/renderer/src/views/generation/usePipelineRunner.ts', "export { usePipelineRunner } from './usePipelineRunnerCore'")
assertIncludes('src/renderer/src/views/generation/usePipelineRunner.ts', "export { PIPELINE_STEP_LABELS, PIPELINE_STEP_ORDER } from './pipelineUtils'")
assertIncludes('src/renderer/src/views/generation/usePipelineRunnerCore.ts', "from './pipelineRunnerEngine'")
assertIncludes('src/renderer/src/views/generation/pipelineRunnerEngine.ts', "from './pipelineSteps/contextPlanning'")
assertIncludes('src/renderer/src/views/generation/pipelineRunnerEngine.ts', "from './pipelineSteps/chapterGeneration'")
assertIncludes('src/renderer/src/views/generation/pipelineRunnerEngine.ts', "from './pipelineSteps/memoryExtraction'")
assertIncludes('src/renderer/src/views/generation/pipelineRunnerEngine.ts', "from './pipelineSteps/qualityCheck'")
assertIncludes('src/renderer/src/views/GenerationPipelineView.tsx', "from './generation/GenerationPipelineConsole'")
assertIncludes('src/renderer/src/views/GenerationPipelineView.tsx', "from './generation/generationPipelineHelpers'")
assertIncludes('src/renderer/src/views/generation/RunTracePanel.tsx', "from './RunTraceAuthorSummaryCard'")
assertIncludes('src/renderer/src/views/generation/RunTracePanel.tsx', "from './runTraceSummary'")

assertIncludes('src/services/PromptBuilderService.ts', "from './promptFormatters/chapterFormatters'")
assertIncludes('src/services/PromptBuilderService.ts', "from './promptFormatters/characterFormatters'")
assertIncludes('src/services/PromptBuilderService.ts', "from './promptFormatters/foreshadowingFormatters'")
assertIncludes('src/services/ContextBudgetManager.ts', "from './contextBudget/scoringEngine'")
assertIncludes('src/services/ContextBudgetManager.ts', "from './contextBudget/selectionEngine'")
assertIncludes('src/services/ContextBudgetManager.ts', "from './contextBudget/traceBuilder'")

assertDoesNotInclude('src/renderer/src/views/generation/usePipelineRunner.ts', 'runPipelineFromStep')
assertIncludes('src/main/services/AIService.ts', 'AITransportService')
assertIncludes('src/services/AIService.ts', 'AIWorkflowService')

console.log('Core modularization validation passed.')

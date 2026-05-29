import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const runnerCore = read('src/renderer/src/views/generation/usePipelineRunnerCore.ts')
const runnerEngine = read('src/renderer/src/views/generation/pipelineRunnerEngine.ts')
const generationView = read('src/renderer/src/views/GenerationPipelineView.tsx')
const revisionCandidateContext = read('src/renderer/src/views/generation/revisionCandidateContext.ts')
const qualityStep = read('src/renderer/src/views/generation/pipelineSteps/qualityCheck.ts')
const chapterStep = read('src/renderer/src/views/generation/pipelineSteps/chapterGeneration.ts')
const promptHygieneTest = read('scripts/validate-writing-prompt-hygiene.mjs')
const runTests = read('scripts/run-tests.mjs')

for (const heavyImport of [
  'QualityGateService',
  'NoveltyDetector',
  'RedundancyService',
  'ContextBudgetManager',
  'PromptBuilderService',
  'ContextNeedPlannerService',
  'PlanContextGapAnalyzerService'
]) {
  assert(!runnerCore.includes(heavyImport), `usePipelineRunnerCore should not import heavy AI/prompt service: ${heavyImport}`)
}

for (const staticStepImport of [
  "from './pipelineSteps/contextPlanning'",
  "from './pipelineSteps/chapterGeneration'",
  "from './pipelineSteps/memoryExtraction'",
  "from './pipelineSteps/qualityCheck'"
]) {
  assert(!runnerEngine.includes(staticStepImport), `pipelineRunnerEngine should not statically import step module: ${staticStepImport}`)
}

for (const dynamicStepImport of [
  "import('./pipelineSteps/contextPlanning')",
  "import('./pipelineSteps/chapterGeneration')",
  "import('./pipelineSteps/memoryExtraction')",
  "import('./pipelineSteps/qualityCheck')"
]) {
  assert(runnerEngine.includes(dynamicStepImport), `pipelineRunnerEngine should lazy-load step module: ${dynamicStepImport}`)
}

assert(!generationView.includes("from '../utils/promptContext'"), 'GenerationPipelineView should not statically import prompt context builders')
assert(!generationView.includes('buildPipelineContextFromSelection'), 'GenerationPipelineView should not inline revision context rebuild logic')
assert(
  generationView.includes("import('./generation/revisionCandidateContext')"),
  'GenerationPipelineView should lazy-load revision candidate context rebuild logic'
)
assert(
  revisionCandidateContext.includes('buildPipelineContextFromSelection') &&
    revisionCandidateContext.includes('selectBudgetContext') &&
    revisionCandidateContext.includes('createContextBudgetProfile'),
  'revision candidate context rebuild logic lives in the lazy helper module'
)

assert(qualityStep.includes('evaluateQualityGateDiagnostic'), 'quality gate evaluation is requested through diagnostics API')
assert(qualityStep.includes('auditNoveltyDiagnostic'), 'quality step receives novelty audit through diagnostics API')
assert(!qualityStep.includes('QualityGateService') && !qualityStep.includes('NoveltyDetector'), 'quality step does not statically import local diagnostic services')
assert(chapterStep.includes('auditNoveltyDiagnostic'), 'draft novelty audit is requested through diagnostics API')
assert(chapterStep.includes('analyzeRedundancyDiagnostic'), 'draft redundancy report is requested through diagnostics API')
assert(!chapterStep.includes('NoveltyDetector') && !chapterStep.includes('RedundancyService'), 'chapter generation step does not statically import local diagnostic services')
assert(promptHygieneTest.includes('placeholder text'), 'prompt hygiene regression keeps placeholder text out of writing prompt')
assert(promptHygieneTest.includes('duplicate English guardrails'), 'prompt hygiene regression keeps duplicate guardrails out of writing prompt')
assert(runTests.includes('validate-ai-workflow-prompt-boundaries.mjs'), 'npm test runs AI workflow/prompt boundary validation')

console.log('validate-ai-workflow-prompt-boundaries: ok')

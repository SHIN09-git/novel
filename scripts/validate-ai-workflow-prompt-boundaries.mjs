import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const runnerCore = read('src/renderer/src/views/generation/usePipelineRunnerCore.ts')
const runnerEngine = read('src/renderer/src/views/generation/pipelineRunnerEngine.ts')
const generationView = read('src/renderer/src/views/GenerationPipelineView.tsx')
const revisionActions = read('src/renderer/src/views/generation/usePipelineRevisionActions.ts')
const revisionActionHandlers = read('src/renderer/src/views/generation/pipelineRevisionActionHandlers.ts')
const draftAcceptance = read('src/renderer/src/views/generation/useDraftAcceptance.ts')
const memoryCandidates = read('src/renderer/src/views/generation/useMemoryCandidates.ts')
const traceActions = read('src/renderer/src/views/generation/usePipelineTraceActions.ts')
const revisionCandidateContext = read('src/renderer/src/views/generation/revisionCandidateContext.ts')
const qualityStep = read('src/renderer/src/views/generation/pipelineSteps/qualityCheck.ts')
const consistencyStep = read('src/renderer/src/views/generation/pipelineSteps/consistencyReview.ts')
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
assert(runnerCore.includes("import('./pipelineRunnerEngine')"), 'usePipelineRunnerCore should lazy-load the pipeline engine only when a run starts.')
assert(!runnerCore.includes("from './pipelineRunnerEngine'"), 'usePipelineRunnerCore should not pull the pipeline engine into the initial pipeline view chunk.')
assert(runnerCore.includes("import('../../../../services/GenerationRunBundleService')"), 'pipeline persistence should lazy-load GenerationRunBundleService.')
assert(!runnerCore.includes("from '../../../../services/GenerationRunBundleService'"), 'GenerationRunBundleService should not enter the initial pipeline view chunk.')
assert(/await import\(\s*['"]\.\.\/\.\.\/\.\.\/\.\.\/services\/ChapterCommitBundleService['"]\s*\)/.test(draftAcceptance), 'draft acceptance should lazy-load ChapterCommitBundleService.')
assert(!draftAcceptance.includes("from '../../../../services/ChapterCommitBundleService'"), 'ChapterCommitBundleService should load only when a draft is accepted.')
assert(memoryCandidates.includes("import('./memoryCandidateActions')"), 'memory candidate mutations should lazy-load their action implementation.')
assert(
  !memoryCandidates.split(/\r?\n/).some((line) => line.includes("from './memoryCandidateActions'") && !line.trimStart().startsWith('import type ')),
  'memory candidate action runtime should not be statically imported.'
)
assert(/await import\(\s*['"]\.\.\/\.\.\/\.\.\/\.\.\/services\/RunTraceAuthorSummaryService['"]\s*\)/.test(traceActions), 'author diagnosis generation should lazy-load RunTraceAuthorSummaryService.')
assert(!traceActions.includes("from '../../../../services/RunTraceAuthorSummaryService'"), 'RunTraceAuthorSummaryService should not enter the initial pipeline view chunk.')

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
  "import('./pipelineSteps/consistencyReview')",
  "import('./pipelineSteps/qualityCheck')"
]) {
  assert(runnerEngine.includes(dynamicStepImport), `pipelineRunnerEngine should lazy-load step module: ${dynamicStepImport}`)
}

assert(!generationView.includes("from '../utils/promptContext'"), 'GenerationPipelineView should not statically import prompt context builders')
assert(!generationView.includes('buildPipelineContextFromSelection'), 'GenerationPipelineView should not inline revision context rebuild logic')
assert(
  generationView.includes('usePipelineRevisionActions') && !generationView.includes('revisionCandidateContext'),
  'GenerationPipelineView should delegate revision candidate context rebuild logic to a lightweight action hook'
)
assert(
  revisionActions.includes("import('./pipelineRevisionActionHandlers')") &&
    revisionActionHandlers.includes("import('./revisionCandidateContext')"),
  'usePipelineRevisionActions should lazy-load action handlers, which lazy-load revision candidate context rebuild logic'
)
assert(
  !revisionActions
    .split(/\r?\n/)
    .some(
      (line) =>
        line.includes("from './pipelineRevisionActionHandlers'") &&
        !line.trimStart().startsWith('import type ')
    ),
  'pipeline revision action implementation should not be statically imported.'
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
assert(
  consistencyStep.includes("await env.getAiService('reviewer')"),
  'strict/custom consistency review resolves its reviewer-role AI service lazily'
)
assert(chapterStep.includes('auditNoveltyDiagnostic'), 'draft novelty audit is requested through diagnostics API')
assert(chapterStep.includes('analyzeRedundancyDiagnostic'), 'draft redundancy report is requested through diagnostics API')
assert(!chapterStep.includes('NoveltyDetector') && !chapterStep.includes('RedundancyService'), 'chapter generation step does not statically import local diagnostic services')
assert(promptHygieneTest.includes('placeholder text'), 'prompt hygiene regression keeps placeholder text out of writing prompt')
assert(promptHygieneTest.includes('duplicate English guardrails'), 'prompt hygiene regression keeps duplicate guardrails out of writing prompt')
assert(runTests.includes('validate-ai-workflow-prompt-boundaries.mjs'), 'npm test runs AI workflow/prompt boundary validation')

console.log('validate-ai-workflow-prompt-boundaries: ok')

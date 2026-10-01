import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function loadTypeScriptModule(relativePath) {
  const source = await readFile(join(root, relativePath), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022
    },
    fileName: relativePath
  }).outputText
  const url = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
  return import(url)
}

async function loadBundledTypeScriptModule(relativePath) {
  const result = await build({
    entryPoints: [join(root, relativePath)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent'
  })
  const compiled = result.outputFiles[0]?.text
  if (!compiled) throw new Error(`Unable to bundle ${relativePath}`)
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

const stepTypes = [
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

const [
  { PipelineRecipeService },
  normalizers,
  appDataNormalizers,
  { AgentRunService },
  typesSource,
  appDataNormalizerSource,
  rendererRunnerSource,
  agentRunSource,
  agentExecutorSource,
  runTraceSource,
  pipelineEngineSource,
  pipelineStateRestoreSource,
  pipelineUtilsSource,
  agentContentReadersSource
] = await Promise.all([
  loadTypeScriptModule('src/services/PipelineRecipeService.ts'),
  loadBundledTypeScriptModule('src/shared/normalizers/generation.ts'),
  loadBundledTypeScriptModule('src/shared/normalizers/appData.ts'),
  loadBundledTypeScriptModule('src/agent/AgentRunService.ts'),
  readFile(join(root, 'src/shared/types/generation.ts'), 'utf8'),
  readFile(join(root, 'src/shared/normalizers/appData.ts'), 'utf8'),
  readFile(join(root, 'src/renderer/src/views/generation/usePipelineRunnerCore.ts'), 'utf8'),
  readFile(join(root, 'src/agent/AgentRunService.ts'), 'utf8'),
  readFile(join(root, 'src/agent/AgentPipelineExecutor.ts'), 'utf8'),
  readFile(join(root, 'src/renderer/src/utils/runTrace.ts'), 'utf8'),
  readFile(join(root, 'src/renderer/src/views/generation/pipelineRunnerEngine.ts'), 'utf8'),
  readFile(join(root, 'src/renderer/src/views/generation/pipelineStateRestore.ts'), 'utf8'),
  readFile(join(root, 'src/renderer/src/views/generation/pipelineUtils.ts'), 'utf8'),
  readFile(join(root, 'src/agent/agentContentReaders.ts'), 'utf8')
])

for (const id of ['fast', 'standard', 'strict', 'custom']) {
  const recipe = PipelineRecipeService.getDefaultRecipe(id)
  assert(recipe.id === id, `${id} recipe must preserve its id`)
  assert(recipe.version === 1, `${id} recipe must use schema version 1`)
  assert(recipe.steps.length === 14, `${id} recipe must describe all 14 existing steps`)
  assert(new Set(recipe.steps.map((step) => step.type)).size === 14, `${id} recipe step types must be unique`)
  assert(stepTypes.every((type) => recipe.steps.some((step) => step.type === type)), `${id} recipe must retain every step type`)
}

assert(PipelineRecipeService.resolveRecipe('aggressive').id === 'fast', 'legacy aggressive mode must map to fast')
assert(PipelineRecipeService.resolveRecipe('standard').id === 'standard', 'legacy standard mode must map to standard')
assert(PipelineRecipeService.resolveRecipe('conservative').id === 'strict', 'legacy conservative mode must map to strict')
assert(PipelineRecipeService.resolveRecipe(undefined, 'conservative').id === 'strict', 'missing recipe must fall back through legacy mode')

const mutableDefault = PipelineRecipeService.getDefaultRecipe('standard')
const independentDefault = PipelineRecipeService.getDefaultRecipe('standard')
mutableDefault.steps[0].enabled = false
assert(independentDefault.steps[0].enabled, 'default recipe instances must not share mutable step objects')

const fast = PipelineRecipeService.getDefaultRecipe('fast')
assert(PipelineRecipeService.shouldRunStep(fast, 'generate_chapter_draft'), 'fast recipe must run chapter drafting')
assert(PipelineRecipeService.shouldRunStep(fast, 'context_need_planning_from_plan'), 'fast recipe must retain plan-derived context planning')
assert(PipelineRecipeService.shouldRunStep(fast, 'context_budget_selection_delta'), 'fast recipe must retain plan-derived budget selection')
assert(PipelineRecipeService.shouldRunStep(fast, 'rebuild_context_with_plan'), 'fast recipe must retain plan-derived context rebuild')
const fastSecondContextSteps = [
  'context_need_planning_from_plan',
  'context_budget_selection_delta',
  'rebuild_context_with_plan'
]
assert(fastSecondContextSteps.every((type) => {
  const step = fast.steps.find((item) => item.type === type)
  return step?.enabled && step.required && step.escalation === 'never'
}), 'fast recipe must always run all three required plan-derived context completion steps')
assert(fast.description.includes('包括基于章节计划的二次上下文补全'),
  'fast description must identify second context completion as normal core execution')
assert(fast.description.includes('章节复盘、候选提取和一致性复审仅在出现风险信号时升级执行'),
  'fast description must limit risk escalation wording to the four advisory steps')
assert(PipelineRecipeService.shouldRunStep(fast, 'quality_gate'), 'fast recipe must retain the hard quality gate')
assert(PipelineRecipeService.shouldRunStep(fast, 'await_user_confirmation'), 'fast recipe must retain author confirmation')
assert(!PipelineRecipeService.shouldRunStep(fast, 'consistency_review'), 'fast recipe must not run consistency review without a signal')
assert(PipelineRecipeService.shouldRunStep(fast, 'consistency_review', 'warning'), 'fast recipe must escalate consistency review on warning')
const fastPlan = PipelineRecipeService.resolveExecutionPlan(fast)
const fastSkipped = fastPlan.steps.filter((step) => !step.run).map((step) => step.type)
assert(
  JSON.stringify(fastSkipped) === JSON.stringify([
    'generate_chapter_review',
    'propose_character_updates',
    'propose_foreshadowing_updates',
    'consistency_review'
  ]),
  'fast recipe may skip only the four explicit post-draft advisory steps'
)
assert(fastPlan.steps.filter((step) => step.run).length === 10, 'fast recipe must keep the ten non-advisory steps enabled')
const fastExplanation = PipelineRecipeService.explainRecipe(fast)
assert(fastExplanation.includes(fast.description), 'fast explanation must retain the behavior-accurate recipe description')
assert(fastSecondContextSteps.every((type) => !fastExplanation.match(new RegExp(`风险升级步骤：[^。]*${type}`))),
  'fast explanation must not list required second context completion as risk escalation')
assert(PipelineRecipeService.getDefaultRecipe('strict').steps.every((step) => step.enabled && step.required), 'strict recipe must require all steps')

const custom = PipelineRecipeService.resolveRecipe({
  ...PipelineRecipeService.getDefaultRecipe('custom'),
  name: '仅改一项',
  steps: [{ type: 'consistency_review', enabled: false, required: false, escalation: 'on_failure' }]
})
assert(custom.steps.length === 1, 'custom recipes must execute only their frozen recipe.steps allow-list')
assert(!PipelineRecipeService.shouldRunStep(custom, 'context_need_planning'), 'omitted custom steps must be skipped')
assert(PipelineRecipeService.shouldRunStep(custom, 'consistency_review', 'failure'), 'custom escalation must still react to failures')
assert(!PipelineRecipeService.shouldRunStep(custom, 'consistency_review', 'warning'), 'on_failure escalation must ignore warnings')
assert(PipelineRecipeService.explainRecipe(fast).includes('14'), 'recipe explanation must summarize the complete step contract')

const omittedDecision = PipelineRecipeService.resolveStepExecution(custom, 'context_need_planning')
assert(omittedDecision.skipReason?.code === 'recipe_step_omitted', 'omitted custom steps must expose a structured skip reason')
const serializedSkip = PipelineRecipeService.serializeSkipOutput(omittedDecision)
assert(JSON.parse(serializedSkip).kind === 'pipeline_recipe_step_skipped', 'recipe skips must be serializable step output')
assert(JSON.parse(serializedSkip).code === 'recipe_step_omitted', 'serialized recipe skips must retain the reason code')
assert(PipelineRecipeService.isSkipOutput(serializedSkip), 'serialized skip output must be recognized during resume')
assert(PipelineRecipeService.parseSkipOutput(serializedSkip)?.stepType === 'context_need_planning', 'parsed skip output must retain its step type')
assert(!PipelineRecipeService.isSkipOutput('{"finalPrompt":"real context"}'), 'real context output must not be mistaken for a recipe skip')
assert(PipelineRecipeService.parseSkipOutput('{"kind":"pipeline_recipe_step_skipped"}') === null, 'malformed skip payloads must not be trusted')
assert(PipelineRecipeService.explainRecipe(custom, 'standard', { recipe: custom, steps: [omittedDecision] }).includes('recipe_step_omitted'), 'trace explanation must retain the structured skip code')

const customInput = {
  ...PipelineRecipeService.getDefaultRecipe('custom'),
  steps: [{ type: 'quality_gate', enabled: true, required: true, escalation: 'on_warning' }]
}
const resolvedCustom = PipelineRecipeService.resolveRecipe(customInput)
const resolvedQualityStep = resolvedCustom.steps.find((step) => step.type === 'quality_gate')
resolvedQualityStep.enabled = false
assert(customInput.steps.length === 1, 'resolving a custom recipe must not append steps to the caller input')
assert(customInput.steps[0].type === 'quality_gate' && customInput.steps[0].enabled, 'resolving a recipe must not rewrite caller-owned steps')

const frozenStrict = PipelineRecipeService.getDefaultRecipe('strict')
const preservedRun = PipelineRecipeService.resolveRunConfiguration({
  recipe: frozenStrict,
  recipeId: 'strict',
  storedMode: 'conservative',
  fallbackMode: 'standard'
})
assert(preservedRun.pipelineMode === 'conservative' && preservedRun.pipelineRecipe.id === 'strict', 'ordinary retries must preserve frozen mode and recipe')
const explicitModeRun = PipelineRecipeService.resolveRunConfiguration({
  recipe: frozenStrict,
  recipeId: 'strict',
  storedMode: 'conservative',
  requestedMode: 'aggressive',
  fallbackMode: 'standard'
})
assert(explicitModeRun.pipelineMode === 'aggressive' && explicitModeRun.pipelineRecipe.id === 'fast', 'an explicit retry mode must replace the frozen legacy recipe')
assert(frozenStrict.id === 'strict' && frozenStrict.steps.every((step) => step.enabled), 'retry resolution must not mutate the frozen job recipe object')

const legacyReference = normalizers.normalizePipelineRecipeReference({}, 'aggressive')
assert(legacyReference.pipelineRecipeId === 'fast', 'old jobs without recipe fields must normalize via legacy mode')
assert(legacyReference.pipelineRecipeVersion === 1, 'old jobs must receive the current recipe version reference')
assert(legacyReference.pipelineRecipe === null, 'normalization must not invent a persisted recipe for old jobs')

const normalizedRecipe = normalizers.normalizePipelineRecipe({
  id: 'custom',
  version: 99,
  name: '  我的配方  ',
  steps: [{ type: 'quality_gate', enabled: true, required: true, escalation: 'invalid' }]
})
assert(normalizedRecipe?.version === 1, 'unknown recipe versions must normalize to the compatible current version')
assert(normalizedRecipe?.name === '我的配方', 'recipe labels must be normalized')
assert(normalizedRecipe?.steps[0]?.escalation === 'never', 'invalid escalation policies must normalize safely')

const duplicateSteps = normalizers.normalizePipelineRecipe({
  id: 'custom',
  version: 1,
  name: '',
  steps: [
    { type: 'quality_gate', enabled: false, required: false, escalation: 'never' },
    { type: 'quality_gate', enabled: true, required: true, escalation: 'on_warning' }
  ]
})
assert(duplicateSteps?.name === '自定义流水线配方', 'normalized recipes must use an id-consistent fallback name')
assert(duplicateSteps?.steps.length === 1 && duplicateSteps.steps[0].enabled, 'normalization must deterministically deduplicate step definitions')

const oldJob = {
  id: 'old-aggressive-job',
  projectId: 'project-1',
  targetChapterOrder: 8,
  contextSource: 'auto',
  status: 'failed',
  currentStep: 'generate_chapter_draft',
  pipelineRecipeId: 'standard',
  pipelineRecipeVersion: 1,
  pipelineRecipe: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  errorMessage: ''
}
const oldData = appDataNormalizers.normalizeAppData({
  chapterGenerationJobs: [oldJob],
  chapterGenerationSteps: [
    {
      id: 'old-step',
      jobId: oldJob.id,
      type: 'generate_chapter_draft',
      status: 'failed',
      inputSnapshot: JSON.stringify({ pipelineMode: 'aggressive' }),
      output: '',
      errorMessage: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z'
    }
  ]
})
const normalizedOldJob = oldData.chapterGenerationJobs[0]
assert(normalizedOldJob.pipelineMode === 'aggressive', 'old jobs must recover their legacy mode from persisted step input')
assert(normalizedOldJob.pipelineRecipeId === 'fast', 'recovered legacy mode must replace an earlier synthetic standard recipe reference')
assert(normalizedOldJob.pipelineRecipe === null, 'old jobs must remain compatible without inventing a historical recipe snapshot')

const baseAgentData = appDataNormalizers.normalizeAppData({
  projects: [{
    id: 'project-1',
    name: 'Recipe fixture',
    genre: '',
    description: '',
    targetReaders: '',
    coreAppeal: '',
    style: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }]
})
const conservativeAgentJob = AgentRunService.prepareSingleChapterRun({
  appData: baseAgentData,
  projectId: 'project-1',
  targetChapterOrder: 1,
  safetyMode: 'conservative'
}).job
assert(conservativeAgentJob.pipelineMode === 'conservative' && conservativeAgentJob.pipelineRecipeId === 'strict', 'conservative Agent jobs must freeze the strict recipe')
const experimentalAgentJob = AgentRunService.prepareSingleChapterRun({
  appData: baseAgentData,
  projectId: 'project-1',
  targetChapterOrder: 1,
  safetyMode: 'experimental'
}).job
assert(experimentalAgentJob.pipelineMode === 'aggressive' && experimentalAgentJob.pipelineRecipeId === 'fast', 'experimental Agent jobs must freeze the fast recipe')

assert(typesSource.includes("export type PipelineRecipeId = 'fast' | 'standard' | 'strict' | 'custom'"), 'PipelineRecipeId type is missing')
assert(typesSource.includes('pipelineRecipe?: PipelineRecipe | null'), 'generation jobs must accept an optional persisted recipe')
assert(typesSource.includes('pipelineMode?: PipelineMode | null'), 'generation jobs must preserve the legacy mode alongside the recipe snapshot')
assert(appDataNormalizerSource.includes('normalizePipelineRecipeReference(job, pipelineMode)'), 'AppData normalization must restore pipeline recipe references with the recovered mode')
assert(appDataNormalizerSource.includes('legacyPipelineModeForJob'), 'AppData normalization must recover old modes from step snapshots')
assert(rendererRunnerSource.includes('pipelineRecipeId: pipelineRecipe.id'), 'renderer-created jobs must freeze the selected recipe id')
assert(rendererRunnerSource.includes('pipelineMode,'), 'renderer-created jobs must freeze the selected legacy mode')
assert(rendererRunnerSource.includes('pipelineRecipeVersion: pipelineRecipe.version'), 'renderer-created jobs must freeze the selected recipe version')
assert(agentRunSource.includes('pipelineRecipeId: pipelineRecipe.id'), 'agent-created jobs must freeze the selected recipe id')
assert(agentExecutorSource.includes('PipelineRecipeService.resolveRunConfiguration'), 'agent retries must resolve frozen and explicitly requested modes through one compatibility rule')
assert(agentExecutorSource.includes('requestedMode: input.pipelineMode'), 'agent retries must treat an explicit mode as an override')
assert(agentExecutorSource.includes('PipelineRecipeService.resolveExecutionPlan'), 'Agent resume selection must use the shared executable recipe parser')
assert(pipelineEngineSource.includes('PipelineRecipeService.resolveStepExecution'), 'renderer execution must use the shared executable recipe parser')
assert(pipelineEngineSource.includes('PipelineRecipeService.serializeSkipOutput'), 'recipe skips must be recorded as structured step output')
assert(pipelineStateRestoreSource.includes("item.status === 'completed'"), 'resume must only restore completed step artifacts')
assert(pipelineStateRestoreSource.includes('PipelineRecipeService.isSkipOutput(step.output)'), 'resume must reject structured skip output as a real artifact')
assert(pipelineUtilsSource.includes('if (PipelineRecipeService.isSkipOutput(output)) return'), 'context restoration must reject skip payloads')
assert(agentContentReadersSource.includes("step.status === 'completed'"), 'Agent prompt reads must only use completed context artifacts')
assert(agentContentReadersSource.includes('!PipelineRecipeService.isSkipOutput(step.output)'), 'Agent prompt reads must ignore recipe skip payloads')
assert(pipelineEngineSource.includes('PipelineRecipeService.explainRecipe(resolvedRecipe, legacyMode'), 'recipe skip reasons must reach the run trace explanation')
assert(runTraceSource.includes('pipelineRecipeExplanation: PipelineRecipeService.explainRecipe'), 'run traces must explain the actual pipeline recipe')

console.log('validate-pipeline-recipes: all checks passed')

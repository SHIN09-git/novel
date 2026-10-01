import type {
  AppData,
  ChapterGenerationStepType,
  ID
} from '../../../../shared/types'
import { StoryDirectionService } from '../../../../services/StoryDirectionService'
import { createContextBudgetProfile } from '../../utils/contextBudgetProfile'
import { normalizePipelineOptions, serializeOutput } from './pipelineRuntimeBasics'
import { PIPELINE_STEP_ORDER } from './pipelineStepDefinitions'
import { enforceOpeningChapterSnapshotPolicy } from '../../../../services/OpeningChapterSnapshotPolicy'
import { PipelineRecipeService } from '../../../../services/PipelineRecipeService'
import { upsertGenerationRunTrace } from '../../utils/runTrace'
import { restorePipelineStateFromCompletedSteps } from './pipelineStateRestore'
import type {
  PipelineRunOptions,
  PipelineRunnerState,
  PipelineStepHandlerContext,
  RunPipelineFromStepEngineEnv
} from './pipelineRunnerTypes'
export async function runPipelineFromStepEngine(
  initialData: AppData,
  jobId: ID,
  fromStep: ChapterGenerationStepType,
  inputOptions: PipelineRunOptions,
  env: RunPipelineFromStepEngineEnv
) {
  const { project, targetChapterOrder, pipelineMode, estimatedWordCount, readerEmotionTarget, budgetMode, budgetMaxTokens, persistWorking, updateStepInData } =
    env
  const storedJob = initialData.chapterGenerationJobs.find((item) => item.id === jobId)
  if (!storedJob) return initialData
  const openingSnapshotPolicy = enforceOpeningChapterSnapshotPolicy(storedJob)
  const job = openingSnapshotPolicy.job
  const effectiveInitialData = openingSnapshotPolicy.mustRebuildFromStart
    ? {
        ...initialData,
        chapterGenerationJobs: initialData.chapterGenerationJobs.map((item) => item.id === job.id ? job : item)
      }
    : initialData
  const options = normalizePipelineOptions(inputOptions, {
    targetChapterOrder: job.targetChapterOrder ?? targetChapterOrder,
    pipelineMode,
    estimatedWordCount,
    readerEmotionTarget,
    budgetMode,
    budgetMaxTokens
  })
  const snapshot =
    job.contextSource === 'prompt_snapshot' && job.promptContextSnapshotId
      ? effectiveInitialData.promptContextSnapshots.find((item) => item.id === job.promptContextSnapshotId) ?? null
      : null
  const activeStoryDirectionGuide =
    job.contextSource === 'prompt_snapshot' || job.chapterTaskSnapshot
      ? null
      : StoryDirectionService.getActiveGuideForChapter(effectiveInitialData.storyDirectionGuides ?? [], project.id, options.targetChapterOrder)
  const activeStoryDirectionBeat = activeStoryDirectionGuide
    ? StoryDirectionService.getBeatForChapter(activeStoryDirectionGuide, options.targetChapterOrder)
    : null
  const storyDirectionTracePatch = {
    storyDirectionGuideId: activeStoryDirectionGuide?.id ?? null,
    storyDirectionGuideSource: activeStoryDirectionGuide?.source ?? null,
    storyDirectionGuideHorizon: activeStoryDirectionGuide?.horizonChapters ?? null,
    storyDirectionGuideStartChapterOrder: activeStoryDirectionGuide?.startChapterOrder ?? null,
    storyDirectionGuideEndChapterOrder: activeStoryDirectionGuide?.endChapterOrder ?? null,
    storyDirectionBeatId: activeStoryDirectionBeat?.id ?? null,
    storyDirectionAppliedToChapterTask: Boolean(activeStoryDirectionGuide)
  }
  const state: PipelineRunnerState = {
    working: effectiveInitialData,
    context: '',
    plan: null,
    draftResult: null,
    noveltyAuditResult: null,
    planGapAnalysis: null,
    contextNeedPlanFromPlan: null,
    rebuiltContextFromPlan: false,
    draftRecord: null,
    contextNeedPlan: snapshot?.contextNeedPlan ?? null,
    budgetProfile: createContextBudgetProfile(project.id, options.budgetMode, options.budgetMaxTokens, `第 ${options.targetChapterOrder} 章流水线预算`),
    budgetSelection: null,
    recipeSkipReasons: []
  }
  const steps = state.working.chapterGenerationSteps.filter((step) => step.jobId === jobId)
  restorePipelineStateFromCompletedSteps(state, steps, snapshot !== null, job.contextSource !== 'prompt_snapshot')
  const recipeInput = job.pipelineRecipe ?? job.pipelineRecipeId ?? job.pipelineMode
  const legacyMode = job.pipelineMode ?? pipelineMode
  const resolvedRecipe = PipelineRecipeService.resolveRecipe(recipeInput, legacyMode)
  const effectiveFromStep = openingSnapshotPolicy.mustRebuildFromStart ? 'context_need_planning' : fromStep
  if (!PIPELINE_STEP_ORDER.includes(effectiveFromStep)) {
    throw new Error(`不支持的流水线步骤：${fromStep}`)
  }
  for (const type of PIPELINE_STEP_ORDER.slice(PIPELINE_STEP_ORDER.indexOf(effectiveFromStep))) {
    if (await env.shouldCancel?.()) {
      throw new Error('Agent pipeline cancellation requested.')
    }
    const step = steps.find((item) => item.type === type)
    if (!step) continue
    const decision = PipelineRecipeService.resolveStepExecution(
      resolvedRecipe,
      type,
      pipelineEscalationSignal(state, job.id, type),
      legacyMode
    )
    if (!decision.run) {
      state.recipeSkipReasons = [...state.recipeSkipReasons, decision.skipReason!]
      state.working = updateStepInData(state.working, step.id, {
        status: 'skipped',
        output: PipelineRecipeService.serializeSkipOutput(decision),
        errorMessage: ''
      })
      state.working = upsertGenerationRunTrace(state.working, job, {
        pipelineRecipeExplanation: PipelineRecipeService.explainRecipe(resolvedRecipe, legacyMode, {
          recipe: resolvedRecipe,
          steps: [...PIPELINE_STEP_ORDER].map((stepType) =>
            stepType === type
              ? decision
              : PipelineRecipeService.resolveStepExecution(resolvedRecipe, stepType, 'none', legacyMode)
          )
        })
      })
      await persistWorking(state.working, jobId)
      continue
    }
    state.working = updateStepInData(
      state.working,
      step.id,
      { status: 'running', inputSnapshot: serializeOutput(options), errorMessage: '' },
      { status: 'running', currentStep: type, errorMessage: '' }
    )
    await persistWorking(state.working, jobId)
    try {
      const handlerContext: PipelineStepHandlerContext = {
        job,
        step,
        options,
        env,
        snapshot,
        activeStoryDirectionGuide,
        storyDirectionTracePatch,
        state
      }
      await runPipelineStep(type, handlerContext)
      await persistWorking(state.working, jobId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      state.working = updateStepInData(state.working, step.id, { status: 'failed', errorMessage: message }, { status: 'failed', errorMessage: message })
      await persistWorking(state.working, jobId)
      break
    }
  }
  return state.working
}
function pipelineEscalationSignal(state: PipelineRunnerState, jobId: ID, type: ChapterGenerationStepType): 'none' | 'warning' | 'failure' {
  const priorSteps = state.working.chapterGenerationSteps.filter((step) => step.jobId === jobId && step.type !== type)
  if (priorSteps.some((step) => step.status === 'failed')) return 'failure'
  const trace = state.working.generationRunTraces.find((item) => item.jobId === jobId)
  if (trace?.contextWarnings.some((warning) => warning.trim())) return 'warning'
  if (state.planGapAnalysis?.warnings.some((warning) => warning.trim())) return 'warning'
  if (state.noveltyAuditResult?.severity === 'warning' || state.noveltyAuditResult?.severity === 'fail') return 'warning'
  return 'none'
}

async function runPipelineStep(type: ChapterGenerationStepType, ctx: PipelineStepHandlerContext) {
  switch (type) {
    case 'context_need_planning':
      return (await import('./pipelineSteps/contextPlanning')).runContextNeedPlanningStep(ctx)
    case 'context_budget_selection':
      return (await import('./pipelineSteps/contextPlanning')).runContextBudgetSelectionStep(ctx)
    case 'build_context':
      return (await import('./pipelineSteps/contextPlanning')).runBuildContextStep(ctx)
    case 'generate_chapter_plan':
      return (await import('./pipelineSteps/chapterPlanGeneration')).runGenerateChapterPlanStep(ctx)
    case 'context_need_planning_from_plan':
      return (await import('./pipelineSteps/chapterGeneration')).runPlanContextNeedStep(ctx)
    case 'context_budget_selection_delta':
      return (await import('./pipelineSteps/chapterGeneration')).runContextBudgetDeltaStep(ctx)
    case 'rebuild_context_with_plan':
      return (await import('./pipelineSteps/chapterGeneration')).runRebuildContextWithPlanStep(ctx)
    case 'generate_chapter_draft':
      return (await import('./pipelineSteps/chapterGeneration')).runGenerateChapterDraftStep(ctx)
    case 'generate_chapter_review':
      return (await import('./pipelineSteps/memoryExtraction')).runChapterReviewStep(ctx)
    case 'propose_character_updates':
      return (await import('./pipelineSteps/memoryExtraction')).runCharacterUpdateExtractionStep(ctx)
    case 'propose_foreshadowing_updates':
      return (await import('./pipelineSteps/memoryExtraction')).runForeshadowingUpdateExtractionStep(ctx)
    case 'consistency_review':
      return (await import('./pipelineSteps/consistencyReview')).runConsistencyReviewStep(ctx)
    case 'quality_gate':
      return (await import('./pipelineSteps/qualityCheck')).runQualityGateStep(ctx)
    case 'await_user_confirmation':
      return (await import('./pipelineSteps/qualityCheck')).runAwaitUserConfirmationStep(ctx)
    default: return undefined
  }
}

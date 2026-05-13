import type {
  AppData,
  ChapterDraftResult,
  ChapterGenerationStepType,
  ChapterPlan,
  ContextBudgetProfile,
  ContextNeedPlan,
  ContextSelectionResult,
  ID,
  PlanContextGapAnalysisResult
} from '../../../../shared/types'
import { StoryDirectionService } from '../../../../services/StoryDirectionService'
import { createContextBudgetProfile } from '../../utils/promptContext'
import {
  runBuildContextStep,
  runContextBudgetSelectionStep,
  runContextNeedPlanningStep
} from './pipelineSteps/contextPlanning'
import {
  runContextBudgetDeltaStep,
  runGenerateChapterDraftStep,
  runGenerateChapterPlanStep,
  runPlanContextNeedStep,
  runRebuildContextWithPlanStep
} from './pipelineSteps/chapterGeneration'
import {
  runChapterReviewStep,
  runCharacterUpdateExtractionStep,
  runForeshadowingUpdateExtractionStep
} from './pipelineSteps/memoryExtraction'
import {
  runAwaitUserConfirmationStep,
  runConsistencyReviewStep,
  runQualityGateStep
} from './pipelineSteps/qualityCheck'
import {
  PIPELINE_STEP_ORDER,
  normalizePipelineOptions,
  parseOutput,
  pipelineContextFromStepOutput,
  serializeOutput
} from './pipelineUtils'
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
  const job = initialData.chapterGenerationJobs.find((item) => item.id === jobId)
  if (!job) return

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
      ? initialData.promptContextSnapshots.find((item) => item.id === job.promptContextSnapshotId) ?? null
      : null
  const activeStoryDirectionGuide =
    job.contextSource === 'prompt_snapshot'
      ? null
      : StoryDirectionService.getActiveGuideForChapter(initialData.storyDirectionGuides ?? [], project.id, options.targetChapterOrder)
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
    working: initialData,
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
    budgetSelection: null
  }
  const steps = state.working.chapterGenerationSteps.filter((step) => step.jobId === jobId)
  restorePipelineStateFromCompletedSteps(state, steps, snapshot !== null, job.contextSource !== 'prompt_snapshot')

  for (const type of PIPELINE_STEP_ORDER.slice(PIPELINE_STEP_ORDER.indexOf(fromStep))) {
    const step = steps.find((item) => item.type === type)
    if (!step) continue
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
}

function restorePipelineStateFromCompletedSteps(
  state: PipelineRunnerState,
  steps: AppData['chapterGenerationSteps'],
  hasSnapshot: boolean,
  canUsePlanDerivedSelection: boolean
) {
  const contextStep = steps.find((step) => step.type === 'build_context')
  if (contextStep?.output) state.context = pipelineContextFromStepOutput(contextStep.output)
  const planStep = steps.find((step) => step.type === 'generate_chapter_plan')
  if (planStep?.output) state.plan = parseOutput<ChapterPlan | null>(planStep.output, null)
  const draftStep = steps.find((step) => step.type === 'generate_chapter_draft')
  if (draftStep?.output) state.draftResult = parseOutput<ChapterDraftResult | null>(draftStep.output, null)
  state.draftRecord =
    state.working.generatedChapterDrafts.find((draft) => draft.jobId === steps[0]?.jobId && draft.status === 'draft') ??
    state.working.generatedChapterDrafts.find((draft) => draft.jobId === steps[0]?.jobId) ??
    null
  state.noveltyAuditResult = state.working.generationRunTraces.find((trace) => trace.jobId === steps[0]?.jobId)?.noveltyAuditResult ?? null

  const needPlanStep = steps.find((step) => step.type === 'context_need_planning')
  if (needPlanStep?.output) {
    const savedNeedPlan = parseOutput<ContextNeedPlan | null>(needPlanStep.output, null)
    if (savedNeedPlan) state.contextNeedPlan = savedNeedPlan
  }
  const budgetStep = steps.find((step) => step.type === 'context_budget_selection')
  if (budgetStep?.output) {
    const savedBudget = parseOutput<{ profile?: ContextBudgetProfile; selection?: ContextSelectionResult } | null>(budgetStep.output, null)
    if (savedBudget?.profile) state.budgetProfile = savedBudget.profile
    if (savedBudget?.selection) state.budgetSelection = savedBudget.selection
  }
  const planNeedStep = steps.find((step) => step.type === 'context_need_planning_from_plan')
  if (planNeedStep?.output) {
    state.planGapAnalysis = parseOutput<PlanContextGapAnalysisResult | null>(planNeedStep.output, null)
    if (state.planGapAnalysis?.derivedContextNeedPlan) {
      state.contextNeedPlanFromPlan = state.planGapAnalysis.derivedContextNeedPlan
      if (canUsePlanDerivedSelection) state.contextNeedPlan = state.contextNeedPlanFromPlan
    }
  }
  const budgetDeltaStep = steps.find((step) => step.type === 'context_budget_selection_delta')
  if (budgetDeltaStep?.output) {
    const savedBudget = parseOutput<{ profile?: ContextBudgetProfile; selection?: ContextSelectionResult } | null>(budgetDeltaStep.output, null)
    if (savedBudget?.profile) state.budgetProfile = savedBudget.profile
    if (savedBudget?.selection) state.budgetSelection = savedBudget.selection
  }
  const rebuildContextStep = steps.find((step) => step.type === 'rebuild_context_with_plan')
  if (rebuildContextStep?.output) {
    state.context = pipelineContextFromStepOutput(rebuildContextStep.output)
    if (state.context.trim()) state.rebuiltContextFromPlan = true
  }
  if (!hasSnapshot && state.contextNeedPlanFromPlan && canUsePlanDerivedSelection) {
    state.contextNeedPlan = state.contextNeedPlanFromPlan
  }
}

async function runPipelineStep(type: ChapterGenerationStepType, ctx: PipelineStepHandlerContext) {
  switch (type) {
    case 'context_need_planning':
      return runContextNeedPlanningStep(ctx)
    case 'context_budget_selection':
      return runContextBudgetSelectionStep(ctx)
    case 'build_context':
      return runBuildContextStep(ctx)
    case 'generate_chapter_plan':
      return runGenerateChapterPlanStep(ctx)
    case 'context_need_planning_from_plan':
      return runPlanContextNeedStep(ctx)
    case 'context_budget_selection_delta':
      return runContextBudgetDeltaStep(ctx)
    case 'rebuild_context_with_plan':
      return runRebuildContextWithPlanStep(ctx)
    case 'generate_chapter_draft':
      return runGenerateChapterDraftStep(ctx)
    case 'generate_chapter_review':
      return runChapterReviewStep(ctx)
    case 'propose_character_updates':
      return runCharacterUpdateExtractionStep(ctx)
    case 'propose_foreshadowing_updates':
      return runForeshadowingUpdateExtractionStep(ctx)
    case 'consistency_review':
      return runConsistencyReviewStep(ctx)
    case 'quality_gate':
      return runQualityGateStep(ctx)
    case 'await_user_confirmation':
      return runAwaitUserConfirmationStep(ctx)
    default:
      return undefined
  }
}

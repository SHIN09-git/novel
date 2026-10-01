import type {
  AppData,
  ChapterDraftResult,
  ChapterGenerationStepType,
  ChapterPlan,
  ContextBudgetProfile,
  ContextNeedPlan,
  ContextSelectionResult,
  PlanContextGapAnalysisResult
} from '../../../../shared/types'
import { noveltyAuditMatchesDraft } from '../../../../services/DraftDiagnosticBindingService'
import { PipelineRecipeService } from '../../../../services/PipelineRecipeService'
import { parseOutput } from './pipelineRuntimeBasics'
import type { PipelineRunnerState } from './pipelineRunnerTypes'
import { pipelineContextFromStepOutput } from './pipelineUtils'

function completedStepOutput(
  steps: AppData['chapterGenerationSteps'],
  type: ChapterGenerationStepType
): string {
  const step = [...steps]
    .filter((item) => item.type === type && item.status === 'completed' && item.output.trim())
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
  if (!step || PipelineRecipeService.isSkipOutput(step.output)) return ''
  return step.output
}

export function restorePipelineStateFromCompletedSteps(
  state: PipelineRunnerState,
  steps: AppData['chapterGenerationSteps'],
  hasSnapshot: boolean,
  canUsePlanDerivedSelection: boolean
) {
  state.recipeSkipReasons = steps
    .map((step) => PipelineRecipeService.parseSkipOutput(step.output))
    .filter((reason): reason is NonNullable<typeof reason> => Boolean(reason))
  const contextOutput = completedStepOutput(steps, 'build_context')
  if (contextOutput) state.context = pipelineContextFromStepOutput(contextOutput)
  const planOutput = completedStepOutput(steps, 'generate_chapter_plan')
  if (planOutput) state.plan = parseOutput<ChapterPlan | null>(planOutput, null)
  const draftOutput = completedStepOutput(steps, 'generate_chapter_draft')
  if (draftOutput) state.draftResult = parseOutput<ChapterDraftResult | null>(draftOutput, null)
  state.draftRecord =
    [...state.working.generatedChapterDrafts]
      .filter((draft) => draft.jobId === steps[0]?.jobId && draft.status === 'draft')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ??
    [...state.working.generatedChapterDrafts]
      .filter((draft) => draft.jobId === steps[0]?.jobId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ??
    null
  if (state.draftRecord) state.draftResult = { title: state.draftRecord.title, body: state.draftRecord.body }
  const savedAudit = state.working.generationRunTraces.find((trace) => trace.jobId === steps[0]?.jobId)?.noveltyAuditResult ?? null
  state.noveltyAuditResult = state.draftRecord && noveltyAuditMatchesDraft(savedAudit, state.draftRecord) ? savedAudit : null

  const needPlanOutput = completedStepOutput(steps, 'context_need_planning')
  if (needPlanOutput) {
    const savedNeedPlan = parseOutput<ContextNeedPlan | null>(needPlanOutput, null)
    if (savedNeedPlan) state.contextNeedPlan = savedNeedPlan
  }
  const budgetOutput = completedStepOutput(steps, 'context_budget_selection')
  if (budgetOutput) {
    const savedBudget = parseOutput<{ profile?: ContextBudgetProfile; selection?: ContextSelectionResult } | null>(budgetOutput, null)
    if (savedBudget?.profile) state.budgetProfile = savedBudget.profile
    if (savedBudget?.selection) state.budgetSelection = savedBudget.selection
  }
  const planNeedOutput = completedStepOutput(steps, 'context_need_planning_from_plan')
  if (planNeedOutput) {
    state.planGapAnalysis = parseOutput<PlanContextGapAnalysisResult | null>(planNeedOutput, null)
    if (state.planGapAnalysis?.derivedContextNeedPlan) {
      state.contextNeedPlanFromPlan = state.planGapAnalysis.derivedContextNeedPlan
      if (canUsePlanDerivedSelection) state.contextNeedPlan = state.contextNeedPlanFromPlan
    }
  }
  const budgetDeltaOutput = completedStepOutput(steps, 'context_budget_selection_delta')
  if (budgetDeltaOutput) {
    const savedBudget = parseOutput<{ profile?: ContextBudgetProfile; selection?: ContextSelectionResult } | null>(budgetDeltaOutput, null)
    if (savedBudget?.profile) state.budgetProfile = savedBudget.profile
    if (savedBudget?.selection) state.budgetSelection = savedBudget.selection
  }
  const rebuildContextOutput = completedStepOutput(steps, 'rebuild_context_with_plan')
  if (rebuildContextOutput) {
    state.context = pipelineContextFromStepOutput(rebuildContextOutput)
    if (state.context.trim()) state.rebuiltContextFromPlan = true
  }
  if (!hasSnapshot && state.contextNeedPlanFromPlan && canUsePlanDerivedSelection) {
    state.contextNeedPlan = state.contextNeedPlanFromPlan
  }
}

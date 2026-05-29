import type {
  AppData,
  ChapterGenerationJob,
  ChapterGenerationStep,
  ContextBudgetMode,
  ContextNeedPlan,
  ContextSelectionResult,
  ForcedContextBlock,
  Project,
  PromptContextSnapshot,
  QualityGateIssue,
  QualityGateReport,
  RevisionCandidateContextSource
} from '../../../../shared/types'
import { safeParseJson } from '../../../../services/AIJsonParser'
import { TokenEstimator } from '../../../../services/TokenEstimator'
import { buildPipelineContextFromSelection, createContextBudgetProfile, selectBudgetContext } from '../../utils/promptContext'
import { budgetSelectionFromStepOutput, contextFromBuildContextOutput } from './generationPipelineHelpers'

interface ResolveRevisionCandidateContextInput {
  project: Project
  data: AppData
  selectedJob: ChapterGenerationJob | null
  selectedSteps: ChapterGenerationStep[]
  selectedTraceSnapshot: PromptContextSnapshot | null
  targetChapterOrder: number
  readerEmotionTarget: string
  estimatedWordCount: string
  budgetMode: ContextBudgetMode
  budgetMaxTokens: number
  issue: QualityGateIssue
  report: QualityGateReport
}

export interface ResolvedRevisionCandidateContext {
  context: string
  contextSource: RevisionCandidateContextSource
  contextWarnings: string[]
  compressionRecords?: ContextSelectionResult['compressionRecords']
  forcedBlock: ForcedContextBlock
}

export function resolveRevisionCandidateContext(input: ResolveRevisionCandidateContextInput): ResolvedRevisionCandidateContext {
  const {
    project,
    data,
    selectedJob,
    selectedSteps,
    selectedTraceSnapshot,
    targetChapterOrder,
    readerEmotionTarget,
    estimatedWordCount,
    budgetMode,
    budgetMaxTokens,
    issue,
    report
  } = input
  const targetOrder = selectedJob?.targetChapterOrder ?? targetChapterOrder
  const issueText = JSON.stringify(issue, null, 2)
  const forcedBlock: ForcedContextBlock = {
    kind: 'quality_gate_issue',
    sourceId: report.id,
    sourceType: issue.type,
    sourceChapterId: report.chapterId ?? null,
    sourceChapterOrder: targetOrder,
    title: `质量门禁问题：${issue.description || issue.type}`,
    tokenEstimate: TokenEstimator.estimate(issueText)
  }

  const buildContextStep = selectedSteps.find((step) => step.type === 'build_context' && step.status === 'completed' && step.output.trim())
  if (buildContextStep) {
    const context = contextFromBuildContextOutput(buildContextStep.output)
    if (context.trim()) return { context, contextSource: 'reused_current_job_context', contextWarnings: [], forcedBlock }
  }

  if (selectedTraceSnapshot?.finalPrompt?.trim()) {
    return {
      context: selectedTraceSnapshot.finalPrompt,
      contextSource: 'reused_current_job_context',
      contextWarnings: ['当前 job 的 build_context 输出不可用，已复用绑定的 Prompt 快照。'],
      forcedBlock
    }
  }

  const budgetStep = selectedSteps.find((step) => step.type === 'context_budget_selection' && step.status === 'completed' && step.output.trim())
  const parsedBudget = budgetStep ? budgetSelectionFromStepOutput(budgetStep.output) : { profile: null, selection: null }
  const needPlanStep = selectedSteps.find((step) => step.type === 'context_need_planning' && step.status === 'completed' && step.output.trim())
  const parsedNeedPlan = needPlanStep ? safeParseJson<ContextNeedPlan>(needPlanStep.output, 'pipeline context need plan output') : { ok: false, data: null }
  const contextNeedPlan = selectedTraceSnapshot?.contextNeedPlan ?? (parsedNeedPlan.ok ? parsedNeedPlan.data : null)
  const budgetProfile = parsedBudget.profile ?? createContextBudgetProfile(project.id, budgetMode, budgetMaxTokens, '修订候选上下文')
  const budgetSelection =
    parsedBudget.selection ??
    selectBudgetContext(project, data, targetOrder, budgetProfile, {
      chapterTask: {
        goal: `生成第 ${targetOrder} 章草稿`,
        conflict: issue.description,
        suspenseToKeep: '',
        allowedPayoffs: '',
        forbiddenPayoffs: '',
        endingHook: '',
        readerEmotion: readerEmotionTarget,
        targetWordCount: estimatedWordCount,
        styleRequirement: project.style
      },
      contextNeedPlan
    })
  const context = buildPipelineContextFromSelection(project, data, targetOrder, readerEmotionTarget, estimatedWordCount, budgetProfile, budgetSelection, contextNeedPlan)
  return {
    context,
    contextSource: 'rebuilt_from_explicit_selection',
    contextWarnings: parsedBudget.selection ? [] : ['当前 job 缺少可复用上下文，已通过 ContextBudgetManager 重新生成显式 selection。'],
    compressionRecords: budgetSelection.compressionRecords,
    forcedBlock
  }
}

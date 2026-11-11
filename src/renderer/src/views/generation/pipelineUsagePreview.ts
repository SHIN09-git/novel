import type { AppData, ChapterGenerationJob, ChapterGenerationStep, PipelineAIRole, Project } from '../../../../shared/types'
import { chapterDraftMessages, chapterPlanMessages } from '../../../../services/ai/GenerationPipelineAI'
import { buildAuthoritativeOpeningPlan, guardOpeningChapterPlanForDraft } from '../../../../services/OpeningChapterPlanGuardService'
import { enforceOpeningChapterSnapshotPolicy } from '../../../../services/OpeningChapterSnapshotPolicy'
import { resolvePipelineRoleSettings } from '../../../../services/PipelineRunContextService'
import { StoryDirectionService } from '../../../../services/StoryDirectionService'
import type { PreparedUsageInput } from '../../../../services/ProjectUsagePricing'
import { createContextBudgetProfile } from '../../utils/contextBudgetProfile'
import { projectData } from '../../utils/projectData'
import { estimateForSettings, usageEstimateText } from '../projectUsage/usageEstimateText'
import type { PipelineRunOptions, PipelineRunnerState, PipelineStepHandlerContext } from './pipelineRunnerTypes'
import { restorePipelineStateFromCompletedSteps } from './pipelineStateRestore'
import { PIPELINE_STEP_ORDER } from './pipelineStepDefinitions'
import { runBuildContextStep, runContextBudgetSelectionStep, runContextNeedPlanningStep } from './pipelineSteps/contextPlanning'
import { pipelineChapterTask } from './pipelineUtils'
import type { ConfirmFn } from '../../components/ConfirmDialog'

export async function confirmPipelineUsage(showConfirmation: ConfirmFn, setMessage: (message: string) => void,
  data: AppData, project: Project, job: ChapterGenerationJob, step: ChapterGenerationStep['type'], options: PipelineRunOptions) {
  if (PIPELINE_STEP_ORDER.indexOf(step) > PIPELINE_STEP_ORDER.indexOf('generate_chapter_draft')) return true
  const accepted = await showConfirmation({ title: '流水线启动前估算', message: pipelineUsagePreview(data, project, job, step, options),
    confirmLabel: '启动流水线', cancelLabel: '取消' })
  if (!accepted) setMessage('已取消启动，未发起模型请求。')
  return accepted
}

/** Runs only the local context builders. No persistence, AI client, diagnostics or model lookup. */
export function pipelineUsagePreview(data: AppData, project: Project, storedJob: ChapterGenerationJob,
  from: ChapterGenerationStep['type'], options: PipelineRunOptions): string {
  if (project.id !== storedJob.projectId) throw new Error('这项任务不属于当前项目。')
  const { job, mustRebuildFromStart } = enforceOpeningChapterSnapshotPolicy(storedJob)
  const start = PIPELINE_STEP_ORDER.indexOf(mustRebuildFromStart ? 'context_need_planning' : from)
  const steps = data.chapterGenerationSteps.filter(step => step.jobId === job.id)
  const snapshot = job.contextSource === 'prompt_snapshot'
    ? data.promptContextSnapshots.find(s => s.id === job.promptContextSnapshotId && s.projectId === project.id) ?? null : null
  if (job.contextSource === 'prompt_snapshot' && !snapshot) throw new Error('找不到本书的上下文快照，请重新选择。')
  const guide = snapshot || job.chapterTaskSnapshot ? null :
    StoryDirectionService.getActiveGuideForChapter(data.storyDirectionGuides, project.id, options.targetChapterOrder)
  const chapterTask = pipelineChapterTask(project, options, guide, job.chapterTaskSnapshot)
  const promptOptions = { ...options, mode: options.pipelineMode, chapterTask, authoritativeChapterTask: Boolean(job.chapterTaskSnapshot) }
  const compactOpening = options.targetChapterOrder === 1 && Boolean(job.chapterTaskSnapshot)
  const drafting = compactOpening || start > PIPELINE_STEP_ORDER.indexOf('generate_chapter_plan')
  const role: PipelineAIRole = drafting ? 'prose' : 'planner'
  const settings = resolvePipelineRoleSettings(job.aiRunConfig, data.settings, role)
  let messages: PreparedUsageInput['messages'] = null
  const draftStep = steps.find(s => s.type === 'generate_chapter_draft')
  const recovering = Boolean(draftStep?.output.trim() && draftStep.status !== 'completed')
  if (drafting && compactOpening && !recovering) {
    // This branch writes the plan locally; the outbound draft uses only the authoritative task.
    messages = chapterDraftMessages(buildAuthoritativeOpeningPlan(chapterTask), '', promptOptions)
  } else {
    const state: PipelineRunnerState = { working: data, context: '', plan: null, draftResult: null,
      noveltyAuditResult: null, planGapAnalysis: null, contextNeedPlanFromPlan: null, rebuiltContextFromPlan: false,
      draftRecord: null, contextNeedPlan: snapshot?.contextNeedPlan ?? null, budgetSelection: null, recipeSkipReasons: [],
      budgetProfile: createContextBudgetProfile(project.id, options.budgetMode, options.budgetMaxTokens) }
    restorePipelineStateFromCompletedSteps(state, steps, Boolean(snapshot), !snapshot)
    if (!drafting && start >= 0) {
      const builders = [runContextNeedPlanningStep, runContextBudgetSelectionStep, runBuildContextStep]
      const env: PipelineStepHandlerContext['env'] = { data, project, scoped: projectData(data, project.id), ...options,
        aiSettings: settings, runId: job.id, getAiSettings: () => settings,
        getAiService: async () => { throw new Error('估算不能调用模型。') },
        persistWorking: async () => { throw new Error('估算不能写回项目。') }, updateStepInData: current => current }
      for (let i = start; i < builders.length; i++) {
        const type = PIPELINE_STEP_ORDER[i]
        const step = steps.find(s => s.type === type) ?? { type, id: type, jobId: job.id, status: 'pending',
          inputSnapshot: '', output: '', errorMessage: '', createdAt: job.createdAt, updatedAt: job.updatedAt }
        builders[i]({ job, step, options, snapshot, activeStoryDirectionGuide: guide, storyDirectionTracePatch: {}, env, state })
      }
      if (state.context.trim()) messages = chapterPlanMessages(state.context, promptOptions)
    } else if (from === 'generate_chapter_draft' && state.plan && state.context.trim() && !recovering) {
      const plan = guardOpeningChapterPlanForDraft({ generatedPlan: state.plan, targetChapterOrder: options.targetChapterOrder,
        chapterTaskSnapshot: job.chapterTaskSnapshot })
      messages = chapterDraftMessages(plan, state.context, promptOptions)
    }
  }
  const label = drafting ? '正文生成' : '章节规划'
  return usageEstimateText(estimateForSettings(settings, project, messages),
    `第 ${options.targetChapterOrder} 章 · ${label}模型单次请求（若实际发出）${messages ? '' : '；输入尚未确定'}`)
}

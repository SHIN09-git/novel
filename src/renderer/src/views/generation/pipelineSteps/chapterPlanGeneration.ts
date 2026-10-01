import type { AIResult, ChapterPlan } from '../../../../../shared/types'
import {
  buildAuthoritativeOpeningPlan,
  guardOpeningChapterPlanForDraft
} from '../../../../../services/OpeningChapterPlanGuardService'
import { appendGenerationRunTraceAiCall } from '../../../utils/runTrace'
import {
  assertChapterTaskPresentInPrompt,
  pipelineChapterTask,
  serializeOutput
} from '../pipelineUtils'
import type { PipelineStepHandlerContext } from '../pipelineRunnerTypes'

function isAgentManagedJob(ctx: PipelineStepHandlerContext): boolean {
  return ctx.state.working.agentRuns.some((run) => run.createdJobIds.includes(ctx.job.id))
}

function assertAuthoritativeAgentPlan(
  result: AIResult<ChapterPlan>,
  agentManaged: boolean
): void {
  if (!agentManaged) return
  if (result.ok && result.usedAI === true && result.data && !result.error?.trim() && !result.parseError?.trim()) return

  const reason =
    result.parseError?.trim() ||
    result.error?.trim() ||
    (result.usedAI !== true
      ? '写作模型未返回可验证的 AI 计划，工作流拒绝使用本地通用模板继续写作。'
      : '写作模型未返回有效的章节计划。')
  throw new Error(`PLAN_GENERATION_NON_AUTHORITATIVE: ${reason}`)
}

export async function runGenerateChapterPlanStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step, options, activeStoryDirectionGuide } = ctx
  const chapterTask = pipelineChapterTask(env.project, options, activeStoryDirectionGuide, job.chapterTaskSnapshot)
  if (job.chapterTaskSnapshot) assertChapterTaskPresentInPrompt(state.context, chapterTask, 'plan')
  if (options.targetChapterOrder === 1 && job.chapterTaskSnapshot) {
    state.plan = buildAuthoritativeOpeningPlan(chapterTask)
    state.working = env.updateStepInData(state.working, step.id, {
      status: 'completed',
      output: serializeOutput(state.plan),
      errorMessage: ''
    })
    return
  }

  const aiService = await env.getAiService('planner')
  const result = await aiService.generateChapterPlan(state.context, {
    mode: options.pipelineMode,
    targetChapterOrder: options.targetChapterOrder,
    estimatedWordCount: options.estimatedWordCount,
    readerEmotionTarget: options.readerEmotionTarget,
    chapterTask
  })
  state.working = appendGenerationRunTraceAiCall(
    state.working,
    job.id,
    step,
    'planner',
    result.telemetry,
    result.ok && Boolean(result.data) ? 'success' : 'failed'
  )
  assertAuthoritativeAgentPlan(result, isAgentManagedJob(ctx))
  if (!result.data) throw new Error(result.error || result.parseError || '任务书生成失败')
  state.plan = guardOpeningChapterPlanForDraft({
    generatedPlan: result.data,
    targetChapterOrder: options.targetChapterOrder,
    chapterTaskSnapshot: job.chapterTaskSnapshot
  })
  state.working = env.updateStepInData(state.working, step.id, {
    status: 'completed',
    output: serializeOutput(state.plan),
    errorMessage: result.error?.includes('远程 AI 任务书生成失败') ? result.error : ''
  })
}

import type { ConsistencyReviewReport } from '../../../../../shared/types'
import { draftContentHash } from '../../../../../services/DraftDiagnosticBindingService'
import { PipelineRecipeService } from '../../../../../services/PipelineRecipeService'
import { newId, now } from '../../../utils/format'
import { appendGenerationRunTraceAiCall, upsertGenerationRunTrace } from '../../../utils/runTrace'
import type { PipelineStepHandlerContext } from '../pipelineRunnerTypes'
import { serializeOutput } from '../pipelineUtils'

export async function runConsistencyReviewStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step } = ctx
  const { project, updateStepInData } = env
  if (!state.draftResult) throw new Error('缺少章节正文草稿，无法审稿')
  const recipe = PipelineRecipeService.resolveRecipe(
    job.pipelineRecipe ?? job.pipelineRecipeId ?? job.pipelineMode,
    job.pipelineMode ?? ctx.options.pipelineMode
  )
  if (recipe.id === 'standard') {
    state.working = updateStepInData(state.working, step.id, {
      status: 'completed',
      output: serializeOutput({
        kind: 'combined_semantic_review_deferred',
        targetStep: 'quality_gate',
        reason: '标准闭环由质量门禁的一次语义审稿同时生成质量结论与一致性兼容报告。'
      }),
      errorMessage: ''
    })
    return
  }
  const aiService = await env.getAiService('reviewer')
  const result = await aiService.generateConsistencyReview(state.draftResult, state.context)
  state.working = appendGenerationRunTraceAiCall(
    state.working,
    job.id,
    step,
    'reviewer',
    result.telemetry,
    result.ok && Boolean(result.data) ? 'success' : 'failed'
  )
  if (!result.data) throw new Error(result.error || result.parseError || '一致性审稿失败')
  const report: ConsistencyReviewReport = {
    id: newId(),
    projectId: project.id,
    jobId: job.id,
    chapterId: null,
    draftId: state.draftRecord?.id ?? null,
    draftContentHash: draftContentHash((state.draftRecord ?? state.draftResult).body),
    promptContextSnapshotId: job.promptContextSnapshotId ?? null,
    issues: result.data.issues,
    legacyIssuesText: '',
    suggestions: result.data.suggestions.join('\n'),
    severitySummary: result.data.severitySummary,
    createdAt: now()
  }
  state.working = {
    ...updateStepInData(state.working, step.id, { status: 'completed', output: serializeOutput(result.data) }),
    consistencyReviewReports: [report, ...state.working.consistencyReviewReports]
  }
  state.working = upsertGenerationRunTrace(state.working, job, { consistencyReviewReportId: report.id })
}

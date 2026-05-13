import type { ConsistencyReviewReport } from '../../../../../shared/types'
import { QualityGateService } from '../../../../../services/QualityGateService'
import { NoveltyDetector } from '../../../../../services/NoveltyDetector'
import { newId, now } from '../../../utils/format'
import { upsertGenerationRunTrace } from '../../../utils/runTrace'
import { serializeOutput } from '../pipelineUtils'
import type { PipelineStepHandlerContext } from '../pipelineRunnerTypes'

export async function runConsistencyReviewStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step } = ctx
  const { project, aiService, updateStepInData } = env
  if (!state.draftResult) throw new Error('缺少章节正文草稿，无法审稿')
  const result = await aiService.generateConsistencyReview(state.draftResult, state.context)
  if (!result.data) throw new Error(result.error || result.parseError || '一致性审稿失败')
  const report: ConsistencyReviewReport = {
    id: newId(),
    projectId: project.id,
    jobId: job.id,
    chapterId: null,
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

export async function runQualityGateStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step } = ctx
  const { project, aiService, updateStepInData } = env
  if (!state.draftResult) throw new Error('缺少章节正文草稿，无法执行质量门禁')
  state.noveltyAuditResult =
    state.noveltyAuditResult ??
    NoveltyDetector.audit({
      generatedText: (state.draftRecord ?? state.draftResult).body,
      context: state.context,
      chapterPlan: state.plan
    })
  const report = await QualityGateService.evaluateChapterDraft({
    projectId: project.id,
    jobId: job.id,
    chapterId: state.draftRecord?.chapterId ?? null,
    draftId: state.draftRecord?.id ?? null,
    chapterDraft: state.draftRecord ?? state.draftResult,
    context: state.context,
    chapterPlan: state.plan,
    consistencyReports: state.working.consistencyReviewReports.filter((item) => item.jobId === job.id),
    promptContextSnapshotId: job.promptContextSnapshotId ?? null,
    contextSource: job.contextSource,
    aiService
  })
  state.working = {
    ...updateStepInData(state.working, step.id, { status: 'completed', output: serializeOutput(report) }),
    qualityGateReports: [report, ...state.working.qualityGateReports]
  }
  state.working = upsertGenerationRunTrace(state.working, job, { qualityGateReportId: report.id, noveltyAuditResult: state.noveltyAuditResult })
}

export function runAwaitUserConfirmationStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step } = ctx
  state.working = env.updateStepInData(
    state.working,
    step.id,
    { status: 'completed', output: '等待用户确认章节草稿和记忆更新候选。' },
    { status: 'completed', currentStep: step.type }
  )
}

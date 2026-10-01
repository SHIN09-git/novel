import type { ConsistencyReviewReport } from '../../../../../shared/types'
import { now } from '../../../utils/format'
import { auditNoveltyDiagnostic, evaluateQualityGateDiagnostic } from '../../../utils/diagnosticsApi'
import {
  bindNoveltyAuditToDraft,
  draftContentHash,
  latestConsistencyReportsForDraft,
  latestRedundancyReportForDraft,
  noveltyAuditMatchesDraft
} from '../../../../../services/DraftDiagnosticBindingService'
import { deriveConsistencyReviewFromQualityGate } from '../../../../../services/CombinedSemanticReviewService'
import { PipelineRecipeService } from '../../../../../services/PipelineRecipeService'
import { appendGenerationRunTraceAiCall, upsertGenerationRunTrace } from '../../../utils/runTrace'
import { noveltyReferenceContext, serializeOutput } from '../pipelineUtils'
import type { PipelineStepHandlerContext } from '../pipelineRunnerTypes'
import { finalizeEditorialVerdict } from '../pipelineEditorialVerdict'

export async function runQualityGateStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step } = ctx
  const { project, updateStepInData } = env
  if (!state.draftResult) throw new Error('缺少章节正文草稿，无法执行质量门禁')
  const currentDraft = state.draftRecord
  const currentBody = (currentDraft ?? state.draftResult).body
  const auditNovelty = env.diagnostics?.auditNovelty ?? auditNoveltyDiagnostic
  const evaluateQualityGate = env.diagnostics?.evaluateQualityGate ?? evaluateQualityGateDiagnostic
  state.noveltyAuditResult =
    currentDraft && noveltyAuditMatchesDraft(state.noveltyAuditResult, currentDraft)
      ? state.noveltyAuditResult
      : bindNoveltyAuditToDraft(await auditNovelty({
      generatedText: currentBody,
      context: state.context,
      chapterPlan: state.plan,
      project,
      ...noveltyReferenceContext(state.working, project.id)
    }), currentDraft ?? {
      id: `transient:${job.id}`,
      projectId: project.id,
      chapterId: null,
      jobId: job.id,
      title: state.draftResult.title,
      body: currentBody,
      summary: '',
      status: 'draft',
      tokenEstimate: 0,
      createdAt: now(),
      updatedAt: now()
    })
  const latestConsistencyReports = currentDraft
    ? latestConsistencyReportsForDraft(state.working.consistencyReviewReports.filter((item) => item.jobId === job.id), currentDraft).slice(0, 1)
    : []
  const currentRedundancyReport = currentDraft
    ? latestRedundancyReportForDraft(state.working.redundancyReports.filter((item) => item.jobId === job.id), currentDraft)
    : null
  let report = await evaluateQualityGate({
    settings: env.getAiSettings('reviewer'),
    runId: env.runId,
    projectId: project.id,
    jobId: job.id,
    chapterId: state.draftRecord?.chapterId ?? null,
    draftId: state.draftRecord?.id ?? null,
    chapterDraft: state.draftRecord ?? state.draftResult,
    context: state.context,
    chapterPlan: state.plan,
    consistencyReports: latestConsistencyReports,
    noveltyAuditResult: state.noveltyAuditResult,
    redundancyReport: currentRedundancyReport,
    characterStateFacts: state.working.characterStateFacts.filter((fact) => fact.projectId === project.id),
    characters: env.scoped.characters,
    promptContextSnapshotId: job.promptContextSnapshotId ?? null,
    contextSource: job.contextSource,
    targetChapterOrder: job.targetChapterOrder,
    hasAuthoritativeChapterTask: Boolean(job.chapterTaskSnapshot),
    chapterTask: job.chapterTaskSnapshot ?? null
  })
  state.working = appendGenerationRunTraceAiCall(
    state.working,
    job.id,
    step,
    'reviewer',
    report.aiTelemetry,
    report.aiTelemetry?.terminationCategory === 'timeout' || report.aiTelemetry?.terminationCategory === 'cancelled'
      ? 'failed'
      : 'success'
  )
  let combinedConsistencyReport: ConsistencyReviewReport | null = null
  const recipe = PipelineRecipeService.resolveRecipe(
    job.pipelineRecipe ?? job.pipelineRecipeId ?? job.pipelineMode,
    job.pipelineMode ?? ctx.options.pipelineMode
  )
  if (recipe.id === 'standard' && currentDraft) {
    const combined = deriveConsistencyReviewFromQualityGate(report, currentDraft)
    report = combined.qualityGateReport
    combinedConsistencyReport = combined.consistencyReviewReport
  }
  state.working = {
    ...updateStepInData(state.working, step.id, { status: 'completed', output: serializeOutput(report) }),
    qualityGateReports: [report, ...state.working.qualityGateReports.filter((item) => item.id !== report.id)],
    consistencyReviewReports: combinedConsistencyReport
      ? [
          combinedConsistencyReport,
          ...state.working.consistencyReviewReports.filter((item) => item.id !== combinedConsistencyReport?.id)
        ]
      : state.working.consistencyReviewReports
  }
  state.working = upsertGenerationRunTrace(state.working, job, {
    qualityGateReportId: report.id,
    consistencyReviewReportId: combinedConsistencyReport?.id,
    noveltyAuditResult: state.noveltyAuditResult
  })

  if (currentDraft) finalizeEditorialVerdict(ctx, currentDraft)
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

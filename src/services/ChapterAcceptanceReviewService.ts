import type { AppData, ChapterAcceptanceReview, EditorialVerdict, GeneratedChapterDraft, QualityGateReport } from '../shared/types'
import { AuthorDecisionPolicyService } from './AuthorDecisionPolicyService'
import { draftContentHash, latestQualityReportForDraft } from './DraftDiagnosticBindingService'

export function hasCompleteChapterReview(report: QualityGateReport | null, verdict: EditorialVerdict | null, editorialRequired: boolean): boolean {
  return Boolean(report && (!editorialRequired || (verdict && verdict.status !== 'incomplete' && verdict.sourceRefs.qualityGateReportId === report.id)))
}

export function buildChapterAcceptanceReview(
  data: AppData,
  draft: GeneratedChapterDraft,
  mode: ChapterAcceptanceReview['mode'],
  requireEditorialVerdict = false
): ChapterAcceptanceReview {
  if (mode !== 'reviewed' && mode !== 'unreviewed') throw new Error('未知的草稿采纳方式。')
  const job = data.chapterGenerationJobs.find((item) => item.id === draft.jobId && item.projectId === draft.projectId)
  const editorialRequired = requireEditorialVerdict || Boolean(job?.pipelineRecipe)
  const report = latestQualityReportForDraft(data.qualityGateReports.filter((item) =>
    item.projectId === draft.projectId && item.jobId === draft.jobId), draft)
  const verdict = AuthorDecisionPolicyService.latestEditorialVerdictForDraft(data.editorialVerdicts ?? [], draft)
  const complete = hasCompleteChapterReview(report, verdict, editorialRequired)
  if (mode === 'reviewed' && !complete) {
    throw new Error('当前正文尚未完成审稿。请重新检查，或明确选择“未完成审稿，直接采纳”。')
  }
  if (mode === 'unreviewed' && complete) {
    throw new Error('当前正文已有完整审稿，请查看结论后使用正常采纳。')
  }
  return {
    mode,
    draftContentHash: draftContentHash(draft.body),
    editorialRequired,
    qualityGateReportId: report?.id ?? null,
    editorialVerdictId: verdict?.id ?? null,
    qualityStatus: AuthorDecisionPolicyService.assessQualityGate(report).status,
    editorialStatus: verdict?.status ?? 'not_available'
  }
}

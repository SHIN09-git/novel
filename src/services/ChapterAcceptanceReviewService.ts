import type { AppData, ChapterAcceptanceReview, EditorialVerdict, GeneratedChapterDraft, QualityGateReport } from '../shared/types'
import { AuthorDecisionPolicyService } from './AuthorDecisionPolicyService'
import { ChapterTaskContractService } from './ChapterTaskContractService'
import { draftContentHash, latestQualityReportForDraft } from './DraftDiagnosticBindingService'
import { assertHardCanonCanCommit, currentHardCanonAudit, hardCanonReceipt } from './HardCanonPreflight'
import { withCurrentHardCanonAudit } from './qualityGate/hardCanonQuality'

export function hasCompleteChapterReview(report: QualityGateReport | null, verdict: EditorialVerdict | null, editorialRequired: boolean): boolean {
  return Boolean(report && (!editorialRequired || (verdict && verdict.status !== 'incomplete' && verdict.sourceRefs.qualityGateReportId === report.id)))
}

export function prepareDraftCommitReview(input: {
  appData: AppData; targetChapterOrder: number; acceptanceMode?: ChapterAcceptanceReview['mode']
  requireEditorialVerdict?: boolean; reviewedLengthOverflowNotice?: string | null
}, draft: GeneratedChapterDraft): ChapterAcceptanceReview | undefined {
  const review = input.acceptanceMode === undefined ? undefined
    : buildChapterAcceptanceReview(input.appData, draft, input.acceptanceMode, input.requireEditorialVerdict)
  if (!review) assertHardCanonCanCommit(currentHardCanonAudit(input.appData, {
    projectId: draft.projectId, chapterOrder: input.targetChapterOrder, chapterId: draft.chapterId, body: draft.body
  }))
  if (review?.lengthOverflowNotice !== (input.reviewedLengthOverflowNotice ?? undefined)) {
    throw new Error(`${review?.lengthOverflowNotice ?? '正文篇幅已变化。'}请核对当前正文与篇幅要求后重新确认采纳。`)
  }
  return review
}

export function buildChapterAcceptanceReview(
  data: AppData,
  draft: GeneratedChapterDraft,
  mode: ChapterAcceptanceReview['mode'],
  requireEditorialVerdict = false
): ChapterAcceptanceReview {
  if (mode !== 'reviewed' && mode !== 'unreviewed') throw new Error('未知的草稿采纳方式。')
  const job = data.chapterGenerationJobs.find((item) => item.id === draft.jobId && item.projectId === draft.projectId)
  const canon = job ? currentHardCanonAudit(data, { projectId: draft.projectId, chapterOrder: job.targetChapterOrder,
    chapterId: draft.chapterId, body: draft.body }) : null
  assertHardCanonCanCommit(canon)
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
  const lengthOverflowNotice = ChapterTaskContractService.lengthOverflowNotice({ body: draft.body, chapterTask: job?.chapterTaskSnapshot })
  return {
    mode,
    ...(canon ? { hardCanonCheck: hardCanonReceipt(canon) } : {}),
    ...(lengthOverflowNotice ? { lengthOverflowNotice } : {}),
    draftContentHash: draftContentHash(draft.body),
    editorialRequired,
    qualityGateReportId: report?.id ?? null,
    editorialVerdictId: verdict?.id ?? null,
    qualityStatus: AuthorDecisionPolicyService.assessQualityGate(report && withCurrentHardCanonAudit(report, canon)).status,
    editorialStatus: verdict?.status ?? 'not_available'
  }
}

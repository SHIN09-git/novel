import type { AppData, ChapterCommitBundle } from '../../shared/types'
import {
  normalizeConsistencyReviewReport,
  normalizeQualityGateReport,
  normalizeRedundancyReport
} from '../../shared/normalizers/reports'
import { normalizeGenerationRunTrace } from '../../shared/normalizers/runTrace'
import { buildChapterAcceptanceReview } from '../ChapterAcceptanceReviewService'
import { draftContentHash, noveltyAuditMatchesDraft } from '../DraftDiagnosticBindingService'
import { isChapterArchived } from '../ChapterLifecycleService'
import { assertImmutableCommit, requireCommitText } from './commitBundleUtils'

export function validateAcceptanceReviewShape(bundle: ChapterCommitBundle): void {
  const review = bundle.acceptanceReview
  if (review === undefined) return // Legacy commits retain their original review provenance.
  if (!review || !['reviewed', 'unreviewed'].includes(review.mode) || typeof review.editorialRequired !== 'boolean') {
    throw new Error('草稿采纳方式无效。')
  }
  requireCommitText(bundle.generatedDraftId, '采纳记录缺少来源草稿。')
  requireCommitText(bundle.jobId, '采纳记录缺少来源任务。')
  if (review.draftContentHash !== draftContentHash(bundle.chapter.body)) throw new Error('采纳记录与正文不匹配。')
  if (!['not_available', 'passed', 'needs_review', 'blocked'].includes(review.qualityStatus) ||
    !['not_available', 'approved', 'advisory', 'blocked', 'incomplete'].includes(review.editorialStatus)) {
    throw new Error('采纳记录中的审稿状态无效。')
  }
  for (const id of [review.qualityGateReportId, review.editorialVerdictId]) {
    if (id !== null) requireCommitText(id, '采纳记录中的审稿引用无效。')
  }
  if (review.qualityGateReportId !== (bundle.qualityGateReportId ?? null)) throw new Error('采纳记录的质量报告引用不一致。')
  if (!bundle.chapterVersion || !bundle.generatedDraft || bundle.generatedDraft.status !== 'accepted' ||
    bundle.generatedDraft.body !== bundle.chapter.body || bundle.generatedDraft.title !== bundle.chapter.title) {
    throw new Error('采纳记录缺少匹配的正文版本。')
  }
  if (review.mode === 'unreviewed' && [bundle.acceptedMemoryUpdateCandidates, bundle.acceptedCharacterStateChangeCandidates,
    bundle.appliedCharacterStateFacts, bundle.appliedCharacterStateTransactions, bundle.appliedForeshadowingUpdates,
    bundle.appliedTimelineEvents].some((items) => (items?.length ?? 0) > 0)) {
    throw new Error('未审稿采纳只提交正文，故事状态候选请另行确认。')
  }
}

/** Re-evaluate new commits inside the storage transaction; historical replay is checked elsewhere. */
export function validateCurrentAcceptanceReview(bundle: ChapterCommitBundle, data: AppData): void {
  const review = bundle.acceptanceReview
  if (!review) return
  const draft = data.generatedChapterDrafts.find((item) => item.id === bundle.generatedDraftId && item.projectId === bundle.projectId && item.jobId === bundle.jobId)
  const job = data.chapterGenerationJobs.find((item) => item.id === bundle.jobId && item.projectId === bundle.projectId)
  if (!draft || !job) throw new Error('来源草稿或生成任务已不存在，请重新打开当前章节。')
  if (job.status === 'running') throw new Error('生成仍在运行，请先停止或等待完成再采纳。')
  if (draft.body !== bundle.chapter.body || draft.title !== bundle.chapter.title ||
    (draft.chapterId && draft.chapterId !== bundle.chapterId)) throw new Error('来源草稿已变化，请核对最新正文后采纳。')
  const current = buildChapterAcceptanceReview(data, draft, review.mode, review.editorialRequired)
  assertImmutableCommit({ id: bundle.id, ...current }, { id: bundle.id, ...review }, 'ChapterAcceptanceReview')

  const chapter = data.chapters.find((item) => item.projectId === bundle.projectId && item.order === bundle.chapter.order)
  if (chapter && isChapterArchived(chapter)) throw new Error('目标章节已归档，请先恢复章节再采纳。')
  const baseId = bundle.chapterVersion?.baseChapterVersionId
  const base = bundle.previousChapterVersion ?? data.chapterVersions.find((item) => item.id === baseId)
  if (chapter && (chapter.id !== bundle.chapterId || !base || base.projectId !== bundle.projectId ||
    base.chapterId !== chapter.id || base.title !== chapter.title || base.body !== chapter.body)) {
    throw new Error('目标章节已变化，请核对最新版本后采纳。')
  }
  if (!chapter && baseId) throw new Error('目标章节已不存在，请重新打开当前草稿。')
  for (const report of bundle.qualityGateReports ?? []) {
    const stored = data.qualityGateReports.find((item) => item.id === report.id)
    if (!stored) throw new Error('采纳引用的质量报告已不存在。')
    assertImmutableCommit(normalizeQualityGateReport({ ...stored, chapterId: bundle.chapterId }), report, 'QualityGateReport')
  }
  for (const report of bundle.consistencyReviewReports ?? []) {
    const stored = data.consistencyReviewReports.find((item) => item.id === report.id)
    if (!stored) throw new Error('采纳引用的一致性报告已不存在。')
    assertImmutableCommit(normalizeConsistencyReviewReport({ ...stored, chapterId: bundle.chapterId }), report, 'ConsistencyReviewReport')
  }
  for (const report of bundle.redundancyReports ?? []) {
    const stored = data.redundancyReports.find((item) => item.id === report.id)
    if (!stored) throw new Error('采纳引用的冗余报告已不存在。')
    assertImmutableCommit(normalizeRedundancyReport({ ...stored, chapterId: bundle.chapterId, jobId: stored.jobId ?? draft.jobId,
      updatedAt: stored.updatedAt ?? bundle.acceptedAt }), report, 'RedundancyReport')
  }
  if (bundle.generationRunTrace) {
    const stored = data.generationRunTraces.find((item) => item.id === bundle.generationRunTrace?.id)
    if (!stored) throw new Error('采纳引用的生成记录已不存在。')
    // Normalize only the expected snapshot. The submitted receipt must still
    // match exactly; changed evidence, selections and telemetry remain rejected.
    assertImmutableCommit(normalizeGenerationRunTrace({ ...stored, qualityGateReportId: bundle.qualityGateReportId ?? null,
      consistencyReviewReportId: bundle.consistencyReviewReportId ?? null,
      redundancyReportId: bundle.redundancyReports?.[0]?.id ?? null,
      noveltyAuditResult: noveltyAuditMatchesDraft(stored.noveltyAuditResult, draft) ? stored.noveltyAuditResult : null,
      updatedAt: bundle.acceptedAt }), bundle.generationRunTrace, 'GenerationRunTrace')
  }
}

import type { AppData, RevisionCommitBundle } from '../../shared/types'
import { qualityGateEffectivelyPassed } from '../../shared/qualityGatePolicy'
import { draftContentHash } from '../DraftDiagnosticBindingService'

function validateRevisionReviewLinks(bundle: RevisionCommitBundle, data: AppData): void {
  if (bundle.qualityGateReportId === undefined && bundle.consistencyReviewReportId === undefined) return
  const quality = data.qualityGateReports.find(item => item.id === bundle.qualityGateReportId)
  const consistency = data.consistencyReviewReports.find(item => item.id === bundle.consistencyReviewReportId)
  const bodyHash = draftContentHash(bundle.afterText)
  if (!quality || !consistency || quality.projectId !== bundle.projectId || consistency.projectId !== bundle.projectId ||
    quality.chapterId !== bundle.chapterId || consistency.chapterId !== bundle.chapterId ||
    quality.draftContentHash !== bodyHash || consistency.draftContentHash !== bodyHash ||
    !quality.revisionReview || quality.revisionReview.revisionVersionId !== bundle.revisionVersionId ||
    quality.revisionReview.agentRunId !== bundle.actor?.agentRunId || quality.jobId !== consistency.jobId ||
    quality.revisionReview.consistencyReviewReportId !== consistency.id || !qualityGateEffectivelyPassed(quality)) {
    throw new Error('Revision commit requires passing reports bound to this exact revision and chapter.')
  }
}

export function validateRevisionCommitLinks(bundle: RevisionCommitBundle, data: AppData): void {
  validateRevisionReviewLinks(bundle, data)
  if (bundle.linkedChapterCommitId) {
    const linkedCommit = data.chapterCommitBundles.find(
      (commit) => commit.commitId === bundle.linkedChapterCommitId || commit.id === bundle.linkedChapterCommitId
    )
    if (!linkedCommit) {
      throw new Error(`RevisionCommitBundle references missing linkedChapterCommitId ${bundle.linkedChapterCommitId}.`)
    }
    if (linkedCommit.projectId !== bundle.projectId || linkedCommit.chapterId !== bundle.chapterId) {
      throw new Error(`ChapterCommitBundle ${linkedCommit.commitId} does not match the target chapter.`)
    }
  }

  if (bundle.linkedGenerationRunTraceId) {
    const linkedTrace =
      bundle.generationRunTrace?.id === bundle.linkedGenerationRunTraceId
        ? bundle.generationRunTrace
        : data.generationRunTraces.find((trace) => trace.id === bundle.linkedGenerationRunTraceId)
    if (!linkedTrace) {
      throw new Error(
        `RevisionCommitBundle references missing linkedGenerationRunTraceId ${bundle.linkedGenerationRunTraceId}.`
      )
    }
    if (linkedTrace.projectId !== bundle.projectId || linkedTrace.targetChapterOrder !== bundle.chapter.order) {
      throw new Error(`GenerationRunTrace ${linkedTrace.id} does not match the target chapter.`)
    }
    if (bundle.generatedDraft && linkedTrace.jobId !== bundle.generatedDraft.jobId) {
      throw new Error(`GenerationRunTrace ${linkedTrace.id} does not match the generated draft job.`)
    }
  }
}

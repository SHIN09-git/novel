import type { AppData, ChapterCommitBundle } from '../../shared/types'
import { draftContentHash } from '../DraftDiagnosticBindingService'

// The primary quality result is re-elected below. Secondary diagnostics (including
// ID-only links) must not carry evidence from another draft or an older body either.
export function validateDiagnosticBindings(bundle: ChapterCommitBundle, data: AppData): void {
  type Report = { id: string; draftId?: string | null; draftContentHash?: string | null }
  let hash: string | undefined
  function check(report: Report) {
    if ((bundle.generatedDraftId && report.draftId && report.draftId !== bundle.generatedDraftId) ||
      (report.draftContentHash && report.draftContentHash !== (hash ??= draftContentHash(bundle.chapter.body))) ||
      (bundle.acceptanceReview && (!report.draftContentHash || !report.draftId))) {
      throw new Error(`Report ${report.id} does not match the accepted draft text.`)
    }
  }
  function checkLinks(incoming: readonly Report[] = [], stored: readonly Report[], primary?: string | null) {
    const ids = new Set(incoming.map(report => report.id))
    if (primary) ids.add(primary)
    if (!ids.size) return
    for (const report of incoming) check(report)
    for (const report of stored) if (ids.has(report.id)) check(report)
  }
  checkLinks(bundle.qualityGateReports, data.qualityGateReports, bundle.qualityGateReportId)
  checkLinks(bundle.consistencyReviewReports, data.consistencyReviewReports, bundle.consistencyReviewReportId)
  checkLinks(bundle.redundancyReports, data.redundancyReports)
}

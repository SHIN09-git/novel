import type {
  AppData,
  ConsistencyReviewReport,
  GeneratedChapterDraft,
  GenerationRunTrace,
  ID,
  QualityGateReport,
  RedundancyReport
} from '../../shared/types'
import {
  latestConsistencyReportsForDraft,
  latestQualityReportForDraft,
  latestRedundancyReportForDraft,
  qualityReportMatchesDraft,
  consistencyReportMatchesDraft,
  redundancyReportMatchesDraft
} from '../DraftDiagnosticBindingService'

function newestFirst<T extends { createdAt: string; id: string }>(left: T, right: T): number {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
}

export interface TraceLookupParams {
  traceId?: ID
  jobId?: ID
}

export function findTrace(appData: AppData, params: TraceLookupParams): GenerationRunTrace {
  const trace = params.traceId
    ? appData.generationRunTraces.find((item) => item.id === params.traceId)
    : params.jobId
      ? [...appData.generationRunTraces]
          .filter((item) => item.jobId === params.jobId)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      : null
  if (!trace) throw new Error('缺少生成追踪记录，无法构建作者诊断摘要。')
  return trace
}

export function findDraft(appData: AppData, trace: GenerationRunTrace): GeneratedChapterDraft | null {
  return (
    [...appData.generatedChapterDrafts]
      .filter((item) => item.projectId === trace.projectId && item.jobId === trace.jobId)
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || newestFirst(left, right)
      )[0] ?? null
  )
}

export function findQualityReport(
  appData: AppData,
  trace: GenerationRunTrace,
  draft: GeneratedChapterDraft | null
): QualityGateReport | null {
  const scopedReports = appData.qualityGateReports.filter(
    (item) => item.projectId === trace.projectId && item.jobId === trace.jobId
  )
  if (draft) {
    const referenced = trace.qualityGateReportId
      ? scopedReports.find((item) => item.id === trace.qualityGateReportId) ?? null
      : null
    if (referenced && qualityReportMatchesDraft(referenced, draft)) return referenced
    return latestQualityReportForDraft(scopedReports, draft)
  }
  if (trace.qualityGateReportId) {
    const report = scopedReports.find((item) => item.id === trace.qualityGateReportId)
    if (report) return report
  }
  return [...scopedReports].sort(newestFirst)[0] ?? null
}

export function findConsistencyReport(
  appData: AppData,
  trace: GenerationRunTrace,
  draft: GeneratedChapterDraft | null
): ConsistencyReviewReport | null {
  const scopedReports = appData.consistencyReviewReports.filter(
    (item) => item.projectId === trace.projectId && item.jobId === trace.jobId
  )
  if (draft) {
    const referenced = trace.consistencyReviewReportId
      ? scopedReports.find((item) => item.id === trace.consistencyReviewReportId) ?? null
      : null
    if (referenced && consistencyReportMatchesDraft(referenced, draft)) return referenced
    return latestConsistencyReportsForDraft(scopedReports, draft)[0] ?? null
  }
  if (trace.consistencyReviewReportId) {
    const report = scopedReports.find((item) => item.id === trace.consistencyReviewReportId)
    if (report) return report
  }
  return [...scopedReports].sort(newestFirst)[0] ?? null
}

export function findRedundancyReport(
  appData: AppData,
  trace: GenerationRunTrace,
  draft: GeneratedChapterDraft | null
): RedundancyReport | null {
  const scopedReports = appData.redundancyReports.filter(
    (item) => item.projectId === trace.projectId && (!item.jobId || item.jobId === trace.jobId)
  )
  if (draft) {
    const referenced = trace.redundancyReportId
      ? scopedReports.find((item) => item.id === trace.redundancyReportId) ?? null
      : null
    if (referenced && redundancyReportMatchesDraft(referenced, draft)) return referenced
    return latestRedundancyReportForDraft(scopedReports, draft)
  }
  if (trace.redundancyReportId) {
    const report = scopedReports.find((item) => item.id === trace.redundancyReportId)
    if (report) return report
  }
  return [...scopedReports].sort(newestFirst)[0] ?? null
}

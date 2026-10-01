import type {
  AppData,
  ConsistencyReviewReport,
  GeneratedChapterDraft,
  NoveltyAuditResult,
  QualityGateReport,
  RedundancyReport
} from '../shared/types'

const DIAGNOSTIC_STEP_TYPES = new Set([
  'generate_chapter_review',
  'propose_character_updates',
  'propose_foreshadowing_updates',
  'consistency_review',
  'quality_gate',
  'await_user_confirmation'
])

function normalizedDraftBody(body: string): string {
  return String(body ?? '').replace(/\r\n?/g, '\n')
}

/** Stable, renderer-safe 64-bit FNV-1a fingerprint; no正文 is stored in reports. */
export function draftContentHash(body: string): string {
  const normalized = normalizedDraftBody(body)
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= BigInt(normalized.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `draft-v1-${hash.toString(16).padStart(16, '0')}-${normalized.length}`
}

function newestFirst<T extends { createdAt: string; id: string }>(left: T, right: T): number {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
}

export function qualityReportMatchesDraft(report: QualityGateReport, draft: GeneratedChapterDraft): boolean {
  return report.draftId === draft.id && Boolean(report.draftContentHash) && report.draftContentHash === draftContentHash(draft.body)
}

export function qualityReportMatchesText(report: QualityGateReport, body: string): boolean {
  return Boolean(report.draftContentHash) && report.draftContentHash === draftContentHash(body)
}

export function consistencyReportMatchesDraft(report: ConsistencyReviewReport, draft: GeneratedChapterDraft): boolean {
  return report.draftId === draft.id && Boolean(report.draftContentHash) && report.draftContentHash === draftContentHash(draft.body)
}

export function redundancyReportMatchesDraft(report: RedundancyReport, draft: GeneratedChapterDraft): boolean {
  return report.draftId === draft.id && Boolean(report.draftContentHash) && report.draftContentHash === draftContentHash(draft.body)
}

export function noveltyAuditMatchesDraft(audit: NoveltyAuditResult | null | undefined, draft: GeneratedChapterDraft): boolean {
  return Boolean(
    audit &&
      audit.sourceDraftId === draft.id &&
      audit.sourceContentHash &&
      audit.sourceContentHash === draftContentHash(draft.body)
  )
}

export function bindNoveltyAuditToDraft(audit: NoveltyAuditResult, draft: GeneratedChapterDraft, auditedAt = new Date().toISOString()): NoveltyAuditResult {
  return {
    ...audit,
    sourceDraftId: draft.id,
    sourceContentHash: draftContentHash(draft.body),
    auditedAt
  }
}

export function latestQualityReportForDraft(reports: QualityGateReport[], draft: GeneratedChapterDraft): QualityGateReport | null {
  return [...reports].filter((report) => qualityReportMatchesDraft(report, draft)).sort(newestFirst)[0] ?? null
}

export function latestQualityReportForText(reports: QualityGateReport[], body: string): QualityGateReport | null {
  return [...reports].filter((report) => qualityReportMatchesText(report, body)).sort(newestFirst)[0] ?? null
}

export function latestConsistencyReportsForDraft(
  reports: ConsistencyReviewReport[],
  draft: GeneratedChapterDraft
): ConsistencyReviewReport[] {
  return [...reports].filter((report) => consistencyReportMatchesDraft(report, draft)).sort(newestFirst)
}

export function latestRedundancyReportForDraft(reports: RedundancyReport[], draft: GeneratedChapterDraft): RedundancyReport | null {
  return [...reports].filter((report) => redundancyReportMatchesDraft(report, draft)).sort(newestFirst)[0] ?? null
}

/**
 * Preserve historical diagnostics, but detach them from the mutable draft and
 * reopen the review chain. The next retry resumes from the first invalid step.
 */
export function invalidateDraftDiagnosticsAfterChange(
  data: AppData,
  draftId: string,
  nextBody: string,
  updatedAt: string
): AppData {
  const draft = data.generatedChapterDrafts.find((item) => item.id === draftId)
  if (!draft || draft.body === nextBody) return data
  const jobId = draft.jobId
  let firstInvalidStepSeen = false
  return {
    ...data,
    generatedChapterDrafts: data.generatedChapterDrafts.map((item) =>
      item.id === draftId ? { ...item, body: nextBody, updatedAt } : item
    ),
    chapterGenerationSteps: data.chapterGenerationSteps.map((step) => {
      if (step.jobId !== jobId || !DIAGNOSTIC_STEP_TYPES.has(step.type)) return step
      if (!firstInvalidStepSeen) {
        firstInvalidStepSeen = true
        return {
          ...step,
          status: 'failed',
          output: '',
          errorMessage: '正文已修订，旧审稿与质量报告已失效；请重试此步骤生成当前正文的诊断。',
          updatedAt
        }
      }
      return { ...step, status: 'pending', output: '', errorMessage: '', updatedAt }
    }),
    chapterGenerationJobs: data.chapterGenerationJobs.map((job) =>
      job.id === jobId
        ? {
            ...job,
            status: 'failed',
            currentStep: 'generate_chapter_review',
            errorMessage: '正文已修订，需要重新执行复盘、审稿和质量门禁。',
            updatedAt
          }
        : job
    ),
    generationRunTraces: data.generationRunTraces.map((trace) =>
      trace.jobId === jobId
        ? {
            ...trace,
            noveltyAuditResult: null,
            consistencyReviewReportId: null,
            qualityGateReportId: null,
            redundancyReportId: null,
            updatedAt
          }
        : trace
    ),
    runTraceAuthorSummaries: data.runTraceAuthorSummaries.filter(
      (summary) => summary.jobId !== jobId && summary.generatedDraftId !== draftId
    )
  }
}

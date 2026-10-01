import type { AppData, ID } from '../shared/types'
import { findActiveChapterByOrder } from '../services/ChapterLifecycleService'
import {
  latestConsistencyReportsForDraft,
  latestQualityReportForDraft,
  latestRedundancyReportForDraft,
  noveltyAuditMatchesDraft
} from '../services/DraftDiagnosticBindingService'
import {
  authorSummary,
  byUpdatedAtDesc,
  consistencySummary,
  findProject,
  latestJobForChapter,
  latestReport,
  pendingReviewForProject,
  qualitySummary,
  redundancySummary,
  summarizeJob
} from './agentSummaryHelpers'
import { compact } from './agentReadableText'
import type { AgentChapterState, AgentRunDiagnostics } from './agentReadableSummaryTypes'

interface ScopedRecord {
  projectId: ID
  jobId?: ID | null
  chapterId?: ID | null
}

function belongsToRunOrChapter(
  record: ScopedRecord,
  projectId: ID,
  jobId: ID | null,
  chapterId: ID | null
): boolean {
  if (record.projectId !== projectId) return false
  if (jobId && record.jobId === jobId) return true
  if (chapterId && record.chapterId === chapterId) return true
  return false
}

export function getChapterProductionState(
  data: AppData,
  projectId: ID,
  chapterOrder: number
): AgentChapterState {
  const project = findProject(data, projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  const chapter = findActiveChapterByOrder(data.chapters, projectId, chapterOrder)
  const latestJob = latestJobForChapter(data, projectId, chapterOrder)
  const drafts = data.generatedChapterDrafts
    .filter((draft) => {
      if (draft.projectId !== projectId) return false
      if (latestJob) return draft.jobId === latestJob.id
      return Boolean(chapter && draft.chapterId === chapter.id)
    })
    .sort(byUpdatedAtDesc)
  const latestDraft = drafts[0] ?? null
  const quality = latestDraft
    ? latestQualityReportForDraft(
        data.qualityGateReports.filter((report) => report.projectId === projectId && report.jobId === latestDraft.jobId),
        latestDraft
      )
    : latestReport(
        data.qualityGateReports.filter((report) =>
          belongsToRunOrChapter(report, projectId, latestJob?.id ?? null, chapter?.id ?? null)
        )
      )
  const consistency = latestDraft
    ? latestConsistencyReportsForDraft(
        data.consistencyReviewReports.filter((report) => report.projectId === projectId && report.jobId === latestDraft.jobId),
        latestDraft
      )[0] ?? null
    : latestReport(
        data.consistencyReviewReports.filter((report) =>
          belongsToRunOrChapter(report, projectId, latestJob?.id ?? null, chapter?.id ?? null)
        )
      )
  const redundancy = latestDraft
    ? latestRedundancyReportForDraft(
        data.redundancyReports.filter((report) => report.projectId === projectId && report.jobId === latestDraft.jobId),
        latestDraft
      )
    : latestReport(
        data.redundancyReports.filter((report) =>
          belongsToRunOrChapter(report, projectId, latestJob?.id ?? null, chapter?.id ?? null)
        )
      )
  const summary = latestReport(
    data.runTraceAuthorSummaries.filter((item) => {
      if (!belongsToRunOrChapter(item, projectId, latestJob?.id ?? null, chapter?.id ?? null)) return false
      if (!latestDraft) return true
      if (item.generatedDraftId !== latestDraft.id || item.createdAt < latestDraft.updatedAt) return false
      if (item.sourceRefs.qualityGateReportId && item.sourceRefs.qualityGateReportId !== quality?.id) return false
      if (item.sourceRefs.consistencyReviewReportId && item.sourceRefs.consistencyReviewReportId !== consistency?.id) return false
      return true
    })
  )
  const chapterVersions = chapter
    ? data.chapterVersions
        .filter((version) => version.chapterId === chapter.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : []

  return {
    projectId,
    chapterOrder,
    chapter: chapter
      ? {
          id: chapter.id,
          title: chapter.title,
          updatedAt: chapter.updatedAt,
          bodyCharCount: chapter.body.length,
          summary: compact(chapter.summary),
          endingHook: compact(chapter.endingHook)
        }
      : null,
    latestJob: summarizeJob(latestJob),
    drafts: drafts.slice(0, 5).map((draft) => ({
      id: draft.id,
      jobId: draft.jobId,
      title: draft.title,
      status: draft.status,
      bodyCharCount: draft.body.length,
      tokenEstimate: draft.tokenEstimate,
      updatedAt: draft.updatedAt
    })),
    diagnostics: {
      qualityGate: qualitySummary(quality),
      consistency: consistencySummary(consistency),
      redundancy: redundancySummary(redundancy),
      authorSummary: authorSummary(summary)
    },
    versionChain: {
      currentUpdatedAt: chapter?.updatedAt ?? null,
      historicalVersionCount: chapterVersions.length,
      latestHistoricalVersion: chapterVersions[0]
        ? {
            id: chapterVersions[0].id,
            source: chapterVersions[0].source,
            createdAt: chapterVersions[0].createdAt,
            bodyCharCount: chapterVersions[0].body.length
          }
        : null
    },
    pendingReview: pendingReviewForProject(data, projectId, latestJob?.id ?? null, chapter?.id ?? null)
  }
}

export function getRunDiagnostics(data: AppData, jobId: ID): AgentRunDiagnostics {
  const job = data.chapterGenerationJobs.find((item) => item.id === jobId) ?? null
  const trace = data.generationRunTraces.find((item) => item.jobId === jobId) ?? null
  const draft = [...data.generatedChapterDrafts]
    .filter((item) => item.jobId === jobId)
    .sort(byUpdatedAtDesc)[0] ?? null
  const quality = draft
    ? latestQualityReportForDraft(data.qualityGateReports.filter((report) => report.jobId === jobId), draft)
    : null
  const consistency = draft
    ? latestConsistencyReportsForDraft(data.consistencyReviewReports.filter((report) => report.jobId === jobId), draft)[0] ?? null
    : null
  const summary = latestReport(
    data.runTraceAuthorSummaries.filter((item) => {
      if (item.jobId !== jobId && item.traceId !== trace?.id) return false
      if (!draft) return true
      if (item.generatedDraftId !== draft.id || item.createdAt < draft.updatedAt) return false
      if (item.sourceRefs.qualityGateReportId && item.sourceRefs.qualityGateReportId !== quality?.id) return false
      if (item.sourceRefs.consistencyReviewReportId && item.sourceRefs.consistencyReviewReportId !== consistency?.id) return false
      return true
    })
  )
  return {
    job: summarizeJob(job),
    steps: data.chapterGenerationSteps
      .filter((step) => step.jobId === jobId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((step) => ({
        id: step.id,
        type: step.type,
        status: step.status,
        errorMessage: compact(step.errorMessage, 300),
        outputCharCount: step.output.length,
        updatedAt: step.updatedAt
      })),
    trace: trace
      ? {
          id: trace.id,
          contextSource: trace.contextSource,
          selectedCounts: {
            chapters: trace.selectedChapterIds.length,
            stageSummaries: trace.selectedStageSummaryIds.length,
            characters: trace.selectedCharacterIds.length,
            foreshadowings: trace.selectedForeshadowingIds.length,
            timelineEvents: trace.selectedTimelineEventIds.length,
            characterStateFacts: trace.includedCharacterStateFactIds.length,
            hardCanonItems: trace.includedHardCanonItemIds.length
          },
          omittedContextItemCount: trace.omittedContextItems.length,
          contextWarningCount: trace.contextWarnings.length,
          finalPromptTokenEstimate: trace.finalPromptTokenEstimate,
          noveltySeverity:
            draft && noveltyAuditMatchesDraft(trace.noveltyAuditResult, draft)
              ? trace.noveltyAuditResult?.severity ?? null
              : null
        }
      : null,
    authorSummary: authorSummary(summary)
  }
}

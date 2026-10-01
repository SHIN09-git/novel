import { useMemo } from 'react'
import type { ID } from '../../../../shared/types'
import type { projectData } from '../../utils/projectData'
import { PIPELINE_STEP_ORDER } from './pipelineStepDefinitions'
import {
  latestConsistencyReportsForDraft,
  latestQualityReportForDraft,
  latestRedundancyReportForDraft,
  noveltyAuditMatchesDraft,
  qualityReportMatchesDraft
} from '../../../../services/DraftDiagnosticBindingService'

type ScopedProjectData = ReturnType<typeof projectData>

export function useSelectedPipelineJob(scoped: ScopedProjectData, selectedJobId: ID | null, preparingNewTask = false) {
  const jobs = useMemo(
    () => [...scoped.chapterGenerationJobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [scoped.chapterGenerationJobs]
  )
  const selectedJob = preparingNewTask ? null : jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null
  const selectedSteps = useMemo(
    () =>
      selectedJob
        ? scoped.chapterGenerationSteps
            .filter((step) => step.jobId === selectedJob.id)
            .sort((a, b) => PIPELINE_STEP_ORDER.indexOf(a.type) - PIPELINE_STEP_ORDER.indexOf(b.type))
        : [],
    [scoped.chapterGenerationSteps, selectedJob]
  )
  const selectedDrafts = selectedJob
    ? [...scoped.generatedChapterDrafts]
        .filter((draft) => draft.jobId === selectedJob.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt))
    : []
  const latestDraft = selectedDrafts[0] ?? null
  const selectedCandidates = selectedJob ? scoped.memoryUpdateCandidates.filter((candidate) => candidate.jobId === selectedJob.id) : []
  const selectedReports = selectedJob && latestDraft
    ? latestConsistencyReportsForDraft(scoped.consistencyReviewReports.filter((report) => report.jobId === selectedJob.id), latestDraft)
    : []
  const selectedQualityReports = selectedJob && latestDraft
    ? scoped.qualityGateReports
        .filter((report) => report.jobId === selectedJob.id && qualityReportMatchesDraft(report, latestDraft))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    : []
  const selectedRevisionCandidates = selectedJob ? scoped.revisionCandidates.filter((candidate) => candidate.jobId === selectedJob.id) : []
  const latestQualityReport = latestDraft ? latestQualityReportForDraft(selectedQualityReports, latestDraft) : null
  const traceRedundancyReport = latestDraft
    ? latestRedundancyReportForDraft(scoped.redundancyReports.filter((report) => report.jobId === selectedJob?.id), latestDraft)
    : null
  const rawSelectedTrace = selectedJob ? scoped.generationRunTraces.find((trace) => trace.jobId === selectedJob.id) ?? null : null
  const selectedTrace = rawSelectedTrace && latestDraft
    ? {
        ...rawSelectedTrace,
        consistencyReviewReportId: selectedReports[0]?.id ?? null,
        qualityGateReportId: latestQualityReport?.id ?? null,
        redundancyReportId: traceRedundancyReport?.id ?? null,
        noveltyAuditResult: noveltyAuditMatchesDraft(rawSelectedTrace.noveltyAuditResult, latestDraft)
          ? rawSelectedTrace.noveltyAuditResult
          : null
      }
    : rawSelectedTrace
  const selectedAuthorSummary = selectedTrace
    ? scoped.runTraceAuthorSummaries.find(
        (summary) =>
          (summary.traceId === selectedTrace.id || summary.jobId === selectedTrace.jobId) &&
          Boolean(latestQualityReport || selectedReports[0]) &&
          (!latestQualityReport || summary.sourceRefs.qualityGateReportId === latestQualityReport.id) &&
          (!selectedReports[0] || summary.sourceRefs.consistencyReviewReportId === selectedReports[0].id)
      ) ?? null
    : null
  const selectedTraceSnapshot = selectedTrace?.promptContextSnapshotId
    ? scoped.promptContextSnapshots.find((snapshot) => snapshot.id === selectedTrace.promptContextSnapshotId) ?? null
    : null
  const consistencyIssueById = useMemo(() => {
    return new Map(selectedReports.flatMap((report) => report.issues.map((issue) => [issue.id, issue] as const)))
  }, [selectedReports])
  const traceConsistencyReport = selectedTrace?.consistencyReviewReportId
    ? selectedReports.find((report) => report.id === selectedTrace.consistencyReviewReportId) ?? selectedReports[0] ?? null
    : selectedReports[0] ?? null
  const traceQualityReport = selectedTrace?.qualityGateReportId
    ? selectedQualityReports.find((report) => report.id === selectedTrace.qualityGateReportId) ?? latestQualityReport
    : latestQualityReport
  const traceContinuityBridge = selectedTrace?.continuityBridgeId
    ? scoped.chapterContinuityBridges.find((bridge) => bridge.id === selectedTrace.continuityBridgeId) ?? null
    : null
  const selectedStepsKey = selectedSteps.map((step) => `${step.id}:${step.status}:${step.output.length}`).join('|')

  return {
    jobs,
    selectedJob,
    selectedSteps,
    selectedDrafts,
    selectedCandidates,
    selectedReports,
    selectedQualityReports,
    selectedRevisionCandidates,
    selectedTrace,
    selectedAuthorSummary,
    selectedTraceSnapshot,
    consistencyIssueById,
    latestDraft,
    latestQualityReport,
    traceConsistencyReport,
    traceQualityReport,
    traceContinuityBridge,
    traceRedundancyReport,
    selectedStepsKey
  }
}

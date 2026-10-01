import type {
  AppData,
  Chapter,
  ChapterGenerationJob,
  ConsistencyReviewReport,
  ID,
  Project,
  QualityGateReport,
  RedundancyReport,
  RunTraceAuthorSummary
} from '../shared/types'
import { compact } from './agentReadableText'

export interface AgentJobSummary {
  id: ID
  projectId: ID
  targetChapterOrder: number
  contextSource: string
  status: string
  currentStep: string | null
  createdAt: string
  updatedAt: string
  errorMessage: string
}

export interface AgentPendingReviewSummary {
  memoryCandidates: number
  characterStateCandidates: number
  acceptedMemoryCandidates: number
  rejectedMemoryCandidates: number
  acceptedCharacterStateCandidates: number
  rejectedCharacterStateCandidates: number
}

export interface AgentQualityGateDigest {
  reportId: ID
  pass: boolean
  overallScore: number
  issueCount: number
  requiredFixCount: number
}

export interface AgentConsistencyDigest {
  reportId: ID
  severitySummary: string
  issueCount: number
  highIssueCount: number
}

export interface AgentRedundancyDigest {
  reportId: ID
  score: number
  suggestionCount: number
}

export interface AgentAuthorSummaryDigest {
  id: ID
  overallStatus: string
  oneLineDiagnosis: string
  nextActionLabels: string[]
}

export function byUpdatedAtDesc<T extends { updatedAt?: string; createdAt?: string }>(a: T, b: T): number {
  return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))
}

export function byChapterOrderDesc(a: Chapter, b: Chapter): number {
  return b.order - a.order
}

export function summarizeJob(job: ChapterGenerationJob | null): AgentJobSummary | null {
  if (!job) return null
  return {
    id: job.id,
    projectId: job.projectId,
    targetChapterOrder: job.targetChapterOrder,
    contextSource: job.contextSource,
    status: job.status,
    currentStep: job.currentStep,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    errorMessage: compact(job.errorMessage, 300)
  }
}

export function latestJobForProject(
  data: Pick<AppData, 'chapterGenerationJobs'>,
  projectId: ID
): ChapterGenerationJob | null {
  return [...data.chapterGenerationJobs]
    .filter((job) => job.projectId === projectId)
    .sort(byUpdatedAtDesc)[0] ?? null
}

export function latestJobForChapter(data: AppData, projectId: ID, chapterOrder: number): ChapterGenerationJob | null {
  return [...data.chapterGenerationJobs]
    .filter((job) => job.projectId === projectId && job.targetChapterOrder === chapterOrder)
    .sort(byUpdatedAtDesc)[0] ?? null
}

export function latestReport<T extends { createdAt: string }>(reports: T[]): T | null {
  return [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
}

export function pendingReviewForProject(
  data: Pick<AppData, 'memoryUpdateCandidates' | 'characterStateChangeCandidates'>,
  projectId: ID,
  jobId?: ID | null,
  chapterId?: ID | null
): AgentPendingReviewSummary {
  const memory = data.memoryUpdateCandidates.filter((candidate) => {
    if (candidate.projectId !== projectId) return false
    if (jobId && candidate.jobId && candidate.jobId !== jobId) return false
    if (chapterId && !jobId && candidate.targetId && candidate.targetId !== chapterId) return false
    return true
  })
  const characterState = data.characterStateChangeCandidates.filter((candidate) => {
    if (candidate.projectId !== projectId) return false
    if (jobId && candidate.jobId && candidate.jobId !== jobId) return false
    if (chapterId && candidate.chapterId && candidate.chapterId !== chapterId) return false
    return true
  })
  return {
    memoryCandidates: memory.filter((candidate) => candidate.status === 'pending').length,
    characterStateCandidates: characterState.filter((candidate) => candidate.status === 'pending').length,
    acceptedMemoryCandidates: memory.filter((candidate) => candidate.status === 'accepted').length,
    rejectedMemoryCandidates: memory.filter((candidate) => candidate.status === 'rejected').length,
    acceptedCharacterStateCandidates: characterState.filter((candidate) => candidate.status === 'accepted').length,
    rejectedCharacterStateCandidates: characterState.filter((candidate) => candidate.status === 'rejected').length
  }
}

export function qualitySummary(report: QualityGateReport | null): AgentQualityGateDigest | null {
  if (!report) return null
  return {
    reportId: report.id,
    pass: report.pass,
    overallScore: report.overallScore,
    issueCount: report.issues.length,
    requiredFixCount: report.requiredFixes.length
  }
}

export function consistencySummary(report: ConsistencyReviewReport | null): AgentConsistencyDigest | null {
  if (!report) return null
  return {
    reportId: report.id,
    severitySummary: report.severitySummary,
    issueCount: report.issues.length,
    highIssueCount: report.issues.filter((issue) => issue.severity === 'high').length
  }
}

export function redundancySummary(report: RedundancyReport | null): AgentRedundancyDigest | null {
  if (!report) return null
  return {
    reportId: report.id,
    score: report.overallRedundancyScore,
    suggestionCount: report.compressionSuggestions.length
  }
}

export function authorSummary(summary: RunTraceAuthorSummary | null): AgentAuthorSummaryDigest | null {
  if (!summary) return null
  return {
    id: summary.id,
    overallStatus: summary.overallStatus,
    oneLineDiagnosis: compact(summary.oneLineDiagnosis, 260),
    nextActionLabels: summary.nextActions.map((action) => action.label).slice(0, 5)
  }
}

export function findProject(data: Pick<AppData, 'projects'>, projectId: ID): Project | null {
  return data.projects.find((project) => project.id === projectId) ?? null
}

import type { AppData, GeneratedChapterDraft } from '../shared/types'
import { redactSensitiveText } from '../shared/errorUtils'
import { AuthorDecisionPolicyService } from '../services/AuthorDecisionPolicyService'
import {
  draftContentHash,
  latestConsistencyReportsForDraft,
  latestQualityReportForDraft,
  latestRedundancyReportForDraft,
  noveltyAuditMatchesDraft
} from '../services/DraftDiagnosticBindingService'
import { currentHardCanonAudit, hardCanonReceipt } from '../services/HardCanonPreflight'

export const AGENT_DRAFT_REPORT_KINDS = [
  'quality_gate', 'consistency', 'novelty', 'redundancy', 'editorial', 'hard_canon'
] as const
export type AgentDraftReportKind = typeof AGENT_DRAFT_REPORT_KINDS[number]

export class AgentDraftReviewError extends Error {
  constructor(readonly code: 'DRAFT_VERSION_CHANGED' | 'DRAFT_REPORT_CHANGED' | 'DRAFT_REPORT_UNAVAILABLE', message: string) {
    super(message)
  }
}

export function assertAgentDraftContent(draft: GeneratedChapterDraft, expected?: string): string {
  const hash = draftContentHash(draft.body)
  if (expected !== undefined && expected !== hash) {
    throw new AgentDraftReviewError('DRAFT_VERSION_CHANGED', '正文已变化。请重新读取章节工作单和当前正文。')
  }
  return hash
}

export function collectAgentDraftReview(data: AppData, draft: GeneratedChapterDraft) {
  const sameJob = (item: { jobId?: string | null; projectId: string }) =>
    item.jobId === draft.jobId && item.projectId === draft.projectId
  const trace = data.generationRunTraces.filter(sameJob)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))[0] ?? null
  return {
    quality: latestQualityReportForDraft(data.qualityGateReports.filter(sameJob), draft),
    consistency: latestConsistencyReportsForDraft(data.consistencyReviewReports.filter(sameJob), draft)[0] ?? null,
    redundancy: latestRedundancyReportForDraft(data.redundancyReports.filter(sameJob), draft),
    editorial: AuthorDecisionPolicyService.latestEditorialVerdictForDraft(data.editorialVerdicts.filter(sameJob), draft),
    novelty: trace && noveltyAuditMatchesDraft(trace.noveltyAuditResult, draft) ? trace.noveltyAuditResult ?? null : null,
    traceId: trace?.id ?? null
  }
}

export function agentDraftReportRecords(
  review: ReturnType<typeof collectAgentDraftReview>,
  canon: ReturnType<typeof currentHardCanonAudit>
) {
  const canonId = hardCanonReceipt(canon)?.resultFingerprint
  return {
    quality_gate: review.quality && { id: review.quality.id, report: review.quality },
    consistency: review.consistency && { id: review.consistency.id, report: review.consistency },
    novelty: review.novelty && review.traceId ? { id: review.traceId, report: review.novelty } : null,
    redundancy: review.redundancy && { id: review.redundancy.id, report: review.redundancy },
    editorial: review.editorial && { id: review.editorial.id, report: review.editorial },
    hard_canon: canon && canonId ? { id: canonId, report: canon } : null
  }
}

function redactReport(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') return redactSensitiveText(value, secrets)
  if (Array.isArray(value)) return value.map(item => redactReport(item, secrets))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactReport(item, secrets)]))
  }
  return value
}

export function readAgentDraftReviewReport(data: AppData, input: {
  projectId: string
  jobId: string
  draftId: string
  kind: AgentDraftReportKind
  expectedDraftContentHash?: string
  reportId?: string
}) {
  const job = data.chapterGenerationJobs.find(item => item.id === input.jobId && item.projectId === input.projectId)
  const draft = job && data.generatedChapterDrafts.find(item =>
    item.id === input.draftId && item.jobId === job.id && item.projectId === job.projectId)
  if (!draft) throw new Error('本项目与任务下找不到指定的草稿。')
  const contentHash = assertAgentDraftContent(draft, input.expectedDraftContentHash)
  const canon = input.kind === 'hard_canon' ? currentHardCanonAudit(data, {
    projectId: draft.projectId, chapterOrder: job.targetChapterOrder, chapterId: draft.chapterId, body: draft.body
  }) : null
  const entry = agentDraftReportRecords(collectAgentDraftReview(data, draft), canon)[input.kind]
  if (!entry) {
    throw new AgentDraftReviewError('DRAFT_REPORT_UNAVAILABLE', '当前正文没有这项有效报告。请刷新工作单，不要用旧报告代替。')
  }
  if (input.reportId !== undefined && entry.id !== input.reportId) {
    throw new AgentDraftReviewError('DRAFT_REPORT_CHANGED', '该报告已被新报告替代。请刷新工作单后查看。')
  }
  return {
    projectId: draft.projectId, jobId: draft.jobId, draftId: draft.id, draftContentHash: contentHash,
    kind: input.kind, reportId: entry.id, report: redactReport(entry.report, [data.settings.apiKey])
  }
}

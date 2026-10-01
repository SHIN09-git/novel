import { randomUUID } from 'node:crypto'
import { AgentRunService } from './AgentRunService'
import { AuthorDecisionPolicyService } from '../services/AuthorDecisionPolicyService'
import { ChapterTaskContractService } from '../services/ChapterTaskContractService'
import type {
  AgentActionPreview,
  AgentDecision,
  AgentDecisionAction,
  AgentRiskLevel,
  AppData,
  ChapterGenerationJob,
  ConsistencyReviewReport,
  EditorialVerdict,
  GeneratedChapterDraft,
  ID,
  QualityGateReport,
  RedundancyReport,
  RunTraceAuthorSummary
} from '../shared/types'
import {
  latestConsistencyReportsForDraft,
  latestQualityReportForDraft,
  latestRedundancyReportForDraft,
  noveltyAuditMatchesDraft
} from '../services/DraftDiagnosticBindingService'

export type AgentAcceptanceRecommendationType = 'accept' | 'revise' | 'reject' | 'wait' | 'pause'

export interface AgentAcceptanceRecommendation {
  jobId: ID
  recommendation: AgentAcceptanceRecommendationType
  confidence: number
  riskLevel: AgentRiskLevel
  reasons: string[]
  draftId: ID | null
  nextActions: string[]
  requiresHumanApproval: boolean
}

export interface RecordAcceptanceDecisionInput {
  appData: AppData
  agentRunId: ID
  jobId: ID
}

export interface RecordAcceptanceDecisionResult {
  appData: AppData
  decision: AgentDecision
  preview: AgentActionPreview
  recommendation: AgentAcceptanceRecommendation
}

function now(): string {
  return new Date().toISOString()
}

function newId(prefix: string): ID {
  return `${prefix}-${randomUUID()}`
}

function compact(value: string | null | undefined, maxLength = 260): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

function byUpdatedAtDesc<T extends { updatedAt?: string; createdAt?: string }>(a: T, b: T): number {
  return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))
}

function latestReport<T extends { createdAt: string }>(reports: T[]): T | null {
  return [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
}

function upsertById<T extends { id: ID }>(items: T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id)
  if (index < 0) return [...items, next]
  return items.map((item, itemIndex) => (itemIndex === index ? next : item))
}

function latestDraftForJob(data: AppData, jobId: ID): GeneratedChapterDraft | null {
  return [...data.generatedChapterDrafts].filter((item) => item.jobId === jobId).sort(byUpdatedAtDesc)[0] ?? null
}

function latestQualityForJob(data: AppData, jobId: ID, draft: GeneratedChapterDraft | null): QualityGateReport | null {
  return draft
    ? latestQualityReportForDraft(data.qualityGateReports.filter((report) => report.jobId === jobId), draft)
    : null
}

function latestConsistencyForJob(data: AppData, jobId: ID, draft: GeneratedChapterDraft | null): ConsistencyReviewReport | null {
  return draft
    ? latestConsistencyReportsForDraft(data.consistencyReviewReports.filter((report) => report.jobId === jobId), draft)[0] ?? null
    : null
}

function latestRedundancyForJob(data: AppData, jobId: ID, draft: GeneratedChapterDraft | null): RedundancyReport | null {
  return draft
    ? latestRedundancyReportForDraft(data.redundancyReports.filter((report) => report.jobId === jobId), draft)
    : null
}

function latestAuthorSummaryForJob(
  data: AppData,
  jobId: ID,
  draft: GeneratedChapterDraft | null,
  quality: QualityGateReport | null,
  consistency: ConsistencyReviewReport | null,
  redundancy: RedundancyReport | null
): RunTraceAuthorSummary | null {
  if (!draft) return null
  return latestReport(
    data.runTraceAuthorSummaries.filter((summary) => {
      if (summary.jobId !== jobId || summary.generatedDraftId !== draft.id) return false
      if (summary.createdAt < draft.updatedAt) return false
      if (quality ? summary.sourceRefs.qualityGateReportId !== quality.id : Boolean(summary.sourceRefs.qualityGateReportId)) return false
      if (
        consistency
          ? summary.sourceRefs.consistencyReviewReportId !== consistency.id
          : Boolean(summary.sourceRefs.consistencyReviewReportId)
      ) return false
      if (
        redundancy
          ? !summary.sourceRefs.redundancyReportIds?.includes(redundancy.id)
          : Boolean(summary.sourceRefs.redundancyReportIds?.length)
      ) return false
      return true
    })
  )
}

function decisionActionForRecommendation(recommendation: AgentAcceptanceRecommendationType): AgentDecisionAction {
  if (recommendation === 'accept') return 'accept_draft'
  if (recommendation === 'revise') return 'revise_draft'
  if (recommendation === 'reject') return 'reject_draft'
  return 'pause_for_human'
}

function riskRank(risk: AgentRiskLevel): number {
  if (risk === 'high') return 3
  if (risk === 'medium') return 2
  return 1
}

function maxRisk(...risks: AgentRiskLevel[]): AgentRiskLevel {
  return risks.reduce<AgentRiskLevel>((max, risk) => (riskRank(risk) > riskRank(max) ? risk : max), 'low')
}

function jobHasFailedStep(data: AppData, jobId: ID): boolean {
  return data.chapterGenerationSteps.some((step) => step.jobId === jobId && step.status === 'failed')
}

function recommendationFromEditorialVerdict(
  jobId: ID,
  draft: GeneratedChapterDraft,
  verdict: EditorialVerdict
): AgentAcceptanceRecommendation {
  const actions = verdict.actions.map((action) => action.label || action.reason).filter(Boolean)
  if (verdict.status === 'approved') {
    return {
      jobId,
      recommendation: 'accept',
      confidence: 0.9,
      riskLevel: 'low',
      reasons: [verdict.summary],
      draftId: draft.id,
      nextActions: actions.length ? actions : ['Accept the current draft.'],
      requiresHumanApproval: false
    }
  }
  if (verdict.status === 'advisory') {
    return {
      jobId,
      recommendation: 'accept',
      confidence: 0.72,
      riskLevel: 'medium',
      reasons: [verdict.summary, ...verdict.advisories.slice(0, 3).map((issue) => issue.title)],
      draftId: draft.id,
      nextActions: actions.length ? actions : ['Review the editorial advisories before accepting.'],
      requiresHumanApproval: true
    }
  }
  if (verdict.status === 'blocked') {
    return {
      jobId,
      recommendation: 'revise',
      confidence: 0.88,
      riskLevel: 'high',
      reasons: [verdict.summary, ...verdict.blockers.slice(0, 3).map((issue) => issue.title)],
      draftId: draft.id,
      nextActions: actions.length ? actions : ['Resolve the blocking editorial issues, then rerun diagnostics.'],
      requiresHumanApproval: true
    }
  }
  return {
    jobId,
    recommendation: 'wait',
    confidence: 0.75,
    riskLevel: 'medium',
    reasons: [verdict.summary || 'The editorial decision is incomplete for this draft revision.'],
    draftId: draft.id,
    nextActions: actions.length ? actions : ['Rerun diagnostics for the current draft revision.'],
    requiresHumanApproval: true
  }
}

export class AgentDecisionService {
  static buildAcceptanceRecommendation(data: AppData, jobId: ID): AgentAcceptanceRecommendation {
    const job: ChapterGenerationJob | null = data.chapterGenerationJobs.find((item) => item.id === jobId) ?? null
    if (!job) throw new Error(`Job not found: ${jobId}`)

    const draft = latestDraftForJob(data, jobId)
    const quality = latestQualityForJob(data, jobId, draft)
    const consistency = latestConsistencyForJob(data, jobId, draft)
    const redundancy = latestRedundancyForJob(data, jobId, draft)
    const summary = latestAuthorSummaryForJob(data, jobId, draft, quality, consistency, redundancy)
    const trace = data.generationRunTraces.find((item) => item.jobId === jobId) ?? null
    const reasons: string[] = []
    const nextActions: string[] = []
    let riskLevel: AgentRiskLevel = 'low'

    if (!draft) {
      const failed = job.status === 'failed' || jobHasFailedStep(data, jobId)
      return {
        jobId,
        recommendation: failed ? 'reject' : 'wait',
        confidence: failed ? 0.55 : 0.35,
        riskLevel: failed ? 'high' : 'medium',
        reasons: [failed ? 'The generation job failed before producing a draft.' : 'No generated draft is available yet.'],
        draftId: null,
        nextActions: [failed ? 'Inspect the failed step/provider error and retry.' : 'Wait for draft generation or inspect the stalled pipeline step.'],
        requiresHumanApproval: true
      }
    }

    const currentVerdict = AuthorDecisionPolicyService.latestEditorialVerdictForDraft(data.editorialVerdicts ?? [], draft)
    if (currentVerdict) return recommendationFromEditorialVerdict(jobId, draft, currentVerdict)
    const hasVerdictHistory = (data.editorialVerdicts ?? []).some(
      (verdict) => verdict.jobId === jobId && verdict.draftId === draft.id
    )
    if (hasVerdictHistory || trace?.editorialVerdictId) {
      return {
        jobId,
        recommendation: 'wait',
        confidence: 0.82,
        riskLevel: 'medium',
        reasons: ['The available editorial verdict belongs to an older draft revision and is not valid for the current text.'],
        draftId: draft.id,
        nextActions: ['Rerun diagnostics to create an editorial verdict bound to the current draft.'],
        requiresHumanApproval: true
      }
    }

    // Compatibility path for runs created before EditorialVerdict was introduced.
    const taskContract = job.chapterTaskSnapshot
      ? ChapterTaskContractService.evaluate({ body: draft.body, title: draft.title, chapterTask: job.chapterTaskSnapshot })
      : null
    if (taskContract && !taskContract.pass) {
      riskLevel = maxRisk(riskLevel, 'high')
      reasons.push(`ChapterTask contract failed: ${taskContract.issues.slice(0, 3).map((issue) => compact(issue.evidence, 120)).join('; ')}`)
      nextActions.push(...taskContract.issues.slice(0, 3).map((issue) => issue.suggestedFix))
    }

    const currentNoveltyAudit = draft && noveltyAuditMatchesDraft(trace?.noveltyAuditResult, draft)
      ? trace?.noveltyAuditResult ?? null
      : null

    if (currentNoveltyAudit?.severity === 'fail') {
      riskLevel = maxRisk(riskLevel, 'high')
      reasons.push(`Novelty audit failed: ${compact(currentNoveltyAudit.summary, 240) || 'unapproved new canon or deus-ex rule risk.'}`)
      nextActions.push('Revise or remove unapproved new rules, characters, or mechanisms before accepting.')
    } else if (currentNoveltyAudit?.severity === 'warning') {
      riskLevel = maxRisk(riskLevel, 'medium')
      reasons.push(`Novelty audit warning: ${compact(currentNoveltyAudit.summary, 240)}`)
      nextActions.push('Confirm whether the new information is allowed to enter prose and long-term memory.')
    } else if (!currentNoveltyAudit && trace?.noveltyAuditResult) {
      riskLevel = maxRisk(riskLevel, 'medium')
      reasons.push('Novelty audit belongs to an older draft revision and is not used for the current acceptance decision.')
      nextActions.push('Rerun Novelty Audit for the current draft before accepting.')
    }

    if (quality) {
      const qualityDecision = AuthorDecisionPolicyService.assessQualityGate(quality)
      const requiredFixes = quality.requiredFixes.map((fix) => compact(fix)).filter(Boolean).slice(0, 3)
      if (qualityDecision.status === 'blocked') {
        riskLevel = maxRisk(riskLevel, 'high')
        reasons.push(`Quality gate is blocked with score ${quality.overallScore}: ${qualityDecision.reasons.join('; ') || 'report marked as failed'}.`)
        nextActions.push('Open the revision workflow and resolve required fixes.')
        if (requiredFixes.length) nextActions.push(...requiredFixes)
      } else if (qualityDecision.status === 'needs_review') {
        riskLevel = maxRisk(riskLevel, 'medium')
        reasons.push(`Quality gate passed with score ${quality.overallScore}, but still requires author review: ${qualityDecision.reasons.join('; ')}`)
        nextActions.push('Perform the same author confirmation required by the desktop workflow before accepting.')
        if (requiredFixes.length) {
          reasons.push(`The quality report still lists ${quality.requiredFixes.length} required fix(es).`)
          nextActions.push('Resolve the listed required fixes before accepting.', ...requiredFixes)
        }
      }
    }

    const highConsistencyIssues = consistency?.issues.filter((issue) => issue.severity === 'high') ?? []
    if (highConsistencyIssues.length) {
      riskLevel = maxRisk(riskLevel, 'high')
      reasons.push(`Consistency review has ${highConsistencyIssues.length} high-risk issue(s).`)
      nextActions.push('Fix high-risk continuity, character-state, or foreshadowing issues first.')
    } else if (consistency && consistency.issues.some((issue) => issue.severity === 'medium')) {
      riskLevel = maxRisk(riskLevel, 'medium')
      reasons.push('Consistency review has medium-risk issues.')
      nextActions.push('Review medium-risk continuity issues and revise if needed.')
    }

    if (redundancy && redundancy.overallRedundancyScore >= 75) {
      riskLevel = maxRisk(riskLevel, 'medium')
      reasons.push(`Redundancy risk is high: ${redundancy.overallRedundancyScore}.`)
      nextActions.push('Compress repeated paragraphs or repeated explanations.')
    }

    if (summary && ['risky', 'failed', 'needs_attention'].includes(summary.overallStatus)) {
      riskLevel = maxRisk(riskLevel, summary.overallStatus === 'risky' || summary.overallStatus === 'failed' ? 'high' : 'medium')
      reasons.push(compact(summary.oneLineDiagnosis, 300))
      nextActions.push(...summary.nextActions.map((action) => action.label).slice(0, 3))
    }

    if (!quality) {
      riskLevel = maxRisk(riskLevel, 'medium')
      reasons.push('Quality gate report is missing.')
      nextActions.push('Run quality gate before accepting.')
    }
    if (!consistency) {
      riskLevel = maxRisk(riskLevel, 'medium')
      reasons.push('Consistency review report is missing.')
      nextActions.push('Run consistency review before accepting.')
    }

    if (riskLevel === 'low' && quality && AuthorDecisionPolicyService.assessQualityGate(quality).status === 'passed') {
      return {
        jobId,
        recommendation: 'accept',
        confidence: Math.min(0.95, Math.max(0.65, quality.overallScore / 100)),
        riskLevel: 'low',
        reasons: ['Draft passed available quality, consistency, and novelty checks.'],
        draftId: draft.id,
        nextActions: ['Accept the draft; a final human read-through is still recommended.'],
        requiresHumanApproval: false
      }
    }

    return {
      jobId,
      recommendation: 'revise',
      confidence: riskLevel === 'high' ? 0.82 : 0.68,
      riskLevel,
      reasons: [...new Set(reasons.filter(Boolean).map((reason) => compact(reason, 320)))],
      draftId: draft.id,
      nextActions: [...new Set(nextActions.filter(Boolean).map((action) => compact(action, 260)))].slice(0, 6),
      requiresHumanApproval: true
    }
  }

  static createActionPreview(input: {
    appData: AppData
    agentRunId: ID
    jobId: ID
    recommendation: AgentAcceptanceRecommendation
  }): AgentActionPreview {
    const timestamp = now()
    const job = input.appData.chapterGenerationJobs.find((item) => item.id === input.jobId)
    if (!job) throw new Error(`Job not found: ${input.jobId}`)
    const draft = input.recommendation.draftId
      ? input.appData.generatedChapterDrafts.find((item) => item.id === input.recommendation.draftId) ?? null
      : null
    const actionType: AgentActionPreview['actionType'] =
      input.recommendation.recommendation === 'accept'
        ? 'chapter_commit'
        : input.recommendation.recommendation === 'revise'
          ? 'revision_commit'
          : input.recommendation.recommendation === 'reject'
            ? 'rerun_generation'
            : 'pause_for_human'

    return {
      id: `agent-preview-${input.agentRunId}-${input.jobId}-${input.recommendation.recommendation}`,
      agentRunId: input.agentRunId,
      projectId: job.projectId,
      chapterId: draft?.chapterId ?? null,
      jobId: input.jobId,
      actionType,
      status: 'pending',
      summary: input.recommendation.recommendation === 'accept'
        ? `Recommend accepting chapter ${job.targetChapterOrder} draft.`
        : input.recommendation.recommendation === 'revise'
          ? `Recommend revising chapter ${job.targetChapterOrder} draft first.`
          : input.recommendation.recommendation === 'reject'
            ? `Recommend rerunning or rejecting chapter ${job.targetChapterOrder} result.`
            : `Chapter ${job.targetChapterOrder} needs more pipeline output or human judgment.`,
      riskLevel: input.recommendation.riskLevel,
      diffSummary: input.recommendation.nextActions,
      affectedIds: [input.jobId, input.recommendation.draftId ?? ''].filter(Boolean),
      requiresHumanApproval: input.recommendation.requiresHumanApproval,
      recommendation: input.recommendation.recommendation,
      reason: input.recommendation.reasons.join('; '),
      evidence: input.recommendation.reasons,
      createdAt: timestamp,
      updatedAt: timestamp,
      schemaVersion: 1
    }
  }

  static upsertActionPreviewToAppData(appData: AppData, preview: AgentActionPreview): AppData {
    if (!preview.id) throw new Error('AgentActionPreview missing id.')
    if (!preview.agentRunId) throw new Error('AgentActionPreview missing agentRunId.')
    if (!preview.projectId) throw new Error('AgentActionPreview missing projectId.')
    return {
      ...appData,
      agentActionPreviews: upsertById(appData.agentActionPreviews ?? [], preview)
    }
  }

  static recordAcceptanceDecision(input: RecordAcceptanceDecisionInput): RecordAcceptanceDecisionResult {
    const agentRun = input.appData.agentRuns.find((run) => run.id === input.agentRunId)
    if (!agentRun) throw new Error(`AgentRun not found: ${input.agentRunId}`)
    if (!agentRun.createdJobIds.includes(input.jobId)) {
      throw new Error(`Job ${input.jobId} is not registered in AgentRun ${input.agentRunId}.`)
    }
    const recommendation = this.buildAcceptanceRecommendation(input.appData, input.jobId)
    const preview = this.createActionPreview({
      appData: input.appData,
      agentRunId: input.agentRunId,
      jobId: input.jobId,
      recommendation
    })
    const decision: AgentDecision = {
      id: newId('agent-decision'),
      agentRunId: input.agentRunId,
      projectId: preview.projectId,
      chapterId: preview.chapterId ?? null,
      jobId: input.jobId,
      step: 'acceptance_recommendation',
      action: decisionActionForRecommendation(recommendation.recommendation),
      reason: recommendation.reasons.join('; '),
      evidence: recommendation.reasons,
      riskLevel: recommendation.riskLevel,
      result: recommendation.requiresHumanApproval ? 'pending_human' : 'skipped',
      createdAt: now()
    }

    const withDecision = AgentRunService.recordAgentDecision(input.appData, decision)
    const withPreview = this.upsertActionPreviewToAppData(withDecision, preview)
    const nextRun = withPreview.agentRuns.find((run) => run.id === input.agentRunId)
    const nextData = nextRun
      ? AgentRunService.upsertAgentRunToAppData(withPreview, {
          ...nextRun,
          pendingHumanReviewItemIds: preview.requiresHumanApproval
            ? [...new Set([...nextRun.pendingHumanReviewItemIds, preview.id])]
            : nextRun.pendingHumanReviewItemIds,
          updatedAt: decision.createdAt
        })
      : withPreview

    return {
      appData: nextData,
      decision,
      preview,
      recommendation
    }
  }

  static summarizeAgentRun(data: AppData, agentRunId: ID): {
    agentRunId: ID
    status: string
    targetChapterOrders: number[]
    createdJobIds: ID[]
    createdDraftIds: ID[]
    pendingPreviewCount: number
    latestDecision: AgentDecision | null
    nextChapterOrder: number | null
    summary: string
    warnings: string[]
  } {
    const run = data.agentRuns.find((item) => item.id === agentRunId)
    if (!run) throw new Error(`AgentRun not found: ${agentRunId}`)
    const latestDecision = [...run.decisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    const completedOrders = new Set(
      run.createdJobIds
        .map((jobId) => data.chapterGenerationJobs.find((job) => job.id === jobId))
        .filter((job): job is ChapterGenerationJob => Boolean(job))
        .filter((job) => job.status === 'completed')
        .map((job) => job.targetChapterOrder)
    )
    const nextChapterOrder = run.targetChapterOrders.find((order) => !completedOrders.has(order)) ?? null
    return {
      agentRunId: run.id,
      status: run.status,
      targetChapterOrders: run.targetChapterOrders,
      createdJobIds: run.createdJobIds,
      createdDraftIds: run.createdDraftIds,
      pendingPreviewCount: data.agentActionPreviews.filter((preview) => preview.agentRunId === run.id && preview.status === 'pending').length,
      latestDecision,
      nextChapterOrder,
      summary: run.summary,
      warnings: run.warnings
    }
  }
}

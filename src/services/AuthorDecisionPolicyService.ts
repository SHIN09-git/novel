import type {
  AppData,
  EditorialVerdict,
  GeneratedChapterDraft,
  MemoryUpdateCandidate,
  QualityGateReport
} from '../shared/types'
import { draftContentHash, latestQualityReportForDraft } from './DraftDiagnosticBindingService'
import type { EditorialCoverageExpectation } from './EditorialVerdictService'
import {
  QUALITY_GATE_HUMAN_REVIEW_SCORE,
  QUALITY_GATE_PASS_SCORE,
  qualityGateEffectivelyPassed,
  qualityGateHasRequiredFixes,
  shouldQualityGateRequireHumanReview
} from '../shared/qualityGatePolicy'

export type AuthorDecisionTone = 'default' | 'danger'
export type QualityGateDecisionStatus = 'not_available' | 'passed' | 'needs_review' | 'blocked'

export interface AuthorDecisionPrompt {
  title: string
  message: string
  confirmLabel: string
  tone: AuthorDecisionTone
}

export interface QualityGateDecision {
  status: QualityGateDecisionStatus
  label: string
  tone: 'neutral' | 'success' | 'accent' | 'danger'
  requiresHumanReview: boolean
  requiresSecondConfirmation: boolean
  reasons: string[]
}

export interface EditorialVerdictDecision {
  status: EditorialVerdict['status']
  canAccept: boolean
  requiresHumanReview: boolean
  requiresSecondConfirmation: boolean
}

export interface MemoryCandidateQualityAssessment {
  report: QualityGateReport | null
  // Certifies report-to-current-draft binding, not an immutable candidate source hash.
  sourceStatus: 'current_draft' | 'unverified'
  warnings: string[]
}

function scoreText(reports: QualityGateReport[]): string {
  return reports.map((report) => `${report.overallScore} 分`).join('、')
}

function keyDimensionReasons(report: QualityGateReport): string[] {
  const reasons: string[] = []
  if (report.overallScore < QUALITY_GATE_HUMAN_REVIEW_SCORE) {
    reasons.push(`总分低于人工确认线 ${QUALITY_GATE_HUMAN_REVIEW_SCORE}`)
  }
  if (report.dimensions.characterConsistency < 70) reasons.push('角色一致性偏低')
  if (report.dimensions.characterStateConsistency < 70) reasons.push('角色状态账本一致性偏低')
  if (report.dimensions.foreshadowingControl < 70) reasons.push('伏笔控制偏低')
  if (report.dimensions.chapterContinuity < 70) reasons.push('章节衔接偏低')
  if (report.dimensions.contextRelevanceCompliance < 70) reasons.push('上下文需求遵守度偏低')
  if (report.issues.some((issue) => issue.severity === 'high')) reasons.push('存在 high severity 问题')
  if (qualityGateHasRequiredFixes(report)) reasons.push(`存在 ${report.requiredFixes.length} 条必修项`)
  return reasons
}

function blockingReasons(report: QualityGateReport): string[] {
  const reasons = keyDimensionReasons(report)
  if (report.overallScore < QUALITY_GATE_PASS_SCORE) {
    reasons.unshift(`总分低于通过线 ${QUALITY_GATE_PASS_SCORE}`)
  }
  if (!report.pass) reasons.unshift('质量报告已标记为未通过')
  return [...new Set(reasons)]
}

function verdictSummary(status: EditorialVerdict['status'], blockers: number, advisories: number): string {
  if (status === 'blocked') return `当前正文有 ${blockers} 个阻断项和 ${advisories} 个建议项，建议修订后重新审稿。`
  if (status === 'advisory') return `当前正文没有阻断项，但有 ${advisories} 个建议项供作者取舍。`
  return '当前正文绑定的质量、一致性和风险报告未发现阻断项。'
}

function verdictActionPriority(actionType: string): number {
  if (actionType === 'accept_draft') return 1
  if (actionType === 'revise_draft' || actionType === 'rerun_diagnostics') return 2
  return 3
}

function currentVerdictSort(left: EditorialVerdict, right: EditorialVerdict): number {
  return (right.updatedAt || right.createdAt).localeCompare(left.updatedAt || left.createdAt) || right.id.localeCompare(left.id)
}

export class AuthorDecisionPolicyService {
  static latestEditorialVerdictForDraft(
    verdicts: ReadonlyArray<EditorialVerdict>,
    draft: GeneratedChapterDraft
  ): EditorialVerdict | null {
    const hash = draftContentHash(draft.body)
    return [...verdicts]
      .filter((verdict) =>
        verdict.projectId === draft.projectId &&
        verdict.jobId === draft.jobId &&
        verdict.draftId === draft.id &&
        verdict.draftContentHash === hash &&
        verdict.draftRevision === draft.updatedAt
      )
      .sort(currentVerdictSort)[0] ?? null
  }

  static assessEditorialVerdict(verdict: EditorialVerdict | null | undefined): EditorialVerdictDecision {
    const status = verdict?.status ?? 'incomplete'
    return {
      status,
      canAccept: Boolean(verdict?.canAccept) && status !== 'blocked' && status !== 'incomplete',
      requiresHumanReview: status === 'blocked' || status === 'advisory',
      requiresSecondConfirmation: status === 'blocked'
    }
  }

  static editorialVerdictAcceptancePrompt(verdict: EditorialVerdict): AuthorDecisionPrompt {
    return {
      title: verdict.status === 'blocked' ? '编辑裁定未通过' : '编辑裁定需要确认',
      message: verdict.status === 'blocked'
        ? `${verdict.summary}确认仍要强制接受当前正文吗？`
        : `当前正文有编辑建议：${verdict.summary}确认仍要接受草稿吗？`,
      confirmLabel: verdict.status === 'blocked' ? '继续接受' : '接受草稿',
      tone: verdict.status === 'blocked' ? 'danger' : 'default'
    }
  }

  /**
   * The verdict builder is intentionally diagnostic-only. This policy layer
   * removes a missing consistency report when the frozen recipe did not ask
   * for that step, keeping fast runs from becoming falsely incomplete.
   */
  static applyEditorialCoverage(
    verdict: EditorialVerdict,
    expectation: EditorialCoverageExpectation
  ): EditorialVerdict {
    const consistencyExpected = expectation.consistency ?? expectation.recipeId !== 'fast'
    const advisories = !consistencyExpected
      ? verdict.advisories.filter((issue) => issue.code !== 'consistency_missing' && issue.code !== 'consistency_unavailable')
      : verdict.advisories
    const status: EditorialVerdict['status'] = verdict.blockers.length
      ? 'blocked'
      : advisories.length
        ? 'advisory'
        : 'approved'
    const actions = verdict.actions
      .filter((action) => !(!consistencyExpected && action.actionType === 'rerun_diagnostics'))
      .filter((action, index, all) => all.findIndex((item) => item.actionType === action.actionType) === index)
    if ((status === 'approved' || status === 'advisory') && !actions.some((action) => action.actionType === 'accept_draft')) {
      actions.push({
        actionType: 'accept_draft',
        label: status === 'approved' ? '接受草稿' : '阅读建议后接受',
        reason: status === 'approved' ? '当前绑定诊断没有发现阻断项。' : '只有建议项，最终取舍由作者决定。',
        priority: status === 'approved' ? 1 : 3
      })
    }
    actions.sort((left, right) => verdictActionPriority(left.actionType) - verdictActionPriority(right.actionType))
    return {
      ...verdict,
      status,
      canAccept: status === 'approved' || status === 'advisory',
      summary: verdictSummary(status, verdict.blockers.length, advisories.length),
      advisories,
      actions: actions.slice(0, 3),
    } as EditorialVerdict
  }

  static assessQualityGate(report: QualityGateReport | null | undefined): QualityGateDecision {
    if (!report) {
      return {
        status: 'not_available',
        label: '未生成',
        tone: 'neutral',
        requiresHumanReview: false,
        requiresSecondConfirmation: false,
        reasons: []
      }
    }

    if (!qualityGateEffectivelyPassed(report)) {
      return {
        status: 'blocked',
        label: '未通过',
        tone: 'danger',
        requiresHumanReview: true,
        requiresSecondConfirmation: true,
        reasons: blockingReasons(report)
      }
    }

    if (shouldQualityGateRequireHumanReview(report)) {
      return {
        status: 'needs_review',
        label: '需确认',
        tone: 'accent',
        requiresHumanReview: true,
        requiresSecondConfirmation: false,
        reasons: keyDimensionReasons(report)
      }
    }

    return {
      status: 'passed',
      label: '通过',
      tone: 'success',
      requiresHumanReview: false,
      requiresSecondConfirmation: false,
      reasons: []
    }
  }

  static reportsRequiringHumanReview(reports: QualityGateReport[]): QualityGateReport[] {
    return reports.filter((report) => this.assessQualityGate(report).requiresHumanReview)
  }

  static assessMemoryCandidateQuality(
    candidate: MemoryUpdateCandidate,
    reports: QualityGateReport[],
    data?: Pick<AppData, 'generatedChapterDrafts'>
  ): MemoryCandidateQualityAssessment {
    const scopedReports = reports.filter((report) =>
      report.projectId === candidate.projectId && report.jobId === candidate.jobId
    )
    const warnings = Array.isArray(candidate.proposedPatch?.warnings)
      ? candidate.proposedPatch.warnings.filter((warning): warning is string => typeof warning === 'string') : []
    const drafts = data?.generatedChapterDrafts.filter((draft) =>
      draft.projectId === candidate.projectId && draft.jobId === candidate.jobId
    ) ?? []
    const draft = drafts.length === 1 ? drafts[0] : null
    const candidateTime = Date.parse(candidate.createdAt)
    // Candidates have no source hash. A unique, unchanged draft is the strongest
    // available association; never attach an older candidate to a newer draft.
    if (draft && Date.parse(draft.createdAt) <= candidateTime && Date.parse(draft.updatedAt) <= candidateTime) {
      const report = latestQualityReportForDraft(scopedReports.filter((item) =>
        !item.chapterId || item.chapterId === draft.chapterId
      ), draft)
      if (report) return { report, sourceStatus: 'current_draft', warnings }
      warnings.push('未找到与当前来源草稿正文 hash 匹配的质量报告，不能视为当前审稿通过；请重新审稿或人工核对。')
      return { report: null, sourceStatus: 'unverified', warnings }
    }
    // Keep historical risk visible for legacy callers, without certifying its source.
    const report = [...scopedReports].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
    )[0] ?? null
    warnings.push('候选来源版本无法核实，关联报告仅供历史风险参考，不代表当前正文审稿通过；请人工核对候选证据。')
    return { report, sourceStatus: 'unverified', warnings }
  }

  // A risk-report list is not an approval: callers needing provenance must also
  // surface assessMemoryCandidateQuality().warnings, even when this list is empty.
  static reportsForMemoryCandidates(
    candidates: MemoryUpdateCandidate[],
    reports: QualityGateReport[],
    data?: Pick<AppData, 'generatedChapterDrafts'>
  ): QualityGateReport[] {
    return [
      ...new Map(
        candidates
          .map((candidate) => {
            const { report: latest } = this.assessMemoryCandidateQuality(candidate, reports, data)
            return latest && this.assessQualityGate(latest).requiresHumanReview ? latest : null
          })
          .filter((report): report is QualityGateReport => Boolean(report))
          .map((report) => [JSON.stringify([report.projectId, report.id]), report] as const)
      ).values()
    ]
  }

  static riskMessage(report: QualityGateReport | null | undefined): string | null {
    const decision = this.assessQualityGate(report)
    if (!report || decision.status === 'not_available' || decision.status === 'passed') return null
    if (decision.status === 'blocked') {
      return `质量门禁未通过：总分 ${report.overallScore}，${decision.reasons.slice(0, 2).join('、') || '报告标记为未通过'}。建议先修订。`
    }
    return `质量门禁已通过但需要人工确认：总分 ${report.overallScore}，${decision.reasons.slice(0, 2).join('、') || '存在关键维度风险'}。`
  }

  static draftAcceptancePrompt(report: QualityGateReport): AuthorDecisionPrompt {
    const decision = this.assessQualityGate(report)
    return {
      title: decision.status === 'blocked' ? '质量门禁未通过' : '需要人工确认',
      message:
        decision.status === 'blocked'
          ? `质量门禁未通过（${report.overallScore} 分）。确认仍要进入章节草稿吗？`
          : `质量门禁已通过（${report.overallScore} 分），但低于人工确认线 ${QUALITY_GATE_HUMAN_REVIEW_SCORE} 分或存在关键维度风险。确认仍要接受草稿吗？`,
      confirmLabel: '继续',
      tone: decision.status === 'blocked' ? 'danger' : 'default'
    }
  }

  static forcedDraftAcceptancePrompt(): AuthorDecisionPrompt {
    return {
      title: '再次确认',
      message: '未通过质量门禁的草稿可能导致后续复盘和记忆候选质量下降。是否强制接受？',
      confirmLabel: '强制接受',
      tone: 'danger'
    }
  }

  static revisionAcceptancePrompt(report: QualityGateReport): AuthorDecisionPrompt {
    const decision = this.assessQualityGate(report)
    return {
      title: decision.status === 'blocked' ? '质量门禁未通过' : '需要人工确认',
      message:
        decision.status === 'blocked'
          ? `该章节最近质量门禁为 ${report.overallScore} 分且未通过，仍要接受修订版本吗？`
          : `该章节最近质量门禁为 ${report.overallScore} 分，已通过 ${QUALITY_GATE_PASS_SCORE} 分门禁，但低于人工确认线 ${QUALITY_GATE_HUMAN_REVIEW_SCORE} 分或存在关键维度风险。仍要接受修订版本吗？`,
      confirmLabel: '继续接受',
      tone: decision.status === 'blocked' ? 'danger' : 'default'
    }
  }

  static memoryCandidatePrompt(reports: QualityGateReport[], title: string, confirmLabel: string): AuthorDecisionPrompt | null {
    if (!reports.length) return null
    const hasBlockedReport = reports.some((report) => this.assessQualityGate(report).status === 'blocked')
    return {
      title,
      message: hasBlockedReport
        ? `相关流水线质量门禁未通过（${scoreText(reports)}）。确认仍要应用这些长期记忆更新吗？`
        : `相关流水线质量门禁低于人工确认线 ${QUALITY_GATE_HUMAN_REVIEW_SCORE} 分或存在关键维度风险（${scoreText(reports)}）。确认仍要应用这些长期记忆更新吗？`,
      confirmLabel,
      tone: hasBlockedReport ? 'danger' : 'default'
    }
  }
}

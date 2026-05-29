import type { MemoryUpdateCandidate, QualityGateReport } from '../shared/types'
import {
  QUALITY_GATE_HUMAN_REVIEW_SCORE,
  QUALITY_GATE_PASS_SCORE,
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
  return reasons
}

export class AuthorDecisionPolicyService {
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

    if (!report.pass) {
      return {
        status: 'blocked',
        label: '未通过',
        tone: 'danger',
        requiresHumanReview: true,
        requiresSecondConfirmation: true,
        reasons: [`未达到 ${QUALITY_GATE_PASS_SCORE} 分通过线或存在高风险问题`, ...keyDimensionReasons(report)]
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

  static reportsForMemoryCandidates(candidates: MemoryUpdateCandidate[], reports: QualityGateReport[]): QualityGateReport[] {
    return [
      ...new Map(
        candidates
          .map((candidate) => reports.find((report) => report.jobId === candidate.jobId && this.assessQualityGate(report).requiresHumanReview) ?? null)
          .filter((report): report is QualityGateReport => Boolean(report))
          .map((report) => [report.id, report] as const)
      ).values()
    ]
  }

  static riskMessage(report: QualityGateReport | null | undefined): string | null {
    const decision = this.assessQualityGate(report)
    if (!report || decision.status === 'not_available' || decision.status === 'passed') return null
    if (decision.status === 'blocked') return `质量门禁未通过：总分 ${report.overallScore}。建议先修订。`
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
      message: '低分草稿可能导致后续复盘和记忆候选质量下降。是否强制接受？',
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

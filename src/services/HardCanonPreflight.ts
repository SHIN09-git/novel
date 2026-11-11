import type { Chapter, ChapterAcceptanceReview, HardCanonAuditResult } from '../shared/types'
import { auditHardCanon } from './HardCanonAuditService'
import { decisionFingerprint } from './candidateDecisionPrimitives'

type Library = Parameters<typeof auditHardCanon>[0]
type Target = { projectId: string; chapterOrder: number; chapterId?: string | null; body: string }

export function currentHardCanonAudit(data: Library, target: Target): HardCanonAuditResult | null {
  if (!data.hardCanonPacks?.some(pack => pack.projectId === target.projectId &&
    pack.items.some(item => item.status === 'active' && item.check))) return null
  const audit = auditHardCanon(data, target)
  return audit.checkedRuleIds.length ? audit : null
}

export function hardCanonNotice(audit: HardCanonAuditResult | null | undefined, severity: 'block' | 'review'): string | null {
  const finding = audit?.findings.find(item => item.severity === severity)
  if (!finding || !audit) return null
  return `第 ${audit.chapterOrder} 章 · ${finding.ruleTitle}：${finding.reason}${finding.excerpt ? ` 原文：“${finding.excerpt}”` : ''}`
}

export function assertHardCanonCanCommit(audit: HardCanonAuditResult | null): void {
  const reason = hardCanonNotice(audit, 'block')
  if (reason) throw new Error(`硬设定核查未通过。${reason} 请修改正文，或先在硬设定包中调整该规则。`)
}

export function assertRevisionFitsHardCanon(data: Library, chapter: Chapter, body: string, proposedOrder = chapter.order): void {
  if (proposedOrder !== chapter.order) throw new Error('章节顺序已变化，请重新核对修订目标。')
  assertHardCanonCanCommit(currentHardCanonAudit(data, { projectId: chapter.projectId, chapterId: chapter.id,
    chapterOrder: chapter.order, body }))
}

export function hardCanonReceipt(audit: HardCanonAuditResult | null): ChapterAcceptanceReview['hardCanonCheck'] {
  if (!audit) return undefined
  return {
    rulesFingerprint: audit.rulesFingerprint,
    // Book counts or an actor's confirmed state can change without changing the text of the rule.
    resultFingerprint: decisionFingerprint([audit.projectId, audit.chapterOrder, audit.rawBodyFingerprint, audit.rulesFingerprint,
      audit.findings, audit.counts]),
    checkedRuleCount: audit.checkedRuleIds.length,
    reviewCount: audit.findings.filter(item => item.severity === 'review').length
  }
}

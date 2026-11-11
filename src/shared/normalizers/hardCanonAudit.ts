import type { HardCanonAuditResult } from '../types/hardCanonCheck'
import { objectOrEmpty } from './common'

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function nonnegative(value: unknown): value is number {
  return integer(value) && value >= 0
}

/** Never turn an absent or partially unreadable audit into an empty, passing check. */
export function normalizeHardCanonAudit(value: unknown): HardCanonAuditResult | undefined {
  const { projectId, chapterOrder, draftContentHash, rawBodyFingerprint, rulesFingerprint, checkedRuleIds, findings, counts } = objectOrEmpty(value)
  if (!nonempty(projectId) || !integer(chapterOrder) || chapterOrder < 1 || !nonempty(draftContentHash) ||
    !nonempty(rawBodyFingerprint) || !nonempty(rulesFingerprint) || !Array.isArray(checkedRuleIds) ||
    !checkedRuleIds.every(nonempty) || !Array.isArray(findings) || !Array.isArray(counts)) return undefined

  const audit: HardCanonAuditResult = {
    projectId, chapterOrder, draftContentHash, rawBodyFingerprint, rulesFingerprint, checkedRuleIds: [...checkedRuleIds], findings: [], counts: []
  }
  const checked = new Set(audit.checkedRuleIds)
  for (const item of findings) {
    const { ruleId, ruleTitle, ruleVersion, severity, reason, excerpt, start, end } = objectOrEmpty(item)
    if (!nonempty(ruleId) || !checked.has(ruleId) || !nonempty(ruleTitle) || !nonempty(ruleVersion) ||
      (severity !== 'block' && severity !== 'review') || !nonempty(reason) || typeof excerpt !== 'string' ||
      !nonnegative(start) || !nonnegative(end) || end < start) return undefined
    audit.findings.push({ ruleId, ruleTitle, ruleVersion, severity, reason, excerpt, start, end })
  }
  for (const item of counts) {
    const { ruleId, chapterCount, bookCount, projectedBookCount, delta } = objectOrEmpty(item)
    if (!nonempty(ruleId) || !checked.has(ruleId) || !nonnegative(chapterCount) || !nonnegative(bookCount) ||
      !nonnegative(projectedBookCount) || !integer(delta)) return undefined
    audit.counts.push({ ruleId, chapterCount, bookCount, projectedBookCount, delta })
  }
  return audit
}

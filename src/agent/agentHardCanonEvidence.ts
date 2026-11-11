import type { HardCanonAuditResult } from '../shared/types'
import { hardCanonEvidenceContext } from '../shared/hardCanonEvidence'
import { redactSensitiveText } from './agentReadableText'

export function agentHardCanonEvidence(audit: HardCanonAuditResult | null, body: string, full = false) {
  if (!audit) return undefined
  const limit = full ? Infinity : 3
  const selected = !full && audit.findings.length > limit
    ? [...audit.findings.filter(item => item.severity === 'block'), ...audit.findings.filter(item => item.severity === 'review')]
    : audit.findings
  return {
    draftContentHash: audit.draftContentHash, rawBodyFingerprint: audit.rawBodyFingerprint, rulesFingerprint: audit.rulesFingerprint,
    checkedRuleCount: audit.checkedRuleIds.length, findingCount: audit.findings.length,
    findings: selected.slice(0, limit).map(finding => {
      const context = hardCanonEvidenceContext(finding, body)
      return { ...finding, ruleTitle: redactSensitiveText(finding.ruleTitle), reason: redactSensitiveText(finding.reason),
        excerpt: redactSensitiveText(finding.excerpt),
        ...(context ? { sentence: redactSensitiveText(context.before + finding.excerpt + context.after) } : {}) }
    }),
    countRuleCount: audit.counts.length, counts: audit.counts.slice(0, limit)
  }
}

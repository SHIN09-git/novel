import type { HardCanonAuditResult, QualityGateReport } from '../../shared/types'
import { qualityGateEffectivelyPassed } from '../../shared/qualityGatePolicy'
import { draftContentHash } from '../DraftDiagnosticBindingService'
import { fingerprint } from '../hardCanonAudit/rules'

/** A semantic draft hash ignores line-ending differences, but evidence offsets must not. */
export function hardCanonAuditMatchesBody(audit: HardCanonAuditResult, body: string, hash = draftContentHash(body)): boolean {
  return audit.draftContentHash === hash && audit.rawBodyFingerprint === (body.includes('\r') ? fingerprint(body) : hash)
}

/** Restore the historical non-HardCanon decision, never infer a pass for an old report. */
export function qualityReportWithoutHardCanon(report: QualityGateReport): QualityGateReport {
  if (report.hardCanonAudit === undefined && report.hardCanonBasePass === undefined) return report
  const { hardCanonAudit, hardCanonBasePass, ...base } = report
  return { ...base, pass: hardCanonAudit && typeof hardCanonBasePass === 'boolean' ? hardCanonBasePass : report.pass }
}

/** The caller selects a report for the draft and supplies a fresh audit for its target chapter. */
export function withCurrentHardCanonAudit(report: QualityGateReport, audit: HardCanonAuditResult | null): QualityGateReport {
  const base = qualityReportWithoutHardCanon(report)
  if (!audit) return base
  if (audit.projectId !== base.projectId || !base.draftContentHash || audit.draftContentHash !== base.draftContentHash) {
    throw new Error('硬设定核查与质量报告的项目或正文指纹不匹配，请重新核查当前正文。')
  }
  if (!audit.checkedRuleIds.length) return base
  const current = { ...base, hardCanonAudit: audit, hardCanonBasePass: base.pass }
  return { ...current, pass: qualityGateEffectivelyPassed(current) }
}

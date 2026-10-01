import type { NoveltyAuditResult, NoveltyFinding, NoveltyFindingKind } from './types'

const SEVERITY_RANK = { fail: 3, warning: 2, info: 1 } as const

function kindRank(kind: NoveltyFindingKind): number {
  if (kind === 'deus_ex_rule' || kind === 'suspicious_deus_ex_rule') return 0
  if (kind === 'major_lore_reveal') return 1
  if (kind === 'new_system_mechanic') return 2
  if (kind === 'new_world_rule') return 3
  if (kind === 'new_organization_or_rank') return 4
  if (kind === 'new_named_character') return 5
  return 6
}

function normalizedEvidence(value: string): string {
  return value.toLowerCase().replace(/[\s，。；：、！？,.!?;:'"“”‘’()[\]（）【】]/g, '')
}

function incidentKey(finding: NoveltyFinding): string {
  const semantic = finding.semanticEvidence
  if (semantic?.resolutionCue) {
    return [
      'resolution',
      semantic.crisisCue ?? '',
      semantic.resolutionCue,
      semantic.beneficiary ?? ''
    ].join(':')
  }
  return `excerpt:${normalizedEvidence(finding.evidenceExcerpt || finding.text)}`
}

function isRuleOrMechanic(finding: NoveltyFinding): boolean {
  return finding.kind === 'new_world_rule' || finding.kind === 'new_system_mechanic'
}

function reviewIdentity(finding: NoveltyFinding): string {
  if (finding.kind === 'new_named_character' || finding.kind === 'untraced_name') {
    return `name:${finding.text}:${incidentKey(finding)}`
  }
  if (isRuleOrMechanic(finding)) return `rule:${finding.text}:${incidentKey(finding)}`
  return `${finding.kind}:${finding.text}:${incidentKey(finding)}`
}

export function collectNoveltyReviewFindings(audit: NoveltyAuditResult): NoveltyFinding[] {
  const findings = [
    ...audit.newNamedCharacters,
    ...audit.newWorldRules,
    ...audit.newSystemMechanics,
    ...audit.newOrganizationsOrRanks,
    ...audit.majorLoreReveals,
    ...audit.suspiciousDeusExRules,
    ...audit.untracedNames
  ].sort(
    (left, right) =>
      SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] ||
      kindRank(left.kind) - kindRank(right.kind)
  )

  const deusIncidentKeys = new Set(
    findings
      .filter(
        (finding) =>
          finding.kind === 'deus_ex_rule' || finding.kind === 'suspicious_deus_ex_rule'
      )
      .map(incidentKey)
  )
  const seen = new Set<string>()
  return findings.filter((finding) => {
    if (isRuleOrMechanic(finding) && deusIncidentKeys.has(incidentKey(finding))) return false
    const key = reviewIdentity(finding)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

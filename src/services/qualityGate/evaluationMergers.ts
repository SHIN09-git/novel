import type {
  ConsistencyReviewIssue,
  ConsistencyReviewReport,
  ConsistencySeverity,
  NoveltyAuditResult,
  NoveltyFinding,
  QualityGateIssue
} from '../../shared/types'
import { collectNoveltyReviewFindings } from '../../shared/noveltyReview'
import { QUALITY_GATE_PASS_SCORE } from '../../shared/qualityGatePolicy'
import type { LocalQualityEvaluation } from './localQualityRules'
import { qualityDimensionAverage } from './localQualityRules'

export function activeConsistencyIssues(reports: ConsistencyReviewReport[] = []): ConsistencyReviewIssue[] {
  return reports.flatMap((report) => report.issues).filter((issue) => issue.status !== 'ignored' && issue.status !== 'resolved')
}

function qualityIssueKey(issue: QualityGateIssue): string {
  return `${issue.type}:${issue.evidence}`
}

export function applyLocalGuardrails(
  evaluation: LocalQualityEvaluation,
  localEvaluation: LocalQualityEvaluation
): LocalQualityEvaluation {
  const existing = new Set(evaluation.issues.map(qualityIssueKey))
  const localIssues = localEvaluation.issues.filter((issue) => !existing.has(qualityIssueKey(issue)))
  if (!localIssues.length) return evaluation
  const dimensions = { ...evaluation.dimensions }
  for (const issue of localIssues) {
    if (['resource_underflow', 'missing_inventory', 'injury_reset', 'knowledge_leak', 'ability_overuse', 'location_jump', 'promise_ignored', 'state_conflict'].includes(issue.type)) {
      dimensions.characterStateConsistency = Math.min(dimensions.characterStateConsistency, localEvaluation.dimensions.characterStateConsistency)
    }
    if (issue.type === 'foreshadowing_treatment_violation') {
      dimensions.foreshadowingControl = Math.min(dimensions.foreshadowingControl, localEvaluation.dimensions.foreshadowingControl)
    }
    if (issue.type === 'chapter_continuity_break') {
      dimensions.chapterContinuity = Math.min(dimensions.chapterContinuity, localEvaluation.dimensions.chapterContinuity)
    }
    if (issue.type === 'redundancy_control') {
      dimensions.redundancyControl = Math.min(dimensions.redundancyControl, localEvaluation.dimensions.redundancyControl)
    }
    if (issue.type === 'length') {
      dimensions.plotCoherence = Math.min(dimensions.plotCoherence, localEvaluation.dimensions.plotCoherence)
      dimensions.pacing = Math.min(dimensions.pacing, localEvaluation.dimensions.pacing)
    }
    if (issue.type === 'chapter_task_length') {
      dimensions.plotCoherence = Math.min(dimensions.plotCoherence, localEvaluation.dimensions.plotCoherence)
      dimensions.pacing = Math.min(dimensions.pacing, localEvaluation.dimensions.pacing)
      dimensions.promptCompliance = Math.min(dimensions.promptCompliance, localEvaluation.dimensions.promptCompliance)
    }
    if (issue.type === 'chapter_task_perspective' || issue.type === 'chapter_task_style_forbidden_term') {
      dimensions.styleMatch = Math.min(dimensions.styleMatch, localEvaluation.dimensions.styleMatch)
      dimensions.promptCompliance = Math.min(dimensions.promptCompliance, localEvaluation.dimensions.promptCompliance)
    }
    if (issue.type === 'chapter_task_phrase_count' || issue.type === 'chapter_task_phrase_position') {
      dimensions.foreshadowingControl = Math.min(dimensions.foreshadowingControl, localEvaluation.dimensions.foreshadowingControl)
      dimensions.promptCompliance = Math.min(dimensions.promptCompliance, localEvaluation.dimensions.promptCompliance)
    }
    if (issue.type === 'chapter_task_post_phrase_tail') {
      dimensions.foreshadowingControl = Math.min(dimensions.foreshadowingControl, localEvaluation.dimensions.foreshadowingControl)
      dimensions.promptCompliance = Math.min(dimensions.promptCompliance, localEvaluation.dimensions.promptCompliance)
    }
    if (issue.type === 'chapter_task_forbidden_source_inquiry') {
      dimensions.foreshadowingControl = Math.min(dimensions.foreshadowingControl, localEvaluation.dimensions.foreshadowingControl)
      dimensions.promptCompliance = Math.min(dimensions.promptCompliance, localEvaluation.dimensions.promptCompliance)
    }
    if (issue.type === 'chapter_task_forbidden_outing_decision') {
      dimensions.plotCoherence = Math.min(dimensions.plotCoherence, localEvaluation.dimensions.plotCoherence)
      dimensions.promptCompliance = Math.min(dimensions.promptCompliance, localEvaluation.dimensions.promptCompliance)
    }
    if (issue.type === 'chapter_task_post_return_presence_break') {
      dimensions.plotCoherence = Math.min(dimensions.plotCoherence, localEvaluation.dimensions.plotCoherence)
      dimensions.promptCompliance = Math.min(dimensions.promptCompliance, localEvaluation.dimensions.promptCompliance)
    }
    if (issue.type === 'placeholder' || issue.type === 'promptCompliance') {
      dimensions.promptCompliance = Math.min(dimensions.promptCompliance, localEvaluation.dimensions.promptCompliance)
    }
  }
  const issues = [...evaluation.issues, ...localIssues]
  const overallScore = Math.min(evaluation.overallScore, qualityDimensionAverage(dimensions))
  return {
    ...evaluation,
    overallScore,
    pass: evaluation.pass && !localIssues.some((issue) => issue.severity === 'high') && overallScore >= QUALITY_GATE_PASS_SCORE,
    dimensions,
    issues,
    requiredFixes: [...new Set([...evaluation.requiredFixes, ...localIssues.filter((issue) => issue.severity === 'high').map((issue) => issue.suggestedFix)])],
    optionalSuggestions: [...new Set([...evaluation.optionalSuggestions, ...localIssues.filter((issue) => issue.severity !== 'high').map((issue) => issue.suggestedFix)])]
  }
}

function issueKind(issue: ConsistencyReviewIssue): 'character' | 'foreshadowing' | 'continuity' | 'setting' | 'other' {
  if (issue.type.includes('character')) return 'character'
  if (issue.type.includes('foreshadowing')) return 'foreshadowing'
  if (issue.type.includes('worldbuilding')) return 'setting'
  if (issue.type.includes('timeline') || issue.type.includes('continuity') || issue.type.includes('contradiction')) return 'continuity'
  return 'other'
}

function linkQualityIssues(qualityIssues: QualityGateIssue[], consistencyIssues: ConsistencyReviewIssue[]): QualityGateIssue[] {
  return qualityIssues.map((issue) => {
    if (issue.linkedConsistencyIssueId) return issue
    const text = `${issue.type} ${issue.description} ${issue.evidence}`.toLowerCase()
    const linked = consistencyIssues.find((candidate) => {
      const evidence = candidate.evidence.toLowerCase()
      const title = candidate.title.toLowerCase()
      const sameKind =
        (issue.type.includes('character') && issueKind(candidate) === 'character') ||
        (issue.type.includes('foreshadow') && issueKind(candidate) === 'foreshadowing') ||
        (issue.type.includes('continuity') && issueKind(candidate) === 'continuity')
      return (evidence && text.includes(evidence.slice(0, 24))) || (title && text.includes(title.slice(0, 16))) || sameKind
    })
    return linked ? { ...issue, linkedConsistencyIssueId: linked.id } : issue
  })
}

export function applyConsistencyFindings(
  evaluation: LocalQualityEvaluation,
  consistencyReports: ConsistencyReviewReport[] = []
): LocalQualityEvaluation {
  const consistencyIssues = activeConsistencyIssues(consistencyReports)
  if (!consistencyIssues.length) return evaluation
  const highIssues = consistencyIssues.filter((issue) => issue.severity === 'high')
  const linkedIssues = linkQualityIssues(evaluation.issues, consistencyIssues)
  const existingLinkedIds = new Set(linkedIssues.map((issue) => issue.linkedConsistencyIssueId).filter(Boolean))
  const synthesized = highIssues
    .filter((issue) => !existingLinkedIds.has(issue.id))
    .map<QualityGateIssue>((issue) => ({ severity: 'high', type: 'consistency_review_blocker', description: `一致性审稿已发现高风险问题：${issue.title}`, evidence: issue.evidence, suggestedFix: issue.revisionInstruction || issue.suggestedFix, linkedConsistencyIssueId: issue.id }))
  const dimensions = { ...evaluation.dimensions }
  for (const issue of highIssues) {
    const kind = issueKind(issue)
    if (kind === 'character') dimensions.characterConsistency = Math.min(dimensions.characterConsistency, 62)
    if (kind === 'foreshadowing') dimensions.foreshadowingControl = Math.min(dimensions.foreshadowingControl, 62)
    if (kind === 'continuity' || kind === 'setting') {
      dimensions.plotCoherence = Math.min(dimensions.plotCoherence, 65)
      dimensions.chapterContinuity = Math.min(dimensions.chapterContinuity, 62)
      dimensions.promptCompliance = Math.min(dimensions.promptCompliance, 68)
    }
  }
  const overallScore = Math.min(evaluation.overallScore, qualityDimensionAverage(dimensions))
  return {
    ...evaluation,
    overallScore,
    pass: evaluation.pass && highIssues.length === 0 && overallScore >= QUALITY_GATE_PASS_SCORE,
    dimensions,
    issues: [...linkedIssues, ...synthesized],
    requiredFixes: [...new Set([...evaluation.requiredFixes, ...highIssues.map((issue) => issue.revisionInstruction || issue.suggestedFix).filter(Boolean)])]
  }
}

function noveltyEvidence(finding: NoveltyFinding): string {
  const semantic = finding.semanticEvidence
  const details = [
    semantic?.beneficiary ? `受益对象：${semantic.beneficiary}` : '',
    semantic?.resolutionCue ? `解除动作：${semantic.resolutionCue}` : '',
    semantic?.costOrLimitCue ? `代价/限制：${semantic.costOrLimitCue}` : '',
    semantic?.sourceMediumCue ? `规则来源：${semantic.sourceMediumCue}` : ''
  ]
    .filter(Boolean)
    .join('；')
  const excerpt = finding.evidenceExcerpt || finding.text
  return details ? `${excerpt}（${details}）` : excerpt
}

function noveltyIssues(audit: NoveltyAuditResult): QualityGateIssue[] {
  const findings = collectNoveltyReviewFindings(audit)
  const toSeverity = (finding: typeof findings[number]): ConsistencySeverity =>
    finding.confidence === 'low' ? 'low' : finding.severity === 'fail' ? 'high' : finding.severity === 'warning' ? 'medium' : 'low'
  return findings
    .filter((finding) => finding.severity !== 'info' || !finding.allowedByTask)
    .map((finding) => ({
      severity: toSeverity(finding),
      type:
        finding.kind === 'new_named_character' || finding.kind === 'untraced_name'
          ? 'unauthorized_new_character'
          : finding.kind === 'new_organization_or_rank'
            ? 'unauthorized_new_organization'
            : finding.kind === 'major_lore_reveal'
              ? 'unauthorized_lore_reveal'
              : finding.kind === 'deus_ex_rule' || finding.kind === 'suspicious_deus_ex_rule'
                ? 'deus_ex_rule_patch'
                : 'unauthorized_new_rule',
      description: finding.reason,
      evidence: noveltyEvidence(finding),
      suggestedFix: `${finding.suggestedAction}${finding.sourceHint ? ` 来源：${finding.sourceHint}。` : ''}`
    }))
}

export function applyNoveltyAudit(evaluation: LocalQualityEvaluation, audit: NoveltyAuditResult): LocalQualityEvaluation {
  if (audit.severity === 'pass') return evaluation
  const issues = [...evaluation.issues, ...noveltyIssues(audit)]
  const dimensions = { ...evaluation.dimensions }
  if (audit.severity === 'fail') {
    dimensions.originality = Math.min(dimensions.originality, 55)
    dimensions.promptCompliance = Math.min(dimensions.promptCompliance, 58)
    dimensions.plotCoherence = Math.min(dimensions.plotCoherence, 62)
    dimensions.contextRelevanceCompliance = Math.min(dimensions.contextRelevanceCompliance, 65)
  } else {
    dimensions.originality = Math.min(dimensions.originality, 68)
    dimensions.promptCompliance = Math.min(dimensions.promptCompliance, 70)
  }
  const overallScore = Math.min(evaluation.overallScore, qualityDimensionAverage(dimensions))
  return {
    ...evaluation,
    overallScore,
    pass: evaluation.pass && audit.severity !== 'fail' && !issues.some((issue) => issue.severity === 'high') && overallScore >= QUALITY_GATE_PASS_SCORE,
    dimensions,
    issues,
    requiredFixes: [...new Set([...evaluation.requiredFixes, ...issues.filter((issue) => issue.severity === 'high').map((issue) => issue.suggestedFix)])],
    optionalSuggestions: [...new Set([...evaluation.optionalSuggestions, audit.summary, ...issues.filter((issue) => issue.severity !== 'high').map((issue) => issue.suggestedFix)].filter(Boolean))]
  }
}

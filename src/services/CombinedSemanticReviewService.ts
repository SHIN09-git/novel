import type {
  ConsistencyIssueType,
  ConsistencyReviewIssue,
  ConsistencyReviewReport,
  ConsistencySeverity,
  GeneratedChapterDraft,
  QualityGateIssue,
  QualityGateReport
} from '../shared/types'

interface ConsistencyClassification {
  type: ConsistencyIssueType
  category?: ConsistencyReviewIssue['category']
}

const NON_CONSISTENCY_TYPES = new Set([
  'manual_review_required',
  'redundancy_control',
  'style_mismatch',
  'pacing',
  'emotional_payoff',
  'originality',
  'prompt_compliance',
  'context_relevance_compliance'
])

function classifyIssue(issueType: string): ConsistencyClassification | null {
  const value = issueType.toLowerCase()
  if (NON_CONSISTENCY_TYPES.has(value)) return null
  if (/timeline|time_conflict/.test(value)) return { type: 'timeline_conflict', category: 'timeline' }
  if (/knowledge|secret_leak/.test(value)) return { type: 'character_knowledge_leak', category: 'character_ooc' }
  if (/motivation/.test(value)) return { type: 'character_motivation_gap', category: 'character_ooc' }
  if (/character_ooc|out_of_character/.test(value)) return { type: 'character_ooc', category: 'character_ooc' }
  if (/foreshadowing.*leak|premature.*reveal/.test(value)) return { type: 'foreshadowing_leak', category: 'foreshadowing' }
  if (/foreshadowing/.test(value)) return { type: 'foreshadowing_misuse', category: 'foreshadowing' }
  if (/geography|physics|location_jump/.test(value)) return { type: 'geography_or_physics_conflict', category: 'setting' }
  if (/previous_chapter|bridge|chapter_continuity/.test(value)) return { type: 'previous_chapter_contradiction', category: 'timeline' }
  if (/world|canon|setting|rule|lore|system|deus_ex/.test(value)) return { type: 'worldbuilding_conflict', category: 'setting' }
  if (/state_conflict|resource_underflow|missing_inventory|injury_reset|ability_overuse|promise_ignored|continuity/.test(value)) {
    return { type: 'continuity_gap', category: 'character_ooc' }
  }
  return null
}

function highestSeverity(issues: ConsistencyReviewIssue[]): ConsistencySeverity {
  if (issues.some((issue) => issue.severity === 'high')) return 'high'
  if (issues.some((issue) => issue.severity === 'medium')) return 'medium'
  return 'low'
}

function consistencyIssue(
  reportId: string,
  issue: QualityGateIssue,
  index: number,
  classification: ConsistencyClassification
): ConsistencyReviewIssue {
  const id = `combined-consistency-${reportId}-${index}`
  return {
    id,
    type: classification.type,
    category: classification.category,
    severity: issue.severity,
    title: issue.description || issue.type,
    description: issue.description,
    evidence: issue.evidence,
    relatedChapterIds: [],
    relatedCharacterIds: [],
    relatedForeshadowingIds: [],
    suggestedFix: issue.suggestedFix,
    revisionInstruction: issue.suggestedFix,
    status: 'open'
  }
}

/**
 * Standard mode asks one semantic reviewer for both release quality and
 * consistency. This adapter preserves the legacy report collections without a
 * second model call. Strict mode continues to create its independent report.
 */
export function deriveConsistencyReviewFromQualityGate(
  report: QualityGateReport,
  draft: GeneratedChapterDraft
): { qualityGateReport: QualityGateReport; consistencyReviewReport: ConsistencyReviewReport } {
  const mapped = report.issues.flatMap((issue, index) => {
    const classification = classifyIssue(issue.type)
    return classification ? [{ source: issue, issue: consistencyIssue(report.id, issue, index, classification) }] : []
  })
  const linkBySignature = new Map(mapped.map(({ source, issue }) => [`${source.type}\u0000${source.description}\u0000${source.evidence}`, issue.id]))
  const qualityGateReport: QualityGateReport = {
    ...report,
    issues: report.issues.map((issue) => ({
      ...issue,
      linkedConsistencyIssueId:
        issue.linkedConsistencyIssueId ?? linkBySignature.get(`${issue.type}\u0000${issue.description}\u0000${issue.evidence}`)
    }))
  }
  const issues = mapped.map((item) => item.issue)
  return {
    qualityGateReport,
    consistencyReviewReport: {
      id: `combined-consistency-${report.id}`,
      projectId: report.projectId,
      jobId: report.jobId,
      chapterId: report.chapterId,
      draftId: draft.id,
      draftContentHash: report.draftContentHash ?? null,
      promptContextSnapshotId: report.promptContextSnapshotId ?? null,
      issues,
      legacyIssuesText: '',
      suggestions: [...new Set(issues.map((issue) => issue.suggestedFix).filter(Boolean))].join('\n'),
      severitySummary: highestSeverity(issues),
      createdAt: report.createdAt
    }
  }
}

import type {
  ConsistencyIssueStatus,
  ConsistencyIssueType,
  ConsistencyReviewData,
  ConsistencyReviewIssue,
  ConsistencySeverity,
  ID,
  QualityGateDimensionScores,
  QualityGateIssue,
  RevisionResult
} from '../../../shared/types'
import { QUALITY_GATE_PASS_SCORE } from '../../../shared/qualityGatePolicy'
import type { QualityGateEvaluation } from '../../QualityGateService'
import { asObject, asString, asStringArray, asText, clampScore } from './primitives'

export function normalizeSeverity(value: unknown): ConsistencySeverity {
  if (value === 'low' || value === 'medium' || value === 'high') return value
  return 'medium'
}

export function normalizeIssueCategory(value: unknown): ConsistencyReviewIssue['category'] {
  if (
    value === 'timeline' ||
    value === 'setting' ||
    value === 'character_ooc' ||
    value === 'foreshadowing' ||
    value === 'pacing' ||
    value === 'reader_emotion'
  ) {
    return value
  }
  return 'setting'
}

export function normalizeConsistencyIssueType(value: unknown): ConsistencyIssueType {
  if (
    value === 'timeline_conflict' ||
    value === 'worldbuilding_conflict' ||
    value === 'character_knowledge_leak' ||
    value === 'character_motivation_gap' ||
    value === 'character_ooc' ||
    value === 'foreshadowing_misuse' ||
    value === 'foreshadowing_leak' ||
    value === 'geography_or_physics_conflict' ||
    value === 'previous_chapter_contradiction' ||
    value === 'continuity_gap' ||
    value === 'other'
  ) {
    return value
  }
  if (value === 'timeline') return 'timeline_conflict'
  if (value === 'setting') return 'worldbuilding_conflict'
  if (value === 'foreshadowing') return 'foreshadowing_misuse'
  return 'other'
}

function normalizeConsistencyIssueStatus(value: unknown): ConsistencyIssueStatus {
  return value === 'ignored' || value === 'converted_to_revision' || value === 'resolved' ? value : 'open'
}

function asIssueId(value: unknown): ID {
  return asString(value) || crypto.randomUUID()
}

export function ensureConsistencyReview(value: unknown): ConsistencyReviewData {
  const obj = asObject(value)
  const issues = Array.isArray(obj.issues)
    ? obj.issues.map((item) => {
        const issue = asObject(item)
        const description = asString(issue.description)
        const suggestedFix = asString(issue.suggestedFix) || asString(issue.suggestion)
        return {
          id: asIssueId(issue.id),
          type: normalizeConsistencyIssueType(issue.type ?? issue.category),
          category: normalizeIssueCategory(issue.category),
          severity: normalizeSeverity(issue.severity),
          title: asString(issue.title) || description.slice(0, 36) || '一致性问题',
          description,
          evidence: asString(issue.evidence),
          relatedChapterIds: asStringArray(issue.relatedChapterIds),
          relatedCharacterIds: asStringArray(issue.relatedCharacterIds),
          relatedForeshadowingIds: asStringArray(issue.relatedForeshadowingIds),
          suggestedFix,
          revisionInstruction: asString(issue.revisionInstruction) || suggestedFix || description,
          status: normalizeConsistencyIssueStatus(issue.status),
          suggestion: asString(issue.suggestion) || suggestedFix
        }
      })
    : []

  return {
    timelineProblems: asStringArray(obj.timelineProblems),
    settingConflicts: asStringArray(obj.settingConflicts),
    characterOOC: asStringArray(obj.characterOOC),
    foreshadowingMisuse: asStringArray(obj.foreshadowingMisuse),
    pacingProblems: asStringArray(obj.pacingProblems),
    emotionPayoffProblems: asStringArray(obj.emotionPayoffProblems),
    suggestions: asStringArray(obj.suggestions),
    severitySummary: normalizeSeverity(obj.severitySummary),
    issues
  }
}

export function ensureDimensionScores(value: unknown): QualityGateDimensionScores {
  const obj = asObject(value)
  return {
    plotCoherence: clampScore(obj.plotCoherence),
    characterConsistency: clampScore(obj.characterConsistency),
    characterStateConsistency: clampScore(obj.characterStateConsistency),
    foreshadowingControl: clampScore(obj.foreshadowingControl),
    chapterContinuity: clampScore(obj.chapterContinuity),
    redundancyControl: clampScore(obj.redundancyControl),
    styleMatch: clampScore(obj.styleMatch),
    pacing: clampScore(obj.pacing),
    emotionalPayoff: clampScore(obj.emotionalPayoff),
    originality: clampScore(obj.originality),
    promptCompliance: clampScore(obj.promptCompliance),
    contextRelevanceCompliance: clampScore(obj.contextRelevanceCompliance)
  }
}

export function ensureQualityGateIssue(value: unknown): QualityGateIssue {
  const obj = asObject(value)
  return {
    severity: normalizeSeverity(obj.severity),
    type: asString(obj.type) || 'general',
    description: asString(obj.description),
    evidence: asString(obj.evidence),
    suggestedFix: asString(obj.suggestedFix),
    linkedConsistencyIssueId: asString(obj.linkedConsistencyIssueId) || undefined
  }
}

export function ensureQualityGateEvaluation(value: unknown): QualityGateEvaluation {
  const obj = asObject(value)
  const dimensions = ensureDimensionScores(obj.dimensions)
  const overallScore = clampScore(obj.overallScore)
  const issues = Array.isArray(obj.issues) ? obj.issues.map(ensureQualityGateIssue) : []
  return {
    overallScore,
    pass:
      typeof obj.pass === 'boolean'
        ? obj.pass
        : overallScore >= QUALITY_GATE_PASS_SCORE && !issues.some((issue) => issue.severity === 'high'),
    dimensions,
    issues,
    requiredFixes: asStringArray(obj.requiredFixes),
    optionalSuggestions: asStringArray(obj.optionalSuggestions)
  }
}

export function ensureRevisionCandidate(value: unknown): { revisionInstruction: string; revisedText: string } {
  const obj = asObject(value)
  return {
    revisionInstruction: asString(obj.revisionInstruction),
    revisedText: asString(obj.revisedText)
  }
}

export function ensureRevisionResult(value: unknown): RevisionResult {
  const obj = asObject(value)
  return {
    revisedText: asString(obj.revisedText),
    changedSummary: asText(obj.changedSummary),
    risks: asText(obj.risks),
    preservedFacts: asText(obj.preservedFacts)
  }
}

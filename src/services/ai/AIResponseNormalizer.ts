import type {
  AIResult,
  Character,
  CharacterStateSuggestion,
  Chapter,
  ChapterDraftResult,
  ChapterPlan,
  ChapterReviewDraft,
  ConsistencyReviewData,
  ConsistencyReviewIssue,
  ConsistencyIssueStatus,
  ConsistencyIssueType,
  ConsistencySeverity,
  Foreshadowing,
  ForeshadowingCandidate,
  ForeshadowingExtractionResult,
  ForeshadowingStatusChangeSuggestion,
  ForeshadowingTreatmentMode,
  ForeshadowingWeight,
  ID,
  NextChapterSuggestions,
  PipelineMode,
  QualityGateDimensionScores,
  QualityGateIssue,
  RevisionRequestType,
  RevisionResult,
  StageSummary
} from '../../shared/types'
import type { QualityGateEvaluation } from '../QualityGateService'
import { normalizeTreatmentMode } from '../../shared/foreshadowingTreatment'

export function fallbackResult<T>(data: T, error = '未配置 API Key，已生成本地结构化模板。'): AIResult<T> {
  return { ok: true, usedAI: false, data, error }
}

export function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function normalizeWeight(value: unknown): ForeshadowingWeight {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'payoff') return value
  if (value === '低') return 'low'
  if (value === '中') return 'medium'
  if (value === '高') return 'high'
  if (value === '回收') return 'payoff'
  return 'medium'
}

export function normalizeRecommendedTreatmentMode(value: unknown): ForeshadowingTreatmentMode | undefined {
  if (value === null || value === undefined || value === '') return undefined
  return normalizeTreatmentMode(value)
}

export function normalizeNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

export function ensureChapterReview(value: unknown): ChapterReviewDraft {
  const obj = asObject(value)
  const bridge = asObject(obj.continuityBridgeSuggestion)
  return {
    summary: asString(obj.summary),
    newInformation: asString(obj.newInformation),
    characterChanges: asString(obj.characterChanges),
    newForeshadowing: asString(obj.newForeshadowing),
    resolvedForeshadowing: asString(obj.resolvedForeshadowing),
    endingHook: asString(obj.endingHook),
    riskWarnings: asString(obj.riskWarnings),
    continuityBridgeSuggestion: {
      lastSceneLocation: asString(bridge.lastSceneLocation),
      lastPhysicalState: asString(bridge.lastPhysicalState),
      lastEmotionalState: asString(bridge.lastEmotionalState),
      lastUnresolvedAction: asString(bridge.lastUnresolvedAction),
      lastDialogueOrThought: asString(bridge.lastDialogueOrThought),
      immediateNextBeat: asString(bridge.immediateNextBeat),
      mustContinueFrom: asString(bridge.mustContinueFrom),
      mustNotReset: asString(bridge.mustNotReset),
      openMicroTensions: asString(bridge.openMicroTensions)
    }
  }
}

export function ensureCharacterSuggestions(value: unknown, characterIds: Set<ID>): CharacterStateSuggestion[] {
  const list = Array.isArray(value) ? value : asObject(value).suggestions
  if (!Array.isArray(list)) return []

  return list
    .map((item) => asObject(item))
    .filter((item) => characterIds.has(asString(item.characterId)))
    .map((item) => ({
      characterId: asString(item.characterId),
      changeSummary: asString(item.changeSummary),
      newCurrentEmotionalState: asString(item.newCurrentEmotionalState),
      newRelationshipWithProtagonist: asString(item.newRelationshipWithProtagonist),
      newNextActionTendency: asString(item.newNextActionTendency),
      relatedChapterId: asString(item.relatedChapterId) || null,
      confidence: Math.max(0, Math.min(1, asNumber(item.confidence, 0.5)))
    }))
}

export function ensureCandidate(value: unknown, validCharacterIds: Set<ID>): ForeshadowingCandidate {
  const obj = asObject(value)
  return {
    title: asString(obj.title) || '未命名伏笔',
    description: asString(obj.description),
    firstChapterOrder: normalizeNullableNumber(obj.firstChapterOrder),
    suggestedWeight: normalizeWeight(obj.suggestedWeight),
    recommendedTreatmentMode: normalizeRecommendedTreatmentMode(obj.recommendedTreatmentMode),
    expectedPayoff: asString(obj.expectedPayoff),
    relatedCharacterIds: asStringArray(obj.relatedCharacterIds).filter((id) => validCharacterIds.has(id)),
    notes: asString(obj.notes)
  }
}

export function ensureForeshadowingExtraction(value: unknown, foreshadowingIds: Set<ID>, characterIds: Set<ID>): ForeshadowingExtractionResult {
  const obj = asObject(value)
  const statusChanges = Array.isArray(obj.statusChanges) ? obj.statusChanges : []
  const normalizedChanges: ForeshadowingStatusChangeSuggestion[] = statusChanges
    .map((item) => asObject(item))
    .filter((item) => foreshadowingIds.has(asString(item.foreshadowingId)))
    .map((item) => {
      const status = asString(item.suggestedStatus)
      return {
        foreshadowingId: asString(item.foreshadowingId),
        suggestedStatus:
          status === 'resolved' || status === 'partial' || status === 'abandoned' || status === 'unresolved'
            ? status
            : 'partial',
        recommendedTreatmentMode: normalizeRecommendedTreatmentMode(item.recommendedTreatmentMode),
        evidenceText: asString(item.evidenceText),
        notes: asString(item.notes),
        confidence: Math.max(0, Math.min(1, asNumber(item.confidence, 0.5)))
      }
    })

  const advancedForeshadowingIds = asStringArray(obj.advancedForeshadowingIds).filter((id) => foreshadowingIds.has(id))
  const resolvedForeshadowingIds = asStringArray(obj.resolvedForeshadowingIds).filter((id) => foreshadowingIds.has(id))
  for (const id of advancedForeshadowingIds) {
    if (!normalizedChanges.some((change) => change.foreshadowingId === id)) {
      normalizedChanges.push({ foreshadowingId: id, suggestedStatus: 'partial', recommendedTreatmentMode: 'advance', evidenceText: '', notes: '', confidence: 0.5 })
    }
  }
  for (const id of resolvedForeshadowingIds) {
    if (!normalizedChanges.some((change) => change.foreshadowingId === id)) {
      normalizedChanges.push({ foreshadowingId: id, suggestedStatus: 'resolved', recommendedTreatmentMode: 'pause', evidenceText: '', notes: '', confidence: 0.5 })
    }
  }

  return {
    newForeshadowingCandidates: Array.isArray(obj.newForeshadowingCandidates)
      ? obj.newForeshadowingCandidates.map((item) => ensureCandidate(item, characterIds))
      : [],
    advancedForeshadowingIds,
    resolvedForeshadowingIds,
    abandonedForeshadowingCandidates: Array.isArray(obj.abandonedForeshadowingCandidates)
      ? obj.abandonedForeshadowingCandidates.map((item) => ensureCandidate(item, characterIds))
      : [],
    statusChanges: normalizedChanges
  }
}

export function ensureNextSuggestions(value: unknown): NextChapterSuggestions {
  const obj = asObject(value)
  return {
    nextChapterGoal: asString(obj.nextChapterGoal),
    conflictToPush: asString(obj.conflictToPush),
    suspenseToKeep: asString(obj.suspenseToKeep),
    foreshadowingToHint: asString(obj.foreshadowingToHint),
    foreshadowingNotToReveal: asString(obj.foreshadowingNotToReveal),
    suggestedEndingHook: asString(obj.suggestedEndingHook),
    readerEmotionTarget: asString(obj.readerEmotionTarget)
  }
}

export function ensureChapterPlan(value: unknown): ChapterPlan {
  const obj = asObject(value)
  return {
    chapterTitle: asString(obj.chapterTitle) || '未命名章节',
    chapterGoal: asString(obj.chapterGoal),
    conflictToPush: asString(obj.conflictToPush),
    characterBeats: asString(obj.characterBeats),
    foreshadowingToUse: asString(obj.foreshadowingToUse),
    foreshadowingNotToReveal: asString(obj.foreshadowingNotToReveal),
    endingHook: asString(obj.endingHook),
    readerEmotionTarget: asString(obj.readerEmotionTarget),
    estimatedWordCount: asString(obj.estimatedWordCount),
    openingContinuationBeat: asString(obj.openingContinuationBeat),
    carriedPhysicalState: asString(obj.carriedPhysicalState),
    carriedEmotionalState: asString(obj.carriedEmotionalState),
    unresolvedMicroTensions: asString(obj.unresolvedMicroTensions),
    forbiddenResets: asString(obj.forbiddenResets)
  }
}

export function ensureChapterDraft(value: unknown): ChapterDraftResult {
  const obj = asObject(value)
  return {
    title: asString(obj.title) || asString(obj.chapterTitle) || '未命名章节',
    body:
      asString(obj.body) ||
      asString(obj.chapterBody) ||
      asString(obj.chapterText) ||
      asString(obj.content) ||
      asString(obj.text) ||
      asString(obj.draft) ||
      asString(obj.markdown)
  }
}

export function rawTextAsChapterDraft(rawText: string, fallbackTitle: string): ChapterDraftResult | null {
  const trimmed = rawText.trim()
  if (!trimmed) return null
  const fenced = trimmed.match(/```(?:json|markdown|md|text)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const body = fenced || trimmed
  if (!body) return null
  if (/^\s*[\[{]/.test(body) || /"(?:body|chapterBody|chapterText|content)"\s*:/.test(body)) return null
  return {
    title: fallbackTitle || '未命名章节',
    body
  }
}

export function isTruncatedFinishReason(value: string | undefined): boolean {
  return /length|max[_-]?tokens|token_limit/i.test(value ?? '')
}

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

export function clampScore(value: unknown, fallback = 70): number {
  return Math.max(0, Math.min(100, Math.round(asNumber(value, fallback))))
}

export function ensureDimensionScores(value: unknown): QualityGateDimensionScores {
  const obj = asObject(value)
  return {
    plotCoherence: clampScore(obj.plotCoherence),
    characterConsistency: clampScore(obj.characterConsistency),
    foreshadowingControl: clampScore(obj.foreshadowingControl),
    chapterContinuity: clampScore(obj.chapterContinuity),
    redundancyControl: clampScore(obj.redundancyControl),
    styleMatch: clampScore(obj.styleMatch),
    pacing: clampScore(obj.pacing),
    emotionalPayoff: clampScore(obj.emotionalPayoff),
    originality: clampScore(obj.originality),
    promptCompliance: clampScore(obj.promptCompliance)
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
    pass: typeof obj.pass === 'boolean' ? obj.pass : overallScore >= 75 && !issues.some((issue) => issue.severity === 'high'),
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
    changedSummary: asString(obj.changedSummary),
    risks: asString(obj.risks),
    preservedFacts: asString(obj.preservedFacts)
  }
}

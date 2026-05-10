import type {
  AIResult,
  CharacterCardField,
  Character,
  CharacterStateChangeSuggestion,
  CharacterStateSuggestion,
  CharacterStateTransactionType,
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
  StageSummary,
  StateFactCategory
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

export function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    return value
      .map((item) => asText(item))
      .map((item) => item.trim())
      .filter(Boolean)
      .join('\n')
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        const text = asText(item).trim()
        return text ? `${key}: ${text}` : ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
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

const STATE_CATEGORIES: StateFactCategory[] = [
  'resource',
  'inventory',
  'location',
  'physical',
  'mental',
  'knowledge',
  'relationship',
  'goal',
  'promise',
  'secret',
  'ability',
  'status',
  'custom'
]
const CARD_FIELDS: CharacterCardField[] = [
  'roleFunction',
  'surfaceGoal',
  'deepNeed',
  'coreFear',
  'decisionLogic',
  'abilitiesAndResources',
  'weaknessAndCost',
  'relationshipTension',
  'futureHooks'
]
const TRANSACTION_TYPES: CharacterStateTransactionType[] = [
  'create',
  'update',
  'increment',
  'decrement',
  'add_item',
  'remove_item',
  'move',
  'learn',
  'resolve',
  'invalidate'
]

function normalizeStateCategory(value: unknown): StateFactCategory {
  const raw = asString(value)
  return STATE_CATEGORIES.includes(raw as StateFactCategory) ? (raw as StateFactCategory) : 'custom'
}

function normalizeCardFields(value: unknown): CharacterCardField[] {
  return asStringArray(value).filter((field): field is CharacterCardField => CARD_FIELDS.includes(field as CharacterCardField))
}

function normalizeTransactionType(value: unknown): CharacterStateTransactionType {
  const raw = asString(value)
  return TRANSACTION_TYPES.includes(raw as CharacterStateTransactionType) ? (raw as CharacterStateTransactionType) : 'update'
}

function normalizeStateValue(value: unknown): CharacterStateChangeSuggestion['afterValue'] {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value
  return asText(value)
}

function ensureCharacterStateChangeSuggestion(value: unknown): CharacterStateChangeSuggestion {
  const obj = asObject(value)
  const changeType = asString(obj.changeType)
  const riskLevel = asString(obj.riskLevel)
  const delta = asNumber(obj.delta, Number.NaN)
  return {
    characterId: asString(obj.characterId),
    category: normalizeStateCategory(obj.category),
    key: asString(obj.key),
    label: asString(obj.label) || asString(obj.key) || '状态变化',
    changeType:
      changeType === 'create_fact' ||
      changeType === 'update_fact' ||
      changeType === 'transaction' ||
      changeType === 'resolve_fact' ||
      changeType === 'conflict'
        ? changeType
        : 'update_fact',
    beforeValue: normalizeStateValue(obj.beforeValue),
    afterValue: normalizeStateValue(obj.afterValue),
    delta: Number.isFinite(delta) ? delta : null,
    evidence: asText(obj.evidence),
    confidence: Math.max(0, Math.min(1, asNumber(obj.confidence, 0.5))),
    riskLevel: riskLevel === 'low' || riskLevel === 'medium' || riskLevel === 'high' ? riskLevel : 'medium',
    suggestedTransactionType: normalizeTransactionType(obj.suggestedTransactionType),
    linkedCardFields: normalizeCardFields(obj.linkedCardFields)
  }
}

export function ensureChapterReview(value: unknown): ChapterReviewDraft {
  const obj = asObject(value)
  const bridge = asObject(obj.continuityBridgeSuggestion)
  const stateSuggestions = Array.isArray(obj.characterStateChangeSuggestions) ? obj.characterStateChangeSuggestions : []
  return {
    summary: asText(obj.summary),
    newInformation: asText(obj.newInformation),
    characterChanges: asText(obj.characterChanges),
    newForeshadowing: asText(obj.newForeshadowing),
    resolvedForeshadowing: asText(obj.resolvedForeshadowing),
    endingHook: asText(obj.endingHook),
    riskWarnings: asText(obj.riskWarnings),
    continuityBridgeSuggestion: {
      lastSceneLocation: asText(bridge.lastSceneLocation),
      lastPhysicalState: asText(bridge.lastPhysicalState),
      lastEmotionalState: asText(bridge.lastEmotionalState),
      lastUnresolvedAction: asText(bridge.lastUnresolvedAction),
      lastDialogueOrThought: asText(bridge.lastDialogueOrThought),
      immediateNextBeat: asText(bridge.immediateNextBeat),
      mustContinueFrom: asText(bridge.mustContinueFrom),
      mustNotReset: asText(bridge.mustNotReset),
      openMicroTensions: asText(bridge.openMicroTensions)
    },
    characterStateChangeSuggestions: stateSuggestions.map(ensureCharacterStateChangeSuggestion).filter((item) => item.characterId)
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
    conflictToPush: asText(obj.conflictToPush),
    suspenseToKeep: asString(obj.suspenseToKeep),
    foreshadowingToHint: asString(obj.foreshadowingToHint),
    foreshadowingNotToReveal: asText(obj.foreshadowingNotToReveal),
    suggestedEndingHook: asString(obj.suggestedEndingHook),
    readerEmotionTarget: asText(obj.readerEmotionTarget)
  }
}

export function ensureChapterPlan(value: unknown): ChapterPlan {
  const obj = asObject(value)
  return {
    chapterTitle: asText(obj.chapterTitle) || '未命名章节',
    chapterGoal: asText(obj.chapterGoal),
    conflictToPush: asText(obj.conflictToPush),
    characterBeats: asText(obj.characterBeats),
    foreshadowingToUse: asText(obj.foreshadowingToUse),
    foreshadowingNotToReveal: asText(obj.foreshadowingNotToReveal),
    endingHook: asText(obj.endingHook),
    readerEmotionTarget: asText(obj.readerEmotionTarget),
    estimatedWordCount: asText(obj.estimatedWordCount),
    openingContinuationBeat: asText(obj.openingContinuationBeat),
    carriedPhysicalState: asText(obj.carriedPhysicalState),
    carriedEmotionalState: asText(obj.carriedEmotionalState),
    unresolvedMicroTensions: asText(obj.unresolvedMicroTensions),
    forbiddenResets: asText(obj.forbiddenResets),
    allowedNovelty: asText(obj.allowedNovelty),
    forbiddenNovelty: asText(obj.forbiddenNovelty)
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
    pass: typeof obj.pass === 'boolean' ? obj.pass : overallScore >= 50 && !issues.some((issue) => issue.severity === 'high'),
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


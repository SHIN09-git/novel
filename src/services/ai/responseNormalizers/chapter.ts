import type {
  ChapterDraftResult,
  ChapterPlan,
  ChapterReviewDraft,
  ForeshadowingCandidate,
  ForeshadowingExtractionResult,
  ForeshadowingStatusChangeSuggestion,
  ID,
  NextChapterSuggestions
} from '../../../shared/types'
import { ensureCharacterStateChangeSuggestion } from './characterState'
import {
  asNumber,
  asObject,
  asString,
  asStringArray,
  asText,
  normalizeNullableNumber,
  normalizeRecommendedTreatmentMode,
  normalizeWeight
} from './primitives'

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

export function ensureForeshadowingExtraction(
  value: unknown,
  foreshadowingIds: Set<ID>,
  characterIds: Set<ID>
): ForeshadowingExtractionResult {
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
      normalizedChanges.push({
        foreshadowingId: id,
        suggestedStatus: 'partial',
        recommendedTreatmentMode: 'advance',
        evidenceText: '',
        notes: '',
        confidence: 0.5
      })
    }
  }
  for (const id of resolvedForeshadowingIds) {
    if (!normalizedChanges.some((change) => change.foreshadowingId === id)) {
      normalizedChanges.push({
        foreshadowingId: id,
        suggestedStatus: 'resolved',
        recommendedTreatmentMode: 'pause',
        evidenceText: '',
        notes: '',
        confidence: 0.5
      })
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

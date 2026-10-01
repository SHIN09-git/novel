import type {
  CharacterStateChangeSuggestion,
  CharacterStateSuggestion,
  ChapterReviewDraft,
  ForeshadowingCandidate,
  ForeshadowingExtractionResult,
  ForeshadowingStatusChangeSuggestion,
  ID,
  PostDraftAnalysisMode,
  PostDraftAnalysisResult
} from '../../../shared/types'
import { ensureCharacterSuggestions } from './characterState'
import { ensureChapterReview, ensureForeshadowingExtraction } from './chapter'
import { asObject, asStringArray } from './primitives'

const EMPTY_MARKERS = new Set([
  '',
  '-',
  '--',
  '—',
  '无',
  '暂无',
  '待补充',
  '待确认',
  '未提供',
  '未知',
  'n/a',
  'null',
  'undefined',
  '未命名伏笔',
  '待确认新伏笔',
  '角色变化',
  '状态变化'
])

function compactMarker(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[。.!！?？]+$/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/** Treat model/template placeholders as absence, not as durable memory evidence. */
export function isMeaningfulPostDraftText(value: unknown): boolean {
  const compact = compactMarker(value)
  if (!compact || EMPTY_MARKERS.has(compact)) return false
  if (/^(?:本章)?(?:剧情摘要|新增信息|角色变化|新增伏笔|已回收伏笔|结尾钩子|风险提醒)[:：]?(?:-|—|无|暂无|待补充)?$/.test(compact)) {
    return false
  }
  if (/^请根据本章正文(?:补充|填写|判断)/.test(compact)) return false
  if (/^(?:暂无|无|没有)(?:明显|长期|关键|相关|新的)?(?:变化|更新|内容|信息|伏笔|风险|问题|结果)?$/.test(compact)) {
    return false
  }
  return true
}

function cleanPostDraftText(value: unknown): string {
  const text = String(value ?? '').trim()
  return isMeaningfulPostDraftText(text) ? text : ''
}

function hasMeaningfulStateValue(value: CharacterStateChangeSuggestion['afterValue']): boolean {
  if (typeof value === 'number' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.some((item) => isMeaningfulPostDraftText(item))
  return isMeaningfulPostDraftText(value)
}

function isMeaningfulHardStateSuggestion(
  suggestion: CharacterStateChangeSuggestion,
  characterIds: Set<ID>
): boolean {
  if (!characterIds.has(suggestion.characterId)) return false
  if (!isMeaningfulPostDraftText(suggestion.key) || !isMeaningfulPostDraftText(suggestion.evidence)) return false
  return (
    suggestion.changeType === 'resolve_fact' ||
    suggestion.changeType === 'conflict' ||
    suggestion.delta !== null ||
    hasMeaningfulStateValue(suggestion.beforeValue) ||
    hasMeaningfulStateValue(suggestion.afterValue)
  )
}

function isMeaningfulCharacterSuggestion(suggestion: CharacterStateSuggestion): boolean {
  return (
    isMeaningfulPostDraftText(suggestion.changeSummary) &&
    [
      suggestion.newCurrentEmotionalState,
      suggestion.newRelationshipWithProtagonist,
      suggestion.newNextActionTendency
    ].some((value) => isMeaningfulPostDraftText(value))
  )
}

function isMeaningfulForeshadowingCandidate(candidate: ForeshadowingCandidate): boolean {
  return isMeaningfulPostDraftText(candidate.title) && isMeaningfulPostDraftText(candidate.description)
}

function uniqueBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = keyOf(item)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function sanitizeChapterReviewForPostDraft(
  value: unknown,
  characterIds: Set<ID>
): ChapterReviewDraft {
  const review = ensureChapterReview(value)
  return {
    summary: cleanPostDraftText(review.summary),
    newInformation: cleanPostDraftText(review.newInformation),
    characterChanges: cleanPostDraftText(review.characterChanges),
    newForeshadowing: cleanPostDraftText(review.newForeshadowing),
    resolvedForeshadowing: cleanPostDraftText(review.resolvedForeshadowing),
    endingHook: cleanPostDraftText(review.endingHook),
    riskWarnings: cleanPostDraftText(review.riskWarnings),
    continuityBridgeSuggestion: {
      lastSceneLocation: cleanPostDraftText(review.continuityBridgeSuggestion.lastSceneLocation),
      lastPhysicalState: cleanPostDraftText(review.continuityBridgeSuggestion.lastPhysicalState),
      lastEmotionalState: cleanPostDraftText(review.continuityBridgeSuggestion.lastEmotionalState),
      lastUnresolvedAction: cleanPostDraftText(review.continuityBridgeSuggestion.lastUnresolvedAction),
      lastDialogueOrThought: cleanPostDraftText(review.continuityBridgeSuggestion.lastDialogueOrThought),
      immediateNextBeat: cleanPostDraftText(review.continuityBridgeSuggestion.immediateNextBeat),
      mustContinueFrom: cleanPostDraftText(review.continuityBridgeSuggestion.mustContinueFrom),
      mustNotReset: cleanPostDraftText(review.continuityBridgeSuggestion.mustNotReset),
      openMicroTensions: cleanPostDraftText(review.continuityBridgeSuggestion.openMicroTensions)
    },
    characterStateChangeSuggestions: uniqueBy(
      review.characterStateChangeSuggestions.filter((item) => isMeaningfulHardStateSuggestion(item, characterIds)),
      (item) => `${item.characterId}:${item.category}:${item.key}:${item.changeType}`
    )
  }
}

export function sanitizeCharacterSuggestionsForPostDraft(
  value: unknown,
  characterIds: Set<ID>
): CharacterStateSuggestion[] {
  return uniqueBy(
    ensureCharacterSuggestions(value, characterIds).filter(isMeaningfulCharacterSuggestion),
    (item) => `${item.characterId}:${item.changeSummary}`
  )
}

export function sanitizeForeshadowingExtractionForPostDraft(
  value: unknown,
  foreshadowingIds: Set<ID>,
  characterIds: Set<ID>
): ForeshadowingExtractionResult {
  const extraction = ensureForeshadowingExtraction(value, foreshadowingIds, characterIds)
  const resolvedIds = new Set(extraction.resolvedForeshadowingIds)
  const advancedForeshadowingIds = [...new Set(extraction.advancedForeshadowingIds)].filter(
    (id) => !resolvedIds.has(id)
  )
  const resolvedForeshadowingIds = [...resolvedIds]
  const statusChanges = uniqueBy(
    extraction.statusChanges
      .filter(
        (change) =>
          foreshadowingIds.has(change.foreshadowingId) &&
          (isMeaningfulPostDraftText(change.evidenceText) || isMeaningfulPostDraftText(change.notes))
      )
      .map((change): ForeshadowingStatusChangeSuggestion => {
        if (resolvedIds.has(change.foreshadowingId)) return { ...change, suggestedStatus: 'resolved' }
        if (advancedForeshadowingIds.includes(change.foreshadowingId) && change.suggestedStatus === 'unresolved') {
          return { ...change, suggestedStatus: 'partial' }
        }
        return change
      }),
    (change) => change.foreshadowingId
  )

  return {
    newForeshadowingCandidates: uniqueBy(
      extraction.newForeshadowingCandidates.filter(isMeaningfulForeshadowingCandidate),
      (candidate) => compactMarker(candidate.title)
    ),
    advancedForeshadowingIds,
    resolvedForeshadowingIds,
    abandonedForeshadowingCandidates: uniqueBy(
      extraction.abandonedForeshadowingCandidates.filter(isMeaningfulForeshadowingCandidate),
      (candidate) => compactMarker(candidate.title)
    ),
    statusChanges
  }
}

function analysisMode(value: unknown): PostDraftAnalysisMode {
  return value === 'legacy_review_fallback' ? value : 'unified'
}

export function ensurePostDraftAnalysis(
  value: unknown,
  characterIds: Set<ID>,
  foreshadowingIds: Set<ID>
): PostDraftAnalysisResult {
  const obj = asObject(value)
  return {
    chapterReview: sanitizeChapterReviewForPostDraft(obj.chapterReview, characterIds),
    characterSuggestions: sanitizeCharacterSuggestionsForPostDraft(obj.characterSuggestions, characterIds),
    foreshadowingExtraction: sanitizeForeshadowingExtractionForPostDraft(
      obj.foreshadowingExtraction,
      foreshadowingIds,
      characterIds
    ),
    analysisMode: analysisMode(obj.analysisMode),
    warnings: asStringArray(obj.warnings).filter(isMeaningfulPostDraftText)
  }
}

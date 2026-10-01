import type { CharacterStateSuggestion } from './character'
import type { ForeshadowingExtractionResult } from './foreshadowing'
import type { ChapterReviewDraft } from './memory'

export type PostDraftAnalysisMode = 'unified' | 'legacy_review_fallback'

/**
 * One post-draft response feeds review, character, and foreshadowing candidate
 * steps. The legacy feature-specific methods remain available for old jobs and
 * partial retries that do not have this combined payload.
 */
export interface PostDraftAnalysisResult {
  chapterReview: ChapterReviewDraft
  characterSuggestions: CharacterStateSuggestion[]
  foreshadowingExtraction: ForeshadowingExtractionResult
  /** Optional so persisted outputs from jobs created before the unified flow remain readable. */
  analysisMode?: PostDraftAnalysisMode
  warnings?: string[]
}

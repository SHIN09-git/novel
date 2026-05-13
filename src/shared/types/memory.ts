import type { ID, StageSummary, TimelineEvent } from './base'
import type { CharacterStateChangeSuggestion, CharacterStateMemoryPatch } from './character'
import type { ForeshadowingCreateMemoryPatch, ForeshadowingStatusMemoryPatch } from './foreshadowing'

export type MemoryUpdateCandidateType = 'character' | 'foreshadowing' | 'chapter_review' | 'stage_summary' | 'timeline_event'

export type MemoryUpdateCandidateStatus = 'pending' | 'accepted' | 'rejected'

export interface ChapterContinuityBridgeSuggestion {
  lastSceneLocation: string
  lastPhysicalState: string
  lastEmotionalState: string
  lastUnresolvedAction: string
  lastDialogueOrThought: string
  immediateNextBeat: string
  mustContinueFrom: string
  mustNotReset: string
  openMicroTensions: string
}

export interface ChapterContinuityBridge extends ChapterContinuityBridgeSuggestion {
  id: ID
  projectId: ID
  fromChapterId: ID
  toChapterOrder: number
  createdAt: string
  updatedAt: string
}

export interface ChapterReviewDraft {
  summary: string
  newInformation: string
  characterChanges: string
  newForeshadowing: string
  resolvedForeshadowing: string
  endingHook: string
  riskWarnings: string
  continuityBridgeSuggestion: ChapterContinuityBridgeSuggestion
  characterStateChangeSuggestions: CharacterStateChangeSuggestion[]
}

export interface MemoryPatchBase {
  schemaVersion: number
  kind: string
  summary: string
  sourceChapterOrder?: number | null
  warnings?: string[]
}

export interface ChapterReviewMemoryPatch extends MemoryPatchBase {
  kind: 'chapter_review_update'
  targetChapterId: ID | null
  targetChapterOrder: number | null
  review: {
    summary: string
    newInformation: string
    characterChanges: string
    newForeshadowing: string
    resolvedForeshadowing: string
    endingHook: string
    riskWarnings: string
  }
  continuityBridgeSuggestion: ChapterContinuityBridgeSuggestion | null
}

export interface StageSummaryMemoryPatch extends MemoryPatchBase {
  kind: 'stage_summary_create'
  stageSummary: Partial<StageSummary>
}

export interface TimelineEventMemoryPatch extends MemoryPatchBase {
  kind: 'timeline_event_create'
  event: Partial<TimelineEvent>
}

export interface LegacyRawMemoryPatch extends MemoryPatchBase {
  kind: 'legacy_raw'
  rawText: string
  parsedValue?: unknown
  parseError?: string
}

export type MemoryUpdatePatch =
  | ChapterReviewMemoryPatch
  | CharacterStateMemoryPatch
  | ForeshadowingCreateMemoryPatch
  | ForeshadowingStatusMemoryPatch
  | StageSummaryMemoryPatch
  | TimelineEventMemoryPatch
  | LegacyRawMemoryPatch

export interface MemoryUpdateCandidate {
  id: ID
  projectId: ID
  jobId: ID
  type: MemoryUpdateCandidateType
  targetId: ID | null
  proposedPatch: MemoryUpdatePatch
  evidence: string
  confidence: number
  status: MemoryUpdateCandidateStatus
  createdAt: string
  updatedAt: string
}

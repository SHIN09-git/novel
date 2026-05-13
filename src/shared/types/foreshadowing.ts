import type { ID } from './base'
import type { MemoryPatchBase } from './memory'

export type ForeshadowingStatus = 'unresolved' | 'partial' | 'resolved' | 'abandoned'

export type ForeshadowingWeight = 'low' | 'medium' | 'high' | 'payoff'

export type ForeshadowingTreatmentMode = 'hidden' | 'hint' | 'advance' | 'mislead' | 'pause' | 'payoff'

export interface Foreshadowing {
  id: ID
  projectId: ID
  title: string
  firstChapterOrder: number | null
  description: string
  status: ForeshadowingStatus
  weight: ForeshadowingWeight
  treatmentMode: ForeshadowingTreatmentMode
  expectedPayoff: string
  payoffMethod: string
  relatedCharacterIds: ID[]
  relatedMainPlot: string
  notes: string
  actualPayoffChapter: number | null
  createdAt: string
  updatedAt: string
}

export interface ForeshadowingCandidate {
  title: string
  description: string
  firstChapterOrder: number | null
  suggestedWeight: ForeshadowingWeight
  recommendedTreatmentMode?: ForeshadowingTreatmentMode
  expectedPayoff: string
  relatedCharacterIds: ID[]
  notes: string
}

export interface ForeshadowingStatusChangeSuggestion {
  foreshadowingId: ID
  suggestedStatus: ForeshadowingStatus
  recommendedTreatmentMode?: ForeshadowingTreatmentMode
  evidenceText: string
  notes: string
  confidence: number
}

export interface ForeshadowingCreateMemoryPatch extends MemoryPatchBase {
  kind: 'foreshadowing_create'
  candidate: ForeshadowingCandidate
}

export interface ForeshadowingStatusMemoryPatch extends MemoryPatchBase {
  kind: 'foreshadowing_status_update'
  foreshadowingId: ID
  suggestedStatus: ForeshadowingStatus
  recommendedTreatmentMode?: ForeshadowingTreatmentMode
  actualPayoffChapter?: number | null
  evidenceText: string
  notes: string
}

export interface ForeshadowingExtractionResult {
  newForeshadowingCandidates: ForeshadowingCandidate[]
  advancedForeshadowingIds: ID[]
  resolvedForeshadowingIds: ID[]
  abandonedForeshadowingCandidates: ForeshadowingCandidate[]
  statusChanges: ForeshadowingStatusChangeSuggestion[]
}

export interface NextChapterSuggestions {
  nextChapterGoal: string
  conflictToPush: string
  suspenseToKeep: string
  foreshadowingToHint: string
  foreshadowingNotToReveal: string
  suggestedEndingHook: string
  readerEmotionTarget: string
}

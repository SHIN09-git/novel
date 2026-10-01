import type { ID, StageSummary, TimelineEvent } from './base'
import type { CharacterCardField, CharacterStateFactValue, StateFactCategory } from './character'
import type { ForeshadowingCandidate, ForeshadowingStatus, ForeshadowingTreatmentMode } from './foreshadowing'
import type { ChapterContinuityBridgeSuggestion, ChapterReviewMemoryPatch, MemoryUpdatePatch } from './memory'

export type CandidateDecisionKind = 'memory' | 'character_state'
export type CandidateStageSummaryAuthorFields = Pick<StageSummary,
  'compressedPlotSummary' | 'irreversibleChanges' | 'endingCarryoverState' |
  'emotionalAftertaste' | 'pacingState'>
export type CandidateStageSummaryLegacyFields = Pick<StageSummary,
  'coveredChapterRange' | 'plotProgress' | 'characterRelations' | 'secrets' |
  'foreshadowingPlanted' | 'foreshadowingResolved' | 'unresolvedQuestions' | 'nextStageDirection'>
export type CandidateMemoryPatchAmendment =
  | {
      kind: 'chapter_review_update'
      summary?: string
      review?: Partial<ChapterReviewMemoryPatch['review']>
      continuityBridgeSuggestion?: ChapterContinuityBridgeSuggestion | null
    }
  | {
      kind: 'character_state_update'
      summary?: string
      changeSummary?: string
      newCurrentEmotionalState?: string
      newRelationshipWithProtagonist?: string
      newNextActionTendency?: string
    }
  | {
      kind: 'foreshadowing_create'
      summary?: string
      candidate?: Partial<Pick<ForeshadowingCandidate,
        'title' | 'description' | 'suggestedWeight' | 'recommendedTreatmentMode' |
        'expectedPayoff' | 'relatedCharacterIds' | 'notes'>>
    }
  | {
      kind: 'foreshadowing_status_update'
      summary?: string
      suggestedStatus?: ForeshadowingStatus
      recommendedTreatmentMode?: ForeshadowingTreatmentMode
      evidenceText?: string
      notes?: string
    }
  | {
      kind: 'stage_summary_create'
      summary?: string
      stageSummary?: Partial<CandidateStageSummaryAuthorFields & CandidateStageSummaryLegacyFields>
    }
  | {
      kind: 'timeline_event_create'
      summary?: string
      event?: Partial<Pick<TimelineEvent,
        'title' | 'storyTime' | 'participantCharacterIds' | 'result' | 'downstreamImpact'>>
    }
export type CandidateDecisionAmendment =
  | { kind: 'memory'; patch: CandidateMemoryPatchAmendment }
  | {
      kind: 'character_state'
      label?: string
      category?: StateFactCategory
      targetValue?: CharacterStateFactValue | null
      linkedCardFields?: CharacterCardField[]
    }
export interface CandidateDecisionSelection {
  kind: CandidateDecisionKind
  candidateId: ID
  decision: 'accept' | 'reject'
  amendment?: CandidateDecisionAmendment
}
export interface CandidateDecisionItem extends CandidateDecisionSelection {
  expectedFingerprint: string
}
export interface CandidateDecisionActor {
  kind: 'user' | 'agent'
  agentRunId?: ID
}
export interface CandidateDecisionCommand {
  id: ID
  projectId: ID
  actor: CandidateDecisionActor
  reason: string
  decidedAt: string
  schemaVersion: 1
  decisions: CandidateDecisionItem[]
  confirmedHighRisk?: boolean
  /** Populated by the trusted runtime, never a client approval flag. */
  authorizationGrantId?: ID
  /** A compensating decision; decisions must be empty for this operation. */
  undo?: CandidateDecisionUndoRequest
}
export interface CandidateDecisionUndoRequest {
  receiptId: ID
  expectedFingerprint: string
  restoreChangedFields?: boolean
}
export interface CandidateDecisionFieldValue {
  exists: boolean
  value?: unknown
}
export interface CandidateDecisionFieldChange {
  path: string[]
  before: CandidateDecisionFieldValue
  after: CandidateDecisionFieldValue
}
export interface CandidateDecisionEffect {
  collection: string
  id: ID
  title: string
  created: boolean
  ownership?: { characterId?: ID; chapterId?: ID; jobId?: ID }
  fields: CandidateDecisionFieldChange[]
}
export interface CandidateDecisionRemovedRecords {
  collection: string
  ids: ID[]
}
export interface CandidateDecisionUndoPreview {
  projectId: ID
  receiptId: ID
  status: 'ready' | 'conflict' | 'already_undone' | 'unavailable'
  expectedFingerprint: string
  items: Array<{
    collection: string
    id: ID
    title: string
    action: 'restore_fields' | 'remove_created' | 'retain_history' | 'deactivate_created'
    fields: Array<CandidateDecisionFieldChange & { current: CandidateDecisionFieldValue; conflicted: boolean }>
  }>
  warnings: string[]
  requiresConfirmation: boolean
  canRestoreConflicts: boolean
  undoReceiptId?: ID
}
export interface CandidateDecisionPreviewItem extends CandidateDecisionItem {
  title: string
  summary: string
  evidence: string
  risk: 'low' | 'medium' | 'high'
  warnings: string[]
  amendmentPreview?: {
    before: CandidateDecisionAmendmentSnapshot
    after: CandidateDecisionAmendmentSnapshot
  }
}
export interface CandidateDecisionPreview {
  projectId: ID
  items: CandidateDecisionPreviewItem[]
  requiresConfirmation: boolean
}
export type CandidateDecisionAmendmentSnapshot =
  | { kind: 'memory'; patch: MemoryUpdatePatch }
  | {
      kind: 'character_state'
      label: string | null
      category: StateFactCategory | null
      targetValue: CharacterStateFactValue | null
      linkedCardFields: CharacterCardField[]
    }
export interface CandidateDecisionAmendmentAudit {
  kind: CandidateDecisionKind
  candidateId: ID
  amendment: CandidateDecisionAmendment
  before: CandidateDecisionAmendmentSnapshot
  after: CandidateDecisionAmendmentSnapshot
}
export interface CandidateDecisionReceipt {
  id: ID
  projectId: ID
  actor: CandidateDecisionActor
  reason: string
  decidedAt: string
  updatedAt: string
  schemaVersion: 1
  commandFingerprint: string
  authorizationGrantId?: ID
  decisions: CandidateDecisionItem[]
  amendments?: CandidateDecisionAmendmentAudit[]
  changedRecords: Array<{ collection: string; ids: ID[] }>
  /** Absent on legacy receipts; their prior values cannot be reconstructed. */
  effects?: CandidateDecisionEffect[]
  requiresConfirmation?: boolean
  operation?: 'undo'
  undoesReceiptId?: ID
}

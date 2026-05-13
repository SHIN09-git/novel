import type { ID } from './base'
import type { MemoryPatchBase } from './memory'

export type CharacterRoleInChapter = 'protagonist' | 'antagonist' | 'ally' | 'witness' | 'support' | 'offscreen' | 'mentioned'

export type ExpectedPresence = 'onstage' | 'offscreen' | 'referenced'

export type CharacterCardField =
  | 'roleFunction'
  | 'surfaceGoal'
  | 'deepNeed'
  | 'coreFear'
  | 'decisionLogic'
  | 'abilitiesAndResources'
  | 'weaknessAndCost'
  | 'relationshipTension'
  | 'futureHooks'

export type StateFactCategory =
  | 'resource'
  | 'inventory'
  | 'location'
  | 'physical'
  | 'mental'
  | 'knowledge'
  | 'relationship'
  | 'goal'
  | 'promise'
  | 'secret'
  | 'ability'
  | 'status'
  | 'custom'

export type CharacterStateValueType = 'string' | 'number' | 'boolean' | 'list' | 'text'

export type CharacterStateTrackingLevel = 'hard' | 'soft' | 'note'

export type CharacterStatePromptPolicy = 'always' | 'when_relevant' | 'manual_only'

export type CharacterStateFactStatus = 'active' | 'resolved' | 'inactive' | 'retconned'

export type CharacterStateTransactionType =
  | 'create'
  | 'update'
  | 'increment'
  | 'decrement'
  | 'add_item'
  | 'remove_item'
  | 'move'
  | 'learn'
  | 'resolve'
  | 'invalidate'

export type CharacterStateTransactionSource = 'manual' | 'chapter_review' | 'pipeline' | 'revision'

export type CharacterStateTransactionStatus = 'pending' | 'accepted' | 'rejected'

export type CharacterStateChangeCandidateType = 'create_fact' | 'update_fact' | 'transaction' | 'resolve_fact' | 'conflict'

export type CharacterStateRiskLevel = 'low' | 'medium' | 'high'

export type ContinuityCheckCategory = 'location' | 'injury' | 'money' | 'inventory' | 'knowledge' | 'relationship' | 'promise' | 'ability' | 'timeline'

export interface Character {
  id: ID
  projectId: ID
  name: string
  role: string
  surfaceGoal: string
  deepDesire: string
  coreFear: string
  selfDeception: string
  knownInformation: string
  unknownInformation: string
  protagonistRelationship: string
  emotionalState: string
  nextActionTendency: string
  forbiddenWriting: string
  lastChangedChapter: number | null
  isMain: boolean
  createdAt: string
  updatedAt: string
}

export interface CharacterStateLog {
  id: ID
  projectId: ID
  characterId: ID
  chapterId: ID | null
  chapterOrder: number | null
  note: string
  linkedFactId?: ID | null
  linkedCandidateId?: ID | null
  convertedAt?: string | null
  createdAt: string
}

export type CharacterStateFactValue = string | number | boolean | string[]

export interface CharacterStateFact {
  id: ID
  projectId: ID
  characterId: ID
  category: StateFactCategory
  key: string
  label: string
  valueType: CharacterStateValueType
  value: CharacterStateFactValue
  unit: string
  linkedCardFields: CharacterCardField[]
  trackingLevel: CharacterStateTrackingLevel
  promptPolicy: CharacterStatePromptPolicy
  status: CharacterStateFactStatus
  sourceChapterId: ID | null
  sourceChapterOrder: number | null
  evidence: string
  confidence: number
  createdAt: string
  updatedAt: string
}

export interface CharacterStateTransaction {
  id: ID
  projectId: ID
  characterId: ID
  factId: ID
  chapterId: ID | null
  chapterOrder: number | null
  transactionType: CharacterStateTransactionType
  beforeValue: CharacterStateFactValue | null
  afterValue: CharacterStateFactValue | null
  delta: number | null
  reason: string
  evidence: string
  source: CharacterStateTransactionSource
  status: CharacterStateTransactionStatus
  createdAt: string
  updatedAt: string
}

export interface CharacterStateChangeSuggestion {
  characterId: ID
  category: StateFactCategory
  key: string
  label: string
  changeType: CharacterStateChangeCandidateType
  beforeValue: CharacterStateFactValue | null
  afterValue: CharacterStateFactValue | null
  delta: number | null
  evidence: string
  confidence: number
  riskLevel: CharacterStateRiskLevel
  suggestedTransactionType: CharacterStateTransactionType
  linkedCardFields: CharacterCardField[]
}

export interface CharacterStateChangeCandidate {
  id: ID
  projectId: ID
  jobId?: ID | null
  characterId: ID
  chapterId: ID | null
  chapterOrder: number | null
  candidateType: CharacterStateChangeCandidateType
  targetFactId: ID | null
  proposedFact: CharacterStateFact | null
  proposedTransaction: CharacterStateTransaction | null
  beforeValue: CharacterStateFactValue | null
  afterValue: CharacterStateFactValue | null
  evidence: string
  confidence: number
  riskLevel: CharacterStateRiskLevel
  status: CharacterStateTransactionStatus
  createdAt: string
  updatedAt: string
}

export interface ExpectedCharacterNeed {
  characterId: ID
  roleInChapter: CharacterRoleInChapter
  expectedPresence: ExpectedPresence
  reason: string
}

export interface CharacterStateSuggestion {
  characterId: ID
  changeSummary: string
  newCurrentEmotionalState: string
  newRelationshipWithProtagonist: string
  newNextActionTendency: string
  relatedChapterId: ID | null
  confidence: number
}

export interface CharacterStateMemoryPatch extends MemoryPatchBase {
  kind: 'character_state_update'
  characterId: ID
  relatedChapterId: ID | null
  relatedChapterOrder: number | null
  changeSummary: string
  newCurrentEmotionalState: string
  newRelationshipWithProtagonist: string
  newNextActionTendency: string
}

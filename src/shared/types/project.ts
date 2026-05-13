import type { ID } from './base'

export type HardCanonItemCategory =
  | 'world_rule'
  | 'system_rule'
  | 'character_identity'
  | 'character_hard_state'
  | 'timeline_anchor'
  | 'foreshadowing_rule'
  | 'relationship_fact'
  | 'prohibition'
  | 'style_boundary'
  | 'other'

export type HardCanonPriority = 'must' | 'high' | 'medium'

export type HardCanonStatus = 'active' | 'inactive' | 'deprecated'

export type HardCanonSourceType =
  | 'manual'
  | 'story_bible'
  | 'character'
  | 'foreshadowing'
  | 'timeline'
  | 'stage_summary'
  | 'run_trace'
  | 'imported'

export interface Project {
  id: ID
  name: string
  genre: string
  description: string
  targetReaders: string
  coreAppeal: string
  style: string
  createdAt: string
  updatedAt: string
}

export interface StoryBible {
  projectId: ID
  worldbuilding: string
  corePremise: string
  protagonistDesire: string
  protagonistFear: string
  mainConflict: string
  powerSystem: string
  bannedTropes: string
  styleSample: string
  narrativeTone: string
  immutableFacts: string
  updatedAt: string
}

export interface HardCanonItem {
  id: ID
  projectId: ID
  category: HardCanonItemCategory
  title: string
  content: string
  priority: HardCanonPriority
  status: HardCanonStatus
  sourceType?: HardCanonSourceType
  sourceId?: ID | null
  relatedCharacterIds?: ID[]
  relatedForeshadowingIds?: ID[]
  relatedTimelineEventIds?: ID[]
  createdAt: string
  updatedAt: string
}

export interface HardCanonPack {
  id: ID
  projectId: ID
  title: string
  description?: string
  items: HardCanonItem[]
  maxPromptTokens?: number
  updatedAt: string
  createdAt: string
  schemaVersion: number
}

export interface HardCanonPromptBlockResult {
  body: string
  includedItemIds: ID[]
  truncatedItemIds: ID[]
  tokenEstimate: number
  itemCount: number
  warnings: string[]
}

export interface Chapter {
  id: ID
  projectId: ID
  order: number
  title: string
  body: string
  summary: string
  newInformation: string
  characterChanges: string
  newForeshadowing: string
  resolvedForeshadowing: string
  endingHook: string
  riskWarnings: string
  includedInStageSummary: boolean
  createdAt: string
  updatedAt: string
}

export interface ChapterTask {
  goal: string
  conflict: string
  suspenseToKeep: string
  allowedPayoffs: string
  forbiddenPayoffs: string
  endingHook: string
  readerEmotion: string
  targetWordCount: string
  styleRequirement: string
}

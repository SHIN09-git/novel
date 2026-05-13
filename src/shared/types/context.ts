import type { ContextBudgetMode, ID, PromptMode } from './base'
import type { CharacterCardField, ContinuityCheckCategory, ExpectedCharacterNeed, StateFactCategory } from './character'
import type { ForeshadowingTreatmentMode, ForeshadowingWeight } from './foreshadowing'
import type { ChapterTask } from './project'
import type { StoryDirectionGuide } from './storyDirection'

export type PromptContextSnapshotSource = 'manual' | 'auto' | 'pipeline'

export type ContextNeedPlanSource = 'prompt_builder' | 'generation_pipeline' | 'manual' | 'auto'

export type ExpectedSceneType =
  | 'action'
  | 'dialogue'
  | 'investigation'
  | 'transition'
  | 'relationship'
  | 'reveal'
  | 'setup'
  | 'payoff'
  | 'recovery'
  | 'custom'

export type ContextRetrievalPriorityType =
  | 'character_card'
  | 'character_state'
  | 'foreshadowing'
  | 'timeline'
  | 'story_bible'
  | 'stage_summary'
  | 'chapter_ending'
  | 'hard_canon'
  | 'story_direction'
  | 'recent_chapter'

export type ContextNeedPriority = 'must' | 'high' | 'medium' | 'low'

export type ContextNeedSourceHint =
  | 'character'
  | 'character_state'
  | 'foreshadowing'
  | 'timeline'
  | 'stageSummary'
  | 'hardCanon'
  | 'storyDirection'
  | 'chapterEnding'
  | 'recentChapter'
  | 'worldbuilding'
  | 'unknown'

export interface PromptModuleSelection {
  bible: boolean
  progress: boolean
  recentChapters: boolean
  characters: boolean
  foreshadowing: boolean
  stageSummaries: boolean
  timeline: boolean
  chapterTask: boolean
  forbidden: boolean
  outputFormat: boolean
}

export interface PromptConfig {
  projectId: ID
  targetChapterOrder: number
  mode: PromptMode
  modules: PromptModuleSelection
  task: ChapterTask
  selectedCharacterIds: ID[]
  selectedForeshadowingIds: ID[]
  foreshadowingTreatmentOverrides?: Record<ID, ForeshadowingTreatmentMode>
  continuityInstructions?: string
  useContinuityBridge?: boolean
}

export interface RetrievalPriority {
  type: ContextRetrievalPriorityType
  id: ID
  priority: number
  reason: string
}

export interface ContextExclusionRule {
  type: string
  id: ID
  reason: string
}

export interface ContextNeedItem {
  id: ID
  needType: string
  sourceHint: ContextNeedSourceHint
  sourceId?: ID | null
  priority: ContextNeedPriority
  reason: string
  uncertain: boolean
}

export interface ContextNeedPlan {
  id: ID
  projectId: ID
  targetChapterOrder: number
  source: ContextNeedPlanSource
  chapterIntent: string
  expectedSceneType: ExpectedSceneType
  expectedCharacters: ExpectedCharacterNeed[]
  requiredCharacterCardFields: Record<ID, CharacterCardField[]>
  requiredStateFactCategories: Record<ID, StateFactCategory[]>
  requiredForeshadowingIds: ID[]
  forbiddenForeshadowingIds: ID[]
  requiredTimelineEventIds: ID[]
  requiredWorldbuildingKeys: string[]
  mustCheckContinuity: ContinuityCheckCategory[]
  retrievalPriorities: RetrievalPriority[]
  exclusionRules: ContextExclusionRule[]
  contextNeeds: ContextNeedItem[]
  warnings: string[]
  createdAt: string
  updatedAt: string
}

export interface PlanContextGapAnalysisResult {
  baseContextNeedPlanId: ID | null
  derivedContextNeedPlan: ContextNeedPlan
  newlyRequiredCharacterIds: ID[]
  newlyRequiredForeshadowingIds: ID[]
  newlyRequiredTimelineEventIds: ID[]
  newlyRequiredStateFactCategories: Record<ID, StateFactCategory[]>
  warnings: string[]
  reason: string
}

export interface PromptContextSnapshot {
  id: ID
  projectId: ID
  targetChapterOrder: number
  mode: ContextBudgetMode
  budgetProfileId: ID | null
  budgetProfile: ContextBudgetProfile
  contextSelectionResult: ContextSelectionResult
  selectedCharacterIds: ID[]
  selectedForeshadowingIds: ID[]
  foreshadowingTreatmentOverrides: Record<ID, ForeshadowingTreatmentMode>
  chapterTask: ChapterTask
  contextNeedPlan: ContextNeedPlan | null
  storyDirectionGuide: StoryDirectionGuide | null
  finalPrompt: string
  estimatedTokens: number
  source: PromptContextSnapshotSource
  note: string
  createdAt: string
  updatedAt: string
}

export interface ContextBudgetProfile {
  id: ID
  projectId: ID
  name: string
  maxTokens: number
  mode: ContextBudgetMode
  includeRecentChaptersCount: number
  includeStageSummariesCount: number
  includeMainCharacters: boolean
  includeRelatedCharacters: boolean
  includeForeshadowingWeights: ForeshadowingWeight[]
  includeTimelineEventsCount: number
  styleSampleMaxChars: number
  createdAt: string
  updatedAt: string
}

export interface OmittedContextItem {
  type: string
  id: ID | null
  reason: string
  estimatedTokensSaved: number
}

export type ContextCompressionKind =
  | 'chapter_recap_to_stage_summary'
  | 'chapter_recap_to_one_line_summary'
  | 'chapter_recap_to_summary_excerpt'
  | 'chapter_recap_dropped'

export type ContextCompressionReplacementKind =
  | 'stage_summary'
  | 'chapter_one_line_summary'
  | 'summary_excerpt'
  | 'dropped'

export interface ContextCompressionRecord {
  id: ID
  kind: ContextCompressionKind
  originalContextKind: 'chapter_recap'
  originalChapterId: ID
  originalChapterOrder: number
  originalTitle?: string
  originalTokenEstimate: number
  replacementKind: ContextCompressionReplacementKind
  replacementSourceId?: ID | null
  replacementText?: string
  replacementTokenEstimate: number
  savedTokenEstimate: number
  reason: string
}

export interface ContextSelectionResult {
  selectedStoryBibleFields: string[]
  selectedChapterIds: ID[]
  selectedStageSummaryIds: ID[]
  selectedCharacterIds: ID[]
  selectedForeshadowingIds: ID[]
  selectedTimelineEventIds: ID[]
  estimatedTokens: number
  omittedItems: OmittedContextItem[]
  compressionRecords: ContextCompressionRecord[]
  contextSelectionTrace: ContextSelectionTrace | null
  warnings: string[]
}

export interface ContextSelectionTraceBlock {
  blockType: string
  sourceId?: ID | null
  priority: ContextNeedPriority
  tokenEstimate: number
  reason: string
}

export interface ContextSelectionTraceDroppedBlock {
  blockType: string
  sourceId?: ID | null
  priority: ContextNeedPriority
  tokenEstimate: number
  dropReason: string
}

export interface ContextSelectionTraceUnmetNeed {
  needType: string
  priority: ContextNeedPriority
  reason: string
  sourceId?: ID | null
}

export interface ContextSelectionTrace {
  projectId: ID
  chapterId: ID | null
  jobId?: ID
  selectedBlocks: ContextSelectionTraceBlock[]
  droppedBlocks: ContextSelectionTraceDroppedBlock[]
  unmetNeeds: ContextSelectionTraceUnmetNeed[]
  budgetSummary: {
    totalBudget: number
    usedTokens: number
    reservedTokens: number
    pressure: 'low' | 'medium' | 'high'
  }
}

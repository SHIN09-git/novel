import type {
  Chapter,
  ChapterTask,
  CharacterCardField,
  Character,
  ContextBudgetProfile,
  ContextNeedItem,
  ContextNeedPriority,
  ContextNeedPlan,
  ContextSelectionResult,
  ContextSelectionTrace,
  ContextSelectionTraceBlock,
  ContextSelectionTraceDroppedBlock,
  ContextSelectionTraceUnmetNeed,
  Foreshadowing,
  ForeshadowingTreatmentMode,
  ForeshadowingWeight,
  ID,
  Project,
  StageSummary,
  StoryBible,
  TimelineEvent
} from '../../shared/types'

export interface ProjectContextData {
  project: Project
  bible: StoryBible | null
  chapters: Chapter[]
  characters: Character[]
  foreshadowings: Foreshadowing[]
  timelineEvents: TimelineEvent[]
  stageSummaries: StageSummary[]
}

export interface ForcedContextSelection {
  characterIds?: ID[]
  foreshadowingIds?: ID[]
  chapterTask?: Partial<ChapterTask> | null
  foreshadowingTreatmentOverrides?: Record<ID, ForeshadowingTreatmentMode>
  contextNeedPlan?: ContextNeedPlan | null
}

export interface ScoringContext {
  targetChapterOrder: number
  task?: Partial<ChapterTask> | null
  forcedCharacterIds: Set<ID>
  forcedForeshadowingIds: Set<ID>
  foreshadowingTreatmentOverrides?: Record<ID, ForeshadowingTreatmentMode>
  relatedCharacterIds: Set<ID>
  contextNeedPlan?: ContextNeedPlan | null
  planCharacterIds: Set<ID>
  planRequiredForeshadowingIds: Set<ID>
  planForbiddenForeshadowingIds: Set<ID>
}

export interface ContextEvaluationCandidate {
  type: 'chapter' | 'stageSummary' | 'character' | 'foreshadowing' | 'timelineEvent'
  id: ID
  text: string
  tokenEstimate?: number
  metadata?: Record<string, unknown>
}

export interface ContextEvaluationOptions {
  targetChapterOrder: number
  task?: Partial<ChapterTask> | null
  forced?: boolean
  treatmentMode?: ForeshadowingTreatmentMode
  weight?: ForeshadowingWeight
  isMainCharacter?: boolean
  isRelatedCharacter?: boolean
  chapterOrder?: number | null
  expectedPayoff?: string
}

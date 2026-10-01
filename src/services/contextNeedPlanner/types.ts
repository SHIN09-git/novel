import type {
  Chapter,
  ChapterContinuityBridge,
  ChapterTask,
  Character,
  CharacterStateFact,
  ContextNeedPlanSource,
  Foreshadowing,
  HardCanonItem,
  Project,
  StageSummary,
  StoryBible,
  StoryDirectionGuide,
  TimelineEvent
} from '../../shared/types'

export interface BuildNeedPlanInput {
  project: Project
  storyBible: StoryBible | null
  targetChapterOrder: number
  chapterTaskDraft: Partial<ChapterTask>
  previousChapter: Chapter | null
  continuityBridge: ChapterContinuityBridge | null
  characters: Character[]
  characterStateFacts: CharacterStateFact[]
  foreshadowing: Foreshadowing[]
  timelineEvents: TimelineEvent[]
  stageSummaries: StageSummary[]
  hardCanonItems?: HardCanonItem[]
  storyDirectionGuide?: StoryDirectionGuide | null
  storyDirectionPromptText?: string
  isolateOpeningLegacyContext?: boolean
  source?: ContextNeedPlanSource
}

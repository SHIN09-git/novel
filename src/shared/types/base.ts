export type ID = string

export type PromptMode = 'light' | 'standard' | 'full'

export type ContextBudgetMode = PromptMode | 'custom'

export type ApiProvider = 'openai' | 'compatible' | 'local'

export type ContinuitySource = 'saved_bridge' | 'auto_from_previous_ending' | 'manual'

export interface TimelineEvent {
  id: ID
  projectId: ID
  title: string
  chapterOrder: number | null
  storyTime: string
  narrativeOrder: number
  participantCharacterIds: ID[]
  result: string
  downstreamImpact: string
  createdAt: string
  updatedAt: string
}

export interface StageSummary {
  id: ID
  projectId: ID
  chapterStart: number
  chapterEnd: number
  coveredChapterRange?: string
  compressedPlotSummary?: string
  irreversibleChanges?: string
  endingCarryoverState?: string
  emotionalAftertaste?: string
  pacingState?: string
  plotProgress: string
  characterRelations: string
  secrets: string
  foreshadowingPlanted: string
  foreshadowingResolved: string
  unresolvedQuestions: string
  nextStageDirection: string
  createdAt: string
  updatedAt: string
}

export interface AIResult<T> {
  ok: boolean
  usedAI: boolean
  data: T | null
  error?: string
  rawText?: string
  parseError?: string
  finishReason?: string
}

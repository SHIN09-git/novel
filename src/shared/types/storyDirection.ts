import type { ID } from './base'

export type StoryDirectionGuideStatus = 'draft' | 'active' | 'archived'

export type StoryDirectionGuideSource = 'user_polished' | 'ai_generated' | 'mixed'

export type StoryDirectionHorizon = 5 | 10

export interface StoryDirectionChapterBeat {
  id: ID
  chapterOffset: number
  chapterOrder: number | null
  goal: string
  conflict: string
  characterFocus: string
  foreshadowingToUse: string
  foreshadowingNotToReveal: string
  suspenseToKeep: string
  endingHook: string
  readerEmotion: string
  mustAvoid: string
  notes: string
}

export interface StoryDirectionGuide {
  id: ID
  projectId: ID
  title: string
  status: StoryDirectionGuideStatus
  source: StoryDirectionGuideSource
  horizonChapters: StoryDirectionHorizon
  startChapterOrder: number
  endChapterOrder: number
  userRawIdea: string
  userPolishedIdea: string
  aiGuidance: string
  strategicTheme: string
  coreDramaticPromise: string
  emotionalCurve: string
  characterArcDirectives: string
  foreshadowingDirectives: string
  constraints: string
  forbiddenTurns: string
  chapterBeats: StoryDirectionChapterBeat[]
  generatedFromStageSummaryIds: ID[]
  generatedFromChapterIds: ID[]
  warnings: string[]
  createdAt: string
  updatedAt: string
}

export interface StoryDirectionPolishResult {
  polishedIdea: string
  preservedUserIntent: string
  assumptions: string[]
  constraints: string[]
  warnings: string[]
}

export interface StoryDirectionGenerationResult {
  title: string
  aiGuidance: string
  strategicTheme: string
  coreDramaticPromise: string
  emotionalCurve: string
  characterArcDirectives: string
  foreshadowingDirectives: string
  constraints: string
  forbiddenTurns: string
  chapterBeats: Omit<StoryDirectionChapterBeat, 'id'>[]
  warnings: string[]
}

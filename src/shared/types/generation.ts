import type { ID } from './base'

export type PipelineMode = 'conservative' | 'standard' | 'aggressive'

export type PipelineContextSource = 'auto' | 'prompt_snapshot'

export type ChapterGenerationJobStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed'

export type ChapterGenerationStepType =
  | 'context_need_planning'
  | 'context_budget_selection'
  | 'build_context'
  | 'generate_chapter_plan'
  | 'context_need_planning_from_plan'
  | 'context_budget_selection_delta'
  | 'rebuild_context_with_plan'
  | 'generate_chapter_draft'
  | 'generate_chapter_review'
  | 'propose_character_updates'
  | 'propose_foreshadowing_updates'
  | 'consistency_review'
  | 'quality_gate'
  | 'await_user_confirmation'

export type ChapterGenerationStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export type GeneratedChapterDraftStatus = 'draft' | 'accepted' | 'rejected'

export interface ChapterAllowedNovelty {
  allowedNewCharacters: string[]
  allowedNewRules: string[]
  allowedNewSystemMechanics: string[]
  allowedNewOrganizationsOrRanks: string[]
  allowedLoreReveals: string[]
  notes: string
}

export interface ChapterForbiddenNovelty {
  forbiddenNewCharacters: string[]
  forbiddenNewRules: string[]
  forbiddenSystemMechanics: string[]
  forbiddenOrganizationsOrRanks: string[]
  forbiddenLoreReveals: string[]
  notes: string
}

export interface ChapterPlan {
  chapterTitle: string
  chapterGoal: string
  conflictToPush: string
  characterBeats: string
  foreshadowingToUse: string
  foreshadowingNotToReveal: string
  endingHook: string
  readerEmotionTarget: string
  estimatedWordCount: string
  openingContinuationBeat: string
  carriedPhysicalState: string
  carriedEmotionalState: string
  unresolvedMicroTensions: string
  forbiddenResets: string
  allowedNovelty: string | ChapterAllowedNovelty
  forbiddenNovelty: string | ChapterForbiddenNovelty
}

export interface ChapterDraftResult {
  title: string
  body: string
}

export interface ChapterGenerationJob {
  id: ID
  projectId: ID
  targetChapterOrder: number
  promptContextSnapshotId?: ID | null
  contextSource: PipelineContextSource
  status: ChapterGenerationJobStatus
  currentStep: ChapterGenerationStepType | null
  createdAt: string
  updatedAt: string
  errorMessage: string
}

export interface ChapterGenerationStep {
  id: ID
  jobId: ID
  type: ChapterGenerationStepType
  status: ChapterGenerationStepStatus
  inputSnapshot: string
  output: string
  errorMessage: string
  createdAt: string
  updatedAt: string
}

export interface GeneratedChapterDraft {
  id: ID
  projectId: ID
  chapterId: ID | null
  jobId: ID
  title: string
  body: string
  summary: string
  status: GeneratedChapterDraftStatus
  tokenEstimate: number
  createdAt: string
  updatedAt: string
}

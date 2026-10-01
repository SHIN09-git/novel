import type { ApiProvider, ID } from './base'
import type { ChapterTask } from './project'

export type PipelineMode = 'conservative' | 'standard' | 'aggressive'

export type PipelineRecipeId = 'fast' | 'standard' | 'strict' | 'custom'

export type PipelineRecipeVersion = 1

// Disabled steps may still run when their escalation condition is met.
export type PipelineStepEscalation = 'never' | 'on_warning' | 'on_failure'

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

export interface PipelineRecipeStep {
  type: ChapterGenerationStepType
  // Enabled steps run in the recipe's normal path.
  enabled: boolean
  // Required steps cannot be manually skipped once selected to run.
  required: boolean
  escalation: PipelineStepEscalation
}

export interface PipelineRecipe {
  id: PipelineRecipeId
  version: PipelineRecipeVersion
  name: string
  description: string
  steps: PipelineRecipeStep[]
}

export type ChapterGenerationStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export type GeneratedChapterDraftStatus = 'draft' | 'accepted' | 'rejected'

export type PipelineAIRole = 'planner' | 'prose' | 'extraction' | 'reviewer' | 'revision'

/** Credential-free request configuration shared by the default and role snapshots. */
export interface PipelineAIModelConfig {
  apiProvider: ApiProvider
  baseUrl: string
  modelName: string
  codexCliPath: string
  codexCliModel: string
  temperature: number
  maxTokens: number
  retryEnabled: boolean
  maxRetries: number
  requestTimeoutMs: number
}

/** Missing fields inherit the current settings when a run is created, never on retry. */
export type PipelineAIRoleConfigs = Partial<Record<PipelineAIRole, Partial<PipelineAIModelConfig>>>

export interface PipelineAIRunConfig extends PipelineAIModelConfig {
  // Optional for jobs persisted before role snapshots were introduced.
  roles?: Readonly<Record<PipelineAIRole, Readonly<PipelineAIModelConfig>>>
  schemaVersion?: 1
}

export interface ResolvedPipelineAIRunConfig extends PipelineAIRunConfig {
  roles: Readonly<Record<PipelineAIRole, Readonly<PipelineAIModelConfig>>>
  schemaVersion: 1
}

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

export interface QualityGateReviewScope {
  targetChapterOrder?: number
  hasAuthoritativeChapterTask?: boolean
}

export interface ChapterDraftResult {
  title: string
  body: string
}

export interface ChapterGenerationJob {
  id: ID
  projectId: ID
  targetChapterOrder: number
  chapterTaskSnapshot?: ChapterTask | null
  taskEdit?: ChapterTaskEdit | null
  promptContextSnapshotId?: ID | null
  contextSource: PipelineContextSource
  aiRunConfig?: PipelineAIRunConfig | null
  pipelineMode?: PipelineMode | null
  pipelineRecipeId?: PipelineRecipeId | null
  pipelineRecipeVersion?: PipelineRecipeVersion | null
  pipelineRecipe?: PipelineRecipe | null
  status: ChapterGenerationJobStatus
  currentStep: ChapterGenerationStepType | null
  createdAt: string
  updatedAt: string
  errorMessage: string
}

export interface ChapterTaskEdit {
  sourceJobId: ID | null
  sourcePromptContextSnapshotId?: ID | null
  changedFields: (keyof ChapterTask)[]
  scope: 'expression' | 'budget' | 'context'
  resumeStep: ChapterGenerationStepType
  reusableArtifacts: string[]
  warnings: string[]
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

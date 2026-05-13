import type {
  AppData,
  ChapterDraftResult,
  ChapterGenerationJob,
  ChapterGenerationStep,
  ChapterPlan,
  CharacterStateFact,
  ContextBudgetMode,
  ContextBudgetProfile,
  ContextNeedPlan,
  ContextSelectionResult,
  GeneratedChapterDraft,
  GenerationRunTrace,
  ID,
  NoveltyAuditResult,
  PipelineMode,
  PlanContextGapAnalysisResult,
  Project,
  PromptContextSnapshot,
  StoryDirectionGuide
} from '../../../../shared/types'
import type { AIService } from '../../../../services/AIService'

export interface PipelineRunOptions {
  targetChapterOrder: number
  pipelineMode: PipelineMode
  estimatedWordCount: string
  readerEmotionTarget: string
  budgetMode: ContextBudgetMode
  budgetMaxTokens: number
}

export type PersistPipelineWorking = (next: AppData, jobId?: ID, statusMessage?: string) => Promise<AppData>

export type UpdateStepInData = (
  working: AppData,
  stepId: ID,
  patch: Partial<ChapterGenerationStep>,
  jobPatch?: Partial<ChapterGenerationJob>
) => AppData

export interface RunPipelineFromStepEngineEnv {
  data: AppData
  project: Project
  scoped: {
    bible: AppData['storyBibles'][number] | null
    chapters: AppData['chapters']
    characters: AppData['characters']
    characterStateLogs: AppData['characterStateLogs']
    characterStateFacts: AppData['characterStateFacts']
    foreshadowings: AppData['foreshadowings']
    timelineEvents: AppData['timelineEvents']
    stageSummaries: AppData['stageSummaries']
  }
  targetChapterOrder: number
  pipelineMode: PipelineMode
  estimatedWordCount: string
  readerEmotionTarget: string
  budgetMode: ContextBudgetMode
  budgetMaxTokens: number
  aiService: AIService
  persistWorking: PersistPipelineWorking
  updateStepInData: UpdateStepInData
}

export interface PipelineRunnerState {
  working: AppData
  context: string
  plan: ChapterPlan | null
  draftResult: ChapterDraftResult | null
  noveltyAuditResult: NoveltyAuditResult | null
  planGapAnalysis: PlanContextGapAnalysisResult | null
  contextNeedPlanFromPlan: ContextNeedPlan | null
  rebuiltContextFromPlan: boolean
  draftRecord: GeneratedChapterDraft | null
  contextNeedPlan: ContextNeedPlan | null
  budgetProfile: ContextBudgetProfile
  budgetSelection: ContextSelectionResult | null
}

export interface PipelineStepHandlerContext {
  job: ChapterGenerationJob
  step: ChapterGenerationStep
  options: PipelineRunOptions
  env: RunPipelineFromStepEngineEnv
  snapshot: PromptContextSnapshot | null
  activeStoryDirectionGuide: StoryDirectionGuide | null
  storyDirectionTracePatch: Partial<GenerationRunTrace>
  state: PipelineRunnerState
}

export function projectCharacterStateFacts(state: PipelineRunnerState, projectId: ID): CharacterStateFact[] {
  return state.working.characterStateFacts.filter((fact) => fact.projectId === projectId)
}

import type { ApiProvider, ContinuitySource, ID, PromptMode, StageSummary, TimelineEvent } from './base'
import type { Character, CharacterStateChangeCandidate, CharacterStateFact, CharacterStateLog, CharacterStateTransaction } from './character'
import type { ContextBudgetProfile, ContextCompressionRecord, ContextNeedPlan, ContextSelectionResult, PromptConfig, PromptContextSnapshot, PromptLintResult, PromptModuleSelection } from './context'
import type { Foreshadowing, ForeshadowingTreatmentMode } from './foreshadowing'
import type { ChapterGenerationJob, ChapterGenerationStep, GeneratedChapterDraft, PipelineAIRoleConfigs } from './generation'
import type { ChapterContinuityBridge, MemoryUpdateCandidate } from './memory'
import type { Chapter, ChapterTask, HardCanonPack, HardCanonPromptBlockResult, Project, StoryBible } from './project'
import type { ConsistencyReviewReport, EditorialVerdict, QualityGateReport, RedundancyReport } from './quality'
import type { ChapterVersion, RevisionCandidate, RevisionCommitBundle, RevisionRequest, RevisionSession, RevisionVersion } from './revision'
import type { StoryDirectionGuide } from './storyDirection'
import type { ChapterCommitBundle, GenerationRunTrace, PromptBlockOrderItem, RunTraceAuthorSummary } from './trace'
import type { AgentActionPreview, AgentRun } from './agent'
import type { CandidateDecisionReceipt } from './candidateDecision'
import type { QuickRewriteDraft } from './quickRewrite'
import type { WorldManagementReceipt } from './worldManagement'

export interface PromptVersion {
  id: ID
  projectId: ID
  targetChapterOrder: number
  title: string
  mode: PromptMode
  content: string
  tokenEstimate: number
  moduleSelection: PromptModuleSelection
  task: ChapterTask
  createdAt: string
}

export interface BuildPromptResult {
  finalPrompt: string
  estimatedTokens: number
  promptBlockOrder: PromptBlockOrderItem[]
  contextSelectionResult: ContextSelectionResult | null
  selectedCharacterIds: ID[]
  selectedForeshadowingIds: ID[]
  foreshadowingTreatmentOverrides: Record<ID, ForeshadowingTreatmentMode>
  chapterTask: ChapterTask
  contextNeedPlan: ContextNeedPlan | null
  storyDirectionGuide: StoryDirectionGuide | null
  hardCanonPrompt: HardCanonPromptBlockResult | null
  continuityBridge: ChapterContinuityBridge | null
  continuitySource: ContinuitySource | null
  compressionRecords: ContextCompressionRecord[]
  promptLintResult: PromptLintResult
  warnings: string[]
}

export interface AppSettings {
  apiProvider: ApiProvider
  apiKey: string
  hasApiKey: boolean
  baseUrl: string
  modelName: string
  codexCliPath: string
  codexCliModel: string
  temperature: number
  maxTokens: number
  retryEnabled: boolean
  maxRetries: number
  requestTimeoutMs: number
  pipelineModelRoles?: PipelineAIRoleConfigs
  enableAutoSummary: boolean
  enableChapterDiagnostics: boolean
  defaultTokenBudget: number
  defaultPromptMode: PromptMode
  theme: 'system' | 'light' | 'dark'
}

export interface AppData {
  schemaVersion: number
  projects: Project[]
  storyBibles: StoryBible[]
  chapters: Chapter[]
  characters: Character[]
  characterStateLogs: CharacterStateLog[]
  characterStateFacts: CharacterStateFact[]
  characterStateTransactions: CharacterStateTransaction[]
  characterStateChangeCandidates: CharacterStateChangeCandidate[]
  foreshadowings: Foreshadowing[]
  timelineEvents: TimelineEvent[]
  stageSummaries: StageSummary[]
  promptVersions: PromptVersion[]
  promptContextSnapshots: PromptContextSnapshot[]
  storyDirectionGuides: StoryDirectionGuide[]
  hardCanonPacks: HardCanonPack[]
  contextNeedPlans: ContextNeedPlan[]
  chapterContinuityBridges: ChapterContinuityBridge[]
  chapterGenerationJobs: ChapterGenerationJob[]
  chapterGenerationSteps: ChapterGenerationStep[]
  generatedChapterDrafts: GeneratedChapterDraft[]
  memoryUpdateCandidates: MemoryUpdateCandidate[]
  candidateDecisionReceipts: CandidateDecisionReceipt[]
  worldManagementReceipts: WorldManagementReceipt[]
  consistencyReviewReports: ConsistencyReviewReport[]
  contextBudgetProfiles: ContextBudgetProfile[]
  qualityGateReports: QualityGateReport[]
  generationRunTraces: GenerationRunTrace[]
  runTraceAuthorSummaries: RunTraceAuthorSummary[]
  redundancyReports: RedundancyReport[]
  /** Deterministic editorial decisions bound to an exact generated draft revision. */
  editorialVerdicts: EditorialVerdict[]
  revisionCandidates: RevisionCandidate[]
  revisionSessions: RevisionSession[]
  revisionRequests: RevisionRequest[]
  revisionVersions: RevisionVersion[]
  quickRewriteDrafts: QuickRewriteDraft[]
  chapterVersions: ChapterVersion[]
  chapterCommitBundles: ChapterCommitBundle[]
  revisionCommitBundles: RevisionCommitBundle[]
  agentRuns: AgentRun[]
  agentActionPreviews: AgentActionPreview[]
  settings: AppSettings
}

export interface PromptBuildInput {
  project: Project
  bible: StoryBible | null
  chapters: Chapter[]
  characters: Character[]
  characterStateLogs: CharacterStateLog[]
  characterStateFacts: CharacterStateFact[]
  foreshadowings: Foreshadowing[]
  timelineEvents: TimelineEvent[]
  stageSummaries: StageSummary[]
  chapterContinuityBridges?: ChapterContinuityBridge[]
  budgetProfile?: ContextBudgetProfile
  explicitContextSelection?: ContextSelectionResult
  contextNeedPlan?: ContextNeedPlan | null
  storyDirectionGuide?: StoryDirectionGuide | null
  hardCanonPack?: HardCanonPack | null
  config: PromptConfig
}

export type ID = string

export type PromptMode = 'light' | 'standard' | 'full'
export type ContextBudgetMode = PromptMode | 'custom'
export type ApiProvider = 'openai' | 'compatible' | 'local'
export type ForeshadowingStatus = 'unresolved' | 'partial' | 'resolved' | 'abandoned'
export type ForeshadowingWeight = 'low' | 'medium' | 'high' | 'payoff'
export type PipelineMode = 'conservative' | 'standard' | 'aggressive'
export type ChapterGenerationJobStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed'
export type ChapterGenerationStepType =
  | 'context_budget_selection'
  | 'build_context'
  | 'generate_chapter_plan'
  | 'generate_chapter_draft'
  | 'generate_chapter_review'
  | 'propose_character_updates'
  | 'propose_foreshadowing_updates'
  | 'consistency_review'
  | 'quality_gate'
  | 'await_user_confirmation'
export type ChapterGenerationStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
export type GeneratedChapterDraftStatus = 'draft' | 'accepted' | 'rejected'
export type MemoryUpdateCandidateType = 'character' | 'foreshadowing' | 'chapter_review' | 'stage_summary' | 'timeline_event'
export type MemoryUpdateCandidateStatus = 'pending' | 'accepted' | 'rejected'
export type ConsistencySeverity = 'low' | 'medium' | 'high'
export type RevisionCandidateStatus = 'pending' | 'accepted' | 'rejected'

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

export interface Character {
  id: ID
  projectId: ID
  name: string
  role: string
  surfaceGoal: string
  deepDesire: string
  coreFear: string
  selfDeception: string
  knownInformation: string
  unknownInformation: string
  protagonistRelationship: string
  emotionalState: string
  nextActionTendency: string
  forbiddenWriting: string
  lastChangedChapter: number | null
  isMain: boolean
  createdAt: string
  updatedAt: string
}

export interface CharacterStateLog {
  id: ID
  projectId: ID
  characterId: ID
  chapterId: ID | null
  chapterOrder: number | null
  note: string
  createdAt: string
}

export interface Foreshadowing {
  id: ID
  projectId: ID
  title: string
  firstChapterOrder: number | null
  description: string
  status: ForeshadowingStatus
  weight: ForeshadowingWeight
  expectedPayoff: string
  payoffMethod: string
  relatedCharacterIds: ID[]
  relatedMainPlot: string
  notes: string
  actualPayoffChapter: number | null
  createdAt: string
  updatedAt: string
}

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

export interface PromptConfig {
  projectId: ID
  targetChapterOrder: number
  mode: PromptMode
  modules: PromptModuleSelection
  task: ChapterTask
  selectedCharacterIds: ID[]
  selectedForeshadowingIds: ID[]
}

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

export interface AppSettings {
  apiProvider: ApiProvider
  apiKey: string
  baseUrl: string
  modelName: string
  temperature: number
  maxTokens: number
  enableAutoSummary: boolean
  enableChapterDiagnostics: boolean
  defaultTokenBudget: number
  defaultPromptMode: PromptMode
  theme: 'system' | 'light' | 'dark'
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

export interface ContextSelectionResult {
  selectedStoryBibleFields: string[]
  selectedChapterIds: ID[]
  selectedStageSummaryIds: ID[]
  selectedCharacterIds: ID[]
  selectedForeshadowingIds: ID[]
  selectedTimelineEventIds: ID[]
  estimatedTokens: number
  omittedItems: OmittedContextItem[]
  warnings: string[]
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

export interface ChapterReviewDraft {
  summary: string
  newInformation: string
  characterChanges: string
  newForeshadowing: string
  resolvedForeshadowing: string
  endingHook: string
  riskWarnings: string
}

export interface CharacterStateSuggestion {
  characterId: ID
  changeSummary: string
  newCurrentEmotionalState: string
  newRelationshipWithProtagonist: string
  newNextActionTendency: string
  relatedChapterId: ID | null
  confidence: number
}

export interface ForeshadowingCandidate {
  title: string
  description: string
  firstChapterOrder: number | null
  suggestedWeight: ForeshadowingWeight
  expectedPayoff: string
  relatedCharacterIds: ID[]
  notes: string
}

export interface ForeshadowingStatusChangeSuggestion {
  foreshadowingId: ID
  suggestedStatus: ForeshadowingStatus
  evidenceText: string
  notes: string
  confidence: number
}

export interface ForeshadowingExtractionResult {
  newForeshadowingCandidates: ForeshadowingCandidate[]
  advancedForeshadowingIds: ID[]
  resolvedForeshadowingIds: ID[]
  abandonedForeshadowingCandidates: ForeshadowingCandidate[]
  statusChanges: ForeshadowingStatusChangeSuggestion[]
}

export interface NextChapterSuggestions {
  nextChapterGoal: string
  conflictToPush: string
  suspenseToKeep: string
  foreshadowingToHint: string
  foreshadowingNotToReveal: string
  suggestedEndingHook: string
  readerEmotionTarget: string
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
}

export interface ChapterDraftResult {
  title: string
  body: string
}

export interface ConsistencyReviewIssue {
  category: 'timeline' | 'setting' | 'character_ooc' | 'foreshadowing' | 'pacing' | 'reader_emotion'
  severity: ConsistencySeverity
  description: string
  evidence: string
  suggestion: string
}

export interface ConsistencyReviewData {
  timelineProblems: string[]
  settingConflicts: string[]
  characterOOC: string[]
  foreshadowingMisuse: string[]
  pacingProblems: string[]
  emotionPayoffProblems: string[]
  suggestions: string[]
  severitySummary: ConsistencySeverity
  issues: ConsistencyReviewIssue[]
}

export interface ChapterGenerationJob {
  id: ID
  projectId: ID
  targetChapterOrder: number
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

export interface MemoryUpdateCandidate {
  id: ID
  projectId: ID
  jobId: ID
  type: MemoryUpdateCandidateType
  targetId: ID | null
  proposedPatch: string
  evidence: string
  confidence: number
  status: MemoryUpdateCandidateStatus
  createdAt: string
  updatedAt: string
}

export interface ConsistencyReviewReport {
  id: ID
  projectId: ID
  jobId: ID
  chapterId: ID | null
  issues: string
  suggestions: string
  severitySummary: ConsistencySeverity
  createdAt: string
}

export interface QualityGateDimensionScores {
  plotCoherence: number
  characterConsistency: number
  foreshadowingControl: number
  styleMatch: number
  pacing: number
  emotionalPayoff: number
  originality: number
  promptCompliance: number
}

export interface QualityGateIssue {
  severity: ConsistencySeverity
  type: string
  description: string
  evidence: string
  suggestedFix: string
}

export interface QualityGateReport {
  id: ID
  projectId: ID
  jobId: ID
  chapterId: ID | null
  draftId: ID | null
  overallScore: number
  pass: boolean
  dimensions: QualityGateDimensionScores
  issues: QualityGateIssue[]
  requiredFixes: string[]
  optionalSuggestions: string[]
  createdAt: string
}

export interface RevisionCandidate {
  id: ID
  projectId: ID
  jobId: ID
  draftId: ID
  sourceReportId: ID
  targetIssue: string
  revisionInstruction: string
  revisedText: string
  status: RevisionCandidateStatus
  createdAt: string
  updatedAt: string
}

export interface AppData {
  schemaVersion: number
  projects: Project[]
  storyBibles: StoryBible[]
  chapters: Chapter[]
  characters: Character[]
  characterStateLogs: CharacterStateLog[]
  foreshadowings: Foreshadowing[]
  timelineEvents: TimelineEvent[]
  stageSummaries: StageSummary[]
  promptVersions: PromptVersion[]
  chapterGenerationJobs: ChapterGenerationJob[]
  chapterGenerationSteps: ChapterGenerationStep[]
  generatedChapterDrafts: GeneratedChapterDraft[]
  memoryUpdateCandidates: MemoryUpdateCandidate[]
  consistencyReviewReports: ConsistencyReviewReport[]
  contextBudgetProfiles: ContextBudgetProfile[]
  qualityGateReports: QualityGateReport[]
  revisionCandidates: RevisionCandidate[]
  settings: AppSettings
}

export interface PromptBuildInput {
  project: Project
  bible: StoryBible | null
  chapters: Chapter[]
  characters: Character[]
  characterStateLogs: CharacterStateLog[]
  foreshadowings: Foreshadowing[]
  timelineEvents: TimelineEvent[]
  stageSummaries: StageSummary[]
  budgetProfile?: ContextBudgetProfile
  config: PromptConfig
}

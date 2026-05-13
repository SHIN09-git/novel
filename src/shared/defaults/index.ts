import type {
  AppData,
  AppSettings,
  ChapterCommitBundle,
  ChapterTask,
  ChapterContinuityBridge,
  ChapterGenerationJob,
  CharacterCardField,
  CharacterStateChangeCandidate,
  CharacterStateChangeSuggestion,
  CharacterStateFact,
  CharacterStateLog,
  CharacterStateFactStatus,
  CharacterStatePromptPolicy,
  CharacterStateRiskLevel,
  CharacterStateTrackingLevel,
  CharacterStateTransaction,
  CharacterStateTransactionSource,
  CharacterStateTransactionStatus,
  CharacterStateTransactionType,
  CharacterStateValueType,
  CharacterStateFactValue,
  ContinuityCheckCategory,
  ContextBudgetProfile,
  ContextExclusionRule,
  ContextNeedItem,
  ContextNeedPlan,
  ContextNeedPriority,
  ContextNeedSourceHint,
  ContextSelectionTrace,
  ExpectedCharacterNeed,
  ExpectedPresence,
  ExpectedSceneType,
  ContextSelectionResult,
  ConsistencyIssueStatus,
  ConsistencyIssueType,
  ConsistencyReviewIssue,
  ConsistencyReviewReport,
  ConsistencySeverity,
  Foreshadowing,
  ForeshadowingCandidate,
  ForeshadowingStatus,
  ForeshadowingWeight,
  ForcedContextBlock,
  GenerationRunTrace,
  HardCanonItem,
  HardCanonItemCategory,
  HardCanonPack,
  HardCanonPriority,
  HardCanonStatus,
  MemoryUpdateCandidate,
  MemoryUpdateCandidateType,
  MemoryUpdatePatch,
  NoveltyAuditResult,
  NoveltyAuditSeverity,
  NoveltyFinding,
  NoveltyFindingKind,
  QualityGateReport,
  RedundancyReport,
  RevisionCommitBundle,
  RunTraceAuthorSummary,
  PromptMode,
  PromptModuleSelection,
  PromptContextSnapshot,
  PromptBlockOrderItem,
  Project,
  RetrievalPriority,
  StateFactCategory,
  StageSummary,
  StoryBible,
  StoryDirectionChapterBeat,
  StoryDirectionGuide,
  StoryDirectionGuideSource,
  StoryDirectionGuideStatus,
  StoryDirectionHorizon
} from '../types'

export const DEFAULT_SETTINGS: AppSettings = {
  apiProvider: 'openai',
  apiKey: '',
  hasApiKey: false,
  baseUrl: 'https://api.openai.com/v1',
  modelName: 'gpt-4.1',
  temperature: 0.8,
  maxTokens: 8000,
  retryEnabled: true,
  maxRetries: 3,
  enableAutoSummary: false,
  enableChapterDiagnostics: false,
  defaultTokenBudget: 16000,
  defaultPromptMode: 'standard',
  theme: 'system'
}

export const EMPTY_APP_DATA: AppData = {
  schemaVersion: 3,
  projects: [],
  storyBibles: [],
  chapters: [],
  characters: [],
  characterStateLogs: [],
  characterStateFacts: [],
  characterStateTransactions: [],
  characterStateChangeCandidates: [],
  foreshadowings: [],
  timelineEvents: [],
  stageSummaries: [],
  promptVersions: [],
  promptContextSnapshots: [],
  storyDirectionGuides: [],
  hardCanonPacks: [],
  contextNeedPlans: [],
  chapterContinuityBridges: [],
  chapterGenerationJobs: [],
  chapterGenerationSteps: [],
  generatedChapterDrafts: [],
  memoryUpdateCandidates: [],
  consistencyReviewReports: [],
  contextBudgetProfiles: [],
  qualityGateReports: [],
  generationRunTraces: [],
  runTraceAuthorSummaries: [],
  redundancyReports: [],
  revisionCandidates: [],
  revisionSessions: [],
  revisionRequests: [],
  revisionVersions: [],
  chapterVersions: [],
  chapterCommitBundles: [],
  revisionCommitBundles: [],
  settings: DEFAULT_SETTINGS
}

export function createEmptyBible(projectId: string): StoryBible {
  return {
    projectId,
    worldbuilding: '',
    corePremise: '',
    protagonistDesire: '',
    protagonistFear: '',
    mainConflict: '',
    powerSystem: '',
    bannedTropes: '',
    styleSample: '',
    narrativeTone: '',
    immutableFacts: '',
    updatedAt: new Date().toISOString()
  }
}

export function createEmptyHardCanonPack(projectId: string): HardCanonPack {
  const timestamp = new Date().toISOString()
  return {
    id: `hard-canon-pack-${projectId}`,
    projectId,
    title: '不可违背设定包',
    description: '这里放不能被 AI 改写的硬设定。不要放长篇剧情回顾。',
    items: [],
    maxPromptTokens: 900,
    createdAt: timestamp,
    updatedAt: timestamp,
    schemaVersion: 1
  }
}

export function defaultModulesForMode(mode: PromptMode): PromptModuleSelection {
  if (mode === 'light') {
    return {
      bible: true,
      progress: false,
      recentChapters: true,
      characters: false,
      foreshadowing: false,
      stageSummaries: false,
      timeline: false,
      chapterTask: true,
      forbidden: true,
      outputFormat: true
    }
  }

  if (mode === 'full') {
    return {
      bible: true,
      progress: true,
      recentChapters: true,
      characters: true,
      foreshadowing: true,
      stageSummaries: true,
      timeline: true,
      chapterTask: true,
      forbidden: true,
      outputFormat: true
    }
  }

  return {
    bible: true,
    progress: true,
    recentChapters: true,
    characters: true,
    foreshadowing: true,
    stageSummaries: true,
    timeline: false,
    chapterTask: true,
    forbidden: true,
    outputFormat: true
  }
}

export function createEmptyChapterTask(): ChapterTask {
  return {
    goal: '',
    conflict: '',
    suspenseToKeep: '',
    allowedPayoffs: '',
    forbiddenPayoffs: '',
    endingHook: '',
    readerEmotion: '',
    targetWordCount: '3000-5000',
    styleRequirement: ''
  }
}


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

import { objectOrEmpty, stringValue } from './common'

export function normalizeContinuityBridgeSuggestion(value: unknown) {
  const bridge = objectOrEmpty(value)
  return {
    lastSceneLocation: stringValue(bridge.lastSceneLocation),
    lastPhysicalState: stringValue(bridge.lastPhysicalState),
    lastEmotionalState: stringValue(bridge.lastEmotionalState),
    lastUnresolvedAction: stringValue(bridge.lastUnresolvedAction),
    lastDialogueOrThought: stringValue(bridge.lastDialogueOrThought),
    immediateNextBeat: stringValue(bridge.immediateNextBeat),
    mustContinueFrom: stringValue(bridge.mustContinueFrom),
    mustNotReset: stringValue(bridge.mustNotReset),
    openMicroTensions: stringValue(bridge.openMicroTensions)
  }
}

export function normalizeChapterContinuityBridge(value: ChapterContinuityBridge | Record<string, unknown>): ChapterContinuityBridge {
  const bridge = objectOrEmpty(value)
  const timestamp = new Date().toISOString()
  return {
    ...(value as ChapterContinuityBridge),
    ...normalizeContinuityBridgeSuggestion(bridge),
    id: stringValue(bridge.id) || `continuity-${timestamp}`,
    projectId: stringValue(bridge.projectId),
    fromChapterId: stringValue(bridge.fromChapterId),
    toChapterOrder: typeof bridge.toChapterOrder === 'number' ? bridge.toChapterOrder : 1,
    createdAt: stringValue(bridge.createdAt) || timestamp,
    updatedAt: stringValue(bridge.updatedAt) || timestamp
  }
}


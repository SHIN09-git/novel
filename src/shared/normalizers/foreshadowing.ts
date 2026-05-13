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

import { normalizeTreatmentMode } from '../foreshadowingTreatment'
import { objectOrEmpty, stringArrayValue, stringValue } from './common'

export function normalizeForeshadowing(value: Foreshadowing): Foreshadowing {
  return {
    ...value,
    treatmentMode: normalizeTreatmentMode(value.treatmentMode, value.status, value.weight)
  }
}

export function normalizeForeshadowingStatus(value: unknown): ForeshadowingStatus {
  return value === 'unresolved' || value === 'partial' || value === 'resolved' || value === 'abandoned' ? value : 'unresolved'
}

export function normalizeForeshadowingWeight(value: unknown): ForeshadowingWeight {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'payoff' ? value : 'medium'
}

export function normalizeForeshadowingCandidate(value: unknown): ForeshadowingCandidate {
  const candidate = objectOrEmpty(value)
  const suggestedWeight = normalizeForeshadowingWeight(candidate.suggestedWeight)
  return {
    title: stringValue(candidate.title) || '未命名伏笔',
    description: stringValue(candidate.description),
    firstChapterOrder: typeof candidate.firstChapterOrder === 'number' ? candidate.firstChapterOrder : null,
    suggestedWeight,
    recommendedTreatmentMode: normalizeTreatmentMode(candidate.recommendedTreatmentMode, 'unresolved', suggestedWeight),
    expectedPayoff: stringValue(candidate.expectedPayoff),
    relatedCharacterIds: stringArrayValue(candidate.relatedCharacterIds),
    notes: stringValue(candidate.notes)
  }
}


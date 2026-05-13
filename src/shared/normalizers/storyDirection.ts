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

import { arrayOrEmpty, objectOrEmpty, stringArrayValue, stringValue } from './common'

export function normalizeStoryDirectionStatus(value: unknown): StoryDirectionGuideStatus {
  return value === 'active' || value === 'archived' || value === 'draft' ? value : 'draft'
}

function normalizeStoryDirectionSource(value: unknown): StoryDirectionGuideSource {
  return value === 'user_polished' || value === 'mixed' || value === 'ai_generated' ? value : 'ai_generated'
}

function normalizeStoryDirectionHorizon(value: unknown): StoryDirectionHorizon {
  return value === 10 ? 10 : 5
}

export function normalizeStoryDirectionBeat(value: unknown, index = 0, startChapterOrder = 1): StoryDirectionChapterBeat {
  const beat = objectOrEmpty(value)
  const chapterOffset = typeof beat.chapterOffset === 'number' && Number.isFinite(beat.chapterOffset) ? Math.max(1, Math.round(beat.chapterOffset)) : index + 1
  return {
    id: stringValue(beat.id) || `story-beat-${Date.now()}-${index}`,
    chapterOffset,
    chapterOrder:
      typeof beat.chapterOrder === 'number' && Number.isFinite(beat.chapterOrder)
        ? Math.max(1, Math.round(beat.chapterOrder))
        : startChapterOrder + chapterOffset - 1,
    goal: stringValue(beat.goal),
    conflict: stringValue(beat.conflict),
    characterFocus: stringValue(beat.characterFocus),
    foreshadowingToUse: stringValue(beat.foreshadowingToUse),
    foreshadowingNotToReveal: stringValue(beat.foreshadowingNotToReveal),
    suspenseToKeep: stringValue(beat.suspenseToKeep),
    endingHook: stringValue(beat.endingHook),
    readerEmotion: stringValue(beat.readerEmotion),
    mustAvoid: stringValue(beat.mustAvoid),
    notes: stringValue(beat.notes)
  }
}

export function normalizeStoryDirectionGuide(value: StoryDirectionGuide | Record<string, unknown>): StoryDirectionGuide {
  const guide = objectOrEmpty(value)
  const timestamp = new Date().toISOString()
  const horizonChapters = normalizeStoryDirectionHorizon(guide.horizonChapters)
  const startChapterOrder =
    typeof guide.startChapterOrder === 'number' && Number.isFinite(guide.startChapterOrder)
      ? Math.max(1, Math.round(guide.startChapterOrder))
      : 1
  const endChapterOrder =
    typeof guide.endChapterOrder === 'number' && Number.isFinite(guide.endChapterOrder)
      ? Math.max(startChapterOrder, Math.round(guide.endChapterOrder))
      : startChapterOrder + horizonChapters - 1
  return {
    ...(value as StoryDirectionGuide),
    id: stringValue(guide.id) || `story-direction-${timestamp}`,
    projectId: stringValue(guide.projectId),
    title: stringValue(guide.title) || 'Story direction guide',
    status: normalizeStoryDirectionStatus(guide.status),
    source: normalizeStoryDirectionSource(guide.source),
    horizonChapters,
    startChapterOrder,
    endChapterOrder,
    userRawIdea: stringValue(guide.userRawIdea),
    userPolishedIdea: stringValue(guide.userPolishedIdea),
    aiGuidance: stringValue(guide.aiGuidance),
    strategicTheme: stringValue(guide.strategicTheme),
    coreDramaticPromise: stringValue(guide.coreDramaticPromise),
    emotionalCurve: stringValue(guide.emotionalCurve),
    characterArcDirectives: stringValue(guide.characterArcDirectives),
    foreshadowingDirectives: stringValue(guide.foreshadowingDirectives),
    constraints: stringValue(guide.constraints),
    forbiddenTurns: stringValue(guide.forbiddenTurns),
    chapterBeats: arrayOrEmpty(guide.chapterBeats).map((beat, index) => normalizeStoryDirectionBeat(beat, index, startChapterOrder)),
    generatedFromStageSummaryIds: stringArrayValue(guide.generatedFromStageSummaryIds),
    generatedFromChapterIds: stringArrayValue(guide.generatedFromChapterIds),
    warnings: stringArrayValue(guide.warnings),
    createdAt: stringValue(guide.createdAt) || timestamp,
    updatedAt: stringValue(guide.updatedAt) || timestamp
  }
}


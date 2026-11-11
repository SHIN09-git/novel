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
  StoryDirectionGuideStatus
} from '../types'

import { DEFAULT_STORY_DIRECTION_CHAPTERS, inspectStoryDirectionRange, isChapterOrder, storyDirectionLengthConflict } from '../storyDirectionRange'
import { arrayOrEmpty, objectOrEmpty, stringArrayValue, stringValue } from './common'

export function normalizeStoryDirectionStatus(value: unknown): StoryDirectionGuideStatus {
  return value === 'active' || value === 'archived' || value === 'draft' ? value : 'draft'
}

function normalizeStoryDirectionSource(value: unknown): StoryDirectionGuideSource {
  return value === 'user_polished' || value === 'mixed' || value === 'ai_generated' ? value : 'ai_generated'
}

export function normalizeStoryDirectionBeat(value: unknown, index = 0, startChapterOrder = 1, guideId = 'story'): StoryDirectionChapterBeat {
  const beat = objectOrEmpty(value)
  const chapterOffset = typeof beat.chapterOffset === 'number' ? beat.chapterOffset :
    isChapterOrder(beat.chapterOrder) ? beat.chapterOrder - startChapterOrder + 1 : index + 1
  return {
    id: stringValue(beat.id) || `${guideId}-beat-${index + 1}`,
    chapterOffset,
    chapterOrder:
      typeof beat.chapterOrder === 'number' ? beat.chapterOrder : startChapterOrder + (chapterOffset - 1),
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
  const id = stringValue(guide.id) || `story-direction-${timestamp}`
  const startChapterOrder = isChapterOrder(guide.startChapterOrder) ? guide.startChapterOrder : 1
  const recordedEnd = isChapterOrder(guide.endChapterOrder) && guide.endChapterOrder >= startChapterOrder ? guide.endChapterOrder : null
  const legacyLength = isChapterOrder(guide.horizonChapters) ? guide.horizonChapters : DEFAULT_STORY_DIRECTION_CHAPTERS
  const endChapterOrder = recordedEnd ?? startChapterOrder + (legacyLength - 1)
  const horizonChapters = recordedEnd === null ? legacyLength : endChapterOrder - startChapterOrder + 1
  const warnings = stringArrayValue(guide.warnings)
  const warn = (message: string | null | undefined) => { if (message && !warnings.includes(message)) warnings.push(message) }
  if (recordedEnd !== null && isChapterOrder(guide.startChapterOrder)) {
    warn(storyDirectionLengthConflict({ startChapterOrder, endChapterOrder, horizonChapters }, guide.horizonChapters))
  } else if (recordedEnd === null && guide.horizonChapters != null && !isChapterOrder(guide.horizonChapters)) {
    warn(`旧导向没有有效结束章节或正整数长度，按旧版默认 ${DEFAULT_STORY_DIRECTION_CHAPTERS} 章显示。`)
  }
  // Preserve oversized historical ranges on read; new writes and generation reject them.
  warn(inspectStoryDirectionRange(startChapterOrder, endChapterOrder).error)
  return {
    ...(value as StoryDirectionGuide),
    id,
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
    chapterBeats: arrayOrEmpty(guide.chapterBeats).map((beat, index) => normalizeStoryDirectionBeat(beat, index, startChapterOrder, id)),
    generatedFromStageSummaryIds: stringArrayValue(guide.generatedFromStageSummaryIds),
    generatedFromChapterIds: stringArrayValue(guide.generatedFromChapterIds),
    warnings,
    createdAt: stringValue(guide.createdAt) || timestamp,
    updatedAt: stringValue(guide.updatedAt) || timestamp
  }
}


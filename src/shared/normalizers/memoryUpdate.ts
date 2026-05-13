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

import { objectOrEmpty, stringArrayValue, stringValue } from './common'
import { normalizeContinuityBridgeSuggestion } from './continuity'
import { normalizeForeshadowingCandidate, normalizeForeshadowingStatus } from './foreshadowing'
import { normalizeTreatmentMode } from '../foreshadowingTreatment'

function normalizeChapterReviewMemoryPatch(value: unknown): MemoryUpdatePatch {
  const patch = objectOrEmpty(value)
  const review = objectOrEmpty(patch.review || patch)
  const continuityBridgeSuggestion = patch.continuityBridgeSuggestion
    ? normalizeContinuityBridgeSuggestion(patch.continuityBridgeSuggestion)
    : null
  return {
    schemaVersion: 1,
    kind: 'chapter_review_update',
    summary: stringValue(patch.summary) || stringValue(review.summary) || '章节复盘更新',
    sourceChapterOrder:
      typeof patch.sourceChapterOrder === 'number'
        ? patch.sourceChapterOrder
        : typeof patch.targetChapterOrder === 'number'
          ? patch.targetChapterOrder
          : null,
    warnings: stringArrayValue(patch.warnings),
    targetChapterId: stringValue(patch.targetChapterId) || null,
    targetChapterOrder: typeof patch.targetChapterOrder === 'number' ? patch.targetChapterOrder : null,
    review: {
      summary: stringValue(review.summary),
      newInformation: stringValue(review.newInformation),
      characterChanges: stringValue(review.characterChanges),
      newForeshadowing: stringValue(review.newForeshadowing),
      resolvedForeshadowing: stringValue(review.resolvedForeshadowing),
      endingHook: stringValue(review.endingHook),
      riskWarnings: stringValue(review.riskWarnings)
    },
    continuityBridgeSuggestion
  }
}

function normalizeCharacterStateMemoryPatch(value: unknown): MemoryUpdatePatch {
  const patch = objectOrEmpty(value)
  return {
    schemaVersion: 1,
    kind: 'character_state_update',
    summary: stringValue(patch.summary) || stringValue(patch.changeSummary) || '角色状态更新',
    sourceChapterOrder:
      typeof patch.sourceChapterOrder === 'number'
        ? patch.sourceChapterOrder
        : typeof patch.relatedChapterOrder === 'number'
          ? patch.relatedChapterOrder
          : null,
    warnings: stringArrayValue(patch.warnings),
    characterId: stringValue(patch.characterId),
    relatedChapterId: stringValue(patch.relatedChapterId) || null,
    relatedChapterOrder: typeof patch.relatedChapterOrder === 'number' ? patch.relatedChapterOrder : null,
    changeSummary: stringValue(patch.changeSummary),
    newCurrentEmotionalState: stringValue(patch.newCurrentEmotionalState),
    newRelationshipWithProtagonist: stringValue(patch.newRelationshipWithProtagonist),
    newNextActionTendency: stringValue(patch.newNextActionTendency)
  }
}

function normalizeForeshadowingCreateMemoryPatch(value: unknown): MemoryUpdatePatch {
  const patch = objectOrEmpty(value)
  const candidate = normalizeForeshadowingCandidate(patch.candidate || value)
  return {
    schemaVersion: 1,
    kind: 'foreshadowing_create',
    summary: stringValue(patch.summary) || candidate.title || '新增伏笔',
    sourceChapterOrder:
      typeof patch.sourceChapterOrder === 'number'
        ? patch.sourceChapterOrder
        : typeof candidate.firstChapterOrder === 'number'
          ? candidate.firstChapterOrder
          : null,
    warnings: stringArrayValue(patch.warnings),
    candidate
  }
}

function normalizeForeshadowingStatusMemoryPatch(value: unknown): MemoryUpdatePatch {
  const patch = objectOrEmpty(value)
  const change = objectOrEmpty(patch.change || value)
  const suggestedStatus = normalizeForeshadowingStatus(change.suggestedStatus)
  return {
    schemaVersion: 1,
    kind: 'foreshadowing_status_update',
    summary: stringValue(patch.summary) || stringValue(change.evidenceText) || '伏笔状态更新',
    sourceChapterOrder: typeof patch.sourceChapterOrder === 'number' ? patch.sourceChapterOrder : null,
    warnings: stringArrayValue(patch.warnings),
    foreshadowingId: stringValue(change.foreshadowingId),
    suggestedStatus,
    recommendedTreatmentMode: change.recommendedTreatmentMode
      ? normalizeTreatmentMode(change.recommendedTreatmentMode, suggestedStatus, 'medium')
      : undefined,
    actualPayoffChapter:
      typeof change.actualPayoffChapter === 'number'
        ? change.actualPayoffChapter
        : typeof patch.actualPayoffChapter === 'number'
          ? patch.actualPayoffChapter
          : null,
    evidenceText: stringValue(change.evidenceText),
    notes: stringValue(change.notes)
  }
}

function legacyRawPatch(rawText: string, parsedValue?: unknown, parseError?: string): MemoryUpdatePatch {
  return {
    schemaVersion: 1,
    kind: 'legacy_raw',
    summary: '旧版原始记忆候选',
    sourceChapterOrder: null,
    warnings: parseError ? ['旧数据解析失败，已保留原文。'] : ['旧数据无法自动识别，已保留原文。'],
    rawText,
    parsedValue,
    parseError
  }
}

export function parseLegacyMemoryUpdatePatch(value: string, candidateType: MemoryUpdateCandidateType): MemoryUpdatePatch {
  try {
    const parsed = JSON.parse(value)
    return normalizeMemoryUpdatePatch(parsed, candidateType, value)
  } catch (error) {
    return legacyRawPatch(value, undefined, error instanceof Error ? error.message : String(error))
  }
}

export function normalizeMemoryUpdatePatch(
  value: unknown,
  candidateType: MemoryUpdateCandidateType = 'chapter_review',
  rawText = typeof value === 'string' ? value : JSON.stringify(value ?? '')
): MemoryUpdatePatch {
  if (typeof value === 'string') return parseLegacyMemoryUpdatePatch(value, candidateType)

  const patch = objectOrEmpty(value)
  if (!Object.keys(patch).length) return legacyRawPatch(rawText)

  if (patch.kind === 'chapter_review_update') return normalizeChapterReviewMemoryPatch(patch)
  if (patch.kind === 'character_state_update') return normalizeCharacterStateMemoryPatch(patch)
  if (patch.kind === 'foreshadowing_create') return normalizeForeshadowingCreateMemoryPatch(patch)
  if (patch.kind === 'foreshadowing_status_update') return normalizeForeshadowingStatusMemoryPatch(patch)
  if (patch.kind === 'stage_summary_create') {
    return {
      schemaVersion: 1,
      kind: 'stage_summary_create',
      summary: stringValue(patch.summary) || '阶段摘要候选',
      sourceChapterOrder: typeof patch.sourceChapterOrder === 'number' ? patch.sourceChapterOrder : null,
      warnings: stringArrayValue(patch.warnings),
      stageSummary: objectOrEmpty(patch.stageSummary)
    }
  }
  if (patch.kind === 'timeline_event_create') {
    return {
      schemaVersion: 1,
      kind: 'timeline_event_create',
      summary: stringValue(patch.summary) || '时间线事件候选',
      sourceChapterOrder: typeof patch.sourceChapterOrder === 'number' ? patch.sourceChapterOrder : null,
      warnings: stringArrayValue(patch.warnings),
      event: objectOrEmpty(patch.event)
    }
  }
  if (patch.kind === 'legacy_raw') {
    return legacyRawPatch(stringValue(patch.rawText) || rawText, patch.parsedValue, stringValue(patch.parseError) || undefined)
  }

  if (candidateType === 'chapter_review' && ('summary' in patch || 'newInformation' in patch || 'continuityBridgeSuggestion' in patch)) {
    return normalizeChapterReviewMemoryPatch(patch)
  }
  if (candidateType === 'character' && ('characterId' in patch || 'changeSummary' in patch)) {
    return normalizeCharacterStateMemoryPatch(patch)
  }
  if (candidateType === 'foreshadowing' && patch.kind === 'new') return normalizeForeshadowingCreateMemoryPatch(patch)
  if (candidateType === 'foreshadowing' && patch.kind === 'status') return normalizeForeshadowingStatusMemoryPatch(patch)

  return legacyRawPatch(rawText, value)
}

export function normalizeMemoryUpdateCandidate(value: MemoryUpdateCandidate | Record<string, unknown>): MemoryUpdateCandidate {
  const candidate = objectOrEmpty(value)
  const type: MemoryUpdateCandidateType =
    candidate.type === 'character' ||
    candidate.type === 'foreshadowing' ||
    candidate.type === 'chapter_review' ||
    candidate.type === 'stage_summary' ||
    candidate.type === 'timeline_event'
      ? candidate.type
      : 'chapter_review'
  return {
    ...(value as MemoryUpdateCandidate),
    id: stringValue(candidate.id),
    projectId: stringValue(candidate.projectId),
    jobId: stringValue(candidate.jobId),
    type,
    targetId: stringValue(candidate.targetId) || null,
    proposedPatch: normalizeMemoryUpdatePatch(candidate.proposedPatch, type),
    evidence: stringValue(candidate.evidence),
    confidence: typeof candidate.confidence === 'number' ? candidate.confidence : 0,
    status: candidate.status === 'accepted' || candidate.status === 'rejected' ? candidate.status : 'pending',
    createdAt: stringValue(candidate.createdAt) || new Date().toISOString(),
    updatedAt: stringValue(candidate.updatedAt) || stringValue(candidate.createdAt) || new Date().toISOString()
  }
}


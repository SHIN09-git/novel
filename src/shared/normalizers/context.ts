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

import { DEFAULT_SETTINGS } from '../defaults/index'
import { arrayOrEmpty, normalizeRecordArray, objectOrEmpty, stringArrayValue, stringValue } from './common'

const CHARACTER_CARD_FIELDS: CharacterCardField[] = [
  'roleFunction',
  'surfaceGoal',
  'deepNeed',
  'coreFear',
  'decisionLogic',
  'abilitiesAndResources',
  'weaknessAndCost',
  'relationshipTension',
  'futureHooks'
]

const STATE_FACT_CATEGORIES: StateFactCategory[] = [
  'resource',
  'inventory',
  'location',
  'physical',
  'mental',
  'knowledge',
  'relationship',
  'goal',
  'promise',
  'secret',
  'ability',
  'status',
  'custom'
]

const EXPECTED_SCENE_TYPES: ExpectedSceneType[] = [
  'action',
  'dialogue',
  'investigation',
  'transition',
  'relationship',
  'reveal',
  'setup',
  'payoff',
  'recovery',
  'custom'
]

const EXPECTED_PRESENCES: ExpectedPresence[] = ['onstage', 'offscreen', 'referenced']

const CONTINUITY_CHECK_CATEGORIES: ContinuityCheckCategory[] = [
  'location',
  'injury',
  'money',
  'inventory',
  'knowledge',
  'relationship',
  'promise',
  'ability',
  'timeline'
]

export function normalizeContextSelectionTrace(value: unknown): ContextSelectionTrace | null {
  if (!value || typeof value !== 'object') return null
  const trace = objectOrEmpty(value)
  const normalizeBlock = (entry: unknown, fallbackReason: string) => {
    const block = objectOrEmpty(entry)
    return {
      blockType: stringValue(block.blockType) || 'unknown',
      sourceId: stringValue(block.sourceId) || null,
      priority: normalizeContextNeedPriority(block.priority),
      tokenEstimate: typeof block.tokenEstimate === 'number' && Number.isFinite(block.tokenEstimate) ? Math.max(0, block.tokenEstimate) : 0,
      reason: stringValue(block.reason) || fallbackReason
    }
  }
  const normalizeDropped = (entry: unknown) => {
    const block = objectOrEmpty(entry)
    return {
      blockType: stringValue(block.blockType) || 'unknown',
      sourceId: stringValue(block.sourceId) || null,
      priority: normalizeContextNeedPriority(block.priority),
      tokenEstimate: typeof block.tokenEstimate === 'number' && Number.isFinite(block.tokenEstimate) ? Math.max(0, block.tokenEstimate) : 0,
      dropReason: stringValue(block.dropReason) || stringValue(block.reason) || '预算不足或相关性较低。'
    }
  }
  const normalizeUnmet = (entry: unknown) => {
    const item = objectOrEmpty(entry)
    return {
      needType: stringValue(item.needType) || 'unknown',
      priority: normalizeContextNeedPriority(item.priority),
      reason: stringValue(item.reason) || '上下文需求未被最终选择满足。',
      sourceId: stringValue(item.sourceId) || null
    }
  }
  const summary = objectOrEmpty(trace.budgetSummary)
  const pressure = summary.pressure === 'low' || summary.pressure === 'medium' || summary.pressure === 'high' ? summary.pressure : 'low'
  return {
    projectId: stringValue(trace.projectId),
    chapterId: stringValue(trace.chapterId) || null,
    jobId: stringValue(trace.jobId) || undefined,
    selectedBlocks: arrayOrEmpty(trace.selectedBlocks).map((entry) => normalizeBlock(entry, '已进入最终上下文。')),
    droppedBlocks: arrayOrEmpty(trace.droppedBlocks).map(normalizeDropped),
    unmetNeeds: arrayOrEmpty(trace.unmetNeeds).map(normalizeUnmet),
    budgetSummary: {
      totalBudget: typeof summary.totalBudget === 'number' ? Math.max(0, summary.totalBudget) : 0,
      usedTokens: typeof summary.usedTokens === 'number' ? Math.max(0, summary.usedTokens) : 0,
      reservedTokens: typeof summary.reservedTokens === 'number' ? Math.max(0, summary.reservedTokens) : 0,
      pressure
    }
  }
}

export function normalizeContextSelectionResult(value: unknown): ContextSelectionResult {
  const selection = objectOrEmpty(value)
  return {
    selectedStoryBibleFields: stringArrayValue(selection.selectedStoryBibleFields),
    selectedChapterIds: stringArrayValue(selection.selectedChapterIds),
    selectedStageSummaryIds: stringArrayValue(selection.selectedStageSummaryIds),
    selectedCharacterIds: stringArrayValue(selection.selectedCharacterIds),
    selectedForeshadowingIds: stringArrayValue(selection.selectedForeshadowingIds),
    selectedTimelineEventIds: stringArrayValue(selection.selectedTimelineEventIds),
    estimatedTokens: typeof selection.estimatedTokens === 'number' ? selection.estimatedTokens : 0,
    omittedItems: Array.isArray(selection.omittedItems) ? (selection.omittedItems as ContextSelectionResult['omittedItems']) : [],
    compressionRecords: normalizeContextCompressionRecords(selection.compressionRecords),
    contextSelectionTrace: normalizeContextSelectionTrace(selection.contextSelectionTrace),
    warnings: stringArrayValue(selection.warnings)
  }
}

export function normalizeRequiredCharacterCardFields(value: unknown): Record<string, CharacterCardField[]> {
  const record = objectOrEmpty(value)
  return Object.fromEntries(
    Object.entries(record).map(([id, fields]) => [id, normalizeRecordArray(fields, CHARACTER_CARD_FIELDS)])
  )
}

export function normalizeRequiredStateFactCategories(value: unknown): Record<string, StateFactCategory[]> {
  const record = objectOrEmpty(value)
  return Object.fromEntries(
    Object.entries(record).map(([id, categories]) => [id, normalizeRecordArray(categories, STATE_FACT_CATEGORIES)])
  )
}

function normalizeExpectedCharacterNeed(value: unknown): ExpectedCharacterNeed {
  const item = objectOrEmpty(value)
  const role = stringValue(item.roleInChapter)
  const presence = stringValue(item.expectedPresence)
  return {
    characterId: stringValue(item.characterId),
    roleInChapter:
      role === 'protagonist' ||
      role === 'antagonist' ||
      role === 'ally' ||
      role === 'witness' ||
      role === 'support' ||
      role === 'offscreen' ||
      role === 'mentioned'
        ? role
        : 'support',
    expectedPresence: EXPECTED_PRESENCES.includes(presence as ExpectedPresence) ? (presence as ExpectedPresence) : 'onstage',
    reason: stringValue(item.reason)
  }
}

function normalizeRetrievalPriority(value: unknown): RetrievalPriority {
  const item = objectOrEmpty(value)
  const type = stringValue(item.type)
  return {
    type:
      type === 'character_card' ||
      type === 'character_state' ||
      type === 'foreshadowing' ||
      type === 'timeline' ||
      type === 'story_bible' ||
      type === 'stage_summary' ||
      type === 'chapter_ending' ||
      type === 'hard_canon' ||
      type === 'story_direction' ||
      type === 'recent_chapter'
        ? type
        : 'story_bible',
    id: stringValue(item.id),
    priority: typeof item.priority === 'number' ? Math.max(0, Math.min(100, item.priority)) : 50,
    reason: stringValue(item.reason)
  }
}

export function normalizeContextNeedPriority(value: unknown): ContextNeedPriority {
  return value === 'must' || value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

function normalizeContextNeedSourceHint(value: unknown): ContextNeedSourceHint {
  const hint = stringValue(value)
  const allowed: ContextNeedSourceHint[] = [
    'character',
    'character_state',
    'foreshadowing',
    'timeline',
    'stageSummary',
    'hardCanon',
    'storyDirection',
    'chapterEnding',
    'recentChapter',
    'worldbuilding',
    'unknown'
  ]
  return allowed.includes(hint as ContextNeedSourceHint) ? (hint as ContextNeedSourceHint) : 'unknown'
}

function normalizeContextNeedItem(value: unknown, index = 0): ContextNeedItem {
  const item = objectOrEmpty(value)
  return {
    id: stringValue(item.id) || `context-need-${index}`,
    needType: stringValue(item.needType) || 'unknown',
    sourceHint: normalizeContextNeedSourceHint(item.sourceHint),
    sourceId: stringValue(item.sourceId) || null,
    priority: normalizeContextNeedPriority(item.priority),
    reason: stringValue(item.reason) || '旧数据缺少上下文需求原因。',
    uncertain: typeof item.uncertain === 'boolean' ? item.uncertain : false
  }
}

function normalizeContextExclusionRule(value: unknown): ContextExclusionRule {
  const item = objectOrEmpty(value)
  return {
    type: stringValue(item.type) || 'unknown',
    id: stringValue(item.id),
    reason: stringValue(item.reason)
  }
}

export function normalizeContextNeedPlan(value: ContextNeedPlan | Record<string, unknown>): ContextNeedPlan {
  const plan = objectOrEmpty(value)
  const timestamp = new Date().toISOString()
  const sceneType = stringValue(plan.expectedSceneType)
  const source = stringValue(plan.source)
  return {
    ...(value as ContextNeedPlan),
    id: stringValue(plan.id) || `context-need-plan-${timestamp}`,
    projectId: stringValue(plan.projectId),
    targetChapterOrder: typeof plan.targetChapterOrder === 'number' ? plan.targetChapterOrder : 1,
    source:
      source === 'prompt_builder' || source === 'generation_pipeline' || source === 'manual' || source === 'auto'
        ? source
        : 'auto',
    chapterIntent: stringValue(plan.chapterIntent),
    expectedSceneType: EXPECTED_SCENE_TYPES.includes(sceneType as ExpectedSceneType) ? (sceneType as ExpectedSceneType) : 'custom',
    expectedCharacters: arrayOrEmpty(plan.expectedCharacters).map(normalizeExpectedCharacterNeed).filter((item) => item.characterId),
    requiredCharacterCardFields: normalizeRequiredCharacterCardFields(plan.requiredCharacterCardFields),
    requiredStateFactCategories: normalizeRequiredStateFactCategories(plan.requiredStateFactCategories),
    requiredForeshadowingIds: stringArrayValue(plan.requiredForeshadowingIds),
    forbiddenForeshadowingIds: stringArrayValue(plan.forbiddenForeshadowingIds),
    requiredTimelineEventIds: stringArrayValue(plan.requiredTimelineEventIds),
    requiredWorldbuildingKeys: stringArrayValue(plan.requiredWorldbuildingKeys),
    mustCheckContinuity: normalizeRecordArray(plan.mustCheckContinuity, CONTINUITY_CHECK_CATEGORIES),
    retrievalPriorities: arrayOrEmpty(plan.retrievalPriorities).map(normalizeRetrievalPriority),
    exclusionRules: arrayOrEmpty(plan.exclusionRules).map(normalizeContextExclusionRule),
    contextNeeds: arrayOrEmpty(plan.contextNeeds).map(normalizeContextNeedItem),
    warnings: stringArrayValue(plan.warnings),
    createdAt: stringValue(plan.createdAt) || timestamp,
    updatedAt: stringValue(plan.updatedAt) || timestamp
  }
}

export function normalizeContextCompressionRecords(value: unknown): ContextSelectionResult['compressionRecords'] {
  return arrayOrEmpty<Record<string, unknown>>(value).map((entry) => {
    const record = objectOrEmpty(entry)
    const replacementKind =
      record.replacementKind === 'stage_summary' ||
      record.replacementKind === 'chapter_one_line_summary' ||
      record.replacementKind === 'summary_excerpt' ||
      record.replacementKind === 'dropped'
        ? record.replacementKind
        : 'dropped'
    const kind =
      record.kind === 'chapter_recap_to_stage_summary' ||
      record.kind === 'chapter_recap_to_one_line_summary' ||
      record.kind === 'chapter_recap_to_summary_excerpt' ||
      record.kind === 'chapter_recap_dropped'
        ? record.kind
        : 'chapter_recap_dropped'
    const originalTokenEstimate = typeof record.originalTokenEstimate === 'number' && Number.isFinite(record.originalTokenEstimate)
      ? Math.max(0, record.originalTokenEstimate)
      : 0
    const replacementTokenEstimate = typeof record.replacementTokenEstimate === 'number' && Number.isFinite(record.replacementTokenEstimate)
      ? Math.max(0, record.replacementTokenEstimate)
      : 0
    return {
      id: stringValue(record.id) || `compression-${stringValue(record.originalChapterId) || 'unknown'}`,
      kind,
      originalContextKind: 'chapter_recap',
      originalChapterId: stringValue(record.originalChapterId),
      originalChapterOrder: typeof record.originalChapterOrder === 'number' ? record.originalChapterOrder : 0,
      originalTitle: stringValue(record.originalTitle) || undefined,
      originalTokenEstimate,
      replacementKind,
      replacementSourceId: stringValue(record.replacementSourceId) || null,
      replacementText: stringValue(record.replacementText),
      replacementTokenEstimate,
      savedTokenEstimate:
        typeof record.savedTokenEstimate === 'number' && Number.isFinite(record.savedTokenEstimate)
          ? Math.max(0, record.savedTokenEstimate)
          : Math.max(0, originalTokenEstimate - replacementTokenEstimate),
      reason: stringValue(record.reason) || 'Context compressed for token budget.'
    }
  })
}

export function normalizeBudgetProfile(value: unknown, projectId = ''): ContextBudgetProfile {
  const profile = objectOrEmpty(value)
  const timestamp = new Date().toISOString()
  return {
    id: stringValue(profile.id) || `budget-${timestamp}`,
    projectId: stringValue(profile.projectId) || projectId,
    name: stringValue(profile.name) || '上下文快照预算',
    maxTokens: typeof profile.maxTokens === 'number' ? profile.maxTokens : DEFAULT_SETTINGS.defaultTokenBudget,
    mode: profile.mode === 'light' || profile.mode === 'standard' || profile.mode === 'full' || profile.mode === 'custom' ? profile.mode : 'standard',
    includeRecentChaptersCount: typeof profile.includeRecentChaptersCount === 'number' ? profile.includeRecentChaptersCount : 3,
    includeStageSummariesCount: typeof profile.includeStageSummariesCount === 'number' ? profile.includeStageSummariesCount : 2,
    includeMainCharacters: typeof profile.includeMainCharacters === 'boolean' ? profile.includeMainCharacters : true,
    includeRelatedCharacters: typeof profile.includeRelatedCharacters === 'boolean' ? profile.includeRelatedCharacters : true,
    includeForeshadowingWeights: Array.isArray(profile.includeForeshadowingWeights)
      ? (profile.includeForeshadowingWeights as ContextBudgetProfile['includeForeshadowingWeights'])
      : ['medium', 'high', 'payoff'],
    includeTimelineEventsCount: typeof profile.includeTimelineEventsCount === 'number' ? profile.includeTimelineEventsCount : 6,
    styleSampleMaxChars: typeof profile.styleSampleMaxChars === 'number' ? profile.styleSampleMaxChars : 1200,
    createdAt: stringValue(profile.createdAt) || timestamp,
    updatedAt: stringValue(profile.updatedAt) || timestamp
  }
}

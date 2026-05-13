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

import { DEFAULT_SETTINGS, EMPTY_APP_DATA, createEmptyChapterTask, createEmptyHardCanonPack } from '../defaults/index'
import { arrayOrEmpty, objectOrEmpty, recordOrEmpty, stringArrayValue, stringValue } from './common'
import { normalizeCharacterStateChangeCandidate, normalizeCharacterStateFact, normalizeCharacterStateLog, normalizeCharacterStateTransaction } from './characterState'
import { normalizeChapterContinuityBridge, normalizeContinuityBridgeSuggestion } from './continuity'
import { normalizeBudgetProfile, normalizeContextNeedPlan, normalizeContextSelectionResult } from './context'
import { normalizeForeshadowing } from './foreshadowing'
import { normalizeMemoryUpdateCandidate } from './memoryUpdate'
import { normalizeConsistencyReviewReport, normalizeQualityGateReport, normalizeRedundancyReport } from './reports'
import { normalizeGenerationRunTrace, normalizeRunTraceAuthorSummary } from './runTrace'
import { normalizeStoryDirectionGuide } from './storyDirection'

function normalizeChapterTask(value: unknown): ChapterTask {
  return { ...createEmptyChapterTask(), ...(objectOrEmpty(value) as Partial<ChapterTask>) }
}

function normalizeStageSummary(value: unknown): StageSummary {
  const summary = objectOrEmpty(value)
  const chapterStart = typeof summary.chapterStart === 'number' ? summary.chapterStart : 1
  const chapterEnd = typeof summary.chapterEnd === 'number' ? summary.chapterEnd : chapterStart
  const compressedPlotSummary = stringValue(summary.compressedPlotSummary) || stringValue(summary.plotProgress)
  return {
    id: stringValue(summary.id),
    projectId: stringValue(summary.projectId),
    chapterStart,
    chapterEnd,
    coveredChapterRange: stringValue(summary.coveredChapterRange) || `第 ${chapterStart}-${chapterEnd} 章`,
    compressedPlotSummary,
    irreversibleChanges: stringValue(summary.irreversibleChanges),
    endingCarryoverState: stringValue(summary.endingCarryoverState),
    emotionalAftertaste: stringValue(summary.emotionalAftertaste),
    pacingState: stringValue(summary.pacingState),
    plotProgress: stringValue(summary.plotProgress) || compressedPlotSummary,
    characterRelations: stringValue(summary.characterRelations),
    secrets: stringValue(summary.secrets),
    foreshadowingPlanted: stringValue(summary.foreshadowingPlanted),
    foreshadowingResolved: stringValue(summary.foreshadowingResolved),
    unresolvedQuestions: stringValue(summary.unresolvedQuestions),
    nextStageDirection: stringValue(summary.nextStageDirection),
    createdAt: stringValue(summary.createdAt) || new Date().toISOString(),
    updatedAt: stringValue(summary.updatedAt) || new Date().toISOString()
  }
}

function normalizeHardCanonCategory(value: unknown): HardCanonItemCategory {
  const allowed: HardCanonItemCategory[] = [
    'world_rule',
    'system_rule',
    'character_identity',
    'character_hard_state',
    'timeline_anchor',
    'foreshadowing_rule',
    'relationship_fact',
    'prohibition',
    'style_boundary',
    'other'
  ]
  return allowed.includes(value as HardCanonItemCategory) ? (value as HardCanonItemCategory) : 'other'
}

function normalizeHardCanonPriority(value: unknown): HardCanonPriority {
  return value === 'must' || value === 'high' || value === 'medium' ? value : 'medium'
}

function normalizeHardCanonStatus(value: unknown): HardCanonStatus {
  return value === 'active' || value === 'inactive' || value === 'deprecated' ? value : 'active'
}

function normalizeHardCanonItem(value: HardCanonItem | Record<string, unknown>, projectIdHint = ''): HardCanonItem {
  const item = objectOrEmpty(value)
  const timestamp = new Date().toISOString()
  const projectId = stringValue(item.projectId) || projectIdHint
  return {
    ...(value as HardCanonItem),
    id: stringValue(item.id) || `hard-canon-item-${timestamp}`,
    projectId,
    category: normalizeHardCanonCategory(item.category),
    title: stringValue(item.title) || stringValue(item.content).slice(0, 32) || 'Hard canon item',
    content: stringValue(item.content),
    priority: normalizeHardCanonPriority(item.priority),
    status: normalizeHardCanonStatus(item.status),
    sourceType:
      item.sourceType === 'manual' ||
      item.sourceType === 'story_bible' ||
      item.sourceType === 'character' ||
      item.sourceType === 'foreshadowing' ||
      item.sourceType === 'timeline' ||
      item.sourceType === 'stage_summary' ||
      item.sourceType === 'run_trace' ||
      item.sourceType === 'imported'
        ? item.sourceType
        : 'manual',
    sourceId: stringValue(item.sourceId) || null,
    relatedCharacterIds: stringArrayValue(item.relatedCharacterIds),
    relatedForeshadowingIds: stringArrayValue(item.relatedForeshadowingIds),
    relatedTimelineEventIds: stringArrayValue(item.relatedTimelineEventIds),
    createdAt: stringValue(item.createdAt) || timestamp,
    updatedAt: stringValue(item.updatedAt) || timestamp
  }
}

function normalizeHardCanonPack(value: HardCanonPack | Record<string, unknown>): HardCanonPack {
  const pack = objectOrEmpty(value)
  const timestamp = new Date().toISOString()
  const projectId = stringValue(pack.projectId)
  return {
    ...(value as HardCanonPack),
    id: stringValue(pack.id) || `hard-canon-pack-${projectId || timestamp}`,
    projectId,
    title: stringValue(pack.title) || '不可违背设定包',
    description: stringValue(pack.description),
    items: arrayOrEmpty<HardCanonItem>(pack.items).map((item) => normalizeHardCanonItem(item, projectId)),
    maxPromptTokens: typeof pack.maxPromptTokens === 'number' && pack.maxPromptTokens > 0 ? pack.maxPromptTokens : 900,
    createdAt: stringValue(pack.createdAt) || timestamp,
    updatedAt: stringValue(pack.updatedAt) || timestamp,
    schemaVersion: typeof pack.schemaVersion === 'number' ? pack.schemaVersion : 1
  }
}

function normalizePromptContextSnapshot(value: PromptContextSnapshot | Record<string, unknown>): PromptContextSnapshot {
  const snapshot = objectOrEmpty(value)
  const timestamp = new Date().toISOString()
  const projectId = stringValue(snapshot.projectId)
  return {
    ...(value as PromptContextSnapshot),
    id: stringValue(snapshot.id),
    projectId,
    targetChapterOrder: typeof snapshot.targetChapterOrder === 'number' ? snapshot.targetChapterOrder : 1,
    mode: snapshot.mode === 'light' || snapshot.mode === 'standard' || snapshot.mode === 'full' || snapshot.mode === 'custom' ? snapshot.mode : 'standard',
    budgetProfileId: stringValue(snapshot.budgetProfileId) || null,
    budgetProfile: normalizeBudgetProfile(snapshot.budgetProfile, projectId),
    contextSelectionResult: normalizeContextSelectionResult(snapshot.contextSelectionResult),
    selectedCharacterIds: stringArrayValue(snapshot.selectedCharacterIds),
    selectedForeshadowingIds: stringArrayValue(snapshot.selectedForeshadowingIds),
    foreshadowingTreatmentOverrides: objectOrEmpty(snapshot.foreshadowingTreatmentOverrides) as PromptContextSnapshot['foreshadowingTreatmentOverrides'],
    chapterTask: normalizeChapterTask(snapshot.chapterTask),
    contextNeedPlan: snapshot.contextNeedPlan ? normalizeContextNeedPlan(snapshot.contextNeedPlan as Record<string, unknown>) : null,
    storyDirectionGuide: snapshot.storyDirectionGuide ? normalizeStoryDirectionGuide(snapshot.storyDirectionGuide as Record<string, unknown>) : null,
    finalPrompt: stringValue(snapshot.finalPrompt),
    estimatedTokens: typeof snapshot.estimatedTokens === 'number' ? snapshot.estimatedTokens : 0,
    source: snapshot.source === 'auto' || snapshot.source === 'pipeline' ? snapshot.source : 'manual',
    note: stringValue(snapshot.note),
    createdAt: stringValue(snapshot.createdAt) || timestamp,
    updatedAt: stringValue(snapshot.updatedAt) || timestamp
  }
}

function normalizeChapterGenerationJob(value: ChapterGenerationJob | Record<string, unknown>): ChapterGenerationJob {
  const job = objectOrEmpty(value)
  return {
    ...(value as ChapterGenerationJob),
    promptContextSnapshotId: stringValue(job.promptContextSnapshotId) || null,
    contextSource: job.contextSource === 'prompt_snapshot' ? 'prompt_snapshot' : 'auto'
  }
}

export function normalizeAppData(input: Partial<AppData>): AppData {
  const raw = recordOrEmpty(input)
  const rawSettings = recordOrEmpty(raw.settings)
  const legacyApiKey = stringValue(rawSettings.apiKey)
  const hasApiKey = typeof rawSettings.hasApiKey === 'boolean' ? rawSettings.hasApiKey : Boolean(legacyApiKey.trim())
  const projects = arrayOrEmpty<Project>(raw.projects)
  const normalizedHardCanonPacks = arrayOrEmpty<HardCanonPack>(raw.hardCanonPacks).map(normalizeHardCanonPack)
  const hardCanonProjectIds = new Set(normalizedHardCanonPacks.map((pack) => pack.projectId))
  const hardCanonPacks = [
    ...normalizedHardCanonPacks,
    ...projects.filter((project) => !hardCanonProjectIds.has(project.id)).map((project) => createEmptyHardCanonPack(project.id))
  ]

  return {
    ...EMPTY_APP_DATA,
    ...input,
    schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : EMPTY_APP_DATA.schemaVersion,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(rawSettings as Partial<AppSettings>),
      apiKey: legacyApiKey,
      hasApiKey
    },
    projects,
    storyBibles: arrayOrEmpty(raw.storyBibles),
    chapters: arrayOrEmpty(raw.chapters),
    characters: arrayOrEmpty(raw.characters),
    characterStateLogs: arrayOrEmpty<CharacterStateLog>(raw.characterStateLogs).map(normalizeCharacterStateLog),
    characterStateFacts: arrayOrEmpty<CharacterStateFact>(raw.characterStateFacts).map(normalizeCharacterStateFact),
    characterStateTransactions: arrayOrEmpty<CharacterStateTransaction>(raw.characterStateTransactions).map(normalizeCharacterStateTransaction),
    characterStateChangeCandidates: arrayOrEmpty<CharacterStateChangeCandidate>(raw.characterStateChangeCandidates).map(normalizeCharacterStateChangeCandidate),
    foreshadowings: arrayOrEmpty<Foreshadowing>(raw.foreshadowings).map(normalizeForeshadowing),
    timelineEvents: arrayOrEmpty(raw.timelineEvents),
    stageSummaries: arrayOrEmpty<StageSummary>(raw.stageSummaries).map(normalizeStageSummary),
    promptVersions: arrayOrEmpty(raw.promptVersions),
    promptContextSnapshots: arrayOrEmpty<PromptContextSnapshot>(raw.promptContextSnapshots).map(normalizePromptContextSnapshot),
    storyDirectionGuides: arrayOrEmpty<StoryDirectionGuide>(raw.storyDirectionGuides).map(normalizeStoryDirectionGuide),
    hardCanonPacks,
    contextNeedPlans: arrayOrEmpty<ContextNeedPlan>(raw.contextNeedPlans).map(normalizeContextNeedPlan),
    chapterContinuityBridges: arrayOrEmpty<ChapterContinuityBridge>(raw.chapterContinuityBridges).map(normalizeChapterContinuityBridge),
    chapterGenerationJobs: arrayOrEmpty<ChapterGenerationJob>(raw.chapterGenerationJobs).map(normalizeChapterGenerationJob),
    chapterGenerationSteps: arrayOrEmpty(raw.chapterGenerationSteps),
    generatedChapterDrafts: arrayOrEmpty(raw.generatedChapterDrafts),
    memoryUpdateCandidates: arrayOrEmpty<MemoryUpdateCandidate>(raw.memoryUpdateCandidates).map(normalizeMemoryUpdateCandidate),
    consistencyReviewReports: arrayOrEmpty<ConsistencyReviewReport>(raw.consistencyReviewReports).map(normalizeConsistencyReviewReport),
    contextBudgetProfiles: arrayOrEmpty(raw.contextBudgetProfiles),
    qualityGateReports: arrayOrEmpty<QualityGateReport>(raw.qualityGateReports).map(normalizeQualityGateReport),
    generationRunTraces: arrayOrEmpty<GenerationRunTrace>(raw.generationRunTraces).map(normalizeGenerationRunTrace),
    runTraceAuthorSummaries: arrayOrEmpty<RunTraceAuthorSummary>(raw.runTraceAuthorSummaries).map(normalizeRunTraceAuthorSummary),
    redundancyReports: arrayOrEmpty<RedundancyReport>(raw.redundancyReports).map(normalizeRedundancyReport),
    revisionCandidates: arrayOrEmpty(raw.revisionCandidates),
    revisionSessions: arrayOrEmpty(raw.revisionSessions),
    revisionRequests: arrayOrEmpty(raw.revisionRequests),
    revisionVersions: arrayOrEmpty(raw.revisionVersions),
    chapterVersions: arrayOrEmpty(raw.chapterVersions),
    chapterCommitBundles: arrayOrEmpty<ChapterCommitBundle>(raw.chapterCommitBundles),
    revisionCommitBundles: arrayOrEmpty<RevisionCommitBundle>(raw.revisionCommitBundles)
  }
}

export function sanitizeAppDataForPersistence(input: AppData): AppData {
  const normalized = normalizeAppData(input)
  return {
    ...normalized,
    settings: {
      ...normalized.settings,
      apiKey: ''
    }
  }
}

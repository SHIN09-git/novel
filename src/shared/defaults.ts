import type {
  AppData,
  AppSettings,
  ChapterTask,
  ChapterContinuityBridge,
  ChapterGenerationJob,
  ContextBudgetProfile,
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
  MemoryUpdateCandidate,
  MemoryUpdateCandidateType,
  MemoryUpdatePatch,
  QualityGateReport,
  RedundancyReport,
  PromptMode,
  PromptModuleSelection,
  PromptContextSnapshot,
  StoryBible
} from './types'
import { normalizeTreatmentMode } from './foreshadowingTreatment'

export const DEFAULT_SETTINGS: AppSettings = {
  apiProvider: 'openai',
  apiKey: '',
  hasApiKey: false,
  baseUrl: 'https://api.openai.com/v1',
  modelName: 'gpt-4.1',
  temperature: 0.8,
  maxTokens: 8000,
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
  foreshadowings: [],
  timelineEvents: [],
  stageSummaries: [],
  promptVersions: [],
  promptContextSnapshots: [],
  chapterContinuityBridges: [],
  chapterGenerationJobs: [],
  chapterGenerationSteps: [],
  generatedChapterDrafts: [],
  memoryUpdateCandidates: [],
  consistencyReviewReports: [],
  contextBudgetProfiles: [],
  qualityGateReports: [],
  generationRunTraces: [],
  redundancyReports: [],
  revisionCandidates: [],
  revisionSessions: [],
  revisionRequests: [],
  revisionVersions: [],
  chapterVersions: [],
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

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function normalizeForeshadowing(value: Foreshadowing): Foreshadowing {
  return {
    ...value,
    treatmentMode: normalizeTreatmentMode(value.treatmentMode, value.status, value.weight)
  }
}

function normalizeForeshadowingStatus(value: unknown): ForeshadowingStatus {
  return value === 'unresolved' || value === 'partial' || value === 'resolved' || value === 'abandoned' ? value : 'unresolved'
}

function normalizeForeshadowingWeight(value: unknown): ForeshadowingWeight {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'payoff' ? value : 'medium'
}

function normalizeForeshadowingCandidate(value: unknown): ForeshadowingCandidate {
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

function normalizeContextSelectionResult(value: unknown): ContextSelectionResult {
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
    warnings: stringArrayValue(selection.warnings)
  }
}

function normalizeContextCompressionRecords(value: unknown): ContextSelectionResult['compressionRecords'] {
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

function normalizeBudgetProfile(value: unknown, projectId = ''): ContextBudgetProfile {
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

function normalizeChapterTask(value: unknown): ChapterTask {
  return { ...createEmptyChapterTask(), ...(objectOrEmpty(value) as Partial<ChapterTask>) }
}

function normalizeContinuityBridgeSuggestion(value: unknown) {
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

function normalizeChapterContinuityBridge(value: ChapterContinuityBridge | Record<string, unknown>): ChapterContinuityBridge {
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

function normalizeQualityGateReport(value: QualityGateReport | Record<string, unknown>): QualityGateReport {
  const report = objectOrEmpty(value)
  const dimensions = objectOrEmpty(report.dimensions)
  return {
    ...(value as QualityGateReport),
    dimensions: {
      plotCoherence: typeof dimensions.plotCoherence === 'number' ? dimensions.plotCoherence : 70,
      characterConsistency: typeof dimensions.characterConsistency === 'number' ? dimensions.characterConsistency : 70,
      foreshadowingControl: typeof dimensions.foreshadowingControl === 'number' ? dimensions.foreshadowingControl : 70,
      chapterContinuity: typeof dimensions.chapterContinuity === 'number' ? dimensions.chapterContinuity : 70,
      redundancyControl: typeof dimensions.redundancyControl === 'number' ? dimensions.redundancyControl : 70,
      styleMatch: typeof dimensions.styleMatch === 'number' ? dimensions.styleMatch : 70,
      pacing: typeof dimensions.pacing === 'number' ? dimensions.pacing : 70,
      emotionalPayoff: typeof dimensions.emotionalPayoff === 'number' ? dimensions.emotionalPayoff : 70,
      originality: typeof dimensions.originality === 'number' ? dimensions.originality : 70,
      promptCompliance: typeof dimensions.promptCompliance === 'number' ? dimensions.promptCompliance : 70
    },
    issues: Array.isArray(report.issues) ? (report.issues as QualityGateReport['issues']) : [],
    requiredFixes: stringArrayValue(report.requiredFixes),
    optionalSuggestions: stringArrayValue(report.optionalSuggestions)
  }
}

function normalizeRedundancyReport(value: RedundancyReport | Record<string, unknown>): RedundancyReport {
  const report = objectOrEmpty(value)
  return {
    ...(value as RedundancyReport),
    id: stringValue(report.id) || `redundancy-${new Date().toISOString()}`,
    projectId: stringValue(report.projectId),
    chapterId: stringValue(report.chapterId) || null,
    draftId: stringValue(report.draftId) || null,
    repeatedPhrases: stringArrayValue(report.repeatedPhrases),
    repeatedSceneDescriptions: stringArrayValue(report.repeatedSceneDescriptions),
    repeatedExplanations: stringArrayValue(report.repeatedExplanations),
    overusedIntensifiers: stringArrayValue(report.overusedIntensifiers),
    redundantParagraphs: stringArrayValue(report.redundantParagraphs),
    compressionSuggestions: stringArrayValue(report.compressionSuggestions),
    overallRedundancyScore: typeof report.overallRedundancyScore === 'number' ? report.overallRedundancyScore : 0,
    createdAt: stringValue(report.createdAt) || new Date().toISOString()
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

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeConsistencySeverity(value: unknown): ConsistencySeverity {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'medium'
}

function normalizeConsistencyIssueType(value: unknown): ConsistencyIssueType {
  const allowed: ConsistencyIssueType[] = [
    'timeline_conflict',
    'worldbuilding_conflict',
    'character_knowledge_leak',
    'character_motivation_gap',
    'character_ooc',
    'foreshadowing_misuse',
    'foreshadowing_leak',
    'geography_or_physics_conflict',
    'previous_chapter_contradiction',
    'continuity_gap',
    'other'
  ]
  if (allowed.includes(value as ConsistencyIssueType)) return value as ConsistencyIssueType
  if (value === 'timeline') return 'timeline_conflict'
  if (value === 'setting') return 'worldbuilding_conflict'
  if (value === 'character_ooc') return 'character_ooc'
  if (value === 'foreshadowing') return 'foreshadowing_misuse'
  return 'other'
}

function normalizeConsistencyIssueStatus(value: unknown): ConsistencyIssueStatus {
  return value === 'open' || value === 'ignored' || value === 'converted_to_revision' || value === 'resolved' ? value : 'open'
}

function normalizeConsistencyIssue(value: unknown, index = 0): ConsistencyReviewIssue {
  const issue = objectOrEmpty(value)
  const type = normalizeConsistencyIssueType(issue.type ?? issue.category)
  const suggestedFix = stringValue(issue.suggestedFix) || stringValue(issue.suggestion)
  const description = stringValue(issue.description)
  return {
    id: stringValue(issue.id) || `legacy-consistency-issue-${index}`,
    type,
    category: issue.category as ConsistencyReviewIssue['category'],
    severity: normalizeConsistencySeverity(issue.severity),
    title: stringValue(issue.title) || description.slice(0, 36) || '一致性问题',
    description,
    evidence: stringValue(issue.evidence),
    relatedChapterIds: stringArrayValue(issue.relatedChapterIds),
    relatedCharacterIds: stringArrayValue(issue.relatedCharacterIds),
    relatedForeshadowingIds: stringArrayValue(issue.relatedForeshadowingIds),
    suggestedFix,
    revisionInstruction: stringValue(issue.revisionInstruction) || suggestedFix || description,
    status: normalizeConsistencyIssueStatus(issue.status),
    suggestion: stringValue(issue.suggestion) || suggestedFix
  }
}

function issueFromLegacyText(text: string): ConsistencyReviewIssue[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed.map((item, index) => normalizeConsistencyIssue(item, index))
    if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { issues?: unknown }).issues)) {
      return ((parsed as { issues: unknown[] }).issues).map((item, index) => normalizeConsistencyIssue(item, index))
    }
  } catch {
    // Keep the original text as a legacy issue below.
  }
  return [
    normalizeConsistencyIssue(
      {
        type: 'other',
        severity: 'medium',
        title: '旧版审稿问题',
        description: trimmed,
        evidence: '',
        suggestedFix: '请人工查看旧版一致性审稿文本，并决定是否需要修订。'
      },
      0
    )
  ]
}

function normalizeConsistencyReviewReport(value: ConsistencyReviewReport | Record<string, unknown>): ConsistencyReviewReport {
  const report = objectOrEmpty(value)
  const rawIssues = report.issues
  const legacyIssuesText = typeof rawIssues === 'string' ? rawIssues : stringValue(report.legacyIssuesText)
  const issues = Array.isArray(rawIssues)
    ? rawIssues.map((item, index) => normalizeConsistencyIssue(item, index))
    : issueFromLegacyText(legacyIssuesText)
  return {
    ...(value as ConsistencyReviewReport),
    id: stringValue(report.id),
    projectId: stringValue(report.projectId),
    jobId: stringValue(report.jobId),
    chapterId: stringValue(report.chapterId) || null,
    promptContextSnapshotId: stringValue(report.promptContextSnapshotId) || null,
    issues,
    legacyIssuesText,
    suggestions: stringValue(report.suggestions),
    severitySummary: normalizeConsistencySeverity(report.severitySummary),
    createdAt: stringValue(report.createdAt) || new Date().toISOString()
  }
}

function normalizeForeshadowingTreatmentMap(value: unknown): GenerationRunTrace['foreshadowingTreatmentModes'] {
  const record = objectOrEmpty(value)
  return Object.fromEntries(
    Object.entries(record)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, mode]) => [key, normalizeTreatmentMode(mode)])
  )
}

function normalizeForcedContextBlocks(value: unknown): ForcedContextBlock[] {
  return arrayOrEmpty<Record<string, unknown>>(value).map((entry) => {
    const block = objectOrEmpty(entry)
    const sourceChapterOrder = typeof block.sourceChapterOrder === 'number' ? block.sourceChapterOrder : null
    return {
      kind: stringValue(block.kind) || 'unknown',
      sourceId: stringValue(block.sourceId) || null,
      sourceType: stringValue(block.sourceType) || null,
      sourceChapterId: stringValue(block.sourceChapterId) || null,
      sourceChapterOrder,
      title: stringValue(block.title) || 'Forced context',
      tokenEstimate: typeof block.tokenEstimate === 'number' && Number.isFinite(block.tokenEstimate) ? Math.max(0, block.tokenEstimate) : 0
    }
  })
}

function normalizeGenerationRunTrace(value: GenerationRunTrace | Record<string, unknown>): GenerationRunTrace {
  const trace = objectOrEmpty(value)
  const timestamp = new Date().toISOString()
  const continuitySource =
    trace.continuitySource === 'saved_bridge' || trace.continuitySource === 'auto_from_previous_ending' || trace.continuitySource === 'manual'
      ? trace.continuitySource
      : null
  return {
    ...(value as GenerationRunTrace),
    id: stringValue(trace.id) || `trace-${timestamp}`,
    projectId: stringValue(trace.projectId),
    jobId: stringValue(trace.jobId),
    targetChapterOrder: typeof trace.targetChapterOrder === 'number' ? trace.targetChapterOrder : 1,
    promptContextSnapshotId: stringValue(trace.promptContextSnapshotId) || null,
    contextSource: trace.contextSource === 'prompt_snapshot' ? 'prompt_snapshot' : 'auto',
    selectedChapterIds: stringArrayValue(trace.selectedChapterIds),
    selectedStageSummaryIds: stringArrayValue(trace.selectedStageSummaryIds),
    selectedCharacterIds: stringArrayValue(trace.selectedCharacterIds),
    selectedForeshadowingIds: stringArrayValue(trace.selectedForeshadowingIds),
    foreshadowingTreatmentModes: normalizeForeshadowingTreatmentMap(trace.foreshadowingTreatmentModes),
    foreshadowingTreatmentOverrides: normalizeForeshadowingTreatmentMap(trace.foreshadowingTreatmentOverrides),
    omittedContextItems: Array.isArray(trace.omittedContextItems) ? (trace.omittedContextItems as GenerationRunTrace['omittedContextItems']) : [],
    contextWarnings: stringArrayValue(trace.contextWarnings),
    contextTokenEstimate: typeof trace.contextTokenEstimate === 'number' ? trace.contextTokenEstimate : 0,
    forcedContextBlocks: normalizeForcedContextBlocks(trace.forcedContextBlocks),
    compressionRecords: normalizeContextCompressionRecords(trace.compressionRecords),
    finalPromptTokenEstimate: typeof trace.finalPromptTokenEstimate === 'number' ? trace.finalPromptTokenEstimate : 0,
    generatedDraftId: stringValue(trace.generatedDraftId) || null,
    consistencyReviewReportId: stringValue(trace.consistencyReviewReportId) || null,
    qualityGateReportId: stringValue(trace.qualityGateReportId) || null,
    revisionSessionIds: stringArrayValue(trace.revisionSessionIds),
    acceptedRevisionVersionId: stringValue(trace.acceptedRevisionVersionId) || null,
    acceptedMemoryCandidateIds: stringArrayValue(trace.acceptedMemoryCandidateIds),
    rejectedMemoryCandidateIds: stringArrayValue(trace.rejectedMemoryCandidateIds),
    continuityBridgeId: stringValue(trace.continuityBridgeId) || null,
    continuitySource,
    redundancyReportId: stringValue(trace.redundancyReportId) || null,
    continuityWarnings: stringArrayValue(trace.continuityWarnings),
    createdAt: stringValue(trace.createdAt) || timestamp,
    updatedAt: stringValue(trace.updatedAt) || timestamp
  }
}

export function normalizeAppData(input: Partial<AppData>): AppData {
  const raw = recordOrEmpty(input)
  const rawSettings = recordOrEmpty(raw.settings)
  const legacyApiKey = stringValue(rawSettings.apiKey)
  const hasApiKey = typeof rawSettings.hasApiKey === 'boolean' ? rawSettings.hasApiKey : Boolean(legacyApiKey.trim())

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
    projects: arrayOrEmpty(raw.projects),
    storyBibles: arrayOrEmpty(raw.storyBibles),
    chapters: arrayOrEmpty(raw.chapters),
    characters: arrayOrEmpty(raw.characters),
    characterStateLogs: arrayOrEmpty(raw.characterStateLogs),
    foreshadowings: arrayOrEmpty<Foreshadowing>(raw.foreshadowings).map(normalizeForeshadowing),
    timelineEvents: arrayOrEmpty(raw.timelineEvents),
    stageSummaries: arrayOrEmpty(raw.stageSummaries),
    promptVersions: arrayOrEmpty(raw.promptVersions),
    promptContextSnapshots: arrayOrEmpty<PromptContextSnapshot>(raw.promptContextSnapshots).map(normalizePromptContextSnapshot),
    chapterContinuityBridges: arrayOrEmpty<ChapterContinuityBridge>(raw.chapterContinuityBridges).map(normalizeChapterContinuityBridge),
    chapterGenerationJobs: arrayOrEmpty<ChapterGenerationJob>(raw.chapterGenerationJobs).map(normalizeChapterGenerationJob),
    chapterGenerationSteps: arrayOrEmpty(raw.chapterGenerationSteps),
    generatedChapterDrafts: arrayOrEmpty(raw.generatedChapterDrafts),
    memoryUpdateCandidates: arrayOrEmpty<MemoryUpdateCandidate>(raw.memoryUpdateCandidates).map(normalizeMemoryUpdateCandidate),
    consistencyReviewReports: arrayOrEmpty<ConsistencyReviewReport>(raw.consistencyReviewReports).map(normalizeConsistencyReviewReport),
    contextBudgetProfiles: arrayOrEmpty(raw.contextBudgetProfiles),
    qualityGateReports: arrayOrEmpty<QualityGateReport>(raw.qualityGateReports).map(normalizeQualityGateReport),
    generationRunTraces: arrayOrEmpty<GenerationRunTrace>(raw.generationRunTraces).map(normalizeGenerationRunTrace),
    redundancyReports: arrayOrEmpty<RedundancyReport>(raw.redundancyReports).map(normalizeRedundancyReport),
    revisionCandidates: arrayOrEmpty(raw.revisionCandidates),
    revisionSessions: arrayOrEmpty(raw.revisionSessions),
    revisionRequests: arrayOrEmpty(raw.revisionRequests),
    revisionVersions: arrayOrEmpty(raw.revisionVersions),
    chapterVersions: arrayOrEmpty(raw.chapterVersions)
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

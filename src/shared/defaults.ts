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
  GenerationRunTrace,
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
  schemaVersion: 2,
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
    warnings: stringArrayValue(selection.warnings)
  }
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

  return {
    ...EMPTY_APP_DATA,
    ...input,
    schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : EMPTY_APP_DATA.schemaVersion,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(rawSettings as Partial<AppSettings>)
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
    memoryUpdateCandidates: arrayOrEmpty(raw.memoryUpdateCandidates),
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

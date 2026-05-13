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
import { arrayOrEmpty, objectOrEmpty, stringArrayValue, stringValue } from './common'
import { normalizeContextCompressionRecords, normalizeContextSelectionTrace, normalizeRequiredCharacterCardFields, normalizeRequiredStateFactCategories } from './context'
import { normalizeConsistencySeverity, normalizeNoveltyAuditResult } from './reports'

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

function normalizePromptBlockOrder(value: unknown): PromptBlockOrderItem[] {
  return arrayOrEmpty<Record<string, unknown>>(value).map((entry, index) => {
    const block = objectOrEmpty(entry)
    return {
      id: stringValue(block.id) || `prompt-block-${index}`,
      title: stringValue(block.title) || 'Prompt block',
      kind: stringValue(block.kind) || 'unknown',
      priority: typeof block.priority === 'number' && Number.isFinite(block.priority) ? block.priority : index + 1,
      tokenEstimate: typeof block.tokenEstimate === 'number' && Number.isFinite(block.tokenEstimate) ? Math.max(0, block.tokenEstimate) : 0,
      source: stringValue(block.source) || 'unknown',
      sourceIds: stringArrayValue(block.sourceIds),
      included: typeof block.included === 'boolean' ? block.included : true,
      compressed: typeof block.compressed === 'boolean' ? block.compressed : false,
      forced: typeof block.forced === 'boolean' ? block.forced : false,
      omittedReason: stringValue(block.omittedReason) || null,
      reason: stringValue(block.reason) || '旧数据缺少 prompt block reason。'
    }
  })
}

export function normalizeGenerationRunTrace(value: GenerationRunTrace | Record<string, unknown>): GenerationRunTrace {
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
      selectedTimelineEventIds: stringArrayValue(trace.selectedTimelineEventIds),
      foreshadowingTreatmentModes: normalizeForeshadowingTreatmentMap(trace.foreshadowingTreatmentModes),
    foreshadowingTreatmentOverrides: normalizeForeshadowingTreatmentMap(trace.foreshadowingTreatmentOverrides),
    omittedContextItems: Array.isArray(trace.omittedContextItems) ? (trace.omittedContextItems as GenerationRunTrace['omittedContextItems']) : [],
    contextWarnings: stringArrayValue(trace.contextWarnings),
    contextTokenEstimate: typeof trace.contextTokenEstimate === 'number' ? trace.contextTokenEstimate : 0,
    contextSelectionTrace: normalizeContextSelectionTrace(trace.contextSelectionTrace),
    forcedContextBlocks: normalizeForcedContextBlocks(trace.forcedContextBlocks),
    compressionRecords: normalizeContextCompressionRecords(trace.compressionRecords),
    promptBlockOrder: normalizePromptBlockOrder(trace.promptBlockOrder),
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
    contextNeedPlanId: stringValue(trace.contextNeedPlanId) || null,
    requiredCharacterCardFields: normalizeRequiredCharacterCardFields(trace.requiredCharacterCardFields),
    requiredStateFactCategories: normalizeRequiredStateFactCategories(trace.requiredStateFactCategories),
    contextNeedPlanWarnings: stringArrayValue(trace.contextNeedPlanWarnings),
    contextNeedPlanMatchedItems: stringArrayValue(trace.contextNeedPlanMatchedItems),
    contextNeedPlanOmittedItems: Array.isArray(trace.contextNeedPlanOmittedItems)
      ? (trace.contextNeedPlanOmittedItems as GenerationRunTrace['contextNeedPlanOmittedItems'])
      : [],
    includedCharacterStateFactIds: stringArrayValue(trace.includedCharacterStateFactIds),
    characterStateWarnings: stringArrayValue(trace.characterStateWarnings),
    characterStateIssueIds: stringArrayValue(trace.characterStateIssueIds),
    noveltyAuditResult: normalizeNoveltyAuditResult(trace.noveltyAuditResult),
    storyDirectionGuideId: stringValue(trace.storyDirectionGuideId) || null,
    storyDirectionGuideSource:
      trace.storyDirectionGuideSource === 'user_polished' || trace.storyDirectionGuideSource === 'mixed' || trace.storyDirectionGuideSource === 'ai_generated'
        ? trace.storyDirectionGuideSource
        : null,
    storyDirectionGuideHorizon: trace.storyDirectionGuideHorizon === 5 || trace.storyDirectionGuideHorizon === 10 ? trace.storyDirectionGuideHorizon : null,
    storyDirectionGuideStartChapterOrder: typeof trace.storyDirectionGuideStartChapterOrder === 'number' ? trace.storyDirectionGuideStartChapterOrder : null,
    storyDirectionGuideEndChapterOrder: typeof trace.storyDirectionGuideEndChapterOrder === 'number' ? trace.storyDirectionGuideEndChapterOrder : null,
    storyDirectionBeatId: stringValue(trace.storyDirectionBeatId) || null,
    storyDirectionAppliedToChapterTask: typeof trace.storyDirectionAppliedToChapterTask === 'boolean' ? trace.storyDirectionAppliedToChapterTask : false,
    hardCanonPackItemCount: typeof trace.hardCanonPackItemCount === 'number' ? trace.hardCanonPackItemCount : 0,
    hardCanonPackTokenEstimate: typeof trace.hardCanonPackTokenEstimate === 'number' ? trace.hardCanonPackTokenEstimate : 0,
    includedHardCanonItemIds: stringArrayValue(trace.includedHardCanonItemIds),
    truncatedHardCanonItemIds: stringArrayValue(trace.truncatedHardCanonItemIds),
    createdAt: stringValue(trace.createdAt) || timestamp,
    updatedAt: stringValue(trace.updatedAt) || timestamp
  }
}

function normalizeRunTraceAuthorSummaryStatus(value: unknown): RunTraceAuthorSummary['overallStatus'] {
  return value === 'good' || value === 'needs_attention' || value === 'risky' || value === 'failed' || value === 'unknown' ? value : 'unknown'
}

function normalizeRunTraceProblemSource(value: unknown): RunTraceAuthorSummary['likelyProblemSources'][number]['source'] {
  const raw = stringValue(value)
  const allowed: RunTraceAuthorSummary['likelyProblemSources'][number]['source'][] = [
    'context_missing',
    'context_noise',
    'task_contract',
    'character_state',
    'foreshadowing',
    'novelty_drift',
    'consistency',
    'quality_gate',
    'redundancy',
    'model_output',
    'revision_needed',
    'unknown'
  ]
  return allowed.includes(raw as RunTraceAuthorSummary['likelyProblemSources'][number]['source'])
    ? (raw as RunTraceAuthorSummary['likelyProblemSources'][number]['source'])
    : 'unknown'
}

function normalizeRunTraceAuthorActionType(value: unknown): RunTraceAuthorSummary['nextActions'][number]['actionType'] {
  const raw = stringValue(value)
  const allowed: RunTraceAuthorSummary['nextActions'][number]['actionType'][] = [
    'revise_chapter',
    'adjust_context',
    'update_character_state',
    'review_memory_candidate',
    'review_foreshadowing',
    'edit_chapter_task',
    'rerun_generation',
    'ignore'
  ]
  return allowed.includes(raw as RunTraceAuthorSummary['nextActions'][number]['actionType'])
    ? (raw as RunTraceAuthorSummary['nextActions'][number]['actionType'])
    : 'ignore'
}

function normalizeBudgetPressure(value: unknown): NonNullable<RunTraceAuthorSummary['contextDiagnosis']>['budgetPressure'] {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'unknown' ? value : 'unknown'
}

export function normalizeRunTraceAuthorSummary(value: unknown): RunTraceAuthorSummary {
  const summary = objectOrEmpty(value)
  const contextDiagnosis = objectOrEmpty(summary.contextDiagnosis)
  const continuityDiagnosis = objectOrEmpty(summary.continuityDiagnosis)
  const draftDiagnosis = objectOrEmpty(summary.draftDiagnosis)
  const sourceRefs = objectOrEmpty(summary.sourceRefs)
  const timestamp = new Date().toISOString()
  return {
    id: stringValue(summary.id) || `run-trace-author-summary-${stringValue(summary.traceId) || timestamp}`,
    projectId: stringValue(summary.projectId),
    chapterId: stringValue(summary.chapterId) || null,
    jobId: stringValue(summary.jobId) || undefined,
    traceId: stringValue(summary.traceId) || undefined,
    generatedDraftId: stringValue(summary.generatedDraftId) || null,
    createdAt: stringValue(summary.createdAt) || timestamp,
    summaryVersion: typeof summary.summaryVersion === 'number' ? summary.summaryVersion : 1,
    overallStatus: normalizeRunTraceAuthorSummaryStatus(summary.overallStatus),
    oneLineDiagnosis: stringValue(summary.oneLineDiagnosis) || '暂无诊断摘要。',
    likelyProblemSources: arrayOrEmpty<Record<string, unknown>>(summary.likelyProblemSources).map((item) => {
      const source = objectOrEmpty(item)
      return {
        source: normalizeRunTraceProblemSource(source.source),
        severity: normalizeConsistencySeverity(source.severity),
        evidence: stringArrayValue(source.evidence),
        recommendation: stringValue(source.recommendation)
      }
    }),
    contextDiagnosis: {
      usedContextCount: typeof contextDiagnosis.usedContextCount === 'number' ? contextDiagnosis.usedContextCount : 0,
      missingContextHints: stringArrayValue(contextDiagnosis.missingContextHints),
      noisyContextHints: stringArrayValue(contextDiagnosis.noisyContextHints),
      budgetPressure: normalizeBudgetPressure(contextDiagnosis.budgetPressure)
    },
    continuityDiagnosis: {
      characterStateIssues: stringArrayValue(continuityDiagnosis.characterStateIssues),
      foreshadowingIssues: stringArrayValue(continuityDiagnosis.foreshadowingIssues),
      timelineIssues: stringArrayValue(continuityDiagnosis.timelineIssues),
      newCanonRisks: stringArrayValue(continuityDiagnosis.newCanonRisks)
    },
    draftDiagnosis: {
      qualityGatePassed: typeof draftDiagnosis.qualityGatePassed === 'boolean' ? draftDiagnosis.qualityGatePassed : undefined,
      consistencyPassed: typeof draftDiagnosis.consistencyPassed === 'boolean' ? draftDiagnosis.consistencyPassed : undefined,
      redundancyRisk: normalizeBudgetPressure(draftDiagnosis.redundancyRisk),
      mainDraftIssues: stringArrayValue(draftDiagnosis.mainDraftIssues)
    },
    nextActions: arrayOrEmpty<Record<string, unknown>>(summary.nextActions).map((item) => {
      const action = objectOrEmpty(item)
      return {
        label: stringValue(action.label) || '人工检查',
        actionType: normalizeRunTraceAuthorActionType(action.actionType),
        reason: stringValue(action.reason)
      }
    }),
    sourceRefs: {
      qualityGateReportId: stringValue(sourceRefs.qualityGateReportId) || undefined,
      consistencyReviewReportId: stringValue(sourceRefs.consistencyReviewReportId) || undefined,
      redundancyReportIds: stringArrayValue(sourceRefs.redundancyReportIds),
      noveltyAuditId: stringValue(sourceRefs.noveltyAuditId) || undefined,
      generationRunTraceId: stringValue(sourceRefs.generationRunTraceId) || undefined,
      contextNeedPlanId: stringValue(sourceRefs.contextNeedPlanId) || undefined
    }
  }
}


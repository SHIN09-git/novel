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
  PromptCompositionAlert,
  PromptCompositionBlockMetric,
  PromptCompositionCategory,
  PromptCompositionMetrics,
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
import {
  normalizeContextCompressionRecords,
  normalizeContextSelectionTrace,
  normalizeOmittedContextItems,
  normalizeRequiredCharacterCardFields,
  normalizeRequiredStateFactCategories
} from './context'
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

const PIPELINE_AI_ROLES = ['planner', 'prose', 'extraction', 'reviewer', 'revision'] as const
const AI_CALL_STEP_TYPES = [
  'context_need_planning',
  'context_budget_selection',
  'build_context',
  'generate_chapter_plan',
  'context_need_planning_from_plan',
  'context_budget_selection_delta',
  'rebuild_context_with_plan',
  'generate_chapter_draft',
  'generate_chapter_review',
  'propose_character_updates',
  'propose_foreshadowing_updates',
  'consistency_review',
  'quality_gate',
  'await_user_confirmation'
] as const

function normalizeAiCallTrace(value: unknown, index: number): GenerationRunTrace['aiCalls'][number] | null {
  const call = objectOrEmpty(value)
  const provider = call.provider
  const role = call.role
  const stepType = call.stepType
  if (
    provider !== 'openai' && provider !== 'compatible' && provider !== 'local' && provider !== 'codex_cli'
  ) return null
  if (!PIPELINE_AI_ROLES.includes(role as (typeof PIPELINE_AI_ROLES)[number])) return null
  if (!AI_CALL_STEP_TYPES.includes(stepType as (typeof AI_CALL_STEP_TYPES)[number])) return null
  const usage = objectOrEmpty(call.usage)
  const numberOrUndefined = (input: unknown) =>
    typeof input === 'number' && Number.isFinite(input) ? Math.max(0, input) : undefined
  return {
    id: stringValue(call.id) || stringValue(call.callId) || `ai-call-${index}`,
    callId: stringValue(call.callId) || undefined,
    runId: stringValue(call.runId) || undefined,
    stepId: stringValue(call.stepId),
    stepType: stepType as GenerationRunTrace['aiCalls'][number]['stepType'],
    role: role as GenerationRunTrace['aiCalls'][number]['role'],
    logicalCallIndex:
      typeof call.logicalCallIndex === 'number' && Number.isFinite(call.logicalCallIndex)
        ? Math.max(1, Math.round(call.logicalCallIndex))
        : index + 1,
    provider,
    model: stringValue(call.model).slice(0, 128) || 'unknown',
    durationMs: numberOrUndefined(call.durationMs) ?? 0,
    attempts: Math.round(numberOrUndefined(call.attempts) ?? 0),
    responseFormatFallback: call.responseFormatFallback === true,
    finishReason: stringValue(call.finishReason).slice(0, 120) || undefined,
    usage: Object.keys(usage).length
      ? {
          promptTokens: numberOrUndefined(usage.promptTokens),
          completionTokens: numberOrUndefined(usage.completionTokens),
          totalTokens: numberOrUndefined(usage.totalTokens),
          reasoningTokens: numberOrUndefined(usage.reasoningTokens),
          cachedPromptTokens: numberOrUndefined(usage.cachedPromptTokens)
        }
      : undefined,
    terminationCategory:
      call.terminationCategory === 'cancelled' || call.terminationCategory === 'timeout'
        ? call.terminationCategory
        : 'none',
    outcome: call.outcome === 'failed' ? 'failed' : 'success',
    createdAt: stringValue(call.createdAt) || new Date().toISOString()
  }
}

const PROMPT_COMPOSITION_CATEGORIES: PromptCompositionCategory[] = [
  'positive_task',
  'factual_context',
  'constraints',
  'review_tone',
  'other'
]
const MAX_PROMPT_COMPOSITION_BLOCKS = 64
const MAX_PROMPT_COMPOSITION_ALERTS = 16
const MAX_PROMPT_COMPOSITION_RELATED_BLOCKS = 12

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function promptMetricFingerprint(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function normalizePromptCompositionAlert(value: unknown): PromptCompositionAlert | null {
  const alert = objectOrEmpty(value)
  if (alert.kind !== 'repeated_sentence' && alert.kind !== 'similar_constraint') return null
  const rawFingerprints = stringArrayValue(alert.fingerprints)
    .map((item) => item.toLowerCase())
    .filter((item) => /^[0-9a-f]{8}$/.test(item))
    .slice(0, alert.kind === 'similar_constraint' ? 2 : 1)
  const legacySample = stringValue(alert.sample)
  const fingerprints = rawFingerprints.length
    ? rawFingerprints
    : legacySample
      ? [promptMetricFingerprint(legacySample.normalize('NFKC').toLocaleLowerCase())]
      : []
  if (!fingerprints.length) return null
  const label = alert.kind === 'repeated_sentence' ? '重复句' : '相似禁令'
  return {
    kind: alert.kind,
    severity: 'warning',
    sample: `${label}指纹 ${fingerprints.join(' / ')}`,
    fingerprints,
    relatedBlockIds: stringArrayValue(alert.relatedBlockIds)
      .map((item) => item.slice(0, 128))
      .slice(0, MAX_PROMPT_COMPOSITION_RELATED_BLOCKS),
    ...(typeof alert.occurrences === 'number' && Number.isFinite(alert.occurrences)
      ? { occurrences: Math.min(999, Math.max(0, Math.round(alert.occurrences))) }
      : {}),
    ...(typeof alert.similarity === 'number' && Number.isFinite(alert.similarity)
      ? { similarity: Math.max(0, Math.min(1, alert.similarity)) }
      : {}),
    reason:
      alert.kind === 'repeated_sentence'
        ? '规范化后相同的句子在最终 Prompt 中重复出现。'
        : '两条禁令的规范化文本高度相似。'
  }
}

function reconcilePromptMetricBlocks(blocks: PromptCompositionBlockMetric[], total: number): PromptCompositionBlockMetric[] {
  const next = blocks.map((block) => ({ ...block }))
  let overflow = next.reduce((sum, block) => sum + block.tokenEstimate, 0) - total
  if (overflow <= 0) return next
  for (const block of [...next].sort((left, right) => right.tokenEstimate - left.tokenEstimate)) {
    if (overflow <= 0) break
    const reduction = Math.min(block.tokenEstimate, overflow)
    block.tokenEstimate -= reduction
    overflow -= reduction
  }
  return next
}

function normalizePromptCompositionMetrics(value: unknown, fallbackTotalTokenEstimate = 0): PromptCompositionMetrics | null {
  const metrics = objectOrEmpty(value)
  if (!Object.keys(metrics).length) return null
  const hasMetricShape =
    typeof metrics.totalTokenEstimate === 'number' ||
    Array.isArray(metrics.blockMetrics) ||
    Object.keys(objectOrEmpty(metrics.categoryTokenEstimates)).length > 0
  if (!hasMetricShape) return null
  const rawTotal = finiteNonNegative(metrics.totalTokenEstimate)
  const totalTokenEstimate = rawTotal > 0 ? rawTotal : finiteNonNegative(fallbackTotalTokenEstimate)
  const seenBlockIds = new Set<string>()
  const rawBlockMetrics = arrayOrEmpty<Record<string, unknown>>(metrics.blockMetrics)
    .slice(0, MAX_PROMPT_COMPOSITION_BLOCKS)
    .flatMap((entry, index): PromptCompositionBlockMetric[] => {
      const block = objectOrEmpty(entry)
      const id = (stringValue(block.id) || `prompt-metric-${index}`).slice(0, 128)
      if (seenBlockIds.has(id)) return []
      seenBlockIds.add(id)
      const category = PROMPT_COMPOSITION_CATEGORIES.includes(block.category as PromptCompositionCategory)
        ? (block.category as PromptCompositionCategory)
        : 'other'
      return [{ id, tokenEstimate: finiteNonNegative(block.tokenEstimate), tokenSharePercent: 0, category }]
    })
  const blockMetrics = reconcilePromptMetricBlocks(rawBlockMetrics, totalTokenEstimate).map((block) => ({
    ...block,
    tokenSharePercent: totalTokenEstimate > 0 ? Math.round((block.tokenEstimate / totalTokenEstimate) * 1000) / 10 : 0
  }))
  const categoryTokenEstimates = Object.fromEntries(
    PROMPT_COMPOSITION_CATEGORIES.map((category) => [
      category,
      blockMetrics.length
        ? blockMetrics.filter((block) => block.category === category).reduce((sum, block) => sum + block.tokenEstimate, 0)
        : finiteNonNegative(objectOrEmpty(metrics.categoryTokenEstimates)[category])
    ])
  ) as Record<PromptCompositionCategory, number>
  let categoryOverflow = Object.values(categoryTokenEstimates).reduce((sum, value) => sum + value, 0) - totalTokenEstimate
  for (const category of [...PROMPT_COMPOSITION_CATEGORIES].sort(
    (left, right) => categoryTokenEstimates[right] - categoryTokenEstimates[left]
  )) {
    if (categoryOverflow <= 0) break
    const reduction = Math.min(categoryTokenEstimates[category], categoryOverflow)
    categoryTokenEstimates[category] -= reduction
    categoryOverflow -= reduction
  }
  const categoryShares = Object.fromEntries(
    PROMPT_COMPOSITION_CATEGORIES.map((category) => [
      category,
      totalTokenEstimate > 0 ? Math.round((categoryTokenEstimates[category] / totalTokenEstimate) * 1000) / 10 : 0
    ])
  ) as Record<PromptCompositionCategory, number>
  const rawSpecificAlerts = [...arrayOrEmpty(metrics.repeatedSentences), ...arrayOrEmpty(metrics.similarConstraints)]
  const normalizedAlerts = (rawSpecificAlerts.length ? rawSpecificAlerts : arrayOrEmpty(metrics.alerts))
    .map(normalizePromptCompositionAlert)
    .filter((item): item is PromptCompositionAlert => Boolean(item))
  const alertKeys = new Set<string>()
  const alerts = normalizedAlerts.filter((alert) => {
    const key = `${alert.kind}|${alert.fingerprints?.join('|') ?? alert.sample}|${alert.relatedBlockIds.join('|')}`
    if (alertKeys.has(key)) return false
    alertKeys.add(key)
    return true
  }).slice(0, MAX_PROMPT_COMPOSITION_ALERTS)
  const attributedTokenEstimate = blockMetrics.length
    ? blockMetrics.reduce((sum, block) => sum + block.tokenEstimate, 0)
    : Math.min(totalTokenEstimate, Object.values(categoryTokenEstimates).reduce((sum, amount) => sum + amount, 0))
  const repeatedSentences = alerts.filter((alert) => alert.kind === 'repeated_sentence')
  const similarConstraints = alerts.filter((alert) => alert.kind === 'similar_constraint')
  return {
    totalTokenEstimate,
    attributedTokenEstimate,
    unattributedTokenEstimate: Math.max(0, totalTokenEstimate - attributedTokenEstimate),
    categoryTokenEstimates,
    categoryShares,
    blockMetrics,
    repeatedSentences,
    similarConstraints,
    alerts,
    constraintLineCount: finiteNonNegative(metrics.constraintLineCount),
    reviewToneLineCount: finiteNonNegative(metrics.reviewToneLineCount),
    summary: `总计约 ${totalTokenEstimate} token；已归因 ${attributedTokenEstimate} token；发现重复句 ${repeatedSentences.length} 组、相似禁令 ${similarConstraints.length} 组。`
  }
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
    pipelineRecipeId:
      trace.pipelineRecipeId === 'fast' ||
      trace.pipelineRecipeId === 'standard' ||
      trace.pipelineRecipeId === 'strict' ||
      trace.pipelineRecipeId === 'custom'
        ? trace.pipelineRecipeId
        : null,
    pipelineRecipeVersion: trace.pipelineRecipeVersion === 1 ? 1 : null,
    pipelineRecipeExplanation: stringValue(trace.pipelineRecipeExplanation),
    aiCalls: arrayOrEmpty(trace.aiCalls)
      .map(normalizeAiCallTrace)
      .filter((item): item is GenerationRunTrace['aiCalls'][number] => Boolean(item)),
    selectedChapterIds: stringArrayValue(trace.selectedChapterIds),
      selectedStageSummaryIds: stringArrayValue(trace.selectedStageSummaryIds),
      selectedCharacterIds: stringArrayValue(trace.selectedCharacterIds),
      selectedForeshadowingIds: stringArrayValue(trace.selectedForeshadowingIds),
      selectedTimelineEventIds: stringArrayValue(trace.selectedTimelineEventIds),
      foreshadowingTreatmentModes: normalizeForeshadowingTreatmentMap(trace.foreshadowingTreatmentModes),
    foreshadowingTreatmentOverrides: normalizeForeshadowingTreatmentMap(trace.foreshadowingTreatmentOverrides),
    omittedContextItems: normalizeOmittedContextItems(trace.omittedContextItems),
    contextWarnings: stringArrayValue(trace.contextWarnings),
    contextTokenEstimate: typeof trace.contextTokenEstimate === 'number' ? trace.contextTokenEstimate : 0,
    contextSelectionTrace: normalizeContextSelectionTrace(trace.contextSelectionTrace),
    forcedContextBlocks: normalizeForcedContextBlocks(trace.forcedContextBlocks),
    compressionRecords: normalizeContextCompressionRecords(trace.compressionRecords),
    promptBlockOrder: normalizePromptBlockOrder(trace.promptBlockOrder),
    finalPromptTokenEstimate: finiteNonNegative(trace.finalPromptTokenEstimate),
    promptCompositionMetrics: normalizePromptCompositionMetrics(
      trace.promptCompositionMetrics,
      finiteNonNegative(trace.finalPromptTokenEstimate)
    ),
    promptLintWarnings: stringArrayValue(trace.promptLintWarnings),
    promptLintIssueCount: typeof trace.promptLintIssueCount === 'number' && Number.isFinite(trace.promptLintIssueCount) ? Math.max(0, trace.promptLintIssueCount) : 0,
    generatedDraftId: stringValue(trace.generatedDraftId) || null,
    consistencyReviewReportId: stringValue(trace.consistencyReviewReportId) || null,
    qualityGateReportId: stringValue(trace.qualityGateReportId) || null,
    editorialVerdictId: stringValue(trace.editorialVerdictId) || null,
    editorialVerdictDraftId: stringValue(trace.editorialVerdictDraftId) || null,
    editorialVerdictDraftContentHash: stringValue(trace.editorialVerdictDraftContentHash) || null,
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

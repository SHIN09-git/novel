import type { ForcedContextBlock, GeneratedChapterDraft, ID, PromptBlockOrderItem } from '../../../../../shared/types'
import { ContextBudgetManager } from '../../../../../services/ContextBudgetManager'
import { CharacterStateService } from '../../../../../services/CharacterStateService'
import { ChapterTaskContractService } from '../../../../../services/ChapterTaskContractService'
import { TokenEstimator } from '../../../../../services/TokenEstimator'
import { bindNoveltyAuditToDraft } from '../../../../../services/DraftDiagnosticBindingService'
import { inferPromptBlockOrderFromPrompt } from '../../../../../services/PromptBuilderService'
import { PromptLintService } from '../../../../../services/PromptLintService'
import { PromptCompositionMetricsService } from '../../../../../services/PromptCompositionMetricsService'
import { ensureContinuityBridgeInPrompt } from '../../../../../services/PromptContractReplayService'
import { formatContinuityBridgeForPrompt, resolveContinuityBridge } from '../../../../../services/ContinuityService'
import { PlanContextGapAnalyzerService } from '../../../../../services/PlanContextGapAnalyzerService'
import { shouldIsolateOpeningLegacyContext } from '../../../../../services/OpeningChapterContextPolicy'
import { guardOpeningChapterPlanForDraft } from '../../../../../services/OpeningChapterPlanGuardService'
import { activeChapters } from '../../../../../services/ChapterLifecycleService'
import { newId, now } from '../../../utils/format'
import { analyzeRedundancyDiagnostic, auditNoveltyDiagnostic } from '../../../utils/diagnosticsApi'
import { buildPipelineContextResultFromSelection, createContextBudgetProfile, selectBudgetContext } from '../../../utils/promptContext'
import {
  appendGenerationRunTraceAiCall,
  buildForeshadowingTreatmentModes,
  estimateForcedContextTokens,
  upsertGenerationRunTrace
} from '../../../utils/runTrace'
import {
  assertChapterTaskPresentInPrompt, characterStateFactsPresentInPrompt, diffIds, enrichContextSelectionTrace,
  hardCanonTraceFromPrompt, noveltyReferenceContext, pipelineChapterTask, serializeOutput, summarizeSnapshot,
  validateAuthoritativeChapterTaskDraft, validateGeneratedChapterDraft
} from '../pipelineUtils'
import type { PipelineStepHandlerContext } from '../pipelineRunnerTypes'
export function runPlanContextNeedStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step, options } = ctx
  const { project } = env
  if (!state.plan) throw new Error('缺少章节任务书，无法进行计划后上下文补全')
  state.plan = guardOpeningChapterPlanForDraft({ generatedPlan: state.plan, targetChapterOrder: options.targetChapterOrder, chapterTaskSnapshot: job.chapterTaskSnapshot })
  const analysis = PlanContextGapAnalyzerService.buildFromChapterPlan({
    project,
    targetChapterOrder: options.targetChapterOrder,
    baseContextNeedPlan: state.contextNeedPlan,
    plan: state.plan,
    characters: state.working.characters.filter((character) => character.projectId === project.id),
    foreshadowings: state.working.foreshadowings.filter((item) => item.projectId === project.id),
    timelineEvents: state.working.timelineEvents.filter((event) => event.projectId === project.id),
    characterStateFacts: state.working.characterStateFacts.filter((fact) => fact.projectId === project.id),
    suppressLegacyStateExpansion: options.targetChapterOrder === 1 && Boolean(job.chapterTaskSnapshot),
    suppressLegacyContextExpansion: options.targetChapterOrder === 1 && Boolean(job.chapterTaskSnapshot)
  })
  state.planGapAnalysis =
    job.contextSource === 'prompt_snapshot'
      ? {
          ...analysis,
          warnings: [...analysis.warnings, 'Prompt 快照模式不会自动补选上下文；如任务书新增了角色、伏笔或时间线，请回到 Prompt 构建器重新保存快照。'],
          reason: 'Prompt 快照模式保持用户手动上下文，不自动重建。'
        }
      : analysis
  if (job.contextSource !== 'prompt_snapshot') {
    state.contextNeedPlanFromPlan = state.planGapAnalysis.derivedContextNeedPlan
    state.contextNeedPlan = state.contextNeedPlanFromPlan
    state.working = {
      ...state.working,
      contextNeedPlans: [
        state.contextNeedPlanFromPlan,
        ...state.working.contextNeedPlans.filter((item) => item.id !== state.contextNeedPlanFromPlan?.id)
      ]
    }
  }
  state.working = env.updateStepInData(state.working, step.id, {
    status: 'completed',
    output: serializeOutput(state.planGapAnalysis)
  })
}
export function runContextBudgetDeltaStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step, options, snapshot, activeStoryDirectionGuide } = ctx
  const { project } = env
  if (job.contextSource === 'prompt_snapshot') {
    if (!snapshot) throw new Error('Prompt 上下文快照已丢失，请重新构建上下文。')
    state.budgetProfile = snapshot.budgetProfile
    state.budgetSelection = snapshot.contextSelectionResult
    state.working = env.updateStepInData(state.working, step.id, {
      status: 'completed',
      output: serializeOutput({
        profile: state.budgetProfile,
        selection: state.budgetSelection,
        explanation: ContextBudgetManager.explainSelection(state.budgetSelection),
        deltaFromPreviousSelection: {
          addedCharacterIds: [],
          addedForeshadowingIds: [],
          addedTimelineEventIds: [],
          addedChapterIds: [],
          addedStageSummaryIds: []
        },
        warning: 'Prompt 快照模式已跳过计划后二次补选，正文将继续使用快照上下文。'
      })
    })
    return
  }
  const previousSelection = state.budgetSelection
  const activeNeedPlan = state.contextNeedPlanFromPlan ?? state.contextNeedPlan
  if (!activeNeedPlan) throw new Error('缺少上下文需求计划，无法进行计划后补选。')
  state.budgetProfile = createContextBudgetProfile(project.id, options.budgetMode, options.budgetMaxTokens, `第 ${options.targetChapterOrder} 章计划后预算`)
  if (job.chapterTaskSnapshot) state.budgetProfile = { ...state.budgetProfile, styleSampleMaxChars: 0 }
  state.budgetSelection = selectBudgetContext(project, state.working, options.targetChapterOrder, state.budgetProfile, {
    chapterTask: pipelineChapterTask(project, options, activeStoryDirectionGuide, job.chapterTaskSnapshot),
    contextNeedPlan: activeNeedPlan,
    isolateOpeningLegacyContext: shouldIsolateOpeningLegacyContext(options.targetChapterOrder, Boolean(job.chapterTaskSnapshot))
  })
  const deltaFromPreviousSelection = {
    addedCharacterIds: diffIds(state.budgetSelection.selectedCharacterIds, previousSelection?.selectedCharacterIds ?? []),
    addedForeshadowingIds: diffIds(state.budgetSelection.selectedForeshadowingIds, previousSelection?.selectedForeshadowingIds ?? []),
    addedTimelineEventIds: diffIds(state.budgetSelection.selectedTimelineEventIds, previousSelection?.selectedTimelineEventIds ?? []),
    addedChapterIds: diffIds(state.budgetSelection.selectedChapterIds, previousSelection?.selectedChapterIds ?? []),
    addedStageSummaryIds: diffIds(state.budgetSelection.selectedStageSummaryIds, previousSelection?.selectedStageSummaryIds ?? [])
  }
  state.working = {
    ...env.updateStepInData(state.working, step.id, {
      status: 'completed',
      output: serializeOutput({
        profile: state.budgetProfile,
        selection: state.budgetSelection,
        explanation: ContextBudgetManager.explainSelection(state.budgetSelection),
        deltaFromPreviousSelection
      })
    }),
    contextBudgetProfiles: [state.budgetProfile, ...state.working.contextBudgetProfiles]
  }
}
export function runRebuildContextWithPlanStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step, options, snapshot, activeStoryDirectionGuide, storyDirectionTracePatch } = ctx
  const { project } = env
  let promptBlockOrder: PromptBlockOrderItem[] = []
  let hardCanonTrace = { itemCount: 0, tokenEstimate: 0, includedItemIds: [] as ID[], truncatedItemIds: [] as ID[] }
  let promptLintWarnings: string[] = []
  let promptLintIssueCount = 0
  if (job.contextSource === 'prompt_snapshot') {
    if (!snapshot) throw new Error('Prompt 上下文快照已丢失，请重新构建上下文。')
    const lintGuard = PromptLintService.guardWritingPrompt(snapshot.finalPrompt)
    state.context = lintGuard.guardedPrompt
    promptLintWarnings = lintGuard.result.warnings
    promptLintIssueCount = lintGuard.result.issueCount
    promptBlockOrder = inferPromptBlockOrderFromPrompt(state.context, 'prompt_context_snapshot')
    hardCanonTrace = hardCanonTraceFromPrompt(
      state.context,
      state.working.hardCanonPacks.find((pack) => pack.projectId === project.id) ?? null
    )
    state.rebuiltContextFromPlan = true
  } else {
    if (!state.budgetSelection) throw new Error('缺少计划后预算选择，无法重建上下文。')
    const promptResult = buildPipelineContextResultFromSelection(
      project,
      state.working,
      options.targetChapterOrder,
      options.readerEmotionTarget,
      options.estimatedWordCount,
      state.budgetProfile,
      state.budgetSelection,
      state.contextNeedPlanFromPlan ?? state.contextNeedPlan,
      activeStoryDirectionGuide,
      pipelineChapterTask(project, options, activeStoryDirectionGuide, job.chapterTaskSnapshot),
      Boolean(job.chapterTaskSnapshot)
    )
    state.context = promptResult.finalPrompt
    promptBlockOrder = promptResult.promptBlockOrder
    promptLintWarnings = promptResult.promptLintResult.warnings
    promptLintIssueCount = promptResult.promptLintResult.issueCount
    hardCanonTrace = {
      itemCount: promptResult.hardCanonPrompt?.itemCount ?? 0,
      tokenEstimate: promptResult.hardCanonPrompt?.tokenEstimate ?? 0,
      includedItemIds: promptResult.hardCanonPrompt?.includedItemIds ?? [],
      truncatedItemIds: promptResult.hardCanonPrompt?.truncatedItemIds ?? []
    }
    state.rebuiltContextFromPlan = true
  }
  const continuityResult = resolveContinuityBridge({
    projectId: project.id,
    chapters: activeChapters(state.working.chapters.filter((chapter) => chapter.projectId === project.id)),
    bridges: state.working.chapterContinuityBridges.filter((bridge) => bridge.projectId === project.id),
    targetChapterOrder: options.targetChapterOrder
  })
  if (continuityResult.bridge) {
    const bridgePrompt = formatContinuityBridgeForPrompt(continuityResult.bridge)
    const ensuredBridge = ensureContinuityBridgeInPrompt({
      finalPrompt: state.context,
      promptBlockOrder,
      bridgeBody: bridgePrompt,
      bridgeId: continuityResult.bridge.id,
      source: continuityResult.source ?? 'continuity_service',
      reason: '计划后重建上下文仍缺少上一章衔接时，由流水线在本章任务契约之前补入。'
    })
    state.context = ensuredBridge.finalPrompt
    promptBlockOrder = ensuredBridge.promptBlockOrder
  }
  const continuityPromptBlock = continuityResult.bridge ? formatContinuityBridgeForPrompt(continuityResult.bridge) : ''
  const forcedContextBlocks: ForcedContextBlock[] = continuityResult.bridge
    ? [
        {
          kind: 'continuity_bridge',
          sourceId: continuityResult.bridge.id,
          sourceType: continuityResult.source,
          sourceChapterId: continuityResult.bridge.fromChapterId,
          sourceChapterOrder: options.targetChapterOrder > 1 ? options.targetChapterOrder - 1 : null,
          title: '上一章结尾衔接',
          tokenEstimate: TokenEstimator.estimate(continuityPromptBlock)
        }
      ]
    : []
  const finalPromptTokenEstimate = TokenEstimator.estimate(state.context)
  const selectedCharacterIds = snapshot ? snapshot.selectedCharacterIds : state.budgetSelection?.selectedCharacterIds ?? []
  const selectedForeshadowingIds = snapshot ? snapshot.selectedForeshadowingIds : state.budgetSelection?.selectedForeshadowingIds ?? []
  const selectedTimelineEventIds = snapshot ? snapshot.contextSelectionResult.selectedTimelineEventIds : state.budgetSelection?.selectedTimelineEventIds ?? []
  const treatmentOverrides = snapshot?.foreshadowingTreatmentOverrides ?? {}
  const activeNeedPlan = state.contextNeedPlanFromPlan ?? state.contextNeedPlan
  const relevantCharacterStateFacts = CharacterStateService.getRelevantCharacterStatesForPrompt(
    selectedCharacterIds,
    activeNeedPlan,
    options.targetChapterOrder,
    state.working.characterStateFacts.filter((fact) => fact.projectId === project.id)
  )
  const includedCharacterStateFacts = characterStateFactsPresentInPrompt(state.context, relevantCharacterStateFacts)
  const requiresCharacterStateFacts = Object.values(activeNeedPlan?.requiredStateFactCategories ?? {}).some(
    (categories) => categories.length > 0
  )
  const storyDirectionGuideId = state.context.includes('中期剧情导向')
    ? snapshot?.storyDirectionGuide?.id ?? activeStoryDirectionGuide?.id ?? null
    : null
  const contextSelectionTrace = enrichContextSelectionTrace(
    snapshot?.contextSelectionResult.contextSelectionTrace ?? state.budgetSelection?.contextSelectionTrace,
    {
      jobId: job.id,
      contextNeedPlan: activeNeedPlan,
      includedCharacterStateFacts,
      hardCanonTrace,
      storyDirectionGuideId,
      selectionMode: snapshot ? 'prompt_snapshot' : state.budgetSelection?.contextSelectionTrace?.selectionMode ?? 'automatic',
      finalPromptTokenEstimate
    }
  )
  state.working = env.updateStepInData(state.working, step.id, {
    status: 'completed',
    output: serializeOutput({
      finalPrompt: state.context,
      promptBlockOrder,
      contextNeedPlanId: activeNeedPlan?.id ?? null,
      selectedCharacterIds,
      selectedForeshadowingIds,
      selectedTimelineEventIds,
      includedCharacterStateFactIds: includedCharacterStateFacts.map((fact) => fact.id),
      warnings: [...(state.budgetSelection?.warnings ?? []), ...continuityResult.warnings, ...(state.planGapAnalysis?.warnings ?? []), ...promptLintWarnings]
    })
  })
  state.working = upsertGenerationRunTrace(state.working, job, {
    ...storyDirectionTracePatch,
    targetChapterOrder: options.targetChapterOrder,
    promptContextSnapshotId: job.promptContextSnapshotId ?? null,
    contextSource: job.contextSource,
    selectedChapterIds: snapshot ? snapshot.contextSelectionResult.selectedChapterIds : state.budgetSelection?.selectedChapterIds ?? [],
    selectedStageSummaryIds: snapshot ? snapshot.contextSelectionResult.selectedStageSummaryIds : state.budgetSelection?.selectedStageSummaryIds ?? [],
    selectedCharacterIds,
    selectedForeshadowingIds,
    selectedTimelineEventIds,
    foreshadowingTreatmentModes: buildForeshadowingTreatmentModes(state.working.foreshadowings, selectedForeshadowingIds, treatmentOverrides),
    foreshadowingTreatmentOverrides: treatmentOverrides,
    omittedContextItems: state.budgetSelection?.omittedItems ?? [],
    contextWarnings: [
      ...(state.budgetSelection?.warnings ?? []),
      ...continuityResult.warnings,
      ...(state.planGapAnalysis?.warnings ?? []),
      ...promptLintWarnings,
      ...(snapshot && snapshot.targetChapterOrder !== options.targetChapterOrder
        ? [`快照目标为第 ${snapshot.targetChapterOrder} 章，流水线目标为第 ${options.targetChapterOrder} 章。`]
        : [])
    ],
    contextTokenEstimate: Math.max(0, finalPromptTokenEstimate - estimateForcedContextTokens(forcedContextBlocks)),
    forcedContextBlocks,
    compressionRecords: state.budgetSelection?.compressionRecords ?? [],
    promptBlockOrder,
    finalPromptTokenEstimate,
    promptCompositionMetrics: PromptCompositionMetricsService.calculate(state.context, promptBlockOrder, finalPromptTokenEstimate),
    promptLintWarnings,
    promptLintIssueCount,
    continuityBridgeId: continuityResult.bridge?.id ?? null,
    continuitySource: continuityResult.source,
    continuityWarnings: continuityResult.warnings,
    contextNeedPlanId: activeNeedPlan?.id ?? null,
    requiredCharacterCardFields: activeNeedPlan?.requiredCharacterCardFields ?? {},
    requiredStateFactCategories: activeNeedPlan?.requiredStateFactCategories ?? {},
    contextNeedPlanWarnings: activeNeedPlan?.warnings ?? [],
    contextNeedPlanMatchedItems: [
      ...(activeNeedPlan?.expectedCharacters.map((item) => item.characterId) ?? []),
      ...(activeNeedPlan?.requiredForeshadowingIds ?? []),
      ...(activeNeedPlan?.requiredTimelineEventIds ?? [])
    ],
    contextNeedPlanOmittedItems: (state.budgetSelection?.omittedItems ?? []).filter((item) =>
      activeNeedPlan
        ? activeNeedPlan.expectedCharacters.some((character) => character.characterId === item.id) ||
          activeNeedPlan.requiredForeshadowingIds.includes(item.id ?? '') ||
          activeNeedPlan.requiredTimelineEventIds.includes(item.id ?? '')
        : false
    ),
    includedCharacterStateFactIds: includedCharacterStateFacts.map((fact) => fact.id),
    characterStateWarnings:
      requiresCharacterStateFacts && includedCharacterStateFacts.length === 0
        ? ['上下文需求计划要求角色状态类别，但最终 prompt 没有匹配的状态账本事实。']
        : [],
    characterStateIssueIds: [],
    hardCanonPackItemCount: hardCanonTrace.itemCount,
    hardCanonPackTokenEstimate: hardCanonTrace.tokenEstimate,
    includedHardCanonItemIds: hardCanonTrace.includedItemIds,
    truncatedHardCanonItemIds: hardCanonTrace.truncatedItemIds,
    contextSelectionTrace
  })
}
export async function runGenerateChapterDraftStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step, options, activeStoryDirectionGuide } = ctx
  const { project, updateStepInData } = env
  const aiService = await env.getAiService('prose')
  if (!state.plan) throw new Error('缺少章节任务书，无法生成正文')
  if (job.contextSource !== 'prompt_snapshot' && !state.rebuiltContextFromPlan) throw new Error('缺少计划后重建上下文，无法生成正文。')
  const chapterTask = pipelineChapterTask(project, options, activeStoryDirectionGuide, job.chapterTaskSnapshot)
  state.plan = guardOpeningChapterPlanForDraft({ generatedPlan: state.plan, targetChapterOrder: options.targetChapterOrder, chapterTaskSnapshot: job.chapterTaskSnapshot })
  if (job.chapterTaskSnapshot) assertChapterTaskPresentInPrompt(state.context, chapterTask, 'draft')
  let result = await aiService.generateChapterDraft(state.plan, state.context, {
    mode: options.pipelineMode,
    targetChapterOrder: options.targetChapterOrder,
    estimatedWordCount: options.estimatedWordCount,
    readerEmotionTarget: options.readerEmotionTarget,
    chapterTask,
    authoritativeChapterTask: Boolean(job.chapterTaskSnapshot)
  })
  state.working = appendGenerationRunTraceAiCall(
    state.working,
    job.id,
    step,
    'prose',
    result.telemetry,
    result.ok && Boolean(result.data) ? 'success' : 'failed'
  )
  if (!result.data) throw new Error(result.error || result.parseError || '正文生成失败')
  let validationError = validateAuthoritativeChapterTaskDraft(result.data.body, result.data.title, options.estimatedWordCount, result.usedAI, job.chapterTaskSnapshot)
  if (validationError && result.usedAI) {
    const earlierResult = result
    const earlierContract = job.chapterTaskSnapshot && earlierResult.data ? ChapterTaskContractService.evaluate({ ...earlierResult.data, chapterTask }) : null
    const previousDraft = earlierContract && earlierResult.data &&
      validateGeneratedChapterDraft(earlierResult.data.body, options.estimatedWordCount, earlierResult.usedAI) === null &&
      ChapterTaskContractService.isLocallyRepairable(earlierContract) ? earlierResult.data : undefined
    const retryResult = await aiService.generateChapterDraft(state.plan, state.context, {
      mode: options.pipelineMode,
      targetChapterOrder: options.targetChapterOrder,
      estimatedWordCount: options.estimatedWordCount,
      readerEmotionTarget: options.readerEmotionTarget,
      chapterTask,
      authoritativeChapterTask: Boolean(job.chapterTaskSnapshot),
      retryReason: validationError, previousDraft,
      retryIssueTypes: earlierContract?.issues.map((issue) => issue.type) ?? []
    })
    state.working = appendGenerationRunTraceAiCall(
      state.working,
      job.id,
      step,
      'prose',
      retryResult.telemetry,
      retryResult.ok && Boolean(retryResult.data) ? 'success' : 'failed'
    )
    if (!retryResult.data) throw new Error(retryResult.error || retryResult.parseError || '正文重新生成失败')
    result = job.chapterTaskSnapshot && earlierResult.data && ChapterTaskContractService.shouldPreferEarlierAfterRetry({ earlier: earlierResult.data, later: retryResult.data, chapterTask }) ? earlierResult : retryResult
  }
  if (!result.data) throw new Error(result.error || result.parseError || '正文生成失败')
  if (validationError && result.usedAI) validationError = validateAuthoritativeChapterTaskDraft(result.data.body, result.data.title, options.estimatedWordCount, result.usedAI, job.chapterTaskSnapshot, { allowReviewableLengthUnderflow: true })
  if (validationError) {
    throw new Error(`${validationError} 请检查任务约束后重试。`)
  }
  const draft: GeneratedChapterDraft = {
    id: newId(),
    projectId: project.id,
    chapterId: null,
    jobId: job.id,
    title: result.data.title,
    body: result.data.body,
    summary: state.plan.chapterGoal,
    status: 'draft',
    tokenEstimate: TokenEstimator.estimate(result.data.body),
    createdAt: now(),
    updatedAt: now()
  }
  state.draftResult = result.data
  const auditNovelty = env.diagnostics?.auditNovelty ?? auditNoveltyDiagnostic
  const analyzeRedundancy = env.diagnostics?.analyzeRedundancy ?? analyzeRedundancyDiagnostic
  state.noveltyAuditResult = bindNoveltyAuditToDraft(
    await auditNovelty({
      generatedText: result.data.body,
      context: state.context,
      chapterPlan: state.plan,
      project,
      ...noveltyReferenceContext(state.working, project.id)
    }),
    draft
  )
  const redundancyReport = await analyzeRedundancy({
    projectId: project.id,
    chapterId: null,
    draftId: draft.id,
    body: result.data.body
  })
  redundancyReport.jobId = job.id
  redundancyReport.updatedAt = redundancyReport.createdAt
  state.draftRecord = draft
  state.working = {
    ...updateStepInData(state.working, step.id, { status: 'completed', output: serializeOutput(result.data) }),
    generatedChapterDrafts: [draft, ...state.working.generatedChapterDrafts],
    redundancyReports: [redundancyReport, ...state.working.redundancyReports]
  }
  state.working = upsertGenerationRunTrace(state.working, job, {
    generatedDraftId: draft.id,
    redundancyReportId: redundancyReport.id,
    noveltyAuditResult: state.noveltyAuditResult
  })
}

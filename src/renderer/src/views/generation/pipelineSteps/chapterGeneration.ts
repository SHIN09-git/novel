import type { ForcedContextBlock, GeneratedChapterDraft, ID, PromptBlockOrderItem } from '../../../../../shared/types'
import { ContextBudgetManager } from '../../../../../services/ContextBudgetManager'
import { CharacterStateService } from '../../../../../services/CharacterStateService'
import { TokenEstimator } from '../../../../../services/TokenEstimator'
import { inferPromptBlockOrderFromPrompt } from '../../../../../services/PromptBuilderService'
import { formatContinuityBridgeForPrompt, resolveContinuityBridge } from '../../../../../services/ContinuityService'
import { analyzeRedundancy } from '../../../../../services/RedundancyService'
import { NoveltyDetector } from '../../../../../services/NoveltyDetector'
import { PlanContextGapAnalyzerService } from '../../../../../services/PlanContextGapAnalyzerService'
import { newId, now } from '../../../utils/format'
import { buildPipelineContextResultFromSelection, createContextBudgetProfile, selectBudgetContext } from '../../../utils/promptContext'
import { buildForeshadowingTreatmentModes, estimateForcedContextTokens, upsertGenerationRunTrace } from '../../../utils/runTrace'
import {
  diffIds,
  enrichContextSelectionTrace,
  pipelineChapterTask,
  serializeOutput,
  summarizeSnapshot,
  uniqueIds,
  validateGeneratedChapterDraft
} from '../pipelineUtils'
import type { PipelineStepHandlerContext } from '../pipelineRunnerTypes'

export async function runGenerateChapterPlanStep(ctx: PipelineStepHandlerContext) {
  const { env, state, step, options } = ctx
  const result = await env.aiService.generateChapterPlan(state.context, {
    mode: options.pipelineMode,
    targetChapterOrder: options.targetChapterOrder,
    estimatedWordCount: options.estimatedWordCount,
    readerEmotionTarget: options.readerEmotionTarget
  })
  if (!result.data) throw new Error(result.error || result.parseError || '任务书生成失败')
  state.plan = result.data
  state.working = env.updateStepInData(state.working, step.id, {
    status: 'completed',
    output: serializeOutput(result.data),
    errorMessage: result.error?.includes('远程 AI 任务书生成失败') ? result.error : ''
  })
}

export function runPlanContextNeedStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step, options } = ctx
  const { project } = env
  if (!state.plan) throw new Error('缺少章节任务书，无法进行计划后上下文补全')
  const analysis = PlanContextGapAnalyzerService.buildFromChapterPlan({
    project,
    targetChapterOrder: options.targetChapterOrder,
    baseContextNeedPlan: state.contextNeedPlan,
    plan: state.plan,
    characters: state.working.characters.filter((character) => character.projectId === project.id),
    foreshadowings: state.working.foreshadowings.filter((item) => item.projectId === project.id),
    timelineEvents: state.working.timelineEvents.filter((event) => event.projectId === project.id),
    characterStateFacts: state.working.characterStateFacts.filter((fact) => fact.projectId === project.id)
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
  state.budgetSelection = selectBudgetContext(project, state.working, options.targetChapterOrder, state.budgetProfile, {
    characterIds: uniqueIds(activeNeedPlan.expectedCharacters.map((item) => item.characterId)),
    foreshadowingIds: activeNeedPlan.requiredForeshadowingIds,
    chapterTask: pipelineChapterTask(project, options, activeStoryDirectionGuide),
    contextNeedPlan: activeNeedPlan
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
  if (job.contextSource === 'prompt_snapshot') {
    if (!snapshot) throw new Error('Prompt 上下文快照已丢失，请重新构建上下文。')
    state.context = snapshot.finalPrompt
    promptBlockOrder = inferPromptBlockOrderFromPrompt(state.context, 'prompt_context_snapshot')
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
      activeStoryDirectionGuide
    )
    state.context = promptResult.finalPrompt
    promptBlockOrder = promptResult.promptBlockOrder
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
    chapters: state.working.chapters.filter((chapter) => chapter.projectId === project.id),
    bridges: state.working.chapterContinuityBridges.filter((bridge) => bridge.projectId === project.id),
    targetChapterOrder: options.targetChapterOrder
  })
  if (continuityResult.bridge && !state.context.includes('上一章结尾衔接')) {
    const bridgePrompt = formatContinuityBridgeForPrompt(continuityResult.bridge)
    state.context = `${state.context}\n\n## 上一章结尾衔接\n${bridgePrompt}`
    promptBlockOrder = [
      ...promptBlockOrder,
      {
        id: 'forced-continuity-bridge',
        title: '上一章结尾衔接',
        kind: 'continuity_bridge',
        priority: promptBlockOrder.length + 1,
        tokenEstimate: TokenEstimator.estimate(bridgePrompt),
        source: continuityResult.source ?? 'continuity_service',
        sourceIds: [continuityResult.bridge.id],
        included: true,
        compressed: false,
        forced: true,
        omittedReason: null,
        reason: '计划后重建上下文仍缺少上一章衔接时，由流水线作为 forced context 追加。'
      }
    ]
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
  const includedCharacterStateFacts = CharacterStateService.getRelevantCharacterStatesForPrompt(
    selectedCharacterIds,
    activeNeedPlan,
    options.targetChapterOrder,
    state.working.characterStateFacts.filter((fact) => fact.projectId === project.id)
  )
  const contextSelectionTrace = enrichContextSelectionTrace(
    snapshot?.contextSelectionResult.contextSelectionTrace ?? state.budgetSelection?.contextSelectionTrace,
    {
      jobId: job.id,
      contextNeedPlan: activeNeedPlan,
      includedCharacterStateFacts,
      hardCanonTrace,
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
      warnings: [...(state.budgetSelection?.warnings ?? []), ...continuityResult.warnings, ...(state.planGapAnalysis?.warnings ?? [])]
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
      ...(snapshot && snapshot.targetChapterOrder !== options.targetChapterOrder
        ? [`快照目标为第 ${snapshot.targetChapterOrder} 章，流水线目标为第 ${options.targetChapterOrder} 章。`]
        : [])
    ],
    contextTokenEstimate: Math.max(0, finalPromptTokenEstimate - estimateForcedContextTokens(forcedContextBlocks)),
    forcedContextBlocks,
    compressionRecords: state.budgetSelection?.compressionRecords ?? [],
    promptBlockOrder,
    finalPromptTokenEstimate,
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
    characterStateWarnings: includedCharacterStateFacts.length
      ? []
      : activeNeedPlan
        ? ['上下文需求计划要求角色状态类别，但本章没有匹配的状态账本事实。']
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
  const { env, state, job, step, options } = ctx
  const { project, aiService, updateStepInData } = env
  if (!state.plan) throw new Error('缺少章节任务书，无法生成正文')
  if (job.contextSource !== 'prompt_snapshot' && !state.rebuiltContextFromPlan) throw new Error('缺少计划后重建上下文，无法生成正文。')
  let result = await aiService.generateChapterDraft(state.plan, state.context, {
    mode: options.pipelineMode,
    estimatedWordCount: options.estimatedWordCount,
    readerEmotionTarget: options.readerEmotionTarget
  })
  if (!result.data) throw new Error(result.error || result.parseError || '正文生成失败')
  let validationError = validateGeneratedChapterDraft(result.data.body, options.estimatedWordCount, result.usedAI)
  if (validationError && result.usedAI) {
    result = await aiService.generateChapterDraft(state.plan, state.context, {
      mode: options.pipelineMode,
      estimatedWordCount: options.estimatedWordCount,
      readerEmotionTarget: options.readerEmotionTarget,
      retryReason: validationError
    })
    if (!result.data) throw new Error(result.error || result.parseError || '正文重新生成失败')
    validationError = validateGeneratedChapterDraft(result.data.body, options.estimatedWordCount, result.usedAI)
  }
  if (validationError) {
    throw new Error(`${validationError} 请重试，或提高设置页 Max Tokens。`)
  }
  state.draftResult = result.data
  state.noveltyAuditResult = NoveltyDetector.audit({
    generatedText: result.data.body,
    context: state.context,
    chapterPlan: state.plan
  })
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
  const redundancyReport = analyzeRedundancy({
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

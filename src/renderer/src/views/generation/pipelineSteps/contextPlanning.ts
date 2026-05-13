import type { ForcedContextBlock, ID, PromptBlockOrderItem } from '../../../../../shared/types'
import { ContextBudgetManager } from '../../../../../services/ContextBudgetManager'
import { ContextNeedPlannerService } from '../../../../../services/ContextNeedPlannerService'
import { CharacterStateService } from '../../../../../services/CharacterStateService'
import { TokenEstimator } from '../../../../../services/TokenEstimator'
import { inferPromptBlockOrderFromPrompt } from '../../../../../services/PromptBuilderService'
import { formatContinuityBridgeForPrompt, resolveContinuityBridge } from '../../../../../services/ContinuityService'
import { StoryDirectionService } from '../../../../../services/StoryDirectionService'
import { buildPipelineContextResultFromSelection, createContextBudgetProfile, selectBudgetContext } from '../../../utils/promptContext'
import { buildForeshadowingTreatmentModes, estimateForcedContextTokens, upsertGenerationRunTrace } from '../../../utils/runTrace'
import { enrichContextSelectionTrace, pipelineChapterTask, serializeOutput, summarizeSnapshot } from '../pipelineUtils'
import type { PipelineStepHandlerContext } from '../pipelineRunnerTypes'

export function runContextNeedPlanningStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step, options, snapshot, activeStoryDirectionGuide } = ctx
  const { project, scoped } = env
  if (job.contextSource === 'prompt_snapshot') {
    if (!snapshot) throw new Error('Prompt 上下文快照已丢失，请重新构建上下文。')
    state.contextNeedPlan = snapshot.contextNeedPlan ?? null
    state.working = env.updateStepInData(state.working, step.id, {
      status: 'completed',
      output: serializeOutput(
        state.contextNeedPlan ?? {
          id: null,
          contextSource: 'prompt_context_snapshot',
          snapshotId: snapshot.id,
          warning: '该快照没有保存上下文需求计划，将沿用快照中的上下文选择。'
        }
      )
    })
    return
  }

  const scopedChapters = state.working.chapters.filter((chapter) => chapter.projectId === project.id)
  const previousChapter = scopedChapters.find((chapter) => chapter.order === options.targetChapterOrder - 1) ?? null
  const continuityResult = resolveContinuityBridge({
    projectId: project.id,
    chapters: scopedChapters,
    bridges: state.working.chapterContinuityBridges.filter((bridge) => bridge.projectId === project.id),
    targetChapterOrder: options.targetChapterOrder
  })
  state.contextNeedPlan = ContextNeedPlannerService.buildFromChapterIntent({
    project,
    storyBible: scoped.bible,
    targetChapterOrder: options.targetChapterOrder,
    chapterTaskDraft: pipelineChapterTask(project, options, activeStoryDirectionGuide),
    previousChapter,
    continuityBridge: continuityResult.bridge,
    characters: scoped.characters,
    characterStateFacts: scoped.characterStateFacts,
    foreshadowing: scoped.foreshadowings,
    timelineEvents: scoped.timelineEvents,
    stageSummaries: scoped.stageSummaries,
    hardCanonItems: (state.working.hardCanonPacks ?? [])
      .filter((pack) => pack.projectId === project.id)
      .flatMap((pack) => pack.items),
    storyDirectionGuide: activeStoryDirectionGuide,
    storyDirectionPromptText: StoryDirectionService.formatForPrompt(activeStoryDirectionGuide, options.targetChapterOrder),
    source: 'generation_pipeline'
  })
  state.working = {
    ...env.updateStepInData(state.working, step.id, { status: 'completed', output: serializeOutput(state.contextNeedPlan) }),
    contextNeedPlans: [state.contextNeedPlan, ...state.working.contextNeedPlans.filter((plan) => plan.id !== state.contextNeedPlan?.id)]
  }
}

export function runContextBudgetSelectionStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step, options, snapshot, activeStoryDirectionGuide } = ctx
  const { project } = env
  if (job.contextSource === 'prompt_snapshot') {
    if (!snapshot) throw new Error('Prompt 上下文快照已丢失，请重新构建上下文。')
    if (snapshot.projectId !== project.id) throw new Error('Prompt 上下文快照不属于当前项目，已停止生成。')
    state.budgetProfile = snapshot.budgetProfile
    state.budgetSelection = snapshot.contextSelectionResult
    const targetMismatch = snapshot.targetChapterOrder !== options.targetChapterOrder
    state.working = env.updateStepInData(state.working, step.id, {
      status: 'completed',
      output: serializeOutput({
        profile: state.budgetProfile,
        selection: state.budgetSelection,
        contextSource: 'prompt_context_snapshot',
        snapshotId: snapshot.id,
        targetMismatch,
        warning: targetMismatch ? `快照目标为第 ${snapshot.targetChapterOrder} 章，流水线目标为第 ${options.targetChapterOrder} 章。` : ''
      })
    })
    return
  }

  state.budgetProfile = createContextBudgetProfile(project.id, options.budgetMode, options.budgetMaxTokens, `第 ${options.targetChapterOrder} 章流水线预算`)
  state.budgetSelection = selectBudgetContext(project, state.working, options.targetChapterOrder, state.budgetProfile, {
    chapterTask: pipelineChapterTask(project, options, activeStoryDirectionGuide),
    contextNeedPlan: state.contextNeedPlan
  })
  state.working = {
    ...env.updateStepInData(state.working, step.id, {
      status: 'completed',
      output: serializeOutput({
        profile: state.budgetProfile,
        selection: state.budgetSelection,
        explanation: ContextBudgetManager.explainSelection(state.budgetSelection)
      })
    }),
    contextBudgetProfiles: [state.budgetProfile, ...state.working.contextBudgetProfiles]
  }
}

export function runBuildContextStep(ctx: PipelineStepHandlerContext) {
  const { env, state, job, step, options, snapshot, activeStoryDirectionGuide, storyDirectionTracePatch } = ctx
  const { project } = env
  let promptBlockOrder: PromptBlockOrderItem[] = []
  let hardCanonTrace = { itemCount: 0, tokenEstimate: 0, includedItemIds: [] as ID[], truncatedItemIds: [] as ID[] }
  if (job.contextSource === 'prompt_snapshot') {
    if (!snapshot) throw new Error('Prompt 上下文快照已丢失，请重新构建上下文。')
    state.context = snapshot.finalPrompt
    promptBlockOrder = inferPromptBlockOrderFromPrompt(state.context, 'prompt_context_snapshot')
  } else {
    if (!state.budgetSelection) {
      state.budgetSelection = selectBudgetContext(project, state.working, options.targetChapterOrder, state.budgetProfile, {
        chapterTask: pipelineChapterTask(project, options, activeStoryDirectionGuide),
        contextNeedPlan: state.contextNeedPlan
      })
    }
    const promptResult = buildPipelineContextResultFromSelection(
      project,
      state.working,
      options.targetChapterOrder,
      options.readerEmotionTarget,
      options.estimatedWordCount,
      state.budgetProfile,
      state.budgetSelection,
      state.contextNeedPlan,
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
        reason: '快照或旧 prompt 缺少上一章衔接时，由流水线作为 forced context 追加。'
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
  state.working = env.updateStepInData(state.working, step.id, {
    status: 'completed',
    output:
      job.contextSource === 'prompt_snapshot' && snapshot
        ? serializeOutput({
            ...summarizeSnapshot(snapshot),
            finalPrompt: state.context,
            targetMismatch: snapshot.targetChapterOrder !== options.targetChapterOrder,
            continuityBridgeId: continuityResult.bridge?.id ?? null,
            continuitySource: continuityResult.source,
            continuityWarnings: continuityResult.warnings
          })
        : state.context
  })
  const selectedCharacterIds = snapshot ? snapshot.selectedCharacterIds : state.budgetSelection?.selectedCharacterIds ?? []
  const selectedForeshadowingIds = snapshot ? snapshot.selectedForeshadowingIds : state.budgetSelection?.selectedForeshadowingIds ?? []
  const selectedTimelineEventIds = snapshot ? snapshot.contextSelectionResult.selectedTimelineEventIds : state.budgetSelection?.selectedTimelineEventIds ?? []
  const treatmentOverrides = snapshot?.foreshadowingTreatmentOverrides ?? {}
  const includedCharacterStateFacts = CharacterStateService.getRelevantCharacterStatesForPrompt(
    selectedCharacterIds,
    state.contextNeedPlan,
    options.targetChapterOrder,
    state.working.characterStateFacts.filter((fact) => fact.projectId === project.id)
  )
  const contextSelectionTrace = enrichContextSelectionTrace(
    snapshot?.contextSelectionResult.contextSelectionTrace ?? state.budgetSelection?.contextSelectionTrace,
    {
      jobId: job.id,
      contextNeedPlan: state.contextNeedPlan,
      includedCharacterStateFacts,
      hardCanonTrace,
      finalPromptTokenEstimate
    }
  )
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
    contextNeedPlanId: state.contextNeedPlan?.id ?? null,
    requiredCharacterCardFields: state.contextNeedPlan?.requiredCharacterCardFields ?? {},
    requiredStateFactCategories: state.contextNeedPlan?.requiredStateFactCategories ?? {},
    contextNeedPlanWarnings: state.contextNeedPlan?.warnings ?? [],
    contextNeedPlanMatchedItems: [
      ...(state.contextNeedPlan?.expectedCharacters.map((item) => item.characterId) ?? []),
      ...(state.contextNeedPlan?.requiredForeshadowingIds ?? []),
      ...(state.contextNeedPlan?.requiredTimelineEventIds ?? [])
    ],
    contextNeedPlanOmittedItems: (state.budgetSelection?.omittedItems ?? []).filter((item) =>
      state.contextNeedPlan
        ? state.contextNeedPlan.expectedCharacters.some((character) => character.characterId === item.id) ||
          state.contextNeedPlan.requiredForeshadowingIds.includes(item.id ?? '') ||
          state.contextNeedPlan.requiredTimelineEventIds.includes(item.id ?? '')
        : false
    ),
    includedCharacterStateFactIds: includedCharacterStateFacts.map((fact) => fact.id),
    characterStateWarnings: includedCharacterStateFacts.length
      ? []
      : state.contextNeedPlan
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

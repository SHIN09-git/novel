import type {
  ContextBudgetProfile,
  ContextDecisionReasonCode,
  ContextExclusionRule,
  ContextNeedItem,
  ContextNeedPlan,
  ContextSelectionResult,
  ID
} from '../../shared/types'
import { effectiveTreatmentMode, isForeshadowingAvailableAtChapter, treatmentAllowsDefaultPrompt } from '../../shared/foreshadowingTreatment'
import { compressChapterRecapsForBudget, createDroppedChapterCompressionRecord } from '../ContextCompressionService'
import type { ForcedContextSelection, ProjectContextData, ScoringContext } from './types'
import {
  MAX_PROMPT_FORESHADOWINGS,
  byId,
  evaluateChapter,
  evaluateCharacter,
  evaluateForeshadowing,
  evaluateStageSummary,
  evaluateTimelineEvent,
  foreshadowingOmitReason,
  foreshadowingPriority,
  isForeshadowingForbidden,
  itemCost,
  stringifyCharacter,
  stringifyChapter,
  stringifyForeshadowing,
  stringifyStageSummary,
  stringifyTimelineEvent
} from './scoringEngine'
import { omit, removeOne, selectionCost } from './selectionEngine'
import { buildContextSelectionTrace } from './traceBuilder'

interface FinalizeContextSelectionArgs {
  data: ProjectContextData
  targetChapterOrder: number
  budgetProfile: ContextBudgetProfile
  forcedSelection: ForcedContextSelection
  selection: ContextSelectionResult
  scoringContext: ScoringContext
  rankedForeshadowingIds: ID[]
}

function contextNeedForItem(plan: ContextNeedPlan | null | undefined, type: string, id: ID | null): ContextNeedItem | null {
  if (!plan) return null
  const candidates = plan.contextNeeds.filter((need) => {
    if (id && need.sourceId && need.sourceId !== id) return false
    if (type === 'character') return need.sourceHint === 'character' || need.needType === 'character_card'
    if (type === 'foreshadowing') return need.sourceHint === 'foreshadowing'
    if (type === 'timelineEvent') return need.sourceHint === 'timeline'
    if (type === 'stageSummary') return need.sourceHint === 'stageSummary'
    if (type === 'chapter') return need.sourceHint === 'recentChapter' || need.sourceHint === 'chapterEnding'
    if (type === 'storyBible') return need.sourceHint === 'worldbuilding'
    return need.needType === type
  })
  return candidates.sort((a, b) => {
    const rank = { must: 4, high: 3, medium: 2, low: 1 }
    const certaintyDelta = Number(a.uncertain) - Number(b.uncertain)
    if (certaintyDelta !== 0) return certaintyDelta
    return rank[b.priority] - rank[a.priority]
  })[0] ?? null
}

function omissionOptions(
  plan: ContextNeedPlan | null | undefined,
  type: string,
  id: ID | null,
  reasonCode: ContextDecisionReasonCode,
  replacementSourceId: ID | null = null
) {
  const need = contextNeedForItem(plan, type, id)
  return {
    reasonCode,
    priority: need?.priority ?? 'low',
    uncertain: need?.uncertain ?? false,
    replacementSourceId
  } as const
}

function exclusionReasonCode(rule: ContextExclusionRule | undefined): ContextDecisionReasonCode {
  return rule?.source === 'user' ? 'manual_exclusion' : 'forbidden'
}

export function finalizeContextSelection({
  data,
  targetChapterOrder,
  budgetProfile,
  forcedSelection,
  selection,
  scoringContext,
  rankedForeshadowingIds
}: FinalizeContextSelectionArgs): ContextSelectionResult {
  const previousChapters = data.chapters
    .filter((chapter) => chapter.order < targetChapterOrder)
    .sort((a, b) => a.order - b.order)
  const stageSummaryCandidates = data.stageSummaries
    .filter((summary) => summary.chapterEnd < targetChapterOrder)
    .sort((a, b) => a.chapterEnd - b.chapterEnd)
  const selectedStageSummaries = byId(data.stageSummaries, selection.selectedStageSummaryIds)
  const exclusionRules = forcedSelection.contextNeedPlan?.exclusionRules ?? []
  const exclusionRuleByKey = new Map(exclusionRules.map((rule) => [`${rule.type}:${rule.id}`, rule]))
  const excludedCharacterIds = scoringContext.excludedCharacterIds
  const planRequiredForeshadowingIds = scoringContext.planRequiredForeshadowingIds
  const foreshadowingLimitOmittedIds = new Set(rankedForeshadowingIds.slice(MAX_PROMPT_FORESHADOWINGS))

  if (rankedForeshadowingIds.length > MAX_PROMPT_FORESHADOWINGS) {
    selection.warnings.push(`本章伏笔推进已限制为 ${MAX_PROMPT_FORESHADOWINGS} 条，其余伏笔按权重和相关性省略。`)
  }
  const earlyManualForeshadowings = byId(data.foreshadowings, selection.selectedForeshadowingIds)
    .filter((item) => scoringContext.manualForeshadowingIds.has(item.id) && !isForeshadowingAvailableAtChapter(item, targetChapterOrder))
  if (earlyManualForeshadowings.length > 0) selection.warnings.push(`已手动强选尚未到首次出现章节的伏笔：${earlyManualForeshadowings.map((item) => `《${item.title}》（第 ${item.firstChapterOrder} 章）`).join('、')}。本次保留并标记为手动强选。`)
  const earlyPlanForeshadowings = byId(data.foreshadowings, [...planRequiredForeshadowingIds])
    .filter((item) => !scoringContext.manualForeshadowingIds.has(item.id) && !isForeshadowingAvailableAtChapter(item, targetChapterOrder))
  if (earlyPlanForeshadowings.length > 0) selection.warnings.push(`需求计划要求了尚未到首次出现章节的伏笔：${earlyPlanForeshadowings.map((item) => `《${item.title}》（第 ${item.firstChapterOrder} 章）`).join('、')}。已按章节门禁省略。`)

  for (const chapter of previousChapters.filter((chapter) => !selection.selectedChapterIds.includes(chapter.id))) {
    const replacementSummary = selectedStageSummaries.find(
      (summary) => summary.chapterStart <= chapter.order && summary.chapterEnd >= chapter.order
    )
    omit(
      selection,
      'chapter',
      chapter.id,
      replacementSummary
        ? `旧章节详细回顾由第 ${replacementSummary.chapterStart}-${replacementSummary.chapterEnd} 章阶段摘要替代。`
        : '本章相关性低于已选近期章节，省略详细回顾。',
      itemCost(stringifyChapter(chapter)),
      omissionOptions(
        forcedSelection.contextNeedPlan,
        'chapter',
        chapter.id,
        replacementSummary ? 'compressed_replacement' : 'low_relevance',
        replacementSummary?.id ?? null
      )
    )
  }
  for (const summary of stageSummaryCandidates.filter((item) => !selection.selectedStageSummaryIds.includes(item.id))) {
    omit(
      selection,
      'stageSummary',
      summary.id,
      budgetProfile.includeStageSummariesCount === 0
        ? '当前预算配置未启用远期阶段摘要。'
        : '相关性低于已选远期阶段摘要。',
      itemCost(stringifyStageSummary(summary)),
      omissionOptions(
        forcedSelection.contextNeedPlan,
        'stageSummary',
        summary.id,
        budgetProfile.includeStageSummariesCount === 0 ? 'profile_filter' : 'low_relevance'
      )
    )
  }
  for (const characterId of excludedCharacterIds) {
    if (selection.selectedCharacterIds.includes(characterId)) continue
    const character = data.characters.find((item) => item.id === characterId)
    if (!character) continue
    const rule = exclusionRuleByKey.get(`character:${characterId}`)
    omit(
      selection,
      'character',
      characterId,
      rule?.reason || '上下文需求计划排除了该角色。',
      itemCost(stringifyCharacter(character)),
      omissionOptions(forcedSelection.contextNeedPlan, 'character', characterId, exclusionReasonCode(rule))
    )
  }
  for (const item of data.foreshadowings.filter((item) => !selection.selectedForeshadowingIds.includes(item.id))) {
    const rule = exclusionRuleByKey.get(`foreshadowing:${item.id}`)
    const treatmentMode = effectiveTreatmentMode(item, forcedSelection.foreshadowingTreatmentOverrides)
    const availableAtTarget = isForeshadowingAvailableAtChapter(item, targetChapterOrder)
    const reasonCode: ContextDecisionReasonCode = rule
      ? exclusionReasonCode(rule)
      : !availableAtTarget
        ? 'not_available'
        : foreshadowingLimitOmittedIds.has(item.id)
        ? 'prompt_limit'
        : item.status === 'resolved' || item.status === 'abandoned'
          ? 'status_ineligible'
          : isForeshadowingForbidden(item, forcedSelection.chapterTask) || !treatmentAllowsDefaultPrompt(treatmentMode)
            ? 'forbidden'
            : !budgetProfile.includeForeshadowingWeights.includes(item.weight)
              ? 'profile_filter'
              : 'low_relevance'
    const reason = !availableAtTarget
      ? `该伏笔首次出现设为第 ${item.firstChapterOrder} 章，当前目标为第 ${targetChapterOrder} 章；仅手动强选可以提前纳入。`
      : foreshadowingLimitOmittedIds.has(item.id)
        ? `本章 Prompt 最多推进 ${MAX_PROMPT_FORESHADOWINGS} 条伏笔，已按权重和本章相关性排序后省略。`
        : foreshadowingOmitReason(item, budgetProfile, scoringContext)
    omit(
      selection,
      'foreshadowing',
      item.id,
      rule?.reason || reason,
      itemCost(stringifyForeshadowing(item)),
      omissionOptions(forcedSelection.contextNeedPlan, 'foreshadowing', item.id, reasonCode)
    )
  }
  for (const event of data.timelineEvents.filter(
    (item) => (item.chapterOrder === null || item.chapterOrder < targetChapterOrder) && !selection.selectedTimelineEventIds.includes(item.id)
  )) {
    omit(
      selection,
      'timelineEvent',
      event.id,
      budgetProfile.includeTimelineEventsCount === 0
        ? '当前预算配置未启用时间线事件。'
        : '相关性低于已选时间线锚点。',
      itemCost(stringifyTimelineEvent(event)),
      omissionOptions(
        forcedSelection.contextNeedPlan,
        'timelineEvent',
        event.id,
        budgetProfile.includeTimelineEventsCount === 0 ? 'profile_filter' : 'low_relevance'
      )
    )
  }

  const recalc = () => {
    selection.estimatedTokens = selectionCost(data, selection, budgetProfile.styleSampleMaxChars, forcedSelection.contextNeedPlan)
  }
  recalc()
  if (data.bible && data.bible.styleSample.length > budgetProfile.styleSampleMaxChars) {
    selection.warnings.push(`文风样例已截断到 ${budgetProfile.styleSampleMaxChars} 字。`)
    omit(
      selection,
      'storyBible',
      null,
      '文风样例超过配置上限，已截断为短表达滤镜。',
      itemCost(data.bible.styleSample.slice(budgetProfile.styleSampleMaxChars)),
      omissionOptions(forcedSelection.contextNeedPlan, 'storyBible', null, 'compressed_replacement')
    )
  }

  selection = compressChapterRecapsForBudget({
    chapters: data.chapters,
    stageSummaries: data.stageSummaries,
    selection,
    targetChapterOrder,
    budgetProfile,
    estimateSelectionTokens: (nextSelection) => selectionCost(
      data,
      nextSelection,
      budgetProfile.styleSampleMaxChars,
      forcedSelection.contextNeedPlan
    )
  })
  recalc()

  while (selection.estimatedTokens > budgetProfile.maxTokens && selection.selectedChapterIds.length > 1) {
    const removable = byId(data.chapters, selection.selectedChapterIds)
      .sort((a, b) => evaluateChapter(a, scoringContext) - evaluateChapter(b, scoringContext))[0]
    selection.compressionRecords = [
      createDroppedChapterCompressionRecord(removable, '超出预算，低相关章节详细回顾被裁掉。'),
      ...selection.compressionRecords.filter((record) => record.originalChapterId !== removable.id)
    ]
    removeOne(selection, 'selectedChapterIds', removable.id)
    omit(
      selection,
      'chapter',
      removable.id,
      '超出预算，优先省略低相关章节详细回顾。',
      itemCost(stringifyChapter(removable)),
      omissionOptions(forcedSelection.contextNeedPlan, 'chapter', removable.id, 'budget_exceeded')
    )
    recalc()
  }

  while (selection.estimatedTokens > budgetProfile.maxTokens && selection.selectedStageSummaryIds.length > 1) {
    const lowSummary = byId(data.stageSummaries, selection.selectedStageSummaryIds)
      .sort((a, b) => evaluateStageSummary(a, scoringContext) - evaluateStageSummary(b, scoringContext))[0]
    removeOne(selection, 'selectedStageSummaryIds', lowSummary.id)
    omit(
      selection,
      'stageSummary',
      lowSummary.id,
      'token 预算不足，优先省略低相关远期阶段摘要，保护本章角色状态、伏笔和硬设定。',
      itemCost(stringifyStageSummary(lowSummary)),
      omissionOptions(forcedSelection.contextNeedPlan, 'stageSummary', lowSummary.id, 'budget_exceeded')
    )
    recalc()
  }

  while (selection.estimatedTokens > budgetProfile.maxTokens) {
    const low = byId(data.foreshadowings, selection.selectedForeshadowingIds)
      .filter((item) => !scoringContext.forcedForeshadowingIds.has(item.id) && !planRequiredForeshadowingIds.has(item.id))
      .sort((a, b) => {
        const scoreDelta = evaluateForeshadowing(a, scoringContext) - evaluateForeshadowing(b, scoringContext)
        if (scoreDelta !== 0) return scoreDelta
        return foreshadowingPriority(a, forcedSelection.foreshadowingTreatmentOverrides) - foreshadowingPriority(b, forcedSelection.foreshadowingTreatmentOverrides)
      })[0]
    if (!low) break
    removeOne(selection, 'selectedForeshadowingIds', low.id)
    omit(
      selection,
      'foreshadowing',
      low.id,
      'token 预算不足，低于本章任务相关性优先级。',
      itemCost(stringifyForeshadowing(low)),
      omissionOptions(forcedSelection.contextNeedPlan, 'foreshadowing', low.id, 'budget_exceeded')
    )
    recalc()
  }

  while (selection.estimatedTokens > budgetProfile.maxTokens) {
    const nonMain = byId(data.characters, selection.selectedCharacterIds)
      .filter((character) => !scoringContext.forcedCharacterIds.has(character.id) && (!character.isMain || Boolean(forcedSelection.contextNeedPlan)))
      .sort((a, b) => evaluateCharacter(a, scoringContext) - evaluateCharacter(b, scoringContext))[0]
    if (!nonMain) break
    removeOne(selection, 'selectedCharacterIds', nonMain.id)
    omit(
      selection,
      'character',
      nonMain.id,
      '超出预算，省略未被确认必须在场的低相关角色。',
      itemCost(stringifyCharacter(nonMain)),
      omissionOptions(forcedSelection.contextNeedPlan, 'character', nonMain.id, 'budget_exceeded')
    )
    recalc()
  }

  while (selection.estimatedTokens > budgetProfile.maxTokens && selection.selectedTimelineEventIds.length > 0) {
    const lowEvent = byId(data.timelineEvents, selection.selectedTimelineEventIds)
      .filter((event) => !(forcedSelection.contextNeedPlan?.requiredTimelineEventIds ?? []).includes(event.id))
      .sort((a, b) => evaluateTimelineEvent(a, scoringContext) - evaluateTimelineEvent(b, scoringContext))[0]
    if (!lowEvent) break
    removeOne(selection, 'selectedTimelineEventIds', lowEvent.id)
    omit(
      selection,
      'timelineEvent',
      lowEvent.id,
      '超出预算，省略低相关时间线事件。',
      itemCost(stringifyTimelineEvent(lowEvent)),
      omissionOptions(forcedSelection.contextNeedPlan, 'timelineEvent', lowEvent.id, 'budget_exceeded')
    )
    recalc()
  }

  if (selection.estimatedTokens > budgetProfile.maxTokens) {
    selection.warnings.push(`当前上下文约 ${selection.estimatedTokens} token，超过预算 ${budgetProfile.maxTokens}。建议切换更高预算或手动关闭模块。`)
  }
  if (selection.selectedChapterIds.length === 0 && previousChapters.length > 0) {
    selection.warnings.push('预算过低，最近或高相关章节详细回顾可能不足。')
  }
  if (selection.selectedForeshadowingIds.length === 0 && rankedForeshadowingIds.length > 0) {
    selection.warnings.push('伏笔已被预算压缩，本章可能需要人工检查伏笔连续性。')
  }

  selection.contextSelectionTrace = buildContextSelectionTrace(data, targetChapterOrder, budgetProfile, selection, scoringContext)
  return selection
}

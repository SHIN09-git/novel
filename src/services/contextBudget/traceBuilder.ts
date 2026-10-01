import type {
  Chapter,
  ChapterTask,
  CharacterCardField,
  Character,
  ContextBudgetProfile,
  ContextDecisionReasonCode,
  ContextNeedItem,
  ContextNeedPriority,
  ContextNeedPlan,
  ContextSelectionResult,
  ContextSelectionTrace,
  ContextSelectionTraceBlock,
  ContextSelectionTraceDroppedBlock,
  ContextSelectionTraceUnmetNeed,
  Foreshadowing,
  ForeshadowingTreatmentMode,
  ForeshadowingWeight,
  ID,
  Project,
  StageSummary,
  StoryBible,
  TimelineEvent
} from '../../shared/types'

import type { ProjectContextData, ScoringContext } from './types'
import {
  byId,
  evaluateChapter,
  evaluateCharacter,
  evaluateForeshadowing,
  evaluateStageSummary,
  evaluateTimelineEvent,
  itemCost,
  planPriority,
  stringifyChapter,
  stringifyCharacter,
  stringifyCharacterForPlan,
  stringifyForeshadowing,
  stringifyStageSummary,
  stringifyTimelineEvent
} from './scoringEngine'

function priorityRank(priority: ContextNeedPriority): number {
  if (priority === 'must') return 4
  if (priority === 'high') return 3
  if (priority === 'medium') return 2
  return 1
}

function scoreToPriority(score: number): ContextNeedPriority {
  if (score >= 88) return 'must'
  if (score >= 70) return 'high'
  if (score >= 45) return 'medium'
  return 'low'
}

function strongestPriority(needs: ContextNeedItem[], fallback: ContextNeedPriority): ContextNeedPriority {
  return bestMatchingNeed(needs)?.priority ?? fallback
}

function bestMatchingNeed(needs: ContextNeedItem[]): ContextNeedItem | undefined {
  return [...needs].sort((a, b) => {
    const aRank = priorityRank(a.priority) * 10 - (a.uncertain ? 15 : 0)
    const bRank = priorityRank(b.priority) * 10 - (b.uncertain ? 15 : 0)
    return bRank - aRank
  })[0]
}

function matchingNeeds(context: ScoringContext, blockType: string, sourceId?: ID | null): ContextNeedItem[] {
  const needs = context.contextNeedPlan?.contextNeeds ?? []
  return needs.filter((need) => {
    if (sourceId && need.sourceId && need.sourceId !== sourceId) return false
    if (blockType === 'character') return need.sourceHint === 'character' || need.needType === 'character_card'
    if (blockType === 'character_state') return need.sourceHint === 'character_state' || need.needType.includes('character_state')
    if (blockType === 'foreshadowing') return need.sourceHint === 'foreshadowing' || need.needType.includes('foreshadowing')
    if (blockType === 'timelineEvent') return need.sourceHint === 'timeline' || need.needType.includes('timeline')
    if (blockType === 'stageSummary') return need.sourceHint === 'stageSummary'
    if (blockType === 'chapter') return need.sourceHint === 'recentChapter' || need.sourceHint === 'chapterEnding'
    if (blockType === 'storyBible') return need.sourceHint === 'worldbuilding'
    if (blockType === 'hard_canon' || blockType === 'hardCanon') return need.sourceHint === 'hardCanon'
    if (blockType === 'story_direction' || blockType === 'storyDirection') return need.sourceHint === 'storyDirection'
    return need.needType === blockType
  })
}

function reasonWithNeed(context: ScoringContext, blockType: string, sourceId: ID | null, fallbackReason: string): string {
  const need = bestMatchingNeed(matchingNeeds(context, blockType, sourceId))
  return need?.reason ? `${fallbackReason} 需求理由：${need.reason}` : fallbackReason
}

function selectedReasonCode(
  context: ScoringContext,
  blockType: string,
  sourceId: ID | null,
  need: ContextNeedItem | undefined,
  compressed: boolean
): ContextDecisionReasonCode {
  if (context.selectionMode === 'prompt_snapshot') return 'snapshot_locked'
  if (compressed) return 'compressed_replacement'
  if (sourceId && blockType === 'character' && context.manualCharacterIds.has(sourceId)) return 'manual_selection'
  if (sourceId && blockType === 'foreshadowing' && context.manualForeshadowingIds.has(sourceId)) return 'manual_selection'
  if (need) return 'required_need'
  if (blockType === 'chapter') return 'recency'
  if (blockType === 'character' && sourceId && context.relatedCharacterIds.has(sourceId)) return 'related_context'
  if (blockType === 'stageSummary' || blockType === 'storyBible') return 'profile_default'
  return 'task_relevance'
}

function isForcedBlock(context: ScoringContext, blockType: string, sourceId: ID | null): boolean {
  if (!sourceId) return false
  if (blockType === 'character') return context.forcedCharacterIds.has(sourceId)
  if (blockType === 'foreshadowing') return context.forcedForeshadowingIds.has(sourceId)
  if (blockType === 'timelineEvent') return Boolean(context.contextNeedPlan?.requiredTimelineEventIds.includes(sourceId))
  return false
}

function blockPriority(context: ScoringContext, blockType: string, sourceId: ID | null, fallbackScore = 0): ContextNeedPriority {
  const needs = matchingNeeds(context, blockType, sourceId)
  if (needs.length > 0) return strongestPriority(needs, 'low')
  if (blockType === 'chapter') return sourceId ? scoreToPriority(fallbackScore) : 'medium'
  if (blockType === 'stageSummary') return 'low'
  if (blockType === 'storyBible') return 'medium'
  return scoreToPriority(fallbackScore)
}

function needSatisfied(need: ContextNeedItem, selection: ContextSelectionResult): boolean {
  if (!need.sourceId) {
    if (need.sourceHint === 'chapterEnding' || need.sourceHint === 'recentChapter') return selection.selectedChapterIds.length > 0
    if (need.sourceHint === 'worldbuilding') return selection.selectedStoryBibleFields.length > 0
    if (need.sourceHint === 'hardCanon' || need.sourceHint === 'storyDirection' || need.sourceHint === 'character_state') return false
    return false
  }
  if (need.sourceHint === 'character') return selection.selectedCharacterIds.includes(need.sourceId)
  if (need.sourceHint === 'character_state') return false
  if (need.sourceHint === 'foreshadowing') return selection.selectedForeshadowingIds.includes(need.sourceId)
  if (need.sourceHint === 'timeline') return selection.selectedTimelineEventIds.includes(need.sourceId)
  if (need.sourceHint === 'stageSummary') return selection.selectedStageSummaryIds.includes(need.sourceId)
  if (need.sourceHint === 'recentChapter' || need.sourceHint === 'chapterEnding') return selection.selectedChapterIds.includes(need.sourceId)
  if (need.sourceHint === 'worldbuilding') return selection.selectedStoryBibleFields.length > 0
  if (need.sourceHint === 'hardCanon' || need.sourceHint === 'storyDirection') return false
  return false
}

function sourceExists(need: ContextNeedItem, data: ProjectContextData): boolean {
  if (!need.sourceId) return true
  if (need.sourceHint === 'character' || need.sourceHint === 'character_state') return data.characters.some((item) => item.id === need.sourceId)
  if (need.sourceHint === 'foreshadowing') return data.foreshadowings.some((item) => item.id === need.sourceId)
  if (need.sourceHint === 'timeline') return data.timelineEvents.some((item) => item.id === need.sourceId)
  if (need.sourceHint === 'stageSummary') return data.stageSummaries.some((item) => item.id === need.sourceId)
  if (need.sourceHint === 'recentChapter' || need.sourceHint === 'chapterEnding') return data.chapters.some((item) => item.id === need.sourceId)
  return true
}

function omittedItemForNeed(need: ContextNeedItem, selection: ContextSelectionResult) {
  const expectedTypes =
    need.sourceHint === 'timeline'
      ? ['timelineEvent', 'timeline']
      : need.sourceHint === 'stageSummary'
        ? ['stageSummary']
        : need.sourceHint === 'recentChapter' || need.sourceHint === 'chapterEnding'
          ? ['chapter']
          : need.sourceHint === 'character' || need.sourceHint === 'character_state'
            ? ['character']
            : [need.sourceHint]
  return selection.omittedItems.find(
    (item) => expectedTypes.includes(item.type) && (!need.sourceId || item.id === need.sourceId)
  )
}

function budgetPressure(estimatedTokens: number, budgetProfile: ContextBudgetProfile, omittedCount: number): 'low' | 'medium' | 'high' {
  if (estimatedTokens >= budgetProfile.maxTokens * 0.9 || omittedCount >= 12) return 'high'
  if (estimatedTokens >= budgetProfile.maxTokens * 0.7 || omittedCount >= 4) return 'medium'
  return 'low'
}

export function buildContextSelectionTrace(
  data: ProjectContextData,
  targetChapterOrder: number,
  budgetProfile: ContextBudgetProfile,
  selection: ContextSelectionResult,
  context: ScoringContext
): ContextSelectionTrace {
  const targetChapter = data.chapters.find((chapter) => chapter.order === targetChapterOrder)
  const selectedBlocks: ContextSelectionTraceBlock[] = []
  const addSelected = (
    blockType: string,
    sourceId: ID | null,
    tokenEstimate: number,
    reason: string,
    fallbackScore = 0,
    compression: { compressed: boolean; replacementSourceId?: ID | null } = { compressed: false }
  ) => {
    const need = bestMatchingNeed(matchingNeeds(context, blockType, sourceId))
    selectedBlocks.push({
      blockType,
      sourceId,
      priority: blockPriority(context, blockType, sourceId, fallbackScore),
      uncertain: need?.uncertain ?? false,
      reasonCode: selectedReasonCode(context, blockType, sourceId, need, compression.compressed),
      forced: isForcedBlock(context, blockType, sourceId),
      compressed: compression.compressed,
      replacementSourceId: compression.replacementSourceId ?? null,
      tokenEstimate,
      reason: reasonWithNeed(context, blockType, sourceId, reason)
    })
  }

  if (selection.selectedStoryBibleFields.length > 0) {
    addSelected('storyBible', null, Math.min(selection.estimatedTokens, 800), '最小硬设定和项目级基础资料进入上下文。', 55)
  }
  for (const chapter of byId(data.chapters, selection.selectedChapterIds)) {
    const compression = selection.compressionRecords.find((record) => record.originalChapterId === chapter.id)
    if (compression && compression.replacementKind !== 'dropped') {
      addSelected(
        'chapter',
        chapter.id,
        compression.replacementTokenEstimate,
        `第 ${chapter.order} 章详细回顾已由${compression.replacementKind === 'stage_summary' ? '阶段摘要' : '短摘要'}替代。`,
        evaluateChapter(chapter, context),
        { compressed: true, replacementSourceId: compression.replacementSourceId ?? null }
      )
    } else {
      addSelected('chapter', chapter.id, itemCost(stringifyChapter(chapter)), `第 ${chapter.order} 章近期事实进入上下文。`, evaluateChapter(chapter, context))
    }
  }
  for (const summary of byId(data.stageSummaries, selection.selectedStageSummaryIds)) {
    addSelected('stageSummary', summary.id, itemCost(stringifyStageSummary(summary)), `第 ${summary.chapterStart}-${summary.chapterEnd} 章阶段摘要进入远期背景。`, evaluateStageSummary(summary, context))
  }
  for (const character of byId(data.characters, selection.selectedCharacterIds)) {
    addSelected('character', character.id, itemCost(stringifyCharacterForPlan(character, context.contextNeedPlan)), `角色 ${character.name} 的本章切片进入上下文。`, evaluateCharacter(character, context))
  }
  for (const item of byId(data.foreshadowings, selection.selectedForeshadowingIds)) {
    addSelected('foreshadowing', item.id, itemCost(stringifyForeshadowing(item, context.foreshadowingTreatmentOverrides)), `伏笔《${item.title}》进入本章操作规则。`, evaluateForeshadowing(item, context))
  }
  for (const event of byId(data.timelineEvents, selection.selectedTimelineEventIds)) {
    addSelected('timelineEvent', event.id, itemCost(stringifyTimelineEvent(event)), `时间线事件《${event.title}》进入上下文。`, evaluateTimelineEvent(event, context))
  }

  const droppedBlocks: ContextSelectionTraceDroppedBlock[] = selection.omittedItems.map((item) => {
    const need = bestMatchingNeed(matchingNeeds(context, item.type, item.id))
    item.priority = need?.priority ?? item.priority
    item.uncertain = need?.uncertain ?? item.uncertain
    return {
      blockType: item.type,
      sourceId: item.id,
      priority: item.priority,
      uncertain: item.uncertain,
      reasonCode: item.reasonCode,
      forced: isForcedBlock(context, item.type, item.id),
      compressed: item.reasonCode === 'compressed_replacement',
      replacementSourceId: item.replacementSourceId ?? null,
      tokenEstimate: item.estimatedTokensSaved,
      dropReason: need?.reason ? `${item.reason} 未满足需求：${need.reason}` : item.reason
    }
  })

  const unmetNeeds: ContextSelectionTraceUnmetNeed[] = (context.contextNeedPlan?.contextNeeds ?? [])
    .filter((need) => !needSatisfied(need, selection))
    .filter((need) => priorityRank(need.priority) >= priorityRank(need.uncertain ? 'medium' : 'high'))
    .map((need) => {
      const omitted = omittedItemForNeed(need, selection)
      return {
        needType: need.needType,
        priority: need.priority,
        uncertain: need.uncertain,
        reasonCode:
          context.selectionMode === 'prompt_snapshot'
            ? 'snapshot_locked'
            : !sourceExists(need, data)
              ? 'missing_source'
              : omitted?.reasonCode ?? 'not_available',
        reason: need.reason,
        sourceId: need.sourceId ?? null
      }
    })

  return {
    projectId: data.project.id,
    chapterId: targetChapter?.id ?? null,
    selectionMode: context.selectionMode,
    selectedBlocks,
    droppedBlocks,
    unmetNeeds,
    budgetSummary: {
      totalBudget: budgetProfile.maxTokens,
      usedTokens: selection.estimatedTokens,
      reservedTokens: Math.max(0, budgetProfile.maxTokens - selection.estimatedTokens),
      pressure: budgetPressure(selection.estimatedTokens, budgetProfile, selection.omittedItems.length)
    }
  }
}

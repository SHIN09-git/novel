import type {
  Chapter,
  ChapterTask,
  CharacterCardField,
  Character,
  ContextBudgetProfile,
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
  return needs.reduce((best, need) => (priorityRank(need.priority) > priorityRank(best) ? need.priority : best), fallback)
}

function matchingNeeds(context: ScoringContext, blockType: string, sourceId?: ID | null): ContextNeedItem[] {
  const needs = context.contextNeedPlan?.contextNeeds ?? []
  return needs.filter((need) => {
    if (sourceId && need.sourceId && need.sourceId !== sourceId) return false
    if (blockType === 'character') return need.sourceHint === 'character' || need.sourceHint === 'character_state' || need.needType.includes('character')
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
  const need = matchingNeeds(context, blockType, sourceId)[0]
  return need?.reason ? `${fallbackReason} 需求理由：${need.reason}` : fallbackReason
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
    if (need.sourceHint === 'hardCanon' || need.sourceHint === 'storyDirection') return true
    return false
  }
  if (need.sourceHint === 'character' || need.sourceHint === 'character_state') return selection.selectedCharacterIds.includes(need.sourceId)
  if (need.sourceHint === 'foreshadowing') return selection.selectedForeshadowingIds.includes(need.sourceId)
  if (need.sourceHint === 'timeline') return selection.selectedTimelineEventIds.includes(need.sourceId)
  if (need.sourceHint === 'stageSummary') return selection.selectedStageSummaryIds.includes(need.sourceId)
  if (need.sourceHint === 'recentChapter' || need.sourceHint === 'chapterEnding') return selection.selectedChapterIds.includes(need.sourceId)
  if (need.sourceHint === 'worldbuilding') return selection.selectedStoryBibleFields.length > 0
  if (need.sourceHint === 'hardCanon' || need.sourceHint === 'storyDirection') return true
  return false
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
  const addSelected = (blockType: string, sourceId: ID | null, tokenEstimate: number, reason: string, fallbackScore = 0) => {
    selectedBlocks.push({
      blockType,
      sourceId,
      priority: blockPriority(context, blockType, sourceId, fallbackScore),
      tokenEstimate,
      reason: reasonWithNeed(context, blockType, sourceId, reason)
    })
  }

  if (selection.selectedStoryBibleFields.length > 0) {
    addSelected('storyBible', null, Math.min(selection.estimatedTokens, 800), '最小硬设定和项目级基础资料进入上下文。', 55)
  }
  for (const chapter of byId(data.chapters, selection.selectedChapterIds)) {
    addSelected('chapter', chapter.id, itemCost(stringifyChapter(chapter)), `第 ${chapter.order} 章近期事实进入上下文。`, evaluateChapter(chapter, context))
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
    const need = matchingNeeds(context, item.type, item.id)[0]
    return {
      blockType: item.type,
      sourceId: item.id,
      priority: blockPriority(context, item.type, item.id, 0),
      tokenEstimate: item.estimatedTokensSaved,
      dropReason: need?.reason ? `${item.reason} 未满足需求：${need.reason}` : item.reason
    }
  })

  const unmetNeeds: ContextSelectionTraceUnmetNeed[] = (context.contextNeedPlan?.contextNeeds ?? [])
    .filter((need) => priorityRank(need.priority) >= priorityRank('high'))
    .filter((need) => !needSatisfied(need, selection))
    .map((need) => ({
      needType: need.needType,
      priority: need.priority,
      reason: need.reason,
      sourceId: need.sourceId ?? null
    }))

  return {
    projectId: data.project.id,
    chapterId: targetChapter?.id ?? null,
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

import type {
  Chapter,
  Character,
  ContextBudgetProfile,
  ContextSelectionResult,
  Foreshadowing,
  ForeshadowingWeight,
  ID,
  Project,
  StageSummary,
  StoryBible,
  TimelineEvent
} from '../shared/types'
import {
  effectiveTreatmentMode,
  TREATMENT_PRIORITY,
  treatmentAllowsDefaultPrompt,
  treatmentOmitReason
} from '../shared/foreshadowingTreatment'
import { TokenEstimator } from './TokenEstimator'

interface ProjectContextData {
  project: Project
  bible: StoryBible | null
  chapters: Chapter[]
  characters: Character[]
  foreshadowings: Foreshadowing[]
  timelineEvents: TimelineEvent[]
  stageSummaries: StageSummary[]
}

const WEIGHT_PRIORITY: Record<ForeshadowingWeight, number> = {
  payoff: 4,
  high: 3,
  medium: 2,
  low: 1
}

function itemCost(text: string): number {
  return TokenEstimator.estimate(text)
}

function byId<T extends { id: ID }>(items: T[], ids: ID[]): T[] {
  const set = new Set(ids)
  return items.filter((item) => set.has(item.id))
}

function takeLast<T>(items: T[], count: number): T[] {
  return count <= 0 ? [] : items.slice(-count)
}

function takeFirst<T>(items: T[], count: number): T[] {
  return count <= 0 ? [] : items.slice(0, count)
}

function stringifyChapter(chapter: Chapter): string {
  return [
    chapter.title,
    chapter.summary,
    chapter.newInformation,
    chapter.characterChanges,
    chapter.newForeshadowing,
    chapter.resolvedForeshadowing,
    chapter.endingHook,
    chapter.riskWarnings
  ].join('\n')
}

function stringifyStageSummary(summary: StageSummary): string {
  return [
    summary.plotProgress,
    summary.characterRelations,
    summary.secrets,
    summary.foreshadowingPlanted,
    summary.foreshadowingResolved,
    summary.unresolvedQuestions,
    summary.nextStageDirection
  ].join('\n')
}

function stringifyCharacter(character: Character): string {
  return [
    character.name,
    character.role,
    character.surfaceGoal,
    character.deepDesire,
    character.coreFear,
    character.knownInformation,
    character.unknownInformation,
    character.protagonistRelationship,
    character.emotionalState,
    character.nextActionTendency,
    character.forbiddenWriting
  ].join('\n')
}

function stringifyForeshadowing(item: Foreshadowing): string {
  const treatmentMode = effectiveTreatmentMode(item)
  return [
    item.title,
    item.description,
    item.status,
    item.weight,
    treatmentMode,
    item.expectedPayoff,
    item.payoffMethod,
    item.relatedMainPlot,
    item.notes
  ].join('\n')
}

function foreshadowingPriority(item: Foreshadowing): number {
  const treatmentMode = effectiveTreatmentMode(item)
  return TREATMENT_PRIORITY[treatmentMode] * 10 + WEIGHT_PRIORITY[item.weight]
}

function foreshadowingOmitReason(item: Foreshadowing, budgetProfile: ContextBudgetProfile): string {
  if (item.status === 'resolved' || item.status === 'abandoned') return '已回收且未被手动选择。'
  const treatmentMode = effectiveTreatmentMode(item)
  const treatmentReason = treatmentOmitReason(treatmentMode)
  if (treatmentReason) return `${treatmentReason}。`
  if (!budgetProfile.includeForeshadowingWeights.includes(item.weight)) return '权重或状态未进入当前预算。'
  return 'token 预算不足，低于本章推进优先级。'
}

function stringifyTimelineEvent(event: TimelineEvent): string {
  return [event.title, event.storyTime, event.narrativeOrder, event.result, event.downstreamImpact].join('\n')
}

function selectionCost(data: ProjectContextData, selection: ContextSelectionResult, styleSampleMaxChars: number): number {
  const storyBibleText = data.bible
    ? [
        data.project.name,
        data.project.genre,
        data.project.description,
        data.project.targetReaders,
        data.project.coreAppeal,
        data.project.style,
        data.bible.worldbuilding,
        data.bible.corePremise,
        data.bible.protagonistDesire,
        data.bible.protagonistFear,
        data.bible.mainConflict,
        data.bible.powerSystem,
        data.bible.bannedTropes,
        data.bible.styleSample.slice(0, styleSampleMaxChars),
        data.bible.narrativeTone,
        data.bible.immutableFacts
      ].join('\n')
    : [data.project.name, data.project.genre, data.project.description].join('\n')

  const selectedText = [
    storyBibleText,
    ...byId(data.chapters, selection.selectedChapterIds).map(stringifyChapter),
    ...byId(data.stageSummaries, selection.selectedStageSummaryIds).map(stringifyStageSummary),
    ...byId(data.characters, selection.selectedCharacterIds).map(stringifyCharacter),
    ...byId(data.foreshadowings, selection.selectedForeshadowingIds).map(stringifyForeshadowing),
    ...byId(data.timelineEvents, selection.selectedTimelineEventIds).map(stringifyTimelineEvent)
  ].join('\n\n')

  return itemCost(selectedText)
}

function omit(selection: ContextSelectionResult, type: string, id: ID | null, reason: string, estimatedTokensSaved: number) {
  selection.omittedItems.push({ type, id, reason, estimatedTokensSaved: Math.max(0, estimatedTokensSaved) })
}

function removeOne(selection: ContextSelectionResult, field: keyof Pick<
  ContextSelectionResult,
  'selectedChapterIds' | 'selectedStageSummaryIds' | 'selectedCharacterIds' | 'selectedForeshadowingIds' | 'selectedTimelineEventIds'
>, id: ID) {
  selection[field] = selection[field].filter((item) => item !== id)
}

interface ForcedContextSelection {
  characterIds?: ID[]
  foreshadowingIds?: ID[]
}

function mergeUniqueById<T extends { id: ID }>(primary: T[], secondary: T[]): T[] {
  const seen = new Set<ID>()
  return [...primary, ...secondary].filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

export class ContextBudgetManager {
  static selectContext(
    data: ProjectContextData,
    targetChapterOrder: number,
    budgetProfile: ContextBudgetProfile,
    forcedSelection: ForcedContextSelection = {}
  ): ContextSelectionResult {
    const forcedCharacterIds = new Set(forcedSelection.characterIds ?? [])
    const forcedForeshadowingIds = new Set(forcedSelection.foreshadowingIds ?? [])
    const previousChapters = [...data.chapters]
      .filter((chapter) => chapter.order < targetChapterOrder)
      .sort((a, b) => a.order - b.order)
    const selectedChapters = takeLast(previousChapters, budgetProfile.includeRecentChaptersCount)

    const stageSummaryCandidates = [...data.stageSummaries]
      .filter((summary) => summary.chapterEnd < targetChapterOrder)
      .sort((a, b) => a.chapterEnd - b.chapterEnd)
    const selectedStageSummaries = takeLast(stageSummaryCandidates, budgetProfile.includeStageSummariesCount)

    const automaticForeshadowings = data.foreshadowings
      .filter((item) => item.status !== 'resolved' && item.status !== 'abandoned')
      .filter((item) => budgetProfile.includeForeshadowingWeights.includes(item.weight))
      .filter((item) => treatmentAllowsDefaultPrompt(effectiveTreatmentMode(item)))
      .sort((a, b) => foreshadowingPriority(b) - foreshadowingPriority(a))
    const forcedForeshadowings = byId(data.foreshadowings, [...forcedForeshadowingIds])
    const activeForeshadowings = mergeUniqueById(forcedForeshadowings, automaticForeshadowings)

    const relatedCharacterIds = new Set(activeForeshadowings.flatMap((item) => item.relatedCharacterIds))
    const selectedCharacters = data.characters.filter((character) => {
      if (forcedCharacterIds.has(character.id)) return true
      if (budgetProfile.includeRelatedCharacters && relatedCharacterIds.has(character.id)) return true
      return budgetProfile.includeMainCharacters && character.isMain
    })

    const selectedTimelineEvents = takeFirst([...data.timelineEvents]
      .filter((event) => event.chapterOrder === null || event.chapterOrder < targetChapterOrder)
      .sort((a, b) => b.narrativeOrder - a.narrativeOrder), budgetProfile.includeTimelineEventsCount)

    const selection: ContextSelectionResult = {
      selectedStoryBibleFields: [
        'project',
        'worldbuilding',
        'corePremise',
        'protagonistDesire',
        'protagonistFear',
        'mainConflict',
        'powerSystem',
        'bannedTropes',
        'styleSample',
        'narrativeTone',
        'immutableFacts'
      ],
      selectedChapterIds: selectedChapters.map((chapter) => chapter.id),
      selectedStageSummaryIds: selectedStageSummaries.map((summary) => summary.id),
      selectedCharacterIds: selectedCharacters.map((character) => character.id),
      selectedForeshadowingIds: activeForeshadowings.map((item) => item.id),
      selectedTimelineEventIds: selectedTimelineEvents.map((event) => event.id),
      estimatedTokens: 0,
      omittedItems: [],
      warnings: []
    }

    for (const chapter of previousChapters.filter((chapter) => !selection.selectedChapterIds.includes(chapter.id))) {
      omit(selection, 'chapter', chapter.id, '旧章节由阶段摘要替代，避免详细回顾膨胀。', itemCost(stringifyChapter(chapter)))
    }
    for (const item of data.foreshadowings.filter((item) => !selection.selectedForeshadowingIds.includes(item.id))) {
      omit(selection, 'foreshadowing', item.id, foreshadowingOmitReason(item, budgetProfile), itemCost(stringifyForeshadowing(item)))
    }

    selection.estimatedTokens = selectionCost(data, selection, budgetProfile.styleSampleMaxChars)
    if (data.bible && data.bible.styleSample.length > budgetProfile.styleSampleMaxChars) {
      selection.warnings.push(`文风样例已截断到 ${budgetProfile.styleSampleMaxChars} 字。`)
      omit(selection, 'storyBible', null, '压缩文风样例长度。', itemCost(data.bible.styleSample.slice(budgetProfile.styleSampleMaxChars)))
    }

    const recalc = () => {
      selection.estimatedTokens = selectionCost(data, selection, budgetProfile.styleSampleMaxChars)
    }

    while (selection.estimatedTokens > budgetProfile.maxTokens && selection.selectedChapterIds.length > 1) {
      const oldest = byId(data.chapters, selection.selectedChapterIds).sort((a, b) => a.order - b.order)[0]
      removeOne(selection, 'selectedChapterIds', oldest.id)
      omit(selection, 'chapter', oldest.id, '超出预算，优先省略较旧章节详细回顾。', itemCost(stringifyChapter(oldest)))
      recalc()
    }

    while (selection.estimatedTokens > budgetProfile.maxTokens) {
      const low = byId(data.foreshadowings, selection.selectedForeshadowingIds)
        .filter((item) => !forcedForeshadowingIds.has(item.id))
        .sort((a, b) => foreshadowingPriority(a) - foreshadowingPriority(b))[0]
      if (!low) break
      removeOne(selection, 'selectedForeshadowingIds', low.id)
      omit(selection, 'foreshadowing', low.id, 'token 预算不足，低于本章推进优先级。', itemCost(stringifyForeshadowing(low)))
      recalc()
    }

    while (selection.estimatedTokens > budgetProfile.maxTokens) {
      const nonMain = byId(data.characters, selection.selectedCharacterIds).find((character) => !character.isMain)
      if (!nonMain) break
      removeOne(selection, 'selectedCharacterIds', nonMain.id)
      omit(selection, 'character', nonMain.id, '超出预算，省略非主要角色。', itemCost(stringifyCharacter(nonMain)))
      recalc()
    }

    while (selection.estimatedTokens > budgetProfile.maxTokens && selection.selectedStageSummaryIds.length > 1) {
      const oldest = byId(data.stageSummaries, selection.selectedStageSummaryIds).sort((a, b) => a.chapterEnd - b.chapterEnd)[0]
      removeOne(selection, 'selectedStageSummaryIds', oldest.id)
      omit(selection, 'stageSummary', oldest.id, '超出预算，省略较旧阶段摘要。', itemCost(stringifyStageSummary(oldest)))
      recalc()
    }

    while (selection.estimatedTokens > budgetProfile.maxTokens && selection.selectedTimelineEventIds.length > 0) {
      const oldest = byId(data.timelineEvents, selection.selectedTimelineEventIds).sort((a, b) => a.narrativeOrder - b.narrativeOrder)[0]
      removeOne(selection, 'selectedTimelineEventIds', oldest.id)
      omit(selection, 'timelineEvent', oldest.id, '超出预算，省略时间线事件。', itemCost(stringifyTimelineEvent(oldest)))
      recalc()
    }

    if (selection.estimatedTokens > budgetProfile.maxTokens) {
      selection.warnings.push(`当前上下文仍约 ${selection.estimatedTokens} token，超过预算 ${budgetProfile.maxTokens}。建议切换更高预算或手动关闭模块。`)
    }

    if (selection.selectedChapterIds.length === 0 && previousChapters.length > 0) {
      selection.warnings.push('预算过低，最近章节详细回顾可能不足。')
    }
    if (selection.selectedForeshadowingIds.length === 0 && activeForeshadowings.length > 0) {
      selection.warnings.push('伏笔已被预算压缩，本章可能需要人工检查伏笔连续性。')
    }

    return selection
  }

  static estimateContextCost(contextSelection: ContextSelectionResult): number {
    return contextSelection.estimatedTokens
  }

  static explainSelection(contextSelection: ContextSelectionResult): string {
    const selected = [
      `章节 ${contextSelection.selectedChapterIds.length} 个`,
      `阶段摘要 ${contextSelection.selectedStageSummaryIds.length} 个`,
      `角色 ${contextSelection.selectedCharacterIds.length} 个`,
      `伏笔 ${contextSelection.selectedForeshadowingIds.length} 个`,
      `时间线事件 ${contextSelection.selectedTimelineEventIds.length} 个`
    ].join('、')
    const omitted = contextSelection.omittedItems.length
      ? `已省略 ${contextSelection.omittedItems.length} 项，主要原因：${contextSelection.omittedItems.slice(0, 3).map((item) => item.reason).join('；')}`
      : '没有省略项目。'
    const warnings = contextSelection.warnings.length ? `风险提示：${contextSelection.warnings.join('；')}` : '未发现明显上下文风险。'
    return `本次选择纳入 ${selected}，预计 ${contextSelection.estimatedTokens} token。${omitted}。${warnings}`
  }
}

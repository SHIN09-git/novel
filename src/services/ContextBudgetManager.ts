import type {
  ContextBudgetProfile,
  ContextDecisionReasonCode,
  ContextSelectionResult,
  ID
} from '../shared/types'
import { effectiveTreatmentMode, isForeshadowingAvailableAtChapter, treatmentAllowsDefaultPrompt } from '../shared/foreshadowingTreatment'
import { activeChapters } from './ChapterLifecycleService'
import type {
  ContextEvaluationCandidate,
  ContextEvaluationOptions,
  ForcedContextSelection,
  ProjectContextData,
  ScoringContext
} from './contextBudget/types'
import {
  MAX_PROMPT_FORESHADOWINGS,
  TREATMENT_SCORE,
  WEIGHT_PRIORITY,
  byId,
  clampScore,
  compareForeshadowingForPrompt,
  evaluateChapter,
  evaluateCharacter,
  evaluateForeshadowing,
  evaluateStageSummary,
  evaluateTimelineEvent,
  expectedPayoffNear,
  extractTaskTerms,
  foreshadowingPriority,
  itemCost,
  taskText,
  textMentions,
  textOverlapScore,
  tokenEfficiencyScore
} from './contextBudget/scoringEngine'
import { byScoreThenOrder, mergeUniqueById, scored } from './contextBudget/selectionEngine'
import { finalizeContextSelection } from './contextBudget/selectionFinalizer'

export type { ContextEvaluationCandidate, ContextEvaluationOptions } from './contextBudget/types'

const NEGATIVE_TASK_MARKERS = ['不得', '不要', '禁止', '不能', '不可', '不应', '避免']

function positiveTaskText(task: ForcedContextSelection['chapterTask']): string {
  if (!task) return ''
  return [
    task.goal,
    task.conflict,
    task.suspenseToKeep,
    task.allowedPayoffs,
    task.endingHook,
    task.readerEmotion,
    task.targetWordCount,
    task.styleRequirement
  ]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .flatMap((value) => value.split(/[。！？；\n，,]+|(?:但是|但|不过|然而)/))
    .map((value) => value.trim())
    .filter((value) => value && !NEGATIVE_TASK_MARKERS.some((marker) => value.includes(marker)))
    .join('\n')
}

export class ContextBudgetManager {
  static evaluateContext(candidate: ContextEvaluationCandidate, options: ContextEvaluationOptions): number {
    const tokenEstimate = candidate.tokenEstimate ?? itemCost(candidate.text)
    const terms = extractTaskTerms(taskText(options.task))
    const taskScore = textOverlapScore(candidate.text, terms, 34)
    const forcedScore = options.forced ? 40 : 0
    const tokenScore = tokenEfficiencyScore(tokenEstimate)

    if (candidate.type === 'foreshadowing') {
      const treatmentMode = options.treatmentMode ?? 'hint'
      const weightScore = options.weight ? WEIGHT_PRIORITY[options.weight] * 5 : 0
      const nearPayoffScore = options.expectedPayoff && expectedPayoffNear(options.expectedPayoff, options.targetChapterOrder) ? 16 : 0
      return clampScore(8 + forcedScore + TREATMENT_SCORE[treatmentMode] + weightScore + nearPayoffScore + taskScore + tokenScore)
    }

    if (candidate.type === 'character') {
      return clampScore(16 + forcedScore + (options.isMainCharacter ? 14 : 0) + (options.isRelatedCharacter ? 18 : 0) + taskScore + tokenScore)
    }

    const distance = options.chapterOrder === null || options.chapterOrder === undefined
      ? 8
      : Math.max(1, options.targetChapterOrder - options.chapterOrder)
    const recencyScore = Math.max(0, 28 - distance * 4)
    return clampScore(14 + forcedScore + recencyScore + taskScore + tokenScore)
  }

  static selectContext(
    data: ProjectContextData,
    targetChapterOrder: number,
    budgetProfile: ContextBudgetProfile,
    forcedSelection: ForcedContextSelection = {}
  ): ContextSelectionResult {
    data = { ...data, chapters: activeChapters(data.chapters) }
    const isolateOpeningLegacyContext = Boolean(forcedSelection.isolateOpeningLegacyContext && targetChapterOrder === 1)
    const openingTaskText = isolateOpeningLegacyContext ? positiveTaskText(forcedSelection.chapterTask) : ''
    const openingTaskCharacterIds = new Set(
      isolateOpeningLegacyContext
        ? data.characters.filter((character) => textMentions(openingTaskText, character.name)).map((character) => character.id)
        : []
    )
    const manualCharacterIds = new Set(
      (forcedSelection.characterIds ?? []).filter((id) => !isolateOpeningLegacyContext || openingTaskCharacterIds.has(id))
    )
    const manualForeshadowingIds = new Set(isolateOpeningLegacyContext ? [] : (forcedSelection.foreshadowingIds ?? []))
    const forcedCharacterIds = new Set(manualCharacterIds)
    const forcedForeshadowingIds = new Set(manualForeshadowingIds)
    const planCharacterNeeds = (forcedSelection.contextNeedPlan?.expectedCharacters ?? [])
      .filter((item) => !isolateOpeningLegacyContext || openingTaskCharacterIds.has(item.characterId))
    const planCharacterIds = new Set(planCharacterNeeds.map((item) => item.characterId))
    const planRequiredCharacterIds = new Set(
      planCharacterNeeds
        .filter((item) => !item.uncertain && item.involvement !== 'mentioned')
        .map((item) => item.characterId)
    )
    const planRequiredForeshadowingIds = new Set(
      isolateOpeningLegacyContext ? [] : (forcedSelection.contextNeedPlan?.requiredForeshadowingIds ?? [])
    )
    const planForbiddenForeshadowingIds = new Set(forcedSelection.contextNeedPlan?.forbiddenForeshadowingIds ?? [])
    const excludedCharacterIds = new Set(
      isolateOpeningLegacyContext
        ? []
        : (forcedSelection.contextNeedPlan?.exclusionRules ?? [])
            .filter((rule) => rule.type === 'character')
            .map((rule) => rule.id)
    )
    if (isolateOpeningLegacyContext) openingTaskCharacterIds.forEach((id) => forcedCharacterIds.add(id))
    for (const id of planRequiredCharacterIds) forcedCharacterIds.add(id)
    for (const id of planRequiredForeshadowingIds) forcedForeshadowingIds.add(id)

    const scoringBase: ScoringContext = {
      targetChapterOrder,
      task: forcedSelection.chapterTask ?? null,
      forcedCharacterIds,
      forcedForeshadowingIds,
      manualCharacterIds,
      manualForeshadowingIds,
      excludedCharacterIds,
      selectionMode: forcedSelection.selectionMode ?? 'automatic',
      foreshadowingTreatmentOverrides: forcedSelection.foreshadowingTreatmentOverrides,
      relatedCharacterIds: new Set<ID>(),
      contextNeedPlan: forcedSelection.contextNeedPlan ?? null,
      planCharacterIds,
      planRequiredForeshadowingIds,
      planForbiddenForeshadowingIds
    }

    const previousChapters = data.chapters
      .filter((chapter) => !isolateOpeningLegacyContext && chapter.order < targetChapterOrder)
      .sort((a, b) => a.order - b.order)
    const selectedChapters = scored(previousChapters, (chapter) => evaluateChapter(chapter, scoringBase))
      .sort((a, b) => byScoreThenOrder(a, b, (chapter) => chapter.order))
      .slice(0, budgetProfile.includeRecentChaptersCount)
      .map(({ item }) => item)
      .sort((a, b) => a.order - b.order)

    const stageSummaryCandidates = data.stageSummaries
      .filter((summary) => !isolateOpeningLegacyContext && summary.chapterEnd < targetChapterOrder)
      .sort((a, b) => a.chapterEnd - b.chapterEnd)
    const selectedStageSummaries = scored(stageSummaryCandidates, (summary) => evaluateStageSummary(summary, scoringBase))
      .sort((a, b) => byScoreThenOrder(a, b, (summary) => summary.chapterEnd))
      .slice(0, budgetProfile.includeStageSummariesCount)
      .map(({ item }) => item)
      .sort((a, b) => a.chapterEnd - b.chapterEnd)

    const automaticForeshadowings = (isolateOpeningLegacyContext ? [] : data.foreshadowings)
      .filter((item) => isForeshadowingAvailableAtChapter(item, targetChapterOrder))
      .filter((item) => item.status !== 'resolved' && item.status !== 'abandoned')
      .filter((item) => budgetProfile.includeForeshadowingWeights.includes(item.weight))
      .filter((item) => treatmentAllowsDefaultPrompt(effectiveTreatmentMode(item, forcedSelection.foreshadowingTreatmentOverrides)))
      .filter((item) => evaluateForeshadowing(item, scoringBase) > 1)
      .sort((a, b) => {
        const scoreDelta = evaluateForeshadowing(b, scoringBase) - evaluateForeshadowing(a, scoringBase)
        if (scoreDelta !== 0) return scoreDelta
        return foreshadowingPriority(b, forcedSelection.foreshadowingTreatmentOverrides) - foreshadowingPriority(a, forcedSelection.foreshadowingTreatmentOverrides)
      })
    const forcedForeshadowings = byId(isolateOpeningLegacyContext ? [] : data.foreshadowings, [...forcedForeshadowingIds]).filter(
      (item) => manualForeshadowingIds.has(item.id) || (
        isForeshadowingAvailableAtChapter(item, targetChapterOrder) && !planForbiddenForeshadowingIds.has(item.id)
      )
    )
    const rankedForeshadowings = mergeUniqueById(forcedForeshadowings, automaticForeshadowings).sort((a, b) =>
      compareForeshadowingForPrompt(a, b, scoringBase)
    )
    const activeForeshadowings = rankedForeshadowings.slice(0, MAX_PROMPT_FORESHADOWINGS)
    const relatedCharacterIds = new Set(activeForeshadowings.flatMap((item) => item.relatedCharacterIds))
    const scoringContext: ScoringContext = { ...scoringBase, relatedCharacterIds }

    const selectedCharacters = scored(
      data.characters.filter((character) => {
        if (isolateOpeningLegacyContext) return openingTaskCharacterIds.has(character.id)
        if (manualCharacterIds.has(character.id)) return true
        if (excludedCharacterIds.has(character.id)) return false
        if (forcedCharacterIds.has(character.id)) return true
        if (planCharacterIds.has(character.id)) return true
        if (budgetProfile.includeRelatedCharacters && relatedCharacterIds.has(character.id)) return true
        if (textMentions(taskText(scoringContext.task), character.name)) return true
        return budgetProfile.includeMainCharacters && character.isMain && !forcedSelection.contextNeedPlan
      }),
      (character) => evaluateCharacter(character, scoringContext)
    )
      .sort((a, b) => byScoreThenOrder(a, b, (character) => (character.isMain ? 0 : 1)))
      .map(({ item }) => item)

    const timelineEventCandidates = data.timelineEvents.filter((event) =>
      isolateOpeningLegacyContext
        ? event.chapterOrder !== null && event.chapterOrder < targetChapterOrder
        : event.chapterOrder === null || event.chapterOrder < targetChapterOrder
    )
    const automaticTimelineEvents = scored(timelineEventCandidates, (event) => evaluateTimelineEvent(event, scoringContext))
      .sort((a, b) => byScoreThenOrder(a, b, (event) => -event.narrativeOrder))
      .slice(0, budgetProfile.includeTimelineEventsCount)
      .map(({ item }) => item)
      .sort((a, b) => a.narrativeOrder - b.narrativeOrder)
    const selectedTimelineEvents = mergeUniqueById(
      isolateOpeningLegacyContext
        ? []
        : byId(data.timelineEvents, forcedSelection.contextNeedPlan?.requiredTimelineEventIds ?? []),
      automaticTimelineEvents
    ).sort((a, b) => a.narrativeOrder - b.narrativeOrder)

    return finalizeContextSelection({
      data,
      targetChapterOrder,
      budgetProfile,
      forcedSelection,
      scoringContext,
      rankedForeshadowingIds: rankedForeshadowings.map((item) => item.id),
      selection: {
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
        compressionRecords: [],
        contextSelectionTrace: null,
        warnings: []
      }
    })
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
    const reasonLabels: Partial<Record<ContextDecisionReasonCode, string>> = {
      budget_exceeded: '预算不足',
      low_relevance: '相关性较低',
      compressed_replacement: '由压缩内容替代',
      forbidden: '任务或规则禁止',
      manual_exclusion: '用户手动排除',
      prompt_limit: '数量上限',
      profile_filter: '预算配置过滤',
      status_ineligible: '状态不适用',
      snapshot_locked: 'Prompt 快照固定',
      missing_source: '来源缺失',
      not_available: '没有可用内容',
      unknown: '旧记录未分类'
    }
    const reasonCounts = contextSelection.omittedItems.reduce<Map<ContextDecisionReasonCode, number>>((counts, item) => {
      counts.set(item.reasonCode, (counts.get(item.reasonCode) ?? 0) + 1)
      return counts
    }, new Map())
    const reasonSummary = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([code, count]) => `${reasonLabels[code] ?? code} ${count} 项`)
      .join('、')
    const omitted = contextSelection.omittedItems.length
      ? `已省略 ${contextSelection.omittedItems.length} 项（${reasonSummary}）。`
      : '没有省略项目。'
    const warnings = contextSelection.warnings.length
      ? `风险提示：${contextSelection.warnings.join('；')}`
      : '未发现明显上下文风险。'
    return `本次选择纳入 ${selected}，预计 ${contextSelection.estimatedTokens} token。${omitted}${warnings}`
  }
}

import type {
  ChapterTask,
  ContextBudgetProfile,
  ContextSelectionResult,
  ForeshadowingTreatmentMode,
  ForeshadowingWeight,
  ID
} from '../shared/types'
import { effectiveTreatmentMode, treatmentAllowsDefaultPrompt } from '../shared/foreshadowingTreatment'
import { compressChapterRecapsForBudget, createDroppedChapterCompressionRecord } from './ContextCompressionService'
import type { ContextEvaluationCandidate, ContextEvaluationOptions, ForcedContextSelection, ProjectContextData, ScoringContext } from './contextBudget/types'
import { MAX_PROMPT_FORESHADOWINGS, TREATMENT_SCORE, WEIGHT_PRIORITY, byId, clampScore, compareForeshadowingForPrompt, evaluateChapter, evaluateCharacter, evaluateForeshadowing, evaluateStageSummary, evaluateTimelineEvent, expectedPayoffNear, extractTaskTerms, foreshadowingOmitReason, foreshadowingPriority, itemCost, stringifyCharacter, stringifyChapter, stringifyForeshadowing, stringifyStageSummary, stringifyTimelineEvent, taskText, textMentions, textOverlapScore, tokenEfficiencyScore } from './contextBudget/scoringEngine'
import { byScoreThenOrder, mergeUniqueById, omit, removeOne, scored, selectionCost } from './contextBudget/selectionEngine'
import { buildContextSelectionTrace } from './contextBudget/traceBuilder'

export type { ContextEvaluationCandidate, ContextEvaluationOptions } from './contextBudget/types'

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

    const distance = options.chapterOrder === null || options.chapterOrder === undefined ? 8 : Math.max(1, options.targetChapterOrder - options.chapterOrder)
    const recencyScore = Math.max(0, 28 - distance * 4)
    return clampScore(14 + forcedScore + recencyScore + taskScore + tokenScore)
  }

  static selectContext(
    data: ProjectContextData,
    targetChapterOrder: number,
    budgetProfile: ContextBudgetProfile,
    forcedSelection: ForcedContextSelection = {}
  ): ContextSelectionResult {
    const forcedCharacterIds = new Set(forcedSelection.characterIds ?? [])
    const forcedForeshadowingIds = new Set(forcedSelection.foreshadowingIds ?? [])
    const planCharacterIds = new Set((forcedSelection.contextNeedPlan?.expectedCharacters ?? []).map((item) => item.characterId))
    const planRequiredForeshadowingIds = new Set(forcedSelection.contextNeedPlan?.requiredForeshadowingIds ?? [])
    const planForbiddenForeshadowingIds = new Set(forcedSelection.contextNeedPlan?.forbiddenForeshadowingIds ?? [])
    for (const id of planCharacterIds) forcedCharacterIds.add(id)
    for (const id of planRequiredForeshadowingIds) forcedForeshadowingIds.add(id)
    const scoringBase: ScoringContext = {
      targetChapterOrder,
      task: forcedSelection.chapterTask ?? null,
      forcedCharacterIds,
      forcedForeshadowingIds,
      foreshadowingTreatmentOverrides: forcedSelection.foreshadowingTreatmentOverrides,
      relatedCharacterIds: new Set<ID>(),
      contextNeedPlan: forcedSelection.contextNeedPlan ?? null,
      planCharacterIds,
      planRequiredForeshadowingIds,
      planForbiddenForeshadowingIds
    }

    const previousChapters = [...data.chapters]
      .filter((chapter) => chapter.order < targetChapterOrder)
      .sort((a, b) => a.order - b.order)
    const selectedChapters = scored(previousChapters, (chapter) => evaluateChapter(chapter, scoringBase))
      .sort((a, b) => byScoreThenOrder(a, b, (chapter) => chapter.order))
      .slice(0, budgetProfile.includeRecentChaptersCount)
      .map(({ item }) => item)
      .sort((a, b) => a.order - b.order)

    const stageSummaryCandidates = [...data.stageSummaries]
      .filter((summary) => summary.chapterEnd < targetChapterOrder)
      .sort((a, b) => a.chapterEnd - b.chapterEnd)
    const selectedStageSummaries = scored(stageSummaryCandidates, (summary) => evaluateStageSummary(summary, scoringBase))
      .sort((a, b) => byScoreThenOrder(a, b, (summary) => summary.chapterEnd))
      .slice(0, budgetProfile.includeStageSummariesCount)
      .map(({ item }) => item)
      .sort((a, b) => a.chapterEnd - b.chapterEnd)

    const automaticForeshadowings = data.foreshadowings
      .filter((item) => item.status !== 'resolved' && item.status !== 'abandoned')
      .filter((item) => budgetProfile.includeForeshadowingWeights.includes(item.weight))
      .filter((item) => treatmentAllowsDefaultPrompt(effectiveTreatmentMode(item, forcedSelection.foreshadowingTreatmentOverrides)))
      .filter((item) => evaluateForeshadowing(item, scoringBase) > 1)
      .sort((a, b) => {
        const scoreDelta = evaluateForeshadowing(b, scoringBase) - evaluateForeshadowing(a, scoringBase)
        if (scoreDelta !== 0) return scoreDelta
        return foreshadowingPriority(b, forcedSelection.foreshadowingTreatmentOverrides) - foreshadowingPriority(a, forcedSelection.foreshadowingTreatmentOverrides)
      })
    const manualForeshadowingIds = new Set(forcedSelection.foreshadowingIds ?? [])
    const forcedForeshadowings = byId(data.foreshadowings, [...forcedForeshadowingIds]).filter(
      (item) => manualForeshadowingIds.has(item.id) || !planForbiddenForeshadowingIds.has(item.id)
    )
    const rankedForeshadowings = mergeUniqueById(forcedForeshadowings, automaticForeshadowings).sort((a, b) =>
      compareForeshadowingForPrompt(a, b, scoringBase)
    )
    const activeForeshadowings = rankedForeshadowings.slice(0, MAX_PROMPT_FORESHADOWINGS)
    const foreshadowingLimitOmittedIds = new Set(rankedForeshadowings.slice(MAX_PROMPT_FORESHADOWINGS).map((item) => item.id))

    const relatedCharacterIds = new Set(activeForeshadowings.flatMap((item) => item.relatedCharacterIds))
    const scoringContext: ScoringContext = { ...scoringBase, relatedCharacterIds }
    const selectedCharacters = scored(
      data.characters.filter((character) => {
        if (forcedCharacterIds.has(character.id)) return true
        if (budgetProfile.includeRelatedCharacters && relatedCharacterIds.has(character.id)) return true
        if (textMentions(taskText(scoringContext.task), character.name)) return true
        return budgetProfile.includeMainCharacters && character.isMain
      }),
      (character) => evaluateCharacter(character, scoringContext)
    )
      .sort((a, b) => byScoreThenOrder(a, b, (character) => (character.isMain ? 0 : 1)))
      .map(({ item }) => item)

    const automaticTimelineEvents = scored(
      [...data.timelineEvents].filter((event) => event.chapterOrder === null || event.chapterOrder < targetChapterOrder),
      (event) => evaluateTimelineEvent(event, scoringContext)
    )
      .sort((a, b) => byScoreThenOrder(a, b, (event) => -event.narrativeOrder))
      .slice(0, budgetProfile.includeTimelineEventsCount)
      .map(({ item }) => item)
      .sort((a, b) => a.narrativeOrder - b.narrativeOrder)
    const selectedTimelineEvents = mergeUniqueById(byId(data.timelineEvents, forcedSelection.contextNeedPlan?.requiredTimelineEventIds ?? []), automaticTimelineEvents)
      .sort((a, b) => a.narrativeOrder - b.narrativeOrder)

    let selection: ContextSelectionResult = {
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

    if (rankedForeshadowings.length > MAX_PROMPT_FORESHADOWINGS) {
      selection.warnings.push(`本章伏笔推进已限制为 ${MAX_PROMPT_FORESHADOWINGS} 条，其余伏笔按权重和相关性省略。`)
    }

    for (const chapter of previousChapters.filter((chapter) => !selection.selectedChapterIds.includes(chapter.id))) {
      omit(selection, 'chapter', chapter.id, '旧章节由阶段摘要或更相关章节替代，避免详细回顾膨胀。', itemCost(stringifyChapter(chapter)))
    }
    for (const item of data.foreshadowings.filter((item) => !selection.selectedForeshadowingIds.includes(item.id))) {
      const reason = foreshadowingLimitOmittedIds.has(item.id)
        ? `本章 Prompt 最多推进 ${MAX_PROMPT_FORESHADOWINGS} 条伏笔，已按权重和本章相关性排序后省略。`
        : foreshadowingOmitReason(item, budgetProfile, scoringContext)
      omit(selection, 'foreshadowing', item.id, reason, itemCost(stringifyForeshadowing(item)))
    }

    selection.estimatedTokens = selectionCost(data, selection, budgetProfile.styleSampleMaxChars, forcedSelection.contextNeedPlan)
    if (data.bible && data.bible.styleSample.length > budgetProfile.styleSampleMaxChars) {
      selection.warnings.push(`文风样例已截断到 ${budgetProfile.styleSampleMaxChars} 字。`)
      omit(selection, 'storyBible', null, '压缩文风样例长度。', itemCost(data.bible.styleSample.slice(budgetProfile.styleSampleMaxChars)))
    }

    const recalc = () => {
      selection.estimatedTokens = selectionCost(data, selection, budgetProfile.styleSampleMaxChars, forcedSelection.contextNeedPlan)
    }

    selection = compressChapterRecapsForBudget({
      chapters: data.chapters,
      stageSummaries: data.stageSummaries,
      selection,
      targetChapterOrder,
      budgetProfile,
      estimateSelectionTokens: (nextSelection) => selectionCost(data, nextSelection, budgetProfile.styleSampleMaxChars, forcedSelection.contextNeedPlan)
    })
    recalc()

    while (selection.estimatedTokens > budgetProfile.maxTokens && selection.selectedChapterIds.length > 1) {
      const removable = byId(data.chapters, selection.selectedChapterIds)
        .sort((a, b) => evaluateChapter(a, scoringContext) - evaluateChapter(b, scoringContext))[0]
      const dropRecord = createDroppedChapterCompressionRecord(removable, '超出预算，低相关章节详细回顾被裁掉。')
      selection.compressionRecords = [dropRecord, ...selection.compressionRecords.filter((record) => record.originalChapterId !== removable.id)]
      removeOne(selection, 'selectedChapterIds', removable.id)
      omit(selection, 'chapter', removable.id, '超出预算，优先省略低相关章节详细回顾。', itemCost(stringifyChapter(removable)))
      recalc()
    }

    while (selection.estimatedTokens > budgetProfile.maxTokens && selection.selectedStageSummaryIds.length > 1) {
      const lowSummary = byId(data.stageSummaries, selection.selectedStageSummaryIds)
        .sort((a, b) => evaluateStageSummary(a, scoringContext) - evaluateStageSummary(b, scoringContext))[0]
      removeOne(selection, 'selectedStageSummaryIds', lowSummary.id)
      omit(selection, 'stageSummary', lowSummary.id, 'token 预算不足，优先省略低相关远期阶段摘要，保护本章角色状态、伏笔和硬设定。', itemCost(stringifyStageSummary(lowSummary)))
      recalc()
    }

    while (selection.estimatedTokens > budgetProfile.maxTokens) {
      const low = byId(data.foreshadowings, selection.selectedForeshadowingIds)
        .filter((item) => !forcedForeshadowingIds.has(item.id) && !planRequiredForeshadowingIds.has(item.id))
        .sort((a, b) => {
          const scoreDelta = evaluateForeshadowing(a, scoringContext) - evaluateForeshadowing(b, scoringContext)
          if (scoreDelta !== 0) return scoreDelta
          return foreshadowingPriority(a, forcedSelection.foreshadowingTreatmentOverrides) - foreshadowingPriority(b, forcedSelection.foreshadowingTreatmentOverrides)
        })[0]
      if (!low) break
      removeOne(selection, 'selectedForeshadowingIds', low.id)
      omit(selection, 'foreshadowing', low.id, 'token 预算不足，低于本章任务相关性优先级。', itemCost(stringifyForeshadowing(low)))
      recalc()
    }

    while (selection.estimatedTokens > budgetProfile.maxTokens) {
      const nonMain = byId(data.characters, selection.selectedCharacterIds)
        .filter((character) => !character.isMain && !forcedCharacterIds.has(character.id))
        .sort((a, b) => evaluateCharacter(a, scoringContext) - evaluateCharacter(b, scoringContext))[0]
      if (!nonMain) break
      removeOne(selection, 'selectedCharacterIds', nonMain.id)
      omit(selection, 'character', nonMain.id, '超出预算，省略低相关非主要角色。', itemCost(stringifyCharacter(nonMain)))
      recalc()
    }

    while (selection.estimatedTokens > budgetProfile.maxTokens && selection.selectedStageSummaryIds.length > 1) {
      const lowSummary = byId(data.stageSummaries, selection.selectedStageSummaryIds)
        .sort((a, b) => evaluateStageSummary(a, scoringContext) - evaluateStageSummary(b, scoringContext))[0]
      removeOne(selection, 'selectedStageSummaryIds', lowSummary.id)
      omit(selection, 'stageSummary', lowSummary.id, '超出预算，省略低相关阶段摘要。', itemCost(stringifyStageSummary(lowSummary)))
      recalc()
    }

    while (selection.estimatedTokens > budgetProfile.maxTokens && selection.selectedTimelineEventIds.length > 0) {
      const lowEvent = byId(data.timelineEvents, selection.selectedTimelineEventIds)
        .filter((event) => !(forcedSelection.contextNeedPlan?.requiredTimelineEventIds ?? []).includes(event.id))
        .sort((a, b) => evaluateTimelineEvent(a, scoringContext) - evaluateTimelineEvent(b, scoringContext))[0]
      if (!lowEvent) break
      removeOne(selection, 'selectedTimelineEventIds', lowEvent.id)
      omit(selection, 'timelineEvent', lowEvent.id, '超出预算，省略低相关时间线事件。', itemCost(stringifyTimelineEvent(lowEvent)))
      recalc()
    }

    if (selection.estimatedTokens > budgetProfile.maxTokens) {
      selection.warnings.push(`当前上下文约 ${selection.estimatedTokens} token，超过预算 ${budgetProfile.maxTokens}。建议切换更高预算或手动关闭模块。`)
    }
    if (selection.selectedChapterIds.length === 0 && previousChapters.length > 0) {
      selection.warnings.push('预算过低，最近或高相关章节详细回顾可能不足。')
    }
    if (selection.selectedForeshadowingIds.length === 0 && activeForeshadowings.length > 0) {
      selection.warnings.push('伏笔已被预算压缩，本章可能需要人工检查伏笔连续性。')
    }

    selection.contextSelectionTrace = buildContextSelectionTrace(data, targetChapterOrder, budgetProfile, selection, scoringContext)

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
    return `本次选择纳入 ${selected}，预计 ${contextSelection.estimatedTokens} token。${omitted}${warnings}`
  }
}

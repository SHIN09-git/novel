import type {
  Chapter,
  ChapterTask,
  CharacterCardField,
  Character,
  ContextBudgetProfile,
  ContextNeedPlan,
  ContextSelectionResult,
  Foreshadowing,
  ForeshadowingTreatmentMode,
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
import {
  compressChapterRecapsForBudget,
  createDroppedChapterCompressionRecord,
  detailedChapterRecapText,
  replacementTextForCompressedChapter
} from './ContextCompressionService'
import { TokenEstimator } from './TokenEstimator'
import { StageSummaryService } from './StageSummaryService'

interface ProjectContextData {
  project: Project
  bible: StoryBible | null
  chapters: Chapter[]
  characters: Character[]
  foreshadowings: Foreshadowing[]
  timelineEvents: TimelineEvent[]
  stageSummaries: StageSummary[]
}

interface ForcedContextSelection {
  characterIds?: ID[]
  foreshadowingIds?: ID[]
  chapterTask?: Partial<ChapterTask> | null
  foreshadowingTreatmentOverrides?: Record<ID, ForeshadowingTreatmentMode>
  contextNeedPlan?: ContextNeedPlan | null
}

interface ScoringContext {
  targetChapterOrder: number
  task?: Partial<ChapterTask> | null
  forcedCharacterIds: Set<ID>
  forcedForeshadowingIds: Set<ID>
  foreshadowingTreatmentOverrides?: Record<ID, ForeshadowingTreatmentMode>
  relatedCharacterIds: Set<ID>
  contextNeedPlan?: ContextNeedPlan | null
  planCharacterIds: Set<ID>
  planRequiredForeshadowingIds: Set<ID>
  planForbiddenForeshadowingIds: Set<ID>
}

export interface ContextEvaluationCandidate {
  type: 'chapter' | 'stageSummary' | 'character' | 'foreshadowing' | 'timelineEvent'
  id: ID
  text: string
  tokenEstimate?: number
  metadata?: Record<string, unknown>
}

export interface ContextEvaluationOptions {
  targetChapterOrder: number
  task?: Partial<ChapterTask> | null
  forced?: boolean
  treatmentMode?: ForeshadowingTreatmentMode
  weight?: ForeshadowingWeight
  isMainCharacter?: boolean
  isRelatedCharacter?: boolean
  chapterOrder?: number | null
  expectedPayoff?: string
}

const WEIGHT_PRIORITY: Record<ForeshadowingWeight, number> = {
  payoff: 4,
  high: 3,
  medium: 2,
  low: 1
}

const TREATMENT_SCORE: Record<ForeshadowingTreatmentMode, number> = {
  payoff: 34,
  advance: 27,
  mislead: 23,
  hint: 16,
  pause: 2,
  hidden: 0
}

function itemCost(text: string): number {
  return TokenEstimator.estimate(text)
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function textValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function taskText(task?: Partial<ChapterTask> | null): string {
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
    .map(textValue)
    .filter(Boolean)
    .join('\n')
}

function forbiddenTaskText(task?: Partial<ChapterTask> | null): string {
  return textValue(task?.forbiddenPayoffs)
}

function extractTaskTerms(text: string): string[] {
  const normalized = text
    .replace(/[，。！？、；：,.!?;:()[\]{}《》“”"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return []
  const terms: string[] = []
  for (const rawTerm of normalized.split(' ')) {
    const term = rawTerm.trim()
    if (term.length < 2 || /^\d+$/.test(term)) continue
    terms.push(term)
    for (const part of term.split(/(?:必须|需要|并|和|与|的|本章|推进|调查|回收|保留|进入|产生|读者|情绪|目标)/)) {
      if (part.length >= 2 && !/^\d+$/.test(part)) terms.push(part)
    }
    if (term.length > 6) {
      for (let index = 0; index <= term.length - 4; index += 1) {
        terms.push(term.slice(index, index + 4))
      }
    }
  }
  return [...new Set(terms)].slice(0, 120)
}

function textOverlapScore(text: string, terms: string[], maxScore: number): number {
  if (!text.trim() || terms.length === 0) return 0
  const hitCount = terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0)
  if (hitCount === 0) return 0
  return Math.min(maxScore, Math.round((hitCount / Math.max(4, terms.length)) * maxScore * 1.6))
}

function textMentions(text: string, value: string | null | undefined): boolean {
  const target = textValue(value)
  return target.length >= 2 && text.includes(target)
}

function parseChapterNumbers(text: string): number[] {
  return [...text.matchAll(/\d+/g)]
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value))
}

function expectedPayoffNear(expectedPayoff: string, targetChapterOrder: number): boolean {
  return parseChapterNumbers(expectedPayoff).some((chapterOrder) => Math.abs(chapterOrder - targetChapterOrder) <= 3)
}

function tokenEfficiencyScore(tokenEstimate: number): number {
  if (tokenEstimate <= 0) return 8
  if (tokenEstimate <= 180) return 10
  if (tokenEstimate <= 500) return 7
  if (tokenEstimate <= 1200) return 4
  return 1
}

function byId<T extends { id: ID }>(items: T[], ids: ID[]): T[] {
  const set = new Set(ids)
  return items.filter((item) => set.has(item.id))
}

function stringifyChapter(chapter: Chapter): string {
  return detailedChapterRecapText(chapter)
}

function stringifyStageSummary(summary: StageSummary): string {
  return StageSummaryService.formatForBudget(summary)
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

function characterFieldValue(character: Character, field: CharacterCardField): string {
  if (field === 'roleFunction') return character.role
  if (field === 'surfaceGoal') return character.surfaceGoal
  if (field === 'deepNeed') return character.deepDesire
  if (field === 'coreFear') return character.coreFear
  if (field === 'decisionLogic') return [character.nextActionTendency, character.selfDeception].filter(Boolean).join('；')
  if (field === 'abilitiesAndResources') return character.knownInformation
  if (field === 'weaknessAndCost') return [character.coreFear, character.forbiddenWriting].filter(Boolean).join('；')
  if (field === 'relationshipTension') return character.protagonistRelationship
  return character.nextActionTendency
}

function stringifyCharacterForPlan(character: Character, plan?: ContextNeedPlan | null): string {
  const fields = plan?.requiredCharacterCardFields?.[character.id]
  if (!fields?.length) return stringifyCharacter(character)
  return [
    character.name,
    ...fields.map((field) => `${field}: ${characterFieldValue(character, field)}`)
  ].join('\n')
}

function stringifyForeshadowing(item: Foreshadowing, overrides?: Record<ID, ForeshadowingTreatmentMode>): string {
  const treatmentMode = effectiveTreatmentMode(item, overrides)
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

function stringifyTimelineEvent(event: TimelineEvent): string {
  return [event.title, event.storyTime, event.narrativeOrder, event.result, event.downstreamImpact].join('\n')
}

function foreshadowingPriority(item: Foreshadowing, overrides?: Record<ID, ForeshadowingTreatmentMode>): number {
  const treatmentMode = effectiveTreatmentMode(item, overrides)
  return TREATMENT_PRIORITY[treatmentMode] * 10 + WEIGHT_PRIORITY[item.weight]
}

function isForeshadowingForbidden(item: Foreshadowing, task?: Partial<ChapterTask> | null): boolean {
  const forbidden = forbiddenTaskText(task)
  if (!forbidden) return false
  const allowed = textValue(task?.allowedPayoffs)
  const itemText = [item.title, item.description, item.relatedMainPlot].join('\n')
  const forbiddenMatch = textMentions(forbidden, item.title) || textOverlapScore(itemText, extractTaskTerms(forbidden), 20) > 0
  const allowedMatch = textMentions(allowed, item.title) || textOverlapScore(itemText, extractTaskTerms(allowed), 20) > 0
  return forbiddenMatch && !allowedMatch
}

function planPriority(context: ScoringContext, type: string, id: ID): number {
  const priority = context.contextNeedPlan?.retrievalPriorities.find((item) => item.type === type && item.id === id)?.priority
  return typeof priority === 'number' ? Math.max(0, Math.min(100, priority)) : 0
}

function foreshadowingOmitReason(item: Foreshadowing, budgetProfile: ContextBudgetProfile, context?: ScoringContext): string {
  if (context?.planForbiddenForeshadowingIds.has(item.id)) return '本章需求计划将该伏笔列为 forbidden，不应进入 prompt。'
  if (item.status === 'resolved' || item.status === 'abandoned') return '已回收或废弃，未被手动选择。'
  if (isForeshadowingForbidden(item, context?.task)) return '本章任务书禁止提及或回收该伏笔。'
  const treatmentMode = effectiveTreatmentMode(item, context?.foreshadowingTreatmentOverrides)
  const treatmentReason = treatmentOmitReason(treatmentMode)
  if (treatmentReason) return `${treatmentReason}。`
  if (!budgetProfile.includeForeshadowingWeights.includes(item.weight)) return '权重未进入当前预算配置。'
  return 'token 预算不足，相关性低于本章推进优先级。'
}

function evaluateChapter(chapter: Chapter, context: ScoringContext): number {
  const text = stringifyChapter(chapter)
  const terms = extractTaskTerms(taskText(context.task))
  const recencyDistance = Math.max(1, context.targetChapterOrder - chapter.order)
  const recencyScore = Math.max(0, 32 - recencyDistance * 5)
  const taskScore = textOverlapScore(text, terms, 30)
  const hookScore = textOverlapScore([chapter.endingHook, chapter.riskWarnings].join('\n'), terms, 12)
  return clampScore(20 + recencyScore + taskScore + hookScore + tokenEfficiencyScore(itemCost(text)))
}

function evaluateStageSummary(summary: StageSummary, context: ScoringContext): number {
  const text = stringifyStageSummary(summary)
  const terms = extractTaskTerms(taskText(context.task))
  const distance = Math.max(1, context.targetChapterOrder - summary.chapterEnd)
  const recencyScore = Math.max(0, 26 - distance * 3)
  const taskScore = textOverlapScore(text, terms, 34)
  const coversRecentArc = context.targetChapterOrder - summary.chapterEnd <= 6 ? 12 : 0
  return clampScore(18 + recencyScore + taskScore + coversRecentArc + tokenEfficiencyScore(itemCost(text)))
}

function evaluateCharacter(character: Character, context: ScoringContext): number {
  if (context.forcedCharacterIds.has(character.id)) return 100
  const text = stringifyCharacterForPlan(character, context.contextNeedPlan)
  const task = taskText(context.task)
  const terms = extractTaskTerms(task)
  const plannedAppearanceScore = textMentions(task, character.name) ? 34 : 0
  const planScore = context.planCharacterIds.has(character.id)
    ? Math.max(18, Math.round(planPriority(context, 'character_card', character.id) * 0.35))
    : 0
  const taskScore = textOverlapScore(text, terms, 24)
  const relationScore = context.relatedCharacterIds.has(character.id) ? 18 : 0
  const mainScore = character.isMain ? 14 : 0
  return clampScore(18 + plannedAppearanceScore + planScore + taskScore + relationScore + mainScore + tokenEfficiencyScore(itemCost(text)))
}

function evaluateForeshadowing(item: Foreshadowing, context: ScoringContext): number {
  if (context.forcedForeshadowingIds.has(item.id)) return 100
  if (context.planForbiddenForeshadowingIds.has(item.id)) return 0
  if (isForeshadowingForbidden(item, context.task)) return 1

  const treatmentMode = effectiveTreatmentMode(item, context.foreshadowingTreatmentOverrides)
  const fullText = stringifyForeshadowing(item, context.foreshadowingTreatmentOverrides)
  const task = taskText(context.task)
  const allowed = textValue(context.task?.allowedPayoffs)
  const terms = extractTaskTerms(task)
  const titleMentioned = textMentions(task, item.title)
  const allowedMentioned = textMentions(allowed, item.title) || textOverlapScore([item.title, item.description].join('\n'), extractTaskTerms(allowed), 20) > 0
  const weightScore = WEIGHT_PRIORITY[item.weight] * 5
  const planScore = context.planRequiredForeshadowingIds.has(item.id)
    ? Math.max(20, Math.round(planPriority(context, 'foreshadowing', item.id) * 0.4))
    : 0
  const payoffScore =
    treatmentMode === 'payoff' || (item.weight === 'payoff' && expectedPayoffNear(item.expectedPayoff, context.targetChapterOrder)) ? 18 : 0
  const taskMatchScore = (titleMentioned ? 18 : 0) + (allowedMentioned ? 18 : 0) + textOverlapScore(fullText, terms, 22)
  return clampScore(8 + TREATMENT_SCORE[treatmentMode] + weightScore + planScore + payoffScore + taskMatchScore + tokenEfficiencyScore(itemCost(fullText)))
}

function evaluateTimelineEvent(event: TimelineEvent, context: ScoringContext): number {
  const text = stringifyTimelineEvent(event)
  const terms = extractTaskTerms(taskText(context.task))
  const distance = event.chapterOrder === null ? 8 : Math.max(1, context.targetChapterOrder - event.chapterOrder)
  const recencyScore = Math.max(0, 24 - distance * 3)
  return clampScore(12 + recencyScore + textOverlapScore(text, terms, 36) + tokenEfficiencyScore(itemCost(text)))
}

function scored<T extends { id: ID }>(items: T[], score: (item: T) => number): Array<{ item: T; score: number }> {
  return items.map((item) => ({ item, score: score(item) }))
}

function byScoreThenOrder<T>(a: { item: T; score: number }, b: { item: T; score: number }, order: (item: T) => number): number {
  const scoreDelta = b.score - a.score
  if (scoreDelta !== 0) return scoreDelta
  return order(a.item) - order(b.item)
}

function mergeUniqueById<T extends { id: ID }>(primary: T[], secondary: T[]): T[] {
  const seen = new Set<ID>()
  return [...primary, ...secondary].filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function selectionCost(data: ProjectContextData, selection: ContextSelectionResult, styleSampleMaxChars: number, contextNeedPlan?: ContextNeedPlan | null): number {
  const compressionByChapterId = new Map((selection.compressionRecords ?? []).map((record) => [record.originalChapterId, record]))
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
    ...byId(data.chapters, selection.selectedChapterIds).map((chapter) => {
      const compression = compressionByChapterId.get(chapter.id)
      return compression ? replacementTextForCompressedChapter(compression) : stringifyChapter(chapter)
    }),
    ...byId(data.stageSummaries, selection.selectedStageSummaryIds).map(stringifyStageSummary),
    ...byId(data.characters, selection.selectedCharacterIds).map((character) => stringifyCharacterForPlan(character, contextNeedPlan)),
    ...byId(data.foreshadowings, selection.selectedForeshadowingIds).map((item) => stringifyForeshadowing(item)),
    ...byId(data.timelineEvents, selection.selectedTimelineEventIds).map(stringifyTimelineEvent)
  ].join('\n\n')

  return itemCost(selectedText)
}

function omit(selection: ContextSelectionResult, type: string, id: ID | null, reason: string, estimatedTokensSaved: number) {
  selection.omittedItems.push({ type, id, reason, estimatedTokensSaved: Math.max(0, estimatedTokensSaved) })
}

function removeOne(
  selection: ContextSelectionResult,
  field: keyof Pick<
    ContextSelectionResult,
    'selectedChapterIds' | 'selectedStageSummaryIds' | 'selectedCharacterIds' | 'selectedForeshadowingIds' | 'selectedTimelineEventIds'
  >,
  id: ID
) {
  selection[field] = selection[field].filter((item) => item !== id)
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
    const activeForeshadowings = mergeUniqueById(forcedForeshadowings, automaticForeshadowings)

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
      warnings: []
    }

    for (const chapter of previousChapters.filter((chapter) => !selection.selectedChapterIds.includes(chapter.id))) {
      omit(selection, 'chapter', chapter.id, '旧章节由阶段摘要或更相关章节替代，避免详细回顾膨胀。', itemCost(stringifyChapter(chapter)))
    }
    for (const item of data.foreshadowings.filter((item) => !selection.selectedForeshadowingIds.includes(item.id))) {
      omit(selection, 'foreshadowing', item.id, foreshadowingOmitReason(item, budgetProfile, scoringContext), itemCost(stringifyForeshadowing(item)))
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

    while (selection.estimatedTokens > budgetProfile.maxTokens) {
      const low = byId(data.foreshadowings, selection.selectedForeshadowingIds)
        .filter((item) => !forcedForeshadowingIds.has(item.id))
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
        .sort((a, b) => evaluateTimelineEvent(a, scoringContext) - evaluateTimelineEvent(b, scoringContext))[0]
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

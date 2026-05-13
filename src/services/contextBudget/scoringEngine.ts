import type {
  Chapter,
  ChapterTask,
  CharacterCardField,
  Character,
  ContextBudgetProfile,
  ContextNeedItem,
  ContextNeedPriority,
  ContextNeedPlan,
  ContextNeedSourceHint,
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

import { effectiveTreatmentMode, TREATMENT_PRIORITY, treatmentOmitReason } from '../../shared/foreshadowingTreatment'
import { detailedChapterRecapText } from '../ContextCompressionService'
import { StageSummaryService } from '../StageSummaryService'
import { TokenEstimator } from '../TokenEstimator'
import type { ScoringContext } from './types'

export const WEIGHT_PRIORITY: Record<ForeshadowingWeight, number> = {
  payoff: 4,
  high: 3,
  medium: 2,
  low: 1
}

export const MAX_PROMPT_FORESHADOWINGS = 10

export const FORESHADOWING_STATUS_PRIORITY: Record<Foreshadowing['status'], number> = {
  partial: 4,
  unresolved: 3,
  resolved: 1,
  abandoned: 0
}

export const TREATMENT_SCORE: Record<ForeshadowingTreatmentMode, number> = {
  payoff: 34,
  advance: 27,
  mislead: 23,
  hint: 16,
  pause: 2,
  hidden: 0
}

export function itemCost(text: string): number {
  return TokenEstimator.estimate(text)
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function textValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

export function taskText(task?: Partial<ChapterTask> | null): string {
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

export function forbiddenTaskText(task?: Partial<ChapterTask> | null): string {
  return textValue(task?.forbiddenPayoffs)
}

export function extractTaskTerms(text: string): string[] {
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

export function textOverlapScore(text: string, terms: string[], maxScore: number): number {
  if (!text.trim() || terms.length === 0) return 0
  const hitCount = terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0)
  if (hitCount === 0) return 0
  return Math.min(maxScore, Math.round((hitCount / Math.max(4, terms.length)) * maxScore * 1.6))
}

export function textMentions(text: string, value: string | null | undefined): boolean {
  const target = textValue(value)
  return target.length >= 2 && text.includes(target)
}

export function parseChapterNumbers(text: string): number[] {
  return [...text.matchAll(/\d+/g)]
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value))
}

export function expectedPayoffNear(expectedPayoff: string, targetChapterOrder: number): boolean {
  return parseChapterNumbers(expectedPayoff).some((chapterOrder) => Math.abs(chapterOrder - targetChapterOrder) <= 3)
}

export function tokenEfficiencyScore(tokenEstimate: number): number {
  if (tokenEstimate <= 0) return 8
  if (tokenEstimate <= 180) return 10
  if (tokenEstimate <= 500) return 7
  if (tokenEstimate <= 1200) return 4
  return 1
}

export function byId<T extends { id: ID }>(items: T[], ids: ID[]): T[] {
  const set = new Set(ids)
  return items.filter((item) => set.has(item.id))
}

export function stringifyChapter(chapter: Chapter): string {
  return detailedChapterRecapText(chapter)
}

export function stringifyStageSummary(summary: StageSummary): string {
  return StageSummaryService.formatForBudget(summary)
}

export function stringifyCharacter(character: Character): string {
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

export function characterFieldValue(character: Character, field: CharacterCardField): string {
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

export function stringifyCharacterForPlan(character: Character, plan?: ContextNeedPlan | null): string {
  const fields = plan?.requiredCharacterCardFields?.[character.id]
  if (!fields?.length) return stringifyCharacter(character)
  return [
    character.name,
    ...fields.map((field) => `${field}: ${characterFieldValue(character, field)}`)
  ].join('\n')
}

export function stringifyForeshadowing(item: Foreshadowing, overrides?: Record<ID, ForeshadowingTreatmentMode>): string {
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

export function stringifyTimelineEvent(event: TimelineEvent): string {
  return [event.title, event.storyTime, event.narrativeOrder, event.result, event.downstreamImpact].join('\n')
}

export function foreshadowingPriority(item: Foreshadowing, overrides?: Record<ID, ForeshadowingTreatmentMode>): number {
  const treatmentMode = effectiveTreatmentMode(item, overrides)
  return TREATMENT_PRIORITY[treatmentMode] * 10 + WEIGHT_PRIORITY[item.weight]
}

export function compareForeshadowingForPrompt(
  a: Foreshadowing,
  b: Foreshadowing,
  context: ScoringContext
): number {
  const statusDelta = FORESHADOWING_STATUS_PRIORITY[b.status] - FORESHADOWING_STATUS_PRIORITY[a.status]
  if (statusDelta !== 0) return statusDelta
  const weightDelta = WEIGHT_PRIORITY[b.weight] - WEIGHT_PRIORITY[a.weight]
  if (weightDelta !== 0) return weightDelta
  const scoreDelta = evaluateForeshadowing(b, context) - evaluateForeshadowing(a, context)
  if (scoreDelta !== 0) return scoreDelta
  const priorityDelta =
    foreshadowingPriority(b, context.foreshadowingTreatmentOverrides) -
    foreshadowingPriority(a, context.foreshadowingTreatmentOverrides)
  if (priorityDelta !== 0) return priorityDelta
  const orderDelta = (a.firstChapterOrder ?? Number.MAX_SAFE_INTEGER) - (b.firstChapterOrder ?? Number.MAX_SAFE_INTEGER)
  if (orderDelta !== 0) return orderDelta
  return a.title.localeCompare(b.title, 'zh-Hans-CN')
}

export function isForeshadowingForbidden(item: Foreshadowing, task?: Partial<ChapterTask> | null): boolean {
  const forbidden = forbiddenTaskText(task)
  if (!forbidden) return false
  const allowed = textValue(task?.allowedPayoffs)
  const itemText = [item.title, item.description, item.relatedMainPlot].join('\n')
  const forbiddenMatch = textMentions(forbidden, item.title) || textOverlapScore(itemText, extractTaskTerms(forbidden), 20) > 0
  const allowedMatch = textMentions(allowed, item.title) || textOverlapScore(itemText, extractTaskTerms(allowed), 20) > 0
  return forbiddenMatch && !allowedMatch
}

export function contextNeedPriorityScore(priority: ContextNeedPriority): number {
  if (priority === 'must') return 100
  if (priority === 'high') return 78
  if (priority === 'medium') return 52
  return 24
}

function needMatchesRetrievalType(need: ContextNeedItem, type: string): boolean {
  const sourceHintByType: Record<string, ContextNeedSourceHint[]> = {
    character_card: ['character'],
    character_state: ['character_state', 'character'],
    foreshadowing: ['foreshadowing'],
    timeline: ['timeline'],
    stage_summary: ['stageSummary'],
    recent_chapter: ['recentChapter', 'chapterEnding'],
    chapter_ending: ['chapterEnding'],
    story_bible: ['worldbuilding'],
    hard_canon: ['hardCanon'],
    story_direction: ['storyDirection']
  }
  return (sourceHintByType[type] ?? []).includes(need.sourceHint) || need.needType === type
}

export function planPriority(context: ScoringContext, type: string, id: ID): number {
  const explicitPriority = context.contextNeedPlan?.retrievalPriorities.find((item) => item.type === type && item.id === id)?.priority
  const explicitScore = typeof explicitPriority === 'number' ? Math.max(0, Math.min(100, explicitPriority)) : 0
  const needScore = (context.contextNeedPlan?.contextNeeds ?? [])
    .filter((need) => needMatchesRetrievalType(need, type))
    .filter((need) => !need.sourceId || need.sourceId === id)
    .reduce((best, need) => Math.max(best, contextNeedPriorityScore(need.priority) - (need.uncertain ? 10 : 0)), 0)
  return Math.max(explicitScore, needScore)
}

export function foreshadowingOmitReason(item: Foreshadowing, budgetProfile: ContextBudgetProfile, context?: ScoringContext): string {
  if (context?.planForbiddenForeshadowingIds.has(item.id)) return '本章需求计划将该伏笔列为 forbidden，不应进入 prompt。'
  if (item.status === 'resolved' || item.status === 'abandoned') return '已回收或废弃，未被手动选择。'
  if (isForeshadowingForbidden(item, context?.task)) return '本章任务书禁止提及或回收该伏笔。'
  const treatmentMode = effectiveTreatmentMode(item, context?.foreshadowingTreatmentOverrides)
  const treatmentReason = treatmentOmitReason(treatmentMode)
  if (treatmentReason) return `${treatmentReason}。`
  if (!budgetProfile.includeForeshadowingWeights.includes(item.weight)) return '权重未进入当前预算配置。'
  return 'token 预算不足，相关性低于本章推进优先级。'
}

export function evaluateChapter(chapter: Chapter, context: ScoringContext): number {
  const text = stringifyChapter(chapter)
  const terms = extractTaskTerms(taskText(context.task))
  const recencyDistance = Math.max(1, context.targetChapterOrder - chapter.order)
  const recencyScore = Math.max(0, 32 - recencyDistance * 5)
  const taskScore = textOverlapScore(text, terms, 30)
  const hookScore = textOverlapScore([chapter.endingHook, chapter.riskWarnings].join('\n'), terms, 12)
  const planScore = Math.max(planPriority(context, 'recent_chapter', chapter.id), planPriority(context, 'chapter_ending', chapter.id)) * 0.25
  return clampScore(20 + recencyScore + taskScore + hookScore + planScore + tokenEfficiencyScore(itemCost(text)))
}

export function evaluateStageSummary(summary: StageSummary, context: ScoringContext): number {
  const text = stringifyStageSummary(summary)
  const terms = extractTaskTerms(taskText(context.task))
  const distance = Math.max(1, context.targetChapterOrder - summary.chapterEnd)
  const recencyScore = Math.max(0, 26 - distance * 3)
  const taskScore = textOverlapScore(text, terms, 34)
  const coversRecentArc = context.targetChapterOrder - summary.chapterEnd <= 6 ? 12 : 0
  const planScore = planPriority(context, 'stage_summary', summary.id) * 0.22
  return clampScore(18 + recencyScore + taskScore + coversRecentArc + planScore + tokenEfficiencyScore(itemCost(text)))
}

export function evaluateCharacter(character: Character, context: ScoringContext): number {
  if (context.forcedCharacterIds.has(character.id)) return 100
  const text = stringifyCharacterForPlan(character, context.contextNeedPlan)
  const task = taskText(context.task)
  const terms = extractTaskTerms(task)
  const plannedAppearanceScore = textMentions(task, character.name) ? 34 : 0
  const planScore = Math.max(
    context.planCharacterIds.has(character.id) ? 18 : 0,
    Math.round(Math.max(planPriority(context, 'character_card', character.id), planPriority(context, 'character_state', character.id)) * 0.42)
  )
  const taskScore = textOverlapScore(text, terms, 24)
  const relationScore = context.relatedCharacterIds.has(character.id) ? 18 : 0
  const mainScore = character.isMain ? 14 : 0
  return clampScore(18 + plannedAppearanceScore + planScore + taskScore + relationScore + mainScore + tokenEfficiencyScore(itemCost(text)))
}

export function evaluateForeshadowing(item: Foreshadowing, context: ScoringContext): number {
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

export function evaluateTimelineEvent(event: TimelineEvent, context: ScoringContext): number {
  const text = stringifyTimelineEvent(event)
  const terms = extractTaskTerms(taskText(context.task))
  const distance = event.chapterOrder === null ? 8 : Math.max(1, context.targetChapterOrder - event.chapterOrder)
  const recencyScore = Math.max(0, 24 - distance * 3)
  const planScore = planPriority(context, 'timeline', event.id) * 0.35
  return clampScore(12 + recencyScore + planScore + textOverlapScore(text, terms, 36) + tokenEfficiencyScore(itemCost(text)))
}

import type {
  ContextDecisionReasonCode,
  ContextNeedPriority,
  ContextNeedPlan,
  ContextSelectionResult,
  ID
} from '../../shared/types'

import { TokenEstimator } from '../TokenEstimator'
import { replacementTextForCompressedChapter } from '../ContextCompressionService'
import type { ProjectContextData } from './types'
import {
  byId,
  itemCost,
  stringifyCharacterForPlan,
  stringifyChapter,
  stringifyForeshadowing,
  stringifyStageSummary,
  stringifyTimelineEvent
} from './scoringEngine'

export function scored<T extends { id: ID }>(items: T[], score: (item: T) => number): Array<{ item: T; score: number }> {
  return items.map((item) => ({ item, score: score(item) }))
}

export function byScoreThenOrder<T>(a: { item: T; score: number }, b: { item: T; score: number }, order: (item: T) => number): number {
  const scoreDelta = b.score - a.score
  if (scoreDelta !== 0) return scoreDelta
  return order(a.item) - order(b.item)
}

export function mergeUniqueById<T extends { id: ID }>(primary: T[], secondary: T[]): T[] {
  const seen = new Set<ID>()
  return [...primary, ...secondary].filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

export function selectionCost(data: ProjectContextData, selection: ContextSelectionResult, styleSampleMaxChars: number, contextNeedPlan?: ContextNeedPlan | null): number {
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

export interface ContextOmissionOptions {
  reasonCode: ContextDecisionReasonCode
  priority?: ContextNeedPriority
  uncertain?: boolean
  replacementSourceId?: ID | null
}

export function omit(
  selection: ContextSelectionResult,
  type: string,
  id: ID | null,
  reason: string,
  estimatedTokensSaved: number,
  options: ContextOmissionOptions
) {
  const omission = {
    type,
    id,
    reason,
    reasonCode: options.reasonCode,
    priority: options.priority ?? 'low',
    uncertain: options.uncertain ?? false,
    replacementSourceId: options.replacementSourceId ?? null,
    estimatedTokensSaved: Math.max(0, estimatedTokensSaved)
  }
  const existingIndex = selection.omittedItems.findIndex((item) => item.type === type && item.id === id)
  if (existingIndex >= 0) selection.omittedItems[existingIndex] = omission
  else selection.omittedItems.push(omission)
}

export function removeOne(
  selection: ContextSelectionResult,
  field: keyof Pick<
    ContextSelectionResult,
    'selectedChapterIds' | 'selectedStageSummaryIds' | 'selectedCharacterIds' | 'selectedForeshadowingIds' | 'selectedTimelineEventIds'
  >,
  id: ID
) {
  selection[field] = selection[field].filter((item) => item !== id)
}

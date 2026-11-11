import type { Chapter, ID } from '../../shared/types'
import { isChapterArchived, nextChapterOrder } from '../ChapterLifecycleService'
import { visibleCharacterCount } from '../chapterTaskContractText'

export interface BookChapterRange { from: number; to: number }

export function appendRange(ranges: BookChapterRange[], from: number, to: number) {
  if (to < from) return
  const last = ranges.at(-1)
  if (last && last.to + 1 === from) last.to = to
  else ranges.push({ from, to })
}

export function chapterSlots(chapters: readonly Chapter[], projectId: ID) {
  const slots = new Map<number, Chapter>()
  const rank = (chapter: Chapter) => isChapterArchived(chapter) ? 0 : chapter.body.trim() ? 2 : 1
  for (const c of chapters) {
    if (c.projectId !== projectId || !Number.isSafeInteger(c.order) || c.order < 1) continue
    const prev = slots.get(c.order)
    if (!prev || rank(c) > rank(prev) || (rank(c) === rank(prev) &&
      (c.updatedAt > prev.updatedAt || (c.updatedAt === prev.updatedAt && c.id > prev.id)))) slots.set(c.order, c)
  }
  return slots
}

export function manuscriptCounts(slots: Map<number, Chapter>) {
  let totalWords = 0, chapterCount = 0
  const completeRanges: BookChapterRange[] = []
  const wordsByOrder = new Map<number, number>()
  for (const order of [...slots.keys()].sort((a, b) => a - b)) {
    const c = slots.get(order)!
    const words = isChapterArchived(c) ? 0 : visibleCharacterCount(c.body)
    wordsByOrder.set(order, words)
    if (!words) continue
    totalWords += words
    chapterCount++
    appendRange(completeRanges, order, order)
  }
  const completeThrough = completeRanges[0]?.from === 1 ? completeRanges[0].to : 0
  return { totalWords, chapterCount, completeThrough, completeRanges, wordsByOrder }
}

export function summarizeBookManuscript(chapters: readonly Chapter[], projectId: ID) {
  const { wordsByOrder: _counts, ...summary } = manuscriptCounts(chapterSlots(chapters, projectId))
  return { ...summary, nextAssignableOrder: nextChapterOrder(chapters, projectId) }
}

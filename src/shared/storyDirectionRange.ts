export const MAX_STORY_DIRECTION_CHAPTERS = 30
export const DEFAULT_STORY_DIRECTION_CHAPTERS = 5

export interface StoryDirectionRange {
  startChapterOrder: number
  endChapterOrder: number
  horizonChapters: number
}

export function isChapterOrder(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

export function isStoryDirectionLength(value: unknown): value is number {
  return isChapterOrder(value) && value <= MAX_STORY_DIRECTION_CHAPTERS
}

type RangeResult = { range: StoryDirectionRange; error?: never } | { range?: never; error: string }

// Only callers using the old start + length contract may omit the end.
export function inspectStoryDirectionRange(start: unknown, end: unknown, length?: unknown): RangeResult {
  if (!isChapterOrder(start)) return { error: '起始章节必须是可安全表示的正整数。' }
  if (length !== undefined && !isStoryDirectionLength(length)) {
    return { error: `导向长度 horizonChapters 必须是 1 到 ${MAX_STORY_DIRECTION_CHAPTERS} 的整数。` }
  }
  const last = end === undefined && isStoryDirectionLength(length) ? start + (length - 1) : end
  if (!isChapterOrder(last)) return { error: '结束章节必须是可安全表示的正整数。' }
  if (last < start) return { error: `结束章节（${last}）不能早于起始章节（${start}）。` }
  const count = last - start + 1
  if (count > MAX_STORY_DIRECTION_CHAPTERS) {
    return { error: `第 ${start}-${last} 章共 ${count} 章，单条剧情导向最多 ${MAX_STORY_DIRECTION_CHAPTERS} 章。请拆分章段。` }
  }
  return { range: { startChapterOrder: start, endChapterOrder: last, horizonChapters: count } }
}

export function storyDirectionLengthConflict(range: StoryDirectionRange, suppliedLength: unknown): string | null {
  if (!isChapterOrder(suppliedLength) || suppliedLength === range.horizonChapters) return null
  return `导向长度冲突：记录长度为 ${suppliedLength} 章，第 ${range.startChapterOrder}-${range.endChapterOrder} 章实际为 ${range.horizonChapters} 章，已按起止章号计算。`
}

export function coversStoryDirectionChapter(guide: StoryDirectionRange, chapter: number): boolean {
  return isChapterOrder(chapter) && chapter >= guide.startChapterOrder && chapter <= guide.endChapterOrder &&
    !!inspectStoryDirectionRange(guide.startChapterOrder, guide.endChapterOrder).range
}

type BeatPosition = { chapterOffset: number; chapterOrder: number }

// An authored guide may have only strategic guidance or individual beats.
// A generated sheet must explicitly identify every chapter exactly once.
export function assertStoryDirectionBeats(
  beats: unknown, range: StoryDirectionRange, complete: boolean
): asserts beats is (BeatPosition & Record<string, unknown>)[] {
  const { startChapterOrder: start, endChapterOrder: end, horizonChapters: count } = range
  if (!Array.isArray(beats)) throw new Error('chapterBeats 必须是章节节拍数组。')
  if (beats.length > count) throw new Error(`第 ${start}-${end} 章最多有 ${count} 个节拍，实际返回 ${beats.length} 个。`)
  const seen = new Set<number>()
  for (const [index, beat] of beats.entries()) {
    const offset: unknown = beat?.chapterOffset, order: unknown = beat?.chapterOrder
    if (!isChapterOrder(offset) || !isChapterOrder(order)) {
      throw new Error(`第 ${index + 1} 个节拍的 chapterOffset 和 chapterOrder 必须是正整数，不能缺省。`)
    }
    if (order < start || order > end || offset > count) {
      throw new Error(`第 ${index + 1} 个节拍越界：章号 ${order}、序号 ${offset}，预期章号 ${start}-${end}、序号 1-${count}。`)
    }
    if (order - start + 1 !== offset) {
      throw new Error(`第 ${order} 章的节拍序号应为 ${order - start + 1}，实际为 ${offset}。`)
    }
    if (seen.has(order)) throw new Error(`第 ${order} 章的节拍重复。`)
    seen.add(order)
  }
  if (complete && seen.size !== count) {
    const missing = Array.from({ length: count }, (_, i) => start + i).filter(order => !seen.has(order))
    throw new Error(`需要 ${count} 个节拍，实际为 ${seen.size} 个；缺少章号：${missing.join('、')}。`)
  }
}

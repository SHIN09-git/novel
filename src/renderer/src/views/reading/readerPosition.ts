import type { ID } from '../../../../shared/types'

export interface ReaderPosition {
  version: 1
  chapterId: ID
  anchorText: string | null
  anchorOffsetRatio: number
  chapterProgress: number
  viewportRatio: number
}

export interface ReaderPositionChapter {
  id: ID
  paragraphs: string[]
}

export interface ReaderPositionResolution {
  chapterId: ID
  kind: 'anchor' | 'chapter'
  paragraphIndex: number | null
  anchorOffsetRatio: number
  viewportRatio: number
}

export interface ReaderPositionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const POSITION_VERSION = 1 as const

function clampRatio(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

export function readerPositionStorageKey(projectId: ID): string {
  return `novel-director:reader-position:${encodeURIComponent(projectId)}`
}

export function normalizeReaderAnchor(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function createReaderPosition(input: {
  chapterId: ID
  anchorText?: string | null
  anchorOffsetRatio?: number
  chapterProgress?: number
  viewportRatio?: number
}): ReaderPosition {
  const anchorText = input.anchorText ? normalizeReaderAnchor(input.anchorText) : null
  return {
    version: POSITION_VERSION,
    chapterId: input.chapterId,
    anchorText: anchorText || null,
    anchorOffsetRatio: clampRatio(input.anchorOffsetRatio ?? 0),
    chapterProgress: clampRatio(input.chapterProgress ?? 0),
    viewportRatio: clampRatio(input.viewportRatio ?? 0.25)
  }
}

function isReaderPosition(value: unknown): value is ReaderPosition {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<ReaderPosition>
  return item.version === POSITION_VERSION && typeof item.chapterId === 'string' && Boolean(item.chapterId) &&
    (typeof item.anchorText === 'string' || item.anchorText === null) &&
    Number.isFinite(item.anchorOffsetRatio) && Number.isFinite(item.chapterProgress) && Number.isFinite(item.viewportRatio)
}

export function readReaderPosition(storage: ReaderPositionStorage | null, projectId: ID): ReaderPosition | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(readerPositionStorageKey(projectId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isReaderPosition(parsed) ? createReaderPosition(parsed) : null
  } catch {
    return null
  }
}

export function writeReaderPosition(storage: ReaderPositionStorage | null, projectId: ID, position: ReaderPosition): void {
  if (!storage) return
  try {
    storage.setItem(readerPositionStorageKey(projectId), JSON.stringify(position))
  } catch {
    // Session storage is optional workspace convenience state.
  }
}

export function resolveReaderPosition(
  position: ReaderPosition,
  chapters: ReadonlyArray<ReaderPositionChapter>
): ReaderPositionResolution | null {
  const chapter = chapters.find((item) => item.id === position.chapterId)
  if (!chapter) return null
  const anchor = position.anchorText ? normalizeReaderAnchor(position.anchorText) : ''
  if (anchor) {
    const matches = chapter.paragraphs.reduce<number[]>((indexes, paragraph, index) => {
      if (normalizeReaderAnchor(paragraph) === anchor) indexes.push(index)
      return indexes
    }, [])
    if (matches.length === 1) {
      return {
        chapterId: chapter.id,
        kind: 'anchor',
        paragraphIndex: matches[0],
        anchorOffsetRatio: clampRatio(position.anchorOffsetRatio),
        viewportRatio: clampRatio(position.viewportRatio)
      }
    }
  }
  return {
    chapterId: chapter.id,
    kind: 'chapter',
    paragraphIndex: null,
    anchorOffsetRatio: 0,
    viewportRatio: clampRatio(position.viewportRatio)
  }
}

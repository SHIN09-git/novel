import type { Chapter, ID, TimelineEvent, TimelineTimeFields } from '../types'
import { objectOrEmpty, stringArrayValue, stringValue } from './common'

const textFields = ['timelineKey', 'location', 'timeAnchor', 'deadlineKey', 'sourceExcerpt'] as const
const dayFields = ['elapsedDays', 'remainingDays'] as const
export const timelineSeasons = ['spring', 'summer', 'autumn', 'winter'] as const
export const timelineShifts = ['flashback', 'time_skip'] as const
export const timelineTimeFields = [...textFields, ...dayFields, 'season', 'timeShift'] as const

export function isTimelineDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function timelineTimeValues(input: object, strict = false): TimelineTimeFields {
  const raw = objectOrEmpty(input)
  const fields: TimelineTimeFields = {}
  for (const key of timelineTimeFields) {
    const value = raw[key]
    if (value == null) continue
    if (key === 'elapsedDays' || key === 'remainingDays') {
      if (isTimelineDay(value)) { fields[key] = value; continue }
    } else if (key === 'season') {
      if (timelineSeasons.some((s) => s === value)) { fields[key] = value as TimelineEvent['season']; continue }
    } else if (key === 'timeShift') {
      if (timelineShifts.some((s) => s === value)) { fields[key] = value as TimelineEvent['timeShift']; continue }
    } else if (typeof value === 'string') {
      if (value.trim()) fields[key] = value.trim()
      continue
    }
    if (strict) throw new Error(`时间线字段 ${key} 的值无效。`)
  }
  return fields
}

// Include archived and empty chapters in uniqueness checks. Their number may have been reused.
export function timelineChapterIndex(chapters: readonly Chapter[]) {
  const projects = new Map<ID, Map<string | number, Chapter | null>>()
  for (const chapter of chapters) {
    if (typeof chapter?.projectId !== 'string' || !chapter.projectId.trim()) continue
    let index = projects.get(chapter.projectId)
    if (!index) projects.set(chapter.projectId, index = new Map())
    const hasId = typeof chapter.id === 'string' && !!chapter.id.trim()
    if (hasId) index.set(chapter.id, index.has(chapter.id) ? null : chapter)
    if (isTimelineDay(chapter.order) && chapter.order > 0) {
      index.set(chapter.order, !hasId || index.has(chapter.order) ? null : chapter)
    }
  }
  return projects
}

type ChapterIndex = ReturnType<typeof timelineChapterIndex>

export function timelineChapterFor(index: Map<string | number, Chapter | null> | undefined, id: unknown, order: unknown) {
  const ref = typeof id === 'string' ? id.trim() : id === undefined && isTimelineDay(order) ? order : undefined
  const found = ref === undefined ? undefined : index?.get(ref)
  return found && index?.get(found.id) === found ? found : undefined
}

function normalizedEvent(input: unknown, chapters?: ChapterIndex): TimelineEvent {
  const raw = objectOrEmpty(input)
  const rest = { ...raw }
  for (const key of timelineTimeFields) delete rest[key]
  delete rest.chapterId
  const projectId = stringValue(raw.projectId)
  const order = isTimelineDay(raw.chapterOrder) ? raw.chapterOrder : null
  const index = chapters?.get(projectId)
  const id = stringValue(raw.chapterId).trim()
  // Never fall back from a broken ID or a previously unresolved binding to a reused number.
  const bound = timelineChapterFor(index, raw.chapterId, order)
  const knownBinding = raw.chapterId !== undefined || (chapters !== undefined && order !== null)
  return {
    ...rest, ...timelineTimeValues(raw),
    id: stringValue(raw.id), projectId, title: stringValue(raw.title),
    ...(knownBinding ? { chapterId: id || bound?.id || null } : {}),
    chapterOrder: bound?.order ?? order, storyTime: stringValue(raw.storyTime),
    narrativeOrder: typeof raw.narrativeOrder === 'number' && Number.isFinite(raw.narrativeOrder) ? raw.narrativeOrder : 0,
    participantCharacterIds: stringArrayValue(raw.participantCharacterIds),
    result: stringValue(raw.result), downstreamImpact: stringValue(raw.downstreamImpact),
    createdAt: stringValue(raw.createdAt), updatedAt: stringValue(raw.updatedAt)
  }
}

/** Bind a legacy number against the old layout before changing the projected chapter numbers. */
export function relocateTimelineChapters(events: TimelineEvent[], oldChapters: Chapter[], projectId: ID, newOrders: Map<ID, number>) {
  if (!events.length) return events
  const index = timelineChapterIndex(oldChapters).get(projectId)
  return events.map(e => {
    if (e.projectId !== projectId || e.chapterId == null && e.chapterOrder == null) return e
    const ch = timelineChapterFor(index, e.chapterId, e.chapterOrder)
    const chapterId = e.chapterId !== undefined ? e.chapterId : ch?.id ?? null
    const chapterOrder = ch ? newOrders.get(ch.id) ?? ch.order : e.chapterOrder
    return e.chapterId === chapterId && e.chapterOrder === chapterOrder ? e : { ...e, chapterId, chapterOrder }
  })
}

export function normalizeTimelineEvents(events: readonly unknown[], chapters?: readonly Chapter[]): TimelineEvent[] {
  if (!events.length) return []
  const index = chapters && timelineChapterIndex(chapters)
  return events.map((event) => normalizedEvent(event, index))
}

export function editTimelineEvent(event: TimelineEvent, patch: Partial<TimelineEvent>, chapters: readonly Chapter[]): TimelineEvent {
  const index = timelineChapterIndex(chapters)
  if (patch.chapterId != null) {
    const chapter = index.get(event.projectId)?.get(patch.chapterId)
    if (!chapter || chapter.archivedAt?.trim()) throw new Error('时间线 chapterId 不属于本项目唯一的未归档章节。')
  }
  timelineTimeValues(patch, true)
  const next = { ...event, ...patch }
  if ('chapterOrder' in patch && !('chapterId' in patch)) delete next.chapterId
  if (patch.chapterId === null && !('chapterOrder' in patch)) next.chapterOrder = null
  return normalizedEvent(next, index)
}

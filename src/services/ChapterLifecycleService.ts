import type { AppData, Chapter, ID } from '../shared/types'

export interface RestoreArchivedChapterResult {
  data: AppData
  chapter: Chapter
  orderChanged: boolean
}

export function isChapterArchived(chapter: Chapter): boolean {
  return Boolean(chapter.archivedAt?.trim())
}

export function activeChapters<T extends Chapter>(chapters: readonly T[]): T[] {
  return chapters.filter((chapter) => !isChapterArchived(chapter))
}

export function archivedChapters<T extends Chapter>(chapters: readonly T[]): T[] {
  return chapters.filter(isChapterArchived)
}

export function nextChapterOrder(chapters: readonly Chapter[], projectId: ID): number {
  return chapters
    .filter((chapter) => chapter.projectId === projectId)
    .reduce((highest, chapter) => Math.max(highest, chapter.order), 0) + 1
}

export function findActiveChapterByOrder(
  chapters: readonly Chapter[],
  projectId: ID,
  chapterOrder: number
): Chapter | null {
  return chapters.find(
    (chapter) => chapter.projectId === projectId && chapter.order === chapterOrder && !isChapterArchived(chapter)
  ) ?? null
}

export function archiveChapterInAppData(appData: AppData, chapterId: ID, archivedAt: string): AppData {
  const chapter = appData.chapters.find((item) => item.id === chapterId)
  if (!chapter) throw new Error(`Chapter not found: ${chapterId}`)
  if (isChapterArchived(chapter)) return appData

  return {
    ...appData,
    projects: appData.projects.map((project) =>
      project.id === chapter.projectId ? { ...project, updatedAt: archivedAt } : project
    ),
    chapters: appData.chapters.map((item) =>
      item.id === chapterId ? { ...item, archivedAt, updatedAt: archivedAt } : item
    )
  }
}

export function restoreArchivedChapterInAppData(
  appData: AppData,
  chapterId: ID,
  restoredAt: string
): RestoreArchivedChapterResult {
  const chapter = appData.chapters.find((item) => item.id === chapterId)
  if (!chapter) throw new Error(`Chapter not found: ${chapterId}`)
  if (!isChapterArchived(chapter)) return { data: appData, chapter, orderChanged: false }

  const orderOccupied = appData.chapters.some(
    (item) =>
      item.id !== chapter.id &&
      item.projectId === chapter.projectId &&
      item.order === chapter.order &&
      !isChapterArchived(item)
  )
  const restoredChapter: Chapter = {
    ...chapter,
    order: orderOccupied ? nextChapterOrder(appData.chapters, chapter.projectId) : chapter.order,
    archivedAt: null,
    updatedAt: restoredAt
  }

  return {
    data: {
      ...appData,
      projects: appData.projects.map((project) =>
        project.id === chapter.projectId ? { ...project, updatedAt: restoredAt } : project
      ),
      chapters: appData.chapters.map((item) => (item.id === chapterId ? restoredChapter : item))
    },
    chapter: restoredChapter,
    orderChanged: orderOccupied
  }
}

export function reorderChapterInAppData(
  appData: AppData,
  chapterId: ID,
  requestedOrder: number,
  updatedAt: string
): AppData {
  const chapter = appData.chapters.find((item) => item.id === chapterId)
  if (!chapter) throw new Error(`Chapter not found: ${chapterId}`)
  if (isChapterArchived(chapter)) throw new Error('Archived chapters cannot be reordered.')

  const nextOrder = Math.max(1, Math.floor(requestedOrder))
  if (nextOrder === chapter.order) return appData
  const occupied = appData.chapters.find(
    (item) =>
      item.id !== chapter.id &&
      item.projectId === chapter.projectId &&
      item.order === nextOrder &&
      !isChapterArchived(item)
  )
  const changedOrders = new Map<ID, number>([[chapter.id, nextOrder]])
  if (occupied) changedOrders.set(occupied.id, chapter.order)

  const chapters = appData.chapters.map((item) => {
    const order = changedOrders.get(item.id)
    return order === undefined ? item : { ...item, order, updatedAt }
  })
  return {
    ...appData,
    projects: appData.projects.map((item) =>
      item.id === chapter.projectId ? { ...item, updatedAt } : item
    ),
    chapters,
    chapterContinuityBridges: appData.chapterContinuityBridges.map((bridge) => {
      const fromOrder = changedOrders.get(bridge.fromChapterId)
      return fromOrder === undefined ? bridge : { ...bridge, toChapterOrder: fromOrder + 1, updatedAt }
    })
  }
}

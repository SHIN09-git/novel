import type { AppData, Chapter, ChapterTitleReceipt } from './types'

export function applyTitleReceiptToChapters(chapters: Chapter[], receipt: ChapterTitleReceipt): Chapter[] {
  const changes = new Map(receipt.rows.filter(r => r.oldTitle !== r.newTitle).map(r => [r.chapterId, r.newTitle]))
  return chapters.map(ch => ch.projectId === receipt.projectId && changes.has(ch.id)
    ? { ...ch, title: changes.get(ch.id)!, updatedAt: receipt.createdAt } : ch)
}

export function chapterTitleHistory(data: Pick<AppData, 'chapterTitleReceipts'>, chapter: Pick<Chapter, 'id' | 'projectId'>) {
  return (data.chapterTitleReceipts ?? []).filter(r => r.projectId === chapter.projectId)
    .flatMap(receipt => {
      const row = receipt.rows.find(r => r.chapterId === chapter.id && r.oldTitle !== r.newTitle)
      return row ? [{ row, receipt }] : []
    }).sort((a, b) => b.receipt.createdAt.localeCompare(a.receipt.createdAt) || b.receipt.id.localeCompare(a.receipt.id))
}

/** Rewind only changes made after this immutable version existed; imported clocks are not ordering proof. */
export function chapterTitleForVersion(data: AppData, chapter: Chapter) {
  const history = chapterTitleHistory(data, chapter).map(({ row }) => ({ ...row, prior: new Set(row.priorVersionIds) }))
  return (versionId: string) => {
    let title = chapter.title
    for (const row of history) {
      if (title !== row.newTitle || !row.prior.has(versionId)) break
      title = row.oldTitle
    }
    return title
  }
}

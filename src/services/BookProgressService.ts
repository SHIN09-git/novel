import type { AppData, GeneratedChapterDraft, ID } from '../shared/types'
import { bookWordGoal } from '../shared/normalizers/bookWordTarget'
import { isChapterArchived, nextChapterOrder } from './ChapterLifecycleService'
import { appendRange, chapterSlots, manuscriptCounts, type BookChapterRange } from './bookProgress/manuscript'
export { summarizeBookManuscript, type BookChapterRange } from './bookProgress/manuscript'
import { createBookWritebackIndex } from './BookWritebackService'
import { unresolvedChapterWritebackFailures } from './ChapterWritebackFailureService'

export const BOOK_PROGRESS_COLLECTIONS = [
  'projects', 'chapters', 'chapterGenerationJobs', 'generatedChapterDrafts', 'chapterVersions',
  'chapterCommitBundles', 'revisionCommitBundles', 'chapterWritebackFailures'
] as const satisfies readonly (keyof AppData)[]
export type BookProgressData = Pick<AppData, typeof BOOK_PROGRESS_COLLECTIONS[number]>
export type BookManuscriptStatus = 'committed' | 'historical' | 'empty' | 'draft_only' | 'missing' | 'archived'
export interface BookProgressRow {
  order: number
  chapterId: ID | null
  title: string
  status: BookManuscriptStatus | 'writeback_failed'
  manuscriptStatus: BookManuscriptStatus
  wordCount: number
  jobId: ID | null
  draftId: ID | null
  versionId: ID | null
  commitId: ID | null
  writebackFailure?: AppData['chapterWritebackFailures'][number]
}
export interface BookProgressOptions {
  fromChapter?: number
  toChapter?: number
  offset?: number
  limit?: number
  issuesOnly?: boolean
}

function checked(value: number | undefined, fallback: number, min: number, label: string) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < min) throw new Error(label + '不是有效整数。')
  return value
}

const isIssue = (r: BookProgressRow) =>
  r.status !== 'historical' && r.status !== 'committed' && r.status !== 'archived'

function missingRow(order: number): BookProgressRow {
  return { order, chapterId: null, title: '', wordCount: 0, status: 'missing', manuscriptStatus: 'missing',
    draftId: null, jobId: null, versionId: null, commitId: null }
}

export function createBookProgressReader(data: BookProgressData, projectId: ID) {
  const project = data.projects.find(p => p.id === projectId)
  if (!project) throw new Error('找不到要核对的项目。')
  const slots = chapterSlots(data.chapters, projectId)
  const { wordsByOrder, ...totals } = manuscriptCounts(slots)
  const openFailures = unresolvedChapterWritebackFailures(data, projectId)
  const receipts = createBookWritebackIndex(data, projectId, openFailures)
  const chapterById = new Map(data.chapters.filter(c => c.projectId === projectId).map(c => [c.id, c]))
  const jobOrders = new Map(data.chapterGenerationJobs.filter(j => j.projectId === projectId).map(j => [j.id, j.targetChapterOrder]))
  const drafts = new Map<number, GeneratedChapterDraft>()
  for (const draft of data.generatedChapterDrafts) {
    if (draft.projectId !== projectId || draft.status === 'rejected' || !draft.body.trim()) continue
    const chapter = draft.chapterId ? chapterById.get(draft.chapterId) : undefined
    const order = chapter?.order ?? jobOrders.get(draft.jobId)
    if (!order || !Number.isSafeInteger(order) || order < 1 || (chapter && isChapterArchived(chapter))) continue
    // Some old imports retain an accepted draft but no manuscript: surface the recoverable text, not a false commit.
    if (draft.status === 'accepted' && wordsByOrder.get(order)) continue
    const prev = drafts.get(order)
    if (!prev || draft.updatedAt > prev.updatedAt || (draft.updatedAt === prev.updatedAt && draft.id > prev.id)) drafts.set(order, draft)
  }
  const failures = new Map<number, NonNullable<BookProgressRow['writebackFailure']>>()
  for (const failure of openFailures) {
    const chapter = failure.chapterId ? chapterById.get(failure.chapterId) : undefined
    if (chapter && isChapterArchived(chapter)) continue
    const order = chapter?.order ?? failure.chapterOrder
    const prev = failures.get(order)
    if (!prev || failure.attemptedAt > prev.attemptedAt || (failure.attemptedAt === prev.attemptedAt && failure.id > prev.id)) failures.set(order, failure)
  }
  const orders = [...new Set([...slots.keys(), ...drafts.keys(), ...failures.keys()])].sort((a, b) => a - b)
  const known = orders.map((order): BookProgressRow => {
    const c = slots.get(order), d = drafts.get(order), failure = failures.get(order)
    const words = wordsByOrder.get(order) ?? 0
    const receipt = c && words ? receipts.current(c) : null
    const manuscriptStatus: BookManuscriptStatus = words ? receipt ? 'committed' : 'historical'
      : d ? 'draft_only' : c ? isChapterArchived(c) ? 'archived' : 'empty' : 'missing'
    return { order, chapterId: c?.id ?? null, title: c?.title || d?.title || '',
      wordCount: words, manuscriptStatus, status: failure ? 'writeback_failed' : manuscriptStatus,
      jobId: failure?.jobId ?? d?.jobId ?? receipt?.jobId ?? null,
      draftId: failure?.draftId ?? d?.id ?? receipt?.draftId ?? null, versionId: receipt?.versionId ?? null,
      commitId: receipt?.commitId ?? null, ...(failure ? { writebackFailure: failure } : {}) }
  })
  const summary = { projectId, ...totals, nextAssignableOrder: nextChapterOrder(data.chapters, projectId),
    goal: bookWordGoal(totals.totalWords, project.bookWordTarget) }
  return (options: BookProgressOptions = {}) => ({ ...summary, ...readPage(known, options) })
}

function readPage(known: readonly BookProgressRow[], options: BookProgressOptions) {
  const from = checked(options.fromChapter, 1, 1, '起始章号')
  const to = checked(options.toChapter, known.at(-1)?.order ?? 0, 1, '结束章号')
  if (options.toChapter !== undefined && to < from) throw new Error('结束章号不能早于起始章号。')
  const offset = checked(options.offset, 0, 0, '起始位置')
  const limit = Math.min(200, checked(options.limit, 50, 1, '每页条数'))
  const rows: BookProgressRow[] = [], missingRanges: BookChapterRange[] = []
  let totalRows = 0, rangeWords = 0, cursor = from
  // Materialise only the requested page, even when an imported book jumps millions of orders.
  const addGap = (start: number, end: number) => {
    if (end < start) return
    appendRange(missingRanges, start, end)
    const size = end - start + 1
    const first = Math.max(0, offset - totalRows)
    const count = Math.min(size - first, limit - rows.length)
    for (let i = 0; i < count; i++) rows.push(missingRow(start + first + i))
    totalRows += size
  }
  for (const row of known) {
    const order = row.order
    if (order < from || order > to) continue
    addGap(cursor, order - 1)
    cursor = order + 1
    rangeWords += row.wordCount
    if (!row.wordCount && row.manuscriptStatus !== 'archived') appendRange(missingRanges, order, order)
    if (options.issuesOnly && !isIssue(row)) continue
    if (totalRows >= offset && rows.length < limit) rows.push(row)
    totalRows++
  }
  addGap(cursor, to)
  return { range: { fromChapter: from, toChapter: to, totalWords: rangeWords }, rows, totalRows, missingRanges }
}

export function buildBookProgress(data: BookProgressData, projectId: ID, options?: BookProgressOptions) {
  return createBookProgressReader(data, projectId)(options)
}

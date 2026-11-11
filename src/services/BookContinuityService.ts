import type { AppData, Chapter, ID } from '../shared/types'
import { isChapterArchived } from './ChapterLifecycleService'
import { createManuscriptEvidenceIndex } from './bookContinuity/manuscriptEvidence'
import { auditBookLedger } from './bookContinuity/ledgerChecks'
import { auditBookTimeline } from './bookContinuity/timelineChecks'
import type { BookAuditContext, BookAuditFinding, BookAuditOptions, BookAuditStatus } from './bookContinuity/types'

export type { BookAuditEvidence, BookAuditFinding, BookAuditKind, BookAuditOptions, BookAuditStatus } from './bookContinuity/types'
export const BOOK_CONTINUITY_COLLECTIONS = [
  'projects', 'chapters', 'chapterVersions', 'characters', 'characterStateFacts', 'characterStateTransactions', 'timelineEvents'
] as const satisfies readonly (keyof AppData)[]

function integer(value: number | undefined, fallback: number, min: number) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < min) throw new Error('全书核对的章号或分页参数无效。')
  return value
}

function manuscriptContext(data: AppData, projectId: ID, to: number): BookAuditContext {
  const counts = new Map<number, number>()
  const chapters = data.chapters.filter(c => {
    if (c.projectId !== projectId || isChapterArchived(c) || c.order < 1 || c.order > to) return false
    counts.set(c.order, (counts.get(c.order) ?? 0) + 1)
    return Boolean(c.body.trim())
  }).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const byId = new Map(chapters.map(c => [c.id, c]))
  const byOrder = new Map(chapters.filter(c => counts.get(c.order) === 1).map(c => [c.order, c]))
  const source = createManuscriptEvidenceIndex(data.chapterVersions, projectId)
  return {
    data, projectId, chapters, from: 1, to,
    chapterFor: (id, order) => id ? byId.get(id) : order ? byOrder.get(order) : undefined,
    evidence(c: Chapter, excerpt = '') {
      const quote = excerpt.trim()
      return { chapterId: c.id, chapterOrder: c.order, ...source(c),
        excerpt: quote && c.body.includes(quote) ? Array.from(quote.slice(0, 320)).slice(0, 160).join('') : '' }
    }
  }
}

const statusRank = { conflict: 0, needs_evidence: 1, open: 2 }
const endOrder = (f: BookAuditFinding) => f.evidence.reduce((max, e) => Math.max(max, e.chapterOrder), f.atChapterOrder ?? 0)

/** A reader belongs to one immutable book snapshot and cutoff. Filtering/paging reuses its scan. */
export function createBookContinuityReader(data: AppData, projectId: ID, cutoff: Pick<BookAuditOptions, 'to'> = {}) {
  if (!data.projects.some(p => p.id === projectId)) throw new Error('找不到要核对的项目。')
  const latest = data.chapters.reduce((n, c) => c.projectId === projectId && !isChapterArchived(c) ? Math.max(n, c.order) : n, 1)
  const to = integer(cutoff.to, latest, 1)
  const ctx = manuscriptContext(data, projectId, to)
  const findings = [...auditBookLedger(ctx), ...auditBookTimeline(ctx)].sort((a, b) =>
    statusRank[a.status] - statusRank[b.status] || endOrder(b) - endOrder(a) || a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title))
  return { read(options: BookAuditOptions = {}) {
    if (options.to !== undefined && options.to !== to) return buildBookContinuityReport(data, projectId, options)
    const from = integer(options.from, 1, 1)
    if (from > to) throw new Error('全书核对的起始章不能晚于截止章。')
    const offset = integer(options.offset, 0, 0), limit = Math.min(200, integer(options.limit, 30, 1))
    const counts: Record<BookAuditStatus, number> = { conflict: 0, needs_evidence: 0, open: 0 }
    const matched = findings.filter(f => {
      // Keep the earlier end of a cross-range comparison as evidence, not as a new finding in that earlier range.
      if ((options.kind && f.kind !== options.kind) || (endOrder(f) || 1) < from) return false
      counts[f.status]++
      return !options.status || f.status === options.status
    })
    return { projectId, from, to, total: matched.length, offset, limit, counts, findings: matched.slice(offset, offset + limit) }
  } }
}

export interface BookContinuityReport {
  projectId: ID; from: number; to: number; total: number; offset: number; limit: number
  counts: Record<BookAuditStatus, number>
  findings: BookAuditFinding[]
}

export function buildBookContinuityReport(data: AppData, projectId: ID, options: BookAuditOptions = {}): BookContinuityReport {
  return createBookContinuityReader(data, projectId, options).read(options)
}

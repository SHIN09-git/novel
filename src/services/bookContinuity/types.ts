import type { AppData, Chapter, ID } from '../../shared/types'

export type BookAuditKind = 'money' | 'headcount' | 'inventory' | 'promise' | 'whereabouts' | 'season' | 'countdown'
export type BookAuditStatus = 'conflict' | 'needs_evidence' | 'open'

export interface BookAuditEvidence {
  chapterId: ID
  chapterOrder: number
  versionId: ID | null
  contentHash: string
  excerpt: string
}

export interface BookAuditFinding {
  kind: BookAuditKind
  status: BookAuditStatus
  title: string
  reason: string
  evidence: BookAuditEvidence[]
  /** Position of a record or unresolved source; not a substitute for a manuscript quotation. */
  atChapterOrder?: number
  characterIds?: ID[]
}

export interface BookAuditContext {
  data: AppData
  projectId: ID
  chapters: Chapter[]
  from: number
  to: number
  evidence(chapter: Chapter, excerpt?: string): BookAuditEvidence
  chapterFor(id: ID | null | undefined, order: number | null | undefined): Chapter | undefined
}

export interface BookAuditOptions {
  from?: number
  to?: number
  kind?: BookAuditKind
  status?: BookAuditStatus
  offset?: number
  limit?: number
}

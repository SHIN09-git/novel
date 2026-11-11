import type { ID } from './base'

export type ChapterTitlePrefixMode = 'manual' | 'keep' | 'strip'

export interface ChapterTitleRename {
  projectId: ID
  operationId: ID
  prefixMode: ChapterTitlePrefixMode
  edits: { chapterId: ID; title?: string }[]
}

export interface ChapterTitleRow {
  chapterId: ID
  chapterOrder: number
  oldTitle: string
  newTitle: string
}

export type ChapterTitleActor =
  | { kind: 'user' }
  | { kind: 'agent'; authorizationGrantId: ID | null }

export interface ChapterTitlePreview {
  projectId: ID
  operationId: ID
  rows: ChapterTitleRow[]
  changedCount: number
  expectedRevision: string
  previewHash: string | null
  authorization: { action: 'manage_chapters'; actor: ChapterTitleActor; authorized: boolean }
}

export interface ChapterTitleCommit {
  command: ChapterTitleRename
  expectedRevision: string
  expectedPreviewHash: string
}

export interface ChapterTitleReceipt {
  schemaVersion: 1
  id: ID
  projectId: ID
  operationId: ID
  prefixMode: ChapterTitlePrefixMode
  actor: ChapterTitleActor
  expectedRevision: string
  commandHash: string
  previewHash: string
  rows: (ChapterTitleRow & { priorVersionIds: ID[] })[]
  createdAt: string
}

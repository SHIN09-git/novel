import type { ID } from './base'

export interface QuickRewriteTarget {
  projectId: ID
  kind: 'chapter' | 'reader_edit' | 'revision_version'
  targetId: ID
}

/** A recoverable editing draft, never an accepted chapter or canon fact. */
export interface QuickRewriteDraft {
  id: ID
  projectId: ID
  targetKind: QuickRewriteTarget['kind']
  chapterId: ID | null
  revisionVersionId: ID | null
  sourceBody: string
  selection: { start: number; end: number; text: string }
  text: string
  scope: 'selection' | 'chapter'
  label: string
  usedAI: boolean
  createdAt: string
  updatedAt: string
}

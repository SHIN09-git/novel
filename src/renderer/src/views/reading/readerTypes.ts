import type { ID } from '../../../../shared/types'

export interface ReaderSelection {
  chapterId: ID
  start: number
  end: number
  text: string
  x: number
  y: number
}

export interface ReaderRewriteUndo {
  chapterId: ID
  beforeBody: string
  afterBody: string
  label: string
}

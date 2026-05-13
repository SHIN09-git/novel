import type { ID } from './base'

export type DataMergeAction =
  | 'keep_target'
  | 'add_from_source'
  | 'dedupe_same_id'
  | 'rename_source_id'
  | 'skip_source'
  | 'conflict'

export type DataMergeConflictResolution = 'keep_target' | 'import_source_as_copy' | 'skip_source' | 'unresolved'

export interface DataFileSummary {
  projectCount: number
  chapterCount: number
  characterCount: number
  foreshadowingCount: number
  memoryCandidateCount: number
  promptVersionCount: number
  pipelineJobCount: number
  updatedAt?: string | null
}

export interface DataMergeOperation {
  collection: string
  action: DataMergeAction
  entityId?: ID
  entityTitle?: string
  reason: string
}

export interface DataMergeConflict {
  collection: string
  entityId: ID
  sourceTitle?: string
  targetTitle?: string
  reason: string
  resolution: DataMergeConflictResolution
}

export interface DataMergePreview {
  sourcePath: string
  targetPath: string
  sourceSummary: DataFileSummary
  targetSummary: DataFileSummary
  mergedSummary: DataFileSummary
  operations: DataMergeOperation[]
  conflicts: DataMergeConflict[]
  warnings: string[]
  canAutoMerge: boolean
}

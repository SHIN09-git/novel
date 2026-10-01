import { extname, join, resolve, dirname } from 'node:path'
import type { AppData, CandidateDecisionCommand, ChapterCommitBundle, GenerationRunBundle, RevisionCommitBundle } from '../shared/types'
import type { CandidateDecisionWriteResult, StorageWriteResult } from '../shared/ipc/ipcTypes'

export const JSON_DATA_FILE_NAME = 'novel-director-data.json'
export const SQLITE_DATA_FILE_NAME = 'novel-director-data.sqlite'

export interface StorageSnapshot {
  data: AppData
  revision: string
}

export class StorageRevisionConflictError extends Error {
  readonly code = 'STORAGE_REVISION_CONFLICT'

  constructor() {
    super('本地数据已被另一个窗口或 Agent 进程更新。为避免覆盖新内容，请重新加载数据后再保存。')
    this.name = 'StorageRevisionConflictError'
  }
}

export interface StorageService {
  load(): Promise<AppData>
  loadSnapshot(): Promise<StorageSnapshot>
  save(data: AppData): Promise<void>
  saveIfCurrent(data: AppData, expectedRevision?: string): Promise<StorageWriteResult>
  saveGenerationRunBundle(bundle: GenerationRunBundle, expectedRevision?: string): Promise<StorageWriteResult>
  saveChapterCommitBundle(bundle: ChapterCommitBundle, expectedRevision?: string): Promise<StorageWriteResult>
  saveRevisionCommitBundle(bundle: RevisionCommitBundle, expectedRevision?: string): Promise<StorageWriteResult>
  executeCandidateDecision(command: CandidateDecisionCommand, expectedRevision?: string): Promise<CandidateDecisionWriteResult>
  backupTo(targetPath: string): Promise<void>
  getStoragePath(): string
  close?(): void
}

export function resolveSqliteStoragePath(rawPath: string): string {
  const absolutePath = resolve(rawPath)
  const extension = extname(absolutePath).toLowerCase()

  if (extension === '.sqlite' || extension === '.db') return absolutePath
  if (extension === '.json') return join(dirname(absolutePath), SQLITE_DATA_FILE_NAME)
  if (extension) return absolutePath
  return join(absolutePath, SQLITE_DATA_FILE_NAME)
}

export function resolveJsonStoragePath(rawPath: string): string {
  const absolutePath = resolve(rawPath)
  const extension = extname(absolutePath).toLowerCase()

  if (extension === '.json') return absolutePath
  if (extension === '.sqlite' || extension === '.db') return join(dirname(absolutePath), JSON_DATA_FILE_NAME)
  if (extension) return absolutePath
  return join(absolutePath, JSON_DATA_FILE_NAME)
}

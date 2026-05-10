import { extname, join, resolve, dirname } from 'node:path'
import type { AppData, ChapterCommitBundle, GenerationRunBundle, RevisionCommitBundle } from '../shared/types'
import type { StorageWriteResult } from '../shared/ipc/ipcTypes'

export const JSON_DATA_FILE_NAME = 'novel-director-data.json'
export const SQLITE_DATA_FILE_NAME = 'novel-director-data.sqlite'

export interface StorageService {
  load(): Promise<AppData>
  save(data: AppData): Promise<void>
  saveGenerationRunBundle(bundle: GenerationRunBundle): Promise<StorageWriteResult>
  saveChapterCommitBundle(bundle: ChapterCommitBundle): Promise<StorageWriteResult>
  saveRevisionCommitBundle(bundle: RevisionCommitBundle): Promise<StorageWriteResult>
  getStoragePath(): string
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

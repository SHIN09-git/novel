import { extname, join, resolve, dirname } from 'node:path'
import type { ChapterTitleActor, ChapterTitleCommit } from '../shared/types/chapterTitle'
import type { ChapterTitleWriteResult } from '../shared/ipc/ipcTypes'
import type { AppData, CandidateDecisionCommand, CharacterCardReviewCommand, ChapterCommitBundle, ChapterWritebackFailure, GenerationRunBundle, RevisionCommitBundle } from '../shared/types'
import type { CandidateDecisionWriteResult, CharacterCardReviewWriteResult, StorageWriteResult } from '../shared/ipc/ipcTypes'

export const JSON_DATA_FILE_NAME = 'novel-director-data.json'
export const SQLITE_DATA_FILE_NAME = 'novel-director-data.sqlite'

export interface StorageSnapshot {
  data: AppData
  revision: string
}

export { StorageRevisionConflictError } from '../shared/storageRevisionConflict'

export interface FormalChapterCommitWriter {
  saveChapterCommitBundle(bundle: ChapterCommitBundle, expectedRevision?: string): Promise<StorageWriteResult>
  saveRevisionCommitBundle(bundle: RevisionCommitBundle, expectedRevision?: string): Promise<StorageWriteResult>
}

export interface StorageService extends FormalChapterCommitWriter {
  load(): Promise<AppData>
  loadSnapshot(): Promise<StorageSnapshot>
  save(data: AppData): Promise<void>
  saveIfCurrent(data: AppData, expectedRevision?: string): Promise<StorageWriteResult>
  saveGenerationRunBundle(bundle: GenerationRunBundle, expectedRevision?: string): Promise<StorageWriteResult>
  saveChapterCommitBundle(bundle: ChapterCommitBundle, expectedRevision?: string, onWriteStarted?: () => void): Promise<StorageWriteResult>
  saveRevisionCommitBundle(bundle: RevisionCommitBundle, expectedRevision?: string, onWriteStarted?: () => void): Promise<StorageWriteResult>
  recordChapterWritebackFailureIfUncommitted(failure: ChapterWritebackFailure): Promise<void>
  executeCandidateDecision(command: CandidateDecisionCommand, expectedRevision?: string): Promise<CandidateDecisionWriteResult>
  renameChapterTitles(commit: ChapterTitleCommit, actor: ChapterTitleActor): Promise<ChapterTitleWriteResult>
  reviewCharacterCard(command: CharacterCardReviewCommand, expectedRevision: string): Promise<CharacterCardReviewWriteResult>
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

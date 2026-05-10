import type { AppData, AppSettings, ChapterCommitBundle, DataMergePreview, GenerationRunBundle, RevisionCommitBundle } from '../types'

export type IpcResult<T> = { ok: true; data: T } | IpcFailure

export interface IpcFailure {
  ok: false
  error: string
  code?: string
}

export interface StorageGetResult {
  data: AppData
  storagePath: string
  credentialWarning?: string
}

export interface StorageSaveResult {
  ok: true
  storagePath: string
  credentialWarning?: string
}

export interface StorageWriteResult {
  ok: true
  storagePath: string
  revision: string
  updatedAt: string
  savedCollections: string[]
  credentialWarning?: string
}

export interface SaveGenerationRunBundleRequest {
  bundle: GenerationRunBundle
}

export interface SaveChapterCommitBundleRequest {
  bundle: ChapterCommitBundle
}

export interface SaveRevisionCommitBundleRequest {
  bundle: RevisionCommitBundle
}

export interface ExportDataResult {
  canceled: boolean
  filePath?: string
}

export interface ImportDataResult {
  canceled: boolean
  filePath?: string
  data?: AppData
  storagePath?: string
  credentialWarning?: string
}

export interface GetStoragePathResult {
  storagePath: string
  defaultStoragePath: string
}

export interface SelectStoragePathResult {
  canceled: boolean
  storagePath?: string
}

export interface MigrateStoragePathRequest {
  storagePath: string
  data: AppData
  overwrite?: boolean
}

export interface MigrateStoragePathResult {
  ok: boolean
  needsOverwrite?: boolean
  needsMerge?: boolean
  storagePath: string
  targetPath?: string
  backupPath?: string
  targetBackupPath?: string
  mergePreview?: DataMergePreview
  error?: string
}

export interface ResetStoragePathRequest {
  data: AppData
  overwrite?: boolean
}

export type ResetStoragePathResult = MigrateStoragePathResult

export interface OpenStorageFolderRequest {
  storagePath?: string
}

export interface OpenStorageFolderResult {
  ok: boolean
  error?: string
}

export interface MigrationMergePreviewRequest {
  sourcePath: string
  targetPath: string
}

export interface MigrationMergePreviewResult {
  ok: boolean
  preview?: DataMergePreview
  error?: string
}

export interface ConfirmMigrationMergeRequest {
  sourcePath: string
  targetPath: string
}

export interface ConfirmMigrationMergeResult {
  ok: boolean
  storagePath: string
  data?: AppData
  preview?: DataMergePreview
  sourceBackupPath?: string
  targetBackupPath?: string
  error?: string
}

export interface SaveTextFileRequest {
  content: string
  defaultFileName: string
}

export type SaveMarkdownFileRequest = SaveTextFileRequest

export interface SaveFileResult {
  canceled: boolean
  filePath?: string
}

export interface ClipboardWriteTextRequest {
  text: string
}

export interface ClipboardWriteTextResult {
  ok: true
}

export interface CredentialSetApiKeyRequest {
  apiKey: string
}

export interface CredentialStateResult {
  ok: true
  hasApiKey: boolean
}

export type CredentialSetApiKeyResult = CredentialStateResult
export type CredentialHasApiKeyResult = CredentialStateResult
export type CredentialDeleteApiKeyResult = CredentialStateResult
export type CredentialMigrateLegacyApiKeyResult = CredentialStateResult

export interface ChatCompletionRequest {
  settings: AppSettings
  messages: Array<{ role: 'system' | 'user'; content: string }>
}

export interface ChatCompletionResult {
  ok: boolean
  content?: string
  error?: string
  finishReason?: string
}

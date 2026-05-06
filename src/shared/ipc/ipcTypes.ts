import type { AppData, AppSettings } from '../types'

export type IpcResult<T> = { ok: true; data: T } | IpcFailure

export interface IpcFailure {
  ok: false
  error: string
  code?: string
}

export interface StorageGetResult {
  data: AppData
  storagePath: string
}

export interface StorageSaveResult {
  ok: true
  storagePath: string
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
  storagePath: string
  targetPath?: string
  backupPath?: string
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

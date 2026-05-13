import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc/ipcChannels'
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  BackupCreateResult,
  BackupDeleteResult,
  BackupListResult,
  BackupOpenFolderResult,
  BackupRestoreResult,
  ConfirmMigrationMergeResult,
  CredentialDeleteApiKeyResult,
  CredentialHasApiKeyResult,
  CredentialMigrateLegacyApiKeyResult,
  CredentialSetApiKeyResult,
  ExportDataResult,
  GetStoragePathResult,
  ImportDataResult,
  IpcFailure,
  LogsGetPathResult,
  LogsOpenResult,
  MigrateStoragePathResult,
  MigrationMergePreviewResult,
  OpenStorageFolderResult,
  SaveFileResult,
  StorageWriteResult,
  SelectStoragePathResult,
  StorageGetResult,
  StorageSaveResult
} from '../shared/ipc/ipcTypes'
import type { AppData, ChapterCommitBundle, GenerationRunBundle, RevisionCommitBundle } from '../shared/types'

function isIpcFailure(value: unknown): value is IpcFailure {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { ok?: unknown }).ok === false &&
      typeof (value as { error?: unknown }).error === 'string' &&
      !('storagePath' in value)
  )
}

async function invokeOrThrow<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await ipcRenderer.invoke(channel, ...args)
  if (isIpcFailure(result)) throw new Error(result.error)
  return result as T
}

function assertText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} 必须是字符串。`)
  return value
}

const novelDirector = {
  data: {
    load: () => invokeOrThrow<StorageGetResult>(IPC_CHANNELS.STORAGE_GET),
    save: (data: AppData) => invokeOrThrow<StorageSaveResult>(IPC_CHANNELS.STORAGE_SAVE, data),
    saveGenerationRunBundle: (bundle: GenerationRunBundle) =>
      invokeOrThrow<StorageWriteResult>(IPC_CHANNELS.DATA_SAVE_GENERATION_RUN_BUNDLE, { bundle }),
    saveChapterCommitBundle: (bundle: ChapterCommitBundle) =>
      invokeOrThrow<StorageWriteResult>(IPC_CHANNELS.DATA_SAVE_CHAPTER_COMMIT_BUNDLE, { bundle }),
    saveRevisionCommitBundle: (bundle: RevisionCommitBundle) =>
      invokeOrThrow<StorageWriteResult>(IPC_CHANNELS.DATA_SAVE_REVISION_COMMIT_BUNDLE, { bundle }),
    export: (data: AppData) => invokeOrThrow<ExportDataResult>(IPC_CHANNELS.STORAGE_EXPORT, data),
    import: () => invokeOrThrow<ImportDataResult>(IPC_CHANNELS.STORAGE_IMPORT)
  },
  app: {
    getStoragePath: () => invokeOrThrow<GetStoragePathResult>(IPC_CHANNELS.APP_GET_STORAGE_PATH),
    selectStoragePath: () => invokeOrThrow<SelectStoragePathResult>(IPC_CHANNELS.APP_SELECT_STORAGE_PATH),
    migrateStoragePath: (storagePath: string, data: AppData, overwrite = false) =>
      invokeOrThrow<MigrateStoragePathResult>(IPC_CHANNELS.APP_MIGRATE_STORAGE_PATH, {
        storagePath: assertText(storagePath, 'storagePath'),
        data,
        overwrite
      }),
    createMigrationMergePreview: (sourcePath: string, targetPath: string) =>
      invokeOrThrow<MigrationMergePreviewResult>(IPC_CHANNELS.APP_CREATE_MIGRATION_MERGE_PREVIEW, {
        sourcePath: assertText(sourcePath, 'sourcePath'),
        targetPath: assertText(targetPath, 'targetPath')
      }),
    confirmMigrationMerge: (sourcePath: string, targetPath: string) =>
      invokeOrThrow<ConfirmMigrationMergeResult>(IPC_CHANNELS.APP_CONFIRM_MIGRATION_MERGE, {
        sourcePath: assertText(sourcePath, 'sourcePath'),
        targetPath: assertText(targetPath, 'targetPath')
      }),
    resetStoragePath: (data: AppData, overwrite = false) =>
      invokeOrThrow<MigrateStoragePathResult>(IPC_CHANNELS.APP_RESET_STORAGE_PATH, { data, overwrite }),
    openStorageFolder: (storagePath?: string) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.APP_OPEN_STORAGE_FOLDER,
        storagePath === undefined ? undefined : assertText(storagePath, 'storagePath')
      ) as Promise<OpenStorageFolderResult>
  },
  backup: {
    create: () => invokeOrThrow<BackupCreateResult>(IPC_CHANNELS.BACKUP_CREATE),
    list: () => invokeOrThrow<BackupListResult>(IPC_CHANNELS.BACKUP_LIST),
    restore: (backupPath: string) =>
      invokeOrThrow<BackupRestoreResult>(IPC_CHANNELS.BACKUP_RESTORE, assertText(backupPath, 'backupPath')),
    delete: (backupPath: string) =>
      invokeOrThrow<BackupDeleteResult>(IPC_CHANNELS.BACKUP_DELETE, assertText(backupPath, 'backupPath')),
    openFolder: () => invokeOrThrow<BackupOpenFolderResult>(IPC_CHANNELS.BACKUP_OPEN_FOLDER)
  },
  logs: {
    getPath: () => invokeOrThrow<LogsGetPathResult>(IPC_CHANNELS.LOGS_GET_PATH),
    open: () => invokeOrThrow<LogsOpenResult>(IPC_CHANNELS.LOGS_OPEN)
  },
  export: {
    saveTextFile: (content: string, defaultFileName: string) =>
      invokeOrThrow<SaveFileResult>(IPC_CHANNELS.EXPORT_SAVE_TEXT_FILE, {
        content: assertText(content, 'content'),
        defaultFileName: assertText(defaultFileName, 'defaultFileName')
      }),
    saveMarkdownFile: (content: string, defaultFileName: string) =>
      invokeOrThrow<SaveFileResult>(IPC_CHANNELS.EXPORT_SAVE_MARKDOWN_FILE, {
        content: assertText(content, 'content'),
        defaultFileName: assertText(defaultFileName, 'defaultFileName')
      })
  },
  clipboard: {
    writeText: (text: string) =>
      invokeOrThrow<{ ok: true }>(IPC_CHANNELS.CLIPBOARD_WRITE_TEXT, assertText(text, 'text'))
  },
  credentials: {
    setApiKey: (apiKey: string) =>
      invokeOrThrow<CredentialSetApiKeyResult>(IPC_CHANNELS.CREDENTIALS_SET_API_KEY, {
        apiKey: assertText(apiKey, 'apiKey')
      }),
    hasApiKey: () => invokeOrThrow<CredentialHasApiKeyResult>(IPC_CHANNELS.CREDENTIALS_HAS_API_KEY),
    deleteApiKey: () => invokeOrThrow<CredentialDeleteApiKeyResult>(IPC_CHANNELS.CREDENTIALS_DELETE_API_KEY),
    migrateLegacyApiKey: (apiKey: string) =>
      invokeOrThrow<CredentialMigrateLegacyApiKeyResult>(
        IPC_CHANNELS.CREDENTIALS_MIGRATE_LEGACY_API_KEY,
        assertText(apiKey, 'apiKey')
      )
  },
  ai: {
    chatCompletion: (request: ChatCompletionRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CHAT_COMPLETION, request) as Promise<ChatCompletionResult>
  }
}

contextBridge.exposeInMainWorld('novelDirector', novelDirector)

export type NovelDirectorAPI = typeof novelDirector

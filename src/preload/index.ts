import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc/ipcChannels'
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ExportDataResult,
  GetStoragePathResult,
  ImportDataResult,
  IpcFailure,
  MigrateStoragePathResult,
  OpenStorageFolderResult,
  SaveFileResult,
  SelectStoragePathResult,
  StorageGetResult,
  StorageSaveResult
} from '../shared/ipc/ipcTypes'
import type { AppData } from '../shared/types'

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
    resetStoragePath: (data: AppData, overwrite = false) =>
      invokeOrThrow<MigrateStoragePathResult>(IPC_CHANNELS.APP_RESET_STORAGE_PATH, { data, overwrite }),
    openStorageFolder: (storagePath?: string) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.APP_OPEN_STORAGE_FOLDER,
        storagePath === undefined ? undefined : assertText(storagePath, 'storagePath')
      ) as Promise<OpenStorageFolderResult>
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
  ai: {
    chatCompletion: (request: ChatCompletionRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_CHAT_COMPLETION, request) as Promise<ChatCompletionResult>
  }
}

const novelAPI = {
  getData: novelDirector.data.load,
  saveData: novelDirector.data.save,
  exportData: novelDirector.data.export,
  importData: novelDirector.data.import,
  getDataStoragePath: novelDirector.app.getStoragePath,
  selectDataStoragePath: novelDirector.app.selectStoragePath,
  migrateDataStoragePath: novelDirector.app.migrateStoragePath,
  resetDataStoragePath: novelDirector.app.resetStoragePath,
  openDataStorageFolder: novelDirector.app.openStorageFolder,
  saveTextFile: novelDirector.export.saveTextFile,
  saveMarkdownFile: novelDirector.export.saveMarkdownFile,
  chatCompletion: novelDirector.ai.chatCompletion,
  writeClipboard: novelDirector.clipboard.writeText
}

contextBridge.exposeInMainWorld('novelDirector', novelDirector)
contextBridge.exposeInMainWorld('novelAPI', novelAPI)

export type NovelDirectorAPI = typeof novelDirector
export type NovelAPI = typeof novelAPI

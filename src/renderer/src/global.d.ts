import type { AppData } from '../../shared/types'

declare global {
  interface Window {
    novelAPI: {
      getData: () => Promise<{ data: AppData; storagePath: string }>
      saveData: (data: AppData) => Promise<{ ok: true; storagePath: string }>
      exportData: (data: AppData) => Promise<{ canceled: boolean; filePath?: string }>
      importData: () => Promise<{
        canceled: boolean
        filePath?: string
        data?: AppData
        storagePath?: string
      }>
      getDataStoragePath: () => Promise<{ storagePath: string; defaultStoragePath: string }>
      selectDataStoragePath: () => Promise<{ canceled: boolean; storagePath?: string }>
      migrateDataStoragePath: (
        storagePath: string,
        data: AppData,
        overwrite?: boolean
      ) => Promise<{
        ok: boolean
        needsOverwrite?: boolean
        storagePath: string
        targetPath?: string
        backupPath?: string
        error?: string
      }>
      resetDataStoragePath: (
        data: AppData,
        overwrite?: boolean
      ) => Promise<{
        ok: boolean
        needsOverwrite?: boolean
        storagePath: string
        targetPath?: string
        backupPath?: string
        error?: string
      }>
      openDataStorageFolder: (storagePath?: string) => Promise<{ ok: boolean; error?: string }>
      saveTextFile: (content: string, defaultFileName: string) => Promise<{ canceled: boolean; filePath?: string }>
      saveMarkdownFile: (content: string, defaultFileName: string) => Promise<{ canceled: boolean; filePath?: string }>
      chatCompletion: (request: {
        settings: AppData['settings']
        messages: Array<{ role: 'system' | 'user'; content: string }>
      }) => Promise<{ ok: boolean; content?: string; error?: string; finishReason?: string }>
      writeClipboard: (text: string) => Promise<{ ok: true }>
    }
  }
}

export {}

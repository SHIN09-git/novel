import { contextBridge, ipcRenderer } from 'electron'
import type { AppData } from '../shared/types'

const novelAPI = {
  getData: () => ipcRenderer.invoke('storage:get') as Promise<{ data: AppData; storagePath: string }>,
  saveData: (data: AppData) => ipcRenderer.invoke('storage:save', data) as Promise<{ ok: true; storagePath: string }>,
  exportData: (data: AppData) =>
    ipcRenderer.invoke('storage:export', data) as Promise<{ canceled: boolean; filePath?: string }>,
  importData: () =>
    ipcRenderer.invoke('storage:import') as Promise<{
      canceled: boolean
      filePath?: string
      data?: AppData
      storagePath?: string
    }>,
  getDataStoragePath: () =>
    ipcRenderer.invoke('app:get-storage-path') as Promise<{ storagePath: string; defaultStoragePath: string }>,
  selectDataStoragePath: () =>
    ipcRenderer.invoke('app:select-storage-path') as Promise<{ canceled: boolean; storagePath?: string }>,
  migrateDataStoragePath: (storagePath: string, data: AppData, overwrite = false) =>
    ipcRenderer.invoke('app:migrate-storage-path', { storagePath, data, overwrite }) as Promise<{
      ok: boolean
      needsOverwrite?: boolean
      storagePath: string
      targetPath?: string
      backupPath?: string
      error?: string
    }>,
  resetDataStoragePath: (data: AppData, overwrite = false) =>
    ipcRenderer.invoke('app:reset-storage-path', { data, overwrite }) as Promise<{
      ok: boolean
      needsOverwrite?: boolean
      storagePath: string
      targetPath?: string
      backupPath?: string
      error?: string
    }>,
  openDataStorageFolder: (storagePath?: string) =>
    ipcRenderer.invoke('app:open-storage-folder', storagePath) as Promise<{ ok: boolean; error?: string }>,
  saveTextFile: (content: string, defaultFileName: string) =>
    ipcRenderer.invoke('export:save-text-file', { content, defaultFileName }) as Promise<{ canceled: boolean; filePath?: string }>,
  saveMarkdownFile: (content: string, defaultFileName: string) =>
    ipcRenderer.invoke('export:save-markdown-file', { content, defaultFileName }) as Promise<{ canceled: boolean; filePath?: string }>,
  chatCompletion: (request: {
    settings: AppData['settings']
    messages: Array<{ role: 'system' | 'user'; content: string }>
  }) =>
    ipcRenderer.invoke('ai:chatCompletion', request) as Promise<{
      ok: boolean
      content?: string
      error?: string
      finishReason?: string
    }>,
  writeClipboard: (text: string) => ipcRenderer.invoke('clipboard:write-text', text) as Promise<{ ok: true }>
}

contextBridge.exposeInMainWorld('novelAPI', novelAPI)

export type NovelAPI = typeof novelAPI

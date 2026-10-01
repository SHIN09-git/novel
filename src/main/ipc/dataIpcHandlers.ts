import { dialog, ipcMain } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { safeParseJson } from '../../services/AIJsonParser'
import { collectionName } from '../../shared/appDataCollections'
import { normalizeAppData, sanitizeAppDataForPersistence } from '../../shared/defaults'
import { IPC_CHANNELS } from '../../shared/ipc/ipcChannels'
import type {
  ExportDataResult,
  ExecuteCandidateDecisionRequest,
  CandidateDecisionWriteResult,
  ImportDataResult,
  ImportDataRequest,
  SaveChapterCommitBundleRequest,
  SaveGenerationRunBundleRequest,
  SaveRevisionCommitBundleRequest,
  StorageGetResult,
  StorageSaveRequest,
  StorageSaveResult,
  StorageWriteResult
} from '../../shared/ipc/ipcTypes'
import type { AppData } from '../../shared/types'
import { LogService } from '../LogService'
import { mergeAppData } from '../DataMergeService'
import { safeIpcHandler } from './safeIpcHandler'
import type { StorageDataOperationContext } from './storageDataOperations'
import { secureAndSanitizeAppData } from './appDataCredentialSanitizer'
import { assertCurrentStorage, maybeCreateAutomaticBackup } from './storageDataOperations'

export function registerDataIpcHandlers(context: StorageDataOperationContext): void {
  ipcMain.handle(
    IPC_CHANNELS.DATA_EXECUTE_CANDIDATE_DECISION,
    safeIpcHandler(async (_event, request: ExecuteCandidateDecisionRequest): Promise<CandidateDecisionWriteResult> => {
      if (!request?.command || typeof request.expectedRevision !== 'string') throw new Error('请重新加载数据后再确认候选。')
      const storage = context.getStorage()
      await maybeCreateAutomaticBackup(context, 'candidate decision', storage)
      assertCurrentStorage(context, storage)
      // Desktop and Agent bind their own actor; a renderer payload cannot impersonate an Agent.
      return storage.executeCandidateDecision({ ...request.command, actor: { kind: 'user' } }, request.expectedRevision)
    })
  )
  ipcMain.handle(
    IPC_CHANNELS.STORAGE_GET,
    safeIpcHandler(async (): Promise<StorageGetResult> => {
      const storage = context.getStorage()
      LogService.info(`Loading storage data from ${storage.getStoragePath()}`)
      const snapshot = await storage.loadSnapshot()
      const loaded = snapshot.data
      const secured = await secureAndSanitizeAppData(context, loaded)
      let revision = snapshot.revision
      if (secured.migratedLegacyApiKey || loaded.settings.apiKey || loaded.settings.hasApiKey !== secured.data.settings.hasApiKey) {
        await maybeCreateAutomaticBackup(context, 'legacy credential migration', storage)
        assertCurrentStorage(context, storage)
        revision = (await storage.saveIfCurrent(secured.data, snapshot.revision)).revision
      }
      LogService.info(`Storage loaded: projects=${secured.data.projects.length}, chapters=${secured.data.chapters.length}`)
      return {
        data: secured.data,
        storagePath: storage.getStoragePath(),
        revision,
        credentialWarning: secured.credentialWarning
      }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.STORAGE_SAVE,
    safeIpcHandler(async (_event, input: AppData | StorageSaveRequest): Promise<StorageSaveResult> => {
      const storage = context.getStorage()
      const request = input && typeof input === 'object' && 'data' in input
        ? (input as StorageSaveRequest)
        : { data: input as AppData, expectedRevision: undefined }
      const data = request.data
      const secured = await secureAndSanitizeAppData(context, data)
      await maybeCreateAutomaticBackup(context, 'full AppData save', storage)
      assertCurrentStorage(context, storage)
      const result = await storage.saveIfCurrent(secured.data, request.expectedRevision)
      LogService.info(`Storage saved: ${storage.getStoragePath()}`)
      return {
        ok: true,
        storagePath: storage.getStoragePath(),
        revision: result.revision,
        credentialWarning: secured.credentialWarning
      }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.DATA_SAVE_GENERATION_RUN_BUNDLE,
    safeIpcHandler(async (_event, request: SaveGenerationRunBundleRequest): Promise<StorageWriteResult> => {
      const storage = context.getStorage()
      await maybeCreateAutomaticBackup(context, 'generation run bundle save', storage)
      assertCurrentStorage(context, storage)
      LogService.info(`Saving GenerationRunBundle: jobId=${request.bundle.jobId}`)
      return storage.saveGenerationRunBundle(request.bundle, request.expectedRevision)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.DATA_SAVE_CHAPTER_COMMIT_BUNDLE,
    safeIpcHandler(async (_event, request: SaveChapterCommitBundleRequest): Promise<StorageWriteResult> => {
      const storage = context.getStorage()
      await maybeCreateAutomaticBackup(context, 'chapter commit bundle save', storage)
      assertCurrentStorage(context, storage)
      LogService.info(`Saving ChapterCommitBundle: commitId=${request.bundle.commitId}`)
      return storage.saveChapterCommitBundle(request.bundle, request.expectedRevision)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.DATA_SAVE_REVISION_COMMIT_BUNDLE,
    safeIpcHandler(async (_event, request: SaveRevisionCommitBundleRequest): Promise<StorageWriteResult> => {
      const storage = context.getStorage()
      await maybeCreateAutomaticBackup(context, 'revision commit bundle save', storage)
      assertCurrentStorage(context, storage)
      LogService.info(`Saving RevisionCommitBundle: revisionCommitId=${request.bundle.revisionCommitId}`)
      return storage.saveRevisionCommitBundle(request.bundle, request.expectedRevision)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.STORAGE_EXPORT,
    safeIpcHandler(async (_event, data: AppData): Promise<ExportDataResult> => {
      const result = await dialog.showSaveDialog({
        title: '导出 Novel Director 数据',
        defaultPath: 'novel-director-export.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })

      if (result.canceled || !result.filePath) return { canceled: true }
      await writeFile(result.filePath, JSON.stringify(sanitizeAppDataForPersistence(data), null, 2), 'utf-8')
      return { canceled: false, filePath: result.filePath }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.STORAGE_IMPORT,
    safeIpcHandler(async (_event, request?: ImportDataRequest): Promise<ImportDataResult> => {
      const result = await dialog.showOpenDialog({
        title: '导入 Novel Director 数据',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })

      if (result.canceled || !result.filePaths[0]) return { canceled: true }
      const storage = context.getStorage()
      const importPath = result.filePaths[0]
      const raw = await readFile(importPath, 'utf-8')
      const parsed = safeParseJson<Partial<AppData>>(raw, '导入数据文件')
      if (!parsed.ok) throw new Error(parsed.parseError)
      const imported = normalizeAppData(parsed.data)
      const secured = await secureAndSanitizeAppData(context, imported, {
        migrateLegacyApiKey: false
      })
      const strategy = request?.strategy === 'merge' ? 'merge' : 'replace'
      const currentSnapshot = await storage.loadSnapshot()
      let importedProjectIds = secured.data.projects.map((project) => project.id)

      let nextData = secured.data
      let mergePreview
      if (strategy === 'merge') {
        const merged = mergeAppData(secured.data, currentSnapshot.data, {
          sourcePath: importPath,
          targetPath: storage.getStoragePath()
        })
        mergePreview = merged.preview
        importedProjectIds = mergePreview.operations
          .filter((operation) => operation.collection === collectionName('projects') && operation.entityId)
          .map((operation) => operation.entityId as string)
        if (!mergePreview.canAutoMerge) {
          return {
            canceled: false,
            filePath: importPath,
            storagePath: storage.getStoragePath(),
            revision: currentSnapshot.revision,
            credentialWarning: secured.credentialWarning,
            mergePreview,
            mergeBlocked: true,
            importedProjectIds
          }
        }
        nextData = merged.mergedData
      }

      const preImportBackupPath = await context.backupService.createBackup(currentSnapshot.data, false)
      LogService.info(`Pre-import backup created: ${preImportBackupPath}`)
      const saved = await storage.saveIfCurrent(
        nextData,
        request?.expectedRevision ?? currentSnapshot.revision
      )
      return {
        canceled: false,
        filePath: importPath,
        data: nextData,
        storagePath: storage.getStoragePath(),
        revision: saved.revision,
        credentialWarning: secured.credentialWarning,
        mergePreview,
        mergeBlocked: false,
        importedProjectIds
      }
    })
  )
}

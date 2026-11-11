import { dialog, ipcMain } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { decodeLibraryText, normalizeImportedLibrary, parseLibraryJsonValue } from '../../storage/libraryValidation'
import { observeFormalChapterWrites } from '../../services/ChapterWritebackFailureService'
import { parseChapterTitleRename, previewChapterTitleRename } from '../../services/ChapterTitleRenameService'
import { loadChapterTitlesReadonly } from '../../storage/SqliteStorageService'
import { StorageRevisionConflictError } from '../../storage/StorageService'
import type { ChapterTitleCommit, ChapterTitleRename } from '../../shared/types/chapterTitle'
import { collectionName } from '../../shared/appDataCollections'
import { sanitizeAppDataForPersistence } from '../../shared/defaults'
import { IPC_CHANNELS } from '../../shared/ipc/ipcChannels'
import { readProjectUsage } from '../../storage/readProjectUsage'
import type {
  ExportDataResult,
  ExecuteCandidateDecisionRequest,
  CandidateDecisionWriteResult,
  CharacterCardReviewRequest,
  CharacterCardReviewWriteResult,
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
  ipcMain.handle(IPC_CHANNELS.DATA_PREVIEW_CHAPTER_TITLES, safeIpcHandler(async (_event,
    request: { command: ChapterTitleRename; expectedRevision: string }) => {
    const command = parseChapterTitleRename(request?.command), storage = context.getStorage()
    const path = storage.getStoragePath(), snapshot = await loadChapterTitlesReadonly(path, command.projectId)
    assertCurrentStorage(context, storage)
    if (request.expectedRevision !== snapshot.revision) throw new StorageRevisionConflictError()
    return previewChapterTitleRename(snapshot.state, command, path, snapshot.revision, { kind: 'user' })
  }))
  ipcMain.handle(IPC_CHANNELS.DATA_RENAME_CHAPTER_TITLES, safeIpcHandler(async (_event, request: ChapterTitleCommit) => {
    const command = parseChapterTitleRename(request?.command), storage = context.getStorage()
    if (!request.expectedRevision || !request.expectedPreviewHash) throw new Error('请先预览正式章名。')
    await maybeCreateAutomaticBackup(context, 'chapter title rename', storage)
    assertCurrentStorage(context, storage)
    return storage.renameChapterTitles({ command, expectedRevision: request.expectedRevision,
      expectedPreviewHash: request.expectedPreviewHash }, { kind: 'user' })
  }))
  ipcMain.handle(IPC_CHANNELS.DATA_GET_PROJECT_USAGE, safeIpcHandler(async (_event, projectId: unknown) => {
    if (typeof projectId !== 'string' || !projectId.trim()) throw new Error('请选择要查看用量的项目。')
    return readProjectUsage(context.getStorage(), projectId)
  }))
  ipcMain.handle(
    IPC_CHANNELS.DATA_REVIEW_CHARACTER_CARD,
    safeIpcHandler(async (_event, request: CharacterCardReviewRequest): Promise<CharacterCardReviewWriteResult> => {
      if (!request?.command || typeof request.expectedRevision !== 'string' || !request.expectedRevision) {
        throw new Error('请重新加载数据后再核对角色卡。')
      }
      const storage = context.getStorage()
      await maybeCreateAutomaticBackup(context, 'character card review', storage)
      assertCurrentStorage(context, storage)
      return storage.reviewCharacterCard(request.command, request.expectedRevision)
    })
  )
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
      const opened = await context.loadLibrary?.()
      const storage = opened?.storage ?? context.getStorage()
      LogService.info(`Loading storage data from ${storage.getStoragePath()}`)
      const snapshot = opened?.snapshot ?? await storage.loadSnapshot()
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
      const target = context.getStorage()
      await maybeCreateAutomaticBackup(context, 'chapter commit bundle save', target)
      const assertCurrent = () => assertCurrentStorage(context, target)
      assertCurrent()
      const storage = observeFormalChapterWrites(target, assertCurrent)
      LogService.info(`Saving ChapterCommitBundle: commitId=${request.bundle.commitId}`)
      return storage.saveChapterCommitBundle(request.bundle, request.expectedRevision)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.DATA_SAVE_REVISION_COMMIT_BUNDLE,
    safeIpcHandler(async (_event, request: SaveRevisionCommitBundleRequest): Promise<StorageWriteResult> => {
      const target = context.getStorage()
      await maybeCreateAutomaticBackup(context, 'revision commit bundle save', target)
      const assertCurrent = () => assertCurrentStorage(context, target)
      assertCurrent()
      const storage = observeFormalChapterWrites(target, assertCurrent)
      LogService.info(`Saving RevisionCommitBundle: revisionCommitId=${request.bundle.revisionCommitId}`)
      return storage.saveRevisionCommitBundle(request.bundle, request.expectedRevision)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.STORAGE_EXPORT,
    safeIpcHandler(async (_event, data: AppData): Promise<ExportDataResult> => {
      context.getStorage()
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
      const strategy = request?.strategy === 'merge' ? 'merge' : 'replace'
      const imported = normalizeImportedLibrary(parseLibraryJsonValue(decodeLibraryText(await readFile(importPath))), strategy)
      const secured = await secureAndSanitizeAppData(context, imported, {
        migrateLegacyApiKey: false
      })
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

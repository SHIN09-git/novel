import { dialog, ipcMain, shell } from 'electron'
import { dirname } from 'node:path'
import { IPC_CHANNELS } from '../../shared/ipc/ipcChannels'
import type {
  ConfirmMigrationMergeRequest,
  ConfirmMigrationMergeResult,
  GetStoragePathResult,
  MigrateStoragePathRequest,
  MigrateStoragePathResult,
  MigrationMergePreviewRequest,
  MigrationMergePreviewResult,
  OpenStorageFolderResult,
  ResetStoragePathRequest,
  SelectStoragePathResult
} from '../../shared/ipc/ipcTypes'
import {
  confirmMigrationMerge,
  createMigrationMergePreview
} from '../DataMergeService'
import { createStorageService } from '../../storage/SqliteStorageService'
import { safeIpcHandler } from './safeIpcHandler'
import { resolveDataStoragePath } from './storagePath'
import type { StorageDataOperationContext } from './storageDataOperations'
import { migrateStoragePath, pathExists } from './storageDataOperations'

export function registerStorageManagementIpcHandlers(context: StorageDataOperationContext): void {
  ipcMain.handle(
    IPC_CHANNELS.APP_GET_STORAGE_PATH,
    safeIpcHandler(async (): Promise<GetStoragePathResult> => ({
      storagePath: context.getStorage().getStoragePath(),
      defaultStoragePath: context.appConfig.getDefaultStoragePath()
    }))
  )

  ipcMain.handle(
    IPC_CHANNELS.APP_SELECT_STORAGE_PATH,
    safeIpcHandler(async (): Promise<SelectStoragePathResult> => {
      const result = await dialog.showOpenDialog({
        title: '选择数据保存位置',
        properties: ['openFile', 'openDirectory', 'promptToCreate'],
        filters: [{ name: '本地数据文件', extensions: ['sqlite', 'db', 'json'] }]
      })

      if (result.canceled || !result.filePaths[0]) return { canceled: true }
      return {
        canceled: false,
        storagePath: await resolveDataStoragePath(result.filePaths[0])
      }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.APP_MIGRATE_STORAGE_PATH,
    safeIpcHandler(async (_event, request: MigrateStoragePathRequest): Promise<MigrateStoragePathResult> =>
      migrateStoragePath(
        context,
        request.storagePath,
        request.data,
        Boolean(request.overwrite),
        request.expectedRevision
      )
    )
  )

  ipcMain.handle(
    IPC_CHANNELS.APP_CREATE_MIGRATION_MERGE_PREVIEW,
    safeIpcHandler(
      async (_event, request: MigrationMergePreviewRequest): Promise<MigrationMergePreviewResult> => {
        const sourcePath = await resolveDataStoragePath(request.sourcePath)
        const targetPath = await resolveDataStoragePath(request.targetPath)
        return {
          ok: true,
          preview: await createMigrationMergePreview(sourcePath, targetPath)
        }
      }
    )
  )

  ipcMain.handle(
    IPC_CHANNELS.APP_CONFIRM_MIGRATION_MERGE,
    safeIpcHandler(async (_event, request: ConfirmMigrationMergeRequest): Promise<ConfirmMigrationMergeResult> => {
      const sourcePath = await resolveDataStoragePath(request.sourcePath)
      const targetPath = await resolveDataStoragePath(request.targetPath)
      const result = await confirmMigrationMerge(sourcePath, targetPath, request.expectedRevision)
      const nextStorage = createStorageService(targetPath)
      const activeStoragePath = nextStorage.getStoragePath()
      await context.appConfig.setStoragePath(activeStoragePath)
      context.setStorage(nextStorage)
      return {
        ok: true,
        storagePath: activeStoragePath,
        data: result.data,
        preview: result.preview,
        sourceBackupPath: result.sourceBackupPath,
        targetBackupPath: result.targetBackupPath,
        revision: result.revision
      }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.APP_RESET_STORAGE_PATH,
    safeIpcHandler(async (_event, request: ResetStoragePathRequest): Promise<MigrateStoragePathResult> =>
      migrateStoragePath(
        context,
        context.appConfig.getDefaultStoragePath(),
        request.data,
        Boolean(request.overwrite),
        request.expectedRevision
      )
    )
  )

  ipcMain.handle(
    IPC_CHANNELS.APP_OPEN_STORAGE_FOLDER,
    safeIpcHandler(async (_event, storagePath?: string): Promise<OpenStorageFolderResult> => {
      const target = storagePath ? await resolveDataStoragePath(storagePath) : context.getStorage().getStoragePath()
      if (await pathExists(target)) {
        shell.showItemInFolder(target)
        return { ok: true }
      }
      const error = await shell.openPath(dirname(target))
      return error ? { ok: false, error } : { ok: true }
    })
  )
}

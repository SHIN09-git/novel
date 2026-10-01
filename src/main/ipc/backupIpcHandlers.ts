import { ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc/ipcChannels'
import type {
  BackupCreateResult,
  BackupDeleteResult,
  BackupListResult,
  BackupOpenFolderResult,
  BackupRestoreRequest,
  BackupRestoreResult
} from '../../shared/ipc/ipcTypes'
import { validateFilePath } from '../../shared/validation'
import type { StorageService } from '../../storage/StorageService'
import type { BackupService } from '../BackupService'
import { LogService } from '../LogService'
import { safeIpcHandler } from './safeIpcHandler'

export interface BackupIpcContext {
  backupService: BackupService
  getStorage: () => StorageService
}

export function registerBackupIpcHandlers(context: BackupIpcContext): void {
  ipcMain.handle(
    IPC_CHANNELS.BACKUP_CREATE,
    safeIpcHandler(async (): Promise<BackupCreateResult> => {
      const storage = context.getStorage()
      const data = await storage.load()
      const backupPath = await context.backupService.createBackup(data, false)
      LogService.info(`Manual backup created: ${backupPath}`)
      return { ok: true, backupPath }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_LIST,
    safeIpcHandler(async (): Promise<BackupListResult> => ({
      ok: true,
      backups: await context.backupService.listBackups()
    }))
  )

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_RESTORE,
    safeIpcHandler(async (_event, input: string | BackupRestoreRequest): Promise<BackupRestoreResult> => {
      const storage = context.getStorage()
      const request = typeof input === 'string' ? { backupPath: input } : input
      let preRestoreBackupPath: string | undefined
      try {
        preRestoreBackupPath = await context.backupService.createBackup(await storage.load(), false)
      } catch (error) {
        LogService.warn('Pre-restore backup failed; continuing with selected backup restore.', error)
      }
      const data = await context.backupService.loadBackup(validateFilePath(request.backupPath, 'Backup path'))
      const saved = await storage.saveIfCurrent(data, request.expectedRevision)
      LogService.info(`Backup restored: ${request.backupPath}`)
      return {
        ok: true,
        data,
        storagePath: storage.getStoragePath(),
        revision: saved.revision,
        preRestoreBackupPath
      }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_DELETE,
    safeIpcHandler(async (_event, backupPath: string): Promise<BackupDeleteResult> => {
      await context.backupService.deleteBackup(validateFilePath(backupPath, 'Backup path'))
      LogService.info(`Backup deleted: ${backupPath}`)
      return { ok: true }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_OPEN_FOLDER,
    safeIpcHandler(async (): Promise<BackupOpenFolderResult> => {
      await context.backupService.ensureBackupDir()
      const error = await shell.openPath(context.backupService.getBackupDir())
      return error ? { ok: false, error } : { ok: true }
    })
  )
}

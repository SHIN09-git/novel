import { mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getUserFriendlyError, redactSensitiveText } from '../../shared/errorUtils'
import type { MigrateStoragePathResult } from '../../shared/ipc/ipcTypes'
import type { AppData } from '../../shared/types'
import type { StorageService } from '../../storage/StorageService'
import { createStorageService } from '../../storage/SqliteStorageService'
import type { AppConfigService } from '../AppConfigService'
import type { BackupService } from '../BackupService'
import {
  backupFileForOverwrite,
  createMigrationMergePreview
} from '../DataMergeService'
import { LogService } from '../LogService'
import type { SecureCredentialService } from '../SecureCredentialService'
import { resolveDataStoragePath } from './storagePath'

export interface StorageDataOperationContext {
  appConfig: AppConfigService
  credentialService: SecureCredentialService
  backupService: BackupService
  getStorage: () => StorageService
  setStorage: (storage: StorageService) => void
}

import { secureAndSanitizeAppData } from './appDataCredentialSanitizer'

export {
  secureAndSanitizeAppData,
  type SecuredAppDataResult,
  type SecureAppDataOptions
} from './appDataCredentialSanitizer'

export function assertCurrentStorage(context: StorageDataOperationContext, storage: StorageService): void {
  if (context.getStorage() !== storage) throw new Error('数据保存位置已切换，请重新加载数据后再保存。')
}

export async function maybeCreateAutomaticBackup(
  context: StorageDataOperationContext,
  reason: string,
  storage: StorageService = context.getStorage()
): Promise<void> {
  assertCurrentStorage(context, storage)
  try {
    const backupPath = await context.backupService.maybeCreateAutomaticBackup(async () => {
      assertCurrentStorage(context, storage)
      return storage.load()
    }, storage)
    if (backupPath) LogService.info(`Automatic backup created before ${reason}: ${backupPath}`)
  } catch (error) {
    LogService.warn(`Automatic backup skipped before ${reason}`, error)
  }
  // A backup failure is non-blocking, but a save to a replaced storage instance is not.
  assertCurrentStorage(context, storage)
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function backupExistingSourceData(storage: StorageService, sourcePath: string): Promise<string | null> {
  if (!(await pathExists(sourcePath))) return null
  const backupPath = `${sourcePath}.before-migrate.${Date.now()}.bak`
  await storage.backupTo(backupPath)
  return backupPath
}

export async function migrateStoragePath(
  context: StorageDataOperationContext,
  rawTargetPath: string,
  data: AppData,
  overwrite = false,
  expectedRevision?: string
): Promise<MigrateStoragePathResult> {
  const storage = context.getStorage()
  const oldPath = storage.getStoragePath()
  const targetPath = await resolveDataStoragePath(rawTargetPath)

  try {
    const secured = await secureAndSanitizeAppData(context, data)
    const currentSave = await storage.saveIfCurrent(secured.data, expectedRevision)

    const targetAlreadyExists = oldPath !== targetPath && (await pathExists(targetPath))
    if (targetAlreadyExists && !overwrite) {
      const mergePreview = await createMigrationMergePreview(oldPath, targetPath)
      return {
        ok: false,
        needsOverwrite: true,
        needsMerge: true,
        storagePath: oldPath,
        targetPath,
        mergePreview,
        revision: currentSave.revision,
        error: '目标路径已存在数据文件。请选择合并已有数据、覆盖目标数据或取消迁移。'
      }
    }

    await mkdir(dirname(targetPath), { recursive: true })
    const backupPath = await backupExistingSourceData(storage, oldPath)
    const targetBackupPath = targetAlreadyExists ? await backupFileForOverwrite(targetPath) : null
    const nextStorage = createStorageService(targetPath)
    const nextSave = await nextStorage.saveIfCurrent(secured.data)
    const activeStoragePath = nextStorage.getStoragePath()
    await context.appConfig.setStoragePath(activeStoragePath)
    context.setStorage(nextStorage)

    return {
      ok: true,
      storagePath: activeStoragePath,
      backupPath: backupPath ?? undefined,
      targetBackupPath: targetBackupPath ?? undefined,
      revision: nextSave.revision
    }
  } catch (error) {
    return {
      ok: false,
      storagePath: oldPath,
      error: redactSensitiveText(getUserFriendlyError(error)).slice(0, 800)
    }
  }
}

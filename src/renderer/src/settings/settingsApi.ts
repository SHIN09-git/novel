import type { AppData } from '../../../shared/types'
import {
  getNovelDirectorAppApi,
  getNovelDirectorBackupApi,
  getNovelDirectorDataApi,
  getNovelDirectorLogsApi
} from '../platform/novelDirectorBridge'

export function getStoragePath() {
  return getNovelDirectorAppApi().getStoragePath()
}

export function exportAppData(data: AppData) {
  return getNovelDirectorDataApi().export(data)
}

export function importAppData() {
  return getNovelDirectorDataApi().import()
}

export function selectStoragePath() {
  return getNovelDirectorAppApi().selectStoragePath()
}

export function migrateStoragePath(storagePath: string, data: AppData, overwrite = false) {
  return getNovelDirectorAppApi().migrateStoragePath(storagePath, data, overwrite)
}

export function createMigrationMergePreview(sourcePath: string, targetPath: string) {
  return getNovelDirectorAppApi().createMigrationMergePreview(sourcePath, targetPath)
}

export function resetStoragePath(data: AppData, overwrite = false) {
  return getNovelDirectorAppApi().resetStoragePath(data, overwrite)
}

export function confirmMigrationMerge(sourcePath: string, targetPath: string) {
  return getNovelDirectorAppApi().confirmMigrationMerge(sourcePath, targetPath)
}

export function openStorageFolder(storagePath: string) {
  return getNovelDirectorAppApi().openStorageFolder(storagePath)
}

export function createBackup() {
  return getNovelDirectorBackupApi().create()
}

export function listBackups() {
  return getNovelDirectorBackupApi().list()
}

export function restoreBackup(backupPath: string) {
  return getNovelDirectorBackupApi().restore(backupPath)
}

export function deleteBackup(backupPath: string) {
  return getNovelDirectorBackupApi().delete(backupPath)
}

export function openBackupFolder() {
  return getNovelDirectorBackupApi().openFolder()
}

export function getLogPath() {
  return getNovelDirectorLogsApi().getPath()
}

export function openLogFile() {
  return getNovelDirectorLogsApi().open()
}

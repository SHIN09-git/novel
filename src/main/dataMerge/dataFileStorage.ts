import { mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AppData } from '../../shared/types'
import { JsonStorageService } from '../../storage/JsonStorageService'
import { SqliteStorageService } from '../../storage/SqliteStorageService'
import type { StorageService, StorageSnapshot } from '../../storage/StorageService'

function isSqliteDataPath(path: string): boolean {
  return /\.(sqlite|db)$/i.test(path)
}

function createDataFileStorage(path: string): StorageService {
  return isSqliteDataPath(path) ? new SqliteStorageService(path) : new JsonStorageService(path)
}

export async function loadDataFileSnapshot(path: string): Promise<StorageSnapshot> {
  const storage = createDataFileStorage(path)
  try {
    return await storage.loadSnapshot()
  } finally {
    storage.close?.()
  }
}

export async function saveDataFile(
  path: string,
  data: AppData,
  expectedRevision?: string
): Promise<StorageSnapshot> {
  const storage = createDataFileStorage(path)
  try {
    await storage.saveIfCurrent(data, expectedRevision)
    return await storage.loadSnapshot()
  } finally {
    storage.close?.()
  }
}

function timestampForFile(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
}

function migrationBackupPath(
  path: string,
  role: 'source' | 'target',
  action: 'before-merge' | 'before-overwrite',
  stamp = timestampForFile()
): string {
  return `${path}.${role}.${action}.${stamp}.bak`
}

async function assertFileExists(path: string) {
  const fileStat = await stat(path)
  if (!fileStat.isFile()) throw new Error(`路径不是数据文件：${path}`)
}

async function backupDataFile(sourcePath: string, backupPath: string): Promise<void> {
  const storage = createDataFileStorage(sourcePath)
  try {
    await storage.backupTo(backupPath)
  } finally {
    storage.close?.()
  }
}

export async function backupFileForOverwrite(path: string): Promise<string> {
  await assertFileExists(path)
  const backupPath = migrationBackupPath(path, 'target', 'before-overwrite')
  await mkdir(dirname(backupPath), { recursive: true })
  await backupDataFile(path, backupPath)
  return backupPath
}

export async function backupBeforeMerge(
  sourcePath: string,
  targetPath: string
): Promise<{ sourceBackupPath: string; targetBackupPath: string }> {
  await assertFileExists(sourcePath)
  await assertFileExists(targetPath)
  const stamp = timestampForFile()
  const sourceBackupPath = migrationBackupPath(sourcePath, 'source', 'before-merge', stamp)
  const targetBackupPath = migrationBackupPath(targetPath, 'target', 'before-merge', stamp)
  await mkdir(dirname(sourceBackupPath), { recursive: true })
  await mkdir(dirname(targetBackupPath), { recursive: true })
  await backupDataFile(sourcePath, sourceBackupPath)
  await backupDataFile(targetPath, targetBackupPath)
  return { sourceBackupPath, targetBackupPath }
}

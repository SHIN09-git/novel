import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { normalizeAppData, sanitizeAppDataForPersistence } from '../shared/defaults'
import type { AppData } from '../shared/types'

export interface BackupInfo {
  path: string
  timestamp: number
  size: number
  isAutomatic: boolean
}

const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000
const MAX_AUTOMATIC_BACKUPS = 7

function isInsideOrSame(childPath: string, parentPath: string): boolean {
  const parent = resolve(parentPath)
  const child = resolve(childPath)
  const relationship = relative(parent, child)
  return relationship === '' || (!!relationship && !relationship.startsWith('..') && !isAbsolute(relationship))
}

function backupTimestamp(fileName: string, fallback: number): number {
  const match = fileName.match(/novel-director-(\d+)/)
  return match ? Number(match[1]) : fallback
}

export class BackupService {
  private readonly backupDir: string

  constructor(userDataPath: string) {
    this.backupDir = join(userDataPath, 'backups')
  }

  getBackupDir(): string {
    return this.backupDir
  }

  async ensureBackupDir(): Promise<void> {
    await mkdir(this.backupDir, { recursive: true })
  }

  async createBackup(data: AppData, isAutomatic = true): Promise<string> {
    await this.ensureBackupDir()
    const timestamp = Date.now()
    const backupName = `novel-director-${timestamp}${isAutomatic ? '-auto' : '-manual'}.json`
    const backupPath = join(this.backupDir, backupName)
    const safeData = sanitizeAppDataForPersistence(normalizeAppData(data))
    await writeFile(backupPath, JSON.stringify(safeData, null, 2), 'utf-8')
    if (isAutomatic) {
      await this.cleanupOldAutomaticBackups()
    }
    return backupPath
  }

  async maybeCreateAutomaticBackup(data: AppData): Promise<string | null> {
    const backups = await this.listBackups()
    const latestAuto = backups.find((backup) => backup.isAutomatic)
    if (latestAuto && Date.now() - latestAuto.timestamp < BACKUP_INTERVAL_MS) {
      return null
    }
    return this.createBackup(data, true)
  }

  async listBackups(): Promise<BackupInfo[]> {
    await this.ensureBackupDir()
    const files = await readdir(this.backupDir)
    const backups: BackupInfo[] = []

    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const path = join(this.backupDir, file)
      const info = await stat(path)
      backups.push({
        path,
        timestamp: backupTimestamp(file, info.mtimeMs),
        size: info.size,
        isAutomatic: file.includes('-auto')
      })
    }

    return backups.sort((a, b) => b.timestamp - a.timestamp)
  }

  async loadBackup(backupPath: string): Promise<AppData> {
    const safePath = this.assertManagedBackupPath(backupPath)
    const raw = await readFile(safePath, 'utf-8')
    return sanitizeAppDataForPersistence(normalizeAppData(JSON.parse(raw) as Partial<AppData>))
  }

  async deleteBackup(backupPath: string): Promise<void> {
    const safePath = this.assertManagedBackupPath(backupPath)
    await unlink(safePath)
  }

  private assertManagedBackupPath(backupPath: string): string {
    const resolved = resolve(backupPath)
    if (!isInsideOrSame(resolved, this.backupDir) || !resolved.endsWith('.json')) {
      throw new Error('Backup path is outside the managed backup folder.')
    }
    return resolved
  }

  private async cleanupOldAutomaticBackups(): Promise<void> {
    const automaticBackups = (await this.listBackups()).filter((backup) => backup.isAutomatic)
    const toDelete = automaticBackups.slice(MAX_AUTOMATIC_BACKUPS)
    for (const backup of toDelete) {
      try {
        await this.deleteBackup(backup.path)
      } catch {
        // Backup cleanup should never block the user's save path.
      }
    }
  }
}

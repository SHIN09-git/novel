import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { constants, createGzip } from 'node:zlib'
import { sanitizeAppDataForPersistence } from '../shared/defaults'
import type { BackupInfo } from '../shared/ipc/ipcTypes'
import { normalizeLibraryData } from '../storage/libraryValidation'
import { MAX_GZIP_JSON_BYTES, isBackupFile, readBackupJson } from './backupFileFormat'
import type { AppData } from '../shared/types'

const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000
const MAX_AUTOMATIC_BACKUPS = 7

const autoName = /^novel-director-\d+-auto(?:-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})?\.json(?:\.gz)?$/i
const rollbackName = /^novel-director-\d+-rollback-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\.json$/i

function backupTimestamp(fileName: string, fallback: number): number {
  const match = fileName.match(/novel-director-(\d+)/)
  return match ? Number(match[1]) : fallback
}

export class BackupService {
  private readonly backupDir: string
  private readonly automaticBackupsPending = new Map<object, Promise<string | null>>()
  private publication = Promise.resolve()

  constructor(userDataPath: string, private readonly gzipLimit = MAX_GZIP_JSON_BYTES) {
    this.backupDir = join(userDataPath, 'backups')
  }

  getBackupDir(): string {
    return this.backupDir
  }

  async ensureBackupDir(): Promise<void> {
    await mkdir(this.backupDir, { recursive: true })
  }

  async createBackup(data: AppData, isAutomatic = true): Promise<string> {
    if (!isAutomatic) return this.publishBackup(data, false)
    // Concurrent saves of different libraries must not rotate a half-published pair.
    const next = this.publication.then(() => this.publishBackup(data, true))
    this.publication = next.then(() => {}, () => {})
    return next
  }

  private async publishBackup(data: AppData, isAutomatic: boolean): Promise<string> {
    await this.ensureBackupDir()
    const prefix = join(this.backupDir, `novel-director-${Date.now()}`), id = randomUUID()
    const safe = normalizeLibraryData(data, sanitizeAppDataForPersistence)
    const raw = JSON.stringify(safe, null, 2)
    const compress = isAutomatic && Buffer.byteLength(raw) <= this.gzipLimit
    const plain = `${prefix}-${compress ? 'rollback' : isAutomatic ? 'auto' : 'manual'}-${id}.json`
    const gzip = `${prefix}-auto-${id}.json.gz`
    let publishedPlain = false
    try {
      await writeFile(plain + '.tmp', raw, { encoding: 'utf8', flag: 'wx' })
      if (compress) {
        await pipeline(createReadStream(plain + '.tmp'), createGzip({ level: constants.Z_BEST_SPEED }),
          createWriteStream(gzip + '.tmp', { flags: 'wx' }))
      }
      await rename(plain + '.tmp', plain)
      publishedPlain = true
      if (compress) await rename(gzip + '.tmp', gzip)
    } catch (error) {
      if (publishedPlain) await unlink(plain)
      throw error
    } finally {
      await unlink(plain + '.tmp').catch(() => undefined)
      if (compress) await unlink(gzip + '.tmp').catch(() => undefined)
    }
    const path = compress ? gzip : plain
    if (isAutomatic) await this.cleanupOldAutomaticBackups(path, plain)
    return path
  }

  async maybeCreateAutomaticBackup(data: AppData | (() => Promise<AppData>), source: object = this): Promise<string | null> {
    // Check the schedule before materializing AppData. Most checkpoints need no backup.
    // Share a due backup across concurrent saves, but never cache a failed attempt.
    const existing = this.automaticBackupsPending.get(source)
    if (existing) return existing
    const pending = this.createAutomaticBackupIfDue(data)
    this.automaticBackupsPending.set(source, pending)
    try {
      return await pending
    } finally {
      if (this.automaticBackupsPending.get(source) === pending) this.automaticBackupsPending.delete(source)
    }
  }

  private async createAutomaticBackupIfDue(data: AppData | (() => Promise<AppData>)): Promise<string | null> {
    const backups = await this.listBackups()
    const latestAuto = backups.find((backup) => backup.isAutomatic)
    if (latestAuto && Date.now() - latestAuto.timestamp < BACKUP_INTERVAL_MS) {
      return null
    }
    return this.createBackup(typeof data === 'function' ? await data() : data, true)
  }

  async listBackups(): Promise<BackupInfo[]> {
    await this.ensureBackupDir()
    const files = await readdir(this.backupDir, { withFileTypes: true })
    const backups: BackupInfo[] = []

    for (const entry of files) {
      const file = entry.name
      if (!entry.isFile() || !isBackupFile(file)) continue
      const path = join(this.backupDir, file)
      const info = await lstat(path).catch(error => {
        if (error.code !== 'ENOENT') throw error
      })
      if (!info?.isFile()) continue
      backups.push({
        path,
        timestamp: backupTimestamp(file, info.mtimeMs),
        size: info.size,
        isAutomatic: autoName.test(file),
        isRollback: rollbackName.test(file)
      })
    }

    return backups.sort((a, b) => b.timestamp - a.timestamp)
  }

  async loadBackup(backupPath: string): Promise<AppData> {
    const safePath = this.assertManagedBackupPath(backupPath)
    if (!(await lstat(safePath)).isFile()) throw new Error('请选择备份目录中的文件。')
    return normalizeLibraryData(await readBackupJson(safePath, this.gzipLimit), sanitizeAppDataForPersistence)
  }

  async deleteBackup(backupPath: string): Promise<void> {
    const safePath = this.assertManagedBackupPath(backupPath)
    await unlink(safePath)
  }

  private assertManagedBackupPath(backupPath: string): string {
    const resolved = resolve(backupPath)
    if (dirname(resolved) !== resolve(this.backupDir) || !isBackupFile(resolved)) {
      throw new Error('Backup path is outside the managed backup folder.')
    }
    return resolved
  }

  private async cleanupOldAutomaticBackups(current: string, plain: string): Promise<void> {
    const backups = await this.listBackups()
    const toDelete = [...backups.filter(backup => backup.isAutomatic && backup.path !== current).slice(MAX_AUTOMATIC_BACKUPS - 1),
      ...backups.filter(backup => backup.isRollback && backup.path !== plain)]
    for (const backup of toDelete) {
      try {
        await this.deleteBackup(backup.path)
      } catch {
        // Backup cleanup should never block the user's save path.
      }
    }
  }
}

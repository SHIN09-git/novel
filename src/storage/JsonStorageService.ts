import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AppData } from '../shared/types'
import { EMPTY_APP_DATA, normalizeAppData, sanitizeAppDataForPersistence } from '../shared/defaults'

export interface StorageService {
  load(): Promise<AppData>
  save(data: AppData): Promise<void>
  getStoragePath(): string
}

export class JsonStorageService implements StorageService {
  constructor(private readonly storagePath: string) {}

  getStoragePath(): string {
    return this.storagePath
  }

  async load(): Promise<AppData> {
    try {
      const raw = await readFile(this.storagePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AppData>
      return normalizeAppData(parsed)
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      if (code === 'ENOENT') {
        await this.save(EMPTY_APP_DATA)
        return EMPTY_APP_DATA
      }

      const backupPath = `${this.storagePath}.corrupt.${Date.now()}.json`
      try {
        await copyFile(this.storagePath, backupPath)
        console.warn(`Failed to load data file. Backed up corrupt data to ${backupPath}.`, error)
      } catch (backupError) {
        console.warn(`Failed to load data file and could not create corrupt backup at ${backupPath}.`, {
          error,
          backupError
        })
      }
      return EMPTY_APP_DATA
    }
  }

  async save(data: AppData): Promise<void> {
    await mkdir(dirname(this.storagePath), { recursive: true })
    const normalized = sanitizeAppDataForPersistence(data)
    const tmpPath = `${this.storagePath}.tmp`
    const backupPath = `${this.storagePath}.bak`

    await writeFile(tmpPath, JSON.stringify(normalized, null, 2), 'utf-8')

    try {
      await stat(this.storagePath)
      await copyFile(this.storagePath, backupPath)
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      if (code !== 'ENOENT') {
        throw error
      }
    }

    await rename(tmpPath, this.storagePath)
  }
}

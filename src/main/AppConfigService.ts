import { copyFile, mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SQLITE_DATA_FILE_NAME } from '../storage/StorageService'

interface AppConfig {
  storagePath?: string
}

export class AppConfigService {
  private readonly configPath: string

  constructor(private readonly userDataPath: string) {
    this.configPath = join(userDataPath, 'app-config.json')
  }

  getDefaultStoragePath(): string {
    return join(this.userDataPath, SQLITE_DATA_FILE_NAME)
  }

  async getStoragePath(): Promise<string> {
    const config = await this.readConfig()
    return config.storagePath || this.getDefaultStoragePath()
  }

  async setStoragePath(storagePath: string): Promise<void> {
    await this.writeConfig({ ...(await this.readConfig()), storagePath })
  }

  async resetStoragePath(): Promise<string> {
    const defaultPath = this.getDefaultStoragePath()
    await this.writeConfig({ storagePath: defaultPath })
    return defaultPath
  }

  async getConfigPath(): Promise<string> {
    return this.configPath
  }

  private async readConfig(): Promise<AppConfig> {
    try {
      return JSON.parse(await readFile(this.configPath, 'utf-8')) as AppConfig
    } catch (error) {
      const code = errorCode(error)
      if (code === 'ENOENT') return {}

      const backupPath = `${this.configPath}.corrupt.${Date.now()}.json`
      try {
        await copyFile(this.configPath, backupPath)
        console.warn(`Failed to read app config at ${this.configPath}. Backed up corrupt config to ${backupPath}. Falling back to defaults. ${errorSummary(error)}`)
      } catch (backupError) {
        console.warn(
          `Failed to read app config at ${this.configPath}, and could not create corrupt backup at ${backupPath}. Falling back to defaults. ${errorSummary(error)} Backup error: ${errorSummary(backupError)}`
        )
      }
      return {}
    }
  }

  private async writeConfig(config: AppConfig): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true })
    const tmpPath = `${this.configPath}.tmp`
    const backupPath = `${this.configPath}.bak`

    await writeFile(tmpPath, JSON.stringify(config, null, 2), 'utf-8')
    await syncFile(tmpPath)

    try {
      await stat(this.configPath)
      await copyFile(this.configPath, backupPath)
    } catch (error) {
      const code = errorCode(error)
      if (code !== 'ENOENT') {
        throw error
      }
    }

    await rename(tmpPath, this.configPath)
    await syncDirectory(dirname(this.configPath))
  }
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(path, 'r')
    await handle.sync()
  } catch (error) {
    const code = errorCode(error)
    if (!['EACCES', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(code)) {
      throw error
    }
    // Windows often does not permit directory fsync. The temp-file fsync plus
    // atomic rename still improves durability; directory sync remains best-effort.
  } finally {
    await handle?.close()
  }
}

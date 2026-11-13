import { constants } from 'node:fs'
import { copyFile, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { SQLITE_DATA_FILE_NAME } from '../storage/StorageService'

interface AppConfig {
  storagePath?: string
  explicitJson?: boolean
}

function libraryConfig(value: unknown): value is AppConfig & { storagePath: string } {
  return !!value && typeof value === 'object' && 'storagePath' in value &&
    typeof value.storagePath === 'string' && isAbsolute(value.storagePath) && /\.(sqlite|db|json)$/i.test(value.storagePath)
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

  // Starting a library is different from displaying a suggested default path.
  // A broken config must not be interpreted as consent to create a new library.
  async readLibrarySelection(): Promise<{ storagePath: string; explicitJson: boolean } | null> {
    let raw: string
    try {
      raw = await readFile(this.configPath, 'utf-8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null
      throw error
    }
    try {
      const config: unknown = JSON.parse(raw)
      if (libraryConfig(config)) {
        return { storagePath: config.storagePath, explicitJson: config.explicitJson === true }
      }
    } catch { /* Never use a guessed path when the saved choice cannot be read. */ }
    throw new Error('无法确定上次选择的书库。请选择已有书库，或明确新建。')
  }

  async setStoragePath(storagePath: string, explicitJson = false): Promise<void> {
    const config = await this.readConfig()
    await this.writeConfig({ ...config, storagePath, explicitJson: explicitJson || undefined }, libraryConfig(config))
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

  private async writeConfig(config: AppConfig, previousIsValid = true): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true })
    const tmpPath = `${this.configPath}.tmp`
    const backupPath = `${this.configPath}.bak`

    await writeFile(tmpPath, JSON.stringify(config, null, 2), 'utf-8')
    await syncFile(tmpPath)

    try {
      // A successful recovery from a broken config must not overwrite the last good .bak.
      await copyFile(this.configPath, backupPath, previousIsValid ? 0 : constants.COPYFILE_EXCL)
    } catch (error) {
      const code = errorCode(error)
      if (code !== 'ENOENT' && (previousIsValid || code !== 'EEXIST')) {
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

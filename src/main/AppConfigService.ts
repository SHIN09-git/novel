import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

interface AppConfig {
  storagePath?: string
}

export class AppConfigService {
  private readonly configPath: string

  constructor(private readonly userDataPath: string) {
    this.configPath = join(userDataPath, 'app-config.json')
  }

  getDefaultStoragePath(): string {
    return join(this.userDataPath, 'novel-director-data.json')
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
    await this.writeConfig({ ...(await this.readConfig()), storagePath: defaultPath })
    return defaultPath
  }

  async getConfigPath(): Promise<string> {
    return this.configPath
  }

  private async readConfig(): Promise<AppConfig> {
    try {
      return JSON.parse(await readFile(this.configPath, 'utf-8')) as AppConfig
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      if (code === 'ENOENT') return {}
      console.warn(`Failed to read app config at ${this.configPath}. Falling back to defaults.`, error)
      return {}
    }
  }

  private async writeConfig(config: AppConfig): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true })
    await writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8')
  }
}

import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { apiEndpoint, backupKeyAfterRejection, readApiRegistry, routeKey, sameApiEndpoint, type ApiRegistry } from './services/ApiRegistry'

interface CredentialFile {
  apiKey?: string
  baseUrl?: string
  updatedAt?: string
}

function storedForEndpoint(file: CredentialFile, registry: ApiRegistry, baseUrl: string): boolean {
  return Boolean(file.apiKey && (file.baseUrl ? sameApiEndpoint(registry, file.baseUrl, baseUrl) : !registry.size))
}

export class SecureCredentialService {
  private readonly credentialPath: string
  private pendingWrite = Promise.resolve()

  constructor(userDataPath: string) {
    this.credentialPath = join(userDataPath, 'secure-credentials.json')
  }

  getCredentialPath(): string {
    return this.credentialPath
  }

  private assertEncryptionAvailable(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Electron safeStorage 当前不可用，无法安全保存 API Key。请检查系统密钥环/凭据管理器后重试。')
    }
  }

  async hasApiKey(): Promise<boolean> {
    return (await this.getState()).anyAvailable
  }

  async isManagedEndpoint(baseUrl: string): Promise<boolean> {
    return (await readApiRegistry()).has(apiEndpoint(baseUrl))
  }

  async getState(baseUrl = '') {
    const registry = await readApiRegistry()
    const file = await this.readScopedCredential(registry)
    const route = registry.get(apiEndpoint(baseUrl))
    return {
      ok: true as const,
      hasApiKey: Boolean(file.apiKey),
      anyAvailable: Boolean(file.apiKey) || [...registry.values()].some((item) => Boolean(routeKey(item))),
      keyEnv: route?.keyEnv,
      envAvailable: Boolean(route && process.env[route.keyEnv]?.trim()),
      backupKeyEnv: route?.backupKeyEnv,
      backupAvailable: Boolean(route?.backupKeyEnv && process.env[route.backupKeyEnv]?.trim()),
      storedForEndpoint: storedForEndpoint(file, registry, baseUrl)
    }
  }

  async getBackupApiKey(baseUrl: string, rejected: string): Promise<string> {
    return backupKeyAfterRejection(await readApiRegistry(), baseUrl, rejected)
  }

  async getApiKey(baseUrl: string): Promise<string> {
    const registry = await readApiRegistry()
    const route = registry.get(apiEndpoint(baseUrl))
    const managedKey = route && routeKey(route)
    if (managedKey) return managedKey
    const file = await this.readScopedCredential(registry)
    if (!file.apiKey || !storedForEndpoint(file, registry, baseUrl)) {
      if (route) throw new Error(`服务 ${route.id} 缺少 ${route.keyEnv}。请配置后重新启动工作台。`)
      return ''
    }
    this.assertEncryptionAvailable()
    try {
      return safeStorage.decryptString(Buffer.from(file.apiKey, 'base64'))
    } catch {
      throw new Error('API Key 解密失败。请在设置页删除后重新保存。')
    }
  }

  private updateFile(write: () => Promise<void>): Promise<void> {
    const operation = this.pendingWrite.then(write)
    this.pendingWrite = operation.catch(() => {})
    return operation
  }

  private async readScopedCredential(registry: ApiRegistry): Promise<CredentialFile> {
    const file = await this.readCredentialFile()
    if (!file.apiKey || file.baseUrl) return file
    const approved = [...registry].find(([, route]) => route.legacyDesktopKey)
    if (!approved) return file
    await this.updateFile(async () => {
      const current = await this.readCredentialFile()
      if (current.apiKey && !current.baseUrl) await this.writeCredentialFile({ ...current, baseUrl: approved[0] })
    })
    return this.readCredentialFile()
  }

  private async writeCredentialFile(file: CredentialFile): Promise<void> {
    await mkdir(dirname(this.credentialPath), { recursive: true })
    const temp = this.credentialPath + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temp, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600 })
      await rename(temp, this.credentialPath)
    } finally {
      await rm(temp, { force: true })
    }
  }

  async setApiKey(apiKey: string, baseUrl = ''): Promise<void> {
    const trimmed = apiKey.trim()
    if (!trimmed) throw new Error('API Key 不能为空。')
    this.assertEncryptionAvailable()
    const encrypted = safeStorage.encryptString(trimmed).toString('base64')
    await this.updateFile(() => this.writeCredentialFile({
      apiKey: encrypted, baseUrl: apiEndpoint(baseUrl) || undefined, updatedAt: new Date().toISOString()
    }))
  }

  async deleteApiKey(): Promise<void> {
    await this.updateFile(() => rm(this.credentialPath, { force: true }))
  }

  async migrateLegacyApiKey(apiKey: string, baseUrl = ''): Promise<boolean> {
    const trimmed = apiKey.trim()
    if (!trimmed) return this.hasApiKey()
    await this.setApiKey(trimmed, baseUrl)
    return true
  }

  private async readCredentialFile(): Promise<CredentialFile> {
    try {
      const raw = await readFile(this.credentialPath, 'utf-8')
      const parsed = JSON.parse(raw) as CredentialFile
      return typeof parsed === 'object' && parsed !== null ? parsed : {}
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      if (code === 'ENOENT') return {}
      throw new Error('读取 API Key 安全存储失败。')
    }
  }
}

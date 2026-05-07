import { safeStorage } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

interface CredentialFile {
  apiKey?: string
  updatedAt?: string
}

export class SecureCredentialService {
  private readonly credentialPath: string

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
    const file = await this.readCredentialFile()
    return Boolean(file.apiKey)
  }

  async getApiKey(): Promise<string> {
    const file = await this.readCredentialFile()
    if (!file.apiKey) return ''
    this.assertEncryptionAvailable()
    try {
      return safeStorage.decryptString(Buffer.from(file.apiKey, 'base64'))
    } catch {
      throw new Error('API Key 解密失败。请在设置页删除后重新保存。')
    }
  }

  async setApiKey(apiKey: string): Promise<void> {
    const trimmed = apiKey.trim()
    if (!trimmed) throw new Error('API Key 不能为空。')
    this.assertEncryptionAvailable()
    const encrypted = safeStorage.encryptString(trimmed).toString('base64')
    await mkdir(dirname(this.credentialPath), { recursive: true })
    await writeFile(
      this.credentialPath,
      JSON.stringify(
        {
          apiKey: encrypted,
          updatedAt: new Date().toISOString()
        } satisfies CredentialFile,
        null,
        2
      ),
      'utf-8'
    )
  }

  async deleteApiKey(): Promise<void> {
    await rm(this.credentialPath, { force: true })
  }

  async migrateLegacyApiKey(apiKey: string): Promise<boolean> {
    const trimmed = apiKey.trim()
    if (!trimmed) return this.hasApiKey()
    await this.setApiKey(trimmed)
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

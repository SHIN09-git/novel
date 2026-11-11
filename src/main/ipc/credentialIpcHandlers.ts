import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc/ipcChannels'
import type {
  CredentialDeleteApiKeyResult,
  CredentialHasApiKeyResult,
  CredentialMigrateLegacyApiKeyResult,
  CredentialSetApiKeyRequest,
  CredentialSetApiKeyResult
} from '../../shared/ipc/ipcTypes'
import { validateApiKey, validateUrl } from '../../shared/validation'
import type { SecureCredentialService } from '../SecureCredentialService'
import { safeIpcHandler } from './safeIpcHandler'

export function registerCredentialIpcHandlers(credentialService: SecureCredentialService): void {
  ipcMain.handle(
    IPC_CHANNELS.CREDENTIALS_SET_API_KEY,
    safeIpcHandler(async (_event, request: CredentialSetApiKeyRequest | string): Promise<CredentialSetApiKeyResult> => {
      const apiKey = validateApiKey(typeof request === 'string' ? request : request.apiKey)
      const baseUrl = typeof request === 'object' && request.baseUrl ? validateUrl(request.baseUrl, 'AI Base URL') : ''
      await credentialService.setApiKey(apiKey, baseUrl)
      return { ok: true, hasApiKey: true }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.CREDENTIALS_HAS_API_KEY,
    safeIpcHandler(async (_event, baseUrl?: string): Promise<CredentialHasApiKeyResult> =>
      credentialService.getState(typeof baseUrl === 'string' ? baseUrl : ''))
  )

  ipcMain.handle(
    IPC_CHANNELS.CREDENTIALS_DELETE_API_KEY,
    safeIpcHandler(async (): Promise<CredentialDeleteApiKeyResult> => {
      await credentialService.deleteApiKey()
      return { ok: true, hasApiKey: false }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.CREDENTIALS_MIGRATE_LEGACY_API_KEY,
    safeIpcHandler(async (_event, apiKey: string): Promise<CredentialMigrateLegacyApiKeyResult> => ({
      ok: true,
      hasApiKey: await credentialService.migrateLegacyApiKey(validateApiKey(apiKey))
    }))
  )
}

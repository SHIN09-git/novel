import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc/ipcChannels'
import type {
  CredentialDeleteApiKeyResult,
  CredentialHasApiKeyResult,
  CredentialMigrateLegacyApiKeyResult,
  CredentialSetApiKeyRequest,
  CredentialSetApiKeyResult
} from '../../shared/ipc/ipcTypes'
import { validateApiKey } from '../../shared/validation'
import type { SecureCredentialService } from '../SecureCredentialService'
import { safeIpcHandler } from './safeIpcHandler'

export function registerCredentialIpcHandlers(credentialService: SecureCredentialService): void {
  ipcMain.handle(
    IPC_CHANNELS.CREDENTIALS_SET_API_KEY,
    safeIpcHandler(async (_event, request: CredentialSetApiKeyRequest | string): Promise<CredentialSetApiKeyResult> => {
      const apiKey = validateApiKey(typeof request === 'string' ? request : request.apiKey)
      await credentialService.setApiKey(apiKey)
      return { ok: true, hasApiKey: true }
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.CREDENTIALS_HAS_API_KEY,
    safeIpcHandler(async (): Promise<CredentialHasApiKeyResult> => ({
      ok: true,
      hasApiKey: await credentialService.hasApiKey()
    }))
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

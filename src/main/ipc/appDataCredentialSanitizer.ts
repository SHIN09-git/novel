import { normalizeAppData, sanitizeAppDataForPersistence } from '../../shared/defaults'
import { getUserFriendlyError } from '../../shared/errorUtils'
import type { AppData } from '../../shared/types'
import type { SecureCredentialService } from '../SecureCredentialService'

export interface SecuredAppDataResult {
  data: AppData
  migratedLegacyApiKey: boolean
  credentialWarning?: string
}

export interface SecureAppDataOptions {
  migrateLegacyApiKey?: boolean
}

export interface AppDataCredentialContext {
  credentialService: Pick<SecureCredentialService, 'hasApiKey' | 'migrateLegacyApiKey'>
}

export async function secureAndSanitizeAppData(
  context: AppDataCredentialContext,
  data: AppData,
  options: SecureAppDataOptions = {}
): Promise<SecuredAppDataResult> {
  const normalized = normalizeAppData(data)
  const legacyApiKey = normalized.settings.apiKey.trim()
  const migrateLegacyApiKey = options.migrateLegacyApiKey !== false
  let hasApiKey = normalized.settings.hasApiKey
  let migratedLegacyApiKey = false
  let credentialWarning = ''

  if (legacyApiKey && migrateLegacyApiKey) {
    try {
      await context.credentialService.migrateLegacyApiKey(legacyApiKey)
      hasApiKey = true
      migratedLegacyApiKey = true
    } catch (error) {
      hasApiKey = false
      credentialWarning = `旧 API Key 迁移到安全存储失败，已从 AppData 中移除：${getUserFriendlyError(error)}`
    }
  } else {
    if (legacyApiKey) {
      credentialWarning = '导入文件包含旧版 API Key，已忽略；本机凭据不会被外部数据替换。'
    }
    try {
      hasApiKey = await context.credentialService.hasApiKey()
    } catch (error) {
      const readWarning = `读取 API Key 安全存储状态失败：${getUserFriendlyError(error)}`
      credentialWarning = credentialWarning ? `${credentialWarning} ${readWarning}` : readWarning
    }
  }

  return {
    data: sanitizeAppDataForPersistence({
      ...normalized,
      settings: {
        ...normalized.settings,
        apiKey: '',
        hasApiKey
      }
    }),
    migratedLegacyApiKey,
    credentialWarning
  }
}

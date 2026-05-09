import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve('.')
const rcDataPath = join(root, 'tmp', 'rc-regression', 'novel-director-data.json')
const migratedDataPath = join(root, 'tmp', 'rc-regression', 'migrated-storage', 'novel-director-data.json')
const sentinelKey = 'TEST_PLAINTEXT_KEY_SHOULD_NEVER_APPEAR'

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function read(relativePath) {
  return readFile(join(root, relativePath), 'utf-8')
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf-8'))
}

function apiKeyIsEmpty(data) {
  return data?.settings?.apiKey === ''
}

async function main() {
  const checks = []
  const secureService = await read('src/main/SecureCredentialService.ts')
  const channels = await read('src/shared/ipc/ipcChannels.ts')
  const ipcTypes = await read('src/shared/ipc/ipcTypes.ts')
  const preload = await read('src/preload/index.ts')
  const handlers = await read('src/main/ipc/registerIpcHandlers.ts')
  const defaults = await read('src/shared/defaults.ts')
  const storage = await read('src/storage/JsonStorageService.ts')
  const dataMerge = await read('src/main/DataMergeService.ts')
  const settingsView = await read('src/renderer/src/views/SettingsView.tsx')
  const aiClient = await read('src/services/ai/AIClient.ts')
  const fixtureData = await readJson(rcDataPath)
  const migratedData = await readJson(migratedDataPath)
  const combinedSource = [secureService, handlers, defaults, storage, dataMerge, settingsView, aiClient].join('\n')

  checks.push(
    assert(
      secureService.includes('safeStorage.encryptString') &&
        secureService.includes('safeStorage.decryptString') &&
        secureService.includes('isEncryptionAvailable') &&
        !secureService.includes('console.log'),
      'SecureCredentialService uses Electron safeStorage and does not log credentials'
    )
  )

  checks.push(
    assert(
      ['CREDENTIALS_SET_API_KEY', 'CREDENTIALS_HAS_API_KEY', 'CREDENTIALS_DELETE_API_KEY', 'CREDENTIALS_MIGRATE_LEGACY_API_KEY'].every(
        (name) => channels.includes(name)
      ) && ipcTypes.includes('CredentialStateResult'),
      'credential IPC channels and result types are centralized'
    )
  )

  checks.push(
    assert(
      preload.includes('credentials: {') &&
        preload.includes('setApiKey') &&
        preload.includes('hasApiKey') &&
        preload.includes('deleteApiKey') &&
        !preload.includes('getApiKey:'),
      'preload exposes write/check/delete credential APIs but no plaintext read API'
    )
  )

  checks.push(
    assert(
      handlers.includes('secureAndSanitizeAppData') &&
        handlers.includes('migrateLegacyApiKey') &&
        handlers.includes('credentialService.getApiKey()') &&
        handlers.includes('sanitizeAiErrorText(errorText, apiKey)') &&
        !handlers.includes('headers.Authorization = `Bearer ${settings.apiKey'),
      'main process migrates legacy keys, injects secure key for AI calls, and redacts AI errors'
    )
  )

  checks.push(
    assert(
      defaults.includes('sanitizeAppDataForPersistence') &&
        defaults.includes("apiKey: ''") &&
        storage.includes('sanitizeAppDataForPersistence(data)'),
      'normal AppData persistence strips plaintext settings.apiKey before writing JSON'
    )
  )

  checks.push(
    assert(apiKeyIsEmpty(fixtureData), 'normal saved AppData JSON has settings.apiKey === empty string', {
      apiKey: fixtureData?.settings?.apiKey
    })
  )

  checks.push(
    assert(
      handlers.includes('JSON.stringify(sanitizeAppDataForPersistence(data), null, 2)'),
      'data export path sanitizes AppData before writing JSON'
    )
  )

  checks.push(
    assert(
      handlers.includes('await storage.save(secured.data)') &&
        handlers.includes('await nextStorage.save(secured.data)') &&
        handlers.includes('backupFileForOverwrite(targetPath)'),
      'storage migration overwrite path saves sanitized data and backs up target data'
    )
  )

  checks.push(
    assert(apiKeyIsEmpty(migratedData), 'migration target JSON has settings.apiKey === empty string', {
      apiKey: migratedData?.settings?.apiKey
    })
  )

  checks.push(
    assert(
      dataMerge.includes('const sanitizedMergedData = sanitizeAppDataForPersistence(mergedData)') &&
        dataMerge.includes('mergedSummary: summarizeDataFile(sanitizedMergedData)') &&
        dataMerge.includes('await storage.save(mergedData)'),
      'DataMergeService sanitizes merged AppData and writes through JsonStorageService'
    )
  )

  checks.push(
    assert(
      handlers.includes('const legacyApiKey = normalized.settings.apiKey.trim()') &&
        handlers.includes('await context.credentialService.migrateLegacyApiKey(legacyApiKey)') &&
        handlers.includes('apiKey: \'\',') &&
        handlers.includes('await storage.save(secured.data)'),
      'legacy AppData apiKey is migrated to secure storage and removed before persistence'
    )
  )

  checks.push(
    assert(
      defaults.includes('export function sanitizeAppDataForPersistence') &&
        defaults.includes('const normalized = normalizeAppData(input)') &&
        defaults.includes("apiKey: ''"),
      'sanitizeAppDataForPersistence always clears settings.apiKey'
    )
  )

  checks.push(
    assert(
      settingsView.includes('async function updateSettings(patch: Partial<AppSettings>)') &&
        settingsView.includes('await saveData((current) => ({') &&
        settingsView.includes('...current.settings') &&
        settingsView.includes("apiKey: ''") &&
        !settingsView.includes('await saveData({ ...data, settings: { ...data.settings'),
      'SettingsView.updateSettings uses functional saveData and clears transient apiKey'
    )
  )

  checks.push(
    assert(
      settingsView.includes('apiKeyInput') &&
        settingsView.includes('hasStoredApiKey') &&
        !settingsView.includes('value={data.settings.apiKey}'),
      'settings UI displays saved-key state without binding to plaintext AppData apiKey'
    )
  )

  checks.push(
    assert(
      aiClient.includes('settings.hasApiKey') &&
        aiClient.includes('window.novelDirector.ai.chatCompletion'),
      'renderer AI client checks saved-key state and delegates network calls to main process'
    )
  )

  checks.push(
    assert(
      !combinedSource.includes(sentinelKey) &&
        !combinedSource.includes('console.log(apiKey') &&
        !combinedSource.includes('console.error(apiKey') &&
        !combinedSource.includes('throw new Error(apiKey'),
      'source does not contain obvious plaintext API key logging or error propagation'
    )
  )

  checks.push(
    assert(
      dataMerge.includes('before-merge') && dataMerge.includes('before-overwrite'),
      'legacy backups are distinct from current-version-written JSON; old backups may retain historical plaintext keys'
    )
  )

  const failed = checks.filter((check) => !check.ok)
  const report = { ok: failed.length === 0, totalChecks: checks.length, failed }
  console.log(JSON.stringify(report, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

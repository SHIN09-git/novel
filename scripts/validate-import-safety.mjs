#!/usr/bin/env node
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'import-safety-test')

function assert(condition, message, details = undefined) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : ''
    throw new Error(`${message}${suffix}`)
  }
  console.log(`PASS ${message}`)
}

async function read(relativePath) {
  return readFile(join(root, relativePath), 'utf-8')
}

async function bundle(relativePath, outfileName) {
  await mkdir(outDir, { recursive: true })
  const outfile = join(outDir, outfileName)
  await build({
    entryPoints: [join(root, relativePath)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3', 'electron'],
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

function partialData(projectId, name, apiKey = '') {
  return {
    schemaVersion: 3,
    projects: [{
      id: projectId,
      name,
      genre: '',
      description: '',
      targetReaders: '',
      coreAppeal: '',
      style: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }],
    settings: {
      apiProvider: 'openai',
      apiKey,
      hasApiKey: Boolean(apiKey),
      baseUrl: '',
      modelName: name,
      temperature: 0.8,
      maxTokens: 8000,
      retryEnabled: true,
      maxRetries: 3,
      enableAutoSummary: false,
      enableChapterDiagnostics: false,
      defaultTokenBudget: 16000,
      defaultPromptMode: 'standard',
      theme: 'system'
    }
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true })

  const credentialSanitizer = await bundle('src/main/ipc/appDataCredentialSanitizer.ts', 'credential-sanitizer.mjs')
  const dataMerge = await bundle('src/main/DataMergeService.ts', 'data-merge.mjs')
  const migrationCalls = []
  const context = {
    credentialService: {
      migrateLegacyApiKey: async (value) => migrationCalls.push(value),
      hasApiKey: async () => true
    }
  }

  const externalCredential = 'TEST_EXTERNAL_CREDENTIAL_MUST_BE_IGNORED'
  const externalData = partialData('external-project', '外部项目', externalCredential)
  const ignoredCredential = await credentialSanitizer.secureAndSanitizeAppData(context, externalData, {
    migrateLegacyApiKey: false
  })
  assert(migrationCalls.length === 0, 'external JSON credentials are never migrated into local secure storage')
  assert(ignoredCredential.data.settings.apiKey === '', 'external JSON plaintext API keys are stripped')
  assert(ignoredCredential.data.settings.hasApiKey === true, 'import keeps the local secure-credential availability state')
  assert(
    ignoredCredential.credentialWarning?.includes('已忽略'),
    'authors are told when an imported legacy API key was ignored'
  )

  await credentialSanitizer.secureAndSanitizeAppData(context, externalData)
  assert(
    migrationCalls.length === 1 && migrationCalls[0] === externalCredential,
    'legacy migration remains available for the active local data file'
  )

  const currentData = partialData('current-project', '当前项目')
  const merged = dataMerge.mergeAppData(externalData, currentData, {
    sourcePath: 'external.json',
    targetPath: 'novel-director-data.sqlite'
  })
  assert(merged.preview.canAutoMerge, 'non-conflicting imported projects can be merged automatically')
  assert(
    merged.mergedData.projects.some((project) => project.id === 'current-project') &&
      merged.mergedData.projects.some((project) => project.id === 'external-project'),
    'merge import preserves current projects and adds external projects'
  )
  assert(merged.mergedData.settings.modelName === '当前项目', 'merge import preserves current local settings')
  assert(!JSON.stringify(merged.mergedData).includes(externalCredential), 'merge output does not retain imported credentials')

  const conflicting = dataMerge.mergeAppData(
    partialData('current-project', '同 ID 的不同项目'),
    currentData,
    { sourcePath: 'conflict.json', targetPath: 'novel-director-data.sqlite' }
  )
  assert(
    conflicting.preview.operations.some(
      (operation) => operation.action === 'rename_source_id' && operation.entityId !== 'current-project'
    ),
    'project ID conflicts are imported as traceable copies rather than overwriting current data'
  )

  const ipcTypes = await read('src/shared/ipc/ipcTypes.ts')
  const dataIpc = await read('src/main/ipc/dataIpcHandlers.ts')
  const preload = await read('src/preload/index.ts')
  const useAppData = await read('src/renderer/src/hooks/useAppData.ts')
  const homeView = await read('src/renderer/src/views/HomeView.tsx')
  const settingsStorage = await read('src/renderer/src/views/settings/useSettingsStorage.ts')
  const settingsPanels = [
    await read('src/renderer/src/views/settings/SettingsCorePanels.tsx'),
    await read('src/renderer/src/views/settings/SettingsDataPanels.tsx')
  ].join('\n')
  const testRunner = await read('scripts/run-tests.mjs')

  assert(ipcTypes.includes("ImportDataStrategy = 'merge' | 'replace'"), 'import IPC distinguishes merge and replace semantics')
  assert(
    dataIpc.includes('migrateLegacyApiKey: false') &&
      dataIpc.includes("request?.strategy === 'merge'") &&
      dataIpc.includes('mergeAppData('),
    'main-process import ignores external credentials and owns merge execution'
  )
  const conflictGuard = dataIpc.indexOf('if (!mergePreview.canAutoMerge)')
  const backupWrite = dataIpc.indexOf('createBackup(currentSnapshot.data, false)')
  assert(
    conflictGuard >= 0 && backupWrite > conflictGuard,
    'unresolved merge conflicts return before backup/write side effects'
  )
  assert(
    preload.includes("import: async (strategy: ImportDataStrategy = 'replace')") &&
      preload.includes('expectedRevision: storageRevision, strategy'),
    'preload carries import strategy and optimistic revision without exposing filesystem access'
  )
  assert(
    useAppData.includes('createOperationQueue()') &&
      useAppData.includes('async function importData(strategy: ImportDataStrategy)') &&
      useAppData.includes('await enqueueStorageWrite(async () =>') &&
      useAppData.includes('commitPersistedData(imported.data)'),
    'imports share the renderer persistence queue and adopt the already-persisted snapshot without a second full save'
  )
  assert(
    homeView.includes("data.projects.length > 0 ? 'merge' : 'replace'") &&
      homeView.includes('mergeBlocked') &&
      !homeView.includes('replaceData'),
    'home import merges into non-empty workspaces and never silently replaces them'
  )
  assert(
    settingsStorage.includes("strategy === 'replace'") &&
      settingsStorage.includes('覆盖导入会用所选 JSON 替换当前本地数据'),
    'replace import requires an explicit destructive confirmation'
  )
  assert(
    settingsPanels.includes("storage.importData('merge')") &&
      settingsPanels.includes("storage.importData('replace')") &&
      settingsPanels.includes('合并导入 JSON') &&
      settingsPanels.includes('覆盖导入 JSON'),
    'settings exposes clear merge and replace import actions'
  )
  assert(testRunner.includes('validate-import-safety.mjs'), 'npm test includes import safety regression coverage')

  console.log('Import safety validation passed.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

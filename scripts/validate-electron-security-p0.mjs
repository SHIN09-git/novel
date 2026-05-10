import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve('.')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function read(relativePath) {
  return readFile(join(root, relativePath), 'utf-8')
}

async function main() {
  const checks = []
  const main = await read('src/main/index.ts')
  const preload = await read('src/preload/index.ts')
  const globalTypes = await read('src/renderer/src/global.d.ts')
  const ipcHandlers = await read('src/main/ipc/registerIpcHandlers.ts')
  const safeIpcHandler = await read('src/main/ipc/safeIpcHandler.ts')
  const errorUtils = await read('src/shared/errorUtils.ts')
  const runTests = await read('scripts/run-tests.mjs')
  const sourceForLegacyApiSearch = [preload, globalTypes].join('\n')

  checks.push(
    assert(
      main.includes('sandbox: true') &&
        main.includes('contextIsolation: true') &&
        main.includes('nodeIntegration: false'),
      'BrowserWindow enables sandbox, context isolation, and disables node integration'
    )
  )

  checks.push(
    assert(
      main.includes('Content-Security-Policy') &&
        main.includes('webRequest.onHeadersReceived') &&
        main.includes("object-src 'none'") &&
        main.includes("frame-ancestors 'none'") &&
        !main.includes("'unsafe-eval'"),
      'main process installs a restrictive CSP without unsafe-eval'
    )
  )

  checks.push(
    assert(
      main.includes('canOpenExternalUrl') &&
        main.includes("parsed.protocol === 'https:'") &&
        main.includes("parsed.protocol === 'mailto:'") &&
        main.includes('will-navigate'),
      'external URL and renderer navigation paths are constrained'
    )
  )

  checks.push(
    assert(
      main.includes('executeJavaScript') &&
        main.includes("process.env.NOVEL_DIRECTOR_SMOKE_TEST === '1'") &&
        main.includes('if (isSmokeTest)'),
      'executeJavaScript is limited to the smoke-test path'
    )
  )

  checks.push(
    assert(
      preload.includes("contextBridge.exposeInMainWorld('novelDirector', novelDirector)") &&
        !sourceForLegacyApiSearch.includes('novelAPI') &&
        !preload.includes('export type NovelAPI'),
      'preload exposes only the grouped window.novelDirector API surface'
    )
  )

  checks.push(
    assert(
      errorUtils.includes('Authorization') &&
        errorUtils.includes('x-api-key') &&
        errorUtils.includes('sk-ant') &&
        errorUtils.includes('sk-(?:proj-)?') &&
        safeIpcHandler.includes('redactSensitiveText(getUserFriendlyError(error))'),
      'IPC and AI error paths use broader credential redaction'
    )
  )

  checks.push(
    assert(
      ipcHandlers.includes('assertSafeDataStoragePath') &&
        ipcHandlers.includes('getForbiddenStorageRoots') &&
        ipcHandlers.includes('localDataFileExtensions') &&
        ipcHandlers.includes('parse(targetDir).root === targetDir') &&
        ipcHandlers.includes('Data storage path must end with .sqlite, .db, or .json.'),
      'storage path inputs are normalized and checked before use'
    )
  )

  checks.push(
    assert(
      ipcHandlers.includes('const sourcePath = await resolveDataStoragePath(request.sourcePath)') &&
        ipcHandlers.includes('const targetPath = await resolveDataStoragePath(request.targetPath)') &&
        ipcHandlers.includes('storagePath ? await resolveDataStoragePath(storagePath)'),
      'migration preview, merge, and open-folder IPC paths use main-process validation'
    )
  )

  checks.push(
    assert(
      !/dangerouslySetInnerHTML|insertAdjacentHTML|new Function/.test(await read('src/renderer/src/App.tsx')) &&
        !/window\.novelAPI/.test(await read('src/renderer/src/App.tsx')),
      'renderer shell does not use dangerous HTML injection or the removed legacy API'
    )
  )

  checks.push(
    assert(
      runTests.includes('validate-electron-security-p0.mjs'),
      'npm test includes the Electron security P0 validation script'
    )
  )

  const failures = checks.filter((check) => !check.ok)
  for (const check of checks) {
    console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.message}`)
    if (!check.ok && Object.keys(check.details).length) console.log(JSON.stringify(check.details, null, 2))
  }

  if (failures.length) {
    console.error(`Electron security P0 validation failed: ${failures.length} issue(s).`)
    process.exit(1)
  }

  console.log('Electron security P0 validation passed.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

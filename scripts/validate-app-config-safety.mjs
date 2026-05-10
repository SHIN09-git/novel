import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = resolve('.')
const outDir = join(root, 'tmp', 'app-config-safety-test')
const userDataDir = join(outDir, 'userData')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function compileTsModulePath(relativePath, replacements = []) {
  const sourcePath = join(root, relativePath)
  let source = await readFile(sourcePath, 'utf-8')
  for (const [from, to] of replacements) source = source.replace(from, to)
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      useDefineForClassFields: true
    }
  })
  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, `${relativePath.replace(/[\\/.:]/g, '-')}.mjs`)
  await writeFile(outPath, compiled.outputText, 'utf-8')
  return outPath
}

async function compileTsModule(relativePath, replacements = []) {
  const outPath = await compileTsModulePath(relativePath, replacements)
  return import(`${pathToFileURL(outPath).href}?t=${Date.now()}`)
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf-8'))
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(userDataDir, { recursive: true })

  const checks = []
  const storageServicePath = await compileTsModulePath('src/storage/StorageService.ts')
  const { AppConfigService } = await compileTsModule('src/main/AppConfigService.ts', [
    ["from '../storage/StorageService'", `from '${pathToFileURL(storageServicePath).href}'`]
  ])
  const service = new AppConfigService(userDataDir)
  const configPath = await service.getConfigPath()
  const defaultStoragePath = service.getDefaultStoragePath()

  checks.push(
    assert(
      (await service.getStoragePath()) === defaultStoragePath,
      'missing app-config falls back to default storage path',
      { defaultStoragePath }
    )
  )

  const firstPath = join(outDir, 'first', 'novel-director-data.json')
  await service.setStoragePath(firstPath)
  const firstConfig = await readJson(configPath)
  checks.push(
    assert(
      firstConfig.storagePath === firstPath && !existsSync(`${configPath}.tmp`),
      'setStoragePath writes config through a completed tmp/rename cycle',
      { firstConfig, tmpExists: existsSync(`${configPath}.tmp`) }
    )
  )

  const secondPath = join(outDir, 'second', 'novel-director-data.json')
  await service.setStoragePath(secondPath)
  const secondConfig = await readJson(configPath)
  const backupConfig = await readJson(`${configPath}.bak`)
  checks.push(
    assert(
      secondConfig.storagePath === secondPath && backupConfig.storagePath === firstPath,
      'setStoragePath creates app-config.json.bak before replacing existing config',
      { secondConfig, backupConfig }
    )
  )

  await writeFile(configPath, '{ broken json', 'utf-8')
  const capturedWarnings = []
  const originalWarn = console.warn
  console.warn = (...args) => {
    capturedWarnings.push(args.map(String).join(' '))
  }
  let fallbackPath
  try {
    fallbackPath = await service.getStoragePath()
  } finally {
    console.warn = originalWarn
  }
  const filesAfterCorruptLoad = await readdir(userDataDir)
  const corruptBackups = filesAfterCorruptLoad.filter((name) => name.startsWith('app-config.json.corrupt.') && name.endsWith('.json'))
  const corruptBackupText = corruptBackups.length ? await readFile(join(userDataDir, corruptBackups[0]), 'utf-8') : ''
  checks.push(
    assert(
      fallbackPath === defaultStoragePath &&
        corruptBackups.length === 1 &&
        corruptBackupText === '{ broken json' &&
        capturedWarnings.some((warning) => warning.includes('Backed up corrupt config')),
      'corrupt app-config is backed up before falling back to defaults',
      { fallbackPath, corruptBackups, corruptBackupText, capturedWarnings }
    )
  )

  const resetPath = await service.resetStoragePath()
  const resetConfig = await readJson(configPath)
  checks.push(
    assert(
      resetPath === defaultStoragePath && resetConfig.storagePath === defaultStoragePath && !existsSync(`${configPath}.tmp`),
      'resetStoragePath also writes safely and leaves no tmp file',
      { resetPath, resetConfig, tmpExists: existsSync(`${configPath}.tmp`) }
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

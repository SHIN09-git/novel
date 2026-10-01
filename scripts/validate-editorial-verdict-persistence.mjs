import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import Database from 'better-sqlite3'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'editorial-verdict-persistence-test')
const timestamp = '2026-09-06T00:00:00.000Z'

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function bundle(entryPoint, fileName) {
  const outfile = join(outDir, fileName)
  await build({
    entryPoints: [join(root, entryPoint)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3'],
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

function generationData(normalizeAppData, jobId) {
  const projectId = `project-${jobId}`
  const draftId = `draft-${jobId}`
  const verdictId = `verdict-${jobId}`
  const traceId = `trace-${jobId}`
  return normalizeAppData({
    schemaVersion: 3,
    projects: [{ id: projectId, name: projectId, createdAt: timestamp, updatedAt: timestamp }],
    chapterGenerationJobs: [{
      id: jobId,
      projectId,
      targetChapterOrder: 2,
      promptContextSnapshotId: null,
      contextSource: 'auto',
      status: 'completed',
      currentStep: 'await_user_confirmation',
      createdAt: timestamp,
      updatedAt: timestamp,
      errorMessage: ''
    }],
    generatedChapterDrafts: [{
      id: draftId,
      projectId,
      chapterId: null,
      jobId,
      title: 'Draft',
      body: `canonical draft body for ${jobId}`,
      summary: '',
      status: 'draft',
      tokenEstimate: 8,
      createdAt: timestamp,
      updatedAt: timestamp
    }],
    editorialVerdicts: [{
      id: verdictId,
      projectId,
      chapterId: null,
      jobId,
      draftId,
      draftContentHash: `hash-${jobId}`,
      draftRevision: timestamp,
      status: 'approved',
      canAccept: true,
      summary: 'Diagnostics passed.',
      blockers: [],
      advisories: [],
      actions: [{ actionType: 'accept_draft', label: 'Accept', reason: 'Passed.', priority: 1 }],
      sourceRefs: {
        qualityGateReportId: null,
        consistencyReviewReportId: null,
        redundancyReportId: null,
        noveltyAuditTraceId: null,
        generationRunTraceId: traceId,
        characterStateIssueIds: [],
        ignoredStaleReportIds: []
      },
      schemaVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    }],
    generationRunTraces: [{
      id: traceId,
      projectId,
      jobId,
      targetChapterOrder: 2,
      generatedDraftId: draftId,
      editorialVerdictId: verdictId,
      createdAt: timestamp,
      updatedAt: timestamp
    }]
  })
}

function withoutEditorialVerdict(bundle) {
  return {
    ...bundle,
    editorialVerdicts: [],
    runTrace: bundle.runTrace ? { ...bundle.runTrace, editorialVerdictId: null } : undefined
  }
}

function verdictIsCompact(verdict) {
  return verdict &&
    !Object.prototype.hasOwnProperty.call(verdict, 'body') &&
    !Object.prototype.hasOwnProperty.call(verdict, 'draftBody') &&
    !Object.prototype.hasOwnProperty.call(verdict, 'fullPrompt') &&
    !Object.prototype.hasOwnProperty.call(verdict, 'apiKey')
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const checks = []
  const defaults = await bundle('src/shared/defaults.ts', 'defaults.mjs')
  const bundleService = await bundle('src/services/GenerationRunBundleService.ts', 'bundle-service.mjs')
  const sqliteModule = await bundle('src/storage/SqliteStorageService.ts', 'sqlite-storage.mjs')
  const jsonModule = await bundle('src/storage/JsonStorageService.ts', 'json-storage.mjs')
  const { normalizeAppData } = defaults
  const { buildGenerationRunBundle } = bundleService
  const { SqliteStorageService } = sqliteModule
  const { JsonStorageService } = jsonModule

  const unrelatedData = generationData(normalizeAppData, 'other-job')
  const targetData = generationData(normalizeAppData, 'target-job')
  const targetBundle = buildGenerationRunBundle(targetData, 'target-job')
  const initialData = {
    ...unrelatedData,
    settings: { ...unrelatedData.settings, apiKey: 'must-not-persist', hasApiKey: true }
  }

  const sqlitePath = join(outDir, 'round-trip.sqlite')
  const sqlite = new SqliteStorageService(sqlitePath, { legacyJsonPath: join(outDir, 'unused-legacy.json') })
  await sqlite.save(initialData)
  await sqlite.saveGenerationRunBundle(withoutEditorialVerdict(targetBundle))
  const sqliteWrite = await sqlite.saveGenerationRunBundle(targetBundle)
  await sqlite.saveGenerationRunBundle(targetBundle)
  const sqliteLoaded = await sqlite.load()
  sqlite.close()
  const sqliteTargetVerdicts = sqliteLoaded.editorialVerdicts.filter((item) => item.jobId === 'target-job')
  checks.push(assert(
    sqliteWrite.savedCollections.includes('editorialVerdicts') &&
      sqliteTargetVerdicts.length === 1 &&
      sqliteLoaded.generationRunTraces.find((item) => item.jobId === 'target-job')?.editorialVerdictId === sqliteTargetVerdicts[0]?.id &&
      sqliteLoaded.editorialVerdicts.some((item) => item.jobId === 'other-job') &&
      sqliteLoaded.chapterGenerationJobs.some((item) => item.id === 'other-job'),
    'SQLite incrementally and idempotently round-trips verdicts without changing another job'
  ))
  checks.push(assert(
    verdictIsCompact(sqliteTargetVerdicts[0]) && sqliteLoaded.settings.apiKey === '',
    'SQLite stores compact verdict references and no API key'
  ))

  const rollbackPath = join(outDir, 'rollback.sqlite')
  const rollbackSeed = new SqliteStorageService(rollbackPath, { legacyJsonPath: join(outDir, 'unused-rollback.json') })
  await rollbackSeed.save(unrelatedData)
  rollbackSeed.close()
  const rollbackDb = new Database(rollbackPath)
  rollbackDb.exec(`
    CREATE TRIGGER fail_editorial_verdict_insert
    BEFORE INSERT ON entities
    WHEN NEW.collection = 'editorialVerdicts'
    BEGIN
      SELECT RAISE(FAIL, 'simulated editorial verdict failure');
    END;
  `)
  rollbackDb.close()
  let transactionFailed = false
  const failingSqlite = new SqliteStorageService(rollbackPath, { legacyJsonPath: join(outDir, 'unused-rollback.json') })
  try {
    await failingSqlite.saveGenerationRunBundle(targetBundle)
  } catch {
    transactionFailed = true
  }
  failingSqlite.close()
  const afterFailureStorage = new SqliteStorageService(rollbackPath, { legacyJsonPath: join(outDir, 'unused-rollback.json') })
  const afterFailure = await afterFailureStorage.load()
  afterFailureStorage.close()
  checks.push(assert(
    transactionFailed &&
      !afterFailure.chapterGenerationJobs.some((item) => item.id === 'target-job') &&
      !afterFailure.editorialVerdicts.some((item) => item.jobId === 'target-job') &&
      afterFailure.editorialVerdicts.some((item) => item.jobId === 'other-job'),
    'SQLite rolls back the whole generation bundle when verdict persistence fails'
  ))

  const jsonPath = join(outDir, 'fallback.json')
  const json = new JsonStorageService(jsonPath)
  await json.save(initialData)
  await json.saveGenerationRunBundle(withoutEditorialVerdict(targetBundle))
  const jsonWrite = await json.saveGenerationRunBundle(targetBundle)
  await json.saveGenerationRunBundle(targetBundle)
  const jsonLoaded = await json.load()
  const rawJson = await readFile(jsonPath, 'utf8')
  const jsonTargetVerdicts = jsonLoaded.editorialVerdicts.filter((item) => item.jobId === 'target-job')
  checks.push(assert(
    jsonWrite.savedCollections.includes('editorialVerdicts') &&
      jsonTargetVerdicts.length === 1 &&
      jsonLoaded.generationRunTraces.find((item) => item.jobId === 'target-job')?.editorialVerdictId === jsonTargetVerdicts[0]?.id &&
      jsonLoaded.editorialVerdicts.some((item) => item.jobId === 'other-job') &&
      !rawJson.includes('must-not-persist') &&
      verdictIsCompact(jsonTargetVerdicts[0]),
    'JSON fallback round-trips compact verdicts, preserves other jobs, and strips credentials'
  ))

  const legacyPath = join(outDir, 'legacy.json')
  await writeFile(legacyPath, JSON.stringify({
    schemaVersion: 2,
    settings: {},
    generationRunTraces: [{
      id: 'legacy-trace',
      projectId: 'legacy-project',
      jobId: 'legacy-job',
      targetChapterOrder: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    }]
  }), 'utf8')
  const legacyLoaded = await new JsonStorageService(legacyPath).load()
  checks.push(assert(
    Array.isArray(legacyLoaded.editorialVerdicts) && legacyLoaded.editorialVerdicts.length === 0 &&
      legacyLoaded.generationRunTraces[0]?.editorialVerdictId === null,
    'legacy JSON without verdicts or trace references remains readable and normalizes the new reference to null'
  ))

  const failed = checks.filter((check) => !check.ok)
  for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.message}`)
  if (failed.length) {
    console.error(JSON.stringify(failed, null, 2))
    process.exit(1)
  }
  console.log(`Editorial verdict persistence validation passed: ${checks.length} checks.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

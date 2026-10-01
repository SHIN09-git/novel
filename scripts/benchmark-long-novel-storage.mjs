#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import Database from 'better-sqlite3'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'
import { createLongNovelFixture, LONG_NOVEL_PROJECT_ID, LONG_NOVEL_FIXTURE_VERSION } from './fixtures/long-novel-performance.mjs'

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  if (i === -1) return fallback
  assert(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), `${name} needs a value`)
  return process.argv[i + 1]
}
const sizes = arg('--sizes', '10,100,500').split(',').map(Number)
const iterations = Number(arg('--iterations', '9')), warmups = Number(arg('--warmups', '2'))
assert(sizes.length && sizes.every((n) => Number.isInteger(n) && n >= 1 && n <= 1000))
assert(Number.isInteger(iterations) && iterations >= 1 && iterations <= 100)
assert(Number.isInteger(warmups) && warmups >= 0 && warmups <= 20)
const output = resolve(repoRoot, arg('--output', 'tmp/performance/long-novel-storage.json'))
const temporaryRoot = join(repoRoot, 'tmp', 'performance', 'long-novel-storage-runs')
const round = (n) => Math.round(n * 1000) / 1000
const percentile = (a, q) => [...a].sort((x, y) => x - y)[Math.max(0, Math.ceil(a.length * q) - 1)]
const summary = (samples) => ({ p50Ms: round(percentile(samples, .5)), p95Ms: round(percentile(samples, .95)),
  minMs: round(Math.min(...samples)), maxMs: round(Math.max(...samples)), samplesMs: samples.map(round) })
const memory = () => Object.fromEntries(['rss', 'heapUsed', 'external'].map((key) => [key, process.memoryUsage()[key]]))
async function bytes(path) { try { return (await stat(path)).size } catch { return 0 } }
function inside(parent, path) {
  const p = relative(parent, path)
  return Boolean(p) && !isAbsolute(p) && p !== '..' && !p.startsWith('..' + sep)
}
assert(inside(join(repoRoot, 'tmp'), output), '--output must be inside workspace tmp')

async function measure(fn) {
  for (let i = 0; i < warmups; i++) await fn(i)
  const samples = [], before = memory()
  let value
  for (let i = 0; i < iterations; i++) {
    const started = performance.now()
    value = await fn(i + warmups)
    samples.push(performance.now() - started)
  }
  return { ...summary(samples), memoryBefore: before, memoryAfter: memory(), value }
}

await mkdir(temporaryRoot, { recursive: true })
const workspace = await mkdtemp(join(temporaryRoot, 'run-'))
assert(inside(temporaryRoot, workspace))
const entryPath = join(workspace, 'entry.mjs')
await build({ stdin: { resolveDir: repoRoot, contents: `
  export { normalizeAppData, sanitizeAppDataForPersistence } from './src/shared/defaults';
  export { SqliteStorageService, loadSqliteSnapshotReadonly } from './src/storage/SqliteStorageService';
  export { AgentToolService } from './src/agent/tools/AgentToolService';
  export { buildGenerationRunBundle } from './src/services/GenerationRunBundleService';
` }, outfile: entryPath, bundle: true, platform: 'node', format: 'esm', target: 'node24',
  packages: 'external', logLevel: 'silent' })
const modules = await import(pathToFileURL(entryPath).href)
const packageInfo = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
const result = { schemaVersion: 1, measuredAt: new Date().toISOString(), label: arg('--label', 'current'),
  fixtureVersion: LONG_NOVEL_FIXTURE_VERSION, iterations, warmups,
  environment: { platform: process.platform, release: os.release(), arch: process.arch, cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), node: process.version, nodeAbi: process.versions.modules,
    appVersion: packageInfo.version, sqliteVersion: null,
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim()) },
  definitions: {
    fixture: 'Per chapter: 3000 Chinese/code-unit prose characters, 2 versions, 14 steps, two 6000-char context outputs, one prompt snapshot, draft, reports and accepted-commit copies. Two projects, 12 characters, 48 hard states, growing hooks/timeline and stage summaries.',
    isolation: 'Fresh temporary SQLite per size; no author data or AI calls. Node production-code bundle, not Electron UI timing.',
    percentile: 'Nearest rank over monotonic performance.now() samples after warmup. No OS cache flush; GC not forced.',
    memory: 'Process endpoint RSS/heap samples, not peak or per-operation exclusive memory; observational only.',
    fullSave: 'Change one chapter body in complete AppData, sanitize and revision-check through real SQLite service. Queue/IPC/UI excluded.',
    bundleSave: 'Save one actual GenerationRunBundle through real SQLite transaction; includes validation/read of existing data.',
    agentDigest: 'Real AgentToolService.getProjectDigest compact call including read-only database load, normalization and formatting.',
    writeChanges: 'SQLite total_changes() difference on the service connection; includes meta/settings changes, not disk bytes.',
    boundaries: 'No absolute UI/latency CI gate; same-machine repeated before/after is required before claiming improvements.'
  }, sourceHashes: {}, scenarios: [], status: 'running' }
for (const file of ['src/storage/SqliteStorageService.ts', 'src/storage/sqlite/sqliteSnapshot.ts',
  'src/storage/sqlite/sqliteSnapshotWriter.ts', 'src/storage/sqlite/sqliteGenerationContext.ts',
  'src/shared/normalizers/appData.ts', 'src/agent/tools/AgentToolService.ts', 'scripts/fixtures/long-novel-performance.mjs']) {
  result.sourceHashes[file] = createHash('sha256').update(await readFile(join(repoRoot, file))).digest('hex')
}
let storage, readonly
try {
  for (const size of sizes) {
    const raw = createLongNovelFixture(size)
    const data = modules.normalizeAppData(raw)
    assert.equal(data.chapters.length, size)
    assert.equal(data.chapterVersions.length, size * 2)
    assert.equal(data.chapterGenerationSteps.length, size * 14)
    assert.equal(data.chapterCommitBundles.length, size)
    assert.equal(data.generatedChapterDrafts.length, size)
    assert.equal(data.generationRunTraces.length, size)
    const dataPath = join(workspace, `novel-${size}.sqlite`)
    storage = new modules.SqliteStorageService(dataPath)
    await storage.save(data)
    readonly = new Database(dataPath, { readonly: true, fileMustExist: true })
    result.environment.sqliteVersion = readonly.prepare('SELECT sqlite_version() version').get().version
    const payload = JSON.stringify(data), collectionSizes = Object.entries(data).filter(([, v]) => Array.isArray(v))
      .map(([collection, values]) => ({ collection, entities: values.length, jsonBytes: Buffer.byteLength(JSON.stringify(values)) }))
    const scenario = { chapters: size, jsonBytes: Buffer.byteLength(payload), collectionSizes, metrics: {}, diskBytes: {}, rowsTouched: {} }
    const measureInto = async (key, fn, metadata = () => ({})) => {
      const measured = await measure(fn)
      const { value, ...stats } = measured
      scenario.metrics[key] = { ...stats, ...metadata(value) }
      process.stdout.write(`${size} chapters ${key}: p50=${stats.p50Ms}ms p95=${stats.p95Ms}ms\n`)
      return value
    }
    const rows = await measureInto('sqliteRows', () => readonly.prepare('SELECT collection, json FROM entities ORDER BY collection, id').all(),
      (value) => ({ rowCount: value.length }))
    await measureInto('jsonParseEntityPayloads', () => rows.map((row) => JSON.parse(row.json)))
    await measureInto('normalizeAppData', () => modules.normalizeAppData(data))
    await measureInto('sanitizeAppData', () => modules.sanitizeAppDataForPersistence(data))
    await measureInto('serializeAppData', () => JSON.stringify(data))
    await measureInto('loadSnapshot', () => storage.loadSnapshot())
    await measureInto('agentReadOnlySnapshot', () => modules.loadSqliteSnapshotReadonly(dataPath))
    await measureInto('agentProjectDigest', () => modules.AgentToolService.callTool({ name: 'agent.getProjectDigest',
      arguments: { storagePath: dataPath, userDataPath: workspace, projectId: LONG_NOVEL_PROJECT_ID, detail: 'compact' } }),
      (value) => ({ responseBytes: Buffer.byteLength(JSON.stringify(value)), ok: value.ok }))
    const bundle = modules.buildGenerationRunBundle(data, `perf-job-${size}`)
    let revision = (await storage.loadSnapshot()).revision
    // This benchmark-only inspection does not become part of StorageService's public API.
    const changes = () => storage.db.prepare('SELECT total_changes() count').get().count
    let baseline = changes()
    await measureInto('saveGenerationRunBundle', async (i) => {
      const updatedAt = new Date(Date.UTC(2026, 8, 7, 0, 0, i + 1)).toISOString()
      const saved = await storage.saveGenerationRunBundle({ ...bundle, job: { ...bundle.job, updatedAt }, updatedAt }, revision)
      revision = saved.revision
      return saved
    })
    scenario.rowsTouched.bundleSavePerCall = (changes() - baseline) / (iterations + warmups)
    baseline = changes()
    await measureInto('saveEditedChapterFullData', async (i) => {
      const next = { ...data, chapters: data.chapters.map((chapter) => chapter.order === size
        ? { ...chapter, body: `${chapter.body}\n测量编辑 ${i}。`, updatedAt: new Date().toISOString() } : chapter) }
      const saved = await storage.saveIfCurrent(next, revision)
      revision = saved.revision
      return saved
    })
    scenario.rowsTouched.fullSavePerCall = (changes() - baseline) / (iterations + warmups)
    const reloaded = await storage.loadSnapshot()
    assert.equal(reloaded.data.chapters.length, size)
    assert.equal(reloaded.data.projects.length, 2)
    assert(reloaded.data.chapters.find((c) => c.order === size).body.includes('测量编辑'))
    assert.equal(reloaded.data.settings.apiKey, '')
    scenario.diskBytes = { sqlite: await bytes(dataPath), wal: await bytes(dataPath + '-wal'), shm: await bytes(dataPath + '-shm') }
    readonly.close(); readonly = null
    storage.close(); storage = null
    result.scenarios.push(scenario)
  }
  result.status = 'passed'
} catch (error) {
  result.status = 'failed'
  result.error = error.stack
  process.exitCode = 1
} finally {
  readonly?.close(); storage?.close()
  result.finishedAt = new Date().toISOString()
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(result, null, 2) + '\n')
  assert(inside(temporaryRoot, workspace), 'Refusing cleanup outside the benchmark directory')
  await rm(workspace, { recursive: true, force: true })
}
console.log(`Result: ${output}`)

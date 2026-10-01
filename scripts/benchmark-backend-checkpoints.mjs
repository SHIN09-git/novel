#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import os from 'node:os'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'
import { createLongNovelFixture } from './fixtures/long-novel-performance.mjs'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? fallback : process.argv[index + 1]
}
const sizes = arg('--sizes', '10,100,500').split(',').map(Number)
const iterations = Number(arg('--iterations', '7')), warmups = Number(arg('--warmups', '2'))
assert(sizes.every((size) => Number.isInteger(size) && size > 0 && size <= 1000))
assert(Number.isInteger(iterations) && iterations > 0 && iterations <= 50)
assert(Number.isInteger(warmups) && warmups >= 0 && warmups <= 10)
const tempRoot = join(repoRoot, 'tmp'), output = resolve(repoRoot, arg('--output', 'tmp/performance/backend-checkpoints.json'))
const inside = (path) => { const rel = relative(tempRoot, path); return rel && !isAbsolute(rel) && !rel.startsWith('..') }
assert(inside(output), 'Output must be within workspace tmp')
await mkdir(tempRoot, { recursive: true })
const work = await mkdtemp(join(tempRoot, 'backend-checkpoints-'))
const handlers = new Map()
globalThis.__backendPerfHandlers = handlers
const entry = join(work, 'api.mjs')
const paths = ['src/main/BackupService.ts', 'src/main/ipc/storageDataOperations.ts',
  'src/main/ipc/dataIpcHandlers.ts', 'src/shared/normalizers/appData.ts', 'src/storage/SqliteStorageService.ts',
  'src/storage/sqlite/sqliteInitialization.ts']
const result = {
  date: new Date().toISOString(), label: arg('--label', 'current'), schemaVersion: 1, iterations, warmups,
  environment: { node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch,
    os: os.release(), cpu: os.cpus()[0]?.model, totalMemoryBytes: os.totalmem() },
  definitions: {
    scope: 'Actual registered main-process data handlers and native SQLite, bundled under Node; Electron IPC serialization, renderer and logger disk writes excluded.',
    backup: 'A recent real automatic JSON backup exists. Every measured checkpoint executes the real automatic-backup guard before its transaction.',
    isolation: 'Synthetic 10/100/500 chapter datasets only; no user data, credentials or network model calls.',
    samples: 'performance.now(), nearest-rank p50/p95 after warmups, no OS cache flush. UI latency is not inferred.',
    regression: 'Full-read counts are deterministic; timings are observational, not machine-independent CI limits.'
  }, sourceHashes: {}, scenarios: [], status: 'running'
}
for (const path of paths) result.sourceHashes[path] = createHash('sha256').update(await readFile(join(repoRoot, path))).digest('hex')
let storage
const originalFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('Network forbidden in backend benchmark') }
try {
  await build({ stdin: { resolveDir: repoRoot, loader: 'ts', contents: `
    export { registerDataIpcHandlers } from './src/main/ipc/dataIpcHandlers';
    export { maybeCreateAutomaticBackup } from './src/main/ipc/storageDataOperations';
    export { BackupService } from './src/main/BackupService';
    export { SqliteStorageService } from './src/storage/SqliteStorageService';
    export { normalizeAppData } from './src/shared/defaults';
    export { buildGenerationRunBundle } from './src/services/GenerationRunBundleService';
    export { IPC_CHANNELS } from './src/shared/ipc/ipcChannels';
  ` }, outfile: entry, bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', logLevel: 'silent',
    plugins: [{ name: 'isolated-electron', setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'isolated' }))
      builder.onResolve({ filter: /\/LogService$/ }, () => ({ path: 'logger', namespace: 'isolated' }))
      builder.onLoad({ filter: /.*/, namespace: 'isolated' }, ({ path }) => ({ contents: path === 'logger'
        ? 'export const LogService = { info(){}, warn(){}, error(){} };'
        : 'export const ipcMain = { handle(name, handler) { globalThis.__backendPerfHandlers.set(name, handler) } }; export const dialog = {}; export const app = {};', loader: 'js' }))
    } }] })
  const api = await import(pathToFileURL(entry).href)
  for (const size of sizes) {
    const data = api.normalizeAppData(createLongNovelFixture(size))
    const dir = join(work, String(size))
    storage = new api.SqliteStorageService(join(dir, 'data.sqlite'))
    await storage.save(data)
    const backupService = new api.BackupService(dir)
    await backupService.createBackup(data, true)
    const context = { getStorage: () => storage, backupService,
      credentialService: { hasApiKey: async () => false, migrateLegacyApiKey: async () => { throw new Error('No credentials') } } }
    api.registerDataIpcHandlers(context)
    const bundle = api.buildGenerationRunBundle(data, `perf-job-${size}`)
    let revision = (await storage.loadSnapshot()).revision, loads = 0
    const originalLoad = storage.load.bind(storage)
    storage.load = async () => { loads++; return originalLoad() }
    const scenario = { chapters: size, bytes: Buffer.byteLength(JSON.stringify(data)), metrics: {} }
    const measure = async (name, operation) => {
      for (let i = 0; i < warmups; i++) await operation(i)
      const startedLoads = loads, samplesMs = [], heapBefore = process.memoryUsage().heapUsed
      for (let i = 0; i < iterations; i++) {
        const start = performance.now()
        await operation(i + warmups)
        samplesMs.push(performance.now() - start)
      }
      const sorted = [...samplesMs].sort((a, b) => a - b), round = (n) => Math.round(n * 1000) / 1000
      const metric = { p50Ms: round(sorted[Math.ceil(sorted.length * .5) - 1]), p95Ms: round(sorted[Math.ceil(sorted.length * .95) - 1]),
        fullStorageLoads: loads - startedLoads, samplesMs: samplesMs.map(round), heapBefore, heapAfter: process.memoryUsage().heapUsed }
      scenario.metrics[name] = metric
      console.log(`${size} chapters ${name}: p50=${metric.p50Ms}ms p95=${metric.p95Ms}ms fullLoads=${metric.fullStorageLoads}`)
    }
    await measure('automaticBackupGuard', () => api.maybeCreateAutomaticBackup(context, 'benchmark'))
    await measure('generationCheckpointMainHandler', async (i) => {
      const updatedAt = new Date(Date.UTC(2026, 8, 27, 0, 0, i)).toISOString()
      const saved = await handlers.get(api.IPC_CHANNELS.DATA_SAVE_GENERATION_RUN_BUNDLE)({}, {
        bundle: { ...bundle, job: { ...bundle.job, updatedAt }, updatedAt }, expectedRevision: revision })
      assert.equal(saved.ok, true, saved.error)
      revision = saved.revision
    })
    await measure('fullSaveMainHandler', async (i) => {
      const next = { ...data, chapters: data.chapters.map((chapter) => chapter.order === size
        ? { ...chapter, body: `${chapter.body}\n隔离性能测量 ${i}。` } : chapter) }
      const saved = await handlers.get(api.IPC_CHANNELS.STORAGE_SAVE)({}, { data: next, expectedRevision: revision })
      assert.equal(saved.ok, true, saved.error)
      revision = saved.revision
    })
    const current = await storage.loadSnapshot()
    assert.equal(current.data.chapters.length, size)
    assert.equal(current.data.settings.apiKey, '')
    result.scenarios.push(scenario)
    storage.close(); storage = null
  }
  result.status = 'passed'
} catch (error) {
  result.status = 'failed'; result.error = error.stack; process.exitCode = 1
} finally {
  storage?.close()
  globalThis.fetch = originalFetch
  delete globalThis.__backendPerfHandlers
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(result, null, 2) + '\n')
  assert(inside(work))
  await rm(work, { recursive: true, force: true })
}
console.log(`Result: ${output}`)

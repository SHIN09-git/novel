#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'
import { createLongNovelFixture } from './fixtures/long-novel-performance.mjs'

const tempRoot = join(repoRoot, 'tmp')
await mkdir(tempRoot, { recursive: true })
const work = await mkdtemp(join(tempRoot, 'backend-backup-test-')), handlers = new Map()
globalThis.__backupTestHandlers = handlers
const entry = join(work, 'api.mjs')
let storage, checks = 0
const test = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`) }
try {
  await build({ stdin: { resolveDir: repoRoot, loader: 'ts', contents: `
    export { BackupService } from './src/main/BackupService';
    export { registerDataIpcHandlers } from './src/main/ipc/dataIpcHandlers';
    export { SqliteStorageService } from './src/storage/SqliteStorageService';
    export { normalizeAppData } from './src/shared/defaults';
    export { buildGenerationRunBundle } from './src/services/GenerationRunBundleService';
    export { IPC_CHANNELS } from './src/shared/ipc/ipcChannels';
  ` }, outfile: entry, bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', logLevel: 'silent',
    plugins: [{ name: 'isolated-backup-ipc', setup(builder) {
      builder.onResolve({ filter: /^node:fs\/promises$/ }, (args) => args.namespace === 'backup-fs'
        ? { path: args.path, external: true } : { path: args.path, namespace: 'backup-fs' })
      builder.onLoad({ filter: /.*/, namespace: 'backup-fs' }, () => ({ contents: `
        export * from 'node:fs/promises';
        import { writeFile as realWriteFile, rename as realRename } from 'node:fs/promises';
        export async function rename(from, to) {
          if (globalThis.__backupRenameFailure && String(from).includes('rename-backup')) {
            throw Object.assign(new Error('isolated rename denied'), { code: 'EACCES' });
          }
          return realRename(from, to);
        }
        export async function writeFile(path, data, options) {
          if (globalThis.__backupPartialWriteFailure && String(path).includes('partial-backup')) {
            await realWriteFile(path, '{"partial":', options);
            throw Object.assign(new Error('isolated disk full'), { code: 'ENOSPC' });
          }
          return realWriteFile(path, data, options);
        }
      `, loader: 'js' }))
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'isolated' }))
      builder.onResolve({ filter: /\/LogService$/ }, () => ({ path: 'logger', namespace: 'isolated' }))
      builder.onLoad({ filter: /.*/, namespace: 'isolated' }, ({ path }) => ({ contents: path === 'logger'
        ? 'export const LogService = {info(){},warn(){},error(){}};'
        : 'export const app={}; export const dialog={}; export const ipcMain={handle(name,fn){globalThis.__backupTestHandlers.set(name,fn)}};', loader: 'js' }))
    } }] })
  const api = await import(pathToFileURL(entry).href)
  const data = api.normalizeAppData(createLongNovelFixture(10))
  const service = new api.BackupService(join(work, 'schedule'))
  let loads = 0
  const load = async () => { loads++; return data }
  await test('first due backup loads once; simultaneous callers share completed backup', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => service.maybeCreateAutomaticBackup(load)))
    assert.equal(loads, 1)
    assert.equal(new Set(results).size, 1)
    assert.equal((await service.listBackups()).length, 1)
    assert.deepEqual((await service.loadBackup(results[0])).chapters, data.chapters)
  })
  await test('different storage scopes publishing in the same millisecond keep both backups', async () => {
    const simultaneous = new api.BackupService(join(work, 'same-time'))
    const list = simultaneous.listBackups.bind(simultaneous)
    let lists = 0
    simultaneous.listBackups = async () => ++lists <= 2 ? [] : list()
    const now = Date.now, fixed = now()
    Date.now = () => fixed
    let paths
    try {
      paths = await Promise.all(['A', 'B'].map((name) => simultaneous.maybeCreateAutomaticBackup(async () => ({
        ...data, projects: data.projects.map((project) => ({ ...project, name }))
      }), {})))
    } finally { Date.now = now }
    assert.notEqual(paths[0], paths[1])
    assert.equal((await list()).length, 2)
    assert.equal((await simultaneous.loadBackup(paths[0])).projects[0].name, 'A')
    assert.equal((await simultaneous.loadBackup(paths[1])).projects[0].name, 'B')
  })
  await test('non-due checks never load AppData', async () => {
    for (let i = 0; i < 10; i++) assert.equal(await service.maybeCreateAutomaticBackup(load), null)
    assert.equal(loads, 1)
  })
  await test('deleting a backup is observed without stale schedule caching', async () => {
    await service.deleteBackup((await service.listBackups())[0].path)
    assert.ok(await service.maybeCreateAutomaticBackup(load))
    assert.equal(loads, 2)
  })
  await test('expired automatic backup allows a fresh snapshot', async () => {
    const now = Date.now
    Date.now = () => now() + 25 * 60 * 60 * 1000
    try { assert.ok(await service.maybeCreateAutomaticBackup(load)); assert.equal(loads, 3) }
    finally { Date.now = now }
  })
  await test('failed lazy load does not mark the backup as completed; retry succeeds', async () => {
    const failed = new api.BackupService(join(work, 'retry'))
    await assert.rejects(failed.maybeCreateAutomaticBackup(async () => { throw new Error('isolated failure') }), /isolated failure/)
    assert.equal((await failed.listBackups()).length, 0)
    assert.ok(await failed.maybeCreateAutomaticBackup(load))
  })
  await test('failed backup write releases single-flight state for retry', async () => {
    const failed = new api.BackupService(join(work, 'retry-write')), create = failed.createBackup.bind(failed)
    failed.createBackup = async () => { throw new Error('write denied') }
    await assert.rejects(failed.maybeCreateAutomaticBackup(load), /write denied/)
    failed.createBackup = create
    assert.ok(await failed.maybeCreateAutomaticBackup(load))
  })
  await test('partial disk write is never published as a completed backup; retry succeeds', async () => {
    const failed = new api.BackupService(join(work, 'partial-backup'))
    globalThis.__backupPartialWriteFailure = true
    try { await assert.rejects(failed.maybeCreateAutomaticBackup(load), /disk full/) }
    finally { delete globalThis.__backupPartialWriteFailure }
    assert.equal((await failed.listBackups()).length, 0)
    assert.deepEqual(await readdir(failed.getBackupDir()), [])
    const path = await failed.maybeCreateAutomaticBackup(load)
    assert.ok(path)
    assert.equal(JSON.parse(await readFile(path, 'utf8')).chapters.length, 10)
  })
  await test('failed atomic publish cleans the temporary file and allows retry', async () => {
    const failed = new api.BackupService(join(work, 'rename-backup'))
    globalThis.__backupRenameFailure = true
    try { await assert.rejects(failed.maybeCreateAutomaticBackup(load), /rename denied/) }
    finally { delete globalThis.__backupRenameFailure }
    assert.deepEqual(await readdir(failed.getBackupDir()), [])
    assert.ok(await failed.maybeCreateAutomaticBackup(load))
  })
  await test('eager AppData call stays compatible and secret is removed from JSON backup', async () => {
    const legacy = new api.BackupService(join(work, 'eager'))
    const path = await legacy.maybeCreateAutomaticBackup({ ...data, settings: { ...data.settings, apiKey: 'TEST_BACKUP_SECRET' } })
    assert.ok(path)
    const text = await readFile(path, 'utf8')
    assert.ok(!text.includes('TEST_BACKUP_SECRET'))
    assert.equal(JSON.parse(text).settings.apiKey, '')
  })
  await test('real main checkpoint and full-save handlers skip full reads when backup exists', async () => {
    storage = new api.SqliteStorageService(join(work, 'ipc.sqlite'))
    await storage.save(data)
    const backupService = new api.BackupService(join(work, 'ipc-profile'))
    await backupService.createBackup(data, true)
    let fullReads = 0
    storage.load = async () => { fullReads++; throw new Error('An unnecessary full storage read occurred') }
    api.registerDataIpcHandlers({ getStorage: () => storage, backupService,
      credentialService: { hasApiKey: async () => false } })
    let revision = (await storage.loadSnapshot()).revision
    const bundle = api.buildGenerationRunBundle(data, 'perf-job-10')
    const saved = await handlers.get(api.IPC_CHANNELS.DATA_SAVE_GENERATION_RUN_BUNDLE)({}, { bundle, expectedRevision: revision })
    assert.equal(saved.ok, true, saved.error)
    revision = saved.revision
    const full = await handlers.get(api.IPC_CHANNELS.STORAGE_SAVE)({}, { data, expectedRevision: revision })
    assert.equal(full.ok, true, full.error)
    assert.equal(fullReads, 0)
    const byId = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id))
    assert.deepEqual(byId((await storage.loadSnapshot()).data.chapters), byId(data.chapters))
    assert.equal((await backupService.listBackups()).length, 1)
  })
  await test('storage switch during backup prevents old reads/writes and does not coalesce the new database', async () => {
    const first = new api.SqliteStorageService(join(work, 'switch-a.sqlite'))
    const second = new api.SqliteStorageService(join(work, 'switch-b.sqlite'))
    let release, entered
    const held = new Promise((resolve) => { release = resolve })
    const scheduled = new Promise((resolve) => { entered = resolve })
    try {
      await first.save(data)
      await second.save(data)
      const firstRevision = (await first.loadSnapshot()).revision
      const secondRevision = (await second.loadSnapshot()).revision
      let current = first, firstReads = 0, firstWrites = 0, secondReads = 0
      first.load = async () => { firstReads++; throw new Error('Closed storage must not reopen') }
      first.saveGenerationRunBundle = async () => { firstWrites++; throw new Error('Old storage write') }
      const loadSecond = second.load.bind(second)
      second.load = async () => { secondReads++; return loadSecond() }
      const backupService = new api.BackupService(join(work, 'switch-profile'))
      const list = backupService.listBackups.bind(backupService)
      let lists = 0
      backupService.listBackups = async () => {
        if (++lists === 1) { entered(); await held }
        return list()
      }
      api.registerDataIpcHandlers({ getStorage: () => current, backupService,
        credentialService: { hasApiKey: async () => false } })
      const bundle = api.buildGenerationRunBundle(data, 'perf-job-10')
      const handler = handlers.get(api.IPC_CHANNELS.DATA_SAVE_GENERATION_RUN_BUNDLE)
      const firstSave = handler({}, { bundle, expectedRevision: firstRevision })
      await scheduled
      first.close()
      current = second
      let timer
      const secondSave = await Promise.race([
        handler({}, { bundle, expectedRevision: secondRevision }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('New storage joined old pending backup')), 3000) })
      ]).finally(() => clearTimeout(timer))
      assert.equal(secondSave.ok, true, secondSave.error)
      assert.equal(secondReads, 1)
      release()
      const stale = await firstSave
      assert.equal(stale.ok, false)
      assert.match(stale.error, /保存位置已切换/)
      assert.equal(firstReads, 0)
      assert.equal(firstWrites, 0)
      assert.equal((await second.loadSnapshot()).data.chapters.length, 10)
    } finally { release(); first.close(); second.close() }
  })
  await test('every write handler rechecks storage after the backup await boundary', async () => {
    const cases = [
      ['STORAGE_SAVE', 'saveIfCurrent', { data, expectedRevision: 'test' }],
      ['DATA_SAVE_GENERATION_RUN_BUNDLE', 'saveGenerationRunBundle', { bundle: { jobId: 'job' } }],
      ['DATA_SAVE_CHAPTER_COMMIT_BUNDLE', 'saveChapterCommitBundle', { bundle: { commitId: 'commit' } }],
      ['DATA_SAVE_REVISION_COMMIT_BUNDLE', 'saveRevisionCommitBundle', { bundle: { revisionCommitId: 'revision' } }],
      ['DATA_EXECUTE_CANDIDATE_DECISION', 'executeCandidateDecision', { command: {}, expectedRevision: 'test' }]
    ]
    for (const [channel, method, request] of cases) {
      let writes = 0, reads = 0
      const first = { [method]: async () => { writes++; return { ok: true } } }
      const second = {}
      let current = first
      api.registerDataIpcHandlers({
        getStorage() {
          if (++reads === 3) queueMicrotask(() => { current = second })
          return current
        },
        backupService: { maybeCreateAutomaticBackup: async () => null },
        credentialService: { hasApiKey: async () => false }
      })
      const result = await handlers.get(api.IPC_CHANNELS[channel])({}, request)
      assert.equal(result.ok, false, channel)
      assert.match(result.error, /保存位置已切换/, channel)
      assert.equal(writes, 0, channel)
    }
  })
  await test('captured candidate storage still binds the trusted user actor and revision', async () => {
    let actualCommand, actualRevision
    const target = { async executeCandidateDecision(command, revision) {
      actualCommand = command; actualRevision = revision; return { ok: true }
    } }
    api.registerDataIpcHandlers({ getStorage: () => target,
      backupService: { maybeCreateAutomaticBackup: async () => null } })
    const result = await handlers.get(api.IPC_CHANNELS.DATA_EXECUTE_CANDIDATE_DECISION)({}, {
      command: { actor: { kind: 'agent' }, id: 'fixture' }, expectedRevision: 'known-revision'
    })
    assert.equal(result.ok, true)
    assert.deepEqual(actualCommand.actor, { kind: 'user' })
    assert.equal(actualRevision, 'known-revision')
  })
  console.log(`Backend backup validation: ${checks}/${checks} passed (native SQLite and real main handlers).`)
} finally {
  storage?.close()
  delete globalThis.__backupTestHandlers
  delete globalThis.__backupPartialWriteFailure
  delete globalThis.__backupRenameFailure
  const rel = relative(tempRoot, work)
  assert(rel && !rel.startsWith('..') && !isAbsolute(rel))
  await rm(work, { recursive: true, force: true })
}

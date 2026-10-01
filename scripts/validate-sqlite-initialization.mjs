import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'
import { setImmediate } from 'node:timers/promises'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const require = createRequire(import.meta.url)
const base = join(repoRoot, 'tmp', 'sqlite-initialization-test')
await fs.mkdir(base, { recursive: true })
const dir = await fs.mkdtemp(join(base, 'run-'))
const compiled = await build({
  stdin: { resolveDir: repoRoot, contents: `
    export { SqliteStorageService, createStorageService, loadSqliteSnapshotReadonly } from './src/storage/SqliteStorageService';
    export { JsonStorageService } from './src/storage/JsonStorageService';
    export { normalizeAppData } from './src/shared/defaults';
    export { buildGenerationRunBundle } from './src/services/GenerationRunBundleService';
    export { isSqliteEmpty } from './src/storage/sqlite/sqliteInitialization';
  ` },
  bundle: true, platform: 'node', format: 'cjs', target: 'node24',
  packages: 'external', write: false, logLevel: 'silent'
})

function gate() {
  const entered = Promise.withResolvers()
  const released = Promise.withResolvers()
  return { entered: entered.promise, release: released.resolve,
    async wait() { entered.resolve(); await released.promise } }
}

function ioError(code) { return Object.assign(new Error(`injected ${code}`), { code }) }

// Only the module under test sees these adapters. SQL, files and transactions are real;
// hooks control async scheduling and I/O failures without changing native dependencies.
function harness(name, hooks = {}) {
  const folder = join(dir, name)
  const path = join(folder, 'data.sqlite')
  const legacy = join(folder, 'novel-director-data.json')
  const handles = []
  const services = []
  const calls = { reads: [], copies: [], warnings: [] }
  class NodeSQLite {
    constructor(file, options = {}) {
      if (hooks.unavailable) throw new Error('injected native unavailable')
      hooks.beforeOpen?.(file)
      if (options.fileMustExist && !require('node:fs').existsSync(file)) throw ioError('ENOENT')
      this.file = file
      this.db = new DatabaseSync(file, { readOnly: !!options.readonly })
      this.closed = false
      this.sequence = 0
      handles.push(this)
    }
    pragma(sql) { return this.db.prepare(`PRAGMA ${sql}`).all() }
    exec(sql) {
      this.db.exec(sql)
      if (sql.includes('CREATE TABLE IF NOT EXISTS entities')) hooks.afterSchema?.(this)
    }
    prepare(sql) { return this.db.prepare(sql) }
    transaction(fn) {
      return (...args) => {
        const name = `validation_${++this.sequence}`
        this.db.exec(`SAVEPOINT ${name}`)
        try {
          const result = fn(...args)
          assert(!(result instanceof Promise), 'SQLite transactions must stay synchronous')
          this.db.exec(`RELEASE ${name}`)
          return result
        } catch (error) {
          this.db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`)
          throw error
        }
      }
    }
    backup(destination) { return backup(this.db, destination) }
    close() { this.db.close(); this.closed = true }
  }
  const io = { ...fs,
    async mkdir(...args) { await hooks.mkdir?.(...args); return fs.mkdir(...args) },
    async readFile(...args) {
      calls.reads.push(args[0])
      await hooks.readFile?.(...args)
      return fs.readFile(...args)
    },
    async copyFile(...args) {
      calls.copies.push(args)
      await hooks.copyFile?.(...args)
      return fs.copyFile(...args)
    }
  }
  function localRequire(id) {
    if (id === 'better-sqlite3') return NodeSQLite
    if (id === 'node:fs/promises') return io
    if (id === 'node:module') return { ...require(id), createRequire: () => localRequire }
    return require(id)
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'console', compiled.outputFiles[0].text)(
    localRequire, module, module.exports, { ...console, warn: (...args) => calls.warnings.push(args) })
  const api = module.exports
  const makeData = (id) => api.normalizeAppData({
    projects: id ? [{ id, name: id, createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z' }] : [],
    settings: { apiKey: 'SYNTHETIC_TEST_KEY', hasApiKey: true }
  })
  const bundle = () => api.buildGenerationRunBundle({ ...makeData('legacy'),
    chapterGenerationJobs: [{ id: 'job', projectId: 'legacy', targetChapterOrder: 1,
      updatedAt: '2026-01-01T00:00:00.000Z' }] }, 'job')
  const service = (file = path, factory = false) => {
    const storage = factory ? api.createStorageService(file) : new api.SqliteStorageService(file)
    services.push(storage)
    return storage
  }
  const active = () => handles.filter((db) => !db.closed)
  const opened = () => handles.filter((db) => db.file !== ':memory:')
  async function writeLegacy(id = 'legacy') {
    await fs.mkdir(folder, { recursive: true })
    await fs.writeFile(legacy, JSON.stringify(makeData(id)))
  }
  function inspect(fn) {
    const db = new DatabaseSync(path, { readOnly: true })
    try { return fn(db) } finally { db.close() }
  }
  function projectIds() {
    return inspect((db) => db.prepare("SELECT id FROM entities WHERE collection = 'projects' ORDER BY id")
      .all().map((row) => row.id))
  }
  function assertUninitialized() {
    inspect((db) => {
      assert.equal(db.prepare('SELECT count(*) n FROM app_settings').get().n, 0, 'must not save EMPTY_APP_DATA')
      assert.equal(db.prepare('SELECT count(*) n FROM entities').get().n, 0)
      assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'revision'").get(), undefined)
    })
  }
  function cleanup() {
    for (const storage of services) storage.close?.()
    const leaked = active().length
    for (const db of active()) db.close()
    assert.equal(leaked, 0, 'close() must release every SQLite handle')
  }
  return { ...api, hooks, path, legacy, folder, calls, makeData, bundle, service, active,
    opened, writeLegacy, inspect, projectIds, assertUninitialized, cleanup }
}

let passed = 0
const failures = []
async function test(name, run) {
  const h = harness(name)
  let failure
  try { await run(h) } catch (error) { failure = error }
  try { h.cleanup() } catch (error) { failure ??= error }
  if (failure) {
    failures.push({ name, message: failure.message })
    console.error(`FAIL ${name}: ${failure.message}`)
  } else { passed++; console.log(`PASS ${name}`) }
}

try {
  await test('emptiness-uses-short-circuit-existence-probes', async (h) => {
    const storage = h.service()
    await storage.save(h.makeData('existing'))
    const db = h.active()[0]
    const queries = []
    const spy = { prepare(sql) { queries.push(sql); return db.prepare(sql) } }
    const settingsQuery = 'SELECT 1 FROM app_settings LIMIT 1'
    const entitiesQuery = 'SELECT 1 FROM entities LIMIT 1'
    function check(expected, expectedQueries) {
      queries.length = 0
      assert.equal(h.isSqliteEmpty(spy), expected)
      assert.deepEqual(queries, expectedQueries, 'existence probes must use LIMIT 1 and short-circuit')
    }
    check(false, [settingsQuery])
    db.db.exec('DELETE FROM app_settings')
    check(false, [settingsQuery, entitiesQuery])
    db.db.exec('DELETE FROM entities')
    check(true, [settingsQuery, entitiesQuery])
    db.db.exec("INSERT INTO app_settings (id, json) VALUES ('default', '{}')")
    check(false, [settingsQuery])
  })

  await test('concurrent-first-load', async (h) => {
    const storage = h.service()
    const snapshots = await Promise.all(Array.from({ length: 12 }, () => storage.loadSnapshot()))
    assert.equal(h.opened().length, 1, 'concurrent first access must open one connection')
    assert.equal(new Set(snapshots.map((s) => s.revision)).size, 1, 'empty initialization must commit once')
    storage.close()
    storage.close()
    assert.equal(h.active().length, 0)
  })

  await test('concurrent-legacy-migration', async (h) => {
    await h.writeLegacy()
    const storage = h.service()
    const blocked = gate()
    h.hooks.readFile = (file) => file === h.legacy ? blocked.wait() : undefined
    const pending = Promise.allSettled(Array.from({ length: 12 }, () => storage.loadSnapshot()))
    await blocked.entered
    await setImmediate()
    blocked.release()
    const results = await pending
    assert(results.every((r) => r.status === 'fulfilled'))
    assert.equal(h.calls.reads.filter((file) => file === h.legacy).length, 1, 'legacy JSON must be read once')
    assert.equal(h.calls.copies.filter(([, to]) => to.includes('.before-sqlite-migrate.')).length, 1)
    assert.equal(new Set(results.map((r) => r.value.revision)).size, 1)
    assert.deepEqual(h.projectIds(), ['legacy'])
  })

  await test('close-during-mkdir', async (h) => {
    const blocked = gate()
    h.hooks.mkdir = () => blocked.wait()
    const storage = h.service()
    const pending = Promise.allSettled([storage.load(), storage.loadSnapshot()])
    await blocked.entered
    storage.close()
    blocked.release()
    const results = await pending
    assert.equal(h.active().length, 0, 'an async open must not create a handle after close()')
    assert(results.every((r) => r.status === 'rejected'))
    delete h.hooks.mkdir
    assert.equal((await storage.load()).projects.length, 0, 'a subsequent explicit load can reopen')
  })

  await test('migration-save-failure', async (h) => {
    await h.writeLegacy()
    h.hooks.afterSchema = (db) => db.db.exec(`CREATE TRIGGER reject_migration BEFORE INSERT ON entities
      BEGIN SELECT RAISE(ABORT, 'injected migration save failure'); END;`)
    const storage = h.service()
    const [result] = await Promise.allSettled([storage.loadSnapshot()])
    h.assertUninitialized()
    assert.equal(result.status, 'rejected')
    assert.match(result.reason.message, /injected migration save failure/)
    assert.equal(JSON.parse(await fs.readFile(h.legacy, 'utf8')).projects[0].id, 'legacy')
    h.active()[0].db.exec('DROP TRIGGER reject_migration')
    delete h.hooks.afterSchema
    assert.equal((await storage.load()).projects[0].id, 'legacy', 'failed migration must be retryable')
  })

  await test('migration-copy-failure-preserves-newer-save', async (h) => {
    await h.writeLegacy()
    const storage = h.service()
    const error = ioError('EACCES')
    h.hooks.copyFile = async (from, to) => {
      if (!to.includes('.before-sqlite-migrate.')) return
      await storage.save(h.makeData('newer-valid'))
      throw error
    }
    const [result] = await Promise.allSettled([storage.loadSnapshot()])
    assert.deepEqual(h.projectIds(), ['newer-valid'], 'backup failure must not overwrite a valid SQLite snapshot')
    assert.equal(result.status, 'rejected')
    assert.equal(result.reason, error)
    delete h.hooks.copyFile
    assert.equal((await storage.load()).projects[0].id, 'newer-valid')
    assert(!h.calls.copies.some(([, to]) => to.includes('.corrupt.')), 'I/O errors are not corrupt JSON')
  })

  await test('migration-read-failure-retries', async (h) => {
    await h.writeLegacy()
    const error = ioError('EIO')
    h.hooks.readFile = (file) => { if (file === h.legacy) throw error }
    const storage = h.service()
    await assert.rejects(storage.load(), (e) => e === error)
    h.assertUninitialized()
    delete h.hooks.readFile
    assert.equal((await storage.load()).projects[0].id, 'legacy')
  })

  await test('migration-copy-failure-retries-without-empty-save', async (h) => {
    await h.writeLegacy()
    const original = await fs.readFile(h.legacy, 'utf8')
    const error = ioError('ENOSPC')
    h.hooks.copyFile = () => { throw error }
    const storage = h.service()
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => storage.loadSnapshot()))
    h.assertUninitialized()
    assert(results.every((r) => r.status === 'rejected' && r.reason === error))
    assert.equal(h.calls.copies.length, 1, 'failed migration must also be single-flight')
    assert.equal(await fs.readFile(h.legacy, 'utf8'), original)
    delete h.hooks.copyFile
    assert.equal((await storage.load()).projects[0].id, 'legacy')
  })

  await test('close-during-legacy-read', async (h) => {
    await h.writeLegacy()
    const blocked = gate()
    h.hooks.readFile = (file) => file === h.legacy ? blocked.wait() : undefined
    const storage = h.service()
    const pending = Promise.allSettled([storage.load(), storage.loadSnapshot()])
    await blocked.entered
    storage.close()
    blocked.release()
    const results = await pending
    assert(results.every((r) => r.status === 'rejected'))
    assert.equal(h.active().length, 0)
    h.assertUninitialized()
    delete h.hooks.readFile
    assert.equal((await storage.load()).projects[0].id, 'legacy')
  })

  await test('migration-does-not-overwrite-concurrent-save', async (h) => {
    await h.writeLegacy()
    const blocked = gate()
    h.hooks.readFile = (file) => file === h.legacy ? blocked.wait() : undefined
    const storage = h.service()
    const pending = Promise.allSettled([storage.loadSnapshot()])
    await blocked.entered
    const writer = h.service()
    try { await writer.save(h.makeData('concurrent-valid')) } finally { blocked.release() }
    const [result] = await pending
    assert.equal(result.status, 'fulfilled')
    assert.deepEqual(h.projectIds(), ['concurrent-valid'])
    assert.equal(result.value.data.projects[0].id, 'concurrent-valid')
  })

  await test('recovery-schema-failure-closes-and-retries', async (h) => {
    await fs.mkdir(h.folder, { recursive: true })
    await fs.writeFile(h.path, JSON.stringify(h.makeData('mislabeled')))
    h.hooks.afterSchema = () => { throw new Error('injected recovery schema failure') }
    const storage = h.service()
    await assert.rejects(storage.load(), /injected recovery schema failure/)
    assert.equal(h.active().length, 0, 'failed recovery must close its second connection')
    delete h.hooks.afterSchema
    assert.equal((await storage.load()).projects[0].id, 'mislabeled', 'recovery payload must survive a retry')
  })

  await test('mkdir-failure-is-single-flight-and-retryable', async (h) => {
    const error = ioError('EACCES')
    h.hooks.mkdir = () => { throw error }
    const storage = h.service()
    const results = await Promise.allSettled([storage.load(), storage.loadSnapshot(), storage.save(h.makeData('saved'))])
    assert(results.every((r) => r.status === 'rejected' && r.reason === error))
    assert.equal(h.active().length, 0)
    assert.equal(h.opened().length, 0)
    delete h.hooks.mkdir
    await storage.saveIfCurrent(h.makeData('saved'), '0')
    assert.deepEqual(h.projectIds(), ['saved'])
  })

  await test('constructor-failure-is-retryable', async (h) => {
    h.hooks.beforeOpen = (file) => { if (file !== ':memory:') throw ioError('SQLITE_CANTOPEN') }
    const storage = h.service()
    await assert.rejects(storage.load(), { code: 'SQLITE_CANTOPEN' })
    assert.equal(h.active().length, 0)
    delete h.hooks.beforeOpen
    assert.equal((await storage.load()).projects.length, 0)
  })

  await test('normal-schema-failure-closes-and-retries', async (h) => {
    h.hooks.afterSchema = () => { throw new Error('injected schema failure') }
    const storage = h.service()
    const results = await Promise.allSettled([storage.load(), storage.loadSnapshot()])
    assert(results.every((r) => r.status === 'rejected' && /injected schema failure/.test(r.reason.message)))
    assert.equal(h.active().length, 0)
    delete h.hooks.afterSchema
    assert.equal((await storage.load()).projects.length, 0)
  })

  await test('close-during-recovery-copy', async (h) => {
    await fs.mkdir(h.folder, { recursive: true })
    const original = JSON.stringify(h.makeData('mislabeled'))
    await fs.writeFile(h.path, original)
    const blocked = gate()
    h.hooks.copyFile = () => blocked.wait()
    const storage = h.service()
    const pending = Promise.allSettled([storage.load(), storage.loadSnapshot()])
    await blocked.entered
    storage.close()
    blocked.release()
    const results = await pending
    assert(results.every((r) => r.status === 'rejected'))
    assert.equal(h.active().length, 0)
    assert.equal(await fs.readFile(h.path, 'utf8'), original, 'cancelled recovery must not unlink the source')
    delete h.hooks.copyFile
    assert.equal((await storage.load()).projects[0].id, 'mislabeled')
  })

  await test('recovery-save-failure-closes-and-retries', async (h) => {
    await fs.mkdir(h.folder, { recursive: true })
    const original = JSON.stringify(h.makeData('mislabeled'))
    await fs.writeFile(h.path, original)
    h.hooks.afterSchema = (db) => db.db.exec(`CREATE TRIGGER reject_recovery BEFORE INSERT ON entities
      BEGIN SELECT RAISE(ABORT, 'injected recovery save failure'); END;`)
    const storage = h.service()
    await assert.rejects(storage.load(), /injected recovery save failure/)
    assert.equal(h.active().length, 0)
    h.assertUninitialized()
    const savedBackup = h.calls.copies.find(([, to]) => to.includes('.invalid-sqlite.'))[1]
    assert.equal(await fs.readFile(savedBackup, 'utf8'), original)
    const db = new DatabaseSync(h.path)
    try { db.exec('DROP TRIGGER reject_recovery') } finally { db.close() }
    delete h.hooks.afterSchema
    assert.equal((await storage.load()).projects[0].id, 'mislabeled')
  })

  await test('recovery-is-single-flight-and-keeps-richer-json', async (h) => {
    await h.writeLegacy('richer')
    const data = h.makeData('richer')
    data.chapters = [{ id: 'chapter', projectId: 'richer', order: 1, title: 'One', body: 'Fixture text.' }]
    await fs.writeFile(h.legacy, JSON.stringify(data))
    await fs.writeFile(h.path, JSON.stringify(h.makeData('smaller')))
    const storage = h.service()
    const snapshots = await Promise.all(Array.from({ length: 8 }, () => storage.loadSnapshot()))
    assert(snapshots.every((s) => s.data.projects[0].id === 'richer' && s.data.chapters.length === 1))
    assert.equal(new Set(snapshots.map((s) => s.revision)).size, 1)
    assert.equal(h.opened().length, 2, 'only invalid and replacement connections should be opened')
    assert.equal(h.calls.copies.filter(([, to]) => to.includes('.invalid-sqlite.')).length, 1)
    storage.close()
    assert.equal(h.active().length, 0)
  })

  await test('recovery-read-io-failure-preserves-source', async (h) => {
    await h.writeLegacy()
    const original = JSON.stringify(h.makeData('mislabeled'))
    await fs.writeFile(h.path, original)
    h.hooks.readFile = (file) => { if (file === h.legacy) throw ioError('EIO') }
    const storage = h.service()
    await assert.rejects(storage.load(), { code: 'EIO' })
    assert.equal(await fs.readFile(h.path, 'utf8'), original)
    assert.equal(h.active().length, 0)
    delete h.hooks.readFile
    assert.equal((await storage.load()).projects[0].id, 'legacy')
  })

  await test('existing-sqlite-is-never-reimported', async (h) => {
    const first = h.service()
    await first.save(h.makeData('authoritative'))
    const snapshot = await first.loadSnapshot()
    first.close()
    await h.writeLegacy('stale-legacy')
    h.hooks.readFile = () => { throw new Error('existing SQLite must not read old JSON') }
    const reopened = h.service()
    for (const current of await Promise.all([reopened.loadSnapshot(), reopened.loadSnapshot()])) {
      assert.equal(current.revision, snapshot.revision)
      assert.equal(current.data.projects[0].id, 'authoritative')
    }
    assert.equal(h.calls.copies.length, 0)
  })

  await test('initialized-empty-sqlite-is-not-missing-data', async (h) => {
    const first = h.service()
    const snapshot = await first.loadSnapshot()
    first.close()
    await h.writeLegacy()
    const current = await h.service().loadSnapshot()
    assert.equal(current.revision, snapshot.revision)
    assert.equal(current.data.projects.length, 0)
    assert.equal(h.calls.copies.length, 0)
  })

  await test('first-bundle-write-waits-for-migration', async (h) => {
    await h.writeLegacy()
    const blocked = gate()
    h.hooks.readFile = (file) => file === h.legacy ? blocked.wait() : undefined
    const storage = h.service()
    const pending = Promise.allSettled([storage.saveGenerationRunBundle(h.bundle()), storage.loadSnapshot()])
    await blocked.entered
    h.assertUninitialized()
    blocked.release()
    const results = await pending
    assert(results.every((r) => r.status === 'fulfilled'))
    const loaded = await storage.load()
    assert.equal(loaded.projects[0].id, 'legacy')
    assert.equal(loaded.chapterGenerationJobs[0].id, 'job')
    assert.equal(h.calls.copies.filter(([, to]) => to.includes('.before-sqlite-migrate.')).length, 1)
  })

  await test('first-bundle-write-blocked-by-migration-io-failure', async (h) => {
    await h.writeLegacy()
    const storage = h.service()
    h.hooks.copyFile = () => { throw ioError('ENOSPC') }
    await assert.rejects(storage.saveGenerationRunBundle(h.bundle()), { code: 'ENOSPC' })
    h.assertUninitialized()
    delete h.hooks.copyFile
    await storage.saveGenerationRunBundle(h.bundle())
    assert.equal((await storage.load()).projects[0].id, 'legacy')
    assert.equal((await storage.load()).chapterGenerationJobs[0].id, 'job')
  })

  await test('explicit-save-and-revision-api-remain-compatible', async (h) => {
    await h.writeLegacy()
    const storage = h.service()
    const saved = await storage.saveIfCurrent(h.makeData('explicit'), '0')
    assert.equal(saved.ok, true)
    assert.equal(saved.storagePath, h.path)
    assert(saved.savedCollections.includes('app_settings') && saved.savedCollections.includes('projects'))
    assert(saved.revision && saved.updatedAt)
    assert.equal(h.calls.reads.length, 0, 'an explicit full save must not import legacy JSON')
    const first = await storage.loadSnapshot()
    assert.equal(first.revision, saved.revision)
    assert.equal(first.data.settings.apiKey, '')
    assert.equal(first.data.projects[0].id, 'explicit')
    const next = await storage.saveIfCurrent(h.makeData('updated'), saved.revision)
    assert.notEqual(next.revision, saved.revision)
    await assert.rejects(storage.saveIfCurrent(first.data, saved.revision), { code: 'STORAGE_REVISION_CONFLICT' })
    assert.deepEqual(h.projectIds(), ['updated'])
    assert.equal(await storage.save(h.makeData('final')), undefined)
    assert.deepEqual(h.projectIds(), ['final'])
    const json = h.inspect((db) => db.prepare('SELECT json FROM app_settings').get().json)
    assert(!json.includes('SYNTHETIC_TEST_KEY'))
  })

  await test('backup-and-readonly-api-remain-compatible', async (h) => {
    await h.writeLegacy()
    const storage = h.service()
    const target = join(h.folder, 'backup.sqlite')
    await storage.backupTo(target)
    const snapshot = await storage.loadSnapshot()
    storage.close()
    const original = await fs.readFile(h.path)
    const readonly = await h.loadSqliteSnapshotReadonly(h.path)
    const savedBackup = await h.loadSqliteSnapshotReadonly(target)
    assert.equal(readonly.revision, snapshot.revision)
    assert.equal(savedBackup.data.projects[0].id, 'legacy')
    assert.deepEqual(await fs.readFile(h.path), original)
    assert.equal(h.active().length, 0)
  })

  await test('corrupt-json-backup-compatibility', async (h) => {
    await fs.mkdir(h.folder, { recursive: true })
    await fs.writeFile(h.legacy, '{broken')
    const storage = h.service()
    assert.equal((await storage.load()).projects.length, 0)
    const corrupt = h.calls.copies.find(([, to]) => to.includes('.corrupt.'))
    assert(corrupt)
    assert.equal(await fs.readFile(corrupt[1], 'utf8'), '{broken')
    assert.equal(await fs.readFile(h.legacy, 'utf8'), '{broken')
  })

  await test('corrupt-json-backup-failure-does-not-initialize-empty', async (h) => {
    await fs.mkdir(h.folder, { recursive: true })
    await fs.writeFile(h.legacy, '{broken')
    h.hooks.copyFile = () => { throw ioError('EACCES') }
    const storage = h.service()
    await assert.rejects(storage.load(), { code: 'EACCES' })
    h.assertUninitialized()
    delete h.hooks.copyFile
    assert.equal((await storage.load()).projects.length, 0)
  })

  await test('json-fallback-is-unchanged', async (h) => {
    h.hooks.unavailable = true
    const storage = h.service(h.path, true)
    assert(storage instanceof h.JsonStorageService)
    assert.equal(storage.getStoragePath(), h.legacy)
    await storage.save(h.makeData('fallback'))
    const snapshot = await storage.loadSnapshot()
    assert.equal(snapshot.data.projects[0].id, 'fallback')
    assert.equal(snapshot.data.settings.apiKey, '')
    const saved = await storage.saveIfCurrent(h.makeData('fallback-updated'), snapshot.revision)
    assert.notEqual(saved.revision, snapshot.revision)
    await assert.rejects(storage.saveIfCurrent(snapshot.data, snapshot.revision), { code: 'STORAGE_REVISION_CONFLICT' })
    assert.equal(h.opened().length, 0)
    assert.equal(h.calls.warnings.length, 1)
  })

  console.log(JSON.stringify({ passed, failed: failures.length, failures }, null, 2))
  if (failures.length) process.exitCode = 1
} finally {
  const rel = relative(base, dir)
  assert(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
  assert.equal(dirname(dir), base)
  await fs.rm(dir, { recursive: true, force: true })
}

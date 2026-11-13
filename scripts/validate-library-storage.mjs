import assert from 'node:assert/strict'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync,
  rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import Database from 'better-sqlite3'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const require = createRequire(import.meta.url)
const base = join(repoRoot, 'tmp')
mkdirSync(base, { recursive: true })
const root = mkdtempSync(join(base, 'library-storage-'))
after(() => { assert.equal(dirname(root), base); rmSync(root, { recursive: true }) })
const compiled = await build({ stdin: { resolveDir: repoRoot, contents: `
  export * from './src/storage/SqliteStorageService'
  export { EMPTY_APP_DATA } from './src/shared/defaults'
` }, bundle: true, write: false, platform: 'node', packages: 'external', format: 'cjs', logLevel: 'silent' })

function api(binding = Database, json = JSON) {
  const localRequire = id => id === 'better-sqlite3' ? binding
    : id === 'node:module' ? { ...require(id), createRequire: () => localRequire } : require(id)
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', 'JSON', compiled.outputFiles[0].text)(
    localRequire, mod, mod.exports, json)
  return mod.exports
}
const { EMPTY_APP_DATA, SqliteStorageService, createNewLibraryStorage: create, createExistingLibraryStorage: existing } = api()
const seeded = { ...EMPTY_APP_DATA, projects: [{ id: 'test-book', name: 'fixture-first' }],
  settings: { ...EMPTY_APP_DATA.settings, apiKey: 'SYNTHETIC_DO_NOT_STORE' } }
function directory() { return mkdtempSync(join(root, 'case-')) }
function reserve(path) { closeSync(openSync(path, 'wx')) }
function modify(path, f) {
  const db = new Database(path, { fileMustExist: true })
  try { return f(db) } finally { db.close() }
}
function seededFile(dir, name = 'book.sqlite', data = seeded) {
  const path = join(dir, name)
  reserve(path)
  create(path, data).close?.()
  return path
}

for (const suffix of ['.SQLite', '.DB', '.JSON']) {
  test(suffix + ': exact path, empty vs missing, initial payload, write and reopen', async () => {
    const dir = directory(), path = join(dir, 'selected' + suffix)
    const sibling = join(dir, 'novel-director-data.json'), other = JSON.stringify(seeded)
    writeFileSync(sibling, other)
    assert.throws(() => existing(path))
    assert.throws(() => create(path))
    assert(!existsSync(path))
    reserve(path)
    assert.throws(() => existing(path))
    const service = create(path)
    try {
      assert.equal(service.getStoragePath(), path)
      const empty = await service.loadSnapshot()
      assert.deepEqual(empty.data.projects, [])
      const saved = await service.saveIfCurrent(seeded, empty.revision)
      assert.notEqual(saved.revision, empty.revision)
      await assert.rejects(service.saveIfCurrent(EMPTY_APP_DATA, empty.revision), { code: 'STORAGE_REVISION_CONFLICT' })
    } finally { service.close?.() }
    const reopened = existing(path)
    try {
      const loaded = await reopened.load()
      assert.equal(loaded.projects[0].id, 'test-book')
      assert.equal(loaded.settings.apiKey, '')
      await reopened.save(EMPTY_APP_DATA)
    } finally { reopened.close?.() }
    const again = existing(path)
    try { assert.deepEqual((await again.load()).projects, []) } finally { again.close?.() }
    const ready = existing(seededFile(dir, 'seeded' + suffix))
    try { assert.equal((await ready.load()).projects[0].name, 'fixture-first') } finally { ready.close?.() }
    assert.equal(readFileSync(sibling, 'utf8'), other)
  })
}

test('new requires an untouched reservation, rejects stale SQLite sidecars and unknown suffixes', () => {
  const dir = directory()
  for (const suffix of ['.db', '.json', '.bak', '', '.sqlite3']) {
    const path = join(dir, 'existing' + suffix)
    writeFileSync(path, 'do not change')
    assert.throws(() => create(path))
    assert.throws(() => existing(path))
    assert.equal(readFileSync(path, 'utf8'), 'do not change')
  }
  const path = join(dir, 'reserved.db')
  reserve(path)
  for (const suffix of ['-shm', '-wal', '-journal']) {
    writeFileSync(path + suffix, 'unowned')
    assert.throws(() => create(path))
    assert.equal(readFileSync(path).length, 0)
    assert.equal(readFileSync(path + suffix, 'utf8'), 'unowned')
    unlinkSync(path + suffix)
  }
})

test('failed initial payload rolls back schema as well as data; no published empty library', () => {
  for (const extension of ['.json', '.db']) {
    const path = join(directory(), 'new' + extension)
    reserve(path)
    assert.throws(() => create(path, { ...seeded, projects: [null] }))
    assert.throws(() => existing(path))
    if (extension === '.json') assert.equal(readFileSync(path).length, 0)
    else modify(path, db => assert.equal(db.prepare('SELECT 1 FROM sqlite_schema LIMIT 1').get(), undefined))
  }
})

test('an insert failure after the first project rolls back the entire new library', () => {
  const path = join(directory(), 'interrupted.sqlite')
  reserve(path)
  const injected = api(function Observed(file, options) {
    const db = new Database(file, options)
    if (file === path) {
      const exec = db.exec.bind(db)
      db.exec = sql => {
        const result = exec(sql)
        if (sql.includes('CREATE TABLE IF NOT EXISTS entities')) exec(`CREATE TEMP TRIGGER reject_second
          BEFORE INSERT ON entities WHEN new.collection='projects' AND new.id='second'
          BEGIN SELECT RAISE(ABORT, 'synthetic mid-write failure'); END;`)
        return result
      }
    }
    return db
  })
  assert.throws(() => injected.createNewLibraryStorage(path, { ...seeded, projects: [...seeded.projects, { id: 'second' }] }),
    /synthetic mid-write failure/)
  assert.throws(() => existing(path))
  modify(path, db => assert.deepEqual(db.prepare('SELECT name FROM sqlite_schema').all(), []))
})

test('JSON rejection precedes normalization, creation, backup or recovery', () => {
  const dir = directory(), path = join(dir, 'selected.json')
  for (const input of ['', '{', 'null', '[]', '{}', JSON.stringify({ settings: {}, projects: [] }),
    ...[{ settings: null }, { schemaVersion: 0 }, { schemaVersion: 4 }, { schemaVersion: '3' },
      { projects: {} }, { chapters: [null] }, { storyBibles: [{}] }, { projects: [{ name: 'no id' }] },
      { chapters: [{ id: 'c' }] }, { projects: [{ id: 'p' }, { id: 'p' }] },
      { candidateDecisionReceipts: [{ id: 'bad', projectId: 'test-book' }] }
    ].map(change => JSON.stringify({ ...seeded, ...change }))]) {
    writeFileSync(path, input)
    assert.throws(() => existing(path))
    assert.equal(readFileSync(path, 'utf8'), input)
    assert.deepEqual(readdirSync(dir), ['selected.json'])
  }
})

test('JSON checks current bytes on first and later reads, writes and backups', async () => {
  const dir = directory(), path = join(dir, 'legacy.json')
  const legacy = { schemaVersion: 1, projects: [{ id: 'p' }], storyBibles: [{ projectId: 'p' }],
    chapters: [], settings: { theme: 'dark' } }
  const raw = JSON.stringify(legacy)
  writeFileSync(path, raw)
  let decodes = 0
  const strict = api(Database, { ...JSON, stringify: JSON.stringify, parse: text => {
    if (text === raw) decodes++
    return JSON.parse(text)
  } }).createExistingLibraryStorage(path)
  assert.equal((await strict.load()).storyBibles[0].projectId, 'p')
  assert.equal(decodes, 1, 'opening and first load must not decode the same document twice')
  const other = existing(path)
  writeFileSync(path, '{}')
  await assert.rejects(other.load()) // changed before first load
  await assert.rejects(strict.loadSnapshot())
  await assert.rejects(strict.save(seeded))
  await assert.rejects(strict.backupTo(join(dir, 'new-backup.json')))
  assert.deepEqual(readdirSync(dir), ['legacy.json'])
  assert.equal(readFileSync(path, 'utf8'), '{}')
  unlinkSync(path)
  await assert.rejects(strict.load())
  await assert.rejects(strict.save(seeded))
  assert.deepEqual(readdirSync(dir), [])
})

test('invalid UTF-8 inside an otherwise valid JSON string is not replaced with missing prose', () => {
  const path = join(directory(), 'invalid-text.json')
  const bytes = Buffer.from(JSON.stringify(seeded))
  bytes[bytes.indexOf('fixture-first')] = 0xff
  writeFileSync(path, bytes)
  assert.throws(() => existing(path), /UTF-8/)
  assert.deepEqual(readFileSync(path), bytes)
})

test('legacy entity keys agree with the original SQLite writer, including explicit story bible ids', async () => {
  const dir = directory(), sqlite = join(dir, 'older.db'), json = join(dir, 'export.json')
  const old = new SqliteStorageService(sqlite)
  const data = { ...seeded, storyBibles: [{ id: 'separate-id', projectId: 'test-book', corePremise: 'fixture' }],
    promptVersions: [{ projectId: 'test-book', label: 'legacy without id' }] }
  try { await old.save(data) } finally { old.close() }
  writeFileSync(json, JSON.stringify(data))
  for (const path of [sqlite, json]) {
    const store = existing(path)
    try {
      const { data: loaded, revision } = await store.loadSnapshot()
      assert.equal(loaded.storyBibles[0].id, 'separate-id')
      assert.equal(loaded.promptVersions[0].label, 'legacy without id')
      await store.saveIfCurrent(loaded, revision)
    } finally { store.close?.() }
  }
  modify(sqlite, db => assert.deepEqual(db.prepare("SELECT id FROM entities WHERE collection IN ('promptVersions', 'storyBibles') ORDER BY collection").all(),
    [{ id: 'promptVersions:0' }, { id: 'separate-id' }]))
})

test('unrelated, truncated, incomplete and unsupported SQLite files are never adopted or repaired', () => {
  const dir = directory(), sibling = join(dir, 'novel-director-data.json'), config = join(dir, 'app-config.json')
  const other = JSON.stringify(seeded)
  writeFileSync(sibling, other); writeFileSync(config, '{"unmodified":true}')
  const unrelated = join(dir, 'unrelated.sqlite')
  const wrong = new Database(unrelated)
  wrong.exec('CREATE TABLE unrelated (id INTEGER)'); wrong.close()
  const mislabeled = join(dir, 'mislabeled.db')
  writeFileSync(mislabeled, other)
  const truncated = join(dir, 'truncated.db')
  writeFileSync(truncated, readFileSync(unrelated).subarray(0, 165))
  function rejected(path) {
    const original = readFileSync(path)
    assert.throws(() => existing(path))
    assert.deepEqual(readFileSync(path), original)
  }
  for (const path of [unrelated, mislabeled, truncated]) rejected(path)
  for (const [i, sql] of [
    'DROP TABLE app_settings', 'ALTER TABLE entities RENAME COLUMN chapter_order TO wrong',
    'DELETE FROM schema_migrations', "INSERT INTO schema_migrations VALUES (2, 'future')",
    "DELETE FROM meta WHERE key = 'revision'", "UPDATE meta SET value='5' WHERE key='schemaVersion'",
    'DELETE FROM app_settings', "UPDATE app_settings SET json='null'", "UPDATE app_settings SET json='{'",
    "UPDATE entities SET json='{'", "UPDATE entities SET json='[]'", "UPDATE entities SET json='null'",
    "UPDATE entities SET json='{}'", "UPDATE entities SET json='{\"id\":\"different\"}'",
    "UPDATE entities SET collection='future' WHERE collection='projects'"
  ].entries()) {
    const path = seededFile(dir, 'case' + i + '.sqlite')
    modify(path, db => { db.pragma('journal_mode = DELETE'); db.exec(sql) })
    rejected(path)
  }
  assert.equal(readFileSync(sibling, 'utf8'), other)
  assert.equal(readFileSync(config, 'utf8'), '{"unmodified":true}')
  assert(!readdirSync(dir).some(n => /before-|invalid-sqlite|\.bak|corrupt/.test(n)))
})

test('compatible extra columns and missing performance indexes do not prevent normal writes', async () => {
  const path = seededFile(directory())
  modify(path, db => db.exec(`PRAGMA journal_mode=DELETE; DROP INDEX idx_entities_job;
    ALTER TABLE entities ADD COLUMN optional_column TEXT;
    ALTER TABLE entities ADD COLUMN with_default INTEGER NOT NULL DEFAULT 0;`))
  const store = existing(path)
  try { await store.saveIfCurrent(seeded, (await store.loadSnapshot()).revision) } finally { store.close() }
  modify(path, db => {
    assert.equal(db.pragma('journal_mode', { simple: true }), 'delete')
    assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='idx_entities_job'").get(), undefined)
  })
})

test('live WAL is authoritative; readonly preflight and first load use one payload scan', async () => {
  const path = seededFile(directory()), opens = [], sql = []
  const peer = new Database(path, { fileMustExist: true })
  const strict = api(function Observed(file, options) {
    opens.push({ file, options })
    return new Database(file, { ...options, verbose: query => sql.push(query) })
  })
  const change = name => peer.prepare(`UPDATE entities SET json=json_set(json, '$.name', ?)
    WHERE collection='projects'`).run(name)
  try {
    peer.pragma('wal_autocheckpoint = 0')
    const main = readFileSync(path)
    change('in WAL')
    assert.deepEqual(readFileSync(path), main)
    assert.ok(readFileSync(path + '-wal').length)
    const store = strict.createExistingLibraryStorage(path)
    try {
      assert.equal((await store.loadSnapshot()).data.projects[0].name, 'in WAL')
      assert.equal(sql.filter(q => q.includes('FROM entities ORDER BY collection, id')).length, 1)
      assert.deepEqual(opens.filter(o => o.file !== ':memory:'), [
        { file: path, options: { readonly: true, fileMustExist: true } }, { file: path, options: { fileMustExist: true } }
      ])
      assert(!sql.some(q => /integrity_check|journal_mode\s*=|checkpoint|CREATE (TABLE|INDEX)/i.test(q)))
    } finally { store.close() }
    const another = existing(path)
    try {
      change('newer WAL without revision bump')
      assert.equal((await another.load()).projects[0].name, 'newer WAL without revision bump')
      peer.exec("UPDATE entities SET json='not JSON' WHERE collection='projects'")
      await assert.rejects(another.load())
    } finally { another.close() }
  } finally { peer.close() }
})

test('binding check touches only memory, is cached on success, and cannot fall back to JSON', async () => {
  const opens = [], dir = directory(), path = seededFile(dir), reserved = join(dir, 'new.db')
  reserve(reserved)
  const before = readFileSync(path), names = readdirSync(dir)
  const missing = api(function Unavailable(file) { opens.push(file); throw new Error('native unavailable') })
  assert.throws(missing.checkSqliteBindingAvailable, /native unavailable/)
  assert.throws(() => missing.createExistingLibraryStorage(path), /native unavailable/)
  assert.throws(() => missing.createNewLibraryStorage(reserved), /native unavailable/)
  assert.deepEqual(readdirSync(dir), names)
  assert.deepEqual(readFileSync(path), before)
  assert.equal(readFileSync(reserved).length, 0)
  const json = join(dir, 'new.json')
  reserve(json)
  assert.deepEqual((await missing.createNewLibraryStorage(json).load()).projects, [])
  assert.deepEqual(opens, [':memory:', ':memory:', ':memory:'])
  let probes = 0
  const available = api(function Traced(file) { assert.equal(file, ':memory:'); probes++; return new Database(file) })
  available.checkSqliteBindingAvailable()
  available.checkSqliteBindingAvailable()
  assert.equal(probes, 1)
})

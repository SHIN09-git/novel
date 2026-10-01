import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'
import { createLongNovelFixture } from './fixtures/long-novel-performance.mjs'

const base = join(repoRoot, 'tmp', 'sqlite-differential-test')
await mkdir(base, { recursive: true })
const dir = await mkdtemp(join(base, 'run-'))
const compiled = join(dir, 'entry.mjs')
await build({ stdin: { resolveDir: repoRoot, contents: `
  export { SqliteStorageService } from './src/storage/SqliteStorageService';
  export { JsonStorageService } from './src/storage/JsonStorageService';
  export { normalizeAppData } from './src/shared/defaults';
  export { buildGenerationRunBundle } from './src/services/GenerationRunBundleService';
` }, outfile: compiled, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' })
const { SqliteStorageService, JsonStorageService, normalizeAppData, buildGenerationRunBundle } = await import(pathToFileURL(compiled).href)
const path = join(dir, 'data.sqlite')
const storage = new SqliteStorageService(path)
let db, passed = 0
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`) }
const rows = () => db.prepare('SELECT * FROM entities ORDER BY collection,id').all()
const seen = () => db.prepare('SELECT operation, collection, id FROM observed_writes').all()
const reset = () => db.prepare('DELETE FROM observed_writes').run()
try {
  await storage.save(normalizeAppData(createLongNovelFixture(3)))
  db = new Database(path)
  db.exec(`CREATE TABLE observed_writes(operation TEXT, collection TEXT, id TEXT);
    CREATE TRIGGER observed_insert AFTER INSERT ON entities BEGIN
      INSERT INTO observed_writes VALUES ('insert', NEW.collection, NEW.id); END;
    CREATE TRIGGER observed_update AFTER UPDATE ON entities BEGIN
      INSERT INTO observed_writes VALUES ('update', NEW.collection, NEW.id); END;
    CREATE TRIGGER observed_delete AFTER DELETE ON entities BEGIN
      INSERT INTO observed_writes VALUES ('delete', OLD.collection, OLD.id); END;`)
  await test('identical full snapshot performs zero entity writes and retains row timestamps', async () => {
    const snapshot = await storage.loadSnapshot(), before = rows()
    const saved = await storage.saveIfCurrent(snapshot.data, snapshot.revision)
    assert.notEqual(saved.revision, snapshot.revision)
    assert.deepEqual(rows(), before)
    assert.deepEqual(seen(), [])
  })
  await test('editing one chapter touches only that row, not other projects, versions, reports or history', async () => {
    reset()
    const snapshot = await storage.loadSnapshot()
    const next = { ...snapshot.data, chapters: snapshot.data.chapters.map((c) => c.order === 3
      ? { ...c, body: c.body + '\n新的作者修改。' } : c) }
    await storage.saveIfCurrent(next, snapshot.revision)
    assert.deepEqual(seen(), [{ operation: 'update', collection: 'chapters', id: 'perf-chapter-3' }])
    assert((await storage.load()).chapters.find((c) => c.order === 3).body.endsWith('新的作者修改。'))
  })
  await test('insertions and removals still have full snapshot semantics', async () => {
    reset()
    const snapshot = await storage.loadSnapshot(), first = snapshot.data.chapters[0]
    const added = { ...first, id: 'new-chapter', order: 4, title: '新章' }
    await storage.saveIfCurrent({ ...snapshot.data,
      chapters: [...snapshot.data.chapters.filter((c) => c.id !== first.id), added] }, snapshot.revision)
    assert.deepEqual(seen().map((r) => `${r.operation}:${r.id}`).sort(), [`delete:${first.id}`, 'insert:new-chapter'].sort())
    assert.equal((await storage.load()).chapters.length, 3)
  })
  await test('indexed fields follow changed JSON payloads', async () => {
    const snapshot = await storage.loadSnapshot()
    const next = { ...snapshot.data, chapters: snapshot.data.chapters.map((c) => c.id === 'new-chapter'
      ? { ...c, title: '重排新章', order: 8 } : c) }
    await storage.saveIfCurrent(next, snapshot.revision)
    const indexed = db.prepare("SELECT chapter_order,title FROM entities WHERE collection='chapters' AND id=?").get('new-chapter')
    assert.deepEqual(indexed, { chapter_order: 8, title: '重排新章' })
  })
  await test('duplicate IDs reject the whole snapshot instead of silently taking the last value', async () => {
    const snapshot = await storage.loadSnapshot(), before = rows()
    await assert.rejects(storage.saveIfCurrent({ ...snapshot.data,
      chapters: [...snapshot.data.chapters, { ...snapshot.data.chapters[0], body: '重复ID不应覆盖。' }] }, snapshot.revision), /Duplicate entity/)
    assert.deepEqual(rows(), before)
    assert.equal((await storage.loadSnapshot()).revision, snapshot.revision)
  })
  await test('a failed update rolls back earlier changed rows and revision metadata', async () => {
    const snapshot = await storage.loadSnapshot(), before = rows()
    db.exec(`CREATE TRIGGER fail_snapshot BEFORE UPDATE ON entities
      WHEN NEW.json LIKE '%FAIL-SNAPSHOT%' BEGIN SELECT RAISE(ABORT, 'injected snapshot failure'); END;`)
    await assert.rejects(storage.saveIfCurrent({ ...snapshot.data,
      projects: snapshot.data.projects.map((p) => ({ ...p, name: '必须回滚的项目名' })),
      chapters: snapshot.data.chapters.map((c, i) => i === 1 ? { ...c, body: 'FAIL-SNAPSHOT' } : c)
    }, snapshot.revision), /injected snapshot failure/)
    db.exec('DROP TRIGGER fail_snapshot')
    assert.deepEqual(rows(), before)
    assert.equal((await storage.loadSnapshot()).revision, snapshot.revision)
  })
  await test('a failed deletion rolls back preceding updates', async () => {
    const snapshot = await storage.loadSnapshot(), before = rows()
    db.exec(`CREATE TRIGGER fail_snapshot_delete BEFORE DELETE ON entities
      WHEN OLD.collection='chapters' BEGIN SELECT RAISE(ABORT, 'injected delete failure'); END;`)
    await assert.rejects(storage.saveIfCurrent({ ...snapshot.data, chapters: [],
      projects: snapshot.data.projects.map((p) => ({ ...p, name: '删除失败同样回滚' })) }, snapshot.revision), /injected delete failure/)
    db.exec('DROP TRIGGER fail_snapshot_delete')
    assert.deepEqual(rows(), before)
    assert.equal((await storage.loadSnapshot()).revision, snapshot.revision)
  })
  await test('stale full save cannot erase a newer bundle from another connection', async () => {
    const snapshot = await storage.loadSnapshot()
    const other = new SqliteStorageService(path)
    try {
      const bundle = buildGenerationRunBundle(snapshot.data, 'perf-job-3')
      bundle.job = { ...bundle.job, errorMessage: '新的运行标记' }
      await other.saveGenerationRunBundle(bundle, snapshot.revision)
      const after = rows()
      await assert.rejects(storage.saveIfCurrent(snapshot.data, snapshot.revision), (e) => e.code === 'STORAGE_REVISION_CONFLICT')
      assert.deepEqual(rows(), after)
    } finally { other.close() }
  })
  await test('legacy synthetic IDs and same ID across collections remain supported', async () => {
    const snapshot = await storage.loadSnapshot()
    const next = { ...snapshot.data, promptVersions: [{ projectId: 'perf-long-novel', label: 'legacy without id' }],
      timelineEvents: [...snapshot.data.timelineEvents, { id: 'new-chapter', projectId: 'perf-long-novel', title: '与章节同ID但不同集合' }] }
    await storage.saveIfCurrent(next, snapshot.revision)
    assert(db.prepare("SELECT id FROM entities WHERE collection='promptVersions'").get())
    assert.equal(db.prepare('SELECT count(*) count FROM entities WHERE id=?').get('new-chapter').count, 2)
    const reloaded = await storage.loadSnapshot()
    reset()
    await storage.saveIfCurrent(reloaded.data, reloaded.revision)
    assert.deepEqual(seen(), [])
  })
  await test('JSON export/import and credential scrubbing retain current collections', async () => {
    const snapshot = await storage.loadSnapshot()
    const secret = 'PRIVATE_BENCHMARK_CREDENTIAL'
    const input = { ...snapshot.data, settings: { ...snapshot.data.settings, apiKey: secret } }
    await storage.saveIfCurrent(input, snapshot.revision)
    assert(!rows().some((row) => row.json.includes(secret)))
    assert(!db.prepare('SELECT json FROM app_settings').get().json.includes(secret))
    const json = new JsonStorageService(join(dir, 'export.json'))
    await json.save(await storage.load())
    assert(!(await readFile(json.getStoragePath(), 'utf8')).includes(secret))
    const imported = new SqliteStorageService(join(dir, 'import.sqlite'))
    try {
      await imported.save(await json.load())
      const readBack = await imported.load(), expected = await storage.load()
      for (const [key, value] of Object.entries(expected)) {
        if (Array.isArray(value)) assert.equal(readBack[key].length, value.length, key)
      }
      assert.equal(readBack.chapters.find((c) => c.id === 'new-chapter').title, '重排新章')
    } finally { imported.close() }
  })
  console.log(`SQLite differential save validation passed (${passed} checks).`)
} finally {
  db?.close(); storage.close()
  const rel = relative(base, dir)
  assert(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))
  await rm(dir, { recursive: true, force: true })
}

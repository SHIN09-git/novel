import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import Database from 'better-sqlite3'
import { repoRoot } from './utils/repo-root.mjs'

const root = join(repoRoot, 'tmp')
await mkdir(root, { recursive: true })
const dir = await mkdtemp(join(root, 's1-session-'))
const sessions = []
let passed = 0
try {
  const outfile = join(dir, 'session.mjs')
  await build({ stdin: { resolveDir: repoRoot, contents: [
    'main/LibrarySession', 'main/AppConfigService', 'main/libraryFiles', 'main/BackupService',
    'storage/libraryValidation', 'shared/defaults'
  ].map(name => `export * from './src/${name}'`).join('\n') }, outfile,
    format: 'esm', platform: 'node', target: 'node22', bundle: true, external: ['better-sqlite3'] })
  const { LibrarySession, AppConfigService, BackupService, normalizeImportedLibrary, EMPTY_APP_DATA, libraryStores } =
    await import(pathToFileURL(outfile))
  const json = JSON.stringify({ ...EMPTY_APP_DATA, projects: [{ id: 'book-1', name: '纸灯' }, { id: 'book-2', name: '回潮' }] })
  const ids = s => s.snapshot.data.projects.map(p => p.id)
  async function setup(name, stores = libraryStores) {
    const home = join(dir, name)
    await mkdir(home)
    const config = new AppConfigService(home)
    function session(previousLaunch = false) {
      const s = new LibrarySession(config, stores, undefined, previousLaunch)
      sessions.push(s)
      return s
    }
    return { home, config, cfg: await config.getConfigPath(), db: config.getDefaultStoragePath(),
      old: join(home, 'novel-director-data.json'), session }
  }
  async function scenario(name, fn) { await fn(); passed++; console.log('PASS:', name) }
  const off = () => { throw new Error('NODE_MODULE_VERSION mismatch') }
  const unavailable = { checkSqlite: off, existing: p => /\.json$/i.test(p) ? libraryStores.existing(p) : off(),
    create: (p, data) => /\.json$/i.test(p) ? libraryStores.create(p, data) : off() }
  await scenario('首次启动：两个并发读取只建一个空库；重启仍指向同一文件', async () => {
    const f = await setup('fresh'), s = f.session()
    assert.throws(() => s.getStorage())
    const [a, b] = await Promise.all([s.load(), s.load()])
    assert.equal(a.storage, b.storage)
    assert.deepEqual(ids(a), [])
    assert.equal(JSON.parse(await readFile(f.cfg)).storagePath, f.db)
    assert.ok(!existsSync(f.old))
    s.adopt(libraryStores.existing(f.db))
    await assert.rejects(a.storage.loadSnapshot(), /已关闭/)
    s.close()
    assert.equal((await f.session().load()).snapshot.revision, a.snapshot.revision)
  })
  await scenario('旧 JSON 及其常规备份迁入 SQLite；原件及迁移备份逐字节不变', async () => {
    const f = await setup('legacy')
    await writeFile(f.old, json)
    await writeFile(f.old + '.bak', json)
    const s = f.session()
    assert.deepEqual(ids(await s.load()), ['book-1', 'book-2'])
    assert.equal(s.path, f.db)
    const backups = (await readdir(f.home)).filter(n => n.includes('before-sqlite-migrate.'))
    assert.equal(backups.length, 1)
    assert.equal(await readFile(join(f.home, backups[0]), 'utf8'), json)
    assert.equal(await readFile(f.old, 'utf8'), json)
    s.close()
    assert.deepEqual(ids(await f.session().load()), ['book-1', 'book-2'])
  })
  await scenario('已配置书库离线：阻止读取和写入；重试仍打开原库', async () => {
    const f = await setup('offline')
    await writeFile(f.old, json)
    const initial = f.session()
    await initial.load()
    initial.close()
    const savedConfig = await readFile(f.cfg)
    await rename(f.db, f.db + '.offline')
    const s = f.session()
    await assert.rejects(s.load(), { code: 'LIBRARY_UNAVAILABLE' })
    assert.equal(s.path, f.db)
    assert.throws(() => s.getStorage())
    await assert.rejects(s.recover('retry'), /找不到原书库/)
    await assert.rejects(s.recover('restore', f.db, f.old), /另选/)
    assert.deepEqual(await readFile(f.cfg), savedConfig)
    assert.ok(!existsSync(f.db))
    assert.equal(await readFile(f.old, 'utf8'), json)
    await rename(f.db + '.offline', f.db)
    await s.recover('retry')
    assert.deepEqual(ids(await s.load()), ['book-1', 'book-2'])
  })
  await scenario('损坏的 SQLite 与旁边的 JSON 均不被修理、替换或另存', async () => {
    const f = await setup('corrupt')
    await f.config.setStoragePath(f.db)
    await writeFile(f.db, 'not sqlite')
    await writeFile(f.old, json)
    const files = await readdir(f.home), config = await readFile(f.cfg)
    const s = f.session()
    await assert.rejects(s.load(), { code: 'LIBRARY_UNAVAILABLE' })
    await assert.rejects(s.recover('choose', f.db))
    assert.deepEqual(await readdir(f.home), files)
    assert.deepEqual(await readFile(f.cfg), config)
    assert.equal(await readFile(f.db, 'utf8'), 'not sqlite')
    assert.equal(await readFile(f.old, 'utf8'), json)
  })
  await scenario('SQLite 组件不可用：可明确选择独立 JSON；重启不会改读同目录 SQLite', async () => {
    const f = await setup('native', unavailable)
    await writeFile(f.db, 'untouched')
    await writeFile(f.old, json)
    await f.config.setStoragePath(f.db)
    const s = f.session()
    await assert.rejects(s.load(), /组件/)
    assert.equal(JSON.parse(await readFile(f.cfg)).storagePath, f.db)
    await s.recover('choose', f.old)
    assert.deepEqual(ids(await s.load()), ['book-1', 'book-2'])
    assert.equal(JSON.parse(await readFile(f.cfg)).explicitJson, true)
    s.close()
    assert.equal((await f.session().load()).storage.getStoragePath(), f.old)
    assert.equal(await readFile(f.db, 'utf8'), 'untouched')
  })
  await scenario('无法区分旧 JSON 自动回退和作者选择时，不猜测', async () => {
    const f = await setup('ambiguous')
    await writeFile(f.db, 'old sqlite')
    await writeFile(f.old, json)
    await f.config.setStoragePath(f.old)
    const cfg = await readFile(f.cfg)
    await assert.rejects(f.session().load(), /明确选择/)
    assert.deepEqual(await readFile(f.cfg), cfg)
  })
  await scenario('恢复到新位置：拒绝坏备份及已存在的目标，恢复后能重启', async () => {
    const f = await setup('restore'), backup = join(f.home, 'backup.json')
    const invalid = join(f.home, 'invalid.json'), target = join(f.home, 'restored.sqlite')
    await f.config.setStoragePath(f.db)
    const saved = JSON.parse(json)
    saved.settings.apiKey = 'SYNTHETIC_RECOVERY_CREDENTIAL'
    const raw = JSON.stringify(saved)
    await writeFile(backup, raw)
    await writeFile(invalid, '{}')
    const s = f.session(), cfg = await readFile(f.cfg)
    await assert.rejects(s.load())
    await assert.rejects(s.recover('restore', target, invalid))
    await assert.rejects(s.recover('restore', backup, backup))
    assert.deepEqual(await readFile(f.cfg), cfg)
    assert.ok(!existsSync(target))
    await s.recover('restore', target, backup)
    assert.deepEqual(ids(await s.load()), ['book-1', 'book-2'])
    assert.equal(s.path, target)
    assert.equal(await readFile(backup, 'utf8'), raw)
    assert.ok(!existsSync(f.db))
    s.close()
    const db = new Database(target, { readonly: true, fileMustExist: true })
    try { assert.ok(!db.prepare('SELECT json FROM app_settings').get().json.includes(saved.settings.apiKey)) }
    finally { db.close() }
    assert.equal((await f.session().load()).storage.getStoragePath(), target)
  })
  await scenario('旧 JSON 无效或配置损坏时，不创建默认库或自行重写配置', async () => {
    const f = await setup('invalid')
    await writeFile(f.old, '{')
    await assert.rejects(f.session().load())
    assert.deepEqual(await readdir(f.home), ['novel-director-data.json'])
    await writeFile(f.cfg, '{')
    await assert.rejects(f.session().load(), /上次选择/)
    assert.equal(await readFile(f.cfg, 'utf8'), '{')
    assert.ok(!existsSync(f.db))
    const priorConfig = JSON.stringify({ storagePath: f.db })
    await writeFile(f.cfg + '.bak', priorConfig)
    await writeFile(f.old, json)
    const recovery = f.session()
    await assert.rejects(recovery.load())
    await recovery.recover('choose', f.old)
    assert.equal(await readFile(f.cfg + '.bak', 'utf8'), priorConfig)
  })
  await scenario('有旧备份但没有配置：允许显式新建，不覆盖已有文件或遗留 WAL', async () => {
    const f = await setup('witness', unavailable)
    await mkdir(join(f.home, 'backups'))
    await writeFile(join(f.home, 'backups', 'previous.json'), json)
    const s = f.session(), target = join(f.home, 'new.json')
    await assert.rejects(s.load(), /旧书库记录/)
    await writeFile(target + '-wal', 'preserve')
    await assert.rejects(s.recover('create', target), /旧书库文件/)
    assert.ok(!existsSync(target))
    const newTarget = join(f.home, 'choice.json')
    await s.recover('create', newTarget)
    assert.deepEqual(ids(await s.load()), [])
    assert.ok(!existsSync(f.db))
  })
  await scenario('已启动过的旧桌面配置即便没有书库和备份，也不冒充首次使用', async () => {
    const f = await setup('previous-launch')
    const s = f.session(true)
    await assert.rejects(s.load(), /旧书库记录/)
    assert.ok(!existsSync(f.db) && !existsSync(f.cfg))
  })
  await scenario('坏备份和空对象不能用于覆盖；部分旧项目可合并，Windows UTF-8 备份可读', async () => {
    const f = await setup('import'), backups = new BackupService(f.home)
    await backups.ensureBackupDir()
    const backup = join(backups.getBackupDir(), 'test.json')
    await writeFile(backup, '{}')
    await assert.rejects(backups.loadBackup(backup), /完整/)
    for (const strategy of ['replace', 'merge']) assert.throws(() => normalizeImportedLibrary({}, strategy), /完整/)
    const partial = { projects: JSON.parse(json).projects }
    assert.throws(() => normalizeImportedLibrary(partial, 'replace'), /完整/)
    assert.equal(normalizeImportedLibrary(partial, 'merge').projects.length, 2)
    await writeFile(backup, '\ufeff' + json)
    assert.equal((await backups.loadBackup(backup)).projects.length, 2)
  })
  console.log(`S1: ${passed} library session scenarios passed.`)
} finally {
  for (const s of sessions) s.close()
  await rm(dir, { recursive: true, force: true })
}

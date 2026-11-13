import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { build } from 'esbuild'
import { createLongNovelFixture } from './fixtures/long-novel-performance.mjs'
import { repoRoot } from './utils/repo-root.mjs'

const parent = join(repoRoot, 'tmp')
await mkdir(parent, { recursive: true })
const work = await mkdtemp(join(parent, 'project-touch-'))
const entry = join(work, 'touch.mjs')
let storage, inspect
try {
  await build({ stdin: { resolveDir: repoRoot, contents: `
    export { normalizeAppData } from './src/shared/defaults'
    export { createExistingLibraryStorage, createNewLibraryStorage } from './src/storage/SqliteStorageService'
    export { loadAgentRuntimeData, saveAgentRuntimeData } from './src/agent/AgentRuntime'
    export { listProjects } from './src/agent/agentProjectSummaries'
    export { projectsByRecentOpen } from './src/renderer/src/views/home/homeProjectState'
    export { registerDataIpcHandlers } from './src/main/ipc/dataIpcHandlers'
    export { IPC_CHANNELS } from './src/shared/ipc/ipcChannels'
  ` }, outfile: entry, bundle: true, platform: 'node', format: 'esm', packages: 'external',
    plugins: [{ name: 'isolated-main', setup(b) {
      b.onResolve({ filter: /^electron$|\/LogService$/ }, ({ path }) => ({ path, namespace: 'isolated' }))
      b.onLoad({ filter: /.*/, namespace: 'isolated' }, ({ path }) => ({ contents: path === 'electron'
        ? 'export const app={}, dialog={}, ipcMain={handle:(k,v)=>globalThis.handlers.set(k,v)}'
        : 'export const LogService={info(){},warn(){},error(){}}' }))
    } }] })
  const api = await import(pathToFileURL(entry))
  const seed = api.normalizeAppData(createLongNovelFixture(3))
  const id = seed.projects[1].id
  seed.projects[1].updatedAt = '2000-01-01T00:00:00.000Z'
  seed.projects[1].createdAt = seed.projects[1].updatedAt
  const ordered = projects => projects.map(p => p.id)
  const firstOrder = ordered(api.projectsByRecentOpen(seed.projects))
  assert.notEqual(firstOrder[0], id)
  const conflict = { code: 'STORAGE_REVISION_CONFLICT' }
  for (const ext of ['json', 'sqlite']) {
    const path = join(work, 'library.' + ext), options = { storagePath: path, userDataPath: work }
    await writeFile(path, '', { flag: 'wx' })
    storage = api.createNewLibraryStorage(path, seed)
    const agent = await api.loadAgentRuntimeData(options)
    const edited = { ...agent.data, chapters: agent.data.chapters.map(c => ({ ...c, title: c.title + ' edited' })) }
    const stale = agent.revision
    await api.saveAgentRuntimeData(edited, agent)
    const before = await storage.loadSnapshot()
    await assert.rejects(storage.touchProject(id, stale), conflict)
    await assert.rejects(storage.touchProject(id, undefined), conflict)
    await assert.rejects(storage.touchProject('missing', before.revision), /项目不存在/)
    assert.deepEqual(await storage.loadSnapshot(), before)

    let rows, settings, raw
    if (ext === 'sqlite') {
      inspect = new Database(path, { fileMustExist: true })
      rows = inspect.prepare('SELECT * FROM entities ORDER BY collection,id').all()
      settings = inspect.prepare('SELECT * FROM app_settings').all()
      inspect.exec("CREATE TRIGGER fail_meta BEFORE INSERT ON meta WHEN NEW.key='revision' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END")
      await assert.rejects(storage.touchProject(id, before.revision), /fixture rollback/)
      assert.deepEqual(await storage.loadSnapshot(), before)
      inspect.exec('DROP TRIGGER fail_meta')
    } else {
      raw = JSON.parse(await readFile(path, 'utf8'))
      raw.settings.apiKey = 'synthetic-legacy-secret'
      raw.settings.futureSetting = 123
      raw.projects[1].futureMetadata = { keep: true }
      raw.chapters[0].futureMetadata = [3, 2, 1]
      await writeFile(path, '\uFEFF' + JSON.stringify(raw))
    }
    const latest = await storage.loadSnapshot()
    const sameRevisionAgent = await api.loadAgentRuntimeData(options)
    const queries = []
    const prepare = Database.prototype.prepare
    let saved
    try {
      if (inspect) Database.prototype.prepare = function(sql) {
        if (/\bentities\b/i.test(sql)) queries.push(sql)
        return prepare.call(this, sql)
      }
      saved = await storage.touchProject(id, latest.revision)
    } finally { Database.prototype.prepare = prepare }
    if (inspect) {
      assert(queries.length)
      for (const sql of queries) {
        const plan = inspect.prepare('EXPLAIN QUERY PLAN ' + sql).all(...Array((sql.match(/\?/g) ?? []).length).fill(null))
        assert(plan.some(r => /SEARCH entities .*\(collection=\? AND id=\?\)/.test(r.detail)), JSON.stringify(plan))
        assert(!plan.some(r => /SCAN entities/.test(r.detail)), 'no whole-library entity scan')
      }
    }
    assert.deepEqual(saved.savedCollections, ['projects'])
    assert.notEqual(saved.revision, latest.revision)
    assert.equal(Date.parse(saved.updatedAt) > 0, true)
    await assert.rejects(api.saveAgentRuntimeData(edited, sameRevisionAgent), conflict)
    storage.close?.()
    storage = api.createExistingLibraryStorage(path)
    const reopened = await storage.loadSnapshot()
    assert.equal(reopened.revision, saved.revision)
    assert.deepEqual(reopened.data.chapters, latest.data.chapters)
    assert.deepEqual(ordered(api.projectsByRecentOpen(reopened.data.projects)), [id, firstOrder[0]])
    assert.deepEqual(ordered(api.listProjects(reopened.data)), ordered(api.listProjects(latest.data)), 'Agent edit order is unchanged')
    if (ext === 'sqlite') {
      const row = rows.find(r => r.collection === 'projects' && r.id === id)
      row.json = JSON.stringify({ ...JSON.parse(row.json), lastOpenedAt: saved.updatedAt })
      assert.deepEqual(inspect.prepare('SELECT * FROM entities ORDER BY collection,id').all(), rows,
        'one project payload; all index columns, including updated_at, stay unchanged')
      assert.deepEqual(inspect.prepare('SELECT * FROM app_settings').all(), settings)
      inspect.close(); inspect = undefined
    } else {
      raw.settings.apiKey = ''
      assert.deepEqual(JSON.parse(await readFile(path + '.bak', 'utf8')), raw, 'redacted pre-touch backup')
      raw.projects.find(p => p.id === id).lastOpenedAt = saved.updatedAt
      assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), raw, 'raw fields and document order survive')
    }
    storage.close?.()
    storage = undefined
    console.log('PASS ' + ext + ': actual Agent conflicts in both directions, restart, index order, isolated update')
  }

  // Copies can have identical project IDs and revisions. Bind the request to the displayed library as well.
  globalThis.handlers = new Map()
  let backupChecks = 0, due = false, switchDuringBackup = false, writes = 0, reads = 0
  const first = { getStoragePath: () => 'first', load: async () => { reads++ },
    touchProject: async (projectId, revision) => { writes++; return { projectId, revision } } }
  const second = { ...first, getStoragePath: () => 'copy' }
  let current = second
  api.registerDataIpcHandlers({ getStorage: () => current, backupService: {
    async maybeCreateAutomaticBackup(load) {
      backupChecks++
      if (due) await load()
      if (switchDuringBackup) current = second
    }
  } })
  const invoke = (request = {}) => globalThis.handlers.get(api.IPC_CHANNELS.DATA_TOUCH_PROJECT)({}, {
    projectId: id, expectedRevision: 'same-revision', expectedStoragePath: 'first', ...request })
  assert.equal((await invoke()).code, conflict.code)
  assert.equal(backupChecks, 0)
  current = first
  assert.equal((await invoke({ expectedRevision: undefined })).code, conflict.code)
  assert.equal((await invoke({ projectId: ' ' })).ok, false)
  assert.equal(backupChecks, 0)
  assert.deepEqual(await invoke(), { projectId: id, revision: 'same-revision' })
  assert.equal(reads, 0)
  due = true
  await invoke()
  assert.equal(reads, 1)
  switchDuringBackup = true
  assert.equal((await invoke()).ok, false)
  assert.equal(writes, 2)
  console.log('PASS IPC: library identity including equal revisions, due/non-due backup and switch during backup')
} finally {
  inspect?.close()
  storage?.close?.()
  delete globalThis.handlers
  assert.equal(dirname(work), parent)
  await rm(work, { recursive: true, force: true })
}

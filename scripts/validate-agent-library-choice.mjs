import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const tmp = join(repoRoot, 'tmp')
await mkdir(tmp, { recursive: true })
const work = await mkdtemp(join(tmp, 'agent-library-choice-'))
const profile = join(work, 'profile'), books = join(work, 'books')
const config = join(profile, 'app-config.json')
const json = join(books, 'selected.JSON'), sqlite = join(books, 'novel-director-data.sqlite')
const legacy = join(books, 'novel-director-data.json')
const opts = { userDataPath: profile }, projectId = 'same-project'
const select = (storagePath, explicitJson) => writeFile(config, JSON.stringify({ storagePath, explicitJson }))
const digest = async path => createHash('sha256').update(await readFile(path)).digest('hex')
async function fingerprint(dir) {
  const result = {}
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    result[entry.name] = entry.isDirectory() ? await fingerprint(path) : await digest(path)
  }
  return result
}

const buildOpts = { absWorkingDir: repoRoot, bundle: true, platform: 'node', target: 'node22', format: 'esm',
  external: ['electron', 'better-sqlite3'], logLevel: 'silent' }
const noNetwork = "globalThis.fetch = () => { throw new Error('Network disabled for this test') }"
const fetchBefore = globalThis.fetch
function invoke(entry, args, input = '') {
  const child = spawnSync(process.execPath, [join(work, entry + '.mjs'), ...args], {
    cwd: work, encoding: 'utf8', input, timeout: 20000, windowsHide: true,
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH,
      HOME: work, USERPROFILE: work, APPDATA: work, LOCALAPPDATA: work, XDG_CONFIG_HOME: work }
  })
  assert.ifError(child.error)
  assert.equal(child.status, 0, child.stderr || child.stdout)
  return JSON.parse(child.stdout)
}
function mcp(name, args) {
  return invoke('mcp', [], JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name, arguments: { ...opts, ...args } } }) + '\n')
}

const titleEdit = { projectId, operationId: 'rename', prefixMode: 'manual', edits: [{ chapterId: 'ch', title: 'Renamed' }] }
const reads = [
  ['agent.listProjects', {}], ['agent.getChapterText', { projectId, chapterOrder: 1, detail: 'full' }],
  ['agent.getBookProgress', { projectId }], ['agent.getBookContinuityReport', { projectId }],
  ['agent.getProjectUsage', { projectId }], ['agent.getChapterTitleHistory', { projectId }],
  ['agent.previewChapterTitleRename', titleEdit]
]
const start = ['agent.startAgentRun', { projectId, chapterOrder: 2, goal: 'Prepare only' }]

try {
  globalThis.fetch = () => { throw new Error('Network disabled for this test') }
  await mkdir(profile); await mkdir(books)
  await build({ ...buildOpts, stdin: { resolveDir: repoRoot, contents: [
    "export * from './src/agent/AgentRuntime'", "export { AgentToolService } from './src/agent/tools/AgentToolService'",
    "export { normalizeAppData } from './src/shared/defaults'", "export { SqliteStorageService } from './src/storage/SqliteStorageService'"
  ].join('\n') }, outfile: join(work, 'api.mjs') })
  await build({ ...buildOpts, entryPoints: { cli: 'src/agent/cli.ts', mcp: 'src/agent/mcp/server.ts' },
    outdir: work, outExtension: { '.js': '.mjs' }, banner: { js: noNetwork } })
  const apiUrl = pathToFileURL(join(work, 'api.mjs')).href
  const api = await import(apiUrl)
  const fixture = label => api.normalizeAppData({ projects: [{ id: projectId, name: label }],
    chapters: [{ id: 'ch', projectId, order: 1, title: label, body: label + ' prose.' }] })
  const call = (name, args) => api.AgentToolService.callTool({ name, arguments: { ...opts, ...args } })
  const database = new api.SqliteStorageService(sqlite)
  try { await database.save(fixture('SQLite book')) } finally { database.close() }
  const db = new Database(sqlite, { fileMustExist: true })
  try { db.pragma('journal_mode = DELETE') } finally { db.close() }
  await writeFile(json, JSON.stringify(fixture('JSON book')))
  await writeFile(legacy, JSON.stringify(fixture('Old default JSON')))
  await select(json, true)
  const selectedConfig = await digest(config), neighbors = [await digest(sqlite), await digest(legacy)]
  const beforeReads = await fingerprint(books)
  const oldJson = await api.loadAgentRuntimeData(opts)
  assert.equal(oldJson.data.projects[0].name, 'JSON book')
  for (const [name, args] of reads) {
    const reply = await call(name, args)
    assert.deepEqual(reply.storage, { ...opts, storagePath: json, source: 'json', revision: oldJson.revision }, name)
    if (name === 'agent.listProjects') assert.equal(reply.data[0].name, 'JSON book')
    if (name === 'agent.getChapterText') assert.equal(reply.data.text, 'JSON book prose.')
    if (name === 'agent.previewChapterTitleRename') assert.equal(reply.data.rows[0].oldTitle, 'JSON book')
  }
  assert.deepEqual(await fingerprint(books), beforeReads)
  assert.deepEqual(await readdir(profile), ['app-config.json'])
  const prepared = mcp(...start)
  assert.equal(prepared.result?.isError, false, JSON.stringify(prepared.error))
  assert.equal(prepared.result.structuredContent.storage.storagePath, json)
  assert.equal(JSON.parse(await readFile(json, 'utf8')).agentRuns[0].id, prepared.result.structuredContent.data.agentRun.id)
  await assert.rejects(api.saveAgentRuntimeData(oldJson.data, oldJson), { code: 'STORAGE_REVISION_CONFLICT' })
  assert.deepEqual([await digest(sqlite), await digest(legacy)], neighbors)
  assert.equal(await digest(config), selectedConfig)
  const override = invoke('cli', ['list-projects', '--user-data', profile, '--storage', sqlite])
  assert.equal(override.data[0].name, 'SQLite book')
  assert.equal(override.storage.storagePath, sqlite)
  console.log('PASS selected standalone JSON: full/scoped reads, actual MCP write, revision guard and CLI override')

  const require = createRequire(import.meta.url)
  const nativeModule = require.cache[require.resolve('better-sqlite3')], nativeExport = nativeModule.exports
  try {
    nativeModule.exports = class { constructor() { throw new Error('Test: SQLite binding unavailable') } }
    const unavailable = await import(apiUrl + '?no-native-binding')
    assert.equal((await unavailable.loadAgentRuntimeData(opts)).storagePath, json)
    await select(sqlite)
    const before = await fingerprint(books), beforeConfig = await digest(config)
    await assert.rejects(unavailable.AgentToolService.callTool({ name: 'agent.listProjects', arguments: opts }), /binding unavailable/)
    await assert.rejects(unavailable.saveAgentRuntimeData(oldJson.data, opts), /binding unavailable/)
    assert.deepEqual(await fingerprint(books), before)
    assert.equal(await digest(config), beforeConfig)
  } finally { nativeModule.exports = nativeExport }
  console.log('PASS unavailable native binding cannot redirect a configured SQLite read or write to JSON')

  for (const path of [json, sqlite]) {
    await select(path, path === json ? true : undefined)
    const loaded = await api.loadAgentRuntimeData(opts)
    const moved = join(work, 'disconnected')
    await rename(path, moved)
    const before = await fingerprint(books), beforeConfig = await fingerprint(profile)
    for (const [name, args] of [...reads, start]) {
      await assert.rejects(call(name, args), error => error.message.includes(path), name)
    }
    await assert.rejects(api.reloadAgentRuntimeData(loaded))
    await assert.rejects(api.saveAgentRuntimeData(loaded.data, loaded))
    await assert.rejects(api.saveAgentRuntimeData(loaded.data, opts))
    await assert.rejects(api.saveAgentChapterCommitBundle({}, loaded))
    await assert.rejects(api.saveAgentRevisionCommitBundle({}, loaded))
    await assert.rejects(api.saveAgentCandidateDecision({ actor: { kind: 'agent' } }, loaded))
    assert.deepEqual(await fingerprint(books), before, 'Must not recreate a missing file or touch siblings/sidecars')
    assert.deepEqual(await fingerprint(profile), beforeConfig)
    await rename(moved, path)
    assert.equal((await api.loadAgentRuntimeData(opts)).revision, loaded.revision)
  }
  console.log('PASS missing configured JSON and SQLite, including loss after read and retry on original file')

  await select(json)
  await assert.rejects(call('agent.listProjects', {}), /SQLite/)
  await writeFile(config, '{')
  await assert.rejects(call('agent.listProjects', {}))
  assert.equal((await call('agent.listProjects', { storagePath: json })).data[0].name, 'JSON book')
  assert.equal(await readFile(config, 'utf8'), '{')

  const fresh = join(work, 'unused-profile'), freshOpts = { userDataPath: fresh }
  const empty = await api.loadAgentRuntimeData(freshOpts)
  assert.equal(empty.source, 'empty')
  await assert.rejects(api.saveAgentRuntimeData(empty.data, empty))
  await assert.rejects(readdir(fresh), { code: 'ENOENT' })
  await mkdir(fresh)
  const oldPath = join(fresh, 'novel-director-data.json'), alias = join(fresh, 'novel-director-data.sqlite')
  await writeFile(oldPath, JSON.stringify(fixture('Legacy only')))
  const oldFiles = await fingerprint(fresh)
  for (const args of [freshOpts, { ...freshOpts, storagePath: fresh }, { ...freshOpts, storagePath: alias }]) {
    assert.equal((await call('agent.listProjects', args)).storage.storagePath, oldPath)
  }
  await assert.rejects(call(start[0], { ...start[1], ...freshOpts, storagePath: alias }))
  assert.deepEqual(await fingerprint(fresh), oldFiles)
  await writeFile(join(fresh, 'app-config.json'), JSON.stringify({ storagePath: alias }))
  await assert.rejects(call('agent.listProjects', { ...freshOpts, storagePath: alias }))
  console.log('PASS ambiguous/broken config, empty profile without file creation and read-only legacy CLI alias')

  const partialPath = join(books, 'cli-snapshot.json'), partial = fixture('Old CLI snapshot')
  delete partial.storyBibles
  await writeFile(partialPath, JSON.stringify(partial))
  await select(partialPath, true)
  const beforePartial = await fingerprint(books)
  await assert.rejects(call(...start))
  assert.deepEqual(await fingerprint(books), beforePartial, 'Desktop choice must use the strict writer')
  const direct = { ...opts, storagePath: partialPath }
  const loaded = await api.loadAgentRuntimeData(direct)
  await rename(partialPath, join(work, 'offline-cli-snapshot'))
  await assert.rejects(api.saveAgentRuntimeData(loaded.data, loaded))
  await assert.rejects(readFile(partialPath), { code: 'ENOENT' })
  await writeFile(partialPath, JSON.stringify({ ...partial, projects: [{ id: projectId, name: 'Later edit' }] }))
  await assert.rejects(api.saveAgentRuntimeData(loaded.data, loaded), { code: 'STORAGE_REVISION_CONFLICT' })
  const preparedOld = await call(start[0], { ...start[1], ...direct })
  assert.equal(preparedOld.storage.storagePath, partialPath)
  const upgraded = JSON.parse(await readFile(partialPath, 'utf8'))
  assert.deepEqual(upgraded.storyBibles, [])
  assert.equal(upgraded.projects[0].name, 'Later edit')
  assert.equal(upgraded.agentRuns[0].id, preparedOld.data.agentRun.id)
  assert.deepEqual([await digest(sqlite), await digest(legacy)], neighbors)
  console.log('PASS only an explicitly named, present, revision-matched old CLI JSON snapshot can be upgraded')
} finally {
  globalThis.fetch = fetchBefore
  assert.equal(dirname(work), tmp)
  await rm(work, { recursive: true, force: true, maxRetries: 3 })
}

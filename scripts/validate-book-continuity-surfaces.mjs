import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'
import { auditBook, oldBook, continuitySurfaceFixture, firstQuote, laterQuote, oldQuote, oldCountdown } from './fixtures/book-continuity-surfaces.mjs'

const Database = createRequire(import.meta.url)('better-sqlite3')
const tool = 'agent.getBookContinuityReport'
const base = join(repoRoot, 'tmp')
await mkdir(base, { recursive: true })
const work = await mkdtemp(join(base, 'continuity-surfaces-'))
const buildOptions = { bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['electron', 'better-sqlite3'] }
const networkGuard = "globalThis.fetch = () => { throw new Error('Network disabled for continuity tests') }"
const modules = ['shared/defaults', 'services/BookContinuityService', 'services/DraftDiagnosticBindingService',
  'shared/bookCollectionSelection', 'agent/tools/AgentToolService',
  'storage/SqliteStorageService', 'storage/JsonStorageService']
const projections = []

async function fingerprints(dir) {
  const names = (await readdir(dir, { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name).sort()
  const files = {}
  for (const name of names) files[name] = createHash('sha256').update(await readFile(join(dir, name))).digest('hex')
  return files
}

function invoke(entry, args, input = '') {
  const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, HOME: work, USERPROFILE: work, APPDATA: work, LOCALAPPDATA: work }
  const result = spawnSync(process.execPath, [join(work, entry + '.mjs'), ...args], {
    cwd: work, env, input, encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 2 ** 21
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout.trim()
}

const originalFetch = globalThis.fetch
let networkAttempts = 0
try {
  globalThis.fetch = () => { networkAttempts++; throw new Error('Network disabled for continuity tests') }
  globalThis.auditProjectionCalls = projections
  await build({ ...buildOptions, stdin: { resolveDir: repoRoot, contents: modules.map(m => `export * from './src/${m}'`).join('\n') },
    outfile: join(work, 'api.mjs'), plugins: [{ name: 'observe-real-projections', setup(b) {
      b.onResolve({ filter: /SqliteStorageService$/ }, a => a.importer.endsWith('agentBookProjection.ts')
        ? { path: 'scoped-sqlite', namespace: 'audit-test' } : undefined)
      b.onLoad({ filter: /.*/, namespace: 'audit-test' }, () => ({ resolveDir: repoRoot, contents:
        "import {loadSqliteCollectionsReadonly as read} from './src/storage/SqliteStorageService';" +
        'export function loadSqliteCollectionsReadonly(path,keys,selector) { globalThis.auditProjectionCalls.push({keys,selector}); return read(path,keys,selector) }'
      }))
    } }] })
  await build({ ...buildOptions, entryPoints: { cli: join(repoRoot, 'src/agent/cli.ts'), mcp: join(repoRoot, 'src/agent/mcp/server.ts') },
    outdir: work, outExtension: { '.js': '.mjs' }, banner: { js: networkGuard } })
  const api = await import(pathToFileURL(join(work, 'api.mjs')).href)
  const seed = api.normalizeAppData(continuitySurfaceFixture())
  const definition = api.AgentToolService.listTools().find(t => t.name === tool)
  assert.equal(definition.riskLevel, 'read')
  assert.equal(definition.inputSchema.additionalProperties, false)
  assert.equal(definition.inputSchema.properties.kind.enum.length, 7)
  assert.deepEqual(definition.inputSchema.properties.status.enum, ['conflict', 'needs_evidence', 'open'])
  const run = args => api.AgentToolService.callTool({ name: tool, arguments: args })
  const expected = options => api.buildBookContinuityReport(seed, auditBook, options)
  const onlyConflict = { from: 5, to: 5, kind: 'money', status: 'conflict', limit: 1 }
  const dispute = expected(onlyConflict)
  assert.equal(dispute.total, 1)
  assert.deepEqual(dispute.findings[0].evidence.map(e => [e.chapterId, e.chapterOrder, e.versionId, e.excerpt]), [
    [auditBook + '-2', 2, null, firstQuote], [auditBook + '-5', 5, 'current-v5', laterQuote]
  ])
  for (const e of dispute.findings[0].evidence) {
    assert.equal(e.contentHash, api.draftContentHash(seed.chapters.find(c => c.id === e.chapterId).body))
  }
  const all = expected({ limit: 50 })
  assert(all.counts.conflict && all.counts.open && all.counts.needs_evidence && all.total > 10)
  const select = api.createBookCollectionSelection(auditBook, api.BOOK_CONTINUITY_COLLECTIONS), scoped = select(seed)
  assert.deepEqual(api.buildBookContinuityReport(scoped, auditBook, onlyConflict), dispute)
  assert(scoped.chapters.every(c => c.projectId === auditBook))
  const otherEdit = { ...seed, settings: { ...seed.settings }, chapters: seed.chapters.map(c =>
    c.projectId === oldBook ? { ...c, body: '别书改写。' } : c) }
  assert.equal(select(otherEdit), scoped)
  assert.notEqual(select({ ...otherEdit, chapterVersions: [] }), scoped)
  console.log('PASS project selection, current version and versionless evidence, cross-range chapter IDs and hashes')

  for (const [source, Store] of [['json', api.JsonStorageService], ['sqlite', api.SqliteStorageService]]) {
    const dir = join(work, source), path = join(dir, 'novel-director-data.' + source)
    await mkdir(dir)
    const writeFixture = async data => {
      const store = new Store(path)
      try { await store.save(data) } finally { store.close?.() }
    }
    await writeFixture(seed)
    if (source === 'sqlite') {
      const db = new Database(path, { fileMustExist: true })
      try { db.pragma('journal_mode = DELETE') } finally { db.close() }
    }
    const before = await fingerprints(dir)
    const args = { project: '渡口核对样书', storagePath: path, userDataPath: dir }
    projections.length = 0
    const result = await run({ ...args, ...onlyConflict })
    assert.equal(result.storage.source, source)
    assert.deepEqual(result.data, dispute)
    if (source === 'sqlite') {
      assert.deepEqual(projections.filter(p => p.keys.length > 1), [{ keys: api.BOOK_CONTINUITY_COLLECTIONS, selector: args.project }])
      assert(projections.every(p => p.selector === args.project))
      projections.length = 0
    }
    const sameCutoff = { ...onlyConflict, status: 'open', kind: 'promise' }
    assert.deepEqual((await run({ ...args, ...sameCutoff })).data, expected(sameCutoff))
    if (source === 'sqlite') {
      assert.deepEqual(projections, [{ keys: ['projects'], selector: args.project }])
    }
    const firstPage = (await run(args)).data
    assert.equal(firstPage.limit, 10)
    const secondPage = (await run({ ...args, offset: 10, limit: 10 })).data
    assert.deepEqual([...firstPage.findings, ...secondPage.findings], all.findings.slice(0, 20))
    assert.equal((await run({ ...args, to: 2, status: 'conflict' })).data.total, 0)
    assert.deepEqual((await run({ ...args, offset: 999 })).data.findings, [])
    for (const finding of firstPage.findings) for (const e of finding.evidence) {
      const chapter = seed.chapters.find(c => c.id === e.chapterId && c.projectId === auditBook && !c.archivedAt)
      assert(chapter?.body.includes(e.excerpt)); assert.notEqual(e.excerpt, chapter.body.trim())
      assert.deepEqual(Object.keys(e).sort(), ['chapterId', 'chapterOrder', 'contentHash', 'excerpt', 'versionId'])
    }
    assert.doesNotMatch(JSON.stringify([firstPage, secondPage]), /另一册|归档陷阱|草稿陷阱|旧版陷阱|封存附记|superseded-v5/)
    const old = (await run({ ...args, project: oldBook, kind: 'money', status: 'needs_evidence' })).data
    assert.equal(old.total, 1)
    const evidence = old.findings[0].evidence[0]
    assert.equal(evidence.chapterId, oldBook + '-2'); assert.equal(evidence.versionId, null)
    assert(evidence.excerpt.includes('27文钱') && oldQuote.includes(evidence.excerpt))
    assert(!JSON.stringify(old).includes(oldQuote), 'Even a one-line chapter must not be returned in full')
    const countdown = (await run({ ...args, project: oldBook, kind: 'countdown' })).data
    const timeQuote = countdown.findings[0].evidence[0].excerpt
    assert(timeQuote.includes('137天') && oldCountdown.includes(timeQuote))
    assert(!JSON.stringify(countdown).includes(oldCountdown))
    for (const bad of [{ from: 0 }, { from: 9, to: 5 }, { limit: 51 }, { limit: 1.5 }, { offset: -1 },
      { offset: '0' }, { kind: 'else' }, { status: 'all' }, { includeProse: true }, { project: 'nonexistent' }, { storagePath: 1 }]) {
      await assert.rejects(run({ ...args, ...bad }))
    }
    await assert.rejects(run({ storagePath: path, userDataPath: dir }), /project/i)
    const cli = JSON.parse(invoke('cli', ['book-continuity', '--project-id', auditBook, '--storage', path, '--user-data', dir,
      '--from', '5', '--to', '5', '--kind', 'money', '--status', 'conflict', '--limit', '1']))
    assert.deepEqual(cli.data, dispute)
    const requests = [{ id: 1, method: 'tools/list' }, { id: 2, method: 'tools/call', params: { name: tool, arguments: { ...args, ...onlyConflict } } }]
    const responses = invoke('mcp', [], requests.map(r => JSON.stringify({ jsonrpc: '2.0', ...r })).join('\n') + '\n')
      .split(/\r?\n/).map(s => JSON.parse(s))
    const advertised = responses.find(r => r.id === 1).result.tools.find(t => t.name === tool)
    assert.deepEqual(advertised.inputSchema, definition.inputSchema)
    assert.equal(advertised.annotations.readOnlyHint, true)
    const mcp = responses.find(r => r.id === 2).result
    assert.equal(mcp.isError, false); assert.deepEqual(mcp.structuredContent, result)
    assert.deepEqual(JSON.parse(mcp.content[0].text), result)
    assert.deepEqual(await fingerprints(dir), before, 'Read-only entrypoints must leave files byte-identical')

    await run({ ...args, ...onlyConflict })
    await writeFixture({ ...seed, chapters: seed.chapters.map(c => c.id === auditBook + '-5' ? { ...c, body: '重新核对后删去了该笔记录。' } : c) })
    const revised = await run({ ...args, ...onlyConflict })
    assert.notEqual(revised.storage.revision, result.storage.revision)
    assert.equal(revised.data.total, 0, 'An earlier snapshot must not survive a revision change')
    console.log(`PASS ${source}: actual CLI/MCP, paging and filters, isolated projects, short legacy chapter, revision invalidation, unchanged storage`)
  }
  const nonexistent = join(work, 'empty')
  await mkdir(nonexistent)
  await assert.rejects(run({ storagePath: join(nonexistent, 'missing.sqlite'), userDataPath: nonexistent, projectId: auditBook }), /project/i)
  assert.deepEqual(await readdir(nonexistent), [])
  assert.equal(networkAttempts, 0)
} finally {
  globalThis.fetch = originalFetch
  delete globalThis.auditProjectionCalls
  assert.equal(dirname(work), base)
  await rm(work, { recursive: true, force: true, maxRetries: 4 })
}

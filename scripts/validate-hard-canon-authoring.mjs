import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const tmp = join(repoRoot, 'tmp')
await mkdir(tmp, { recursive: true })
const work = await mkdtemp(join(tmp, 'hard-canon-authoring-'))
const require = createRequire(import.meta.url)
const at = '2026-11-01T09:00:00.000Z'
const literal = { kind: 'literal', mode: 'terms', terms: ['暮纹'], enforcement: 'block' }
const actor = { kind: 'actor_action', actor: '顾迟', characterId: 'c1', aliases: ['阿迟'], actions: ['扣紧'], side: '右',
  objects: ['袖扣'], state: '受伤', effect: 'forbid', enforcement: 'block', fromChapter: 2, toChapter: 5 }
const source = { kind: 'agent_director', reason: '虚构的作者录入验收', requestedAt: at }
let checks = 0
const passed = (name) => { checks++; console.log('PASS ' + name) }

async function bundles() {
  const options = { bundle: true, platform: 'node', format: 'esm', target: 'node22',
    external: ['better-sqlite3', 'electron'], logLevel: 'silent' }
  await build({ ...options, outfile: join(work, 'api.mjs'), stdin: { resolveDir: repoRoot, contents: `
    export { normalizeAppData } from './src/shared/defaults'
    export { parseHardCanonCheck, normalizeHardCanonCheck } from './src/shared/normalizers/hardCanonCheck'
    export { HardCanonPackService } from './src/services/HardCanonPackService'
    export { JsonStorageService } from './src/storage/JsonStorageService'
    export { SqliteStorageService } from './src/storage/SqliteStorageService'
    export { AgentAuthorizationService } from './src/main/services/AgentAuthorizationService'` } })
  await build({ ...options, entryPoints: [join(repoRoot, 'src/agent/mcp/server.ts')], outfile: join(work, 'mcp.mjs'),
    banner: { js: 'globalThis.fetch = () => { throw new Error("Model/network calls forbidden in fixture") }' },
    plugins: [{ name: 'no-model', setup(builder) {
      builder.onResolve({ filter: /AgentPipelineExecutor$/ }, () => ({ path: 'disabled', namespace: 'no-model' }))
      builder.onLoad({ filter: /.*/, namespace: 'no-model' }, () => ({ contents: `
        export function executeAgentChapterPipeline() { throw new Error('Model disabled') }
        export const createHeadlessTransport = executeAgentChapterPipeline;` }))
    } }] })
  await build({ entryPoints: [join(repoRoot, 'scripts/utils/hard-canon-editor-fixture.tsx')], outfile: join(work, 'ui.js'),
    bundle: true, format: 'iife', globalName: 'authorFixture', jsx: 'automatic', loader: { '.png': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"' } })
  await build({ ...options, format: 'cjs', outfile: join(work, 'window.cjs'), stdin: { contents: `
    const {app, BrowserWindow, session} = require('electron');
    app.disableHardwareAcceleration();
    app.whenReady().then(async () => {
      const url = process.argv.find(arg => arg.startsWith('http://127.0.0.1:'));
      session.defaultSession.webRequest.onBeforeRequest((req, done) => done({ cancel: !req.url.startsWith(url + '/') }));
      const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false } });
      await window.loadURL(url + '/');
      const result = await window.webContents.executeJavaScript('authorFixture.verifyDesktop()');
      console.log('DESKTOP_WRITES=' + result.writes);
      app.exit(0);
    }).catch(error => { console.error(error); app.exit(1); });` } })
  return import(pathToFileURL(join(work, 'api.mjs')).href)
}

function item(id, title, overrides = {}) {
  return { id, projectId: 'p1', title, content: '旧版的文字说明。', category: 'world_rule', priority: 'must',
    status: 'active', sourceType: 'manual', sourceId: null, createdAt: at, updatedAt: at, ...overrides }
}
function fixture(api) {
  return api.normalizeAppData({
    projects: ['p1', 'p2'].map((id) => ({ id, name: '合成样书' + id, createdAt: at, updatedAt: at })),
    characters: [{ id: 'c1', projectId: 'p1', name: '顾迟' }, { id: 'c2', projectId: 'p2', name: '顾迟' }],
    hardCanonPacks: [{ id: 'pack-1', projectId: 'p1', items: [
      item('legacy', '旧纸条'), item('bad', '坏条件', { check: { ...literal, maxPerBook: -1 } })
    ] }]
  })
}

function rpc(method, params) {
  const child = spawnSync(process.execPath, [join(work, 'mcp.mjs')], { input: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n',
    windowsHide: true, encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024 })
  assert.ifError(child.error)
  assert.equal(child.status, 0, child.stderr)
  const reply = JSON.parse(child.stdout)
  if (reply.error) throw new Error(reply.error.message)
  return reply.result
}

async function runDesktop(storage, dir) {
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/book') {
        res.setHeader('Cache-Control', 'no-store')
        if (req.method === 'POST') {
          const body = []
          for await (const chunk of req) body.push(chunk)
          await storage.save(JSON.parse(Buffer.concat(body).toString('utf8')))
          res.end('ok')
        } else res.end(JSON.stringify(await storage.load()))
      } else if (req.url === '/ui.js') {
        res.setHeader('Content-Type', 'text/javascript')
        res.end(await readFile(join(work, 'ui.js')))
      } else if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'")
        res.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/ui.js"></script>')
      } else { res.writeHead(404); res.end() }
    } catch (error) { res.writeHead(500); res.end(String(error)) }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const { stdout } = await promisify(execFile)(require('electron'), [join(work, 'window.cjs'),
      '--user-data-dir=' + join(dir, 'ui-profile'), '--disable-background-networking', 'http://127.0.0.1:' + server.address().port],
    { windowsHide: true, timeout: 45000, env })
    assert.match(stdout, /DESKTOP_WRITES=7/)
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
}

function validation(api) {
  const bad = [null, '禁止', [], {}, { ...literal, mode: 'wildcard' }, { ...literal, terms: [] }, { ...literal, terms: ['词', ' '] },
    { ...literal, terms: '词' }, { ...literal, enforcement: undefined }, { ...literal, enforcement: 'hard' }, { ...literal, exceptons: ['专名'] },
    { ...literal, exceptions: [1] }, { ...literal, maxPerBok: 3 }, { ...literal, maxPerBook: '1' }, { ...literal, maxPerBook: -1 },
    { ...literal, maxPerChapter: 1.5 }, { ...literal, maxPerChapter: null }, { ...literal, toChapter: 0 },
    { ...literal, fromChapter: 8, toChapter: 2 }, { ...actor, side: '双' }, { ...actor, actor: ' ' }, { ...actor, actions: [] },
    { ...actor, effect: 'deny' }, { ...actor, aliases: [5] }, { ...actor, state: '' }, { ...actor, objects: null }]
  const data = fixture(api)
  for (const check of bad) {
    assert.throws(() => api.parseHardCanonCheck(check), /check/)
    assert.equal(api.normalizeHardCanonCheck(check), undefined)
    assert.throws(() => api.HardCanonPackService.upsertHardCanonItem(data, item('', '新设定', { check })), /check/)
  }
  const read = api.normalizeAppData({ ...data, hardCanonPacks: [{ ...data.hardCanonPacks[0], items: [
    ...bad.map((check, i) => item('bad-' + i, '原文' + i, { check })), item('status', '坏状态', { check: literal, status: 'unknown' }),
    item('foreign', '错绑角色', { check: { ...actor, characterId: 'c2' } })
  ] }] }).hardCanonPacks[0].items
  assert.ok(read.every((entry) => !Object.hasOwn(entry, 'check') && entry.content === '旧版的文字说明。'))
  assert.deepEqual(api.parseHardCanonCheck({ ...literal, terms: [' 银灯 ', '银灯', '银 灯'] }).terms, ['银灯', '银 灯'])
  assert.deepEqual(api.parseHardCanonCheck({ ...literal, maxPerBook: 2 }), { ...literal, maxPerBook: 2 })
  passed('invalid inputs reject the entire check; old records retain their prose without an executable default')
}

function compare(api) {
  const save = (data, entry) => api.HardCanonPackService.saveAuthoredItem(data, entry)
  const first = save(fixture(api), item('stable', 'HC-01 袖扣', { check: actor, status: 'deprecated', relatedCharacterIds: ['c1'] }))
  const original = structuredClone(first.item)
  const another = { ...original, id: '', priority: 'high', status: 'active', sourceType: 'imported', sourceId: 'new-source' }
  const exact = save(first.data, another)
  assert.equal(exact.reused, true); assert.equal(exact.data, first.data); assert.deepEqual(exact.item, original)
  const variant = save(first.data, { ...another, title: 'HC-02 袖扣' })
  assert.equal(variant.reused, false); assert.deepEqual(variant.duplicates.possible.map((v) => v.id), ['stable'])
  assert.throws(() => save(variant.data, { ...variant.item, title: original.title }), /相同规则已存在.*stable/)
  for (const patch of [{ check: { ...actor, effect: 'allow' } }, { check: { ...actor, side: '左' } },
    { check: { ...actor, state: '清醒' } }, { check: { ...actor, toChapter: 6 } }, { check: { ...actor, enforcement: 'review' } },
    { relatedCharacterIds: [] }, { relatedTimelineEventIds: ['event-1'] }, { check: undefined }]) {
    const distinct = save(first.data, { ...another, ...patch })
    assert.equal(distinct.reused, false); assert.deepEqual(distinct.duplicates, { exact: null, possible: [] })
  }
  const free = save(first.data, item('', '门禁', { content: '铜门不得打开。' }))
  const similar = save(free.data, item('', '铜门', { content: '铜门不可以打开。' }))
  assert.deepEqual(similar.duplicates.possible.map((v) => v.id), [free.item.id]); assert.equal(similar.reused, false)
  const reverse = save(free.data, item('', '门禁', { content: '铜门允许打开。' }))
  assert.deepEqual(reverse.duplicates, { exact: null, possible: [] })
  const foreign = save(free.data, { ...free.item, id: '', projectId: 'p2' })
  assert.equal(foreign.reused, false); assert.equal(foreign.duplicates.possible.length, 0)
  const colliding = { ...free.data, hardCanonPacks: [free.data.hardCanonPacks[0], {
    ...free.data.hardCanonPacks[0], projectId: 'p2', items: [{ ...free.item, projectId: 'p2' }]
  }] }
  for (const scoped of [api.HardCanonPackService.setHardCanonItemStatus(colliding, free.item.id, 'inactive', 'p1'),
    api.HardCanonPackService.removeHardCanonItem(colliding, free.item.id, 'p1')]) {
    assert.deepEqual(scoped.hardCanonPacks[1], colliding.hardCanonPacks[1])
  }
  const limit = save(first.data, item('', '字面规则', { check: { ...literal, terms: ['甲','乙'] } }))
  assert.equal(save(limit.data, { ...limit.item, id: '', check: { ...literal, terms: ['乙','甲','乙'], maxPerChapter: 0 } }).reused, true)
  assert.equal(save(limit.data, { ...limit.item, id: '', check: { ...limit.item.check, maxPerBook: 0 } }).reused, false)
  passed('same rule reuses untouched ID/status/priority/source; scopes, reverse rules and suggestions remain independent')
}

async function roundTrip(api, kind) {
  const dir = await mkdtemp(join(work, kind + '-'))
  const storagePath = join(dir, 'book.' + kind)
  const Store = kind === 'json' ? api.JsonStorageService : api.SqliteStorageService
  const store = new Store(storagePath)
  const paths = { storagePath, userDataPath: dir, projectId: 'p1' }
  const call = (name, args) => {
    const result = rpc('tools/call', { name: 'agent.' + name, arguments: { ...paths, entity: 'hard_canon', ...args } }).structuredContent
    assert.equal(result.storage.source, kind)
    return result.data
  }
  const create = (operationId, patch) => ({ action: 'create', operationId, patch, source })
  const preview = (command) => call('previewWorldAction', command)
  const apply = (command, fp = preview(command).fingerprint) => call('applyWorldAction', { ...command, expectedFingerprint: fp })
  const get = (id) => call('getWorldRecord', { id, detail: 'full' }).record
  const list = () => call('getWorldRecords', { detail: 'full', includeArchived: true }).records
  try {
    const seed = fixture(api)
    seed.hardCanonPacks[0].items.find((entry) => entry.id === 'bad').check = { ...literal, maxPerBook: -1 }
    await store.save(seed)
    const old = list()
    assert.ok(old.every((entry) => !Object.hasOwn(entry, 'check')))
    const text = create('hint', { title: '封笺提示', content: '封笺不得提前拆开。', category: 'world_rule', status: 'inactive' })
    const p = preview(text)
    assert.deepEqual(list(), old)
    assert.throws(() => apply(text, p.fingerprint), /active user grant/)
    const authority = new api.AgentAuthorizationService(dir)
    await authority.grant({ storagePath, projectId: 'p2', actions: ['edit_world'], chapterStart: null, chapterEnd: null })
    assert.throws(() => apply(text, p.fingerprint), /active user grant/)
    const grant = await authority.grant({ storagePath, projectId: 'p1', actions: ['edit_world'], chapterStart: null, chapterEnd: null })
    const hint = apply(text, p.fingerprint)
    assert.equal(hint.audit.authorizationGrantId, grant.id)
    const action = create('actor', { title: '袖扣规则', content: '顾迟的袖扣不可随意改写。', category: 'world_rule', check: actor })
    assert.deepEqual(preview(action).after.check, actor)
    const created = apply(action)
    assert.deepEqual(get(created.id).check, actor)
    for (const check of [{ ...literal, maxPerBook: '2' }, { ...actor, effect: 'other' }, { ...actor, characterId: 'c2' }]) {
      assert.throws(() => preview(create('bad', { ...action.patch, check })), /check\./)
    }
    assert.throws(() => preview({ ...action, source: { ...source, kind: 'ai_detection' } }), /agent_director/)
    passed(kind + ': real MCP wire preserves patch.check, refuses invalid fields and enforces the project grant')

    await runDesktop(store, dir)
    const records = list(), byTitle = (title) => records.find((entry) => entry.title === title)
    const desktop = byTitle('01. 暮纹')
    assert.deepEqual(desktop.check, { ...literal, terms: ['暮纹','暮印'], exceptions: ['暮纹阁'], maxPerBook: 3 })
    assert.deepEqual(byTitle('外文字形').check, { kind: 'literal', mode: 'latin', terms: [], exceptions: ['AQUA-9'], enforcement: 'review' })
    assert.deepEqual(get(created.id).check, { ...actor, aliases: ['阿迟','南窗'], state: '手腕固定', objects: ['袖扣','表带'], effect: 'allow', side: '左', toChapter: 9 })
    assert.deepEqual(get(hint.id), hint.after)
    assert.ok(!Object.hasOwn(get('bad'), 'check'))
    assert.ok(byTitle('02. 暮纹').id !== desktop.id)
    passed(kind + ': actual desktop form saves and edits conditions; independent MCP reload returns every field')

    const patch = { title: desktop.title, content: desktop.content, category: desktop.category, priority: 'medium', check: desktop.check }
    const duplicate = create('reuse-desktop', patch)
    const reused = preview(duplicate)
    assert.equal(reused.changed, false); assert.equal(reused.hardCanonDuplicates.exact.id, desktop.id)
    assert.deepEqual(reused.before, reused.after)
    const applied = apply(duplicate, reused.fingerprint)
    assert.equal(applied.id, desktop.id); assert.equal(applied.changed, false); assert.equal(applied.audit.authorizationGrantId, grant.id)
    assert.deepEqual(get(desktop.id), desktop); assert.deepEqual(list(), records)
    assert.equal(apply(duplicate, reused.fingerprint).replayed, true)
    const nearby = create('different-number', { ...patch, title: '03. 暮纹' })
    assert.deepEqual(new Set(preview(nearby).hardCanonDuplicates.possible.map((v) => v.id)), new Set([desktop.id, byTitle('02. 暮纹').id]))
    const stale = create('race', { ...patch, content: '正文另外核对。', title: '并发录入' })
    const fresh = preview(stale)
    apply({ ...stale, operationId: 'race-winner' })
    assert.throws(() => apply(stale, fresh.fingerprint), /changed since preview/)
    assert.equal(preview(stale).changed, false)
    passed(kind + ': cross-entry reuse is explicit, audited and immutable; changed comparison requires a fresh preview')

    const update = (operationId, patch) => ({ action: 'update', id: desktop.id, operationId, patch, source })
    apply(update('keep-check', { priority: 'high' }))
    assert.deepEqual(get(desktop.id).check, desktop.check)
    apply(update('remove-check', { check: null }))
    assert.equal(Object.hasOwn(get(desktop.id), 'check'), false)
    assert.deepEqual(get(byTitle('02. 暮纹').id).check, desktop.check)
    assert.throws(() => preview(create('bad-null', { ...patch, check: null })), /check/)
    await authority.revoke(grant.id, storagePath, 'p1')
    assert.throws(() => apply(duplicate, reused.fingerprint), /active user grant/)
    passed(kind + ': explicit removal affects only the selected ID; replay still needs an active grant')
  } finally { store.close?.() }
}

try {
  const api = await bundles()
  validation(api); compare(api)
  const defs = rpc('tools/list', {}).tools
  for (const name of ['agent.previewWorldAction', 'agent.applyWorldAction']) {
    const patch = defs.find((d) => d.name === name).inputSchema.properties.patch
    assert.ok(patch['x-worldEditableFieldsByEntity'].hard_canon.fields.includes('check'))
    assert.deepEqual(patch.properties.check.oneOf.slice(0, 2).map((s) => s.properties.kind.const), ['literal','actor_action'])
  }
  await roundTrip(api, 'json')
  await roundTrip(api, 'sqlite')
  console.log('HardCanon authoring passed (' + checks + ' groups; temporary books only).')
} finally { await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }

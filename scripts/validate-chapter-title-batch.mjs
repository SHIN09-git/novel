import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { repoRoot } from './utils/repo-root.mjs'

const packaged = process.argv.includes('--packaged')
const tmp = join(repoRoot, 'tmp')
await mkdir(tmp, { recursive: true })
const dir = await mkdtemp(join(tmp, 'chapter-titles-')), require = createRequire(import.meta.url)
const projectId = 'book-a', at = '2026-01-10T12:00:00.000Z'
const previewTool = 'agent.previewChapterTitleRename', applyTool = 'agent.applyChapterTitleRename', historyTool = 'agent.getChapterTitleHistory'
const ids = Array.from({ length: 32 }, (_, i) => 'c' + (i + 1))
const stem = n => n === 9 ? '说起第七章' : '来信' + n
const prefix = n => n === 7 ? '第七章：　' : n === 9 ? '' : '第 ' + n + ' 章 '
const single = (op, id, title, mode = 'manual') => ({ projectId, operationId: op, prefixMode: mode, edits: [{ chapterId: id, title }] })
const batch = { projectId, operationId: 'first-32', prefixMode: 'strip', edits: ids.map(chapterId => ({ chapterId })).reverse() }
const commitArgs = (cmd, p) => ({ ...cmd, expectedRevision: p.expectedRevision, expectedPreviewHash: p.previewHash })
const testBuild = { bundle: true, platform: 'node', target: 'node22', format: 'esm', external: ['electron', 'better-sqlite3'] }
const mcp = join(dir, 'mcp.mjs')

function fixture() {
  const chapters = ids.map((id, i) => ({ id, projectId, order: i + 1, title: prefix(i + 1) + stem(i + 1),
    body: '虚构正文，不应出现在改名预览中。' + id, summary: '保留字段', createdAt: at, updatedAt: at }))
  return { projects: [projectId, 'book-b'].map(id => ({ id, name: id, createdAt: at, updatedAt: at })),
    chapters: [...chapters, { ...chapters[0], id: 'archived', order: 33, archivedAt: at },
      { ...chapters[0], id: 'foreign', projectId: 'book-b', title: '另一项目的标题' }],
    chapterVersions: [...chapters.map(c => ({ id: 'v-' + c.id, chapterId: c.id, projectId, body: c.body, title: c.title,
      source: 'imported', createdAt: c.order === 7 ? '2098-01-01T00:00:00Z' : at })),
      { id: 'same-body-other-title', chapterId: 'c7', projectId, body: chapters[6].body, title: stem(7), source: 'imported',
        createdAt: '2099-01-01T00:00:00Z' }], generatedChapterDrafts: [{ id: 'draft', projectId, body: '虚构候选正文', title: '不是正式章节' }] }
}

function rpc(method, params) {
  const res = spawnSync(process.execPath, [mcp], { input: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n',
    cwd: dir, timeout: 15000, windowsHide: true, encoding: 'utf8' })
  assert.equal(res.status, 0, res.stderr)
  const reply = JSON.parse(res.stdout.trim())
  assert.ok(!reply.error, JSON.stringify(reply.error))
  return reply.result
}

async function verifyBackend(api, data, format) {
  const home = join(dir, format)
  await mkdir(home)
  const path = join(home, 'novel-director-data.' + format)
  const store = format === 'json' ? new api.JsonStorageService(path) : new api.SqliteStorageService(path)
  const scope = { storagePath: path, projectId }, options = { ...scope, userDataPath: home }
  const call = async (name, args = {}) => (await api.AgentToolService.callTool({ name, arguments: { ...options, ...args } })).data
  const authority = new api.AgentAuthorizationService(home)
  const grant = async (start, end) => authority.grant({ ...scope, chapterStart: start, chapterEnd: end, actions: ['manage_chapters'] })
  const peek = cmd => call(previewTool, cmd), apply = (cmd, p) => call(applyTool, commitArgs(cmd, p))
  try {
    await store.save(data)
    const initial = await store.loadSnapshot(), untouched = await readFile(path)
    const denied = await peek(batch)
    assert.equal(denied.authorization.authorized, false)
    assert.equal(denied.previewHash, null)
    assert.equal(denied.changedCount, 31)
    assert.deepEqual(denied.rows.map(r => [r.chapterOrder, r.oldTitle, r.newTitle]), ids.map((_, i) => [i + 1, prefix(i + 1) + stem(i + 1), stem(i + 1)]))
    assert.doesNotMatch(JSON.stringify(denied), /虚构正文|候选正文|另一项目/)
    await assert.rejects(call(applyTool, { ...commitArgs(batch, denied), expectedPreviewHash: 'fake' }), /grant/)
    await assert.rejects(call(applyTool, { ...commitArgs(batch, denied), confirm: true }), /字段/)
    const g1 = await grant(1, 16), g2 = await grant(17, 32)
    assert.equal((await peek(batch)).authorization.authorized, false, 'two partial grants do not cover one atomic action')
    await authority.revoke(g1.id, path, projectId)
    await authority.revoke(g2.id, path, projectId)
    const g3 = await grant(1, 32)
    const beforeRevoke = await peek(batch)
    await authority.revoke(g3.id, path, projectId)
    await assert.rejects(apply(batch, beforeRevoke), /grant/)
    const active = await grant(1, 32)
    await assert.rejects(apply(batch, beforeRevoke), /预览/)
    const p = await peek(batch)
    assert.equal(p.authorization.actor.authorizationGrantId, active.id)
    assert.equal(p.expectedRevision, initial.revision)
    assert.deepEqual(await readFile(path), untouched, 'read-only preview and denied actions did not change the database file')
    if (format === 'json') assert.ok(!(await readdir(home)).includes('novel-director-data.json.bak'))
    assert.deepEqual(await store.loadSnapshot(), initial)
    for (const cmd of [single('blank', 'c1', '  '), single('empty-stem', 'c1', '第三章', 'strip'),
      single('line', 'c1', '两个\n标题'), single('foreign', 'foreign', '新'), single('archived', 'archived', '新'),
      single('draft', 'draft', '新'), { ...batch, edits: [] }, { ...batch, edits: [batch.edits[0], batch.edits[0]] },
      { ...batch, edits: [{ chapterId: 'c3', body: '越权写正文' }] }]) await assert.rejects(peek(cmd))
    await assert.rejects(call(applyTool, batch), /预览/)
    await assert.rejects(apply({ ...batch, prefixMode: 'keep' }, p), /预览/)

    // Inject a failure after the SQLite writes have begun / before JSON's atomic replacement.
    let native
    if (format === 'sqlite') {
      native = new (require('better-sqlite3'))(path)
      native.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON entities WHEN NEW.collection = 'chapterTitleReceipts' BEGIN SELECT RAISE(ABORT,'injected failure'); END")
    } else await mkdir(path + '.tmp')
    try {
      await assert.rejects(apply(batch, p), format === 'sqlite' ? /injected failure/ : /EISDIR|EPERM|EACCES/)
      assert.deepEqual(await store.loadSnapshot(), initial, 'no partial titles, receipt or revision')
    } finally {
      if (native) { native.exec('DROP TRIGGER reject_receipt'); native.close() }
      else await rm(path + '.tmp', { recursive: true })
    }

    const stdio = rpc('tools/call', { name: previewTool, arguments: { ...options, ...batch } }).structuredContent.data
    assert.equal(stdio.previewHash, p.previewHash, 'the preview is valid across independent MCP processes')
    const saved = rpc('tools/call', { name: applyTool, arguments: { ...options, ...commitArgs(batch, stdio) } }).structuredContent.data
    assert.equal(saved.replayed, false)
    assert.equal(saved.receipt.rows.length, 32)
    assert.deepEqual(saved.savedCollections, ['chapters', 'chapterTitleReceipts'])
    const after = await store.loadSnapshot()
    assert.deepEqual(after.data.chapterTitleReceipts, [saved.receipt])
    // Compare against the original fixture independently of the implementation's patch helper.
    assert.deepEqual(after.data, { ...initial.data, chapters: initial.data.chapters.map(c =>
      ids.includes(c.id) && c.order !== 9 ? { ...c, title: stem(c.order), updatedAt: saved.receipt.createdAt } : c), chapterTitleReceipts: [saved.receipt] })
    for (const id of ids) {
      const chain = d => api.getChapterVersionChain(d, id).map(e => [e.id, e.title, e.body, e.isCurrent])
      assert.deepEqual(chain(after.data), chain(initial.data), 'rename must retain the same current version and historical title')
    }
    const replay = await apply(batch, p)
    assert.deepEqual([replay.replayed, replay.revision, replay.receipt], [true, after.revision, saved.receipt])
    await assert.rejects(apply({ ...batch, edits: batch.edits.slice(1) }, p), /操作标识/)
    await assert.rejects(apply(batch, { ...p, expectedRevision: after.revision }), /操作标识/)
    const cmdA = single('single-A', 'c7', '第七章：　归帆'), cmdB = single('single-B', 'c7', '第七章：　分水')
    const pA = await peek(cmdA), pB = await peek(cmdB)
    const pendingBatch = { ...batch, operationId: 'competing-batch', prefixMode: 'manual',
      edits: ids.map(chapterId => ({ chapterId, title: '另一个批次的' + chapterId })) }
    const stale = await peek(pendingBatch)
    const race = await Promise.allSettled([apply(cmdA, pA), apply(cmdB, pB)])
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1)
    assert.ok(race.some(r => r.status === 'rejected' && r.reason.code === 'STORAGE_REVISION_CONFLICT'))
    const winner = race.find(r => r.status === 'fulfilled').value.receipt.rows[0].newTitle
    const fresh = await store.loadSnapshot()
    await assert.rejects(apply(pendingBatch, stale), { code: 'STORAGE_REVISION_CONFLICT' })
    await assert.rejects(apply(pendingBatch, { ...stale, expectedRevision: fresh.revision }), /预览/)
    assert.deepEqual(await store.loadSnapshot(), fresh)
    assert.equal((await store.load()).chapters.find(c => c.id === 'c7').title, winner)
    const cmd = single('keep', 'c7', '第３２章 新的渡口', 'keep'), keep = await peek(cmd)
    assert.deepEqual(keep.rows, [{ chapterId: 'c7', chapterOrder: 7, oldTitle: winner, newTitle: '第七章：　新的渡口' }])
    const retries = await Promise.all([apply(cmd, keep), apply(cmd, keep)])
    assert.deepEqual(retries.map(r => r.replayed).sort(), [false, true])
    const latest = await store.loadSnapshot()
    assert.equal((await apply(batch, p)).replayed, true)
    assert.deepEqual(await store.loadSnapshot(), latest, 'late replay did not restore an obsolete title')
    const hist = await call(historyTool, { chapterId: 'c7' })
    assert.equal(hist.total, 3)
    assert.deepEqual(hist.receipts.map(r => r.rows[0].newTitle), ['第七章：　新的渡口', winner, stem(7)])
    assert.ok(hist.receipts.every(r => r.rows.length === 1))
    assert.equal((await call(historyTool, { projectId: 'book-b' })).total, 0)
    const noop = single('unchanged', 'c7', '第七章：　新的渡口')
    assert.equal((await peek(noop)).changedCount, 0)
    await assert.rejects(apply(noop, await peek(noop)), /没有变化/)
    await authority.revoke(active.id, path, projectId)
    await assert.rejects(apply(batch, p), /grant/)
    assert.deepEqual(await store.loadSnapshot(), latest)
    console.log('PASS ' + format + ': 32-row read-only preview, atomic rollback, scoped grant/revocation, single-title CAS race, exact replay and immutable body versions')
  } finally { store.close?.() }
}

async function verifyIsolation(api, data) {
  const home = join(dir, 'siblings')
  await mkdir(home)
  const json = join(home, 'novel-director-data.json'), sqlite = join(home, 'novel-director-data.sqlite')
  const database = new api.SqliteStorageService(sqlite)
  await database.save(data); database.close()
  const other = structuredClone(data)
  other.chapters[0].title = '同目录另一份书'
  const local = new api.JsonStorageService(json)
  await local.save(other)
  const args = single('siblings', 'c1', '新名')
  const peek = async path => (await api.AgentToolService.callTool({ name: previewTool,
    arguments: { ...args, storagePath: path, userDataPath: home } })).data
  assert.equal((await peek(json)).rows[0].oldTitle, '同目录另一份书')
  assert.equal((await peek(sqlite)).rows[0].oldTitle, data.chapters[0].title)
  const before = await readdir(home)
  for (const ext of ['sqlite', 'json']) await assert.rejects(peek(join(home, 'missing.' + ext)))
  assert.deepEqual(await readdir(home), before, 'read-only preview must not initialize a missing store')
  await local.save({ ...other, chapters: [...other.chapters, { ...other.chapters[0], order: 999, archivedAt: at }] })
  await assert.rejects(peek(json), /唯一定位/, 'ambiguous imported chapter IDs cannot broaden a bounded grant')
  console.log('PASS explicitly named sibling stores, absent files and ambiguous imported IDs')
}

async function run(api) {
  const data = api.normalizeAppData(fixture())
  const listed = rpc('tools/list', {}).tools
  assert.equal(listed.find(t => t.name === previewTool).annotations.readOnlyHint, true)
  assert.ok(listed.some(t => t.name === applyTool) && listed.some(t => t.name === historyTool))
  for (const format of ['json', 'sqlite']) await verifyBackend(api, data, format)
  await verifyIsolation(api, data)
  if (process.argv.includes('--ui')) await verifyUI(data, api)
}

async function verifyUI(data, api) {
  const { qaRuntimeTarget, prepareTarget, targetIdentity, connectQaSession, writeOfflineQaProfile, verifyQaOffline } =
    await import('./utils/long-novel-ui-runtime.mjs')
  const { launch, cleanup, evaluate, click, button, ready } = await import('./utils/long-novel-ui-driver.mjs')
  const { fill, waitFor } = await import('./utils/qa-agent-authorization-driver.mjs')
  const profile = join(dir, 'desktop-profile'), target = qaRuntimeTarget(repoRoot)
  if (!packaged) {
    const out = join(dir, 'desktop-build')
    await (await import('electron-vite')).build({ root: repoRoot, logLevel: 'error', build: { outDir: out } })
    target.out = out
    target.required = ['main/index.js', 'preload/index.cjs', 'renderer/index.html'].map(f => join(out, f))
  }
  await targetIdentity(repoRoot, target)
  await prepareTarget(repoRoot, target, dir)
  const path = join(profile, 'novel-director-data.sqlite')
  let session, peer, sink
  // Read via the peer so a check cannot refresh the editing window's optimistic revision.
  const snapshot = () => peer ? evaluate(peer.client, 'window.novelDirector.data.load()') : api.loadSqliteSnapshotReadonly(path)
  const d = 'document.querySelector(".chapter-title-dialog")', q = sel => 'document.querySelector(' + JSON.stringify(sel) + ')'
  const edit = q('button[aria-label="更改本章标题"]'), title = q('input[aria-label="第 32 章拟用标题"]')
  const submit = button('确认提交改名', d), view = button('预览改名', d), batchButton = button('批量更改章名')
  const author = api && new api.AgentAuthorizationService(profile)
  const external = async (op, id, newTitle) => {
    if (peer) {
      const command = single(op, id, newTitle)
      await snapshot()
      const preview = await evaluate(peer.client, 'window.novelDirector.data.previewChapterTitleRename(' + JSON.stringify(command) + ')')
      assert.equal(preview.changedCount, 1)
      const commit = { command, expectedRevision: preview.expectedRevision, expectedPreviewHash: preview.previewHash }
      const result = await evaluate(peer.client, 'window.novelDirector.data.applyChapterTitleRename(' + JSON.stringify(commit) + ')')
      assert.equal(result.replayed, false)
      return
    }
    const args = { ...single(op, id, newTitle), userDataPath: profile, storagePath: path }
    const p = (await api.AgentToolService.callTool({ name: previewTool, arguments: args })).data
    await api.AgentToolService.callTool({ name: applyTool, arguments: commitArgs(args, p) })
  }
  try {
    sink = await writeOfflineQaProfile(profile, data)
    session = await launch(target, profile)
    await connectQaSession(target, session, profile)
    const c = session.client, nav = q('.nav-list')
    if (packaged) {
      const peerProfile = join(dir, 'competing-desktop-profile')
      await mkdir(peerProfile)
      await writeFile(join(peerProfile, 'app-config.json'), JSON.stringify({ storagePath: path }), { flag: 'wx' })
      peer = await launch(target, peerProfile)
      await connectQaSession(target, peer, profile) // Same disposable book, independently launched app/profile.
      assert.equal(await evaluate(peer.client, 'window.novelDirector.app.getStoragePath().then(r=>r.defaultStoragePath)'),
        join(peerProfile, 'novel-director-data.sqlite'))
      assert.notEqual(peer.child.pid, session.child.pid)
      assert.notEqual(peer.port, session.port)
      console.log('TITLE_PEERS', JSON.stringify({ profile, port: session.port, peerProfile, peerPort: peer.port }))
      await c.send('Page.bringToFront')
    }
    const project = '[...document.querySelectorAll(".project-row")].find(e => e.textContent.includes("book-a"))'
    await ready(c, project); await click(c, button('进入', project))
    await ready(c, nav)
    await click(c, button('章节', nav)); await ready(c, edit)
    const body = q('textarea.manuscript-textarea'), bodyText = '作者刚输入的独立正文，改名不能替它保存。'
    await fill(c, body, bodyText)
    assert.equal(await evaluate(c, edit + '.disabled && ' + batchButton + '.disabled'), true)
    await ready(c, '!' + edit + '.disabled')
    const initial = await snapshot()
    assert.equal(initial.data.chapters.find(ch => ch.id === 'c32').body, bodyText)
    await click(c, batchButton); await ready(c, d)
    assert.ok(await evaluate(c, submit + '.disabled'))
    await click(c, view); await ready(c, q('.chapter-title-preview tbody'))
    const expectedRows = ids.map((_, i) => [String(i + 1), prefix(i + 1) + stem(i + 1), stem(i + 1)])
    assert.deepEqual(await evaluate(c,
      '[...document.querySelectorAll(".chapter-title-preview tbody tr")].map(r=>[...r.cells].map(cell=>cell.textContent))'), expectedRows)
    assert.match(await evaluate(c, q('.chapter-title-preview') + '.textContent'), /实际改动 31 章/)
    await click(c, q('.chapter-title-preview summary'))
    assert.ok(await evaluate(c, q('.chapter-title-preview details') + '.innerText.includes("允许提交本批改名")'))
    assert.equal(await evaluate(c, q('.chapter-title-preview code') + '.textContent'), initial.revision)
    assert.deepEqual(await snapshot(), initial, 'author preview does not persist anything')
    await click(c, submit); await ready(c, '!' + d)
    const applied = await snapshot()
    assert.equal(applied.data.chapterTitleReceipts.length, 1)
    const [receipt] = applied.data.chapterTitleReceipts
    assert.equal(receipt.actor.kind, 'user')
    assert.deepEqual(receipt.rows.map(r => [String(r.chapterOrder), r.oldTitle, r.newTitle]), expectedRows)
    assert.deepEqual(applied.data.chapters, initial.data.chapters.map(ch => ids.includes(ch.id) && ch.order !== 9
      ? { ...ch, title: stem(ch.order), updatedAt: receipt.createdAt } : ch))
    assert.deepEqual(applied.data.generatedChapterDrafts, initial.data.generatedChapterDrafts)
    await click(c, edit); await ready(c, title)
    await fill(c, title, '不提交的旧输入'); await click(c, view); await ready(c, q('.chapter-title-preview'))
    await fill(c, title, '作者指定的新章名')
    assert.ok(await evaluate(c, submit + '.disabled'))
    await click(c, view); await ready(c, '!' + submit + '.disabled')
    await click(c, submit); await ready(c, '!' + d)
    await click(c, button('版本历史')); await ready(c, q('.chapter-title-history'))
    await click(c, q('.chapter-title-history summary'))
    assert.match(await evaluate(c, q('.chapter-title-history') + '.innerText'), /来信32.*作者指定的新章名/)
    const saved = await snapshot()
    assert.deepEqual(saved.data.chapterVersions, initial.data.chapterVersions)
    assert.equal(saved.data.chapters.find(ch => ch.id === 'c32').body, bodyText)
    await click(c, edit); await ready(c, title)
    await fill(c, title, '桌面过期改名'); await click(c, view); await ready(c, q('.chapter-title-preview'))
    if (author) await author.grant({ projectId, storagePath: path, actions: ['manage_chapters'], chapterStart: 31, chapterEnd: 32 })
    await external('ui-race', 'c32', '并发保留名')
    await click(c, submit); await waitFor(c, '!!' + q('.chapter-title-dialog [role=alert]'))
    assert.ok(await evaluate(c, 'Boolean(' + q('.storage-conflict-notice') + ')'),
      'Missing reload prompt after conflict: ' + await evaluate(c, q('.chapter-title-dialog [role=alert]') + '.textContent'))
    assert.equal((await snapshot()).data.chapterTitleReceipts.length, 3)
    assert.equal((await snapshot()).data.chapters.find(ch => ch.id === 'c32').title, '并发保留名')
    await click(c, button('取消', d))
    await click(c, button('重新加载最新数据')); await click(c, button('重新加载', q('.confirm-dialog')))
    await waitFor(c, '!' + q('.storage-conflict-notice'))
    await ready(c, '!' + edit + '.disabled')
    const reviewButton = '[...document.querySelectorAll("button")].find(b => b.textContent.includes("本章复盘 ("))'
    await click(c, reviewButton)
    const review = q('.chapter-review-panel textarea')
    await ready(c, review)
    await external('ui-form-race', 'c31', '另一章的新标题')
    await fill(c, review, '留在表单里的未保存复盘')
    await waitFor(c, '!!' + q('.storage-conflict-notice'))
    assert.ok(await evaluate(c, edit + '.disabled && ' + batchButton + '.disabled'))
    assert.equal(await evaluate(c, review + '.value'), '留在表单里的未保存复盘')
    assert.equal((await snapshot()).data.chapters.find(ch => ch.id === 'c32').summary, '保留字段')
    for (const running of [session, peer].filter(Boolean)) await verifyQaOffline(running, sink)
    console.log('PASS desktop + SQLite: dirty body guard, 32 exact preview/receipt rows, 31 renames, single rename/history, ' +
      (peer ? 'competing packaged desktop' : 'competing MCP') + ' title preserved, unsaved review retained; no model calls.')
  } finally {
    try {
      const closed = await Promise.all([cleanup(peer), cleanup(session)])
      for (const result of closed.filter(Boolean)) assert.deepEqual(result.remainingProcessIds, [])
      console.log('CLOSED', JSON.stringify(closed.filter(Boolean).map(r => r.remainingProcessIds)))
    } finally {
      await sink?.close()
      if (sink) assert.equal(sink.requests.length, 0)
    }
  }
}

async function runSourceChecks() {
  const { build } = await import('esbuild')
  const file = join(dir, 'domain.mjs')
  const entries = ['shared/defaults', 'storage/JsonStorageService', 'storage/SqliteStorageService', 'agent/tools/AgentToolService',
    'main/services/AgentAuthorizationService', 'services/ChapterVersionChainService']
  await build({ ...testBuild, outfile: file, stdin: { resolveDir: repoRoot, contents: entries.map(m => `export * from './src/${m}'`).join('\n') } })
  await build({ ...testBuild, outfile: mcp, entryPoints: [join(repoRoot, 'src/agent/mcp/server.ts')] })
  await run(await import(pathToFileURL(file)))
}

try {
  if (packaged) await verifyUI(fixture())
  else await runSourceChecks()
} finally {
  assert.equal(dirname(await realpath(dir)), await realpath(tmp))
  await rm(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 120 })
}

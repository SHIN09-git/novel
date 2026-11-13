#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { gzipSync } from 'node:zlib'
import { repoRoot } from './utils/repo-root.mjs'
import { button, click, closeElectron, fill, waitFor } from './utils/qa-agent-authorization-driver.mjs'
import { connect, evaluate, launch, sha256, within } from './utils/long-novel-ui-driver.mjs'
import { acceptedBody, books, digest, draftId, revisedBody, seed, signature, tag, waitJob, waitStep } from './fixtures/library-recovery.mjs'

const options = { preview20: { type: 'string' }, candidate: { type: 'string' }, fixture: { type: 'string' }, group: { type: 'string' },
  'publish-fixture': { type: 'boolean' } }
const { values, positionals } = parseArgs({ options, allowPositionals: true })
const [phase, previousRun] = positionals
if (phase === 'clean-native') assert(positionals.length === 2 && !Object.keys(values).length)
else {
  assert(positionals.length === 1 && ['s0', 's1'].includes(phase), 'Expected s0 [--preview20 <dir>] or s1 --candidate <dir> [--fixture <S0 fixture dir>]')
  assert(phase === 's0' ? !values.candidate && !(values.fixture && values['publish-fixture']) : values.candidate && !values.preview20 && !values['publish-fixture'])
}
assert(!values.group || phase === 's1' && ['retry', 'explicit'].includes(values.group))
assert.equal(process.platform, 'win32')
const publicDir = resolve(values.preview20 ?? join(repoRoot, 'release', 'win-unpacked'))
const publicAsar = 'ee65587c7164fae65824446c691f9998c2841203fe4bb36378439df766d63ba5'
const publicNative = 'fd54166b0bc9655d8dad4c6f5d39fc62dad48f2f4c3b2aa93edb8531737385c6'
const publicExe = 'f632a57f512ccd47fca3eb687456ede06575b9f0f867aa76a158e77306bfd875'
const sqliteRoot = join('resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3')
const portable = join(repoRoot, 'scripts', 'fixtures', 'library-preview20')
const tmp = join(repoRoot, 'tmp'), dbName = 'novel-director-data.sqlite', jsonName = 'novel-director-data.json'
const j = JSON.stringify, now = () => new Date().toISOString()
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const save = (path, data) => writeFile(path, j(data, null, 2) + '\n', 'utf8')
const copyNew = (a, b) => copyFile(a, b, constants.COPYFILE_EXCL)
const exists = p => stat(p).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e })
const q = selector => 'document.querySelector(' + j(selector) + ')'
const api = 'window.novelDirector', loadData = api + '.data.load()'
const btn = (label, scope) => '[...document.querySelectorAll(' + j(scope ? scope + ' button' : 'button') +
  ')].find(b=>b.textContent.trim()===' + j(label) + ')'
const until = (c, expr) => waitFor(c, '(async()=>Boolean(await (' + expr + ')))()', 20000)
const press = async (c, element) => {
  await until(c, '(' + element + ')?.disabled === false')
  await click(c, element)
}
const call = (c, expr) => evaluate(c, api + '.' + expr)
const view = c => evaluate(c, 'document.body.innerText')
const row = name => '[...document.querySelectorAll(".project-row")].find(r=>r.innerText.includes(' + j(name) + '))'

await mkdir(tmp, { recursive: true })
assert.equal(await realpath(tmp), tmp)
if (phase === 'clean-native') {
  const run = resolve(previousRun)
  await checkedRun(run)
  const prior = await json(join(run, 'report.json'))
  assert(prior.finishedAt && ['passed', 'failed'].includes(prior.status), 'Refusing a run without a final report')
  const receipt = await cleanNativeCopy(run, prior)
  console.log(receipt ? 'Removed private runtime: ' + receipt.path : 'No private runtime to remove')
  process.exit(0)
}
const work = await mkdtemp(join(tmp, 'library-' + phase + '-'))
assert.equal(await realpath(work), work)
console.log('Evidence: ' + work)
const report = { phase, group: values.group ?? 'all', status: 'running', startedAt: now(), work, sessions: [], checks: [], modelRequests: [] }
let sink, manifest, fixtureDir

async function target(dir, old) {
  assert.equal(await realpath(dir), dir)
  assert((await stat(dir)).isDirectory(), 'Pass the unpacked package directory, not an executable')
  const executable = join(dir, 'Novel Director.exe'), archive = join(dir, 'resources', 'app.asar')
  const layouts = [join(sqliteRoot, 'build', 'Release', 'better_sqlite3.node'), join(sqliteRoot, 'prebuilds', 'win32-x64.node')]
  const found = []
  for (const path of layouts) if (await exists(join(dir, path))) found.push(path)
  assert.equal(found.length, 1, 'Unknown/ambiguous packaged SQLite binding: ' + found.join(', '))
  const [binding] = found
  for (const path of [executable, archive, join(dir, binding)]) assert.equal(await realpath(path), path)
  const identity = { executable, archive, binding, exeSha256: await sha256(executable),
    asarSha256: await sha256(archive), sqliteSha256: await sha256(join(dir, binding)) }
  if (old) {
    assert.equal(identity.exeSha256, publicExe)
    assert.equal(identity.asarSha256, publicAsar)
    assert.equal(identity.sqliteSha256, publicNative)
    Object.assign(identity, { version: '0.1.6-preview.20', electronVersion: '39.8.10' })
  } else {
    assert.notEqual(identity.asarSha256, publicAsar, 'Candidate is just preview.20')
    const asar = createRequire(import.meta.url)('@electron/asar')
    const packaged = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'))
    assert.equal(packaged.main, 'out/main/index.js')
    identity.version = packaged.version
    const out = join(repoRoot, 'out')
    const fingerprints = {}
    for (const entry of asar.listPackage(archive)) {
      const rel = entry.replaceAll('\\', '/').replace(/^\/+/, '')
      if (!rel.startsWith('out/') || 'files' in asar.statFile(archive, join(...rel.split('/')))) continue
      const local = join(repoRoot, rel)
      const hash = digest(asar.extractFile(archive, join(...rel.split('/'))))
      assert.equal(await sha256(local), hash, 'Packaged file differs from this worktree build: ' + rel)
      fingerprints[rel] = hash
    }
    for (const entry of ['out/main/index.js', 'out/preload/index.cjs', 'out/renderer/index.html']) assert(fingerprints[entry])
    const files = (await readdir(out, { recursive: true, withFileTypes: true })).filter(e => e.isFile())
    assert.equal(Object.keys(fingerprints).length, files.length, 'Packaged out file set differs from the worktree build')
    identity.matchedBuildFiles = files.length
    await save(join(work, 'candidate-build.json'), fingerprints)
  }
  report.target = identity
  return { ...identity, executable, mode: 'packaged', runtimeRoot: dir }
}

async function startSink(port = 0) {
  const server = createServer((req, res) => {
    report.modelRequests.push({ method: req.method, at: now() })
    res.writeHead(503, { Connection: 'close' }).end()
  })
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok) })
  sink = server
  return 'http://127.0.0.1:' + server.address().port + '/v1'
}

async function screen(c, name) {
  const { data } = await c.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(join(work, name + '.png'), Buffer.from(data, 'base64'))
  await writeFile(join(work, name + '.txt'), await view(c), 'utf8')
}

async function profile(name, configured = true) {
  const dir = join(work, name), user = join(dir, 'user'), library = join(dir, 'volume', dbName)
  await mkdir(user, { recursive: true })
  assert.equal(await realpath(user), user)
  const result = { dir, user, library, defaultDb: join(user, dbName), config: join(user, 'app-config.json') }
  if (configured) {
    await mkdir(dirname(library))
    await copyNew(join(fixtureDir, 'library.sqlite'), library)
    await writeFile(result.config, j({ storagePath: library }, null, 2), { flag: 'wx' })
    assert.equal(await sha256(library), manifest.sqliteSha256)
  }
  return result
}

async function windowRun(t, p, name, test) {
  assert(within(work, p.user) && await realpath(p.user) === p.user)
  if (await exists(p.config)) {
    const config = await json(p.config)
    assert(within(p.dir, resolve(config.storagePath)), 'Refusing profile pointing outside this case')
  }
  const s = await launch(t, p.user)
  const session = { name, userData: p.user, pid: s.child.pid, port: s.port }
  report.sessions.push(session)
  try {
    await connect(s)
    assert(s.processIds.includes(s.child.pid), 'CDP did not connect to the child we started')
    const c = s.client
    await until(c, api + '?.app?.getRuntimeInfo')
    const info = await call(c, 'app.getRuntimeInfo()')
    assert.equal(info.mode, 'packaged')
    assert.equal(resolve(info.execPath), t.executable)
    assert.equal(await evaluate(c, 'location.href'), pathToFileURL(join(t.archive, 'out', 'renderer', 'index.html')).href)
    if (t.version) assert.equal(info.version, t.version)
    if (t.electronVersion) assert.equal(info.electronVersion, t.electronVersion)
    session.runtime = info
    await test(c, session)
    assert.equal(await call(c, 'ai.getCallProgress({})'), null)
    assert.deepEqual(s.networkRequests, [])
    assert.deepEqual(s.exceptions.map(e => e.exception?.description ?? e.text), [])
  } catch (e) {
    session.error = e.message
    if (s.client) await screen(s.client, name + '-failure').catch(() => {})
    throw e
  } finally {
    if (!s.browser && s.child.pid && s.child.exitCode === null) {
      await promisify(execFile)('taskkill.exe', ['/PID', String(s.child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {})
    }
    if (s.browser?.socket.readyState === WebSocket.OPEN) {
      const current = await s.browser.send('SystemInfo.getProcessInfo').catch(() => null)
      if (current) s.processIds = [...new Set([...s.processIds, ...current.processInfo.map(p => p.id)])]
    }
    const exited = s.child.exitCode === null && s.child.signalCode === null && s.child.pid ? once(s.child, 'exit') : null
    session.closed = await closeElectron(s.child, s.client, s.browser, s.processIds)
    if (exited) await exited
    session.exitCode = s.child.exitCode
    session.networkRequests = s.networkRequests
    await writeFile(join(work, name + '.log'), s.logs.join(''), 'utf8')
    assert.deepEqual(session.closed.remainingProcessIds, [])
    if (!session.error) assert.equal(session.exitCode, 0, 'Electron did not exit cleanly')
    assert.deepEqual(report.modelRequests, [])
    await save(join(work, 'report.json'), report)
  }
}

async function expectPath(c, p, path) {
  const paths = await call(c, 'app.getStoragePath()')
  assert.equal(paths.defaultStoragePath, p.defaultDb)
  assert.equal(paths.storagePath, path)
}

async function openProject(c, book) {
  await until(c, row(book.name))
  await press(c, button('进入', '(' + row(book.name) + ')'))
  await until(c, q('.dashboard-view'))
}

async function healthy(c, p, path, expected = manifest.signature) {
  await until(c, 'document.querySelectorAll(".project-row").length === 2')
  for (const book of books) assert(await evaluate(c, 'Boolean(' + row(book.name) + ')'))
  await expectPath(c, p, path)
  const loaded = await evaluate(c, loadData)
  assert.equal(loaded.storagePath, path)
  assert.deepEqual(signature(loaded.data), expected)
  assert.equal(loaded.data.settings.baseUrl, manifest.baseUrl)
  assert(!loaded.data.settings.hasApiKey && !loaded.data.settings.apiKey)
  return { storagePath: path, storageRevision: loaded.revision, signature: signature(loaded.data) }
}

async function createFixture(t, baseUrl) {
  const p = await profile('author', false)
  fixtureDir = join(work, 'fixture')
  await mkdir(fixtureDir)
  const data = seed(baseUrl)
  let backup
  await windowRun(t, p, 'author', async (c, session) => {
    await until(c, q('.home-empty'))
    await expectPath(c, p, p.defaultDb)
    const empty = await evaluate(c, loadData)
    assert.equal(empty.data.projects.length, 0)
    assert(!empty.data.settings.hasApiKey && !empty.data.settings.apiKey)
    const saved = await call(c, 'data.save(' + j({ ...empty.data, ...data, settings: { ...empty.data.settings, ...data.settings } }) + ')')
    assert(saved.ok && saved.storagePath === p.defaultDb)
    await c.send('Page.reload', { ignoreCache: true })
    await openProject(c, books[0])
    await press(c, btn('生产流水线', '.sidebar'))
    await press(c, btn('草稿', '.pipeline-artifact-tabs'))
    await until(c, q('.pipeline-draft-body') + '?.value === ' + j(acceptedBody))
    await press(c, btn('未完成审稿，直接采纳', '.pipeline-draft-actions'))
    await press(c, btn('确认未审稿采纳', '.confirm-dialog'))
    await until(c, loadData + '.then(r=>r.data.chapterCommitBundles.length===1)')
    const accepted = (await evaluate(c, loadData)).data
    assert.equal(accepted.chapterVersions.length, 1)
    assert.equal(accepted.revisionCommitBundles.length, 0)
    assert.equal(accepted.chapterCommitBundles[0].generatedDraftId, draftId)
    assert.equal(accepted.chapters[0].body, acceptedBody)
    session.afterAccept = { draftId, sha256: digest(accepted.chapters[0].body), version: accepted.chapterVersions[0].id }
    await press(c, btn('章节', '.sidebar'))
    await press(c, btn('连贯阅读'))
    await press(c, btn('编辑本章'))
    await fill(c, q('.reader-inline-editor textarea'), revisedBody)
    await press(c, btn('保存本章'))
    await until(c, q('.reader-message') + '?.innerText.includes("已保存本章正文")')
    const read = await evaluate(c, loadData)
    const expected = signature(read.data)
    await screen(c, 'formal-revision')
    const moved = await call(c, 'app.migrateStoragePath(' + j(p.library) + ',' + j(read.data) + ')')
    assert(moved.ok, j(moved))
    await expectPath(c, p, p.library)
    assert.equal((await json(p.config)).storagePath, p.library)
    const manual = await call(c, 'backup.create()')
    backup = manual.backupPath
    assert(backup && within(join(p.user, 'backups'), backup) && await realpath(backup) === backup)
    assert.deepEqual(signature(await json(backup)), expected)
    manifest = { format: tag, version: t.version, appAsarSha256: t.asarSha256, baseUrl, signature: expected }
  })
  await windowRun(t, p, 'cold-preview20', async (c, s) => {
    s.readback = await healthy(c, p, p.library)
    await screen(c, 'cold-preview20')
  })
  assert(!await exists(p.library + '-wal') || (await stat(p.library + '-wal')).size === 0, 'Uncheckpointed WAL')
  await copyNew(p.library, join(fixtureDir, 'library.sqlite'))
  await copyNew(backup, join(fixtureDir, 'backup.json'))
  manifest.sqliteSha256 = await sha256(p.library)
  manifest.backupSha256 = await sha256(backup)
  await save(join(fixtureDir, 'manifest.json'), manifest)
  report.fixture = manifest
}

async function verifyFixture(dir) {
  assert.equal(await realpath(dir), dir)
  for (const f of ['manifest.json', 'backup.json', 'library.sqlite']) assert.equal(await realpath(join(dir, f)), join(dir, f))
  const m = await json(join(dir, 'manifest.json'))
  assert.equal(m.format, tag)
  assert.equal(m.version, '0.1.6-preview.20')
  assert.equal(m.appAsarSha256, publicAsar)
  assert.equal(await sha256(join(dir, 'library.sqlite')), m.sqliteSha256)
  assert.equal(await sha256(join(dir, 'backup.json')), m.backupSha256)
  assert.match(m.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/)
  const backup = await json(join(dir, 'backup.json'))
  assert.deepEqual(signature(backup), m.signature)
  assert(!backup.settings.apiKey && !backup.settings.hasApiKey)
  for (const model of [backup.settings, ...Object.values(backup.settings.pipelineModelRoles),
    ...backup.chapterGenerationJobs.flatMap(job => [job.aiRunConfig, ...Object.values(job.aiRunConfig.roles)])]) {
    assert.equal(model.baseUrl, m.baseUrl)
    assert.equal(model.apiProvider, 'local')
  }
  for (const name of ['manifest.json', 'backup.json', 'library.sqlite']) {
    const bytes = (await readFile(join(dir, name))).toString('latin1')
    assert(!/\b[A-Za-z]:[\\/]|\/(?:Users|home)\/|"(?:apiKey|api_key)"\s*:\s*"[^"]+"|"hasApiKey"\s*:\s*true/i.test(bytes),
      'Machine path or populated credential field in portable ' + name)
  }
  if (!report.portableReadback) {
    // Some SQLite builds create WAL sidecars even on read-only open. Never open
    // the distributed file itself; inspect a separate copy containing no sidecars.
    const copy = join(work, 'readonly-copy.sqlite')
    await copyNew(join(dir, 'library.sqlite'), copy)
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(copy, { readOnly: true })
    try {
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
      const rows = db.prepare('SELECT collection,id,json FROM entities ORDER BY collection,id').all()
      const arrays = Object.entries(backup).filter(([, list]) => Array.isArray(list))
      assert.equal(rows.length, arrays.reduce((n, [, list]) => n + list.length, 0))
      for (const row of rows) {
        const entity = backup[row.collection]?.find(item => (item.id ?? item.projectId) === row.id)
        assert.deepEqual(JSON.parse(row.json), entity, 'Different backup entity: ' + row.collection + '/' + row.id)
      }
      const settings = db.prepare('SELECT json FROM app_settings').all()
      assert.equal(settings.length, 1)
      assert.deepEqual(JSON.parse(settings[0].json), backup.settings)
      assert.equal(Number(db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get().value), backup.schemaVersion)
      report.portableReadback = { integrity: 'ok', matchedEntityRows: rows.length, matchedSettings: true,
        schemaVersion: backup.schemaVersion, revision: db.prepare("SELECT value FROM meta WHERE key='revision'").get().value }
    } finally { db.close() }
  }
  return m
}

async function proveResume(t) {
  const p = await profile('resume-copy')
  await windowRun(t, p, 'resume', async (c, s) => {
    await healthy(c, p, p.library)
    await openProject(c, books[1])
    await press(c, btn('生产流水线', '.sidebar'))
    await press(c, btn('重试失败步骤', '.pipeline-top-status-inner'))
    await until(c, loadData + '.then(r=>r.data.chapterGenerationJobs.find(x=>x.id===' + j(waitJob) + ')?.status==="completed")')
    const { data } = await evaluate(c, loadData)
    const job = data.chapterGenerationJobs.find(x => x.id === waitJob)
    const step = data.chapterGenerationSteps.find(x => x.id === manifest.signature.unfinished.stepId)
    assert.equal(job.currentStep, waitStep)
    assert.equal(step.status, 'completed')
    assert.equal(data.chapterGenerationJobs.length, 2)
    assert.equal(data.generatedChapterDrafts.length, 2)
    const checkpoint = data.chapterGenerationSteps.find(x => x.jobId === waitJob && x.type === 'generate_chapter_draft')
    assert.equal(digest(checkpoint.output), manifest.signature.unfinished.checkpointSha256)
    assert.equal(data.chapterCommitBundles.length, 1)
    assert.equal(data.revisionCommitBundles.length, 1)
    s.resumed = { jobId: job.id, status: job.status, stepId: step.id, output: step.output, checkpointSha256: digest(checkpoint.output) }
    await screen(c, 'resume-completed')
  })
}

async function inventory(p) {
  async function files(dir, filter = () => true) {
    if (!await exists(dir)) return null
    const found = {}
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (!filter(e.name)) continue
      assert(!e.isSymbolicLink())
      found[e.name] = e.isFile() ? await sha256(join(dir, e.name)) : await files(join(dir, e.name))
    }
    return found
  }
  return { configuredPath: (await json(p.config)).storagePath,
    profile: await files(p.user, n => /^(novel-director-data|app-config)(\.|-)/.test(n)),
    backups: await files(join(p.user, 'backups')) ?? {},
    volume: await files(dirname(p.library)), parked: await files(join(p.dir, 'parked')) }
}

async function fault(name, caseName = name) {
  const p = await profile(caseName)
  const parked = join(p.dir, 'parked'), volume = dirname(p.library)
  const neighbor = join(volume, jsonName)
  if (name !== 'corrupt-alone') await writeFile(neighbor, j({ schemaVersion: 3, projects: [], chapters: [], storyBibles: [],
    settings: { ...seed(manifest.baseUrl).settings, modelName: 's0-sibling-never-choose' } }), { flag: 'wx' })
  if (name === 'missing-volume') await rename(volume, parked)
  else if (name !== 'native') {
    await mkdir(parked)
    await rename(p.library, join(parked, dbName))
    if (name.startsWith('corrupt')) await writeFile(p.library, 'Not a database: synthetic damage only.\n', { flag: 'wx' })
  }
  return p
}

async function observeOld(t, name) {
  const p = await fault(name), entry = { name, before: await inventory(p) }
  report.checks.push(entry)
  await windowRun(t, p, 'old-' + name, async (c, s) => {
    await until(c, q('.home-empty'))
    await expectPath(c, p, p.library)
    entry.ui = await view(c)
    assert.match(entry.ui, /0 个项目/)
    assert.match(entry.ui, /还没有小说项目/)
    assert(await evaluate(c, '(' + btn('新建项目') + ')?.disabled === false'))
    await screen(c, 'old-' + name)
    try { const r = await evaluate(c, loadData); s.load = { projects: r.data.projects.length, path: r.storagePath } }
    catch (e) { s.load = { error: e.message } }
    if (name === 'corrupt-alone') assert(s.load.error)
    else assert.equal(s.load.projects, 0)
  })
  entry.after = await inventory(p)
  assert.equal(entry.after.parked[dbName], manifest.sqliteSha256)
  if (name !== 'corrupt-alone') assert(entry.after.volume[dbName] && entry.before.volume?.[dbName] !== entry.after.volume[dbName])
  entry.status = 'reproduced'
}

const actions = { retry: '重试', choose: '选择已有书库', restore: '从备份恢复到新文件', create: '新建书库' }
const recovery = '.library-recovery'
const feedback = q('.library-recovery-feedback') + '?.innerText'
const recover = (c, action) => press(c, btn(actions[action], recovery))

async function blocked(c, p) {
  await until(c, q(recovery))
  const alert = await evaluate(c, q('.library-recovery-error') + '.innerText')
  assert(alert.includes(p.library), alert)
  assert(alert.replace(p.library, '').trim().length > 8)
  await expectPath(c, p, p.library)
  const controls = await evaluate(c, '[...document.querySelectorAll("button")].filter(b=>b.getClientRects().length && !b.disabled).map(b=>b.textContent.trim())')
  for (const label of Object.values(actions)) assert(controls.includes(label), j(controls))
  assert(!await evaluate(c, 'Boolean(document.querySelector(".home,.project-row,.sidebar,.home-empty"))'))
  // A valid empty payload distinguishes an unavailable library from payload-validation errors.
  const empty = await json(join(fixtureDir, 'backup.json'))
  for (const [k, v] of Object.entries(empty)) if (Array.isArray(v)) empty[k] = []
  const refusal = expr => evaluate(c, expr + '.then(()=>({refused:false}),e=>({refused:true,reason:e.message}))')
  const read = await refusal(loadData), write = await refusal(api + '.data.save(' + j(empty) + ')')
  for (const r of [read, write]) assert(r.refused && r.reason.includes(p.library), j(r))
  return { alert, controls, readRefusal: read.reason, writeRefusal: write.reason }
}

async function withoutBinding(t) {
  const dir = join(work, 'native-package')
  assert(!within(t.runtimeRoot, dir))
  await cp(t.runtimeRoot, dir, { recursive: true, force: false, errorOnExist: true,
    filter: path => relative(t.runtimeRoot, path) !== t.binding })
  const executable = join(dir, 'Novel Director.exe'), archive = join(dir, 'resources', 'app.asar')
  assert.equal(await sha256(executable), t.exeSha256)
  assert.equal(await sha256(archive), t.asarSha256)
  assert(!await exists(join(dir, t.binding)))
  return { ...t, runtimeRoot: dir, executable, archive }
}

async function checkedRun(run) {
  assert.equal(dirname(run), tmp, 'Not a direct child of this worktree tmp')
  assert.match(basename(run), /^library-s1-[a-zA-Z0-9]{6}$/)
  assert.equal(await realpath(run), run, 'Refusing a redirected run directory')
}

async function cleanNativeCopy(run, history) {
  await checkedRun(run)
  assert.equal(history.work, run)
  assert.equal(history.phase, 's1')
  const path = join(run, 'native-package')
  if (!await exists(path)) return null
  assert.equal(await realpath(path), path)
  const supplied = dirname(history.target.executable)
  assert(path !== supplied && !within(path, supplied) && !within(supplied, path))
  assert(history.sessions.every(s => s.closed?.remainingProcessIds?.length === 0 && Number.isInteger(s.exitCode)),
    'Leaving the private package in place: not all owned processes have confirmed exits')
  const command = '$ErrorActionPreference="Stop"; $prefix=$env:NOVEL_QA_PRIVATE_RUNTIME; ' +
    '$p=@(Get-CimInstance Win32_Process -Property ProcessId,ExecutablePath | Where-Object { $_.ExecutablePath -and ' +
    '$_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.ProcessId }); ' +
    'ConvertTo-Json -Compress -InputObject $p'
  const { stdout } = await promisify(execFile)(process.env.NOVEL_QA_PWSH || 'pwsh.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { env: { ...process.env, NOVEL_QA_PRIVATE_RUNTIME: path + '\\' }, windowsHide: true, timeout: 15000 })
  const running = JSON.parse(stdout.trim())
  assert.deepEqual(running, [], 'A process still uses the private package')
  async function sum(dir) {
    let bytes = 0
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name)
      assert(!entry.isSymbolicLink() && within(path, file) && await realpath(file) === file, 'Refusing a redirected package entry')
      if (entry.isDirectory()) bytes += await sum(file)
      else { assert(entry.isFile()); bytes += (await stat(file)).size }
    }
    return bytes
  }
  const bytes = await sum(path), hashes = {}
  for (const file of ['Novel Director.exe', join('resources', 'app.asar'), history.target.binding]) {
    assert(within(path, resolve(path, file)))
    hashes[file] = await exists(join(path, file)) ? await sha256(join(path, file)) : null
  }
  const receipt = { path, bytes, hashes, running, removed: false }
  const receiptPath = join(run, 'native-package-cleanup.json')
  await save(receiptPath, receipt)
  assert.equal(await realpath(path), join(await realpath(run), 'native-package'))
  await rm(path, { recursive: true, maxRetries: 3, retryDelay: 200 })
  assert(!await exists(path))
  Object.assign(receipt, { removed: true, at: now() })
  await save(receiptPath, receipt)
  return receipt
}

async function retryCase(t, name) {
  const p = await fault(name)
  const entry = { name, before: await inventory(p) }
  report.checks.push(entry)
  const runtime = name === 'native' ? await withoutBinding(t) : t
  await windowRun(runtime, p, 'blocked-' + name, async (c, s) => {
    entry.blocked = await blocked(c, p)
    const reason = name === 'native' ? /SQLite|组件|\.node|module/i : name.startsWith('corrupt') ? /损坏|SQLite|格式/i : /找不到|不存在|连接/
    assert.match(entry.blocked.alert, reason)
    await screen(c, 'blocked-' + name)
    await recover(c, 'retry')
    await until(c, feedback + '?.includes("失败")')
    entry.retryWhileUnavailable = await evaluate(c, feedback)
    entry.afterRefusals = await inventory(p)
    assert.deepEqual(entry.afterRefusals, entry.before, 'Unavailable library or its neighbors changed')
    if (name === 'native') {
      await copyNew(join(t.runtimeRoot, t.binding), join(runtime.runtimeRoot, t.binding))
      entry.restoredBinding = { layout: t.binding, sha256: await sha256(join(runtime.runtimeRoot, t.binding)) }
      assert.equal(entry.restoredBinding.sha256, t.sqliteSha256)
    } else if (name === 'missing-volume') {
      await rename(join(p.dir, 'parked'), dirname(p.library))
    } else {
      if (name.startsWith('corrupt')) await rename(p.library, join(p.dir, 'damaged-kept.bin'))
      await rename(join(p.dir, 'parked', dbName), p.library)
    }
    assert.equal(await sha256(p.library), manifest.sqliteSha256)
    await recover(c, 'retry')
    entry.sameProcess = { pid: s.pid, ...await healthy(c, p, p.library) }
    await screen(c, 'retry-ok-' + name)
    assert.equal(await sha256(p.config), entry.before.profile['app-config.json'])
  })
  await windowRun(t, p, 'reopen-' + name, async (c, s) => {
    entry.reopened = { pid: s.pid, ...await healthy(c, p, p.library) }
    assert.notEqual(entry.reopened.pid, entry.sameProcess.pid)
    assert.equal(entry.reopened.storageRevision, entry.sameProcess.storageRevision)
  })
  entry.afterRestart = await inventory(p)
  assert.deepEqual(entry.afterRestart.profile, entry.before.profile)
  const sibling = (name === 'missing-volume' ? entry.before.parked : entry.before.volume)?.[jsonName]
  assert.equal(entry.afterRestart.volume[jsonName], sibling)
  assert.equal(entry.afterRestart.volume[dbName], manifest.sqliteSha256)
  entry.status = 'passed'
}

async function firstOrLegacy(t, legacy) {
  const name = legacy ? 'legacy-migration' : 'first-use', p = await profile(name, false)
  const entry = { name, before: { config: await exists(p.config), database: await exists(p.defaultDb) } }
  report.checks.push(entry)
  assert.deepEqual(entry.before, { config: false, database: false })
  const source = join(p.user, jsonName)
  if (legacy) await copyNew(join(fixtureDir, 'backup.json'), source)
  for (const stage of ['start', 'restart']) await windowRun(t, p, name + '-' + stage, async c => {
    if (legacy) {
      entry[stage] = await healthy(c, p, p.defaultDb)
      const backups = (await readdir(p.user)).filter(f => f.startsWith(jsonName + '.before-sqlite-migrate.'))
      assert.equal(backups.length, 1)
      entry.sourceSha256 = await sha256(source)
      entry.migrationBackupSha256 = await sha256(join(p.user, backups[0]))
      assert.equal(entry.sourceSha256, manifest.backupSha256)
      assert.equal(entry.migrationBackupSha256, manifest.backupSha256)
    } else {
      await until(c, q('.home-empty'))
      assert(!await evaluate(c, 'Boolean(' + q(recovery) + ')'))
      await expectPath(c, p, p.defaultDb)
      const loaded = await evaluate(c, loadData)
      assert.equal(loaded.data.projects.length, 0)
      entry[stage] = { storagePath: loaded.storagePath, storageRevision: loaded.revision, projectCount: 0 }
      assert.equal(loaded.storagePath, p.defaultDb)
      assert(!await exists(source))
    }
    assert.equal((await json(p.config)).storagePath, p.defaultDb)
    if (stage === 'start') await screen(c, name)
  })
  assert.equal(entry.start.storageRevision, entry.restart.storageRevision)
  entry.status = 'passed'
}

// Operate only a named native dialog belonging to this Electron PID. Do not read
// the shell's item list, use foreground keystrokes or substitute dialog return values.
const pickerDriver = String.raw`
$ErrorActionPreference = 'Stop'
$ErrorView = 'NormalView'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationTypes,UIAutomationClient
$a = [Windows.Automation.AutomationElement]
$scope = [Windows.Automation.TreeScope]
$spec = $env:NOVEL_QA_PICKER | ConvertFrom-Json
function prop($p,$v) { [Windows.Automation.PropertyCondition]::new($p,$v) }
$owned = prop $a::ProcessIdProperty ([int]$spec.pid)
$match = [Windows.Automation.AndCondition]::new($owned,(prop $a::NameProperty $spec.title))
$end = [DateTime]::UtcNow.AddSeconds(10)
do {
  $dialog = $a::RootElement.FindFirst($scope::Children,$match)
  if ($dialog) { break }
  Start-Sleep -Milliseconds 70
} while ([DateTime]::UtcNow -lt $end)
if (!$dialog) {
  $names = $a::RootElement.FindAll($scope::Children,$owned) | ForEach-Object { $_.Current.Name }
  throw "Owned dialog missing: $($spec.title); owned windows: $($names -join ', ')"
}
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class QaPicker {
  delegate bool Visitor(IntPtr hwnd, IntPtr unused);
  [DllImport("user32")] static extern bool EnumChildWindows(IntPtr root, Visitor visit, IntPtr unused);
  [DllImport("user32")] static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32")] static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32")] static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder name, int size);
  [DllImport("user32", CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr wp, StringBuilder text);
  [DllImport("user32", CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr wp, string text);
  [DllImport("user32")] static extern bool PostMessage(IntPtr h, int msg, IntPtr wp, IntPtr lp);
  static string Kind(IntPtr h) { var s=new StringBuilder(100); GetClassName(h,s,s.Capacity); return s.ToString(); }
  static bool Owned(IntPtr h,int pid) { int owner; GetWindowThreadProcessId(h,out owner); return owner==pid; }
  static string Label(IntPtr h) { var s=new StringBuilder(256); SendMessage(h,0x000D,(IntPtr)s.Capacity,s); return s.ToString().Replace("&",""); }
  public static void Operate(IntPtr root,int pid,int id,string label,string path) {
    if (!Owned(root,pid) || Kind(root)!="#32770") throw new Exception("Unexpected dialog owner or type");
    var controls=new List<IntPtr>();
    EnumChildWindows(root,(h,x)=>{ if (Owned(h,pid)) controls.Add(h); return true; },IntPtr.Zero);
    var buttons=controls.Where(h=>Kind(h)=="Button" && IsWindowEnabled(h)).ToArray();
    var button=buttons.SingleOrDefault(h=>String.IsNullOrEmpty(label) ? GetDlgCtrlID(h)==id : Label(h)==label);
    if(button==IntPtr.Zero) throw new Exception("No matching native button; IDs: "+String.Join(",",buttons.Select(GetDlgCtrlID)));
    if(!String.IsNullOrEmpty(path)) {
      var edits=controls.Where(h=>Kind(h)=="Edit" && IsWindowEnabled(h)).ToArray();
      var edit=edits.SingleOrDefault(h=>GetDlgCtrlID(h)==1148);
      if(edit==IntPtr.Zero) edit=edits.SingleOrDefault(h=>GetDlgCtrlID(h)==1001);
      if(edit==IntPtr.Zero) throw new Exception("No filename edit; IDs: "+String.Join(",",edits.Select(GetDlgCtrlID)));
      SendMessage(edit,0x000C,IntPtr.Zero,path);
      var actual=new StringBuilder(path.Length+2);
      SendMessage(edit,0x000D,(IntPtr)actual.Capacity,actual);
      if(actual.ToString()!=path) throw new Exception("Filename field did not take the isolated path");
    }
    if(!PostMessage(button,0x00F5,IntPtr.Zero,IntPtr.Zero)) throw new Exception("Native button click failed");
  }
}
'@
[QaPicker]::Operate([IntPtr]$dialog.Current.NativeWindowHandle,[int]$spec.pid,[int]$spec.button,$spec.label,$spec.file)
ConvertTo-Json -Compress @{ title=$spec.title; pid=$spec.pid; file=$spec.file; action=$spec.action; shell=(Get-Process -Id $PID).Path }
`

async function picker(s, p, title, action, file) {
  if (file) {
    assert(within(p.dir, file) && await realpath(dirname(file)) === dirname(file))
    if (await exists(file)) assert.equal(await realpath(file), file)
  }
  const spec = { pid: s.pid, title, action, file,
    label: action === 'confirm-json' ? '使用这个 JSON 书库' : action === 'cancel-json' ? '取消' : null,
    button: action === 'cancel' ? '2' : '1' }
  const { stdout } = await promisify(execFile)(process.env.NOVEL_QA_PWSH || 'pwsh.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(pickerDriver, 'utf16le').toString('base64')],
    { env: { ...process.env, NOVEL_QA_PICKER: j(spec) }, cwd: p.dir, timeout: 19000, windowsHide: true }
  ).catch(e => { throw Error('Native dialog ' + title + ' (' + action + '): ' + (e.stderr?.trim().slice(-1400) || e.code || 'timeout')) })
  s.nativeDialogs ??= []
  s.nativeDialogs.push(JSON.parse(stdout.trim()))
}

async function explicitRecovery(t) {
  const open = '选择已有书库', src = '选择要恢复的 JSON 备份', dest = '将备份恢复到新文件（不覆盖原书库）'
  const independent = '使用独立 JSON 书库'
  for (const mode of ['choose', 'restore', 'restore-gzip', 'explicit-json', 'create']) {
    const p = await fault('corrupt', mode)
    const restore = mode === 'restore' || mode === 'restore-gzip'
    const name = restore ? 'restored.sqlite' : mode === 'explicit-json' ? 'independent.json' : mode + '.sqlite'
    const alternative = join(p.dir, name), bad = join(p.dir, 'invalid.sqlite')
    const backup = join(p.user, 'backups', mode === 'restore-gzip' ? 'novel-director-100-auto.json.gz' : 'novel-director-100-manual-s0.json')
    if (restore) {
      await mkdir(dirname(backup))
      const fixture = join(fixtureDir, 'backup.json')
      if (mode === 'restore-gzip') await writeFile(backup, gzipSync(await readFile(fixture)), { flag: 'wx' })
      else await copyNew(fixture, backup)
    } else if (mode !== 'create') await copyNew(join(fixtureDir, mode === 'choose' ? 'library.sqlite' : 'backup.json'), alternative)
    if (mode === 'choose') await writeFile(bad, 'Invalid synthetic library.\n', { flag: 'wx' })
    const entry = { name: mode, before: await inventory(p) }
    report.checks.push(entry)
    async function verifyChosen(c) {
      await expectPath(c, p, alternative)
      assert.equal((await json(p.config)).storagePath, alternative)
      if (mode !== 'create') return healthy(c, p, alternative)
      await until(c, q('.home-empty'))
      const { data, storagePath, revision } = await evaluate(c, loadData)
      assert.equal(data.projects.length, 0)
      assert.equal(storagePath, alternative)
      return { storagePath, storageRevision: revision, projectCount: 0 }
    }
    await windowRun(t, p, 'explicit-' + mode, async (c, s) => {
      entry.blocked = await blocked(c, p)
      const choice = restore ? 'restore' : mode === 'explicit-json' ? 'choose' : mode
      const operate = async cancel => {
        await recover(c, choice)
        if (mode === 'choose') await picker(s, p, open, cancel ? 'cancel' : 'select', cancel ? undefined : alternative)
        if (mode === 'explicit-json') {
          await picker(s, p, open, 'select', alternative)
          await picker(s, p, independent, cancel ? 'cancel-json' : 'confirm-json')
        }
        if (restore) {
          await picker(s, p, src, 'select', backup)
          await picker(s, p, dest, cancel ? 'cancel' : 'save', cancel ? undefined : alternative)
        }
        if (mode === 'create') await picker(s, p, '新建独立书库', cancel ? 'cancel' : 'save', cancel ? undefined : alternative)
      }
      await operate(true)
      await until(c, feedback + '?.includes("取消")')
      entry.cancelFeedback = await evaluate(c, feedback)
      entry.afterCancel = await inventory(p)
      assert.deepEqual(entry.afterCancel, entry.before)
      assert(!await exists(p.defaultDb))
      if (restore || mode === 'create') assert(!await exists(alternative))
      await screen(c, mode + '-cancelled')
      if (mode === 'choose') {
        const badHash = await sha256(bad)
        await recover(c, choice)
        await picker(s, p, open, 'select', bad)
        await until(c, feedback + '?.includes("失败")')
        entry.invalidFeedback = await evaluate(c, feedback)
        assert.deepEqual(await inventory(p), entry.before)
        assert.equal(await sha256(bad), badHash)
        await screen(c, 'choose-invalid')
      }
      await operate(false)
      await until(c, q('.home'))
      entry.chosen = await verifyChosen(c)
      if (mode === 'explicit-json') {
        assert.equal((await json(p.config)).explicitJson, true)
        const saved = await evaluate(c, '(async()=>{const {data}=await ' + loadData + ';data.projects[0].description="s1-json-only";return await ' + api + '.data.save(data)})()')
        assert(saved.ok && saved.storagePath === alternative)
      }
      await screen(c, mode + '-success')
    })
    await windowRun(t, p, mode + '-restart', async c => {
      await until(c, q('.home'))
      entry.reopened = await verifyChosen(c)
      if (mode === 'explicit-json') assert((await evaluate(c, loadData)).data.projects.some(b => b.description === 's1-json-only'))
    })
    entry.afterRestart = await inventory(p)
    assert.deepEqual(entry.afterRestart.volume, entry.before.volume)
    assert.deepEqual(entry.afterRestart.parked, entry.before.parked)
    assert(!await exists(p.defaultDb))
    if (restore) assert.deepEqual(entry.afterRestart.backups, entry.before.backups)
    entry.status = 'passed'
  }
}

async function runS1(t) {
  if (values.group !== 'explicit') {
    for (const name of ['missing-volume', 'missing-file', 'corrupt', 'corrupt-alone', 'native']) await retryCase(t, name)
    await firstOrLegacy(t, false)
    await firstOrLegacy(t, true)
    await proveResume(t)
  }
  if (values.group !== 'retry') await explicitRecovery(t)
}

async function useFixture() {
  fixtureDir = resolve(values.fixture ?? portable)
  assert(fixtureDir === portable || /^library-s0-[A-Za-z0-9]+[\\/]fixture$/.test(relative(tmp, fixtureDir)),
    'Use only the supplied fixture or the fixture directory from an isolated S0 run')
  manifest = await verifyFixture(fixtureDir)
  report.fixture = manifest
  assert.equal(await startSink(Number(new URL(manifest.baseUrl).port)), manifest.baseUrl)
}

try {
  if (phase === 's0') {
    const t = await target(publicDir, true)
    if (values.fixture) await useFixture()
    else await createFixture(t, await startSink())
    await verifyFixture(fixtureDir)
    await proveResume(t)
    for (const name of ['missing-volume', 'missing-file', 'corrupt', 'corrupt-alone']) await observeOld(t, name)
    if (values['publish-fixture']) {
      assert.equal(await realpath(dirname(portable)), dirname(portable))
      await mkdir(portable, { recursive: true })
      for (const f of ['library.sqlite', 'backup.json', 'manifest.json']) assert(!await exists(join(portable, f)), 'Refusing to replace the shared fixture')
      for (const f of ['library.sqlite', 'backup.json', 'manifest.json']) await copyNew(join(fixtureDir, f), join(portable, f))
      await verifyFixture(portable)
      report.publishedFixture = portable
    }
  } else {
    await useFixture()
    await runS1(await target(resolve(values.candidate), false))
  }
  assert.deepEqual(await verifyFixture(fixtureDir), manifest)
  assert.equal(await sha256(report.target.archive), report.target.asarSha256)
  assert.equal(await sha256(report.target.executable), report.target.exeSha256)
  assert.equal(await sha256(join(dirname(report.target.executable), report.target.binding)), report.target.sqliteSha256)
  assert.deepEqual(report.modelRequests, [])
  report.status = 'passed'
} catch (e) {
  report.status = 'failed'
  report.error = e.stack
  process.exitCode = 1
  console.error(report.error)
} finally {
  if (sink) await new Promise(ok => sink.close(ok))
  if (phase === 's1') {
    try { report.nativePackageCleanup = await cleanNativeCopy(work, report) }
    catch (e) { report.status = 'failed'; report.cleanupError = e.message; process.exitCode = 1; console.error(e.message) }
  }
  report.finishedAt = now()
  await save(join(work, 'report.json'), report)
  console.log(report.status + ': ' + join(work, 'report.json'))
}

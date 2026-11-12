import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { extractFile } from '@electron/asar'
import { books } from '../fixtures/library-recovery.mjs'
import { cleanup, connect, evaluate, sha256 } from '../utils/long-novel-ui-driver.mjs'
import { button, click, fill, freePort, waitFor } from '../utils/qa-agent-authorization-driver.mjs'
import { repoRoot } from '../utils/repo-root.mjs'
import { agentRead, checkedState, closedHash, copyClosed, editedBody, fixture, readJson } from './readback.mjs'

const env = process.env
assert(process.platform === 'win32' && process.arch === 'x64' && env.RUNNER_ENVIRONMENT === 'github-hosted' &&
  env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === 'SHIN09-git/novel' &&
  env.GITHUB_REF === 'refs/heads/codex/library-s2-installer-qa' && env.GITHUB_EVENT_NAME === 'push',
'Installed-window probe is restricted to the dedicated disposable job')
const [stage, version] = process.argv.slice(2)
assert(['old-seed', 'old-reopen', 'clean-seed', 'candidate-edit', 'candidate-reopen', 'reinstall-reopen',
  'rollback-edited', 'rollback-backup'].includes(stage))
const work = join(env.RUNNER_TEMP, 's2-work'), ev = join(env.RUNNER_TEMP, 's2-evidence')
const installed = join(work, 'Installed Novel Director'), executable = join(installed, 'Novel Director.exe')
const archive = join(installed, 'resources', 'app.asar')
const report = { stage, version, status: 'running', modelRequests: 0 }
const evidence = s => join(ev, s + '.json')
const seed = stage.endsWith('-seed'), rollback = stage.startsWith('rollback-')
const edited = ['candidate-reopen', 'reinstall-reopen', 'rollback-edited'].includes(stage)
const { manifest, backup } = await fixture()
const locked = (await readJson(join(repoRoot, 'package-lock.json'))).packages
const old = version === manifest.version
const meta = await readJson(join(env.RUNNER_TEMP, 's2-input', 'BUILD_INFO.json'))
const sink = createServer((_req, res) => { report.modelRequests++; res.writeHead(503).end() })
const api = 'window.novelDirector', load = api + '.data.load()'
const q = selector => 'document.querySelector(' + JSON.stringify(selector) + ')'
const j = JSON.stringify
let session

async function openWindow(profile) {
  const port = await freePort()
  const childEnv = {}
  for (const key of ['SystemRoot','WINDIR','ComSpec','SYSTEMDRIVE','PATHEXT','NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP']) childEnv[key] = env[key]
  childEnv.PATH = join(env.SystemRoot, 'System32')
  childEnv.NOVEL_DIRECTOR_API_REGISTRY = join(work, 'no-registry.json')
  // Normal install/upgrade/reinstall uses Electron's actual default guest userData.
  // Only rollback is redirected: preview.20 must never open the upgraded original.
  if (profile) childEnv.NOVEL_DIRECTOR_SMOKE_USER_DATA = profile
  const args = ['--disable-gpu', '--no-first-run', '--disable-background-networking',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=' + port, ...(profile ? ['--user-data-dir=' + profile] : [])]
  const child = spawn(executable, args, { cwd: installed, env: childEnv, windowsHide: true, stdio: ['ignore','pipe','pipe'] })
  session = { child, port, logs: [], networkRequests: [], exceptions: [], processIds: [] }
  child.on('error', e => { session.logs.push(e.message) })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => session.logs.push(String(chunk)))
  await connect(session)
  assert(session.processIds.includes(child.pid))
  const c = session.client
  await waitFor(c, api + '?.app?.getRuntimeInfo')
  assert.equal(await evaluate(c, 'location.href'), pathToFileURL(join(archive, 'out', 'renderer', 'index.html')).href)
  report.runtime = await evaluate(c, api + '.app.getRuntimeInfo()')
  assert.equal(report.runtime.mode, 'packaged')
  assert.equal(report.runtime.execPath.toLowerCase(), executable.toLowerCase())
  assert.equal(report.runtime.version, version)
  assert.equal(report.runtime.electronVersion, old ? '39.8.10' : locked['node_modules/electron'].version)
  if (!old) assert.equal(report.runtime.electronVersion, meta.electronVersion)
  return c
}

async function edit(c) {
  const row = '[...document.querySelectorAll(".project-row")].find(r=>r.innerText.includes(' + j(books[0].name) + '))'
  async function press(expr) {
    await waitFor(c, '(' + expr + ')?.disabled === false')
    await click(c, expr)
  }
  await press(button('进入', '(' + row + ')'))
  await press('[...document.querySelectorAll(".sidebar button")].find(b=>b.textContent.trim()==="章节")')
  await press(button('连贯阅读'))
  await press(button('编辑本章'))
  await waitFor(c, q('.reader-inline-editor textarea'))
  await fill(c, q('.reader-inline-editor textarea'), editedBody)
  await press(button('保存本章'))
  await waitFor(c, q('.reader-message') + '?.innerText.includes("已保存本章正文")')
}

let profile, database, protectedDb, protectedSha, seedReport
try {
  await new Promise((ok, fail) => { sink.once('error', fail); sink.listen(57760, '127.0.0.1', ok) })
  report.asarSha256 = await sha256(archive)
  assert.equal(report.asarSha256, old ? manifest.appAsarSha256 : meta.appAsarSha256.toLowerCase())
  report.installedVersion = JSON.parse(extractFile(archive, 'package.json')).version
  assert.equal(report.installedVersion, version)
  const sqlitePkg = join('node_modules', 'better-sqlite3')
  report.sqliteVersion = JSON.parse(extractFile(archive, join(sqlitePkg, 'package.json'))).version
  assert.equal(report.sqliteVersion, old ? '12.9.0' : locked['node_modules/better-sqlite3'].version)
  if (!old) assert.equal(report.sqliteVersion, meta.sqliteBindingVersion)
  const bindings = []
  for (const file of ['build/Release/better_sqlite3.node','prebuilds/win32-x64.node']) {
    const path = join(archive + '.unpacked', sqlitePkg, file)
    try { bindings.push({ file, sha256: await sha256(path) }) }
    catch (e) { if (e.code !== 'ENOENT') throw e }
  }
  assert.equal(bindings.length, 1, 'Ambiguous/missing installed x64 SQLite binding')
  report.binding = bindings[0]
  if (!seed) {
    seedReport = await readJson(evidence(env.ROUTE === 'clean' ? 'clean-seed' : 'old-seed'))
    profile = seedReport.profile
    database = seedReport.database
    assert.equal((await readJson(join(profile, 'app-config.json'))).storagePath, database)
    if (rollback) {
      protectedDb = database
      protectedSha = (await readJson(evidence('candidate-reopen'))).closedSha256
      assert.equal(await closedHash(protectedDb), protectedSha)
      const snapshot = stage === 'rollback-backup' ? join(work, 'before-upgrade.sqlite') : protectedDb
      const hash = stage === 'rollback-backup' ? (await readJson(evidence('old-reopen'))).closedSha256 : protectedSha
      profile = join(work, stage + '-profile')
      await mkdir(profile)
      database = join(work, stage + '.sqlite')
      assert.equal(await copyClosed(snapshot, database), hash)
      await writeFile(join(profile, 'app-config.json'), j({ storagePath: database }), { flag: 'wx' })
    }
  }
  const c = await openWindow(rollback ? profile : undefined)
  const paths = () => evaluate(c, api + '.app.getStoragePath()')
  if (seed) {
    await waitFor(c, q('.home-empty'))
    const first = await paths()
    profile = dirname(first.defaultStoragePath)
    assert.equal(dirname(profile).toLowerCase(), env.APPDATA.toLowerCase())
    assert(/^(?:Novel Director|novel-director)$/i.test(basename(profile)))
    assert.equal(first.storagePath, first.defaultStoragePath)
    assert.equal((await evaluate(c, load)).data.projects.length, 0)
    database = stage === 'old-seed' ? join(work, 'selected-s0.sqlite') : first.defaultStoragePath
    const result = stage === 'old-seed'
      ? await evaluate(c, api + '.app.migrateStoragePath(' + j(database) + ',' + j(backup) + ')')
      : await evaluate(c, api + '.data.save(' + j(backup) + ')')
    assert(result.ok && result.storagePath === database)
    await c.send('Page.reload', { ignoreCache: true })
  }
  await waitFor(c, 'document.querySelectorAll(".project-row").length === 2')
  const actualPaths = await paths()
  assert.equal(dirname(actualPaths.defaultStoragePath), profile)
  assert.equal(actualPaths.storagePath, database)
  Object.assign(report, { profile, database })
  async function read(editedNow) {
    const loaded = await evaluate(c, load)
    assert.equal(loaded.storagePath, database)
    assert.equal(loaded.data.settings.baseUrl, manifest.baseUrl)
    assert(!loaded.data.settings.apiKey && !loaded.data.settings.hasApiKey)
    return checkedState(loaded.data, manifest.signature, editedNow)
  }
  report.state = await read(edited)
  if (stage === 'candidate-edit') { await edit(c); report.state = await read(true) }
  if (edited) assert.deepEqual(report.state, (await readJson(evidence('candidate-edit'))).state)
  assert.equal(await evaluate(c, api + '.ai.getCallProgress({})'), null)
  assert.deepEqual(session.networkRequests, [])
  assert.deepEqual(session.exceptions, [])
  await cleanup(session)
  assert.equal(session.child.exitCode, 0, 'Installed application did not close cleanly')
  report.closedSha256 = await closedHash(database)
  if (stage === 'old-reopen') await copyClosed(database, join(work, 'before-upgrade.sqlite'))
  if (stage.endsWith('reopen') || rollback) {
    report.agent = agentRead(profile, database, report.state)
    assert.equal(await closedHash(database), report.closedSha256)
  }
  assert.equal(report.modelRequests, 0)
  report.status = 'passed'
} catch (e) {
  report.error = e.stack
  process.exitCode = 1
  console.error(e)
} finally {
  try {
    if (session) await cleanup(session)
    if (protectedDb) assert.equal(await closedHash(protectedDb), protectedSha)
    assert.equal(report.modelRequests, 0)
  } catch (e) { report.cleanupError = e.message; process.exitCode = 1 }
  if (process.exitCode) report.status = 'failed'
  if (sink.listening) await new Promise(ok => sink.close(ok))
  if (session && report.status !== 'passed') await writeFile(join(ev, stage + '.log'), session.logs.join(''))
  await writeFile(evidence(stage), j(report, null, 2) + '\n')
}

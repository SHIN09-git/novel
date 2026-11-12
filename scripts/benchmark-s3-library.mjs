import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { copyFile, link, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { closeElectron } from './utils/qa-agent-authorization-driver.mjs'
import { button, click, connect, evaluate, launch, measureClick, ready, sha256 } from './utils/long-novel-ui-driver.mjs'
import { changed, fingerprints, readback } from './performance/s3-readback.mjs'

const [side, seedName, mode] = process.argv.slice(2)
assert(['before','after'].includes(side) && /^s3-seed-[a-zA-Z0-9]+$/.test(seedName) &&
  ['smoke','timing','diagnostic'].includes(mode), 'Usage: node scripts/benchmark-s3-library.mjs before|after s3-seed-NAME smoke|timing|diagnostic')
const root = await realpath(dirname(dirname(fileURLToPath(import.meta.url))))
const local = async rel => {
  const full = resolve(root, rel)
  assert.equal(await realpath(full), full, 'Expected a local workspace path without redirection: ' + rel)
  return full
}
const tmp = await local('tmp'), seed = await local(join('tmp',seedName))
const pkg = await local(side === 'before' ? 'tmp/s1-final/win-unpacked' : 'release/win-unpacked')
const executable = await local(join(pkg,'Novel Director.exe')), archive = await local(join(pkg,'resources','app.asar'))
const require = createRequire(import.meta.url), asar = require('@electron/asar')
const manifest = JSON.parse(await readFile(join(seed,'manifest.json'),'utf8'))
assert.equal(await sha256(join(seed,'seed.sqlite')), manifest.sqliteSha256)
assert.equal(await sha256(join(seed,'seed.json')), manifest.compactSha256)
const work = await mkdtemp(join(tmp,'s3-' + side + '-' + mode + '-'))
console.log('RUN', work)
const archiveBytes = file => asar.extractFile(archive,join(...file.split('/')),false)
const nativePath = 'node_modules/better-sqlite3/prebuilds/win32-x64.node'
const sqliteVersion = JSON.parse(archiveBytes('node_modules/better-sqlite3/package.json')).version
const lock = JSON.parse(await readFile(resolve(root,'tmp/s3-perf-s1/package-lock.json'),'utf8'))
assert.equal(sqliteVersion, lock.packages['node_modules/better-sqlite3'].version)
const depHash = createHash('sha256')
for (const file of asar.listPackage(archive).map(p => p.replaceAll('\\','/').replace(/^\//,'')).sort()) {
  if (!file.startsWith('node_modules/')) continue
  const entry = asar.statFile(archive,join(...file.split('/')),false)
  if ('size' in entry) depHash.update(file + '\0').update(archiveBytes(file))
}
const report = { side, mode, startedAt: new Date().toISOString(), fixture: manifest, host: { os: os.release(),
  cpu: os.cpus()[0].model, parallelism: os.availableParallelism(), memory: os.totalmem(), node: process.version },
  identity: { asar: await sha256(archive), exe: await sha256(executable), packagedDependencies: depHash.digest('hex'),
    sqliteVersion, sqliteBinding: await sha256(await local(join(archive + '.unpacked',nativePath))),
    lock: await sha256(await local('tmp/s3-perf-s1/package-lock.json')) }, samples: [] }
const currentLock = JSON.parse(await readFile(await local('package-lock.json'),'utf8'))
const sorted = x => Array.isArray(x) ? x.map(sorted) : x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map(key => [key,sorted(x[key])])) : x
const depLockHash = lockfile => {
  const entries = structuredClone(lockfile.packages)
  delete entries[''].version
  return createHash('sha256').update(JSON.stringify(sorted(entries))).digest('hex')
}
report.identity.canonicalS1 = depLockHash(lock)
report.identity.canonicalCurrent = depLockHash(currentLock)
assert.equal(report.identity.canonicalCurrent,report.identity.canonicalS1)
const hasTouch = archiveBytes('out/main/index.js').includes('data:touch-project')
assert.equal(hasTouch,side === 'after','Wrong packaged build: S3-A must be present only in after')
const persist = () => writeFile(join(work,'report.json'),JSON.stringify(report,null,2))
await persist()
const diagnostic = mode === 'diagnostic'
let target = { mode: 'packaged', executable, runtimeRoot: pkg }
if (diagnostic) {
  // Extract into a brand-new directory. Only its private main entry imports the observer.
  const runtimeRoot = join(work,'probe-app')
  asar.extractAll(archive,runtimeRoot)
  const main = join(runtimeRoot,'out/main/index.js')
  const original = await readFile(main)
  assert(original.equals(archiveBytes('out/main/index.js')))
  await copyFile(join(root,'scripts/performance/s3-probe.mjs'),join(dirname(main),'s3-probe.mjs'))
  await writeFile(main,Buffer.concat([Buffer.from("import './s3-probe.mjs';\n"),original]))
  target = { mode: 'isolated-out', runtimeRoot, executable: await local('node_modules/electron/dist/electron.exe') }
}
const enter = button('进入',"([...document.querySelectorAll('.project-row')].find(e=>e.querySelector('h3').textContent==='S3 one'))")
const nav = label => button(label,"document.querySelector('.nav-list')")
const backupNames = async dir => (await readdir(dir)).filter(f => /^novel-director-\d+-auto.*\.json(?:\.gz)?$/.test(f)).sort()
async function sample(due, phase, index) {
  const profile = await mkdtemp(join(work,'profile-')), db = join(profile,'novel-director-data.sqlite'), backups = join(profile,'backups')
  const s = { due, phase, index, ms: {}, backupBytes: {}, profile: basename(profile) }
  report.samples.push(s)
  await copyFile(join(seed,'seed.sqlite'), db)
  await mkdir(backups)
  const recentName = 'novel-director-' + Date.now() + '-auto.json'
  if (!due) await link(join(seed,'seed.json'),join(backups,recentName))
  async function recentInventory() {
    const names = await readdir(backups)
    assert.deepEqual(names,[recentName])
    const file = await stat(join(backups,recentName),{bigint:true})
    return [recentName,String(file.size),String(file.ino),String(file.mtimeNs)]
  }
  const recentBefore = due ? null : await recentInventory()
  let state = diagnostic ? fingerprints(db) : null, offset = 0
  async function stats(name) {
    if (!diagnostic) return
    const next = fingerprints(db), lines = (await readFile(join(profile,'probe.jsonl'),'utf8')).trim().split('\n')
    const events = lines.slice(offset).map(l => JSON.parse(l))
    ;(s.observations ??= {})[name] = { changed: changed(state,next), events,
      fullReads: events.filter(e => e.whole).length, requestJsonBytes: events.reduce((n,e)=>n+(e.requestJsonBytes??0),0),
      responseJsonBytes: events.reduce((n,e)=>n+(e.responseJsonBytes??0),0) }
    offset = lines.length
    state = next
  }
  async function writeAction(name, client, action, done) {
    // A due run is due for *each* action. Age only backups made by this disposable app.
    if (due) for (const f of await backupNames(backups)) {
      if (!f.startsWith('novel-director-1-auto')) await rename(join(backups,f),join(backups,f.replace(/^novel-director-\d+/, 'novel-director-1')))
    }
    const before = await backupNames(backups)
    if (!due) assert.deepEqual(await recentInventory(),recentBefore)
    s.ms[name] = await measureClick(client,action,done)
    if (!due) assert.deepEqual(await recentInventory(),recentBefore)
    const newFiles = (await backupNames(backups)).filter(n => !before.includes(n))
    assert.equal(newFiles.length,due ? 1 : 0,'Unexpected backup count at ' + name)
    s.backupBytes[name] = newFiles.length ? (await stat(join(backups,newFiles[0]))).size : 0
    if (due) {
      assert(s.backupBytes[name] > 0)
      const rolls = (await readdir(backups)).filter(n => n.includes('-rollback-') && n.endsWith('.json'))
      ;(s.rollbackBytes ??= {})[name] = (await Promise.all(rolls.map(async n => (await stat(join(backups,n))).size))).reduce((a,b)=>a+b,0)
    }
    await stats(name)
  }
  const session = await launch(target,profile)
  try {
    await connect(session)
    const c = session.client
    await ready(c,"document.querySelectorAll('.project-row').length===2 && (" + enter + ")?.disabled===false")
    s.ms.startup = performance.now() - session.startedAt
    await stats('startup')
    const runtime = await evaluate(c,'window.novelDirector.app.getRuntimeInfo()')
    assert.equal(runtime.electronVersion,lock.packages['node_modules/electron'].version)
    assert.equal(runtime.mode,diagnostic ? 'preview' : 'packaged')
    assert.equal(resolve(runtime.execPath),target.executable)
    const url = await evaluate(c,'location.href')
    assert.equal(url.toLowerCase(),pathToFileURL(join(diagnostic ? target.runtimeRoot : archive,'out/renderer/index.html')).href.toLowerCase())
    const path = await evaluate(c,'window.novelDirector.app.getStoragePath().then(x=>x.storagePath)')
    assert.equal(await realpath(path),db)
    s.runtime = { electron: runtime.electronVersion, app: runtime.version, built: runtime.buildTime }
    await stats('identityOutsideTimers')
    await writeAction('open',c,enter,"document.querySelector('.dashboard-view') && document.querySelector('.project-badge strong')?.textContent==='S3 one' && (" + nav('生产流水线') + ")?.disabled===false")
    await click(c,nav('生产流水线'))
    const draftTab = button('草稿',"document.querySelector('.pipeline-artifact-tabs')")
    await ready(c,"document.querySelector('.pipeline-artifact-tabs') && (" + draftTab + ")?.disabled===false")
    await click(c,draftTab)
    await ready(c,"document.querySelector('.pipeline-draft-body')?.value.endsWith('Accepted benchmark.')")
    await click(c,button('接受章节草稿',"document.querySelector('.pipeline-draft-actions')"))
    const dialog = "document.querySelector('.confirm-dialog')"
    await ready(c,dialog + " && (" + button('接受章节',dialog) + ")")
    await stats('prepareAcceptOutsideTimers')
    await writeAction('accept',c,button('接受章节',dialog),"document.body.innerText.includes('第 2 章已接受并写入版本链')")
    await click(c,nav('修订工作台'))
    await ready(c,"document.querySelector('.revision-view') && (" + button('接受版本') + ")?.disabled===false")
    await click(c,button('接受版本'))
    await ready(c,dialog + " && (" + button('接受修订',dialog) + ")")
    await stats('prepareRevisionOutsideTimers')
    await writeAction('revision',c,button('接受修订',dialog),"document.querySelector('.revision-message')?.textContent.includes('已接受修订版本，并记录正式修订提交')")
    assert.deepEqual(session.exceptions,[])
    assert.deepEqual(session.networkRequests,[])
    s.readback = readback(db,true)
    if (!due) {
      assert.equal(await sha256(join(backups,recentName)),manifest.compactSha256)
      s.recentBackupUnchanged = true
    }
    s.passed = true
  } catch (err) {
    s.error = err.stack
    if (session.client) try { s.failureDom = (await evaluate(session.client,'document.body.innerText')).slice(0,3200) } catch {}
    throw err
  } finally {
    try {
      const ids = session.browser ? (await session.browser.send('SystemInfo.getProcessInfo').catch(()=>({processInfo:[]}))).processInfo.map(p=>p.id) : []
      const closed = await closeElectron(session.child,session.client,session.browser,[...session.processIds,...ids])
      s.remainingProcesses = closed.remainingProcessIds.length
    } finally {
      if (!s.passed) s.log = session.logs.join('').slice(-6000)
      await persist()
    }
  }
  // Retain raw results but not 12 full library/backup copies.
  assert.equal(dirname(await realpath(profile)), await realpath(work))
  await rm(profile,{recursive:true,force:true,maxRetries:4})
  console.log(JSON.stringify({ due,phase,index,ms:s.ms,backup:s.backupBytes }))
}
try {
  report.seedChecks = readback(join(seed,'seed.sqlite'),false)
  for (const due of (mode === 'smoke' ? [false] : [false,true])) {
    for (let i=0; i < (mode==='timing' ? 6 : 1); i++) await sample(due, mode==='timing' ? i ? 'measured' : 'warmup' : mode, i)
  }
  assert.equal(await sha256(archive),report.identity.asar)
  assert.equal(await sha256(join(seed,'seed.sqlite')),manifest.sqliteSha256)
  report.passed = true
} finally {
  report.finishedAt = new Date().toISOString()
  await persist()
}

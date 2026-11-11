#!/usr/bin/env node
// Only the pinned Windows release is eligible. No source build, alternate runtime or external model.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, open, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { repoRoot as root } from './utils/repo-root.mjs'
import { qaRuntimeTarget, prepareTarget, targetIdentity, verifyRuntimeIdentity } from './utils/long-novel-ui-runtime.mjs'
import { click, connect, cleanup, evaluate, launch, ready, sha256, within } from './utils/long-novel-ui-driver.mjs'
import { fill } from './utils/qa-agent-authorization-driver.mjs'
import { cases, fixture, hash, roles, startStub, visible } from './utils/qa-draft-retention-fixture.mjs'

const VERSION = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
// This receipt compares the installer payload with the unpacked binary, not just its version label.
const payloadProof = JSON.parse(await readFile(join(root, 'release', 'INSTALLER_PAYLOAD_CHECK.json'), 'utf8'))
assert.equal(payloadProof.version, VERSION, 'Run verify-win-installer-payload.mjs for the current release first.')
assert.equal(payloadProof.status, 'identical')
const ASAR = String(payloadProof.appAsarSha256).toLowerCase()
assert.match(ASAR, /^[0-9a-f]{64}$/)
const target = qaRuntimeTarget(root, true)
const j = JSON.stringify, now = () => new Date().toISOString()
const el = selector => 'document.querySelector(' + j(selector) + ')'
const btn = (label, scope = '') => '[...document.querySelectorAll(' + j((scope ? scope + ' ' : '') + 'button') +
  ')].find(b=>b.textContent.trim()===' + j(label) + ')'
const mainButton = '.pipeline-top-status-inner'
const tabs = '.pipeline-artifact-tabs'
const saveJson = (path, value) => writeFile(path, j(value, null, 2) + '\n', 'utf8')
const args = process.argv.slice(2).filter(a => a !== '--packaged')
const selected = args.length === 0 ? cases : cases.filter(c => args.length === 1 && args[0] === '--case=' + c.id)
assert(selected.length, 'Usage: node scripts/qa-packaged-draft-retention.mjs [--case=<fixture id>]')

async function releaseGate() {
  assert.equal(process.platform, 'win32')
  assert.equal(target.mode, 'packaged')
  assert.equal(target.out, null)
  const manifest = JSON.parse(await readFile(target.releaseInfoPath, 'utf8'))
  assert.equal(manifest.version, VERSION, 'REFUSED before launch: wrong release')
  assert.equal(manifest.packagedSmokeTest, 'passed', 'REFUSED before launch: missing package-completion evidence')
  assert.equal(manifest.unpackedExecutable.replaceAll('\\', '/'), 'win-unpacked/Novel Director.exe')
  assert.equal(resolve(target.executable), join(root, 'release', 'win-unpacked', 'Novel Director.exe'))
  assert.equal(await realpath(target.executable), resolve(target.executable))
  assert.equal(await sha256(join(target.packagedDir, 'resources', 'app.asar')), ASAR, 'REFUSED: different app.asar')
  return manifest
}

function readState(db) {
  // A single read transaction cannot mix a previous draft with a newer job status.
  db.exec('BEGIN')
  try {
    const query = db.prepare('SELECT json FROM entities WHERE collection=?')
    const rows = key => query.all(key).map(row => JSON.parse(row.json))
    const jobs = rows('chapterGenerationJobs'), steps = rows('chapterGenerationSteps')
    return { jobs, job: jobs[0], drafts: rows('generatedChapterDrafts'), steps,
      draftStep: steps.find(s => s.type === 'generate_chapter_draft'),
      consistency: rows('consistencyReviewReports'), quality: rows('qualityGateReports'),
      canonical: Object.fromEntries(['chapters', 'chapterVersions', 'chapterCommitBundles'].map(k => [k, rows(k).length])),
      revision: db.prepare("SELECT value FROM meta WHERE key='revision'").get()?.value }
  } finally { db.exec('ROLLBACK') }
}

function compact(s) {
  return { revision: s.revision, jobs: s.jobs.length, jobId: s.job?.id, status: s.job?.status,
    currentStep: s.job?.currentStep, error: s.job?.errorMessage, canonical: s.canonical,
    drafts: s.drafts.map(d => ({ id: d.id, jobId: d.jobId, status: d.status, title: d.title, chapterId: d.chapterId,
      visibleChars: visible(d.body), sha256: hash(d.body), createdAt: d.createdAt, updatedAt: d.updatedAt })),
    failedSteps: s.steps.filter(t => t.status === 'failed').map(t => ({ type: t.type, error: t.errorMessage })),
    consistencyReportIds: s.consistency.map(r => r.id), qualityReportIds: s.quality.map(r => r.id) }
}

const report = { status: 'not-run', startedAt: now(), targetVersion: VERSION, expectedAsar: ASAR, cases: [],
  boundary: 'Packaged desktop UI, production preload, real loopback HTTP, independent read-only SQLite. No installed-app, live-provider, CLI/MCP, or injected in-process diagnostic tests.' }
let work

async function runCase(spec) {
  const dir = join(work, spec.id), profile = join(dir, 'profile'), database = join(profile, 'novel-director-data.sqlite')
  await mkdir(dir)
  await mkdir(profile)
  assert.equal(await realpath(profile), profile)
  const stub = await startStub(spec)
  const entry = { id: spec.id, status: 'running', directory: dir, profile, database, stub: stub.baseUrl,
    expected: { target: spec.target, title: spec.title, visibleChars: visible(spec.body), bodySha256: hash(spec.body),
      ending: spec.body.slice(-12), finishReason: spec.finish ?? null, rejectedAs: spec.negative ?? null },
    sessions: [], evidence: [], calls: stub.calls }
  report.cases.push(entry)
  let session, db, client, jobId
  const ev = expression => evaluate(client, expression)
  const wait = expression => ready(client, expression, 15000)
  const press = async expression => { await wait('(' + expression + ')?.disabled === false'); await click(client, expression) }
  const snap = () => readState(db)
  const note = (name, data) => entry.evidence.push({ name, at: now(), ...data })
  const proseCalls = () => stub.calls.filter(c => c.kind === 'prose')
  const until = async (label, predicate) => {
    const deadline = Date.now() + 35000
    do {
      const s = snap()
      if (predicate(s)) return s
      await delay(80)
    } while (Date.now() < deadline)
    throw Error('Timed out: ' + label + '; last SQLite state: ' + j(compact(snap())))
  }
  const screenshot = async name => {
    const { data } = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    await writeFile(join(dir, name + '.png'), Buffer.from(data, 'base64'))
  }
  const terminal = s => s.job?.id === jobId && ['failed', 'completed'].includes(s.job.status)
  const noCanon = s => assert.deepEqual(s.canonical, { chapters: 0, chapterVersions: 0, chapterCommitBundles: 0 })
  const exactDraft = s => {
    assert.equal(s.jobs.length, 1)
    assert.equal(s.job.id, jobId)
    assert.equal(s.drafts.length, 1, 'Expected one and only one persisted draft')
    const [d] = s.drafts
    assert.equal(d.jobId, jobId)
    assert.equal(d.projectId, spec.projectId)
    assert.equal(d.status, 'draft')
    assert.equal(d.chapterId, null)
    assert.equal(d.title, spec.title)
    assert.equal(d.body, spec.body, 'Saved body differs from the only generated body')
    assert.equal(s.draftStep.status, 'completed')
    const output = JSON.parse(s.draftStep.output)
    assert.equal(output.checkpoint?.draftId, d.id)
    assert.equal(output.checkpoint.kind, 'chapter_draft_checkpoint')
    assert.equal(output.body, spec.body)
    assert.equal(proseCalls().length, 1, 'An extra writing request was dispatched')
    noCanon(s)
    return d
  }

  async function openApp() {
    await releaseGate()
    session = await launch(target, profile)
    const identity = { pid: session.child.pid, cdpPort: session.port, profile, startedAt: now() }
    entry.sessions.push(identity)
    await connect(session)
    client = session.client
    await wait('window.novelDirector?.app && document.querySelector(".project-row")')
    identity.runtime = await ev('window.novelDirector.app.getRuntimeInfo()')
    identity.renderer = await ev('location.href')
    verifyRuntimeIdentity(target, identity.runtime, identity.renderer)
    const paths = await ev('window.novelDirector.app.getStoragePath()')
    for (const p of [paths.storagePath, paths.defaultStoragePath]) assert.equal(resolve(p), database)
    assert.equal(await realpath(database), database)
    const file = await open(database, 'r')
    try {
      const { buffer } = await file.read(Buffer.alloc(16), 0, 16, 0)
      assert.equal(buffer.toString(), 'SQLite format 3\0')
    } finally { await file.close() }
    db = new DatabaseSync(database, { readOnly: true })
    const loaded = await ev('window.novelDirector.data.load().then(({data,storagePath})=>({storagePath,ids:data.projects.map(p=>p.id),settings:data.settings}))')
    assert.equal(loaded.storagePath, database)
    assert.deepEqual(loaded.ids, [spec.projectId])
    assert(!loaded.settings.hasApiKey && !loaded.settings.apiKey)
    for (const settings of [loaded.settings, ...roles.map(r => loaded.settings.pipelineModelRoles[r])]) {
      assert.equal(settings.apiProvider, 'local')
      assert.equal(settings.baseUrl, stub.baseUrl)
    }
    const row = '[...document.querySelectorAll(".project-row")].find(r=>r.textContent.includes(' + j(spec.name) + '))'
    await wait(row)
    await press('[...(' + row + ').querySelectorAll("button")].find(b=>b.textContent.trim()==="进入")')
    await wait(el('.dashboard-view'))
    await press(btn('生产流水线', '.sidebar'))
    await wait(el('.pipeline-task-editor'))
  }

  async function closeApp() {
    if (db) { db.close(); db = undefined }
    if (!session) return
    const identity = entry.sessions.at(-1)
    try {
      identity.cleanup = await cleanup(session)
      assert.deepEqual(identity.cleanup.remainingProcessIds, [])
      identity.rendererNetwork = session.networkRequests
      identity.rendererExceptions = session.exceptions.map(e => e.exception?.description ?? e.text)
      assert.equal(identity.rendererNetwork.length, 0, 'Unexpected network request from renderer')
      assert.deepEqual(identity.rendererExceptions, [])
    } finally {
      await writeFile(join(dir, 'electron-' + entry.sessions.length + '.log'), session.logs.join(''))
      session = client = undefined
    }
  }

  async function generate() {
    const initial = snap()
    assert.equal(initial.jobs.length + initial.drafts.length, 0, 'A job or draft was pre-seeded')
    noCanon(initial)
    if (spec.overflow) {
      const config = '.pipeline-config-tools'
      await click(client, el(config + ' > summary'))
      const select = '[...document.querySelectorAll(".pipeline-config-tools select")].find(e=>e.querySelector("option[value=conservative]"))'
      await ev('(()=>{const s=' + select + ';s.value="conservative";s.dispatchEvent(new Event("change",{bubbles:true}));})()')
      await wait('(' + select + ').value === "conservative"')
      await click(client, el(config + ' > summary'))
    }
    await fill(client, el('.pipeline-task-editor [name=goal]'), '林禾在车站寄存窗找回箱子里的地图。')
    await fill(client, el('.pipeline-task-editor [name=targetWordCount]'), spec.target)
    await press(btn('保存任务', '.pipeline-task-editor'))
    const saved = await until('new idle task', s => s.job?.status === 'idle')
    jobId = saved.job.id
    assert.equal(saved.jobs.length, 1)
    assert.equal(saved.job.targetChapterOrder, 1)
    assert.equal(saved.job.chapterTaskSnapshot.targetWordCount, spec.target)
    if (spec.overflow) assert.equal(saved.job.pipelineRecipeId, 'strict')
    for (const role of roles) {
      const config = saved.job.aiRunConfig.roles[role]
      assert.equal(config.apiProvider, 'local')
      assert.equal(config.baseUrl, stub.baseUrl)
      assert.equal(config.modelName, 'retention-' + role)
    }
    assert.equal(saved.drafts.length, 0)
    assert.equal(stub.calls.length, 0)
    note('saved-task-before-model', compact(saved))
    await press(btn('按此任务生成', '.pipeline-task-editor'))
    await press(btn('启动流水线', '.confirm-dialog'))
  }

  async function showDraft(label) {
    await press(btn('草稿', tabs))
    await wait(el('.pipeline-draft-body') + '?.readOnly')
    assert.equal(await ev(el('.pipeline-draft-body') + '.value'), spec.body)
    const notice = await ev(el('.pipeline-draft-preview > p') + '.innerText')
    assert(notice.includes(String(visible(spec.body))), notice)
    if (spec.overflow) {
      assert.match(notice, /600.{1,3}800/)
      assert(notice.includes('超出上限 ' + (visible(spec.body) - 800) + ' 字'), notice)
      assert(notice.includes('明确确认'), notice)
    } else assert(!notice.includes('超出上限'), notice)
    await ev(el('.pipeline-draft-preview > p') + '.scrollIntoView({block:"center"})')
    await screenshot(label)
    note(label, { notice, ...compact(snap()) })
  }

  async function reviewRetry() {
    const reached = await until('first consistency request or terminal failure', s =>
      stub.calls.some(c => c.kind === 'consistency') || terminal(s))
    try {
      const c = stub.calls.find(c => c.kind === 'consistency')
      assert(c && c.status === undefined && c.containsExactBody, 'Did not reach held reviewer with the original draft: ' + j(compact(reached)))
      const original = exactDraft(reached)
      entry.savedDraftId = original.id
      entry.checkpoint = JSON.parse(reached.draftStep.output).checkpoint
      note('draft-on-disk-before-review-reply', compact(reached))
    } finally { stub.releaseFailure() }
    const failed = await until('injected review failure', terminal)
    assert.equal(failed.job.status, 'failed')
    assert.equal(failed.job.currentStep, 'consistency_review')
    assert.equal(failed.steps.find(s => s.type === 'consistency_review')?.status, 'failed')
    assert.equal(stub.calls.find(c => c.kind === 'consistency')?.status, 503)
    assert.equal(exactDraft(failed).id, entry.savedDraftId)
    note('consistency-review-failed', compact(failed))
    const beforeRestart = stub.calls.length
    await closeApp()
    await openApp()
    const reopened = snap()
    assert.equal(reopened.job.status, 'failed')
    assert.deepEqual(exactDraft(reopened), failed.drafts[0], 'Cold restart changed the persisted candidate')
    assert.notEqual(entry.sessions[0].pid, entry.sessions[1].pid)
    await showDraft('reopened-original')
    await press(btn('未完成审稿，直接采纳', '.pipeline-draft-actions'))
    await wait(el('.confirm-dialog-message'))
    entry.cancelledAcceptance = await ev(el('.confirm-dialog-message') + '.innerText')
    assert(entry.cancelledAcceptance.includes('超限原文') && entry.cancelledAcceptance.includes(String(visible(spec.body))))
    await screenshot('cancelled-acceptance')
    await press(btn('取消', '.confirm-dialog'))
    await wait('!document.querySelector(".confirm-dialog")')
    noCanon(snap())
    assert.equal(stub.calls.length, beforeRestart, 'Reopening or inspecting the candidate invoked a model')
    await press(btn('重试失败步骤', mainButton))
    const retried = await until('retry completion', s => terminal(s) && s.job.updatedAt !== failed.job.updatedAt && stub.calls.length > beforeRestart)
    assert.equal(retried.job.status, 'completed', retried.job.errorMessage)
    assert.equal(retried.job.currentStep, 'await_user_confirmation')
    assert.deepEqual(exactDraft(retried), failed.drafts[0], 'Retry changed the original candidate')
    assert.deepEqual(retried.draftStep, failed.draftStep, 'Retry repeated/modified the completed writing step')
    const reviews = stub.calls.filter(c => c.kind === 'consistency')
    assert.deepEqual(reviews.map(c => c.status), [503, 200])
    assert(reviews.every(c => c.containsExactBody), 'A review did not receive the original body')
    assert.equal(reviews[0].promptSha256, reviews[1].promptSha256)
    assert(retried.consistency.some(r => r.jobId === jobId && r.draftId === entry.savedDraftId))
    assert(retried.quality.some(r => r.jobId === jobId && r.draftId === entry.savedDraftId))
    note('review-retry-same-job-step-and-draft', { ...compact(retried), retryCalls: stub.calls.slice(beforeRestart).map(c => c.kind) })
    await showDraft('after-review-retry')
  }

  async function negative(s) {
    assert.equal(s.job.status, 'failed')
    assert.equal(s.job.currentStep, 'generate_chapter_draft')
    assert.equal(s.draftStep.status, 'failed')
    assert.equal(s.drafts.length, 0)
    noCanon(s)
    assert.equal(s.consistency.length + s.quality.length, 0)
    assert(stub.calls.every(c => c.kind === 'prose'))
    const output = s.draftStep.output, reason = s.draftStep.errorMessage
    assert(await ev('(' + btn('草稿', tabs) + ')?.disabled === true'), 'Fragment/rejected response exposed an active draft tab')
    await press(btn('步骤输出', tabs))
    await wait(el('.pipeline-step-output.failed[open]'))
    const controls = await ev('[...document.querySelectorAll("button")].filter(b=>b.getClientRects().length && !b.disabled).map(b=>b.textContent.trim())')
    assert(!controls.some(label => /接受章节草稿|审核后接受草稿|直接采纳|确认采纳/.test(label)), 'Rejected response exposed an acceptance action')
    if (spec.negative === 'fragment') {
      const part = JSON.parse(output)
      assert.equal(part.kind, 'incomplete_chapter_fragment')
      assert.equal(part.finishReason, spec.finish)
      assert.equal(part.title, spec.title)
      assert.equal(part.body, spec.body)
      assert.equal(await ev(el('.pipeline-step-output.failed pre') + '.textContent'), part.body)
      const notice = await ev(el('.pipeline-step-output.failed .notice') + '.innerText')
      assert(notice.includes('不能采纳') && notice.includes(spec.finish))
      note('read-only-fragment', { notice, sha256: hash(part.body), reason })
    } else {
      assert(!output.includes('incomplete_chapter_fragment'))
      assert(!await ev('Boolean(' + el('.pipeline-step-output.failed .notice') + ')'))
      assert.match(reason, spec.negative === 'broken' ? /JSON|解析/ : /空|empty|没有.*(正文|内容)|未返回/i)
    }
    await ev(el('.pipeline-step-output.failed') + '.scrollIntoView({block:"start"})')
    await screenshot('rejected-output')
    note('no-candidate-or-acceptance', { reason, ...compact(s) })
  }

  console.log('START ' + spec.id + '  ' + dir)
  try {
    await writeFile(join(profile, 'novel-director-data.json'), j(fixture(spec, stub.baseUrl)), { flag: 'wx' })
    await writeFile(join(dir, 'fixture-body.txt'), spec.body, { flag: 'wx' })
    await openApp()
    await generate()
    if (spec.overflow) await reviewRetry()
    else {
      const s = await until('job terminal', terminal)
      if (spec.negative) await negative(s)
      else {
        exactDraft(s)
        assert.equal(s.job.status, 'completed', s.job.errorMessage)
        await showDraft('normal-ending')
      }
    }
    assert.deepEqual(stub.calls.filter(c => c.unexpected), [])
    assert.equal(proseCalls().length, spec.negative === 'empty' ? 2 : 1)
    assert(proseCalls().every(c => c.hasTarget && c.status === 200))
    entry.writingUsage = (await ev('window.novelDirector.data.getProjectUsage(' + j(spec.projectId) + ')')).byPhase.find(p => p.phase === 'writing')
    entry.status = 'passed'
  } catch (err) {
    entry.status = 'failed'
    entry.error = err.stack
    if (db) note('failure-sqlite', compact(snap()))
    if (client) {
      try {
        await writeFile(join(dir, 'failure-ui.txt'), await ev('document.body.innerText'))
        await screenshot('failure')
      } catch { /* A startup or shutdown failure may leave no renderer. */ }
    }
  } finally {
    stub.releaseFailure()
    try { await closeApp() } catch (err) { entry.cleanupError = err.stack; entry.status = 'failed' }
    await stub.close()
    await saveJson(join(dir, 'requests.json'), stub.calls)
    await saveJson(join(dir, 'result.json'), entry)
    console.log(entry.status.toUpperCase() + ' ' + spec.id + (entry.error ? '  ' + entry.error.split('\n')[0] : ''))
  }
}

try {
  report.release = await releaseGate()
  await targetIdentity(root, target)
  assert.equal(target.expectedAppVersion, VERSION)
  const tmp = join(root, 'tmp')
  await mkdir(tmp, { recursive: true })
  assert.equal(await realpath(tmp), tmp)
  work = await mkdtemp(join(tmp, 'packaged-draft-retention-'))
  assert(within(tmp, await realpath(work)))
  await prepareTarget(root, target, work)
  report.fingerprints = target.fingerprints
  assert.equal(report.fingerprints.find(f => f.path === target.archive)?.sha256, ASAR)
  report.status = 'running'
  console.log('Packaged P0-A evidence: ' + work)
  for (const spec of selected) {
    await runCase(spec)
    await saveJson(join(work, 'report.json'), report)
    assert(!report.cases.at(-1).cleanupError, 'Previous session did not close cleanly')
  }
  await releaseGate()
  for (const file of target.fingerprints) assert.equal(await sha256(file.path), file.sha256, 'Packaged file changed: ' + file.path)
  report.status = report.cases.every(c => c.status === 'passed') ? 'passed' : 'failed'
} catch (err) {
  report.error = err.stack
  if (report.status !== 'not-run') report.status = 'failed'
  console.error(err.message)
} finally {
  report.finishedAt = now()
  if (work) await saveJson(join(work, 'report.json'), report)
  console.log(j({ status: report.status, cases: report.cases.map(c => [c.id, c.status]), report: work && join(work, 'report.json') }))
  if (report.status !== 'passed') process.exitCode = 1
}

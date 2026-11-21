// Exercise role inheritance through the shipped settings UI and a real loopback HTTP endpoint.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { repoRoot } from './utils/repo-root.mjs'
import { click, connect, cleanup, evaluate, launch, ready, sha256 } from './utils/long-novel-ui-driver.mjs'
import { fill } from './utils/qa-agent-authorization-driver.mjs'
import { cases, fixture, startStub } from './utils/qa-draft-retention-fixture.mjs'

const release = resolve(process.argv[2] || join(repoRoot, 'release'))
const info = JSON.parse(await readFile(join(release, 'BUILD_INFO.json'), 'utf8'))
const dir = join(release, 'win-unpacked'), executable = join(dir, 'Novel Director.exe')
const archive = join(dir, 'resources', 'app.asar')
assert.equal((await sha256(archive)).toUpperCase(), info.appAsarSha256.toUpperCase())
const tmp = join(repoRoot, 'tmp')
await mkdir(tmp, { recursive: true })
const work = await mkdtemp(join(tmp, 'packaged-reasoning-'))
const profile = join(work, 'profile')
await mkdir(profile)
const spec = { ...cases.find(c => c.id === 'ellipsis-stop'), sharedModel: 'qa-shared-model' }
const stub = await startStub(spec)
const output = { version: info.version, appAsarSha256: info.appAsarSha256, status: 'failed', calls: stub.calls }
let session
try {
  const data = fixture(spec, stub.baseUrl)
  Object.assign(data.settings, { modelName: spec.sharedModel, pipelineModelRoles: {} })
  session = await launch({ executable, mode: 'packaged', runtimeRoot: dir }, profile)
  await connect(session)
  const c = session.client, ev = expr => evaluate(c, expr), wait = expr => ready(c, expr, 20000)
  const el = css => 'document.querySelector(' + JSON.stringify(css) + ')'
  const btn = (scope, name) => '[...document.querySelectorAll(' + JSON.stringify(scope + ' button') +
    ')].find(b=>b.textContent.trim()===' + JSON.stringify(name) + ')'
  const press = async expr => { await wait('(' + expr + ')?.disabled === false'); await click(c, expr) }
  const choose = async (expr, value) => {
    await wait(expr)
    await ev('(()=>{const s=' + expr + ';s.value=' + JSON.stringify(value) + ';s.dispatchEvent(new Event("change",{bubbles:true}))})()')
    await wait('(' + expr + ')?.value === ' + JSON.stringify(value))
  }
  await wait(el('.home-library-authorization'))
  assert.equal(await ev('location.href'), pathToFileURL(join(archive, 'out/renderer/index.html')).href)
  assert.equal(resolve((await ev('window.novelDirector.app.getRuntimeInfo()')).execPath), executable)
  const paths = await ev('window.novelDirector.app.getStoragePath()')
  assert.equal(resolve(paths.storagePath), join(profile, 'novel-director-data.sqlite'))
  assert.equal(resolve(paths.defaultStoragePath), resolve(paths.storagePath))
  const empty = await ev('window.novelDirector.data.load()')
  assert.equal(resolve(empty.storagePath), resolve(paths.storagePath))
  assert.deepEqual(empty.data.projects, [])
  const seeded = await ev('window.novelDirector.data.save(' + JSON.stringify({ ...empty.data, projects: data.projects,
    settings: { ...empty.data.settings, ...data.settings } }) + ')')
  assert(seeded.ok !== false)
  await c.send('Page.reload')
  await wait(el('.project-row'))
  assert.deepEqual(await ev('window.novelDirector.data.load().then(r=>r.data.projects.map(p=>p.id))'), [spec.projectId])
  await press(btn('.project-row', '进入'))
  await wait(el('.dashboard-view'))
  await press(btn('.sidebar', '设置'))
  await wait(el('.workflow-model-profile-settings'))
  await click(c, el('.workflow-model-profile-settings > summary'))
  const mode = el('select[aria-label="审稿与质量门禁模型设置方式"]')
  const proseMode = el('select[aria-label="正文创作模型设置方式"]')
  assert.equal(await ev(proseMode + '.value'), 'inherit')
  await choose(mode, 'override')
  const effort = '[...' + mode + '.closest("section").querySelectorAll("label.field")].find(l=>l.querySelector(".field-label")?.textContent==="推理强度")?.querySelector("select")'
  await choose(effort, 'high')
  const settings = () => ev('window.novelDirector.data.load().then(r=>r.data.settings)')
  for (let i = 0; i < 100 && (await settings()).pipelineModelRoles?.reviewer?.reasoningEffort !== 'high'; i++) await delay(100)
  const saved = await settings()
  assert.equal(saved.reasoningEffort ?? null, null)
  assert.deepEqual(Object.keys(saved.pipelineModelRoles), ['reviewer'])
  assert.equal(saved.pipelineModelRoles.reviewer.reasoningEffort, 'high')
  assert.equal(stub.calls.length, 0)
  await press(btn('.sidebar', '生产流水线'))
  await wait(el('.pipeline-task-editor'))
  await click(c, el('.pipeline-config-tools > summary'))
  await choose('[...document.querySelectorAll(".pipeline-config-tools select")].find(s=>s.querySelector("option[value=conservative]"))', 'conservative')
  await click(c, el('.pipeline-config-tools > summary'))
  await fill(c, el('.pipeline-task-editor [name=goal]'), '林禾在车站寄存窗找回箱子里的地图。')
  await fill(c, el('.pipeline-task-editor [name=targetWordCount]'), spec.target)
  await press(btn('.pipeline-task-editor', '保存任务'))
  await press(btn('.pipeline-task-editor', '按此任务生成'))
  await press(btn('.confirm-dialog', '启动流水线'))
  const deadline = Date.now() + 60000
  let job
  do {
    job = await ev('window.novelDirector.data.load().then(r=>r.data.chapterGenerationJobs[0])')
    if (['completed', 'failed'].includes(job?.status)) break
    await delay(200)
  } while (Date.now() < deadline)
  assert.equal(job?.status, 'completed', job?.errorMessage || 'Run did not complete')
  assert.equal(job.currentStep, 'await_user_confirmation')
  assert.equal(job.aiRunConfig.roles.prose.reasoningEffort ?? null, null)
  assert.equal(job.aiRunConfig.roles.reviewer.reasoningEffort, 'high')
  for (const kind of ['prose', 'consistency', 'quality']) assert(stub.calls.some(call => call.kind === kind), 'No HTTP request for ' + kind)
  for (const call of stub.calls) {
    assert.equal(call.status, 200)
    assert.equal(call.model, spec.sharedModel)
    const review = ['consistency', 'quality'].includes(call.kind)
    assert.deepEqual(call.parameters, review ? { reasoning_effort: 'high', max_tokens: 32768 } : { max_tokens: 4096, temperature: 0 })
  }
  output.status = 'passed'
} catch (err) {
  output.error = err.stack
  throw err
} finally {
  try {
    if (session) {
      output.cleanup = await cleanup(session)
      assert.deepEqual(output.cleanup.remainingProcessIds, [])
      assert.deepEqual(session.exceptions, [])
    }
  } catch (err) { output.status = 'failed'; output.error = err.stack; throw err }
  finally {
    await stub.close()
    await writeFile(join(work, 'result.json'), JSON.stringify(output, null, 2) + '\n')
    console.log(output.status, work, stub.calls.map(c => [c.kind, c.parameters, c.status]))
  }
}

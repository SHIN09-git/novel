#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { build } from 'esbuild'
import { repoRoot as root } from './utils/repo-root.mjs'
import { within, localPath, checkedPath, sha256, summarize, evaluate, button, ready,
  click, measureClick, key, launch, connect, cleanup } from './utils/long-novel-ui-driver.mjs'
import { targetIdentity, prepareTarget, treeManifest, verifyRuntimeIdentity } from './utils/long-novel-ui-runtime.mjs'

const help = `Production Electron long-novel UI benchmark (no build/rebuild/download).
  node scripts/benchmark-long-novel-ui.mjs --check
  node scripts/benchmark-long-novel-ui.mjs --debug-one --label debug
  node scripts/benchmark-long-novel-ui.mjs --run --label before --runs 3
  node scripts/benchmark-long-novel-ui.mjs --run --label after --packaged-dir release/win-unpacked
  node scripts/benchmark-long-novel-ui.mjs --run --label after-out --out-dir out

--run                   Explicitly authorize the full measurement in this invocation.
--debug-one             1 chapter, 1 workflow + excluded migration startup, no warmup; NOT a baseline.
--check                 Validate local artifacts/fixture only; never launch Electron.
--label NAME            Report label (default: current).
--sizes 10,100,500       Formal sizes, in order (default: all three).
--runs 3|5              Measured runs per size (default: 3), plus 1 excluded warmup.
--packaged-dir DIR       Existing unpacked package (default: release/win-unpacked).
--out-dir DIR            Isolated copy of an existing production out; never rebuilds.
--electron FILE          Existing Electron executable, only with --out-dir.
--binding-from DIR       Unpacked package supplying Electron sqlite binding for --out-dir.
--output FILE            JSON within G:/novel/tmp; default: unique run directory/report.json.
Reports retain raw warmup/measured samples, failures, logs and profiles under tmp/performance.
Cold = fresh process + fresh profile copied from migrated SQLite; OS cache is not flushed.
Agent refresh reloads seeded persisted results, NOT an external-writer freshness benchmark.
No automatic retries, no AI, no touching an author's database/profile or root native binding.`

const j = JSON.stringify
const hashText = (text) => createHash('sha256').update(text).digest('hex')
const fixturePath = join(root, 'scripts', 'fixtures', 'long-novel-performance.mjs')
const bindingRelative = join('node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
const rootBinding = join(root, bindingRelative)
const editor = "document.querySelector('textarea.manuscript-textarea')"
const saved = "document.querySelector('.chapter-body-save-state.is-saved')?.textContent === '正文已保存'"
const nav = (label) => button(label, "document.querySelector('.nav-list')")
const projectRow = (name) => `[...document.querySelectorAll('.project-row')].find(e=>e.querySelector('h3')?.textContent===${j(name)})`
const projectReady = (name) => `document.querySelector('.dashboard-view') && document.querySelector('.project-badge strong')?.textContent===${j(name)}`
const enter = (name) => button('进入', `(${projectRow(name)})`)
const bodyReady = (body) => `${editor} && !${editor}.disabled && ${editor}.value===${j(body)} && ${saved}`
const sampleLog = (text) => process.stderr.write(`[long-novel-ui] ${text}\n`)
let activeSession = null
let interrupted = null

function interrupt(signal) {
  interrupted = signal
  if (activeSession) void cleanup(activeSession).catch((error) => sampleLog(`Interrupted cleanup: ${error.message}`))
}
const onSigint = () => interrupt('SIGINT')
const onSigterm = () => interrupt('SIGTERM')

function options(argv) {
  const flags = new Set(['--run', '--debug-one', '--check', '--help'])
  const values = new Set(['--label', '--sizes', '--runs', '--packaged-dir', '--out-dir', '--electron', '--binding-from', '--output'])
  const opts = {}
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i]
    assert(!Object.hasOwn(opts, name), `Duplicate option: ${name}`)
    if (flags.has(name)) opts[name] = true
    else {
      assert(values.has(name) && argv[i + 1] && !argv[i + 1].startsWith('--'), `Unknown or incomplete option: ${name}`)
      opts[name] = argv[++i]
    }
  }
  if (opts['--help'] || !argv.length) return { help: true }
  assert(['--run', '--debug-one', '--check'].filter((flag) => opts[flag]).length === 1, 'Choose exactly one of --run, --debug-one, --check')
  assert(!(opts['--out-dir'] && opts['--packaged-dir']), 'Choose packaged or isolated out, not both')
  assert(opts['--out-dir'] || !(opts['--electron'] || opts['--binding-from']), '--electron/--binding-from require --out-dir')
  assert(!opts['--debug-one'] || !(opts['--sizes'] || opts['--runs']), '--debug-one fixes size=1, runs=1; do not override')
  const sizes = opts['--debug-one'] ? [1] : (opts['--sizes'] ?? '10,100,500').split(',').map(Number)
  assert(sizes.length && new Set(sizes).size === sizes.length && sizes.every((n) => opts['--debug-one'] ? n === 1 : [10, 100, 500].includes(n)), 'Formal sizes must be distinct members of 10,100,500')
  const runs = opts['--debug-one'] ? 1 : Number(opts['--runs'] ?? 3)
  assert(opts['--debug-one'] || [3, 5].includes(runs), 'Formal --runs must be 3 or 5')
  return { ...opts, sizes, runs, warmups: opts['--debug-one'] ? 0 : 1, label: opts['--label'] ?? 'current' }
}

async function preflight(opts) {
  assert.equal(process.platform, 'win32', 'This benchmark targets the existing Windows Electron package')
  assert(typeof WebSocket === 'function', 'Node with built-in WebSocket required (Node 22+)')
  const fixture = await checkedPath(root, fixturePath)
  const packagedDir = await checkedPath(root, opts['--binding-from'] ?? opts['--packaged-dir'] ?? 'release/win-unpacked')
  const executable = await checkedPath(root, opts['--out-dir']
    ? opts['--electron'] ?? 'node_modules/electron/dist/electron.exe'
    : join(packagedDir, 'Novel Director.exe'))
  const binding = await checkedPath(root, join(packagedDir, 'resources', 'app.asar.unpacked', bindingRelative))
  const out = opts['--out-dir'] ? await checkedPath(root, opts['--out-dir']) : null
  const required = out ? [join(out, 'main', 'index.js'), join(out, 'preload', 'index.cjs'), join(out, 'renderer', 'index.html')]
    : [join(packagedDir, 'resources', 'app.asar')]
  for (const file of required) assert((await stat(await checkedPath(root, file))).isFile())
  if (opts['--output']) {
    const output = localPath(root, opts['--output'])
    assert(within(join(root, 'tmp'), output), '--output must be inside workspace tmp')
    assert(!existsSync(output), '--output already exists; use a new filename')
  }
  const target = { mode: out ? 'isolated-out' : 'packaged', executable, packagedDir, binding, out, fixture, required }
  await targetIdentity(root, target)
  return target
}

async function normalizer() {
  // Bundle pure fixture normalization only. UI measurements always use the real app.
  const result = await build({ stdin: { contents: "export { normalizeAppData } from './src/shared/normalizers/appData';", resolveDir: root },
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' })
  const code = result.outputFiles[0].text
  const api = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  return { normalize: api.normalizeAppData, sha256: hashText(code) }
}

function makeFixture(api, normalize, count, baseUrl) {
  const raw = api.createLongNovelFixture(count)
  const rawSha256 = hashText(j(raw))
  const data = normalize(raw)
  const primary = data.projects.find((p) => p.id === api.LONG_NOVEL_PROJECT_ID)
  const secondary = data.projects.find((p) => p.id === api.LONG_NOVEL_SECOND_PROJECT_ID)
  assert(primary && secondary, 'Shared fixture must supply both projects')
  const chapters = data.chapters.filter((c) => c.projectId === primary.id && !c.archivedAt).sort((a, b) => a.order - b.order)
  assert.equal(chapters.length, count)
  const last = chapters.at(-1)
  const job = data.chapterGenerationJobs.find((item) => item.projectId === primary.id && item.targetChapterOrder === last.order)
  const draft = data.generatedChapterDrafts.find((item) => item.jobId === job?.id)
  assert(job && draft)
  // The shared storage fixture has no Agent run. Add only linked synthetic metadata.
  const agentRun = { id: 'perf-ui-agent-latest', projectId: primary.id, goal: `UI benchmark latest result ${count}`,
    mode: 'single_chapter', safetyMode: 'conservative', targetChapterOrders: [last.order], status: 'completed',
    createdJobIds: [job.id], createdDraftIds: [draft.id],
    createdCommitIds: data.chapterCommitBundles.filter((c) => c.jobId === job.id).map((c) => c.commitId),
    pendingHumanReviewItemIds: [], decisions: [], summary: `Persisted synthetic Agent result ${count}`,
    warnings: [], startedAt: '2026-09-07T00:00:00.000Z', updatedAt: '2099-01-01T00:00:00.000Z',
    completedAt: '2026-09-07T00:00:00.000Z', schemaVersion: 1 }
  data.agentRuns = [...data.agentRuns.filter((r) => r.id !== agentRun.id), agentRun]
  const model = { apiProvider: 'local', apiKey: '', hasApiKey: false, baseUrl, modelName: 'benchmark-reject-only',
    codexCliPath: '', codexCliModel: '', temperature: 0, maxTokens: 256, retryEnabled: false, maxRetries: 0, requestTimeoutMs: 1000 }
  data.settings = { ...data.settings, ...model, enableAutoSummary: false, enableChapterDiagnostics: false, theme: 'light',
    pipelineModelRoles: Object.fromEntries(['planner', 'prose', 'extraction', 'reviewer', 'revision'].map((role) => [role, { ...model }])) }
  const collections = Object.fromEntries(Object.entries(data).filter(([, value]) => Array.isArray(value)).map(([name, values]) => [name, values.length]))
  const json = j(data)
  return { data, json, primary, secondary, chapters, last, agentRun,
    metadata: { chapterCount: count, rawSha256, normalizedOverlaySha256: hashText(json), jsonBytes: Buffer.byteLength(json), collections,
      bodyCharacters: chapters.reduce((sum, chapter) => sum + chapter.body.length, 0),
      overlay: 'One completed Agent run linked to final job/draft/commits; reject-only AI settings; raw shared fixture unchanged.' } }
}

async function inspect(client, profile, fixture, expectedBody = fixture.last.body) {
  const value = await evaluate(client, `(async () => {
    const loaded = await window.novelDirector.data.load(), data = loaded.data;
    const chapter = data.chapters.find(c=>c.id===${j(fixture.last.id)});
    const run = data.agentRuns.find(r=>r.id===${j(fixture.agentRun.id)});
    const models = [data.settings,...Object.values(data.settings.pipelineModelRoles || {})];
    return { storagePath:loaded.storagePath, revision:loaded.revision,
      projectIds:data.projects.map(p=>p.id),
      collections:Object.fromEntries(Object.entries(data).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length])),
      bodyMatches:chapter?.body===${j(expectedBody)}, bodyCharacters:chapter?.body.length,
      agentMatches:run?.goal===${j(fixture.agentRun.goal)} && run?.summary===${j(fixture.agentRun.summary)},
      modelsSafe:models.every(m=>!m.apiKey && !m.hasApiKey && m.apiProvider==='local' && m.baseUrl===${j(fixture.data.settings.baseUrl)}),
      autoAiDisabled:!data.settings.enableAutoSummary && !data.settings.enableChapterDiagnostics };
  })()`)
  assert(value.storagePath.toLowerCase().endsWith('.sqlite'), 'Real SQLite storage required')
  const storagePath = await checkedPath(root, value.storagePath)
  assert(within(await checkedPath(root, profile), storagePath), 'Storage escaped this sample profile')
  assert.deepEqual(value.projectIds.slice().sort(), [fixture.primary.id, fixture.secondary.id].sort())
  for (const [name, count] of Object.entries(fixture.metadata.collections)) assert.equal(value.collections[name], count, `Persisted collection mismatch: ${name}`)
  assert(value.bodyMatches && value.agentMatches && value.modelsSafe && value.autoAiDisabled, `Persisted data check failed: ${j(value)}`)
  return value
}

function homeReady(fixture) {
  return `window.novelDirector?.data?.load && document.querySelectorAll('.project-row').length===2 && (${enter(fixture.primary.name)}) && (${enter(fixture.secondary.name)})`
}

function chapterListReady(fixture) {
  return `document.querySelector('.chapters-view') && document.querySelector('.chapter-shelf-header strong')?.textContent===${j(String(fixture.chapters.length))}
    && document.querySelectorAll('.chapters-view .list-pane > button.list-item').length===${fixture.chapters.length}`
}

function agentReady(fixture) {
  return `document.querySelector('.agent-runs-view') && document.querySelector('.agent-run-list-item.active p')?.textContent===${j(fixture.agentRun.goal)}
    && document.querySelector('.agent-run-detail')?.textContent.includes(${j(fixture.agentRun.summary)})
    && document.querySelector('.agent-chapter-card')?.textContent.includes(${j(fixture.agentRun.createdJobIds[0])})
    && (${button('读取最新结果', "document.querySelector('.agent-runs-view')")})?.disabled===false
    && document.querySelector('.agent-authorization-panel') && !document.querySelector('.agent-authorization-panel').textContent.includes('正在读取...')`
}

async function workflow(client, sample, fixture, profile) {
  const timings = sample.timings
  sample.initialStorage = await inspect(client, profile, fixture)
  timings.enterProjectMs = await measureClick(client, enter(fixture.primary.name), projectReady(fixture.primary.name))
  timings.chapterListReadyMs = await measureClick(client, nav('章节'), chapterListReady(fixture))
  const lastButton = `[...document.querySelectorAll('.chapters-view .list-pane > button.list-item')].find(e=>e.querySelector('span')?.textContent===${j(fixture.last.title)})`
  timings.selectLastChapterEditorMs = await measureClick(client, lastButton, bodyReady(fixture.last.body))
  sample.beforeEditStorage = await inspect(client, profile, fixture)

  await click(client, editor)
  await key(client, 'End', 'End', 35, 2)
  assert(await evaluate(client, `${editor}.selectionStart===${fixture.last.body.length} && ${editor}.selectionEnd===${fixture.last.body.length}`))
  const marker = '\n\n[long-novel-ui-native-edit]'
  const edited = fixture.last.body + marker
  const editStart = performance.now()
  await client.send('Input.insertText', { text: marker })
  await ready(client, bodyReady(edited))
  timings.editToSavedMs = performance.now() - editStart
  const readStart = performance.now()
  sample.savedStorage = await inspect(client, profile, fixture, edited)
  timings.savedReadbackMs = performance.now() - readStart
  timings.editToSavedReadbackMs = performance.now() - editStart
  assert.notEqual(sample.savedStorage.revision, sample.beforeEditStorage.revision, 'The body edit must persist a new storage revision')
  sample.edit = { chapterId: fixture.last.id, mode: 'native append + real 500ms debounced autosave, no blur or save IPC',
    marker, expectedBodySha256: hashText(edited), expectedBodyCharacters: edited.length }

  timings.leaveProjectMs = await measureClick(client, button('返回项目列表'), homeReady(fixture))
  timings.enterOtherProjectMs = await measureClick(client, enter(fixture.secondary.name), projectReady(fixture.secondary.name))
  timings.leaveOtherProjectMs = await measureClick(client, button('返回项目列表'), homeReady(fixture))
  timings.returnProjectMs = await measureClick(client, enter(fixture.primary.name), projectReady(fixture.primary.name))
  timings.returnChapterListMs = await measureClick(client, nav('章节'), chapterListReady(fixture))
  timings.returnEditorReadbackMs = await measureClick(client, lastButton, bodyReady(edited))
  timings.enterAgentMs = await measureClick(client, nav('Agent 批次'), agentReady(fixture))
  const beforeRefresh = await inspect(client, profile, fixture, edited)
  const refreshButton = button('读取最新结果', "document.querySelector('.agent-runs-view')")
  timings.agentRefreshPromptMs = await measureClick(client, refreshButton, "document.querySelector('.confirm-dialog-message')?.textContent.includes('尚未保存')")
  // Confirmation is a separate timed action: no human/automation think time in reload latency.
  timings.agentConfirmedReloadMs = await measureClick(client, button('重新加载', "document.querySelector('.confirm-dialog')"),
    `!document.querySelector('.confirm-dialog') && document.querySelector('.workspace-save-state strong')?.textContent==='已重新加载最新本地数据' && (${agentReady(fixture)})`)
  sample.refreshedStorage = await inspect(client, profile, fixture, edited)
  assert.equal(sample.refreshedStorage.revision, beforeRefresh.revision, 'Agent refresh must be read-only')
  sample.refresh = { mode: 'Explicit UI confirmation reload of already-persisted seeded latest result; no external writer',
    runId: fixture.agentRun.id, goal: fixture.agentRun.goal, readOnlyRevision: beforeRefresh.revision }
}

async function runSession(target, profile, fixture, sample, measured) {
  let session
  try {
    assert(!interrupted, `Interrupted: ${interrupted}`)
    session = await launch(target, profile, () => !interrupted)
    activeSession = session
    sample.pid = session.child.pid
    await connect(session)
    await ready(session.client, homeReady(fixture))
    sample.timings.processColdToReadyMs = performance.now() - session.startedAt
    sample.runtimeInfo = await evaluate(session.client, 'window.novelDirector.app.getRuntimeInfo()')
    sample.rendererUrl = await evaluate(session.client, 'location.href')
    verifyRuntimeIdentity(target, sample.runtimeInfo, sample.rendererUrl)
    if (measured) await workflow(session.client, sample, fixture, profile)
    else sample.storage = await inspect(session.client, profile, fixture)
    assert(!interrupted, `Interrupted: ${interrupted}`)
    sample.status = 'passed'
  } catch (error) {
    sample.status = 'failed'
    sample.error = error.stack
    if (session?.client) {
      try { sample.failureDom = (await evaluate(session.client, 'document.body.innerText')).slice(0, 20000) } catch { /* Renderer failed. */ }
    }
    throw error
  } finally {
    if (session) {
      try { sample.cleanup = await cleanup(session) }
      catch (error) { sample.status = 'failed'; sample.cleanupError = error.stack }
      sample.browserVersion = session.version
      sample.rendererExceptions = session.exceptions
      sample.blockedNetworkAttempts = session.networkRequests
      sample.spawnError = session.spawnError
      sample.visibilityBeforeActivation = session.visibilityBeforeActivation
      await writeFile(join(profile, 'benchmark-electron.log'), session.logs.join(''))
      if (session.exceptions.length || session.networkRequests.length) sample.status = 'failed'
    }
    activeSession = null
    if (sample.status !== 'passed') throw new Error(sample.error ?? sample.cleanupError ?? `Sample failed: ${j(sample.rendererExceptions)}`)
  }
}

async function main() {
  const opts = options(process.argv.slice(2))
  if (opts.help) { console.log(help); return }
  const target = await preflight(opts)
  if (opts['--check']) {
    console.log(j({ status: 'preflight-passed', electronLaunched: false, target, note: 'Paths only; fixture normalization and UI readiness remain unverified.' }, null, 2))
    return
  }
  const base = localPath(root, join(root, 'tmp', 'performance', 'long-novel-ui'))
  await mkdir(base, { recursive: true })
  assert(within(await checkedPath(root, join(root, 'tmp')), await checkedPath(root, base)))
  const work = await mkdtemp(join(base, 'run-'))
  const output = opts['--output'] ? localPath(root, opts['--output']) : join(work, 'report.json')
  await mkdir(dirname(output), { recursive: true })
  const tmpReal = await checkedPath(root, join(root, 'tmp'))
  const outputParent = await checkedPath(root, dirname(output))
  assert(outputParent.toLowerCase() === tmpReal.toLowerCase() || within(tmpReal, outputParent), 'Output parent escaped tmp')
  const report = { benchmark: 'production-electron-long-novel-ui', schemaVersion: 1, label: opts.label,
    status: 'running', purpose: opts['--debug-one'] ? 'debug-only-not-a-baseline' : 'baseline', startedAt: new Date().toISOString(), work,
    environment: { platform: process.platform, arch: process.arch, osRelease: os.release(), node: process.version,
      nodeAbi: process.versions.modules, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(), freeMemoryAtStartBytes: os.freemem(), viewport: { width: 1280, height: 900, scale: 1 },
      electronFlags: 'CDP loopback; DNS denied except 127.0.0.1; background networking disabled; GPU remains default' },
    methodology: { sizes: opts.sizes, warmupsPerSize: opts.warmups, measuredPerSize: opts.runs, serial: true,
      cold: 'Fresh main/renderer each run, copying only migrated SQLite into a fresh profile; no OS cache flush; migration/copy excluded.',
      ready: 'Exact project rows, project identity, chapter count, selected full body, saved-state, linked Agent result and reload-success status; conditions survive two animation frames.',
      interaction: 'CDP native mouse/key/insertText only. Scroll/hit-test preparation precedes each click timer; polling 20ms plus CDP/paint overhead is included.',
      visibility: 'Page.bringToFront before readiness to avoid background animation-frame starvation; initial visibility recorded. This activation was added after the packaged before run.',
      edit: 'One append at end of last chapter. Existing debounced autosave without blur; exact persisted body verified with read-only preload data.load.',
      observation: 'Full data.load stays inside Electron; only compact checks return. Readbacks outside UI timers except explicitly named readback metrics. No pure-function UI substitute.',
      refresh: 'Existing seeded latest Agent run + explicit native confirmation, actual reload status, equal persisted revision; no simulated external writer.',
      statistics: 'Nearest-rank p50/p95 over passed measured runs only. With n=3/5 p95 is max, not a stable population tail estimate. Warmup/raw failures retained.',
      cleanup: 'Browser.close plus owned PID inventory termination/verification; startup failure uses owned taskkill /T, never executable-name killing.',
      safety: 'New synthetic profile only; sanitized child environment; blank credentials, local reject endpoint for every model role, no AI commands; no native rebuild/swap.' },
    target, sizes: [], issues: [] }
  let server, requests = 0
  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)
  const persist = () => writeFile(output, j(report, null, 2))
  try {
    report.rootBindingBefore = existsSync(rootBinding) ? await sha256(rootBinding) : null
    await prepareTarget(root, target, work)
    report.harness = Object.fromEntries(await Promise.all(['scripts/benchmark-long-novel-ui.mjs',
      'scripts/utils/long-novel-ui-driver.mjs', 'scripts/utils/long-novel-ui-runtime.mjs'].map(async (path) => [path, await sha256(join(root, path))])))
    const api = await import(pathToFileURL(fixturePath).href)
    const norm = await normalizer()
    report.fixture = { path: fixturePath, sha256: await sha256(fixturePath), version: api.LONG_NOVEL_FIXTURE_VERSION,
      normalizerBundleSha256: norm.sha256 }
    server = createServer((req, res) => { requests++; res.writeHead(403); res.end('Benchmark forbids AI') })
    await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
    report.aiRejectEndpoint = baseUrl
    for (const count of opts.sizes) {
      assert(!interrupted, `Interrupted: ${interrupted}`)
      const fixture = makeFixture(api, norm.normalize, count, baseUrl)
      const scale = { ...fixture.metadata, bootstrap: { status: 'running', timings: {} }, samples: [], aggregate: null }
      report.sizes.push(scale)
      const seed = await mkdtemp(join(work, `seed-${count}-`))
      await writeFile(join(seed, 'novel-director-data.json'), fixture.json)
      sampleLog(`${count} chapters: isolated migration (excluded)`)
      await runSession(target, seed, fixture, scale.bootstrap, false)
      scale.seedDatabaseBytes = (await stat(scale.bootstrap.storage.storagePath)).size
      scale.seedDatabaseSha256 = await sha256(scale.bootstrap.storage.storagePath)
      for (let i = 0; i < opts.warmups + opts.runs; i++) {
        assert(!interrupted, `Interrupted: ${interrupted}`)
        const phase = i < opts.warmups ? 'warmup' : opts['--debug-one'] ? 'debug' : 'measured'
        const sample = { phase, index: i < opts.warmups ? i + 1 : i - opts.warmups + 1, status: 'running', timings: {} }
        scale.samples.push(sample)
        const profile = await mkdtemp(join(work, `profile-${count}-${phase}-`))
        sample.profile = profile
        // Never copy app-config.json: it may point back to the seed's absolute path.
        const source = scale.bootstrap.storage.storagePath
        await copyFile(source, join(profile, 'novel-director-data.sqlite'))
        for (const suffix of ['-wal', '-shm']) {
          assert(!existsSync(`${source}${suffix}`) || (await stat(`${source}${suffix}`)).size === 0,
            `Seed still has a live SQLite sidecar ${suffix}; refuse an inconsistent copy`)
        }
        sampleLog(`${count} chapters: ${phase} ${sample.index}`)
        await persist()
        await runSession(target, profile, fixture, sample, true)
        await persist()
      }
      const measured = scale.samples.filter((s) => s.phase === 'measured' && s.status === 'passed')
      if (measured.length === opts.runs) scale.aggregate = Object.fromEntries(Object.keys(measured[0].timings)
        .map((name) => [name, summarize(measured.map((sample) => sample.timings[name]))]))
    }
    assert(!interrupted, `Interrupted: ${interrupted}`)
    if (target.out) {
      assert.deepEqual(await treeManifest(target.runtimeRoot), target.isolatedManifest, 'Isolated runtime files changed during benchmark')
      report.isolatedRuntimeUnchanged = true
    }
    report.status = 'passed'
  } catch (error) {
    report.status = 'failed'
    report.issues.push(error.stack)
  } finally {
    if (server) { server.closeAllConnections(); await new Promise((done) => server.close(done)) }
    report.aiRequestCount = requests
    if (requests) report.issues.push(`Forbidden AI requests: ${requests}`)
    report.rootBindingAfter = existsSync(rootBinding) ? await sha256(rootBinding) : null
    if (report.rootBindingBefore !== report.rootBindingAfter) report.issues.push('Root native binding changed during the run (benchmark never writes it)')
    if (report.issues.length) report.status = 'failed'
    report.finishedAt = new Date().toISOString()
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
    await persist()
    console.log(j({ status: report.status, purpose: report.purpose, output, issues: report.issues,
      scales: report.sizes.map((scale) => ({ chapters: scale.chapterCount, aggregate: scale.aggregate })) }, null, 2))
    if (report.status !== 'passed') process.exitCode = 1
  }
}

main().catch((error) => { console.error(error.stack); process.exitCode = 1 })

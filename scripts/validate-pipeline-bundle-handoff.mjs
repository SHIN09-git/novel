#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'
import { artifactCollections, assertDataRecords, assertRecords, checkpointData, createHookHost, handoffPlugin,
  initialData, unrelatedData, withDeadline } from './utils/pipeline-bundle-handoff-fixture.mjs'

const tempRoot = join(repoRoot, 'tmp')
await mkdir(tempRoot, { recursive: true })
const outDir = await mkdtemp(join(tempRoot, 'pipeline-bundle-handoff-'))
const handles = new Set(), originalWindow = globalThis.window, originalDocument = globalThis.document, originalFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('Network forbidden in pipeline handoff fixture.') }
globalThis.document = { documentElement: { dataset: {} } }
let checks = 0, nativeChecks = 0, fixtureId = 0, NativeDatabase, skipReason = ''
const test = async (label, run) => { await run(); checks++; console.log(`PASS ${label}`) }
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }

try {
  if (process.versions.electron) throw new Error('Use Node, not Electron, for this fixture.')
  try {
    const Database = createRequire(import.meta.url)('better-sqlite3'), probe = new Database(':memory:')
    try { assert.ok(probe.prepare('SELECT sqlite_version() AS version').get().version); NativeDatabase = Database }
    finally { probe.close() }
  } catch (error) {
    skipReason = `Node ${process.version} ABI ${process.versions.modules}: ${error.message ?? error}`
    if (process.argv.includes('--require-native')) throw new Error(`Required native SQLite unavailable: ${skipReason}`)
    console.log(`SKIP native SQLite: ${skipReason}. No rebuild or fallback.`)
  }
  await test('App passes the useAppData bundle callback into GenerationPipelineView', async () => {
    const path = join(repoRoot, 'src/renderer/src/App.tsx'), source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let passed = false, sourced = false
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && ts.isCallExpression(node.initializer) &&
        node.initializer.expression.getText(source) === 'useAppData') sourced = node.name.elements.some((item) => item.name.getText(source) === 'saveGenerationRunBundle')
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === 'GenerationPipelineView') {
        passed = node.attributes.properties.some((item) => ts.isJsxAttribute(item) && item.name.getText(source) === 'saveGenerationRunBundle' &&
          item.initializer && ts.isJsxExpression(item.initializer) && item.initializer.expression?.getText(source) === 'saveGenerationRunBundle')
      }
      ts.forEachChild(node, visit)
    }
    visit(source); assert.ok(sourced && passed, 'App must hand off the actual useAppData callback')
  })
  const outfile = join(outDir, 'api.mjs')
  await build({ stdin: { contents: `
    import './src/preload/index';
    export {useAppData} from './src/renderer/src/hooks/useAppData';
    export {GenerationPipelineView} from './src/renderer/src/views/GenerationPipelineView';
    export {registerDataIpcHandlers} from './src/main/ipc/dataIpcHandlers';
    export {normalizeAppData} from './src/shared/defaults';
    export {SqliteStorageService} from './src/storage/SqliteStorageService';
    export {JsonStorageService} from './src/storage/JsonStorageService';
    export {IPC_CHANNELS} from './src/shared/ipc/ipcChannels';
  `, resolveDir: repoRoot, loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', jsx: 'automatic',
    external: ['better-sqlite3', 'electron'], logLevel: 'silent', plugins: [handoffPlugin(repoRoot)] })

  async function harness(kind, legacy = false) {
    const dir = join(outDir, `fixture-${++fixtureId}`); await mkdir(dir)
    const env = { hooks: createHookHost(), handlers: new Map(), calls: [], engineCalls: 0, engineCompleted: false }
    globalThis.__pipelineHandoff = env; globalThis.window = {}
    const api = await import(`${pathToFileURL(outfile).href}?fixture=${fixtureId}`)
    const storagePath = join(dir, kind === 'json' ? 'data.json' : 'data.sqlite')
    const newStorage = () => {
      const storage = kind === 'json' ? new api.JsonStorageService(storagePath) : new api.SqliteStorageService(storagePath)
      if (kind !== 'json') handles.add(storage)
      return storage
    }
    let storage = newStorage()
    const initial = initialData(api)
    await storage.save(initial)
    const initialSnapshot = await storage.loadSnapshot()
    api.registerDataIpcHandlers({ getStorage: () => storage, backupService: { maybeCreateAutomaticBackup: async () => null },
      credentialService: { hasApiKey: async () => false, migrateLegacyApiKey: async () => { throw new Error('Credential migration forbidden') } } })
    env.invoke = async (channel, request) => {
      const call = { channel, request: structuredClone(request) }
      env.calls.push(call)
      if (env.beforeInvoke) await env.beforeInvoke(channel, request)
      const handler = env.handlers.get(channel)
      if (!handler) throw new Error(`Unexpected IPC channel ${channel}`)
      const response = await handler({}, request)
      call.response = structuredClone(response)
      return response
    }
    if (legacy) delete window.novelDirector.data.saveGenerationRunBundle
    let app = env.hooks.render('app', () => api.useAppData())
    env.hooks.flushEffects()
    for (let i = 0; i < 100 && !app.getCurrentData().projects.length; i++) await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal(app.getCurrentData().projects.length, 2)
    const render = () => {
      app = env.hooks.render('app', () => api.useAppData()); env.hooks.flushEffects()
      env.hooks.render('view', () => api.GenerationPipelineView({ data: app.getCurrentData(), project: app.getCurrentData().projects.find((item) => item.id === 'p1'),
        saveData: app.saveData, saveGenerationRunBundle: app.saveGenerationRunBundle }))
      env.hooks.flushEffects()
      return env.runner
    }
    env.engine = async (working, jobId, _step, _options, runtime) => {
      env.engineCalls++
      env.checkpointBefore = await storage.loadSnapshot()
      env.memoryBeforeCheckpoint = structuredClone(app.getCurrentData())
      env.expected = checkpointData(api, working, jobId)
      await runtime.persistWorking(env.expected, jobId)
      env.engineCompleted = true
    }
    render()
    assert.equal(env.runnerArgs.saveGenerationRunBundle, app.saveGenerationRunBundle, 'View must pass the exact dedicated callback to the real runner')
    const close = () => { storage.close?.(); handles.delete(storage) }
    const reopen = async () => { close(); storage = newStorage(); return storage.loadSnapshot() }
    return { env, api, initialSnapshot, storagePath, render, close, reopen, snapshot: () => storage.loadSnapshot(), get app() { return app },
      edit: async (fn) => {
        const other = newStorage()
        try { const current = await other.loadSnapshot(); fn(current.data); return await other.saveIfCurrent(current.data, current.revision) }
        finally { other.close?.(); handles.delete(other) }
      } }
  }
  function assertArtifacts(h, data) {
    const expected = h.env.expected
    for (const collection of artifactCollections) {
      assertRecords(data[collection], expected[collection], `${collection} must survive write and reopen`)
    }
    const job = data.chapterGenerationJobs.find((item) => item.id === h.env.selectedJobId)
    assert.equal(job.projectId, 'p1'); assert.equal(job.status, 'completed'); assert.equal(job.currentStep, 'await_user_confirmation')
    const needs = data.contextNeedPlans.filter((item) => item.projectId === 'p1')
    const budgets = data.contextBudgetProfiles.filter((item) => item.projectId === 'p1')
    assert.equal(needs.length, 2); assert.equal(budgets.length, 2)
    const trace = data.generationRunTraces.find((item) => item.jobId === job.id)
    assert.ok(trace.contextWarnings.includes('TRACE_HANDOFF_MARKER'))
    assert.equal(trace.contextNeedPlanId, needs.find((item) => item.chapterIntent === 'NEEDS_derived').id)
    const outputs = new Map(data.chapterGenerationSteps.filter((step) => step.jobId === job.id && step.status === 'completed')
      .map((step) => [step.type, JSON.parse(step.output)]))
    assert.equal(outputs.size, 4)
    assert.equal(outputs.get('context_need_planning').id, needs.find((item) => item.chapterIntent === 'NEEDS_base').id)
    assert.equal(outputs.get('context_need_planning_from_plan').derivedContextNeedPlan.id, trace.contextNeedPlanId)
    for (const [type, suffix] of [['context_budget_selection', 'base'], ['context_budget_selection_delta', 'delta']]) {
      assert.equal(outputs.get(type).profile.id, budgets.find((item) => item.name === `BUDGET_${suffix}`).id)
      assert.equal(outputs.get(type).profile.maxTokens, 3456)
    }
    assertDataRecords(unrelatedData(data), unrelatedData(h.initialSnapshot.data))
  }
  for (const kind of ['json', ...(NativeDatabase ? ['sqlite-native'] : [])]) {
    for (const legacy of [false, true]) {
      await test(`${kind}: ${legacy ? 'old bridge fallback' : 'dedicated IPC'} reopens jobs/steps/needs/budgets/trace and preserves unrelated project`, async () => {
        const h = await harness(kind, legacy)
        try {
          await h.env.runner.runPipeline()
          assert.equal(h.env.engineCompleted, true)
          const saved = await h.reopen(); assertArtifacts(h, saved.data)
          const bundleCalls = h.env.calls.filter((call) => call.channel === h.api.IPC_CHANNELS.DATA_SAVE_GENERATION_RUN_BUNDLE)
          const fullCalls = h.env.calls.filter((call) => call.channel === h.api.IPC_CHANNELS.STORAGE_SAVE)
          assert.equal(bundleCalls.length, legacy ? 0 : 2)
          assert.equal(fullCalls.length, legacy ? 2 : 0, 'Never full-save when the dedicated method exists')
          const writes = legacy ? fullCalls : bundleCalls
          assert.ok(writes.every((call) => typeof call.request.expectedRevision === 'string'))
          assert.notEqual(writes[0].request.expectedRevision, writes[1].request.expectedRevision, 'Preload must advance revision between queued writes')
          assert.equal(writes[0].request.expectedRevision, h.initialSnapshot.revision)
          assert.equal(writes[1].request.expectedRevision, writes[0].response.revision)
          assert.equal(saved.revision, writes[1].response.revision)
          if (!legacy) {
            const bundle = bundleCalls[1].request.bundle
            assert.equal(bundle.jobId, h.env.selectedJobId); assert.equal(bundle.projectId, 'p1')
            assert.ok(bundle.steps.length > 4)
            assert.ok(bundle.steps.every((step) => step.jobId === bundle.jobId))
            assert.equal(bundle.contextNeedPlans.length, 2); assert.equal(bundle.contextBudgetProfiles.length, 2)
            assert.ok([...bundle.contextNeedPlans, ...bundle.contextBudgetProfiles].every((item) => item.projectId === 'p1'))
            assert.equal(bundle.runTrace.jobId, bundle.jobId)
          }
          assertDataRecords(h.api.normalizeAppData(h.app.getCurrentData()), saved.data)
          assert.equal(h.render().isPipelineRunning, false)
          assert.match(h.app.status, /已保存/)
          if (kind === 'sqlite-native') nativeChecks++
        } finally { h.close() }
      })
      await test(`${kind}: ${legacy ? 'legacy save' : 'dedicated method'} failure leaves memory/disk unchanged and no false success`, async () => {
        const h = await harness(kind, legacy)
        try {
          const before = await h.snapshot(), memory = structuredClone(h.app.getCurrentData())
          h.env.beforeInvoke = (channel) => {
            if (channel !== h.api.IPC_CHANNELS.STORAGE_GET) throw new Error('FIXTURE_SAVE_FAILURE')
          }
          await h.env.runner.runPipeline()
          const runner = h.render()
          assert.match(runner.pipelineMessage, /FIXTURE_SAVE_FAILURE/); assert.equal(runner.isPipelineRunning, false)
          assert.match(h.app.status, /保存失败/); assert.doesNotMatch(h.app.status, /已保存/)
          assert.equal(h.env.engineCalls, 0); assert.equal(h.env.engineCompleted, false)
          assert.deepEqual(h.app.getCurrentData(), memory); assert.deepEqual(await h.reopen(), before)
          assert.equal(h.env.calls.filter((call) => call.channel === h.api.IPC_CHANNELS.STORAGE_SAVE).length, legacy ? 1 : 0)
          if (kind === 'sqlite-native') nativeChecks++
        } finally { h.close() }
      })
    }
    await test(`${kind}: shared queue serializes checkpoint then functional save without dropping run artifacts`, async () => {
      const h = await harness(kind)
      const blocked = deferred(), release = deferred()
      let running, later
      try {
        h.env.beforeInvoke = async (channel, request) => {
          if (channel === h.api.IPC_CHANNELS.DATA_SAVE_GENERATION_RUN_BUNDLE && request.bundle.contextNeedPlans.length) {
            blocked.resolve(); await release.promise
          }
        }
        running = h.env.runner.runPipeline()
        await withDeadline(blocked.promise, 'checkpoint entering shared queue')
        later = h.app.saveData((data) => ({ ...data, projects: data.projects.map((item) => item.id === 'p1' ? { ...item, name: 'Queued author edit' } : item) }))
        await Promise.resolve()
        assert.equal(h.env.calls.filter((call) => call.channel === h.api.IPC_CHANNELS.STORAGE_SAVE).length, 0)
        release.resolve(); await running; assert.equal((await later).ok, true)
        const saved = await h.reopen(); assertArtifacts(h, saved.data)
        assert.equal(saved.data.projects.find((item) => item.id === 'p1').name, 'Queued author edit')
        assertDataRecords(h.api.normalizeAppData(h.app.getCurrentData()), saved.data)
        const writes = h.env.calls.filter((call) => call.channel !== h.api.IPC_CHANNELS.STORAGE_GET)
        assert.deepEqual(writes.map((call) => call.channel), [h.api.IPC_CHANNELS.DATA_SAVE_GENERATION_RUN_BUNDLE,
          h.api.IPC_CHANNELS.DATA_SAVE_GENERATION_RUN_BUNDLE, h.api.IPC_CHANNELS.STORAGE_SAVE])
        assert.equal(writes[2].request.expectedRevision, writes[1].response.revision)
        if (kind === 'sqlite-native') nativeChecks++
      } finally { release.resolve(); await Promise.allSettled([running, later]); h.close() }
    })
    for (const legacy of [false, true]) for (const stage of ['initial', 'checkpoint']) {
      await test(`${kind}: ${legacy ? 'legacy' : 'dedicated'} ${stage} revision conflict preserves external writer; no bypass`, async () => {
      const h = await harness(kind, legacy)
      try {
        const channel = legacy ? h.api.IPC_CHANNELS.STORAGE_SAVE : h.api.IPC_CHANNELS.DATA_SAVE_GENERATION_RUN_BUNDLE
        let current, memory, writes = 0
        h.env.beforeInvoke = async (called) => {
          if (called !== channel || ++writes !== (stage === 'initial' ? 1 : 2)) return
          memory = structuredClone(h.app.getCurrentData())
          await h.edit((data) => { data.chapters.find((item) => item.id === 'foreign-chapter').body = 'EXTERNAL_AUTHOR_EDIT' })
          current = await h.snapshot()
        }
        await h.env.runner.runPipeline()
        assert.ok(current, 'External writer must actually run')
        assert.equal(h.env.engineCalls, stage === 'initial' ? 0 : 1)
        assert.equal(h.env.engineCompleted, false); assert.equal(h.render().isPipelineRunning, false)
        assert.match(h.app.status, /失败/); assert.equal(h.app.hasStorageConflict, true)
        const writeCalls = h.env.calls.filter((call) => call.channel !== h.api.IPC_CHANNELS.STORAGE_GET)
        assert.equal(writeCalls.length, stage === 'initial' ? 1 : 2)
        assert.ok(writeCalls.every((call) => call.channel === channel))
        const failed = writeCalls.at(-1)
        assert.equal(failed.response.ok, false); assert.equal(failed.response.code, 'STORAGE_REVISION_CONFLICT')
        assert.notEqual(failed.request.expectedRevision, current.revision)
        assert.deepEqual(h.app.getCurrentData(), memory, 'Rejected checkpoint must not enter renderer memory')
        assert.deepEqual(await h.reopen(), current)
        // A retry must retain the old revision until an explicit reload, not adopt the conflict revision.
        const retry = await h.app.saveData((data) => data)
        assert.equal(retry.ok, false)
        assert.equal(h.env.calls.at(-1).request.expectedRevision, failed.request.expectedRevision)
        assert.deepEqual(await h.reopen(), current)
        assert.equal((await h.app.reloadData()).ok, true)
        assertDataRecords(h.app.getCurrentData(), current.data)
        assert.equal(h.render().isPipelineRunning, false); assert.equal(h.app.hasStorageConflict, false)
        if (kind === 'sqlite-native') nativeChecks++
      } finally { h.close() }
      })
    }
  }
  if (NativeDatabase) {
    for (const collection of ['contextNeedPlans', 'contextBudgetProfiles', 'generationRunTraces']) {
    await test(`sqlite-native: ${collection} INSERT failure rolls back whole checkpoint and queue recovers`, async () => {
      const h = await harness('sqlite-native')
      try {
        assert.equal((await readFile(h.storagePath)).subarray(0, 16).toString(), 'SQLite format 3\0')
        const db = new NativeDatabase(h.storagePath)
        try { db.exec(`CREATE TRIGGER fail_checkpoint BEFORE INSERT ON entities WHEN NEW.collection = '${collection}' BEGIN SELECT RAISE(ABORT, 'FIXTURE_CHECKPOINT_FAILURE'); END`) }
        finally { db.close() }
        await h.env.runner.runPipeline()
        assert.equal(h.env.engineCalls, 1)
        assert.equal(h.env.engineCompleted, false)
        assert.match(h.render().pipelineMessage, /FIXTURE_CHECKPOINT_FAILURE/)
        assert.equal(h.env.calls.at(-1).response.ok, false)
        assert.equal(h.render().isPipelineRunning, false)
        assert.match(h.app.status, /保存失败/); assert.equal(h.app.hasStorageConflict, false)
        const after = await h.reopen()
        assert.deepEqual(after, h.env.checkpointBefore, 'All entities AND revision must roll back')
        const data = after.data
        assert.equal(data.chapterGenerationJobs.find((job) => job.id === h.env.selectedJobId).status, 'running')
        assert.deepEqual(h.app.getCurrentData(), h.env.memoryBeforeCheckpoint)
        assertDataRecords(h.api.normalizeAppData(h.app.getCurrentData()), data)
        assertDataRecords(unrelatedData(data), unrelatedData(h.initialSnapshot.data))
        assert.equal(h.env.calls.filter((call) => call.channel === h.api.IPC_CHANNELS.STORAGE_SAVE).length, 0)
        const repairDb = new NativeDatabase(h.storagePath)
        try { repairDb.exec('DROP TRIGGER fail_checkpoint') } finally { repairDb.close() }
        const recovered = await h.app.saveData((current) => ({ ...current,
          projects: current.projects.map((project) => project.id === 'p1' ? { ...project, name: 'Save after rollback' } : project) }))
        assert.equal(recovered.ok, true, 'Rejected checkpoint must not poison the shared queue')
        assert.equal(h.env.calls.at(-1).request.expectedRevision, after.revision)
        const recoveredData = (await h.reopen()).data
        for (const key of artifactCollections) assertRecords(recoveredData[key], data[key], `${key}: no failed checkpoint leakage`)
        assert.equal(recoveredData.projects.find((project) => project.id === 'p1').name, 'Save after rollback')
        assertDataRecords(unrelatedData(recoveredData), unrelatedData(h.initialSnapshot.data))
        nativeChecks++
      } finally { h.close() }
    })
    }
  }
  assert.equal(handles.size, 0)
  if (!NativeDatabase) process.exitCode = 1
  console.log(`Pipeline bundle handoff ${NativeDatabase ? 'passed' : 'INCOMPLETE: native SQLite unavailable'} (${checks} checks; ${nativeChecks} real native SQLite checks). App: AST guard. View/runner/queue/preload/main handler/storage: real code. React/Electron shell and AI engine: fixture; no UI QA.`)
  console.log(NativeDatabase ? `Node ${process.version} ABI ${process.versions.modules}; all native handles closed.` : `Native SKIP: ${skipReason}`)
} finally {
  for (const handle of handles) { try { handle.close() } finally { handles.delete(handle) } }
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow
  if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument
  globalThis.fetch = originalFetch
  delete globalThis.__pipelineHandoff
  const child = relative(tempRoot, outDir)
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Refusing cleanup outside isolated fixture root.')
  await rm(outDir, { recursive: true, force: true })
}

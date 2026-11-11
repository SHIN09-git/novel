#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mock } from 'node:test'
import Database from 'better-sqlite3'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = join(repoRoot, 'tmp')
await mkdir(root, { recursive: true })
const dir = await mkdtemp(join(root, 'batch-writeback-'))
const originalFetch = globalThis.fetch
const originalRegistry = process.env.NOVEL_DIRECTOR_API_REGISTRY
const originalKey = process.env.NOVEL_DIRECTOR_API_KEY
const projectId = 'batch-fixture'
const agentRunId = 'batch-65-96'
const endpoint = 'http://127.0.0.1:9/v1'
const at = (second) => new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString()
let send = null
let requests = 0
let plannerCalls = 0
globalThis.fetch = async (url, options) => {
  requests++
  assert.equal(String(url), endpoint + '/chat/completions')
  assert.ok(send, 'Blocked chapter work must not invoke even the model double.')
  return send(options)
}

function draft(job, suffix) {
  return { id: 'draft-' + suffix, projectId, jobId: job.id, chapterId: null, title: '稿件 ' + suffix,
    body: '本次虚构正文：' + suffix + '。', summary: '', status: 'draft', tokenEstimate: 10, createdAt: at(0), updatedAt: at(0) }
}

function accept(api, data, order, suffix = String(order), time = 10) {
  return api.buildAcceptedDraftCommitBundle({ appData: data, projectId, targetChapterOrder: order, draftId: 'draft-' + suffix,
    commitId: 'accept-' + suffix, chapterId: 'chapter-' + order, acceptedAt: at(time), acceptanceMode: 'unreviewed' })
}

function addManualCandidate(data, suffix) {
  const session = { id: 'session-' + suffix, projectId, chapterId: 'chapter-66', sourceDraftId: null,
    status: 'active', createdAt: at(60), updatedAt: at(60) }
  const request = { id: 'request-' + suffix, sessionId: session.id, type: 'custom', targetRange: '',
    instruction: '作者手工修订。', createdAt: at(60) }
  const version = { id: 'candidate-' + suffix, sessionId: session.id, requestId: request.id, title: '手工修订',
    body: '候选正文：' + suffix, status: 'pending', changedSummary: '', risks: '', preservedFacts: '', createdAt: at(60), updatedAt: at(60) }
  return { ...data, revisionSessions: [...data.revisionSessions, session], revisionRequests: [...data.revisionRequests, request],
    revisionVersions: [...data.revisionVersions, version] }
}

function fixture(api) {
  const base = api.normalizeAppData({ projects: [{ id: projectId, name: '连写测试' }],
    chapters: [{ id: 'chapter-92', projectId, order: 92, title: '导入', body: '导入旧书的正文。', createdAt: at(0), updatedAt: at(0) }],
    settings: { apiProvider: 'local', baseUrl: endpoint, modelName: 'fixture-only', retryEnabled: false, maxRetries: 0 } })
  const prepare = (count) => api.AgentRunService.prepareSequentialChapterRun({
    appData: base, projectId, targetChapterOrder: 65, chapterCount: count, agentRunId
  })
  for (const count of [5, 10, 40]) {
    const registered = prepare(count)
    assert.equal(registered.agentRun.targetChapterOrders.length, count)
    assert.equal(registered.agentRun.createdJobIds.length, 1)
  }
  const prepared = prepare(32)
  const orders = prepared.agentRun.targetChapterOrders
  // An older client already ran later chapters. A job for chapter 95 is not evidence for 66 or 92.
  const jobs = orders.map(order => ({ ...prepared.job, id: 'job-' + order, targetChapterOrder: order,
    status: order === 96 ? 'failed' : 'completed', currentStep: order === 96 ? 'generate_chapter_plan' : 'await_user_confirmation' }))
  const outside = { ...jobs[1], id: 'outside-batch-66' }
  let data = { ...base, chapterGenerationJobs: [outside, ...jobs],
    agentRuns: [{ ...prepared.agentRun, createdJobIds: jobs.map(job => job.id), createdDraftIds: [], createdCommitIds: [] }],
    chapterGenerationSteps: [{ ...prepared.steps.find(step => step.type === 'generate_chapter_plan'), jobId: 'job-96', status: 'failed' }],
    generatedChapterDrafts: [draft(outside, 'outside'), ...jobs.map(j => draft(j, j.targetChapterOrder))] }
  data = api.applyChapterCommitBundleToAppData(data, accept(api, data, 66, 'outside', 5))
  for (const order of orders.filter(n => ![66, 92, 96].includes(n))) {
    data = api.applyChapterCommitBundleToAppData(data, accept(api, data, order))
  }
  return data
}

async function checkBackend(api, kind) {
  const folder = join(dir, kind)
  const userDataPath = join(folder, 'profile')
  await mkdir(userDataPath, { recursive: true })
  const storagePath = join(folder, 'book.' + kind)
  const opts = { storagePath, userDataPath }
  const storage = kind === 'json' ? new api.JsonStorageService(storagePath) : new api.SqliteStorageService(storagePath)
  const open = () => api.loadAgentRuntimeData(opts)
  const call = async (name, args = {}) => (await api.AgentToolService.callTool({ name: 'agent.' + name,
    arguments: { ...opts, ...args } })).data
  const summary = () => call('getAgentRunSummary', { agentRunId })
  const retry = (runtime) => api.executeAgentChapterPipeline({ appData: runtime.data, runtime, agentRunId, jobId: 'job-96' })
  const mutate = async (changes) => {
    const { data, revision } = await open()
    await storage.saveIfCurrent(changes(data), revision)
  }
  const failedWriter = api.observeFormalChapterWrites({
    async saveRevisionCommitBundle(_bundle, _revision, writeStarted) {
      writeStarted()
      throw new Error('fixture write failed')
    },
    recordChapterWritebackFailureIfUncommitted: failure => storage.recordChapterWritebackFailureIfUncommitted(failure)
  })
  const manual = (data, suffix, time) => api.buildRevisionCommitBundle({ appData: data, projectId, chapterId: 'chapter-66',
    revisionCommitId: 'commit-' + suffix, newChapterVersionId: 'version-' + suffix, revisionVersionId: 'candidate-' + suffix,
    revisionSessionId: 'session-' + suffix, revisedBy: 'user', revisedAt: at(time) })
  const edit = (chapterOrder) => ({ projectId, agentRunId, chapterOrder, reason: '准备本批下一章。',
    operationId: 'prepare-' + chapterOrder, sourceJobId: null, sourceSnapshotId: null,
    task: { ...api.createEmptyChapterTask(), goal: '继续核对日志。', targetWordCount: '1000' },
    pipelineMode: 'standard', budgetMode: 'standard', budgetMaxTokens: 8000 })
  const assertBlocked = async (order, expectedDraft, action) => {
    const rev = (await open()).revision
    const calls = requests
    await assert.rejects(action, error => error.message.includes('第 ' + order + ' 章') && error.message.includes(expectedDraft))
    assert.equal((await open()).revision, rev, 'A refused entry must not reset steps or write a new job.')
    assert.equal(requests, calls, 'No new provider request is allowed on rejection.')
  }
  try {
    await storage.save(fixture(api))
    const start = await open()
    assert.equal(start.source, kind)
    const first = await summary()
    assert.equal(first.nextChapterOrder, 66)
    assert.equal(first.nextTarget.jobId, 'job-66')
    assert.equal(first.nextTarget.draftId, 'draft-66')
    assert.notEqual(first.nextTarget.draftId, 'draft-outside')
    assert.throws(() => api.AgentRunService.prepareSingleChapterRun({ appData: start.data, projectId, agentRunId, targetChapterOrder: 96 }), /第 66 章/)
    assert.throws(() => api.AgentRunService.prepareSingleChapterRun({ appData: start.data, projectId, targetChapterOrder: 96,
      targetChapterOrders: [92, 96] }), /第 92 章/)
    await assertBlocked(66, 'draft-66', () => call('previewChapterTaskEdit', edit(96)))
    await assertBlocked(66, 'draft-66', () => call('applyChapterTaskEdit', {
      ...edit(96), expectedRevision: start.revision, expectedPreviewHash: 'stale-preview' }))
    await assertBlocked(66, 'draft-66', () => call('retryChapterPipeline', { agentRunId, jobId: 'job-96' }))
    await assertBlocked(66, 'draft-66', () => call('retryChapterPipeline', { agentRunId, jobId: 'job-66' }))
    await assertBlocked(66, 'draft-66', () => retry(start))
    assert.deepEqual((await call('getProjectAuthorization', { projectId })).grants, [])

    const standalone = await call('startAgentRun', { projectId, chapterOrder: 106 })
    assert.deepEqual(standalone.agentRun.targetChapterOrders, [106], 'A new, intentionally nonsequential run remains independent.')
    await assertBlocked(106, standalone.job.id, () => call('previewChapterTaskEdit', { ...edit(107), agentRunId: standalone.agentRun.id }))
    const another = await call('continueAgentRun', { projectId, startChapterOrder: 110, chapterCount: 10 })
    assert.equal(another.createdJobCount, 1)
    assert.notEqual(another.agentRun.id, agentRunId)
    const before66 = await open()
    const receipt66 = accept(api, before66.data, 66, '66', 20)
    await storage.saveChapterCommitBundle(receipt66, before66.revision)
    assert.equal((await summary()).nextChapterOrder, 92, 'Chapter 91 and chapters 93-95 have receipts, but 92 only has imported prose.')
    await assertBlocked(92, 'draft-92', () => retry(before66))
    await mutate(data => ({ ...data, chapterVersions: data.chapterVersions.filter(v => v.id !== receipt66.chapterVersion.id) }))
    assert.equal((await summary()).nextChapterOrder, 66, 'An embedded version in the receipt cannot replace the persisted version.')
    await mutate(data => ({ ...data, chapterVersions: [...data.chapterVersions, receipt66.chapterVersion] }))
    await mutate(data => ({ ...data, agentRuns: data.agentRuns.map(run => run.id === agentRunId
      ? { ...run, createdJobIds: run.createdJobIds.filter(id => id !== 'job-92') } : run) }))
    assert.equal((await summary()).nextTarget.jobId, null, 'A job not registered in this batch cannot satisfy a missing target.')
    await mutate(data => ({ ...data, agentRuns: data.agentRuns.map(run => run.id === agentRunId
      ? { ...run, createdJobIds: [...run.createdJobIds, 'job-92'] } : run) }))

    const before92 = await open()
    await storage.saveChapterCommitBundle(accept(api, before92.data, 92, '92', 21), before92.revision)
    const beforeRevision = await open()
    const revision = api.buildRevisionCommitBundle({ appData: beforeRevision.data, projectId, chapterId: 'chapter-66',
      revisionCommitId: 'previous-manual-66', newChapterVersionId: 'previous-version-66', afterText: '经确认的后续修订。', revisedAt: at(30) })
    await storage.saveRevisionCommitBundle(revision, beforeRevision.revision)
    assert.equal((await summary()).nextChapterOrder, 96, 'A legitimate later revision does not undo the original job acceptance.')
    const beforeRestore = await open()
    const restore = api.buildRestoreRevisionCommitBundle({ appData: beforeRestore.data, projectId, chapterId: 'chapter-66',
      revisionCommitId: 'restore-66', newChapterVersionId: 'version-restore-66', sourceVersionId: receipt66.chapterVersion.id, restoredAt: at(40) })
    await storage.saveRevisionCommitBundle(restore, beforeRestore.revision)
    assert.equal((await summary()).nextChapterOrder, 96)
    await mutate(data => ({ ...data, generatedChapterDrafts: [...data.generatedChapterDrafts,
      { ...draft(data.chapterGenerationJobs.find(job => job.id === 'job-92'), 'regenerated-92'), createdAt: at(41), updatedAt: at(41) }] }))
    await assertBlocked(92, 'draft-regenerated-92', () => call('retryChapterPipeline', { agentRunId, jobId: 'job-96' }))
    const regenerated = await open()
    await storage.saveChapterCommitBundle(accept(api, regenerated.data, 92, 'regenerated-92', 45), regenerated.revision)
    const confirmed = await open()
    const preview = await call('previewChapterTaskEdit', edit(96))
    assert.equal(preview.invokesAI, false)
    const applyArgs = { ...edit(96), expectedRevision: confirmed.revision, expectedPreviewHash: preview.previewHash }
    await assert.rejects(() => call('applyChapterTaskEdit', applyArgs), { code: 'AGENT_AUTHORIZATION_REQUIRED' })
    const nextJob = { ...confirmed.data.chapterGenerationJobs.find(j => j.id === 'job-66'), id: 'replacement-66', status: 'failed' }
    await mutate(data => ({ ...data, chapterGenerationJobs: [nextJob, ...data.chapterGenerationJobs],
      generatedChapterDrafts: [draft(nextJob, 'replacement'), ...data.generatedChapterDrafts],
      agentRuns: data.agentRuns.map(r => r.id === agentRunId ? { ...r, createdJobIds: [...r.createdJobIds, nextJob.id] } : r) }))
    assert.equal((await summary()).nextTarget.jobId, 'replacement-66')
    await assertBlocked(66, 'draft-replacement', () => call('applyChapterTaskEdit', applyArgs))
    await assertBlocked(66, 'draft-replacement', () => retry(confirmed))
    const beforeRepair = await open()
    await storage.saveChapterCommitBundle(accept(api, beforeRepair.data, 66, 'replacement', 50), beforeRepair.revision)
    assert.equal((await summary()).nextChapterOrder, 96)

    await mutate(data => addManualCandidate(addManualCandidate(data, 'manual-66'), 'retry-66'))
    const beforeFailure = await open()
    const firstManual = manual(beforeFailure.data, 'manual-66', 70)
    await assert.rejects(() => failedWriter.saveRevisionCommitBundle(firstManual, beforeFailure.revision), /fixture write failed/)
    const failed = await summary()
    assert.equal(failed.nextChapterOrder, 66, 'A later unresolved manual revision failure overrides older success.')
    assert.ok(failed.summary.includes('candidate-manual-66'), 'Recovery must identify the failed revision candidate, not just the old accepted draft.')
    assert.equal(failed.nextTarget.writebackFailure.revisionVersionId, 'candidate-manual-66')
    assert.ok(!failed.summary.includes('draft-replacement'))
    await assertBlocked(66, 'candidate-manual-66', () => retry(beforeFailure))
    const staleFailure = await open()
    await storage.saveRevisionCommitBundle(firstManual, staleFailure.revision)
    assert.equal((await summary()).nextChapterOrder, 96, 'Only a matching repair receipt and version resolve the failed write.')

    const pinned = await open()
    const beforeRequest = api.batchModelRequestGuard(pinned, pinned.data.agentRuns.find(r => r.id === agentRunId), 'job-96')
    const reads = []
    const prepare = Database.prototype.prepare
    const spy = kind === 'sqlite' && mock.method(Database.prototype, 'prepare', function (sql, ...rest) {
      reads.push(sql)
      return prepare.call(this, sql, ...rest)
    })
    try {
      await beforeRequest()
      if (spy) {
        assert.ok(reads.some(sql => sql.includes('FROM meta')))
        assert.ok(!reads.some(sql => sql.includes('FROM entities')), 'Unchanged SQLite revision must not load any book rows.')
      }
      await mutate(data => ({ ...data, projects: data.projects.map(p => ({ ...p, name: '新书名' })) }))
      reads.length = 0
      await assert.rejects(beforeRequest, { code: 'STORAGE_REVISION_CONFLICT' })
      if (spy) assert.ok(reads.some(sql => sql.includes('FROM entities') && sql.includes('project_id = ?')))
    } finally { if (spy) spy.mock.restore() }

    const priorCalls = requests
    let secondManual
    send = async () => {
      const current = await open()
      assert.equal(current.data.chapterGenerationJobs.find(j => j.id === 'job-96').status, 'running')
      await assert.rejects(() => storage.saveChapterCommitBundle(accept(api, current.data, 96), current.revision), /生成仍在运行/)
      secondManual = manual(current.data, 'retry-66', 80)
      await assert.rejects(() => failedWriter.saveRevisionCommitBundle(secondManual, current.revision), /fixture write failed/)
      // A caller mutating its public runtime cannot advance the executor's privately checked revision.
      Object.assign(staleFailure, await open())
      return new Response('unsupported response_format', { status: 400 })
    }
    await assert.rejects(() => retry(staleFailure), error => error.message.includes('第 66 章') && error.message.includes('candidate-retry-66'))
    assert.equal(requests, priorCalls + 1, 'The first admitted request may finish; its automatic format retry must not reach the provider.')
    send = null
    assert.equal((await summary()).nextChapterOrder, 66)
    const progress = await call('getPipelineProgress', { jobId: 'job-96' })
    assert.equal(progress.jobStatus, 'paused')
    assert.equal(progress.agentRunStatus, 'paused')
    assert.equal(progress.currentStepStatus, 'failed')
    assert.equal(progress.recoverableFromStep, 'generate_chapter_plan')
    assert.equal(progress.cancellationRequested, false)
    const paused = await open()
    assert.ok(paused.data.chapterGenerationJobs.find(j => j.id === 'job-96').errorMessage.includes('candidate-retry-66'))
    assert.equal(paused.data.chapterWritebackFailures.length, 2, 'The interrupted executor must not overwrite the concurrent failure.')
    assert.deepEqual(paused.data.generatedChapterDrafts.filter(d => d.jobId === 'job-96'), start.data.generatedChapterDrafts.filter(d => d.jobId === 'job-96'))
    await assertBlocked(66, 'candidate-retry-66', () => call('retryChapterPipeline', { agentRunId, jobId: 'job-96' }))
    await storage.saveRevisionCommitBundle(secondManual, (await open()).revision)
    assert.equal((await summary()).nextChapterOrder, 96)
    const startPlanner = async () => {
      const started = Promise.withResolvers()
      const release = Promise.withResolvers()
      const pending = api.executeAgentChapterPipeline({ runtime: await open(), agentRunId, jobId: 'job-96' }, {
        workflowAI: { async generateChapterPlan() {
          plannerCalls++
          started.resolve()
          await release.promise
          throw new Error('fixture plan stopped')
        } }, diagnostics: {}
      })
      await Promise.race([started.promise, pending.then(() => { throw new Error('Plan did not start.') })])
      return { release: release.resolve, pending }
    }
    const older = await startPlanner()
    try {
      const newer = await startPlanner()
      try {
        const owned = await open()
        older.release()
        await assert.rejects(older.pending, { code: 'STORAGE_REVISION_CONFLICT' })
        assert.equal((await open()).revision, owned.revision, 'An interrupted owner must not pause the executor that took over.')
        assert.equal((await call('getPipelineProgress', { jobId: 'job-96' })).jobStatus, 'running')
      } finally { newer.release(); await newer.pending }
    } finally { older.release(); await older.pending.catch(() => {}) }
    const finish = await open()
    assert.equal(finish.data.chapterGenerationJobs.find(j => j.id === 'job-96').status, 'failed')
    // The existing candidate can now go through normal acceptance, without forging a completed job.
    await storage.saveChapterCommitBundle(accept(api, finish.data, 96), finish.revision)
    assert.equal((await summary()).nextTarget, null)
    console.log(kind + ': 66/92, exact job and persisted version, revision/restore, auth, stale resume and transport retry passed.')
  } finally {
    send = null
    storage.close?.()
  }
}

try {
  process.env.NOVEL_DIRECTOR_API_REGISTRY = join(dir, 'registry.json')
  process.env.NOVEL_DIRECTOR_API_KEY = ''
  await writeFile(process.env.NOVEL_DIRECTOR_API_REGISTRY, JSON.stringify({ version: 1, apis: {} }))
  const outfile = join(dir, 'fixture.mjs')
  await build({ stdin: { resolveDir: repoRoot, loader: 'ts', contents: [
    'agent/tools/AgentToolService', 'agent/AgentRunService', 'agent/AgentRuntime', 'agent/AgentPipelineExecutor',
    'agent/agentPipelineWritebackGuard', 'services/ChapterWritebackFailureService', 'services/ChapterCommitBundleService',
    'services/RevisionCommitBundleService', 'services/ChapterVersionChainService',
    'storage/JsonStorageService', 'storage/SqliteStorageService', 'shared/defaults'
  ].map(path => "export * from './src/" + path + "'").join('\n') },
  outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['better-sqlite3', 'electron'], logLevel: 'silent' })
  const api = await import(pathToFileURL(outfile).href)
  for (const kind of ['json', 'sqlite']) await checkBackend(api, kind)
  assert.equal(requests, 2)
  assert.equal(plannerCalls, 4)
  console.log('2 admitted mock HTTP requests and 4 overlapping mock planner calls; 0 blocked or external requests.')
} finally {
  globalThis.fetch = originalFetch
  if (originalRegistry === undefined) delete process.env.NOVEL_DIRECTOR_API_REGISTRY
  else process.env.NOVEL_DIRECTOR_API_REGISTRY = originalRegistry
  if (originalKey === undefined) delete process.env.NOVEL_DIRECTOR_API_KEY
  else process.env.NOVEL_DIRECTOR_API_KEY = originalKey
  const path = relative(root, dir)
  if (!path || path.startsWith('..') || isAbsolute(path)) throw new Error('Refusing to clean outside the fixture root.')
  await rm(dir, { recursive: true, force: true })
}

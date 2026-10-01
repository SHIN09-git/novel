#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const tempRoot = join(repoRoot, 'tmp')
await mkdir(tempRoot, { recursive: true })
const directory = await mkdtemp(join(tempRoot, 'agent-chapter-task-tools-'))
const originalFetch = globalThis.fetch
let providerCalls = 0
let checks = 0
let nativeChecks = 0
let NativeDatabase = null
globalThis.fetch = async () => {
  providerCalls++
  throw new Error('Provider calls are forbidden in chapter task tool fixtures.')
}

async function test(label, run) {
  await run()
  checks++
  console.log(`PASS ${label}`)
}

try {
  if (process.versions.electron) throw new Error('Use Node, not Electron, for isolated chapter task fixtures.')
  try {
    NativeDatabase = createRequire(import.meta.url)('better-sqlite3')
    const probe = new NativeDatabase(':memory:')
    try { assert.ok(probe.prepare('SELECT sqlite_version() AS version').get().version) }
    finally { probe.close() }
  } catch (error) {
    if (process.argv.includes('--require-native')) throw error
    console.log(`SKIP native SQLite: ${error.message ?? error}. No rebuild or fallback.`)
  }

  const outfile = join(directory, 'api.mjs')
  await build({
    stdin: {
      contents: `
        export * from './src/agent/tools/agentChapterTaskTools';
        export * from './src/agent/tools/agentChapterTaskDefinitions';
        export * from './src/agent/AgentRuntime';
        export * from './src/main/services/AgentAuthorizationService';
        export * from './src/shared/defaults';
        export * from './src/storage/JsonStorageService';
        export * from './src/storage/SqliteStorageService';
      `,
      loader: 'ts',
      resolveDir: repoRoot
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3', 'electron'],
    logLevel: 'silent'
  })
  const api = await import(pathToFileURL(outfile).href)
  const timestamp = '2026-09-07T08:00:00.000Z'
  const copy = (value) => structuredClone(value)

  function task(goal = '沈禾在旧桥寻找信使。') {
    return {
      ...api.createEmptyChapterTask(),
      goal,
      conflict: '渡船无人回应。',
      suspenseToKeep: '信使身份不揭晓。',
      allowedPayoffs: '铜铃刻痕只作轻微暗示。',
      forbiddenPayoffs: '不得揭晓铜铃来历。',
      endingHook: '绳索轻轻动了一下。',
      readerEmotion: '不安但想继续追读。',
      targetWordCount: '800-1200',
      styleRequirement: '短句，动作清楚。'
    }
  }

  function fixture(withSnapshot = false) {
    const snapshotTask = task('冻结快照中的原任务。')
    return api.normalizeAppData({
      projects: [
        { id: 'p1', name: '渡口任务测试', description: '寻找失踪信使。', coreAppeal: '克制悬疑', style: '朴素克制', createdAt: timestamp, updatedAt: timestamp },
        { id: 'p2', name: '其他项目', description: 'FOREIGN_PROJECT_UNCHANGED', createdAt: timestamp, updatedAt: timestamp }
      ],
      chapters: [{ id: 'c1', projectId: 'p1', order: 1, title: '旧桥', body: '沈禾停在桥头，铜铃仍在衣袋里。', summary: '沈禾抵达旧桥。', createdAt: timestamp, updatedAt: timestamp }],
      characters: [{ id: 'character-1', projectId: 'p1', name: '沈禾', role: '主角', roleFunction: '寻找信使', abilitiesAndResources: '一枚铜铃', weaknessAndCost: '过桥需付船资', createdAt: timestamp, updatedAt: timestamp }],
      foreshadowings: [{ id: 'f1', projectId: 'p1', title: '铜铃刻痕', description: '铃内有一行刻痕。', status: 'planted', weight: 'high', treatmentMode: 'hint', createdAt: timestamp, updatedAt: timestamp }],
      generatedChapterDrafts: [{ id: 'old-draft', projectId: 'p1', chapterId: null, jobId: 'historical-job', title: '旧草稿', body: 'OLD_DRAFT_MUST_REMAIN', summary: '', status: 'draft', tokenEstimate: 10, createdAt: timestamp, updatedAt: timestamp }],
      promptContextSnapshots: withSnapshot ? [{
        id: 'snapshot-1', projectId: 'p1', targetChapterOrder: 2, mode: 'standard',
        chapterTask: snapshotTask, finalPrompt: 'MANUAL_PROMPT_MUST_REMAIN', estimatedTokens: 10,
        source: 'manual', note: '作者手动快照', createdAt: timestamp, updatedAt: timestamp
      }] : [],
      agentRuns: [{
        id: 'run-p1', projectId: 'p1', goal: '完成第二章', mode: 'single_chapter', safetyMode: 'autonomous',
        targetChapterOrders: [2], status: 'paused', createdJobIds: [], createdDraftIds: [], createdCommitIds: [],
        pendingHumanReviewItemIds: [], decisions: [], summary: '', warnings: [], startedAt: timestamp,
        updatedAt: timestamp, completedAt: null, schemaVersion: 1
      }]
    })
  }

  let fixtureNumber = 0
  async function harness(kind, data = fixture()) {
    const root = join(directory, `${kind}-${++fixtureNumber}`)
    await mkdir(root)
    const storagePath = join(root, kind === 'json' ? 'novel.json' : 'novel.sqlite')
    const userDataPath = join(root, 'profile')
    await mkdir(userDataPath)
    const storage = kind === 'json' ? new api.JsonStorageService(storagePath) : new api.SqliteStorageService(storagePath)
    try { await storage.save(data) } finally { storage.close?.() }
    const options = { storagePath, userDataPath }
    const runtime = () => api.loadAgentRuntimeData(options)
    const read = async (args) => {
      const current = await runtime()
      const result = api.handleAgentChapterTaskReadTool('agent.getChapterTask', { ...options, projectId: 'p1', ...args }, current.data)
      assert.equal(result.handled, true)
      return { current, payload: result.payload }
    }
    const write = async (name, args, current = null) => {
      const loaded = current ?? await runtime()
      const result = await api.handleAgentChapterTaskWriteTool(name, { ...options, projectId: 'p1', ...args }, loaded.data, loaded)
      assert.equal(result.handled, true)
      return { current: loaded, payload: result.payload }
    }
    return { kind, storagePath, userDataPath, options, runtime, read, write }
  }

  await test('definitions expose strict read, preview and authorized apply contracts', async () => {
    assert.deepEqual(api.AGENT_CHAPTER_TASK_TOOL_DEFINITIONS.map((item) => item.name), [
      'agent.getChapterTask', 'agent.previewChapterTaskEdit', 'agent.applyChapterTaskEdit'
    ])
    for (const definition of api.AGENT_CHAPTER_TASK_TOOL_DEFINITIONS) {
      assert.equal(definition.inputSchema.additionalProperties, false)
    }
    const apply = api.AGENT_CHAPTER_TASK_TOOL_DEFINITIONS[2]
    assert.equal(apply.inputSchema.properties.confirm, undefined)
    assert.ok(apply.description.includes('edit_chapter_task'))
  })

  for (const kind of ['json', ...(NativeDatabase ? ['sqlite'] : [])]) {
    await test(`${kind}: real handlers preview without grant and apply only under chapter-scoped author grant`, async () => {
      const h = await harness(kind)
      const read = await h.read({ chapterOrder: 2, sourceJobId: null, sourceSnapshotId: null })
      assert.equal(read.payload.source.kind, 'derived')
      assert.equal(read.payload.editReference.sourceJobId, null)
      const editedTask = task('沈禾沿绳索找到被水淹没的渡船。')
      const command = {
        chapterOrder: 2, sourceJobId: null, sourceSnapshotId: null,
        agentRunId: 'run-p1', operationId: `edit-${kind}`, reason: '推进渡口冲突。', task: editedTask,
        budgetMode: 'standard', budgetMaxTokens: 12000, pipelineMode: 'standard'
      }
      const before = await h.runtime()
      const preview = await h.write('agent.previewChapterTaskEdit', command, before)
      assert.equal(preview.payload.persisted, false)
      assert.equal(preview.payload.invokesAI, false)
      assert.equal(preview.payload.impact.scope, 'context')
      assert.equal(preview.payload.nextExecution.tool, 'agent.retryChapterPipeline')
      assert.deepEqual(preview.payload.authorization.scope.actions, ['edit_chapter_task'])
      assert.equal(preview.payload.authorization.nextCommand.coveredByThisCheck, false)
      assert.equal((await h.runtime()).data.chapterGenerationJobs.length, 0)
      assert.equal(before.revision, (await h.runtime()).revision)

      const applyArgs = { ...command, expectedPreviewHash: preview.payload.previewHash, expectedRevision: before.revision }
      await assert.rejects(h.write('agent.applyChapterTaskEdit', applyArgs), { code: 'AGENT_AUTHORIZATION_REQUIRED' })
      assert.equal((await h.runtime()).data.chapterGenerationJobs.length, 0)
      const grant = await new api.AgentAuthorizationService(h.userDataPath).grant({
        storagePath: h.storagePath, projectId: 'p1', actions: ['edit_chapter_task'], chapterStart: 2, chapterEnd: 2
      })
      const applied = await h.write('agent.applyChapterTaskEdit', applyArgs)
      assert.equal(applied.payload.replayed, false)
      assert.equal(applied.payload.authorizationGrantId, grant.id)
      assert.equal(applied.payload.job.status, 'idle')
      assert.equal(applied.payload.job.currentStep, 'generate_chapter_plan')
      assert.deepEqual(applied.payload.job.chapterTaskSnapshot, editedTask)
      assert.equal(applied.payload.nextExecution.fromStep, 'generate_chapter_plan')

      const saved = await h.runtime()
      const job = saved.data.chapterGenerationJobs.find((item) => item.id === applied.payload.job.id)
      assert.ok(job)
      const steps = saved.data.chapterGenerationSteps.filter((item) => item.jobId === job.id)
      assert.equal(steps.filter((item) => item.status === 'completed').length, 3)
      assert.ok(steps.find((item) => item.type === 'build_context').output.includes(editedTask.goal))
      assert.equal(saved.data.generatedChapterDrafts[0].body, 'OLD_DRAFT_MUST_REMAIN')
      assert.equal(saved.data.projects.find((item) => item.id === 'p2').description, 'FOREIGN_PROJECT_UNCHANGED')
      const run = saved.data.agentRuns.find((item) => item.id === 'run-p1')
      assert.ok(run.createdJobIds.includes(job.id))
      const taskEditDecision = run.decisions.find((item) => item.jobId === job.id && item.step === 'edit_chapter_task')
      assert.equal(taskEditDecision?.result, 'applied')
      assert.ok(taskEditDecision?.evidence.includes(`authorizationGrantId=${grant.id}`))
      assert.equal(run.status, 'paused')
      assert.match(run.summary, /pipeline execution has not started/)

      const replayRevision = saved.revision
      const replay = await h.write('agent.applyChapterTaskEdit', applyArgs, saved)
      assert.equal(replay.payload.replayed, true)
      assert.equal((await h.runtime()).revision, replayRevision)
      assert.equal((await h.runtime()).data.chapterGenerationJobs.filter((item) => item.id === job.id).length, 1)
      const latest = await h.read({ chapterOrder: 2 })
      assert.equal(latest.payload.source.jobId, job.id)
      assert.deepEqual(latest.payload.task, editedTask)
      if (kind === 'sqlite') nativeChecks++
    })

    await test(`${kind}: stale storage revision blocks a new operation without touching either project`, async () => {
      const h = await harness(kind)
      const editedTask = task('修改后必须基于旧预览。')
      const command = { chapterOrder: 2, sourceJobId: null, sourceSnapshotId: null, agentRunId: 'run-p1',
        operationId: `stale-${kind}`, reason: '测试并发保护。', task: editedTask,
        budgetMode: 'standard', budgetMaxTokens: 16000, pipelineMode: 'standard' }
      const previewRuntime = await h.runtime()
      const preview = await h.write('agent.previewChapterTaskEdit', command, previewRuntime)
      const storage = kind === 'json' ? new api.JsonStorageService(h.storagePath) : new api.SqliteStorageService(h.storagePath)
      try {
        const current = await storage.loadSnapshot()
        current.data.projects = current.data.projects.map((item) => item.id === 'p2' ? { ...item, description: 'LATER_FOREIGN_EDIT' } : item)
        await storage.saveIfCurrent(current.data, current.revision)
      } finally { storage.close?.() }
      await new api.AgentAuthorizationService(h.userDataPath).grant({ storagePath: h.storagePath, projectId: 'p1', actions: ['edit_chapter_task'] })
      const current = await h.runtime()
      await assert.rejects(h.write('agent.applyChapterTaskEdit', {
        ...command, expectedPreviewHash: preview.payload.previewHash, expectedRevision: previewRuntime.revision
      }, current), /Storage changed after the task preview/)
      const after = await h.runtime()
      assert.equal(after.data.projects.find((item) => item.id === 'p2').description, 'LATER_FOREIGN_EDIT')
      assert.equal(after.data.chapterGenerationJobs.length, 0)
    })
  }

  await test('manual snapshot read is exact and apply requires explicit fresh context without mutating the snapshot', async () => {
    const h = await harness('json', fixture(true))
    const read = await h.read({ sourceSnapshotId: 'snapshot-1' })
    assert.equal(read.payload.task.goal, '冻结快照中的原任务。')
    assert.equal(read.payload.source.manualSnapshotRequiresRefresh, true)
    const command = {
      ...read.payload.editReference,
      agentRunId: 'run-p1', operationId: 'snapshot-edit', reason: '明确改用最新资料。',
      task: task('从最新资料重建的新任务。'), budgetMode: 'standard', budgetMaxTokens: 12000,
      pipelineMode: 'standard'
    }
    await assert.rejects(h.write('agent.previewChapterTaskEdit', command), /手动快照/)
    const previewRuntime = await h.runtime()
    const preview = await h.write('agent.previewChapterTaskEdit', { ...command, refreshContext: true }, previewRuntime)
    assert.equal(preview.payload.before.goal, '冻结快照中的原任务。')
    await new api.AgentAuthorizationService(h.userDataPath).grant({
      storagePath: h.storagePath, projectId: 'p1', actions: ['edit_chapter_task'], chapterStart: 2, chapterEnd: 2
    })
    const beforeSnapshot = copy(previewRuntime.data.promptContextSnapshots[0])
    const applied = await h.write('agent.applyChapterTaskEdit', {
      ...command, refreshContext: true, expectedPreviewHash: preview.payload.previewHash, expectedRevision: previewRuntime.revision
    })
    const saved = await h.runtime()
    assert.deepEqual(saved.data.promptContextSnapshots[0], beforeSnapshot)
    assert.equal(applied.payload.job.contextSource, 'auto')
    assert.equal(applied.payload.job.taskEdit.sourcePromptContextSnapshotId, 'snapshot-1')
  })

  await test('an existing job task is read exactly, edited into a new job, and remains replayable after the source changes', async () => {
    const data = fixture()
    const sourceTask = task('旧运行中的任务。')
    data.chapterGenerationJobs.push({
      id: 'source-job', projectId: 'p1', targetChapterOrder: 2, chapterTaskSnapshot: sourceTask,
      taskEdit: null, promptContextSnapshotId: null, contextSource: 'auto', pipelineMode: 'standard',
      status: 'completed', currentStep: 'await_user_confirmation', createdAt: timestamp, updatedAt: timestamp,
      errorMessage: ''
    })
    data.generatedChapterDrafts[0].jobId = 'source-job'
    const h = await harness('json', data)
    const read = await h.read({ sourceJobId: 'source-job' })
    assert.deepEqual(read.payload.task, sourceTask)
    const command = {
      ...read.payload.editReference,
      agentRunId: 'run-p1', operationId: 'existing-job-edit', reason: '修改旧运行任务。',
      task: { ...sourceTask, conflict: '渡船突然开始下沉。' },
      budgetMode: 'standard', budgetMaxTokens: 12000, pipelineMode: 'standard'
    }
    const previewRuntime = await h.runtime()
    const preview = await h.write('agent.previewChapterTaskEdit', command, previewRuntime)
    assert.equal(preview.payload.source.jobId, 'source-job')
    assert.deepEqual(preview.payload.before, sourceTask)
    await new api.AgentAuthorizationService(h.userDataPath).grant({
      storagePath: h.storagePath, projectId: 'p1', actions: ['edit_chapter_task'], chapterStart: 2, chapterEnd: 2
    })
    const applyArgs = { ...command, expectedPreviewHash: preview.payload.previewHash, expectedRevision: previewRuntime.revision }
    const applied = await h.write('agent.applyChapterTaskEdit', applyArgs)
    const afterApply = await h.runtime()
    assert.notEqual(applied.payload.job.id, 'source-job')
    assert.deepEqual(afterApply.data.chapterGenerationJobs.find((item) => item.id === 'source-job').chapterTaskSnapshot, sourceTask)
    assert.equal(afterApply.data.generatedChapterDrafts[0].body, 'OLD_DRAFT_MUST_REMAIN')

    const storage = new api.JsonStorageService(h.storagePath)
    const changedAt = '2026-09-07T09:00:00.000Z'
    const snapshot = await storage.loadSnapshot()
    snapshot.data.chapterGenerationJobs = snapshot.data.chapterGenerationJobs.map((item) =>
      item.id === 'source-job' ? { ...item, updatedAt: changedAt } : item)
    await storage.saveIfCurrent(snapshot.data, snapshot.revision)
    const afterSourceChange = await h.runtime()
    const replay = await h.write('agent.applyChapterTaskEdit', applyArgs, afterSourceChange)
    assert.equal(replay.payload.replayed, true)
    assert.equal((await h.runtime()).revision, afterSourceChange.revision)
    assert.equal((await h.runtime()).data.chapterGenerationJobs.filter((item) => item.id === applied.payload.job.id).length, 1)
  })

  assert.equal(providerCalls, 0)
  console.log(JSON.stringify({ ok: true, checks, nativeChecks, providerCalls }))
} finally {
  globalThis.fetch = originalFetch
  await rm(directory, { recursive: true, force: true })
}

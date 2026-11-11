#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { mock } from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const temp = resolve(tmpdir())
const dir = await mkdtemp(join(temp, 'agent-draft-recovery-'))
const paths = { storagePath: join(dir, 'fixture.json'), userDataPath: dir }
const keyEnv = 'NOVEL_DRAFT_RECOVERY_TEST_API_KEY'
const baseUrl = 'https://draft-recovery.invalid/v1'
const missingKey = `工作环节 prose 缺少对应的 API Key（${keyEnv}）。外部流程按共享清单取密钥。`
let networkAttempts = 0
function noNetwork() { networkAttempts++; throw new Error('Network forbidden in draft recovery tests') }

try {
  process.env.NOVEL_DIRECTOR_API_REGISTRY = join(dir, 'registry.json')
  delete process.env.NOVEL_DIRECTOR_API_KEY
  delete process.env[keyEnv]
  await writeFile(process.env.NOVEL_DIRECTOR_API_REGISTRY, JSON.stringify({ version: 1, apis: { prose: { baseUrl, keyEnv } } }))
  mock.method(globalThis, 'fetch', async () => noNetwork())
  mock.method(Socket.prototype, 'connect', noNetwork)
  const outfile = join(dir, 'api.mjs')
  await build({ stdin: { resolveDir: repoRoot, contents: [
    "export { executeAgentChapterPipeline } from './src/agent/AgentPipelineExecutor'",
    "export { AgentRunService } from './src/agent/AgentRunService'",
    "export { loadAgentRuntimeData } from './src/agent/AgentRuntime'",
    "export { normalizeAppData } from './src/shared/defaults'",
    "export { readChapterStepFragment } from './src/shared/chapterStepFragment'",
    "export { JsonStorageService } from './src/storage/JsonStorageService'",
    "export { AIService as MainAIService } from './src/main/services/AIService'",
    "export { ensureChapterPlan } from './src/services/ai/responseNormalizers/chapter'"
  ].join('\n') }, outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22',
  external: ['better-sqlite3', 'electron'], logLevel: 'silent' })
  const api = await import(pathToFileURL(outfile).href)
  const prepared = api.AgentRunService.prepareSingleChapterRun({
    appData: api.normalizeAppData({ projects: [{ id: 'p', name: 'Fixture' }], settings: {
      apiProvider: 'local', modelName: 'local-fixture', pipelineModelRoles: {
        planner: { modelName: 'planner-fixture' }, prose: { apiProvider: 'compatible', baseUrl, modelName: 'prose-fixture' }
      }
    } }), projectId: 'p', targetChapterOrder: 2
  })
  const reopen = () => api.loadAgentRuntimeData(paths)
  const reset = (data) => writeFile(paths.storagePath, JSON.stringify(data))
  const draftStep = (data) => data.chapterGenerationSteps.find(s => s.jobId === prepared.job.id && s.type === 'generate_chapter_draft')
  const run = async (options = {}, dependencies = {}) => {
    const runtime = await reopen()
    return api.executeAgentChapterPipeline({ appData: runtime.data, runtime, agentRunId: prepared.agentRun.id,
      jobId: prepared.job.id, ...options }, dependencies)
  }
  const calls = []
  const proseReplies = []
  let failPlan = false
  const plan = api.ensureChapterPlan({ chapterTitle: 'Paper', chapterGoal: 'Find the missing page.' })
  const body = '钟响过三次，她把蓝封皮的清单放进抽屉。'.repeat(150)
  const response = (text) => ({ ok: true, content: JSON.stringify({ title: 'Paper', body: text }), finishReason: 'stop' })
  // Replace only the last transport boundary; the production role/key checks and local diagnostics still run.
  mock.method(api.MainAIService.prototype, 'chatCompletion', async ({ settings }) => {
    calls.push(settings.modelName)
    if (settings.modelName === 'planner-fixture') return failPlan ? { ok: false, error: 'fixture-plan-fault' } : { ok: true, content: JSON.stringify(plan) }
    if (settings.modelName === 'prose-fixture') {
      assert.ok(proseReplies.length, 'Unexpected second prose call')
      return proseReplies.shift()
    }
    return { ok: false, error: 'fixture stops after draft diagnostics' }
  })

  await reset(prepared.appData)
  assert.equal((await run()).failedStep?.errorMessage, missingKey)
  assert.deepEqual(calls, [], 'A fresh run must fail preflight before even the planner is called')
  console.log('PASS fresh run: missing prose key, zero model calls')

  await reset(prepared.appData)
  process.env[keyEnv] = 'fixture-only'
  proseReplies.push(response(body))
  const interrupted = await run({}, { diagnostics: { async auditNovelty() { throw Error('fixture-audit-fault') } } })
  assert.equal(interrupted.failedStep?.errorMessage, 'fixture-audit-fault')
  assert.equal(calls.filter(model => model === 'prose-fixture').length, 1)
  const top = (await reopen()).data
  const checkpoint = JSON.parse(draftStep(top).output)
  assert.equal(checkpoint.kind, 'chapter_draft_checkpoint')
  delete process.env[keyEnv]
  calls.length = 0

  const originalSave = api.JsonStorageService.prototype.saveIfCurrent
  const saveFault = mock.method(api.JsonStorageService.prototype, 'saveIfCurrent', function (data, revision) {
    if (draftStep(data).status === 'completed') throw Error('fixture-completion-save-fault')
    return originalSave.call(this, data, revision)
  })
  try { assert.equal((await run()).failedStep?.errorMessage, 'fixture-completion-save-fault') }
  finally { saveFault.mock.restore() }
  const wrapped = (await reopen()).data
  assert.deepEqual(JSON.parse(draftStep(wrapped).output).checkpoint, checkpoint)
  assert.deepEqual(calls, [], 'Top-level checkpoint must reach the local diagnostics without a model')
  console.log('PASS top-level checkpoint: local diagnostics complete without a prose key')

  await run()
  const recovered = (await reopen()).data
  assert.equal(draftStep(recovered).status, 'completed')
  assert.deepEqual(recovered.generatedChapterDrafts.map(d => [d.id, d.body]), [[checkpoint.draftId, body]])
  assert.equal(recovered.generationRunTraces.find(t => t.jobId === prepared.job.id).noveltyAuditResult.sourceDraftId, checkpoint.draftId)
  assert.ok(recovered.redundancyReports.some(r => r.draftId === checkpoint.draftId))
  assert.ok(!calls.includes('prose-fixture'))
  console.log('PASS wrapped checkpoint: same draft and local reports, no new prose call')

  for (const data of [top, wrapped]) {
    await reset(data)
    calls.length = 0
    const denied = await run({ readerEmotionTarget: 'A different writing instruction.' })
    assert.equal(denied.failedStep?.type, 'generate_chapter_draft')
    assert.equal(denied.failedStep.errorMessage, missingKey)
    assert.deepEqual(calls, [])
    assert.deepEqual((await reopen()).data.generatedChapterDrafts, data.generatedChapterDrafts)
  }
  console.log('PASS changed inputs: both checkpoint formats require the prose key, zero model calls')

  await reset(prepared.appData)
  process.env[keyEnv] = 'fixture-only'
  const partial = 'The door stood open.\nThe light had gone'
  proseReplies.push(response('太短。'), { ok: true, content: partial, finishReason: 'length' })
  const interruptedRepair = await run()
  assert.equal(interruptedRepair.failedStep?.type, 'generate_chapter_draft')
  const beforeRestart = draftStep((await reopen()).data)
  assert.ok(JSON.parse(beforeRestart.output).repairSource, 'Fixture includes a prior correction tied to the old inputs')
  const fragment = api.readChapterStepFragment(beforeRestart)
  assert.equal(fragment.body, partial)
  failPlan = true
  calls.length = 0
  const upstreamFault = await run({ fromStep: 'generate_chapter_plan' })
  assert.match(upstreamFault.failedStep?.errorMessage ?? '', /fixture-plan-fault/)
  assert.deepEqual(calls, ['planner-fixture'])
  const pending = (await reopen()).data
  assert.deepEqual(api.readChapterStepFragment(draftStep(pending)), fragment)
  assert.equal(JSON.parse(draftStep(pending).output).repairSource, undefined)
  assert.equal(pending.generatedChapterDrafts.length, 0, 'A retained fragment is never an acceptable draft')
  failPlan = false
  proseReplies.push(response(body))
  await run()
  const replaced = (await reopen()).data
  assert.equal(draftStep(replaced).status, 'completed')
  assert.equal(api.readChapterStepFragment(draftStep(replaced)), null)
  assert.deepEqual(replaced.generatedChapterDrafts.map(d => d.body), [body])
  assert.equal(proseReplies.length, 0)
  console.log('PASS upstream restart: fragment survives plan failure and is replaced only by new output')
  assert.equal(networkAttempts, 0)
  console.log('Agent draft recovery passed; isolated JSON, 0 network attempts.')
} finally {
  mock.restoreAll()
  if (dirname(dir) === temp && basename(dir).startsWith('agent-draft-recovery-')) await rm(dir, { recursive: true, force: true })
}

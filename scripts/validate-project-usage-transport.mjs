#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = await mkdtemp(join(tmpdir(), 'novel-usage-transport-'))
const originalEnv = process.env
const originalFetch = globalThis.fetch
const noFetch = () => { throw new Error('Unexpected fetch outside a fixture') }
const credentials = { getApiKey: async () => 'private-primary', getBackupApiKey: async () => 'private-backup' }
const settings = { apiProvider: 'compatible', hasApiKey: true, modelName: 'test-model',
  baseUrl: 'https://fixture.invalid:8443/private-route', temperature: 0.5, maxTokens: 200,
  maxRetries: 1, retryEnabled: false, requestTimeoutMs: 5000 }
const context = { projectId: 'book-a', phase: 'writing' }
const request = (changes = {}) => ({ settings: { ...settings }, runId: 'run-a', clientCallId: 'reused-call',
  messages: [{ role: 'user', content: 'private-manuscript' }], usageContext: { ...context }, ...changes })
const json = (value, status = 200, id) => new Response(JSON.stringify(value), {
  status, headers: id ? { 'x-request-id': id } : {}
})
const payload = (content = '{"ok":true}', usage) => ({ choices: [{ message: { content }, finish_reason: 'stop' }], usage })
const gate = () => { let open; const wait = new Promise(resolve => { open = resolve }); return { wait, open } }
const checkSafe = value => assert.ok(!/private-(?:primary|backup|route|manuscript|response|journal|stderr)|Bearer /i.test(JSON.stringify(value)),
  'Unexpected private data in public output')
let checks = 0
async function test(label, fn) { await fn(); checks++; console.log('PASS ' + label) }

try {
  // No real home, credentials, provider executable, database or network in this harness.
  process.env = { PATH: originalEnv.PATH, SystemRoot: originalEnv.SystemRoot, ComSpec: originalEnv.ComSpec,
    HOME: root, USERPROFILE: root, APPDATA: root, CODEX_HOME: root, TMPDIR: root, TMP: root, TEMP: root }
  globalThis.fetch = noFetch
  const outfile = join(root, 'transport.mjs')
  await build({ stdin: { resolveDir: repoRoot, contents: [
    "export { AIService } from './src/main/services/AIService'",
    "export { AIHttpClient } from './src/main/services/AIHttpClient'",
    "export { AiUsageReceipts } from './src/main/services/AiUsageReceipts'",
    "export { DiagnosticsService } from './src/main/services/DiagnosticsService'",
    "export { validateChatCompletionRequest } from './src/main/ipc/aiChatValidation'",
    "export { AIWorkflowService } from './src/services/AIService'",
    "export { createHeadlessTransport } from './src/agent/AgentPipelineExecutor'",
    "export { readProjectUsageAttempts } from './src/storage/projectUsageJournal'"
  ].join('\n') }, outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22',
    external: ['better-sqlite3', 'electron'], logLevel: 'silent' })
  const { AIService, AIHttpClient, AiUsageReceipts, AIWorkflowService, DiagnosticsService, validateChatCompletionRequest,
    createHeadlessTransport, readProjectUsageAttempts } = await import(pathToFileURL(outfile).href)

  function fixture(send = noFetch, options = {}) {
    const batches = [], logs = []
    let sends = 0
    const service = new AIService(options.credentials ?? credentials, options.limiters ?? {}, {
      logger: { info: msg => logs.push(msg), warn: msg => logs.push(msg) },
      httpClient: new AIHttpClient({ beforeRequest: options.guard, fetch: (url, init) => send(++sends, url, init) }),
      usageJournal: { getStoragePath: options.path ?? (() => 'library-a'),
        append: async (path, rows) => { batches.push({ path, rows }); await options.persist?.(path, rows) } }
    })
    return { service, batches, logs, sends: () => sends, rows: () => batches.flatMap(b => b.rows) }
  }

  await test('401 + backup + format fallback + 503 retry + silent response: five dispatches, one flush', async () => {
    const keys = [], formats = []
    const f = fixture((n, _url, init) => {
      keys.push(new Headers(init.headers).get('authorization'))
      formats.push(Boolean(JSON.parse(init.body).response_format))
      switch (n) {
        case 1: return json({ error: 'private-response' }, 401, 'req-1')
        case 2: return json({ error: 'unsupported response_format', usage: { input_tokens: 0 } }, 400, 'req-2')
        case 3: return json({ request_id: 'req-3', usage: { output_tokens: 2 } }, 503)
        case 4: return json({ ...payload('', { input_tokens: 11, output_tokens: 3 }),
          choices: [{ message: { content: '' }, finish_reason: 'private-response' }] }, 200, 'req-4')
        case 5: return json(payload('private-response', { input_tokens: 17, output_tokens: 5, total_tokens: 22 }), 200, 'req-5')
        default: assert.fail('Unexpected extra model request')
      }
    })
    const r = await f.service.chatCompletion(request({ settings: { ...settings, retryEnabled: true } }))
    assert.equal(r.content, 'private-response')
    assert.equal(r.telemetry.attempts, f.sends())
    assert.equal(f.batches.length, 1)
    assert.deepEqual(keys, ['private-primary', ...Array(4).fill('private-backup')].map(key => 'Bearer ' + key))
    assert.deepEqual(formats, [true, true, false, true, false])
    const rows = f.rows()
    assert.equal(rows.length, 5)
    assert.deepEqual(rows.map(r => r.outcome), ['failed', 'failed', 'failed', 'failed', 'success'])
    assert.deepEqual(rows.map(r => r.providerRequestId), ['req-1', 'req-2', 'req-3', 'req-4', 'req-5'])
    assert.deepEqual(rows.map(r => r.usage), [undefined, { promptTokens: 0 }, { completionTokens: 2 },
      { promptTokens: 11, completionTokens: 3 }, { promptTokens: 17, completionTokens: 5, totalTokens: 22 }])
    assert.equal(new Set(rows.map(r => r.id)).size, f.sends())
    for (const row of rows) {
      assert.equal(row.callId, 'reused-call')
      assert.notEqual(row.id, row.callId)
      assert.equal(row.runId, 'run-a')
      assert.equal(row.projectId, context.projectId)
      assert.equal(row.phase, context.phase)
      assert.equal(row.endpoint, 'https://fixture.invalid:8443')
      assert.equal(row.provider, 'compatible')
      assert.equal(row.model, settings.modelName)
      assert.ok(Number.isFinite(Date.parse(row.startedAt)))
    }
    checkSafe([f.batches, f.logs])
    assert.doesNotMatch(f.logs.join('\n'), /req-[1-5]|reused-call|providerRequestId|prompt_tokens/)
  })

  await test('trace merges replayed upstream usage by field even when the journal fails', async () => {
    for (const failJournal of [false, true]) {
      const f = fixture(n => {
        if (n === 1) return json({ usage: { input_tokens: 10, output_tokens: 3 } }, 401, 'same-upstream')
        if (n === 2) return json({ error: 'unsupported response_format',
          usage: { input_tokens: 10, output_tokens: 4, cached_input_tokens: 0 } }, 400, 'same-upstream')
        return json(payload('ok', { input_tokens: 10, output_tokens: 3, total_tokens: 13 }), 200, 'same-upstream')
      }, { persist: async () => { if (failJournal) throw new Error('private-journal') } })
      const r = await f.service.chatCompletion(request())
      assert.equal(r.ok, true)
      assert.equal(r.telemetry.usageJournalIncomplete, failJournal || undefined)
      assert.deepEqual(r.telemetry.usage, { promptTokens: 10, cachedPromptTokens: 0, totalTokens: 13 })
      assert.equal(r.telemetry.attempts, 3)
      assert.equal(new Set(f.rows().map(r => r.id)).size, 3)
      assert.deepEqual(f.rows().map(r => r.usage.completionTokens), [3, 4, 3])
      assert.equal(f.batches.length, 1)
    }
    const separate = new AiUsageReceipts(() => true)
    for (const [origin, id] of [['https://a.invalid', 'same'], ['https://b.invalid', 'same'],
      ['https://a.invalid', undefined], ['https://a.invalid', undefined]]) {
      separate.start(origin)
      separate.observe({ providerRequestId: id, usage: { promptTokens: 2 } }, 'success')
    }
    assert.deepEqual(separate.totalKnownUsage(), { promptTokens: 8 })
  })

  await test('read failure, invalid JSON, unsafe IDs and absent usage retain separate safe receipts', async () => {
    const f = fixture(n => {
      if (n === 1) return new Response(new ReadableStream({ start(c) { c.error(new Error('private-response')) } }),
        { headers: { 'request-id': 'read-failed' } })
      if (n === 2) return new Response('private-response', { headers: { 'x-request-id': 'private-primary' } })
      return json({ ...payload('ok', { input_tokens: -2, output_tokens: '0', total_tokens: null }), id: 'not-a-request-id' },
        200, 'Bearer private-backup')
    })
    for (const expected of [false, false, true]) {
      const r = await f.service.chatCompletion(request())
      assert.equal(r.ok, expected)
      assert.equal(r.telemetry.attempts, 1)
      checkSafe(r.error ?? '')
    }
    assert.deepEqual(f.rows().map(r => [r.outcome, r.providerRequestId, r.usage]), [
      ['failed', 'read-failed', undefined], ['failed', undefined, undefined], ['success', undefined, undefined]
    ])
    assert.equal(new Set(f.rows().map(r => r.id)).size, 3, 'external call ID was reused across logical calls')
    checkSafe([f.logs, f.rows()])
  })

  await test('project, phase and library are pinned before credentials, including concurrent calls', async () => {
    const g = gate()
    let path = 'library-a'
    const dispatched = []
    const f = fixture((_n, url, init) => {
      const body = JSON.parse(init.body)
      dispatched.push([url, body.model, body.messages[0].content])
      return json(payload())
    }, { path: () => path, credentials: { getApiKey: () => g.wait } })
    const a = request()
    const waiting = f.service.chatCompletion(a)
    path = 'library-b'
    a.usageContext.projectId = 'changed'
    a.usageContext.phase = 'other'
    a.settings.modelName = 'changed-model'
    a.settings.baseUrl = 'https://other.invalid'
    a.messages[0].content = 'changed'
    const b = request({ runId: 'run-b', usageContext: { projectId: 'book-b', phase: 'revision' } })
    const next = f.service.chatCompletion(b)
    g.open('fake-key')
    await Promise.all([waiting, next])
    assert.ok(dispatched.length === 2 && dispatched.every(([url, model, content]) =>
      url === settings.baseUrl + '/chat/completions' && model === settings.modelName && content === 'private-manuscript'))
    assert.deepEqual(f.batches.map(b => [b.path, ...b.rows.map(r => [r.projectId, r.phase])]).sort(), [
      ['library-a', ['book-a', 'writing']], ['library-b', ['book-b', 'revision']]
    ])
    assert.equal(new Set(f.rows().map(r => r.id)).size, 2)
  })

  await test('failed receipt persistence is awaited; it never retries or hides the original result', async () => {
    for (const status of [200, 403]) {
      const started = gate(), release = gate()
      const f = fixture(() => json(payload('private-response'), status), {
        persist: async () => { started.open(); await release.wait; throw new Error('private-journal') }
      })
      let settled = false
      const pending = f.service.chatCompletion(request({ settings: { ...settings, retryEnabled: true } }))
        .then(r => { settled = true; return r })
      await started.wait
      assert.equal(settled, false)
      release.open()
      const result = await pending
      assert.equal(result.ok, status === 200)
      if (status === 200) assert.equal(result.content, 'private-response')
      else assert.match(result.error, /403/)
      assert.equal(result.telemetry.usageJournalIncomplete, true)
      assert.equal(f.sends(), 1)
      assert.equal(f.batches.length, 1)
      checkSafe(f.logs)
    }
  })

  await test('local validation, credential/guard failures and pre-send cancellation create no receipts', async () => {
    for (const [opts, overrides] of [
      [{}, { maxTokens: 0 }], [{}, { baseUrl: 'not-a-url' }], [{}, { baseUrl: 'https://user:private-primary@fixture.invalid' }],
      [{ credentials: { getApiKey: async () => '' } }, {}],
      [{ guard: async () => { throw new Error('local permission changed') } }, {}]
    ]) {
      const f = fixture(noFetch, opts)
      const r = await f.service.chatCompletion(request({ settings: { ...settings, ...overrides } }))
      assert.equal(r.ok, false)
      assert.equal(r.telemetry.attempts, 0)
      assert.equal(f.sends(), 0)
      assert.equal(f.batches.length, 0)
    }
    const entered = gate(), release = gate()
    const f = fixture(noFetch, { limiters: { compatible: { acquire: async () => { entered.open(); await release.wait } } } })
    const pending = f.service.chatCompletion(request())
    await entered.wait
    assert.equal(f.service.cancelCall('run-a', 'reused-call'), true)
    release.open()
    assert.equal((await pending).telemetry.terminationCategory, 'cancelled')
    assert.equal(f.sends(), 0)
    assert.equal(f.batches.length, 0)
  })

  await test('cancel while reading preserves the header ID and counts exactly the dispatched request', async () => {
    const entered = gate()
    const f = fixture((_n, _url, init) => new Response(new ReadableStream({ start(c) {
      init.signal.addEventListener('abort', () => c.error(new Error('aborted')), { once: true })
      entered.open()
    } }), { headers: { 'x-request-id': 'cancelled-id' } }))
    const pending = f.service.chatCompletion(request())
    await entered.wait
    f.service.cancelRun('run-a')
    const r = await pending
    assert.equal(r.telemetry.terminationCategory, 'cancelled')
    assert.deepEqual(f.rows().map(r => [r.outcome, r.providerRequestId, r.usage]), [['cancelled', 'cancelled-id', undefined]])
  })

  await test('chat IPC validates attribution; renderer business methods pass the actual purpose', async () => {
    for (const invalid of [null, [], {}, { phase: 'writing', projectId: ' ' }, { phase: 'fake', projectId: 'a' },
      { ...context, storagePath: 'wrong' }, { ...context, projectId: 'a\nb' }]) {
      assert.throws(() => validateChatCompletionRequest(request({ usageContext: invalid })))
    }
    const seen = []
    const chatCompletion = async req => {
      const checked = validateChatCompletionRequest(req)
      assert.equal(checked.runId, 'desktop-run')
      assert.equal(checked.usageContext.projectId, 'desktop-book')
      seen.push(checked.usageContext.phase)
      return { ok: false, error: 'offline fixture' }
    }
    globalThis.window = { novelDirector: { ai: { chatCompletion } } }
    const ai = new AIWorkflowService(settings, { projectId: 'desktop-book', runId: 'desktop-run' })
    const opts = { chapterTask: { goal: 'fixture' }, targetChapterOrder: 2, mode: 'standard' }
    const draft = { title: 'fixture', body: 'fixture body' }
    await ai.generateChapterPlan('context', opts)
    await ai.generateChapterDraft({}, 'context', opts)
    await ai.generateChapterReview(draft.body, 'context')
    await ai.generatePostDraftAnalysis(draft.body, 'context', [], [])
    await ai.updateCharacterStates(draft.body, [], 'context')
    await ai.extractForeshadowing(draft.body, [], 'context')
    await ai.generateNextChapterSuggestions(draft, 'context')
    await ai.generateConsistencyReview(draft, 'context')
    await ai.generateQualityGateReport(draft, 'context', null)
    await ai.generateRevisionCandidate(draft, {}, 'context')
    await ai.generateRevision({ type: 'improve_dialogue', instruction: 'edit', fullChapterText: draft.body }, 'context')
    await ai.polishStoryDirectionIdea({ project: { name: 'fixture' }, recentStageSummaries: [], userRawIdea: 'idea' })
    await ai.generateStoryDirectionGuide({ project: { name: 'fixture' }, userRawIdea: 'idea', userPolishedIdea: '',
      startChapterOrder: 1, endChapterOrder: 3, stageSummaries: [], recentChapters: [], activeForeshadowings: [],
      characters: [], timelineEvents: [], storyBible: null })
    assert.deepEqual(seen, ['planning', 'writing', 'review', 'extraction', 'extraction', 'extraction', 'planning',
      'review', 'review', 'revision', 'revision', 'planning', 'planning'])
  })

  const qualityRequest = () => ({ settings: { ...settings, apiProvider: 'local' }, runId: 'diagnostic-run',
    projectId: 'diagnostic-book', jobId: 'diagnostic-job', chapterId: null, draftId: null,
    chapterDraft: { title: 'fixture', body: 'private-manuscript' }, context: 'fixture', chapterPlan: null })

  await test('main diagnostics pin library and project before lazy loading', async () => {
    let path = 'diagnostic-library'
    const f = fixture(() => json(payload()), { path: () => path })
    const q = qualityRequest()
    const pending = new DiagnosticsService(f.service).evaluateQualityGate(q)
    path = 'other-library'
    q.projectId = 'other-book'
    const report = await pending
    assert.equal(report.projectId, 'diagnostic-book')
    assert.equal(report.aiTelemetry.attempts, 1)
    assert.equal(f.batches[0].path, 'diagnostic-library')
    assert.deepEqual(f.rows().map(r => [r.projectId, r.phase, r.runId]), [['diagnostic-book', 'review', 'diagnostic-run']])
  })

  await test('headless workflow and diagnostics use the same temporary library and check before each dispatch', async () => {
    const path = join(root, 'fake-library.json')
    let sends = 0, guards = 0, refuse = false
    globalThis.fetch = async () => ++sends === 1 ? json({ error: 'unsupported response_format' }, 400) : json(payload())
    try {
      const q = qualityRequest()
      const h = createHeadlessTransport(q.settings, new Map(), path, async () => {
        guards++
        if (refuse) throw new Error('blocked by local guard')
      })
      const ai = new AIWorkflowService(q.settings, { transport: h.transport, projectId: q.projectId, runId: q.runId })
      await ai.reduceAITone('private-manuscript', 'context')
      await h.diagnostics.evaluateQualityGate(q)
      refuse = true
      await ai.reduceAITone('private-manuscript', 'context')
      const journal = await readProjectUsageAttempts(path, q.projectId)
      assert.deepEqual(journal.rows.map(r => [r.phase, r.outcome]), [
        ['revision', 'failed'], ['revision', 'success'], ['review', 'success']
      ])
      assert.ok(journal.rows.every(r => r.runId === q.runId && r.projectId === q.projectId && !r.usage))
      assert.equal(journal.rows.length, sends)
      assert.equal(guards, sends + 1)
      assert.equal(journal.invalidRecords, 0)
      checkSafe(journal)
    } finally { globalThis.fetch = noFetch }
  })

  await test('real fake CLI exec: reported, missing and failed usage; status and pre-spawn failures are not dispatches', async () => {
    const executable = join(root, process.platform === 'win32' ? 'codex.cmd' : 'codex')
    const runner = join(root, 'fixture.cjs'), observed = join(root, 'exec-events.txt')
    await writeFile(runner, [
      "const fs = require('node:fs'), a = process.argv.slice(2)",
      "if (a[0] === '--version') { console.log('codex-cli 1.2.3'); return }",
      "if (a[0] === 'login') { console.log('ChatGPT'); return }",
      "if (a[0] !== 'exec' || !a.includes('--json')) process.exit(9)",
      "const m = a[a.indexOf('--model')+1]",
      "fs.appendFileSync(" + JSON.stringify(observed) + ", m+'\\n')",
      "const emit = e => console.log(JSON.stringify(e))",
      "emit({type:'item.completed',item:{type:'reasoning',text:'private-response-internal'}})",
      "if (m !== 'failed') emit({type:'item.completed',item:{type:'agent_message',text:'private-response'}})",
      "if (m !== 'unknown') emit({type:m==='failed'?'turn.failed':'turn.completed',request_id:'cli-'+m,",
      " usage:{input_tokens:21,cached_input_tokens:3,output_tokens:5,reasoning_output_tokens:0}})",
      "if (m === 'failed') { console.error('private-stderr'); process.exitCode=4 }"
    ].join('\n'))
    await writeFile(executable, process.platform === 'win32'
      ? '@echo off\r\n"' + process.execPath + '" "' + runner + '" %*\r\n'
      : '#!/bin/sh\nexec "' + process.execPath + '" "' + runner + '" "$@"\n', { mode: 0o700 })
    const f = fixture()
    const cli = (model, command = executable) => f.service.chatCompletion(request({ settings: {
      ...settings, apiProvider: 'codex_cli', codexCliPath: command, codexCliModel: model } }))
    assert.equal((await f.service.getCodexCliStatus(executable)).authenticated, true)
    assert.equal((await cli('bad model')).telemetry.attempts, 0)
    assert.equal((await cli('known', join(root, 'missing', 'codex'))).telemetry.attempts, 0)
    assert.equal(f.batches.length, 0)
    for (const model of ['known', 'unknown', 'failed']) {
      const r = await cli(model)
      assert.equal(r.ok, model !== 'failed')
      assert.equal(r.telemetry.attempts, 1)
      if (r.ok) assert.equal(r.content, 'private-response')
      else { assert.match(r.error, /4/); checkSafe(r.error) }
    }
    assert.deepEqual((await readFile(observed, 'utf8')).trim().split('\n'), ['known', 'unknown', 'failed'])
    const counts = { promptTokens: 21, cachedPromptTokens: 3, completionTokens: 5, reasoningTokens: 0 }
    const rows = f.rows()
    assert.deepEqual(rows.map(r => [r.model, r.outcome, r.usage, r.providerRequestId]), [
      ['known', 'success', counts, 'cli-known'], ['unknown', 'success', undefined, undefined],
      ['failed', 'failed', counts, 'cli-failed']
    ])
    assert.ok(rows.every(r => r.endpoint === '' && r.provider === 'codex_cli'))
    assert.equal(new Set(rows.map(r => r.id)).size, 3)
    assert.equal(f.sends(), 0)
    checkSafe([rows, f.logs])
    assert.doesNotMatch(f.logs.join('\n'), /cli-known|cli-failed|turn\.completed|input_tokens|providerRequestId/)
  })
  console.log('validate-project-usage-transport: ' + checks + ' scenarios passed')
} finally {
  globalThis.fetch = originalFetch
  delete globalThis.window
  process.env = originalEnv
  await rm(root, { recursive: true, force: true })
}

#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const tempRoot = join(repoRoot, 'tmp')
await mkdir(tempRoot, { recursive: true })
const outDir = await mkdtemp(join(tempRoot, 'ai-call-progress-'))

async function test(label, run) {
  await run()
  console.log(`PASS ${label}`)
}

function settings(overrides = {}) {
  return {
    apiProvider: 'local',
    apiKey: '',
    hasApiKey: false,
    baseUrl: 'http://127.0.0.1:1/v1',
    modelName: 'local-fixture',
    codexCliPath: 'codex',
    codexCliModel: '',
    temperature: 0.7,
    maxTokens: 100,
    retryEnabled: false,
    maxRetries: 0,
    requestTimeoutMs: 10_000,
    ...overrides
  }
}

function request(runId, callId, overrides = {}) {
  return {
    settings: settings(overrides.settings),
    runId,
    clientCallId: callId,
    messages: [
      { role: 'system', content: 'SECRET PROMPT MUST NOT BE RETAINED' },
      { role: 'user', content: 'private manuscript body' }
    ]
  }
}

function response(content = '{"ok":true}') {
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function serviceWith(AIService, httpClient, options = {}) {
  return new AIService(
    { getApiKey: async () => 'SECRET_API_KEY' },
    {},
    {
      httpClient,
      logger: options.logger ?? { info: () => {}, warn: () => {} },
      progressStore: options.progressStore,
      codexCliService: options.codexCliService
    }
  )
}

try {
  const outfile = join(outDir, 'progress.mjs')
  await build({
    stdin: {
      contents: `
        export { AIService } from './src/main/services/AIService';
        export { AIHttpClient } from './src/main/services/AIHttpClient';
        export { AiCallProgressStore } from './src/main/services/AiCallProgressStore';
        export { MainAIJsonClient } from './src/main/services/MainAIJsonClient';
      `,
      resolveDir: repoRoot,
      loader: 'ts'
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['electron'],
    logLevel: 'silent'
  })
  const { AIHttpClient, AIService, AiCallProgressStore, MainAIJsonClient } = await import(pathToFileURL(outfile).href)

  await test('disables thinking only for official DeepSeek Flash names and retained V4 aliases', async () => {
    const cases = [
      { label: 'current Flash name', settings: { apiProvider: 'compatible', baseUrl: 'https://api.deepseek.com/v1', modelName: 'deepseek-flash' }, disabled: true },
      { label: 'legacy V4 Flash name', settings: { apiProvider: 'compatible', baseUrl: 'https://api.deepseek.com/v1', modelName: 'deepseek-v4-flash' }, disabled: true },
      { label: 'legacy V4 Flash Vision Exp name', settings: { apiProvider: 'compatible', baseUrl: 'https://api.deepseek.com/v1', modelName: 'deepseek-v4-flash-vision-exp' }, disabled: true },
      { label: 'existing V4 Pro name', settings: { apiProvider: 'compatible', baseUrl: 'https://api.deepseek.com/v1', modelName: 'deepseek-v4-pro' }, disabled: true },
      { label: 'third-party compatible host', settings: { apiProvider: 'compatible', baseUrl: 'https://deepseek.example.com/v1', modelName: 'deepseek-flash' }, disabled: false },
      { label: 'hostname lookalike', settings: { apiProvider: 'compatible', baseUrl: 'https://api.deepseek.com.example.com/v1', modelName: 'deepseek-flash' }, disabled: false },
      { label: 'unknown official-host model', settings: { apiProvider: 'compatible', baseUrl: 'https://api.deepseek.com/v1', modelName: 'deepseek-chat' }, disabled: false }
    ]

    for (const testCase of cases) {
      let requestBody
      const service = serviceWith(AIService, {
        postWithFallback: async (_url, body, _headers, _fallback, options) => {
          requestBody = body
          options.onResponseStarted()
          return response()
        }
      })
      const result = await service.chatCompletion(request(`deepseek-${testCase.label}`, 'call', { settings: testCase.settings }))
      assert.equal(result.ok, true, testCase.label)
      assert.deepEqual(requestBody.thinking, testCase.disabled ? { type: 'disabled' } : undefined, testCase.label)
    }
  })

  await test('fake clock exposes elapsed time without inventing activity', () => {
    let clock = Date.parse('2026-09-06T00:00:00.000Z')
    const store = new AiCallProgressStore({ now: () => clock, terminalRetentionMs: 100, maxEntries: 4 })
    store.start({ callId: 'call-1', runId: 'run-1', provider: 'local', model: 'model-1' })
    const started = store.get({ runId: 'run-1', callId: 'call-1' })
    clock += 40
    const waiting = store.get({ runId: 'run-1', callId: 'call-1' })
    assert.equal(waiting.stage, 'waiting_response')
    assert.equal(waiting.elapsedMs, 40)
    assert.equal(waiting.lastActivityAt, started.lastActivityAt)
    assert.equal('percent' in waiting, false)

    store.update('run-1', 'call-1', 'reading_response', { attempt: 1 })
    assert.equal(store.get({ callId: 'call-1' }).lastActivityAt, new Date(clock).toISOString())
    clock += 20
    store.update('run-1', 'call-1', 'completed', { attempt: 1 })
    const completed = store.get({ callId: 'call-1' })
    clock += 80
    assert.equal(store.get({ callId: 'call-1' }).elapsedMs, completed.elapsedMs)
    assert.equal(store.get({ callId: 'call-1' }).lastActivityAt, completed.lastActivityAt)
    clock += 21
    assert.equal(store.get({ callId: 'call-1' }), null)
  })

  await test('terminal records are bounded while active records remain observable', () => {
    let clock = 1_000
    const store = new AiCallProgressStore({ now: () => clock, terminalRetentionMs: 10_000, maxEntries: 2 })
    store.start({ callId: 'active', runId: 'run', provider: 'local', model: 'm' })
    for (const callId of ['done-1', 'done-2']) {
      clock += 1
      store.start({ callId, runId: 'run', provider: 'local', model: 'm' })
      store.update('run', callId, 'completed', { attempt: 1 })
    }
    const calls = store.listRun('run')
    assert.equal(calls.length, 2)
    assert.ok(calls.some((item) => item.callId === 'active' && item.stage === 'waiting_response'))
    assert.ok(calls.some((item) => item.callId === 'done-2'))
    assert.ok(!calls.some((item) => item.callId === 'done-1'))
  })

  await test('run-only lookup prefers an active call over a newer terminal call', () => {
    let clock = 1_000
    const store = new AiCallProgressStore({ now: () => clock })
    store.start({ callId: 'active-call', runId: 'mixed-run', provider: 'local', model: 'm' })
    clock += 10
    store.start({ callId: 'finished-call', runId: 'mixed-run', provider: 'local', model: 'm' })
    store.update('mixed-run', 'finished-call', 'completed', { attempt: 1 })
    assert.equal(store.get({ runId: 'mixed-run' }).callId, 'active-call')
    assert.deepEqual(
      store.listRun('mixed-run').map((item) => item.callId),
      ['finished-call', 'active-call']
    )
  })

  await test('AIHttpClient reports reading only after headers and before the body finishes', async () => {
    const originalFetch = globalThis.fetch
    let releaseBody
    let bodyFinished = false
    const bodyGate = new Promise((resolve) => { releaseBody = resolve })
    const events = []
    try {
      globalThis.fetch = async () => new Response(new ReadableStream({
        async start(controller) {
          await bodyGate
          controller.enqueue(new TextEncoder().encode('{}'))
          controller.close()
          bodyFinished = true
        }
      }))
      const pending = new AIHttpClient().post('http://local.invalid', {}, {}, {
        onResponseStarted: () => events.push('reading_response')
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      assert.deepEqual(events, ['reading_response'])
      assert.equal(bodyFinished, false)
      releaseBody()
      await pending
      assert.equal(bodyFinished, true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  await test('service exposes waiting, reading and completed stages with safe metadata', async () => {
    const observed = []
    let service
    const client = {
      postWithFallback: async (_url, _body, _headers, _fallback, options) => {
        observed.push(service.getCallProgress({ runId: 'run-main', callId: 'call-main' }))
        options.onResponseStarted()
        observed.push(service.getCallProgress({ runId: 'run-main', callId: 'call-main' }))
        return response()
      }
    }
    service = serviceWith(AIService, client)
    const result = await service.chatCompletion(request('run-main', 'call-main'))
    assert.equal(result.ok, true)
    assert.deepEqual(observed.map((item) => item.stage), ['waiting_response', 'reading_response'])
    assert.deepEqual(observed.map((item) => item.attempt), [1, 1])
    const completed = service.getCallProgress({ runId: 'run-main', callId: 'call-main' })
    assert.equal(completed.stage, 'completed')
    assert.equal(completed.provider, 'local')
    assert.equal(completed.model, 'local-fixture')
    const serialized = JSON.stringify(completed)
    assert.doesNotMatch(serialized, /SECRET|private manuscript|apiKey|messages|content/i)
  })

  await test('format fallback is observable as a real phase before fallback response headers', async () => {
    const observed = []
    let service
    const client = {
      postWithFallback: async (_url, _body, _headers, _fallback, options) => {
        options.onResponseFormatFallback()
        observed.push(service.getCallProgress({ runId: 'run-format', callId: 'call-format' }))
        options.onResponseStarted()
        return response()
      }
    }
    service = serviceWith(AIService, client)
    await service.chatCompletion(request('run-format', 'call-format'))
    assert.equal(observed[0].stage, 'format_retry')
    assert.equal(observed[0].attempt, 1)
    assert.equal(service.getCallProgress({ callId: 'call-format' }).stage, 'completed')
  })

  await test('retry wait reports actual delay and next transport attempt', async () => {
    const originalRandom = Math.random
    let calls = 0
    let retrySnapshot = null
    let retryLog = ''
    let service
    try {
      Math.random = () => 0
      const client = {
        postWithFallback: async (_url, _body, _headers, _fallback, options) => {
          calls += 1
          if (calls === 1) {
            const error = new Error('temporary reset SECRET_API_KEY private manuscript body')
            error.code = 'ECONNRESET'
            error.stack = 'TRACE_SECRET_SHOULD_NOT_BE_LOGGED'
            throw error
          }
          options.onResponseStarted()
          return response()
        }
      }
      service = serviceWith(AIService, client, {
        logger: {
          info: () => {},
          warn: (message) => {
            retryLog = message
            retrySnapshot = service.getCallProgress({ runId: 'run-retry', callId: 'call-retry' })
          }
        }
      })
      const result = await service.chatCompletion(request('run-retry', 'call-retry', {
        settings: { apiProvider: 'compatible', hasApiKey: true, retryEnabled: true, maxRetries: 1 }
      }))
      assert.equal(result.ok, true)
      assert.equal(calls, 2)
      assert.equal(retrySnapshot.stage, 'retry_wait')
      assert.equal(retrySnapshot.attempt, 1)
      assert.equal(retrySnapshot.retryDelayMs, 750)
      assert.equal(service.getCallProgress({ callId: 'call-retry' }).attempt, 2)
      assert.doesNotMatch(retryLog, /SECRET_API_KEY|private manuscript body|TRACE_SECRET_SHOULD_NOT_BE_LOGGED/)
    } finally {
      Math.random = originalRandom
    }
  })

  await test('failed and cancelled calls retain distinct terminal stages', async () => {
    const failed = serviceWith(AIService, {
      postWithFallback: async () => { throw new Error('permanent local failure') }
    })
    const failedResult = await failed.chatCompletion(request('run-failed', 'call-failed'))
    assert.equal(failedResult.ok, false)
    assert.equal(failed.getCallProgress({ callId: 'call-failed' }).stage, 'failed')

    let requestStarted
    const started = new Promise((resolve) => { requestStarted = resolve })
    const cancelled = serviceWith(AIService, {
      postWithFallback: async (_url, _body, _headers, _fallback, options) => {
        requestStarted()
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      }
    })
    const pending = cancelled.chatCompletion(request('run-cancelled', 'call-cancelled'))
    await started
    assert.equal(cancelled.cancelCall('run-cancelled', 'call-cancelled'), true)
    assert.equal(cancelled.getCallProgress({ callId: 'call-cancelled' }).stage, 'cancelled')
    const cancelledResult = await pending
    assert.equal(cancelledResult.telemetry.terminationCategory, 'cancelled')
  })

  await test('Codex CLI cancellation returned as a result keeps progress and telemetry aligned', async () => {
    let cliStarted
    const started = new Promise((resolve) => { cliStarted = resolve })
    const service = serviceWith(AIService, {}, {
      codexCliService: {
        getStatus: async () => ({ ok: true, available: true, authenticated: true, message: 'ready' }),
        chatCompletion: async ({ signal }) => {
          cliStarted()
          return new Promise((resolve) => {
            signal.addEventListener('abort', () => resolve({ ok: false, error: 'cancelled by caller' }), { once: true })
          })
        }
      }
    })
    const pending = service.chatCompletion(request('cli-run', 'cli-call', {
      settings: { apiProvider: 'codex_cli', modelName: '', codexCliModel: 'cli-model' }
    }))
    await started
    assert.equal(service.cancelCall('cli-run', 'cli-call'), true)
    const result = await pending
    assert.equal(result.ok, false)
    assert.equal(result.telemetry.terminationCategory, 'cancelled')
    assert.equal(service.getCallProgress({ runId: 'cli-run', callId: 'cli-call' }).stage, 'cancelled')
  })

  await test('duplicate active call rejection does not terminate the original progress', async () => {
    let requestStarted
    let releaseRequest
    const started = new Promise((resolve) => { requestStarted = resolve })
    const release = new Promise((resolve) => { releaseRequest = resolve })
    const service = serviceWith(AIService, {
      postWithFallback: async (_url, _body, _headers, _fallback, options) => {
        requestStarted()
        await release
        options.onResponseStarted()
        return response()
      }
    })
    const original = service.chatCompletion(request('duplicate-run', 'duplicate-call'))
    await started
    const duplicate = await service.chatCompletion(request('duplicate-run', 'duplicate-call'))
    assert.equal(duplicate.ok, false)
    assert.equal(service.getCallProgress({ runId: 'duplicate-run', callId: 'duplicate-call' }).stage, 'waiting_response')
    releaseRequest()
    await original
    assert.equal(service.getCallProgress({ runId: 'duplicate-run', callId: 'duplicate-call' }).stage, 'completed')
  })

  await test('run listing groups main and diagnostic-style calls without cross-run leakage', async () => {
    const service = serviceWith(AIService, {
      postWithFallback: async (_url, _body, _headers, _fallback, options) => {
        options.onResponseStarted()
        return response()
      }
    })
    await service.chatCompletion(request('shared-run', 'main-call'))
    await service.chatCompletion(request('shared-run', 'diagnostic-call'))
    await service.chatCompletion(request('other-run', 'other-call'))
    assert.deepEqual(
      service.listCallProgress('shared-run').map((item) => item.callId).sort(),
      ['diagnostic-call', 'main-call']
    )
    assert.equal(service.getCallProgress({ runId: 'shared-run' }).callId, 'diagnostic-call')
  })

  await test('main JSON client passes its diagnostic run ID into progress grouping', async () => {
    const service = serviceWith(AIService, {
      postWithFallback: async (_url, _body, _headers, _fallback, options) => {
        options.onResponseStarted()
        return response('{"score":88}')
      }
    })
    const client = new MainAIJsonClient(settings(), service, 'diagnostic-run')
    const result = await client.requestJson('system', 'user', (value) => value, { score: 0 })
    assert.equal(result.ok, true)
    assert.equal(service.listCallProgress('diagnostic-run').length, 1)
    assert.equal(service.listCallProgress('diagnostic-run')[0].stage, 'completed')
  })

  await test('IPC and preload expose only the read APIs from the agreed contract', async () => {
    const [channels, ipc, preload] = await Promise.all([
      readFile(join(repoRoot, 'src/shared/ipc/ipcChannels.ts'), 'utf8'),
      readFile(join(repoRoot, 'src/main/ipc/aiIpcHandlers.ts'), 'utf8'),
      readFile(join(repoRoot, 'src/preload/index.ts'), 'utf8')
    ])
    assert.match(channels, /AI_GET_CALL_PROGRESS/)
    assert.match(channels, /AI_LIST_CALL_PROGRESS/)
    assert.match(ipc, /aiService\.getCallProgress\(validateCallProgressRequest\(request\)\)/)
    assert.match(ipc, /aiService\.listCallProgress\(validateString\(runId/)
    assert.match(preload, /getCallProgress: \(request: GetAiCallProgressRequest = \{\}\)/)
    assert.match(preload, /listCallProgress: \(runId: string\)/)
  })

  console.log('validate-ai-call-progress: ok')
} finally {
  await rm(outDir, { recursive: true, force: true })
}

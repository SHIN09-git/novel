#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { join } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

async function loadTransport() {
  const result = await build({
    stdin: {
      contents: [
        "export { AIService } from './src/main/services/AIService.ts'",
        "export { AiHttpError } from './src/main/utils/aiErrors.ts'"
      ].join('\n'),
      resolveDir: repoRoot,
      sourcefile: 'ai-call-cancellation-harness.ts'
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}

function read(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8')
}

function settings(overrides = {}) {
  return {
    apiProvider: 'openai',
    baseUrl: 'https://example.invalid/v1',
    modelName: 'controlled-model',
    codexCliPath: 'codex',
    codexCliModel: '',
    temperature: 0.7,
    maxTokens: 1000,
    retryEnabled: false,
    maxRetries: 0,
    requestTimeoutMs: 30_000,
    ...overrides
  }
}

function request(runId, clientCallId, content = 'test', settingsOverrides = {}) {
  return {
    runId,
    clientCallId,
    settings: settings(settingsOverrides),
    messages: [{ role: 'user', content }]
  }
}

function jsonResponse(content) {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content } }]
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function createControlledHttpClient() {
  const calls = []
  return {
    calls,
    postWithFallback(_url, _body, _headers, _fallbackBody, options = {}) {
      return new Promise((resolve, reject) => {
        const signal = options.signal
        let settled = false
        const cleanup = () => signal?.removeEventListener('abort', cancel)
        const cancel = () => {
          if (settled) return
          settled = true
          cleanup()
          const error = new Error('controlled request cancelled')
          error.name = 'AbortError'
          reject(error)
        }
        const call = {
          signal,
          succeed(content = '{}') {
            if (settled) return
            settled = true
            cleanup()
            resolve(jsonResponse(content))
          }
        }
        calls.push(call)
        if (signal?.aborted) cancel()
        else signal?.addEventListener('abort', cancel, { once: true })
      })
    }
  }
}

async function waitForCalls(client, count) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (client.calls.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`Expected ${count} HTTP calls, saw ${client.calls.length}.`)
}

function serviceWithClient(AIService, httpClient, logger = { info() {}, warn() {} }) {
  return new AIService(
    { getApiKey: async () => 'TEST_CREDENTIAL' },
    {},
    { httpClient, logger }
  )
}

async function test(name, operation) {
  await operation()
  console.log(`PASS ${name}`)
}

async function main() {
  const { AIService, AiHttpError } = await loadTransport()

  await test('cancelCall aborts only the selected call in one run', async () => {
    const client = createControlledHttpClient()
    const service = serviceWithClient(AIService, client)
    const first = service.chatCompletion(request('run-1', 'call-1', 'first'))
    const second = service.chatCompletion(request('run-1', 'call-2', 'second'))
    await waitForCalls(client, 2)

    assert.equal(service.cancelCall('run-1', 'call-1'), true)
    assert.equal(client.calls[0].signal.aborted, true)
    assert.equal(client.calls[1].signal.aborted, false)
    assert.equal(service.cancelCall('run-1', 'call-1'), false)
    client.calls[1].succeed('{"second":true}')

    const [firstResult, secondResult] = await Promise.all([first, second])
    assert.equal(firstResult.telemetry.callId, 'call-1')
    assert.equal(firstResult.telemetry.terminationCategory, 'cancelled')
    assert.equal(secondResult.ok, true)
    assert.equal(secondResult.telemetry.callId, 'call-2')
    assert.equal(service.cancelRun('run-1'), false)
  })

  await test('call IDs are namespaced by run ID', async () => {
    const client = createControlledHttpClient()
    const service = serviceWithClient(AIService, client)
    const first = service.chatCompletion(request('run-a', 'shared-call'))
    const second = service.chatCompletion(request('run-b', 'shared-call'))
    await waitForCalls(client, 2)

    assert.equal(service.cancelCall('run-a', 'shared-call'), true)
    assert.equal(client.calls[0].signal.aborted, true)
    assert.equal(client.calls[1].signal.aborted, false)
    client.calls[1].succeed()
    const [firstResult, secondResult] = await Promise.all([first, second])
    assert.equal(firstResult.telemetry.terminationCategory, 'cancelled')
    assert.equal(secondResult.ok, true)
  })

  await test('duplicate active call ID is rejected without replacing the original controller', async () => {
    const client = createControlledHttpClient()
    const service = serviceWithClient(AIService, client)
    const original = service.chatCompletion(request('duplicate-run', 'duplicate-call', 'original'))
    await waitForCalls(client, 1)
    const duplicate = await service.chatCompletion(request('duplicate-run', 'duplicate-call', 'duplicate'))

    assert.equal(duplicate.ok, false)
    assert.match(duplicate.error, /already active/)
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].signal.aborted, false)
    assert.equal(service.cancelCall('duplicate-run', 'duplicate-call'), true)
    assert.equal((await original).telemetry.terminationCategory, 'cancelled')
  })

  await test('clientCallId requires a run namespace before any provider request', async () => {
    const client = createControlledHttpClient()
    const service = serviceWithClient(AIService, client)
    const result = await service.chatCompletion(request(undefined, 'orphan-call'))
    assert.equal(result.ok, false)
    assert.match(result.error, /requires a runId namespace/)
    assert.equal(client.calls.length, 0)
  })

  await test('completed calls are removed from the call registry', async () => {
    const client = createControlledHttpClient()
    const service = serviceWithClient(AIService, client)
    const pending = service.chatCompletion(request('cleanup-run', 'cleanup-call'))
    await waitForCalls(client, 1)
    client.calls[0].succeed()
    assert.equal((await pending).ok, true)
    assert.equal(service.cancelCall('cleanup-run', 'cleanup-call'), false)
    assert.equal(service.cancelRun('cleanup-run'), false)
  })

  await test('legacy requests without clientCallId remain cancellable by run', async () => {
    const client = createControlledHttpClient()
    const service = serviceWithClient(AIService, client)
    const pending = service.chatCompletion(request('legacy-run', undefined))
    await waitForCalls(client, 1)
    assert.equal(service.cancelRun('legacy-run'), true)
    const result = await pending
    assert.equal(result.telemetry.terminationCategory, 'cancelled')
    assert.equal(typeof result.telemetry.callId, 'string')
    assert.ok(result.telemetry.callId.length > 0)
  })

  await test('cancellation during retry backoff sends no retry request', async () => {
    let httpCalls = 0
    let service
    const httpClient = {
      async postWithFallback() {
        httpCalls += 1
        throw new AiHttpError(503, 'temporary')
      }
    }
    const logger = {
      info() {},
      warn(message) {
        if (message.includes('retry scheduled')) {
          assert.equal(service.cancelCall('retry-run', 'retry-call'), true)
        }
      }
    }
    service = serviceWithClient(AIService, httpClient, logger)
    const result = await service.chatCompletion(request('retry-run', 'retry-call', 'retry', {
      retryEnabled: true,
      maxRetries: 2
    }))
    assert.equal(result.telemetry.terminationCategory, 'cancelled')
    assert.equal(httpCalls, 1)
  })

  await test('cancellation before empty-response fallback sends no fallback request', async () => {
    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    let service
    try {
      globalThis.fetch = async () => {
        fetchCalls += 1
        return jsonResponse('')
      }
      const logger = {
        info() {},
        warn(message) {
          if (message.includes('retrying without response_format')) {
            assert.equal(service.cancelCall('fallback-run', 'fallback-call'), true)
          }
        }
      }
      service = new AIService(
        { getApiKey: async () => 'TEST_CREDENTIAL' },
        {},
        { logger }
      )
      const result = await service.chatCompletion(request('fallback-run', 'fallback-call'))
      assert.equal(result.telemetry.terminationCategory, 'cancelled')
      assert.equal(result.telemetry.responseFormatFallback, true)
      assert.equal(fetchCalls, 1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  await test('IPC exposes ID-only cancelCall while the renderer bridge remains legacy-compatible', async () => {
    const types = read('src/shared/ipc/ipcTypes.ts')
    const channels = read('src/shared/ipc/ipcChannels.ts')
    const handler = read('src/main/ipc/aiIpcHandlers.ts')
    const preload = read('src/preload/index.ts')
    const bridge = read('src/renderer/src/platform/novelDirectorBridge.ts')
    assert.match(types, /clientCallId\?: string/)
    assert.match(types, /interface CancelAiCallRequest[\s\S]*runId: string[\s\S]*callId: string/)
    assert.match(channels, /AI_CANCEL_CALL: 'ai:cancel-call'/)
    assert.match(handler, /aiService\.cancelCall\(validated\.runId, validated\.callId\)/)
    assert.match(handler, /clientCallId requires a runId namespace/)
    assert.match(handler, /if \(rawCallId === undefined\) return validated/)
    assert.match(preload, /cancelCall: \(runId: string, callId: string\)/)
    assert.match(preload, /AI_CANCEL_CALL, \{[\s\S]*runId: assertText\(runId[\s\S]*callId: assertText\(callId/)
    assert.match(bridge, /!ai\?\.chatCompletion \|\| !ai\.cancelRun/)
    assert.doesNotMatch(bridge, /!ai\.cancelCall/)
  })

  console.log('AI call cancellation validation passed.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

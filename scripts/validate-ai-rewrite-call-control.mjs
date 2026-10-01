#!/usr/bin/env node
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

async function loadHarness() {
  const result = await build({
    stdin: {
      contents: [
        "export { AIService } from './src/services/AIService.ts'",
        "export { createRendererAITransport } from './src/services/ai/AITransport.ts'",
        "export { AiRewriteRequestGate, AiRewriteRequestGeneration, isAiRewriteScopeCurrent, isAiRewriteSourceCurrent } from './src/renderer/src/components/aiRewriteMenuModel.ts'"
      ].join('\n'),
      resolveDir: repoRoot,
      sourcefile: 'ai-rewrite-call-control-harness.ts'
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

function settings() {
  return {
    apiProvider: 'openai',
    baseUrl: 'https://example.invalid/v1',
    modelName: 'controlled-model',
    temperature: 0.7,
    maxTokens: 1000,
    retryEnabled: false,
    maxRetries: 0,
    requestTimeoutMs: 30_000,
    hasApiKey: true
  }
}

function revisionRequest(text = '原句') {
  return {
    type: 'rewrite_section',
    revisionScope: 'local',
    fullChapterText: `前${text}后`,
    targetRange: text,
    instruction: '重写'
  }
}

function revisionResponse(text) {
  return {
    ok: true,
    content: JSON.stringify({
      revisedText: text,
      changedSummary: '改写测试',
      risks: '',
      preservedFacts: '事实不变'
    })
  }
}

async function test(name, operation) {
  await operation()
  console.log(`PASS ${name}`)
}

const {
  AIService,
  AiRewriteRequestGate,
  AiRewriteRequestGeneration,
  createRendererAITransport,
  isAiRewriteScopeCurrent,
  isAiRewriteSourceCurrent
} = await loadHarness()

await test('rewrite facade sends caller-known run and call IDs', async () => {
  const requests = []
  const transport = {
    async chatCompletion(request) {
      requests.push(request)
      return revisionResponse('新句')
    }
  }
  const service = new AIService(settings(), { transport })
  const result = await service.generateRevision(revisionRequest(), '上下文', {
    runId: 'rewrite:run-1',
    clientCallId: 'call-1'
  })

  assert.equal(result.data?.revisedText, '新句')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].runId, 'rewrite:run-1')
  assert.equal(requests[0].clientCallId, 'call-1')
})

await test('facade cancel targets one call and leaves sibling IDs untouched', async () => {
  const cancellations = []
  const transport = {
    async chatCompletion() {
      return revisionResponse('未使用')
    },
    async cancelCall(runId, callId) {
      cancellations.push({ runId, callId })
      return { ok: true, cancelled: true }
    }
  }
  const service = new AIService(settings(), { transport })
  const result = await service.cancelCall('rewrite:shared-run', 'call-a')

  assert.deepEqual(result, { ok: true, cancelled: true })
  assert.deepEqual(cancellations, [{ runId: 'rewrite:shared-run', callId: 'call-a' }])
})

await test('old renderer bridge degrades call cancellation without cancelling the run', async () => {
  let runCancelCount = 0
  globalThis.window = {
    novelDirector: {
      ai: {
        async chatCompletion() {
          return revisionResponse('旧桥接结果')
        },
        async cancelRun() {
          runCancelCount += 1
          return { ok: true, cancelled: true }
        }
      }
    }
  }
  const transport = createRendererAITransport()
  const result = await transport.cancelCall('rewrite:legacy', 'call-a')

  assert.deepEqual(result, { ok: true, cancelled: false })
  assert.equal(runCancelCount, 0)
})

await test('cancelled and superseded rewrite results cannot become current again', async () => {
  const ids = ['run-id', 'call-a', 'call-b']
  const gate = new AiRewriteRequestGate(() => ids.shift())
  const first = gate.begin()
  assert.equal(gate.cancel(first), true)
  assert.equal(gate.isCurrent(first), false)

  const second = gate.begin()
  assert.equal(gate.finish(first), false)
  assert.equal(gate.isCurrent(second), true)
  assert.equal(gate.finish(second), true)
  assert.equal(gate.isCurrent(second), false)
})

await test('source snapshot rejects stale text and accepts the unchanged selection', async () => {
  const selection = { start: 1, end: 3, text: '原句' }
  assert.equal(isAiRewriteSourceCurrent('前原句后', '前原句后', selection), true)
  assert.equal(isAiRewriteSourceCurrent('前原句后', '前手改后', selection), false)
  assert.equal(isAiRewriteSourceCurrent('前原句后', '前原句后续', selection), false)
})

await test('scope invalidation suppresses an old asynchronous cancellation notice', async () => {
  const generation = new AiRewriteRequestGeneration()
  const oldCancellation = generation.next()
  let notice = ''
  const delayedNotice = Promise.resolve().then(() => {
    if (generation.isCurrent(oldCancellation)) notice = '旧取消提示'
  })
  generation.invalidate()
  await delayedNotice
  assert.equal(notice, '')
})

await test('identical prose from another chapter is not the same rewrite scope', async () => {
  assert.equal(isAiRewriteSourceCurrent('相同正文', '相同正文', { start: 0, end: 2, text: '相同' }), true)
  assert.equal(isAiRewriteScopeCurrent('chapter-a', 'chapter-b'), false)
  assert.equal(isAiRewriteScopeCurrent('chapter-a', 'chapter-a'), true)
})

console.log(JSON.stringify({ ok: true, totalChecks: 7 }, null, 2))

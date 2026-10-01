#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'validate-ai-empty-response-recovery')

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

async function loadParser() {
  const outfile = join(outDir, 'ai-response-parser.mjs')
  await mkdir(outDir, { recursive: true })
  await build({
    entryPoints: [join(root, 'src/main/services/AIResponseParser.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

async function loadTransport() {
  const outfile = join(outDir, 'ai-transport-harness.mjs')
  await build({
    stdin: {
      contents: [
        "export { AIService } from './src/main/services/AIService.ts'",
        "export { AiRequestTimeoutError } from './src/main/utils/aiErrors.ts'"
      ].join('\n'),
      resolveDir: root,
      sourcefile: 'ai-transport-harness.ts'
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

function aiSettings(overrides = {}) {
  return {
    apiProvider: 'openai',
    baseUrl: 'https://api.deepseek.com',
    modelName: 'deepseek-v4-flash',
    codexCliPath: 'codex',
    codexCliModel: '',
    temperature: 0.8,
    maxTokens: 80_000,
    retryEnabled: false,
    maxRetries: 0,
    requestTimeoutMs: 300_000,
    ...overrides
  }
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function createControlledHttpClient() {
  const calls = []
  return {
    calls,
    postWithFallback(_url, _body, _headers, _fallbackBody, options = {}) {
      return new Promise((resolvePromise, rejectPromise) => {
        const signal = options.signal
        let settled = false
        const cleanup = () => signal?.removeEventListener('abort', rejectCancelled)
        const rejectCancelled = () => {
          if (settled) return
          settled = true
          cleanup()
          const error = new Error('controlled request cancelled')
          error.name = 'AbortError'
          rejectPromise(error)
        }
        const call = {
          signal,
          succeed(content) {
            if (settled) return
            settled = true
            cleanup()
            resolvePromise(jsonResponse({ choices: [{ finish_reason: 'stop', message: { content } }] }))
          }
        }
        calls.push(call)
        if (signal?.aborted) rejectCancelled()
        else signal?.addEventListener('abort', rejectCancelled, { once: true })
      })
    }
  }
}

async function waitForCallCount(client, count) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (client.calls.length >= count) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0))
  }
  throw new Error(`Timed out waiting for ${count} controlled AI calls; saw ${client.calls.length}.`)
}

function chatRequest(runId, content) {
  return {
    runId,
    settings: aiSettings({ baseUrl: 'https://example.invalid/v1', modelName: 'controlled-model' }),
    messages: [{ role: 'user', content }]
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  const { parseAiResponsePayload } = await loadParser()

  const normal = parseAiResponsePayload({
    choices: [{ finish_reason: 'stop', message: { content: '{"title":"第11章","body":"正文"}' } }]
  })
  assert(normal.result.ok && normal.result.content.includes('正文'), 'normal chat content remains available')

  const multipart = parseAiResponsePayload({
    choices: [{
      finish_reason: 'stop',
      message: { content: [{ type: 'text', text: '{"title":"第11章",' }, { type: 'text', text: '"body":"正文"}' }] }
    }]
  })
  assert(multipart.result.ok && multipart.result.content.includes('"body":"正文"'), 'multipart compatible content is joined')

  const silentEmpty = parseAiResponsePayload({
    choices: [{ finish_reason: 'stop', message: { content: '' } }],
    usage: { completion_tokens: 0 }
  })
  assert(!silentEmpty.result.ok && silentEmpty.emptyContent, 'HTTP 200 empty content is recognized')
  assert(silentEmpty.canRetryWithoutResponseFormat, 'silent empty content can retry without response_format')

  const reasoningOnly = parseAiResponsePayload({
    choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: 'internal reasoning' } }]
  })
  assert(reasoningOnly.diagnostics.reasoningCharacters > 0, 'reasoning-only responses are diagnosed without exposing reasoning text')
  assert(/只返回了推理内容/.test(reasoningOnly.result.error), 'reasoning-only response gets an actionable author-facing error')
  assert(!reasoningOnly.canRetryWithoutResponseFormat, 'reasoning-only responses do not start another expensive compatibility request')

  const tokenExhausted = parseAiResponsePayload({
    choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'internal reasoning' } }],
    usage: { completion_tokens: 16000 }
  })
  assert(!tokenExhausted.canRetryWithoutResponseFormat, 'token exhaustion does not repeat the same expensive request')
  assert(/Max Tokens/.test(tokenExhausted.result.error), 'token exhaustion names the concrete recovery action')

  const refused = parseAiResponsePayload({
    choices: [{ finish_reason: 'content_filter', message: { content: null, refusal: 'refused' } }]
  })
  assert(!refused.canRetryWithoutResponseFormat, 'content-policy refusal is not retried as a compatibility failure')

  const aiService = read('src/main/services/AIService.ts')
  assert(
    /retrying without response_format/.test(aiService) &&
      /postWithFallback\(url, fallbackBody, headers, undefined, \{/.test(aiService),
    'main-process AI transport retries silent empty responses without response_format'
  )
  assert(
    !/reasoningContent\}`/.test(aiService) && /reasoningCharacters=/.test(aiService),
    'empty-response logs record safe metadata instead of hidden reasoning content'
  )

  const templates = read('src/services/ai/AIPromptTemplates.ts')
  const pipeline = read('src/services/ai/GenerationPipelineAI.ts')
  assert(/CHAPTER_PLAN_SYSTEM_PROMPT/.test(templates), 'chapter planning has a dedicated system prompt')
  assert(/CHAPTER_DRAFT_SYSTEM_PROMPT/.test(templates), 'chapter drafting has a dedicated system prompt')
  assert(/OPENING_CHAPTER_PLAN_SYSTEM_PROMPT/.test(templates), 'opening chapter planning has a clean-room system prompt')
  assert(/OPENING_CHAPTER_DRAFT_SYSTEM_PROMPT/.test(templates), 'opening chapter drafting has a clean-room system prompt')
  assert(
    /isOpeningChapter \? OPENING_CHAPTER_PLAN_SYSTEM_PROMPT : CHAPTER_PLAN_SYSTEM_PROMPT/.test(pipeline),
    'chapter plan generation no longer uses the review/extraction system prompt'
  )
  assert(
    /isOpeningChapter \? OPENING_CHAPTER_DRAFT_SYSTEM_PROMPT : CHAPTER_DRAFT_SYSTEM_PROMPT/.test(pipeline),
    'chapter draft generation no longer uses the review/extraction system prompt'
  )
  assert(
    /直接写正文，不做复盘、提取、分析或任务规划/.test(templates),
    'draft system prompt explicitly prevents the previous role conflict'
  )

  const { AIService, AiRequestTimeoutError } = await loadTransport()
  const logs = []
  const successfulClient = {
    calls: [],
    async postWithFallback(_url, body) {
      this.calls.push(body)
      return jsonResponse({
        choices: [{ finish_reason: 'stop', message: { content: '{"body":"正文"}' } }]
      })
    }
  }
  const service = new AIService(
    { getApiKey: async () => 'TEST_CREDENTIAL' },
    {},
    { httpClient: successfulClient, logger: { info: (line) => logs.push(line), warn: (line) => logs.push(line) } }
  )
  const deepSeekResult = await service.chatCompletion({
    settings: aiSettings(),
    messages: [{ role: 'user', content: '请输出 JSON。' }]
  })
  assert(deepSeekResult.ok, 'official DeepSeek V4 request still returns normal final content')
  assert(
    successfulClient.calls[0]?.thinking?.type === 'disabled',
    'official DeepSeek V4 uses non-thinking mode for chapter production'
  )
  assert(logs.some((line) => /thinking=disabled/.test(line)), 'DeepSeek thinking policy is visible in safe request logs')

  const compatibleClient = {
    calls: [],
    async postWithFallback(_url, body) {
      this.calls.push(body)
      return jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] })
    }
  }
  const compatibleService = new AIService(
    { getApiKey: async () => 'TEST_CREDENTIAL' },
    {},
    { httpClient: compatibleClient, logger: { info() {}, warn() {} } }
  )
  await compatibleService.chatCompletion({
    settings: aiSettings({ baseUrl: 'https://example.invalid/v1', modelName: 'deepseek-v4-flash' }),
    messages: [{ role: 'user', content: 'test' }]
  })
  assert(!('thinking' in compatibleClient.calls[0]), 'non-official compatible endpoints keep their provider-default request shape')

  const reasoningClient = {
    calls: 0,
    async postWithFallback() {
      this.calls += 1
      return jsonResponse({
        choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: 'long reasoning' } }],
        usage: { completion_tokens: 3884 }
      })
    }
  }
  const reasoningService = new AIService(
    { getApiKey: async () => 'TEST_CREDENTIAL' },
    {},
    { httpClient: reasoningClient, logger: { info() {}, warn() {} } }
  )
  const reasoningResult = await reasoningService.chatCompletion({
    settings: aiSettings(),
    messages: [{ role: 'user', content: 'test' }]
  })
  assert(!reasoningResult.ok && reasoningClient.calls === 1, 'reasoning-only DeepSeek response fails fast instead of consuming a second timeout')

  const timeoutService = new AIService(
    { getApiKey: async () => 'TEST_CREDENTIAL' },
    {},
    {
      httpClient: { async postWithFallback() { throw new AiRequestTimeoutError(259_000) } },
      logger: { info() {}, warn() {} }
    }
  )
  const timeoutResult = await timeoutService.chatCompletion({
    settings: aiSettings(),
    messages: [{ role: 'user', content: 'test' }]
  })
  assert(
    !timeoutResult.ok && /300 秒硬超时/.test(timeoutResult.error) && !/259 秒/.test(timeoutResult.error),
    'nested request timeout reports the configured total budget instead of the remaining seconds'
  )

  const concurrentClient = createControlledHttpClient()
  const concurrentService = new AIService(
    { getApiKey: async () => 'TEST_CREDENTIAL' },
    {},
    { httpClient: concurrentClient, logger: { info() {}, warn() {} } }
  )
  const concurrentFirst = concurrentService.chatCompletion(chatRequest('shared-run', 'first'))
  const concurrentSecond = concurrentService.chatCompletion(chatRequest('shared-run', 'second'))
  await waitForCallCount(concurrentClient, 2)
  assert(
    !concurrentClient.calls[0].signal.aborted && !concurrentClient.calls[1].signal.aborted,
    'starting a second AI call in the same run does not abort the first call'
  )
  concurrentClient.calls[1].succeed('second result')
  const concurrentSecondResult = await concurrentSecond
  assert(concurrentSecondResult.ok && !concurrentClient.calls[0].signal.aborted, 'same-run AI calls can complete independently')
  concurrentClient.calls[0].succeed('first result')
  const concurrentFirstResult = await concurrentFirst
  assert(
    concurrentFirstResult.ok && concurrentService.cancelRun('shared-run') === false,
    'the final same-run call cleanup removes the empty run registry'
  )

  const cleanupClient = createControlledHttpClient()
  const cleanupService = new AIService(
    { getApiKey: async () => 'TEST_CREDENTIAL' },
    {},
    { httpClient: cleanupClient, logger: { info() {}, warn() {} } }
  )
  const cleanupFirst = cleanupService.chatCompletion(chatRequest('cleanup-run', 'first'))
  const cleanupSecond = cleanupService.chatCompletion(chatRequest('cleanup-run', 'second'))
  await waitForCallCount(cleanupClient, 2)
  cleanupClient.calls[0].succeed('first complete')
  assert((await cleanupFirst).ok, 'one same-run call can finish before its peer')
  assert(cleanupService.cancelRun('cleanup-run'), 'completed call cleanup preserves its active same-run peer')
  const cleanupSecondResult = await cleanupSecond
  assert(
    !cleanupSecondResult.ok && cleanupSecondResult.telemetry?.terminationCategory === 'cancelled',
    'cancelRun still cancels the active peer after another call cleaned up'
  )

  const cancelAllClient = createControlledHttpClient()
  const cancelAllService = new AIService(
    { getApiKey: async () => 'TEST_CREDENTIAL' },
    {},
    { httpClient: cancelAllClient, logger: { info() {}, warn() {} } }
  )
  const cancelledFirst = cancelAllService.chatCompletion(chatRequest('cancel-all-run', 'first'))
  const cancelledSecond = cancelAllService.chatCompletion(chatRequest('cancel-all-run', 'second'))
  await waitForCallCount(cancelAllClient, 2)
  assert(cancelAllService.cancelRun('cancel-all-run'), 'cancelRun reports an active run with concurrent calls')
  const cancelledResults = await Promise.all([cancelledFirst, cancelledSecond])
  assert(
    cancelAllClient.calls.every((call) => call.signal.aborted) &&
      cancelledResults.every((result) => !result.ok && result.telemetry?.terminationCategory === 'cancelled') &&
      cancelAllService.cancelRun('cancel-all-run') === false,
    'cancelRun aborts every active call in the run and clears the run registry'
  )

  console.log('AI empty-response recovery validation passed.')
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error))
    process.exitCode = 1
  })
  .finally(async () => {
    await rm(resolve(outDir), { recursive: true, force: true })
  })

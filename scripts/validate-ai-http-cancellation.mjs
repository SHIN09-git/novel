#!/usr/bin/env node
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { join } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

async function loadClient() {
  const result = await build({
    entryPoints: [join(repoRoot, 'src/main/services/AIHttpClient.ts')],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}

async function test(name, operation) {
  await operation()
  console.log(`PASS ${name}`)
}

async function main() {
  const { AIHttpClient } = await loadClient()
  const originalFetch = globalThis.fetch

  try {
    await test('pre-aborted post rejects without invoking fetch', async () => {
      let fetchCalls = 0
      globalThis.fetch = async () => {
        fetchCalls += 1
        return new Response('{}')
      }
      const controller = new AbortController()
      controller.abort()

      await assert.rejects(
        new AIHttpClient().post('https://example.invalid', {}, {}, { signal: controller.signal }),
        (error) => error?.name === 'AiRequestCancelledError' && error?.code === 'AI_REQUEST_CANCELLED'
      )
      assert.equal(fetchCalls, 0)
    })

    await test('response_format fallback does not start after cancellation', async () => {
      let fetchCalls = 0
      let fallbackCallbacks = 0
      globalThis.fetch = async () => {
        fetchCalls += 1
        return new Response('unsupported response_format', { status: 400 })
      }
      const controller = new AbortController()

      await assert.rejects(
        new AIHttpClient().postWithFallback(
          'https://example.invalid',
          { response_format: { type: 'json_object' } },
          {},
          { prompt: 'fallback' },
          {
            signal: controller.signal,
            onResponseFormatFallback: () => {
              fallbackCallbacks += 1
              controller.abort()
            }
          }
        ),
        (error) => error?.name === 'AiRequestCancelledError' && error?.code === 'AI_REQUEST_CANCELLED'
      )
      assert.equal(fallbackCallbacks, 1)
      assert.equal(fetchCalls, 1)
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  console.log('AI HTTP cancellation validation passed.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

#!/usr/bin/env node
import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const require = createRequire(import.meta.url)
const compiled = new Map()

async function load(relativePath, dependencies = {}, globals = {}) {
  if (!compiled.has(relativePath)) {
    const result = await build({
      entryPoints: [join(repoRoot, relativePath)],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['electron'],
      logLevel: 'silent'
    })
    compiled.set(relativePath, result.outputFiles[0].text)
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', ...Object.keys(globals), compiled.get(relativePath))(
    (name) => dependencies[name] ?? require(name), module, module.exports, ...Object.values(globals)
  )
  return module.exports
}

async function test(name, operation) {
  await operation()
  console.log(`PASS ${name}`)
}

const progressPath = 'src/main/services/AiCallProgressStore.ts'
const { AiCallProgressStore } = await load(progressPath)

function start(store, callId, runId = 'run') {
  store.start({ callId, runId, provider: 'local', model: 'fixture' })
}

function populatedStore() {
  let now = 0
  const store = new AiCallProgressStore({ now: () => now, terminalRetentionMs: 60_000 })
  for (let index = 0; index < 200; index += 1) {
    now += 1
    start(store, `call-${index}`)
    if (index % 10 !== 0) store.update('run', `call-${index}`, 'completed')
  }
  return store
}

function countSorts(operation) {
  const original = Array.prototype.sort
  let count = 0
  Array.prototype.sort = function (...args) {
    count += 1
    return original.apply(this, args)
  }
  try {
    operation()
    return count
  } finally {
    Array.prototype.sort = original
  }
}

async function logHarness() {
  const calls = []
  const files = new Map()
  let directoryExists = false
  let failureCode
  const ioError = (code) => Object.assign(new Error(code), { code })
  const fs = {
    mkdirSync(path) { calls.push('mkdir'); directoryExists = true },
    existsSync(path) { calls.push('exists'); return files.has(path) },
    statSync(path) {
      calls.push('stat')
      if (!files.has(path)) throw ioError('ENOENT')
      return { size: files.get(path).size }
    },
    renameSync(from, to) {
      calls.push('rename')
      if (failureCode) throw ioError(failureCode)
      files.set(to, files.get(from))
      files.delete(from)
    },
    appendFileSync(path, line) {
      calls.push('append')
      if (failureCode) throw ioError(failureCode)
      if (!directoryExists) throw ioError('ENOENT')
      const file = files.get(path) ?? { size: 0, lines: [] }
      file.size += Buffer.byteLength(line)
      file.lines.push(line)
      files.set(path, file)
    }
  }
  const { LogService } = await load('src/main/LogService.ts', {
    electron: {
      app: { isReady: () => true, isPackaged: true, getPath: () => '/isolated-log-fixture', getVersion: () => 'test' },
      shell: { showItemInFolder() {} }
    },
    'node:fs': fs
  })
  return {
    LogService, files, calls,
    removeDirectory() { files.clear(); directoryExists = false },
    failWrites(code) { failureCode = code }
  }
}

async function fakeLimiter(capacity, refillRate) {
  let now = 0
  const timers = []
  const { TokenBucketRateLimiter } = await load('src/main/RateLimiter.ts', {}, {
    Date: { now: () => now },
    setTimeout: (callback, delay) => { timers.push({ at: now + delay, callback }); return timers.length }
  })
  return {
    limiter: new TokenBucketRateLimiter(capacity, refillRate), timers,
    async advance(timestamp) {
      now = timestamp
      for (let index = 0; index < timers.length;) {
        if (timers[index].at <= now) timers.splice(index, 1)[0].callback()
        else index += 1
      }
      await Promise.resolve()
      await Promise.resolve()
    }
  }
}

async function benchmark() {
  const store = populatedStore()
  const scenarios = [
    ['exact', { runId: 'run', callId: 'call-190' }],
    ['run', { runId: 'run' }],
    ['latest', {}]
  ]
  for (const [name, query] of scenarios) {
    for (let index = 0; index < 2_000; index += 1) store.get(query)
    const samples = []
    for (let sample = 0; sample < 5; sample += 1) {
      const started = performance.now()
      for (let index = 0; index < 10_000; index += 1) store.get(query)
      samples.push(performance.now() - started)
    }
    const sorts = countSorts(() => { for (let index = 0; index < 1_000; index += 1) store.get(query) })
    console.log(`BENCH progress ${name}: median=${samples.sort((a, b) => a - b)[2].toFixed(2)}ms/10000 reads; sorts=${sorts}/1000 reads`)
  }
  const harness = await logHarness()
  harness.LogService.initialize()
  harness.calls.length = 0
  for (let index = 0; index < 1_000; index += 1) harness.LogService.info('fixture line')
  console.log(`BENCH log: ${JSON.stringify(Object.fromEntries(['mkdir', 'exists', 'stat', 'append'].map((name) => [name, harness.calls.filter((call) => call === name).length])))}/1000 lines`)
  const clock = await fakeLimiter(1, 1)
  await clock.limiter.acquire()
  const waiting = Array.from({ length: 3 }, () => clock.limiter.acquire())
  console.log(`BENCH limiter: concurrent waits scheduled at ${JSON.stringify(clock.timers.map((timer) => timer.at))}ms`)
  await clock.advance(3_000)
  await Promise.all(waiting)
}

if (process.argv.includes('--benchmark')) {
  await benchmark()
} else {
  await test('progress polling does not sort records within the retention budget', () => {
    const store = populatedStore()
    const sorts = countSorts(() => {
      assert.equal(store.get({ runId: 'run', callId: 'call-190' }).callId, 'call-190')
      assert.equal(store.get({ runId: 'run' }).callId, 'call-190')
      assert.equal(store.get().callId, 'call-190')
      assert.equal(store.get({ callId: 'call-199' }).stage, 'completed')
      assert.equal(store.get({ runId: 'missing' }), null)
    })
    assert.equal(sorts, 0)
  })

  await test('progress lookup preserves active preference, run namespaces and same-time ordering', () => {
    const store = new AiCallProgressStore({ now: () => 100 })
    start(store, 'same', 'first')
    start(store, 'same', 'second')
    store.update('second', 'same', 'completed')
    assert.equal(store.get({ callId: 'same' }).runId, 'second')
    assert.equal(store.get().runId, 'first')
    assert.equal(store.get({ runId: 'first', callId: 'same' }).runId, 'first')
    assert.equal(store.get({ runId: 'second' }).stage, 'completed')
    start(store, 'newer', 'first')
    assert.equal(store.get({ runId: 'first' }).callId, 'newer')
    store.update('first', 'same', 'reading_response', { attempt: 2 })
    assert.equal(store.get({ runId: 'first' }).callId, 'same')
    assert.deepEqual(store.listRun('first').map((item) => item.callId), ['same', 'newer'])
  })

  await test('progress snapshots are detached and terminal retention keeps its strict boundary', () => {
    let now = 100
    const store = new AiCallProgressStore({ now: () => now, terminalRetentionMs: 10 })
    start(store, 'call')
    const snapshot = store.get({ callId: 'call' })
    snapshot.stage = 'failed'
    now += 5
    store.update('run', 'call', 'completed')
    store.update('run', 'call', 'failed')
    now += 10
    assert.equal(store.get({ callId: 'call' }).stage, 'completed')
    assert.equal(store.get({ callId: 'call' }).elapsedMs, 5)
    now += 1
    assert.equal(store.get({ callId: 'call' }), null)
  })

  await test('exact lookup keeps empty and absent run namespaces distinct', () => {
    const store = new AiCallProgressStore({ now: () => 100 })
    store.start({ callId: 'call', provider: 'local', model: 'fixture' })
    assert.equal(store.get({ runId: '', callId: 'call' }), null)
    assert.equal(store.get({ callId: 'call' }).runId, undefined)
    start(store, 'call', '')
    assert.equal(store.get({ runId: '', callId: 'call' }).runId, '')
  })

  await test('terminal overflow removes oldest entries without evicting active calls', () => {
    const store = new AiCallProgressStore({ now: () => 100, maxEntries: 3 })
    start(store, 'active')
    for (let index = 0; index < 30; index += 1) {
      start(store, `done-${index}`)
      store.update('run', `done-${index}`, 'completed')
    }
    assert.deepEqual(store.listRun('run').map((item) => item.callId), ['done-29', 'done-28', 'active'])
    for (let index = 0; index < 10; index += 1) start(store, `active-${index}`)
    assert.equal(store.listRun('run').length, 11)
    assert.ok(store.listRun('run').every((item) => item.stage === 'waiting_response'))
  })

  await test('ordinary log writes use only stat and append, without a retained queue', async () => {
    const { LogService, calls, files } = await logHarness()
    LogService.initialize()
    calls.length = 0
    for (let index = 0; index < 100; index += 1) LogService.info(`line ${index}`)
    assert.equal(calls.filter((call) => call === 'mkdir').length, 0)
    assert.equal(calls.filter((call) => call === 'exists').length, 0)
    assert.equal(calls.filter((call) => call === 'stat').length, 100)
    assert.equal(calls.filter((call) => call === 'append').length, 100)
    assert.match(files.get(LogService.getLogPath()).lines.at(-1), /line 99/)
  })

  await test('logging creates a missing directory and recovers if it is later removed', async () => {
    const harness = await logHarness()
    harness.LogService.info('without initialize')
    assert.equal(harness.files.get(harness.LogService.getLogPath()).lines.length, 1)
    harness.removeDirectory()
    harness.LogService.warn('after removal')
    assert.equal(harness.files.get(harness.LogService.getLogPath()).lines.length, 1)
  })

  await test('rotation still checks real file size and preserves redaction', async () => {
    const { LogService, files, calls } = await logHarness()
    LogService.info('first')
    const path = LogService.getLogPath()
    files.get(path).size = 10 * 1024 * 1024
    LogService.error('Authorization: Bearer fixture-secret', { apiKey: 'fixture-key' }, new Error('token=fixture-token'))
    assert.equal(calls.filter((call) => call === 'rename').length, 1)
    assert.equal(files.size, 2)
    const text = files.get(path).lines.join('')
    assert.doesNotMatch(text, /fixture-secret|fixture-key|fixture-token/)
    assert.match(text, /REDACTED/)
    assert.equal(files.get(path).lines.length, 1)
  })

  await test('permission failures are contained and do not trigger directory retries', async () => {
    const harness = await logHarness()
    harness.LogService.initialize()
    harness.calls.length = 0
    harness.failWrites('EACCES')
    assert.doesNotThrow(() => harness.LogService.info('not writable'))
    assert.equal(harness.calls.filter((call) => call === 'append').length, 1)
    assert.equal(harness.calls.filter((call) => call === 'mkdir').length, 0)
  })

  await test('concurrent limiter waiters reserve distinct refill slots', async () => {
    const clock = await fakeLimiter(1, 1)
    await clock.limiter.acquire()
    const finished = []
    const pending = [1, 2, 3].map((index) => clock.limiter.acquire().then(() => finished.push(index)))
    assert.deepEqual(clock.timers.map((timer) => timer.at), [1_000, 2_000, 3_000])
    assert.equal(clock.limiter.getAvailableTokens(), 0)
    await clock.advance(1_000)
    assert.deepEqual(finished, [1])
    assert.equal(clock.limiter.getAvailableTokens(), 0)
    await clock.advance(2_000)
    assert.deepEqual(finished, [1, 2])
    await clock.advance(3_000)
    await Promise.all(pending)
    assert.deepEqual(finished, [1, 2, 3])
    assert.equal(clock.timers.length, 0)
    await clock.advance(10_000)
    assert.equal(clock.limiter.getAvailableTokens(), 1)
  })

  await test('later limiter arrivals cannot consume already reserved tokens', async () => {
    const clock = await fakeLimiter(2, 2)
    await clock.limiter.acquire(2)
    const first = clock.limiter.acquire(2)
    await clock.advance(250)
    const second = clock.limiter.acquire()
    assert.deepEqual(clock.timers.map((timer) => timer.at), [1_000, 1_500])
    await clock.advance(1_500)
    await Promise.all([first, second])
    await clock.advance(1_750)
    assert.equal(clock.limiter.getAvailableTokens(), 0)
    await clock.advance(2_000)
    assert.equal(clock.limiter.getAvailableTokens(), 1)
    await assert.rejects(clock.limiter.acquire(0))
    await assert.rejects(clock.limiter.acquire(Number.NaN))
    assert.equal(clock.timers.length, 0)
  })

  await test('HTTP success and body failure release caller abort listeners and timeout handles', async () => {
    const timers = new Set()
    const caller = new AbortController()
    let failBody = false
    const { AIHttpClient } = await load('src/main/services/AIHttpClient.ts', {}, {
      setTimeout: (callback) => { timers.add(callback); return callback },
      clearTimeout: (callback) => timers.delete(callback),
      fetch: async () => new Response(new ReadableStream({
        start(controller) {
          if (failBody) controller.error(new Error('fixture body error'))
          else { controller.enqueue(new TextEncoder().encode('{}')); controller.close() }
        }
      }))
    })
    for (let index = 0; index < 30; index += 1) {
      failBody = index % 2 !== 0
      const pending = new AIHttpClient().post('https://fixture.invalid', {}, {}, { signal: caller.signal })
      if (failBody) await assert.rejects(pending, /fixture body error/)
      else assert.deepEqual(await (await pending).json(), {})
      assert.equal(getEventListeners(caller.signal, 'abort').length, 0)
      assert.equal(timers.size, 0)
    }
  })

  await test('HTTP body cancellation and timeout keep distinct errors and release resources', async () => {
    for (const cancelled of [true, false]) {
      const timers = new Set()
      const caller = new AbortController()
      let internalSignal
      const { AIHttpClient } = await load('src/main/services/AIHttpClient.ts', {}, {
        setTimeout: (callback) => { timers.add(callback); return callback },
        clearTimeout: (callback) => timers.delete(callback),
        fetch: async (_url, { signal }) => {
          internalSignal = signal
          return new Response(new ReadableStream({
            start(controller) {
              signal.addEventListener('abort', () => controller.error(new Error('fixture abort')), { once: true })
            }
          }))
        }
      })
      const pending = new AIHttpClient().post('https://fixture.invalid', {}, {}, {
        signal: caller.signal,
        timeoutMs: 7_000,
        onResponseStarted() {
          if (cancelled) caller.abort()
          else [...timers][0]()
        }
      })
      await assert.rejects(pending, (error) => error.name === (cancelled ? 'AiRequestCancelledError' : 'AiRequestTimeoutError'))
      assert.equal(internalSignal.aborted, true)
      assert.equal(getEventListeners(caller.signal, 'abort').length, 0)
      assert.equal(timers.size, 0)
    }
  })

  console.log('Backend AI performance validation passed (isolated fixtures; no model or user-data access).')
}

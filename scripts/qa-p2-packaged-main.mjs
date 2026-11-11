// A black-box test of the shipped main process. Never import a source AI client or seed a receipt.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { repoRoot as root } from './utils/repo-root.mjs'
import { freePort } from './utils/qa-agent-authorization-driver.mjs'
import { cleanup, evaluate } from './utils/long-novel-ui-driver.mjs'
import { connectQaSession, prepareTarget, qaRuntimeTarget, targetIdentity } from './utils/long-novel-ui-runtime.mjs'

const target = qaRuntimeTarget(root)
assert.equal(target.mode, 'packaged', 'Use --packaged: this test accepts only the shipped desktop.')
const tmp = join(root, 'tmp')
await mkdir(tmp, { recursive: true })
const work = await mkdtemp(join(tmp, 'p2-packaged-main-')), profile = join(work, 'profile')
const A = 'p2-main-a', B = 'p2-main-b', model = 'p2-local', runId = 'p2-run'
const privateMarker = 'p2-private-fixture', stages = new Map(), requests = [], diagnoses = {}, launches = []
const responses = {
  format: [400, 200], retry: [503, 200], limit: [429], quota: [429], auth: [401], cut: ['cut-body']
}
let origin, blocked = 0, session
const mock = createServer(async (req, res) => {
  try {
    const route = /^\/(\w+)\/v1\/chat\/completions$/.exec(req.url)?.[1]
    assert.equal(req.socket.localAddress, '127.0.0.1')
    assert.equal(req.socket.remoteAddress, '127.0.0.1')
    assert.equal(req.headers.host, new URL(origin).host)
    assert.equal(req.method, 'POST')
    assert(!('authorization' in req.headers) && !('proxy-authorization' in req.headers))
    assert(Object.hasOwn(responses, route))
    let raw = ''
    for await (const chunk of req) { raw += chunk; assert(raw.length < 4096) }
    const body = JSON.parse(raw)
    assert.equal(body.model, model)
    assert.deepEqual(body.messages, [{ role: 'user', content: privateMarker + '-prompt' }])
    const i = stages.get(route) ?? 0, status = responses[route][i]
    assert(status, 'Unexpected extra dispatch')
    stages.set(route, i + 1)
    const requestId = 'p2-' + route + '-' + (i + 1)
    requests.push({ route, status, requestId, jsonMode: body.response_format?.type === 'json_object' })
    const headers = { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff',
      'X-Request-ID': requestId, Connection: 'close' }
    if (status === 'cut-body') {
      res.writeHead(200, { ...headers, 'Content-Length': '65536' })
      res.write('["' + privateMarker + ' '.repeat(8192))
      setTimeout(() => res.destroy(), 150)
    } else if (status === 200) {
      const [input, output] = route === 'format' ? [17, 5] : [7, 2]
      res.writeHead(status, headers).end(JSON.stringify({ choices: [{ message: { content: 'local-ok' } }],
        usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output } }))
    } else {
      const code = { format: 'unsupported_response_format', retry: 'temporarily_unavailable',
        limit: 'rate_limit_exceeded', quota: 'insufficient_quota', auth: 'unauthorized' }[route]
      res.writeHead(status, headers).end(JSON.stringify({ error: { code, message: privateMarker + '-response' } }))
    }
  } catch {
    blocked++
    res.writeHead(403, { Connection: 'close' }).end()
  }
})
// Never forward HTTP proxy requests, HTTPS tunnels or WebSockets, including to a literal external IP.
for (const event of ['connect', 'upgrade']) mock.on(event, (_req, socket) => { blocked++; socket.destroy() })

async function launchRestricted() {
  const port = await freePort(), host = new URL(origin).host
  const env = {}
  for (const k of ['SystemRoot', 'WINDIR', 'ComSpec', 'SYSTEMDRIVE', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']) {
    if (process.env[k]) env[k] = process.env[k]
  }
  Object.assign(env, { NOVEL_DIRECTOR_SMOKE_USER_DATA: profile, HOME: join(profile, 'home'), USERPROFILE: join(profile, 'home'),
    APPDATA: join(profile, 'roaming'), LOCALAPPDATA: join(profile, 'local'), TEMP: join(profile, 'temp'), TMP: join(profile, 'temp'),
    CODEX_HOME: join(profile, 'codex'), NOVEL_DIRECTOR_API_REGISTRY: join(profile, 'empty-registry.json'),
    PATH: join(env.SystemRoot, 'System32') })
  const args = ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--disable-background-networking', '--disable-component-update', '--disable-quic', '--no-first-run',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    '--proxy-server=' + origin, '--proxy-bypass-list=<-loopback>;' + host]
  // Only the mock's exact host:port is direct. All other Chromium traffic goes to the non-forwarding mock.
  const child = spawn(target.executable, args, { cwd: target.runtimeRoot, env, windowsHide: true, stdio: 'ignore' })
  await once(child, 'spawn')
  session = { child, port, args, processIds: [], logs: [], exceptions: [], networkRequests: [] }
  await connectQaSession(target, session, profile)
  launches.push({ pid: child.pid, port, profile, mock: origin })
}
async function stop() {
  if (!session) return
  const closed = await cleanup(session)
  assert.deepEqual(closed.remainingProcessIds, [])
  assert.deepEqual(session.exceptions, [])
  assert.deepEqual(session.networkRequests, [])
  console.log('CLOSED', JSON.stringify({ pid: session.child.pid, remainingProcessIds: [], rendererRequests: 0 }))
  session = null
}

const settings = { apiProvider: 'local', modelName: model, temperature: 0, maxTokens: 32, requestTimeoutMs: 10000 }
const phases = { format: 'writing', retry: 'review', limit: 'review', quota: 'revision', auth: 'other', cut: 'other' }
const book = name => ['format', 'retry', 'limit'].includes(name) ? A : B
const ui = expr => evaluate(session.client, expr)
const report = id => ui('window.novelDirector.data.getProjectUsage(' + JSON.stringify(id) + ')')
const revision = () => ui('window.novelDirector.data.load().then(r=>r.revision)')
async function chat(name, overrides = {}) {
  const retry = ['retry', 'quota', 'auth'].includes(name)
  const req = { settings: { ...settings, baseUrl: origin + '/' + name + '/v1', retryEnabled: retry, maxRetries: retry ? 1 : 0 },
    messages: [{ role: 'user', content: privateMarker + '-prompt' }], usageContext: { projectId: book(name), phase: phases[name] },
    runId, clientCallId: 'logical-' + name, ...overrides }
  return ui('window.novelDirector.ai.chatCompletion(' + JSON.stringify(req) + ')')
}
async function receipts(id) {
  const storage = join(profile, 'novel-director-data.sqlite')
  const file = join(storage + '.usage', createHash('sha256').update(id).digest('hex') + '.jsonl')
  assert.equal(dirname(await realpath(file)), await realpath(storage + '.usage'))
  const raw = await readFile(file, 'utf8')
  assert(!raw.includes(privateMarker), 'Private fixture content appeared in the on-disk ledger')
  return raw.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
}

try {
  await targetIdentity(root, target)
  await prepareTarget(root, target, work)
  await new Promise((ok, fail) => mock.once('error', fail).listen(0, '127.0.0.1', ok))
  assert.equal(mock.address().address, '127.0.0.1')
  origin = 'http://127.0.0.1:' + mock.address().port
  for (const name of ['home', 'roaming', 'local', 'temp', 'codex']) await mkdir(join(profile, name), { recursive: true })
  await writeFile(join(profile, 'empty-registry.json'), JSON.stringify({ version: 1, apis: {} }), { flag: 'wx' })
  await writeFile(join(profile, 'novel-director-data.json'), JSON.stringify({ settings: { ...settings, baseUrl: origin + '/v1' },
    projects: [{ id: A, name: A, modelRates: [{ provider: 'local', endpoint: origin, model, currency: 'CNY',
      inputPerMillionTokens: 2, outputPerMillionTokens: 3 }] }, { id: B, name: B }] }), { flag: 'wx' })
  await launchRestricted()
  const before = await revision()
  assert.equal((await chat('format', { usageContext: { projectId: A, phase: 'invalid' } })).ok, false)
  assert.equal(requests.length, 0)
  for (const id of [A, B]) assert.equal((await report(id)).totals.requests, 0)
  const errors = { limit: /HTTP 429.*限流/, quota: /HTTP 429.*额度不足/, auth: /HTTP 401.*身份验证/, cut: /已收到响应头.*读完响应正文/ }
  for (const [name, statuses] of Object.entries(responses)) {
    const start = requests.length, result = await chat(name)
    assert.deepEqual(requests.slice(start).map(r => r.status), statuses, name + ': wire status sequence')
    assert.deepEqual(requests.slice(start).map(r => r.jsonMode), statuses.map((_, i) => name !== 'format' || i === 0))
    assert.equal(result.telemetry?.attempts, statuses.length)
    assert(!result.telemetry.usageJournalIncomplete)
    assert.equal(result.ok, !errors[name])
    if (result.ok) {
      assert.equal(result.content, 'local-ok')
      assert.equal(result.telemetry.responseFormatFallback, name === 'format')
      assert.deepEqual(result.telemetry.usage, name === 'format' ? { promptTokens: 17, completionTokens: 5, totalTokens: 22 }
        : { promptTokens: 7, completionTokens: 2, totalTokens: 9 })
    } else {
      assert.match(result.error, errors[name])
      assert(result.error.includes('桌面 Electron ' + target.observedRuntime.electronVersion + '（Chromium net.fetch）'))
      assert.match(result.error, /额度未知/)
      assert(!result.error.includes(privateMarker))
      diagnoses[name] = result.error
    }
    console.log('MAIN_CASE', JSON.stringify({ name, attempts: result.telemetry.attempts, statuses, diagnosis: diagnoses[name] }))
  }
  const projects = {}
  for (const id of [A, B]) {
    const rows = await receipts(id), hits = requests.filter(r => book(r.route) === id)
    assert.deepEqual(rows.map(r => [r.projectId, r.runId, r.callId, r.phase, r.provider, r.model, r.endpoint, r.providerRequestId, r.outcome]),
      hits.map(r => [id, runId, 'logical-' + r.route, phases[r.route], 'local', model, origin, r.requestId, r.status === 200 ? 'success' : 'failed']))
    assert.deepEqual(rows.map(r => r.usage), hits.map(r => r.status !== 200 ? undefined : r.route === 'format'
      ? { promptTokens: 17, completionTokens: 5, totalTokens: 22 } : { promptTokens: 7, completionTokens: 2, totalTokens: 9 }))
    const usage = await report(id), t = usage.totals, failures = hits.filter(r => r.status !== 200).length
    assert.deepEqual([t.requests, t.failedRequests, t.unknownUsageRequests], [hits.length, failures, failures])
    assert.deepEqual(t.costs, id === A ? [{ currency: 'CNY', amount: 0.000069, pricedRequests: 2 }] : [])
    assert.deepEqual([t.tokens.promptTokens, t.tokens.completionTokens, t.tokens.totalTokens], id === A ? [24, 7, 31] : [null, null, null])
    for (const phase of usage.byPhase) assert.equal(phase.requests, hits.filter(r => phases[r.route] === phase.phase).length)
    assert.equal(usage.coverage.invalidRecords, 0)
    projects[id] = { rows, usage }
  }
  assert.equal(new Set(Object.values(projects).flatMap(p => p.rows.map(r => r.id))).size, requests.length)
  assert.equal(await revision(), before, 'Usage receipts must not advance the manuscript revision')
  const n = requests.length
  await stop()
  await launchRestricted()
  for (const id of [A, B]) {
    assert.deepEqual(await report(id), projects[id].usage)
    assert.deepEqual(await receipts(id), projects[id].rows)
  }
  assert.equal(await revision(), before)
  await stop()
  assert.equal(requests.length, n)
  assert.equal(blocked, 0, 'Unexpected request, tunnel, credentials or malformed mock payload')
  const mainLog = await readFile(join(profile, 'logs', 'main.log'), 'utf8')
  assert(!mainLog.includes(privateMarker))
  await writeFile(join(work, 'main.log'), mainLog, { flag: 'wx' })
  const evidence = join(work, 'evidence.json')
  await writeFile(evidence, JSON.stringify({ runtime: target.observedRuntime, fingerprints: target.fingerprints, launches,
    requests, diagnoses, projects, blocked, revisionUnchanged: true, restartMatched: true }, null, 2), { flag: 'wx' })
  console.log('PASS packaged main: zero pre-dispatch requests; 8 local HTTP dispatches = 8 distinct durable receipts;',
    '6 failed, 2 successful, 24 input + 7 output tokens, CNY 0.000069. No credentials, forwarding or renderer requests.')
  console.log('EVIDENCE', evidence)
} finally {
  try {
    await stop()
  } finally {
    if (mock.listening) {
      const closed = new Promise(ok => mock.close(ok))
      mock.closeAllConnections()
      await closed
    }
    assert.equal(dirname(await realpath(work)), await realpath(tmp))
    if (await realpath(profile).catch(e => { if (e.code !== 'ENOENT') throw e })) {
      assert.equal(dirname(await realpath(profile)), await realpath(work))
      await rm(profile, { recursive: true, force: true, maxRetries: 4 })
    }
  }
}

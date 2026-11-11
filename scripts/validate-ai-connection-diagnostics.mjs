#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer, request } from 'node:http'
import { connect, createServer as createTcpServer } from 'node:net'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { repoRoot } from './utils/repo-root.mjs'

const require = createRequire(import.meta.url)
const script = fileURLToPath(import.meta.url)
const run = promisify(execFile)
const marker = 'fixture-private-'
const privateUrl = 'https://fixture-private-user:fixture-private-pass@example.invalid/private?token=fixture-private-query'
const settings = { apiProvider: 'local', modelName: 'fixture', temperature: 0, maxTokens: 16,
  requestTimeoutMs: 5_000, retryEnabled: false, maxRetries: 0 }
const messages = [{ role: 'user', content: marker + 'prompt' }]

function safe(value) {
  assert.ok(!JSON.stringify(value).includes(marker), 'private fixture data reached diagnostic output')
}

async function compile(dir) {
  const { build } = await import('esbuild')
  await build({
    stdin: { resolveDir: repoRoot, contents: [
      'main/utils/aiErrors', 'main/utils/connectionDiagnosis', 'main/services/AIHttpClient',
      'main/services/AIService', 'main/services/CodexCliService', 'shared/errorUtils'
    ].map(name => `export * from './src/${name}'`).join('\n') },
    bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent', outfile: join(dir, 'client.mjs')
  })
}

async function checkWiring() {
  const source = path => readFile(join(repoRoot, path), 'utf8')
  const desktop = await source('src/main/index.ts')
  assert.match(desktop, /new AIHttpClient\(\{[^}]*net\.fetch\([^}]*transport: 'electron-net'/)
  assert.match(await source('src/agent/AgentPipelineExecutor.ts'), /new AIHttpClient\(\{[^}]*transport: 'node-fetch'/)
  for (const file of ['scripts/run-agent.mjs', 'scripts/run-agent-tools.mjs']) {
    assert.match(await source(file), /NODE_USE_ENV_PROXY: process\.env\.NODE_USE_ENV_PROXY \?\? '1'/)
  }
}

function unit(api) {
  const context = { transport: 'custom-fetch', baseUrl: privateUrl }
  const diagnosis = error => { const result = api.diagnoseAiConnection(error, context); safe(result); return result }
  for (const [code, syscall, kind] of [
    ['ENOTFOUND', 'getaddrinfo', 'dns'], ['EAI_AGAIN', 'getaddrinfo', 'dns'],
    ['UND_ERR_CONNECT_TIMEOUT', '', 'connect_timeout'], ['ETIMEDOUT', 'connect', 'connect_timeout'],
    ['UND_ERR_HEADERS_TIMEOUT', '', 'read_timeout'], ['UND_ERR_BODY_TIMEOUT', '', 'read_timeout'],
    ['ETIMEDOUT', 'read', 'read_timeout'], ['ETIMEDOUT', '', 'network'], ['ECONNRESET', '', 'connection']
  ]) {
    const cause = Object.assign(new Error(privateUrl), { code, syscall, hostname: privateUrl })
    const error = new TypeError('fetch failed', { cause: new AggregateError([cause]) })
    assert.equal(diagnosis(error).kind, kind)
    safe(api.describeAiRetryError(error))
  }
  const nested = new Error('fetch failed')
  nested.cause = nested
  assert.equal(diagnosis(nested).kind, 'network')
  assert.match(diagnosis(nested).message, /自定义 fetch/)
  assert.doesNotMatch(diagnosis(nested).message, /NODE_USE_ENV_PROXY|桌面 Electron/)
  const mockDesktop = api.diagnoseAiConnection(nested, { transport: 'electron-net', baseUrl: privateUrl })
  assert.match(mockDesktop.message, /非 Electron 运行时/)
  assert.doesNotMatch(mockDesktop.message, /NODE_USE_ENV_PROXY/)
  assert.equal(diagnosis(new api.AiRequestCancelledError()).kind, 'cancelled')
  assert.equal(diagnosis(new api.AiRequestTimeoutError(300_000, 'reading')).kind, 'read_timeout')
  assert.match(diagnosis(new api.AiRequestTimeoutError(300_000)).message, /300 秒硬超时/)
  assert.equal(api.diagnoseAiConnection(new Error('本地参数缺失'), context), undefined)
  for (const [status, payload, kind] of [
    [402, '<html>oops</html>', 'quota_exhausted'],
    [429, { error: { type: 'insufficient_quota', code: null } }, 'quota_exhausted'],
    [429, { code: 'InsufficientBalance' }, 'quota_exhausted'],
    [429, { error: { code: 'rate_limit_exceeded', message: 'insufficient_quota' } }, 'rate_limited'],
    [429, { error: { code: 'RESOURCE_EXHAUSTED' } }, 'rate_limited'],
    [429, 'insufficient_quota', 'rate_limited'], [401, { code: 'insufficient_quota' }, 'authentication'],
    [403, { code: 'insufficient_quota' }, 'http']
  ]) {
    const error = new api.AiHttpError(status, typeof payload === 'string' ? payload : JSON.stringify({ ...payload, prompt: marker }))
    assert.equal(diagnosis(error).kind, kind)
    assert.equal(api.isRetryableAiError(error), kind === 'rate_limited')
    safe([error, error.message, error.stack, api.describeAiRetryError(error)])
  }
  safe(api.describeNetworkError(new Error('Bad endpoint: ' + privateUrl, { cause: { message: marker } })))
  safe(api.redactSensitiveText('http://fixture-private-user:fixture-private-pass@localhost/?token=fixture-private-query'))
  assert.ok(!api.redactSensitiveText('Proxy-Authorization: Basic Zml4dHVyZQ==').includes('Zml4dHVyZQ'))
  for (const [v, supported] of [['20.19.0', false], ['22.20.0', false], ['22.21.0', true], ['23.11.1', false], ['24.0.0', true]]) {
    assert.equal(api.supportsNodeFetchEnvProxy(v), supported)
  }
  const hint = (env, flags = [], version = '24.14.0') => api.describeNodeProxy(privateUrl, version, env, flags)
  const on = { HTTPS_PROXY: privateUrl, NODE_USE_ENV_PROXY: '1' }
  assert.match(hint(on, [], '22.20.0'), /不支持/)
  assert.doesNotMatch(hint(on, [], '22.20.0'), /NODE_USE_ENV_PROXY=1/)
  assert.match(hint({}), /未配置/)
  assert.match(hint({ ...on, https_proxy: '' }), /未配置/)
  assert.match(hint({ ...on, NO_PROXY: 'example.invalid:443' }), /绕过/)
  assert.match(hint({ ...on, NO_PROXY: 'example.invalid:444' }), /使用代理/)
  assert.match(hint({ ...on, NO_PROXY: '*.invalid' }), /绕过/)
  assert.match(hint({ ...on, NO_PROXY: 'ample.invalid' }), /使用代理/)
  assert.match(hint({ ...on, NODE_OPTIONS: '--use-env-proxy' }, ['--no-use-env-proxy']), /--no-use-env-proxy 禁用/)
  assert.match(hint({ HTTPS_PROXY: privateUrl, NODE_USE_ENV_PROXY: '0' }, ['--use-env-proxy']), /已启用/)
  safe(hint(on))
}

async function listen(server, protocol = 'http:') {
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  return protocol + '//127.0.0.1:' + server.address().port
}

async function loopbacks() {
  const hits = new Map()
  let proxyHits = 0
  const sockets = new Set()
  const origin = createServer((req, res) => {
    const [, mode, name] = new URL(req.url, 'http://127.0.0.1').pathname.split('/')
    const key = mode + '/' + name
    hits.set(key, 1 + (hits.get(key) ?? 0))
    req.resume()
    if (name === 'drop') return req.socket.destroy()
    if (name === 'stall') return
    if (name === 'slow-body') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' })
      res.write('[' + ' '.repeat(8_192))
      return
    }
    if (name === 'cut-body') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'Content-Length': '65536' })
      res.write('["' + marker + ' '.repeat(8_192))
      setTimeout(() => req.socket.destroy(), 150)
      return
    }
    const status = { quota: 429, rate: 429, pay: 402, auth: 401 }[name] ?? 200
    res.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' })
    res.end(JSON.stringify(status === 200 ? { choices: [{ message: { content: 'fixture-ok' } }] } :
      { error: { code: name === 'quota' ? 'insufficient_quota' : 'rate_limit_exceeded',
        message: 'unsupported response_format insufficient_quota ' + privateUrl }, extra: marker }))
  })
  const originUrl = await listen(origin)
  const target = new URL(originUrl)
  // Only this fixture origin is reachable, even if a client sends some other destination.
  const proxy = createServer((req, res) => {
    const dest = URL.canParse(req.url) && new URL(req.url)
    if (!dest || dest.origin !== originUrl) { res.writeHead(403).end(); return }
    proxyHits++
    const upstream = request(originUrl + dest.pathname + dest.search, { method: req.method,
      headers: { 'content-type': 'application/json' }, agent: false }, reply => {
      res.writeHead(reply.statusCode, reply.headers); reply.pipe(res)
    })
    upstream.on('error', () => res.destroy())
    req.pipe(upstream)
  })
  proxy.on('connect', (req, client, head) => {
    if (req.url !== target.host) return client.destroy()
    proxyHits++
    const upstream = connect(Number(target.port), '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      upstream.pipe(client); client.pipe(upstream)
    })
    client.on('error', () => upstream.destroy()).on('close', () => upstream.destroy())
    upstream.on('error', () => client.destroy()).on('close', () => client.destroy())
  })
  const tlsStall = createTcpServer(socket => socket.resume()) // Accept TCP, never answer the TLS ClientHello.
  const servers = [origin, proxy, tlsStall]
  for (const server of servers) server.on('connection', socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket))
  })
  return { originUrl, proxyUrl: await listen(proxy), tlsUrl: await listen(tlsStall, 'https:'), hits, proxyHits: () => proxyHits, async close() {
    for (const socket of sockets) socket.destroy()
    await Promise.all(servers.map(s => new Promise(resolve => s.close(resolve))))
  } }
}

async function fakeCli(dir) {
  const js = join(dir, 'stand-in.cjs')
  await writeFile(js, `
    const { appendFileSync } = require('node:fs')
    const args = process.argv.slice(2)
    appendFileSync(process.env.FIXTURE_EVENTS, args[0] + '\\n')
    if (args[0] === '--version') console.log('codex-cli 9.9.9-fixture\\n' + ${JSON.stringify(privateUrl)})
    else if (args[0] === 'login') console.log('Logged in using ChatGPT\\n' + ${JSON.stringify(marker)})
    else if (args.includes('hang')) setTimeout(() => process.exit(0), 30000)
    else { process.stderr.write(args.includes('auth') ? 'not authenticated' : 'failed at ' + ${JSON.stringify(privateUrl)}); process.exitCode = 23 }
  `)
  const win = process.platform === 'win32'
  const path = join(dir, win ? 'codex.cmd' : 'codex')
  await writeFile(path, win ? `@echo off\r\n"${process.execPath}" "${js}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`)
  if (!win) await chmod(path, 0o755)
  return path
}

function cleanEnv(dir) {
  const env = {}
  for (const key of ['SystemRoot', 'SystemDrive', 'WINDIR', 'ComSpec', 'PATHEXT', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  env.PATH = [dirname(process.execPath), ...(process.platform === 'win32' ? [join(env.SystemRoot, 'System32')] : ['/usr/bin', '/bin'])].join(delimiter)
  for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TMP', 'TEMP', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'CODEX_HOME']) env[key] = dir
  return env
}

async function probe(mode, dir, origin, proxy, electron) {
  const api = await import(pathToFileURL(join(dir, 'client.mjs')).href)
  const logs = []
  const logger = { info: line => logs.push(line), warn: line => logs.push(line) }
  let client = new api.AIHttpClient()
  if (electron) {
    assert.ok(process.versions.electron && process.versions.chrome && process.type === 'browser')
    await electron.app.whenReady()
    const session = electron.session.defaultSession
    session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (req, done) => {
      const url = new URL(req.url)
      done({ cancel: url.origin !== origin && url.hostname !== 'no-record.fixture.invalid' })
    })
    await session.setProxy(mode === 'electron-direct' ? { mode: 'direct' } :
      { mode: 'fixed_servers', proxyRules: proxy, proxyBypassRules: '<-loopback>' })
    client = new api.AIHttpClient({ fetch: (url, init) => electron.net.fetch(url, init), transport: 'electron-net' })
  }
  const service = new api.AIService({ getApiKey: async () => { throw Error('unexpected credential read') } }, {}, { httpClient: client, logger })
  const call = (name, extra = {}) => service.chatCompletion({ messages, settings: {
    ...settings, baseUrl: origin + '/' + mode + '/' + name, ...extra
  } })
  if (mode === 'cli') {
    const path = await fakeCli(dir)
    const status = await service.getCodexCliStatus(path)
    assert.ok(status.available && status.authenticated)
    safe(status)
    assert.match(status.message, /未查询|未知/)
    assert.equal(status.version, 'codex-cli 9.9.9-fixture')
    assert.equal((await readFile(process.env.FIXTURE_EVENTS, 'utf8')).trim(), '--version\nlogin')
    const cli = { apiProvider: 'codex_cli', codexCliPath: path }
    for (const [model, expected] of [['exit', /退出码 23/], ['auth', /身份验证/]]) {
      const failed = await call('never', { ...cli, codexCliModel: model })
      safe(failed); assert.match(failed.error, expected); assert.match(failed.error, /CLI 子进程/)
      assert.doesNotMatch(failed.error, /NODE_USE_ENV_PROXY/)
    }
    const cliService = new api.CodexCliService(logger)
    const missing = await call('never', { ...cli, codexCliPath: join(dir, 'missing', process.platform === 'win32' ? 'codex.exe' : 'codex') })
    safe(missing); assert.match(missing.error, /无法启动.*CLI 子进程/)
    await assert.rejects(cliService.chatCompletion({ command: path, model: 'hang', messages, maxTokens: 16,
      signal: new AbortController().signal, timeoutMs: 400 }), e => api.diagnoseAiConnection(e, { transport: 'codex-cli' }).kind === 'cli_timeout')
    safe(logs)
    return
  }
  assert.equal((await call('ok')).content, 'fixture-ok')
  for (const [name, expected] of [['auth', /HTTP 401.*身份验证/], ['quota', /HTTP 429.*额度不足/],
    ['rate', /HTTP 429.*限流/], ['pay', /HTTP 402.*付款/]]) {
    const failed = await call(name, { retryEnabled: mode === 'node-clean', maxRetries: 1 })
    safe(failed); assert.equal(failed.ok, false); assert.match(failed.error, expected)
    assert.match(failed.error, /额度未知/); assert.doesNotMatch(failed.error, /代理|NODE_USE_ENV_PROXY/)
    assert.match(failed.error, electron ? /桌面 Electron/ : /独立 Node\.js/)
  }
  const dropped = await call('drop')
  safe(dropped)
  const route = { 'node-clean': /未配置.*直连/, 'node-on': /按配置使用代理/,
    'node-off': /未启用.*NODE_USE_ENV_PROXY=1/, 'node-bypass': /NO_PROXY.*绕过代理直连/ }
  if (electron) {
    assert.match(dropped.error, /桌面 Electron.*Chromium net.fetch/)
    assert.doesNotMatch(dropped.error, /NODE_USE_ENV_PROXY|独立 Node/)
  } else {
    assert.match(dropped.error, mode === 'node-clean' || api.supportsNodeFetchEnvProxy(process.versions.node) ? route[mode] : /不支持环境代理/)
    assert.ok(dropped.error.includes(process.versions.node))
  }
  if (mode === 'node-clean' || mode === 'electron-direct') {
    const cut = await call('cut-body')
    safe(cut); assert.match(cut.error, /已收到响应头.*读完响应正文/)
    assert.doesNotMatch(cut.error, /建立连接超时|读取响应超时|代理/)
    for (const [name, kind] of [['slow-body', 'read_timeout'], ['stall', 'total_timeout']]) {
      await assert.rejects(client.post(origin + '/' + mode + '/' + name, {}, {}, { timeoutMs: 1_000 }), e => {
        const actual = api.diagnoseAiConnection(e, { transport: client.transport })?.kind
        assert.equal(actual, kind, name + ': expected ' + kind + ', got ' + actual)
        return true
      })
    }
    const host = 'no-record.fixture.invalid'
    const dns = require('node:dns')
    const lookup = dns.lookup
    let lookups = 0
    // Chromium uses its host resolver rules. Node uses a lookup stand-in, so neither consults public DNS.
    if (!electron) dns.lookup = (name, _options, callback) => {
      assert.equal(name, host)
      lookups++
      process.nextTick(callback, Object.assign(new Error('fixture resolver'), { code: 'ENOTFOUND', syscall: 'getaddrinfo' }))
    }
    try {
      const failed = await call('dns', { baseUrl: origin.replace('127.0.0.1', host) })
      safe(failed); assert.match(failed.error, /DNS 域名解析失败/)
      if (!electron) assert.ok(lookups > 0)
    } finally { if (!electron) dns.lookup = lookup }
  }
  if (mode === 'node-clean') {
    const injected = new api.AIHttpClient({ fetch: async () => { throw new Error('opaque exception ' + marker + 'environment ' + privateUrl) } })
    const mock = new api.AIService({ getApiKey: async () => '' }, {}, { httpClient: injected, logger })
    const failed = await mock.chatCompletion({ messages, settings: { ...settings, baseUrl: origin } })
    safe(failed); assert.match(failed.error, /自定义 fetch/); assert.doesNotMatch(failed.error, /Electron|NODE_USE_ENV_PROXY/)
    const handshake = await call('never', { baseUrl: process.env.FIXTURE_TLS_STALL, requestTimeoutMs: 18_000 })
    safe(handshake); assert.match(handshake.error, /建立连接超时.*UND_ERR_CONNECT_TIMEOUT/)
  }
  safe(logs)
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'novel-connection-diag-'))
  let net
  try {
    await checkWiring()
    await compile(dir)
    const api = await import(pathToFileURL(join(dir, 'client.mjs')).href)
    unit(api)
    console.log('PASS 错误分类、运行时版本边界、模拟原因链和脱敏')
    const nativeProxy = api.supportsNodeFetchEnvProxy(process.versions.node)
    if (!nativeProxy) console.log('此 Node.js 不支持内置 fetch 环境代理；验证开关不生效，不计为已验证代理转发。')
    net = await loopbacks()
    const base = cleanEnv(dir)
    const proxy = net.proxyUrl.replace('://', '://fixture-private-user:fixture-private-pass@')
    const modes = [
      ['node-clean', {}, false], ['node-on', { HTTP_PROXY: proxy, NODE_USE_ENV_PROXY: '1' }, nativeProxy],
      ['node-off', { HTTP_PROXY: proxy, NODE_USE_ENV_PROXY: '0' }, false],
      ['node-bypass', { HTTP_PROXY: proxy, NODE_USE_ENV_PROXY: '1', NO_PROXY: new URL(net.originUrl).host }, false],
      ['electron-direct', { HTTP_PROXY: proxy, NODE_USE_ENV_PROXY: '1' }, false],
      ['electron-proxy', { NODE_USE_ENV_PROXY: '0', NO_PROXY: '*' }, true], ['cli', { FIXTURE_EVENTS: join(dir, 'events') }, false]
    ]
    const desktopEntry = join(dir, 'electron-main.cjs')
    await writeFile(desktopEntry, `const { app } = require('electron')
      app.disableHardwareAcceleration()
      app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1')
      app.whenReady().then(() => import(${JSON.stringify(import.meta.url)})).catch(() => app.exit(1))`)
    for (const [mode, config, proxied] of modes) {
      const electron = mode.startsWith('electron-')
      const profile = join(dir, mode)
      await mkdir(profile)
      const args = [electron ? desktopEntry : script, '--probe', mode, dir]
      if (electron) args.push('--disable-background-networking', '--no-first-run', '--disable-component-update', '--user-data-dir=' + profile)
      const before = net.proxyHits()
      try {
        await run(electron ? require('electron') : process.execPath, args, {
          cwd: dir, env: { ...base, ...config, FIXTURE_ORIGIN: net.originUrl, FIXTURE_PROXY: net.proxyUrl, FIXTURE_TLS_STALL: net.tlsUrl },
          windowsHide: true, timeout: 35_000
        })
      } catch (e) {
        // Never dump subprocess stderr, environment or a whole request on failure.
        const output = [e.stderr, e.stdout].filter(Boolean).join('\n')
        const where = output.split(/\r?\n/).map(s => s.trim())
          .find(s => s && !s.includes(marker) && !s.includes('://') && !/Warning:|trace-warnings/.test(s))
        throw Error(mode + ' 验证失败：' + (e.code ?? 'unknown') + (where ? ' (' + where.slice(0, 160) + ')' : ''))
      }
      assert.equal(net.proxyHits() > before, proxied, mode + ' 代理实际接收次数不符')
      if (mode !== 'cli') {
        for (const key of ['ok', 'quota', 'pay', 'auth']) assert.equal(net.hits.get(mode + '/' + key), 1, mode + '/' + key)
        assert.equal(net.hits.get(mode + '/rate'), mode === 'node-clean' ? 2 : 1)
      } else assert.equal(net.hits.get('cli/never'), undefined)
      console.log(`PASS ${mode}（${electron ? '真实 Electron ' + require('electron/package.json').version + ' net.fetch' :
        mode === 'cli' ? '本地 CLI 替身' : '真实 Node.js ' + process.versions.node + ' fetch'}；代理命中 ${net.proxyHits() - before}）`)
    }
  } finally {
    await net?.close()
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

const probeIndex = process.argv.indexOf('--probe')
const electron = process.versions.electron ? require('electron') : undefined
const validation = probeIndex >= 0 ? probe(process.argv[probeIndex + 1], process.argv[probeIndex + 2],
  process.env.FIXTURE_ORIGIN, process.env.FIXTURE_PROXY, electron) : main()
validation.then(() => electron?.app.exit(0)).catch(error => {
  console.error(error instanceof Error ? error.message : '验证失败')
  process.exitCode = 1
  electron?.app.exit(1)
})

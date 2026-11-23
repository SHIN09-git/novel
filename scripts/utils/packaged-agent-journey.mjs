import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { cleanup, connect, launch, sha256, within } from './long-novel-ui-driver.mjs'
import { button, click, evaluate, waitFor } from './qa-agent-authorization-driver.mjs'
import { repoRoot } from './repo-root.mjs'

const ready = (client, condition) => waitFor(client,
  `!document.querySelector('.loading-screen,.view-loading') && Boolean(${condition})`, 40_000)

export async function mockAgentEndpoint(callback) {
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST')
      assert.equal(req.url, '/v1/chat/completions')
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const result = callback(JSON.parse(Buffer.concat(chunks).toString('utf8')), req)
      res.writeHead(result.status, { 'Content-Type': 'application/json' })
      res.end(await result.text())
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: error.message } }))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, close: () => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  }) }
}

export async function openPackagedAgentJourney({ unpacked, profile, storagePath, registryPath, fixtureEnv, log }) {
  const executable = join(unpacked, 'Novel Director.exe')
  const archive = join(unpacked, 'resources', 'app.asar')
  assert.equal(await realpath(executable), executable)
  assert.equal(await realpath(archive), archive)
  const archiveHash = await sha256(archive)
  const require = createRequire(import.meta.url)
  const asar = require('@electron/asar')
  const manifest = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'))
  if (within(repoRoot, unpacked)) assert.equal(manifest.version, require(join(repoRoot, 'package.json')).version, 'Candidate archive differs from the selected source version')
  for (const name of ['out/main/index.js', 'out/renderer/index.html', 'out/agent/server.mjs'])
    assert(asar.statFile(archive, join(...name.split('/')), false).size > 0, 'Missing packaged entry: ' + name)
  log('candidate', { unpacked, executable, archiveHash, archiveVersion: manifest.version, profile, storagePath })
  const entry = join(unpacked, 'resources', 'app.asar', 'out', 'agent', 'server.mjs')
  const session = await launch({ mode: 'packaged', runtimeRoot: unpacked, executable }, profile)
  let child, pending = null
  const close = async () => {
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.stdin.end()
        const exited = once(child, 'close')
        if (await Promise.race([exited.then(() => true), delay(3000, false, { ref: false })]) === false) {
          child.kill()
          await exited
        }
      }
      if (child) assert.equal(child.exitCode, 0, 'Packaged MCP did not close cleanly')
    } finally {
      const result = await cleanup(session)
      assert.deepEqual(result?.remainingProcessIds ?? [], [], 'Packaged desktop fixture left running processes')
      log('process-cleanup', { mcpExitCode: child?.exitCode, desktopExitCode: session.child.exitCode, remainingDesktopProcessIds: result?.remainingProcessIds })
      assert.equal(session.child.exitCode, 0, 'Packaged desktop did not exit cleanly')
    }
  }
  try {
    await connect(session)
    const { client } = session
    const panel = "document.querySelector('.home-library-authorization')"
    const dialog = "document.querySelector('.confirm-dialog')"
    await ready(client, panel + ' && !' + panel + '.querySelector("button").disabled')
    const runtime = await evaluate(client, 'window.novelDirector.app.getRuntimeInfo()')
    assert.equal(runtime.mode, 'packaged')
    assert.equal(runtime.version, manifest.version)
    assert.equal(await realpath(runtime.execPath), await realpath(executable))
    const renderer = await evaluate(client, 'location.href')
    assert.equal(new URL(renderer).href.toLowerCase(), pathToFileURL(resolve(archive, 'out/renderer/index.html')).href.toLowerCase())
    const liveStorage = await evaluate(client, 'window.novelDirector.app.getStoragePath().then(result => result.storagePath)')
    assert(within(await realpath(profile), await realpath(liveStorage)))
    assert.equal(await realpath(liveStorage), await realpath(storagePath), 'Desktop opened another library')
    log('desktop-opened', { renderer, version: runtime.version, buildTime: runtime.buildTime, liveStorage })

    const localEnv = join(profile, 'mcp-environment')
    await mkdir(localEnv)
    child = spawn(executable, [entry], { cwd: unpacked, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: {
      SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: join(process.env.SystemRoot, 'System32'),
      ELECTRON_RUN_AS_NODE: '1', NODE_USE_ENV_PROXY: '0', HOME: localEnv, USERPROFILE: localEnv, APPDATA: dirname(profile), LOCALAPPDATA: localEnv,
      TEMP: localEnv, TMP: localEnv, CODEX_HOME: localEnv, NOVEL_DIRECTOR_SMOKE_USER_DATA: profile,
      NOVEL_DIRECTOR_API_REGISTRY: registryPath, ...fixtureEnv
    } })
    let requestId = 0, stderr = ''
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-3500) })
    child.on('error', error => pending?.finish(error))
    child.on('exit', code => pending?.finish(new Error(`Packaged MCP exited: ${code}; ${stderr}`)))
    createInterface({ input: child.stdout }).on('line', line => {
      if (!pending) return
      try {
        const message = JSON.parse(line)
        assert.equal(message.id, pending.id)
        if (message.error) throw Object.assign(new Error(message.error.message), { code: message.error.data?.code })
        pending.finish(null, message.result)
      } catch (error) { pending.finish(error) }
    })
    const rpc = (method, params = {}) => new Promise((resolve, reject) => {
      assert.equal(pending, null)
      const id = ++requestId
      const timeout = setTimeout(() => pending?.finish(new Error(`MCP timed out: ${method}; ${stderr}`)), 35_000)
      pending = { id, finish(error, value) {
        clearTimeout(timeout)
        pending = null
        if (error) reject(error)
        else resolve(value)
      } }
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
    const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'packaged-fixture', version: '1' } })
    assert.equal(init.serverInfo.name, 'novel-director-agent-tools')
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    const { tools } = await rpc('tools/list')
    for (const name of ['agent.getLibraryAuthorization', 'agent.startBookRevisionBatch', 'agent.reviewRevisionVersion',
      'agent.applyProjectAction', 'agent.applyChapterAcceptance', 'agent.listBookCreationSlots']) assert(tools.some(tool => tool.name === name), name)
    const call = async (name, args) => {
      const result = await rpc('tools/call', { name: `agent.${name}`, arguments: args })
      assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent)
      return result.structuredContent
    }
    const books = await call('listProjects', {})
    assert.equal(await realpath(books.storage.storagePath), await realpath(storagePath), 'Default MCP library differs from desktop')
    assert.equal(books.data.length, 0, 'Expected a new library created by the packaged desktop')
    async function choose(expression) { await ready(client, expression); await click(client, expression) }
    async function authorize(label, confirmLabel, scope = 'document') {
      await choose(button(label, scope))
      await ready(client, dialog)
      await choose(button(confirmLabel, dialog))
      await ready(client, '!' + dialog)
    }
    const authority = {
      async grantLibrary() {
        const read = 'window.novelDirector.agentAuthorization.getLibraryAuthorization()'
        const existing = await evaluate(client, read)
        if (existing) return existing
        await authorize('授予全库管理权', '授予全库管理权', panel)
        await ready(client, panel + '.querySelector("button").textContent.includes("撤回全库管理权")')
        const grant = await evaluate(client, read)
        assert.equal((await call('getLibraryAuthorization', {})).data.grantId, grant.id)
        return grant
      },
      async grantBookCreativeRights() {
        await authorize('授权 Agent 开书', '授予开书权')
        await ready(client, 'document.body.innerText.includes("待 Agent 开书")')
        return (await evaluate(client, 'window.novelDirector.agentAuthorization.listBookCreationGrants()'))[0]
      },
      async revokeLibrary() {
        await authorize('撤回全库管理权', '撤回授权', panel)
        await ready(client, panel + '.querySelector("button").textContent.includes("授予全库管理权")')
        assert.equal(await evaluate(client, 'window.novelDirector.agentAuthorization.getLibraryAuthorization()'), null)
      },
      async revoke() {
        await authorize('撤回', '撤回授权')
        await ready(client, '!document.body.innerText.includes("待 Agent 开书")')
        assert.equal((await evaluate(client, 'window.novelDirector.agentAuthorization.listBookCreationGrants()'))[0].status, 'revoked')
      }
    }
    async function inspectChapters(projectName, chapters) {
      await client.send('Page.reload', { ignoreCache: true })
      const row = `[...document.querySelectorAll('.project-row')].find(e => e.querySelector('h3')?.innerText === ${JSON.stringify(projectName)})`
      await ready(client, row)
      await choose(button('进入', row))
      await choose(button('章节'))
      for (const { order, title, body, commitId, qualityId, consistencyId } of chapters) {
        const listItem = `[...document.querySelectorAll('.list-pane .list-item')].find(e => e.querySelector('strong')?.innerText === '第 ${order} 章')`
        await choose(listItem)
        await ready(client, `document.querySelector('.chapter-current-title input')?.value === ${JSON.stringify(title)}`)
        assert.equal(await evaluate(client, "document.querySelector('textarea.manuscript-textarea').value"), body)
        if (!await evaluate(client, "Boolean(document.querySelector('.version-history-panel'))"))
          await choose(button('版本历史'))
        await ready(client, "document.querySelector('.version-detail-panel')")
        await choose(button('关联记录', "document.querySelector('.version-detail-panel')"))
        const records = await evaluate(client, `Object.fromEntries([...document.querySelectorAll('.version-links-grid span')].map(e => [e.innerText, e.nextElementSibling.innerText]))`)
        assert.equal(records['草稿采纳提交'], commitId)
        assert.equal(records['质量门禁'], qualityId)
        assert.equal(records['一致性审稿'], consistencyId)
        log('ui-verified', { order, title, bodyLength: body.length, commitId, qualityId, consistencyId })
      }
      await choose(button('返回项目列表'))
      await ready(client, panel)
    }
    return { call, close, authority, inspectChapters, evidence: async () => {
      assert.equal(await sha256(archive), archiveHash, 'Candidate changed during acceptance')
      assert.deepEqual(session.exceptions, [])
      assert.deepEqual(session.networkRequests, [])
      return { version: runtime.version, electron: runtime.electronVersion, asarSha256: archiveHash, sqlite: true, mcpWireRequests: requestId,
        authorGrantFromUi: true, defaultMcpLibraryMatchesDesktop: true, desktopNetworkRequests: 0 }
    } }
  } catch (error) {
    await close()
    throw error
  }
}

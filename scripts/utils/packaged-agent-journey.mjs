import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdir, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { cleanup, connect, launch, within } from './long-novel-ui-driver.mjs'
import { button, click, evaluate, waitFor } from './qa-agent-authorization-driver.mjs'

const ready = (client, condition) => waitFor(client,
  `!document.querySelector('.loading-screen,.view-loading') && Boolean(${condition})`, 40_000)

export async function mockAgentEndpoint(callback) {
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST')
      assert.equal(req.url, '/v1/chat/completions')
      let body = ''
      for await (const chunk of req) body += chunk.toString('utf-8')
      const result = callback(JSON.parse(body))
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

export async function openPackagedAgentJourney({ unpacked, profile, storagePath, registryPath }) {
  const executable = join(unpacked, 'Novel Director.exe')
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
        assert.equal(child.exitCode, 0, 'Packaged MCP did not close cleanly')
      }
    } finally {
      const result = await cleanup(session)
      assert.deepEqual(result?.remainingProcessIds ?? [], [], 'Packaged desktop fixture left running processes')
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
    assert.equal(await realpath(runtime.execPath), await realpath(executable))
    const liveStorage = await evaluate(client, 'window.novelDirector.app.getStoragePath().then(result => result.storagePath)')
    assert(within(await realpath(profile), await realpath(liveStorage)))
    assert.equal(await realpath(liveStorage), await realpath(storagePath), 'Desktop opened another library')

    const localEnv = join(profile, 'mcp-environment')
    await mkdir(localEnv)
    child = spawn(executable, [entry], { cwd: unpacked, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: {
      SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: join(process.env.SystemRoot, 'System32'),
      ELECTRON_RUN_AS_NODE: '1', NODE_USE_ENV_PROXY: '0', HOME: localEnv, USERPROFILE: localEnv, APPDATA: dirname(profile), LOCALAPPDATA: localEnv,
      TEMP: localEnv, TMP: localEnv, CODEX_HOME: localEnv, NOVEL_DIRECTOR_SMOKE_USER_DATA: profile,
      NOVEL_DIRECTOR_API_REGISTRY: registryPath
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
    return { call, close, authority, evidence: () => {
      assert.deepEqual(session.exceptions, [])
      assert.deepEqual(session.networkRequests, [])
      return { version: runtime.version, electron: runtime.electronVersion, sqlite: true, mcpWireRequests: requestId,
        authorGrantFromUi: true, defaultMcpLibraryMatchesDesktop: true, desktopNetworkRequests: 0 }
    } }
  } catch (error) {
    await close()
    throw error
  }
}

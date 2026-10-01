import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

// Same isolated Electron/CDP transport as qa-candidate-decisions-ui.mjs.
// Kept separate because that entry script executes its complete suite on import.
export class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.pending = new Map()
    this.nextId = 1
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connection timed out')), 10000)
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      this.socket.addEventListener('error', (error) => { clearTimeout(timer); reject(error) }, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (!message.id) { this.onEvent?.(message); return }
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result ?? {})
    })
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error('CDP closed'))
      }
      this.pending.clear()
    })
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 15000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() { this.socket.close() }
}

export async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result?.value
}

export async function waitFor(client, expression, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) return
    await delay(60)
  }
  throw new Error(`Renderer condition timed out: ${expression}`)
}

export async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

export async function discover(port, child) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Electron exited before CDP: ${child.exitCode}`)
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
      const renderer = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (renderer) {
        const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json())
        return { renderer, version }
      }
    } catch { /* The local debugging port is not ready yet. */ }
    await delay(60)
  }
  throw new Error('Electron did not expose CDP')
}

export const button = (label, root = 'document') =>
  `[...${root}.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(label)})`

export async function reveal(client, expression) {
  assert(await evaluate(client, `(() => { const e = ${expression}; if (!e) return false;
    e.scrollIntoView({block:'center',inline:'nearest'}); return true })()`), `Missing element: ${expression}`)
  await delay(80)
}

export async function click(client, expression) {
  await reveal(client, expression)
  const point = await evaluate(client, `(() => {
    const e = ${expression}; if (!e || e.disabled) return null;
    const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    const hit = document.elementFromPoint(x,y);
    return {x,y,hit:!!hit && (hit === e || e.contains(hit)), width:r.width, height:r.height};
  })()`)
  assert(point?.hit && point.width > 0 && point.height > 0, `Element is obscured: ${expression}: ${JSON.stringify(point)}`)
  const coordinates = { x: point.x, y: point.y, button: 'left', clickCount: 1 }
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...coordinates })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...coordinates })
  await delay(60)
}

export async function fill(client, expression, text) {
  await click(client, expression)
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await client.send('Input.insertText', { text })
  await waitFor(client, `(${expression}).value === ${JSON.stringify(text)}`)
}

function alive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error.code !== 'ESRCH' }
}

export async function closeElectron(child, client, browser, processIds) {
  try { await browser?.send('Browser.close') } catch { /* Browser.close may close its socket first. */ }
  client?.close()
  browser?.close()
  const owned = [...new Set([child.pid, ...processIds])].filter(Boolean)
  const deadline = Date.now() + 7000
  while (Date.now() < deadline && owned.some(alive)) await delay(100)
  let survivors = owned.filter(alive)
  if (survivors.length) {
    // Terminate only PIDs observed in this QA instance, never by executable name.
    for (const pid of survivors) {
      try { process.kill(pid, 'SIGKILL') } catch { /* Already exited. */ }
    }
    await delay(500)
    survivors = owned.filter(alive)
  }
  assert.deepEqual(survivors, [], `Owned Electron processes remain: ${survivors}`)
  return { ownedProcessIds: owned, remainingProcessIds: survivors }
}

export function launchElectron(executable, args, root, profile) {
  const env = { ...process.env, NOVEL_DIRECTOR_SMOKE_USER_DATA: profile, ELECTRON_ENABLE_LOGGING: '0' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.NOVEL_DIRECTOR_SMOKE_TEST
  const child = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const logs = []
  child.stdout.on('data', (chunk) => logs.push(String(chunk)))
  child.stderr.on('data', (chunk) => logs.push(String(chunk)))
  child.on('error', (error) => logs.push(error.stack))
  return { child, logs }
}

import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { CdpClient, evaluate, freePort, discover, closeElectron, button } from './qa-agent-authorization-driver.mjs'

export { evaluate, button }
const execFileAsync = promisify(execFile)

export function within(parent, child) {
  const path = relative(resolve(parent), resolve(child))
  return Boolean(path) && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
}

export function localPath(root, input) {
  const path = resolve(root, input)
  assert(!/^f:/i.test(path) && !path.startsWith('\\\\'), 'F: and network paths are forbidden')
  return path
}

export async function checkedPath(root, input) {
  const path = localPath(root, input)
  return localPath(root, await realpath(path))
}

export async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export function summarize(values) {
  assert(values.length && values.every(Number.isFinite))
  const sorted = [...values].sort((a, b) => a - b)
  const quantile = (p) => sorted[Math.ceil(sorted.length * p) - 1]
  return { n: values.length, minMs: sorted[0], p50Ms: quantile(0.5), p95Ms: quantile(0.95),
    maxMs: sorted.at(-1), meanMs: values.reduce((a, b) => a + b, 0) / values.length }
}

// No fixed click sleeps in measured spans. Scroll/layout preparation is separate.
export async function prepareClick(client, expression) {
  return evaluate(client, `(async () => {
    const element = ${expression};
    if (!element || element.disabled) throw new Error('Missing or disabled benchmark target');
    element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const box = element.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!box.width || !box.height || !hit || !(hit === element || element.contains(hit)))
      throw new Error('Benchmark target is hidden or obscured');
    return {x,y};
  })()`)
}

export async function nativeClick(client, point) {
  const params = { ...point, button: 'left', clickCount: 1 }
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...params })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...params })
}

export async function click(client, expression) {
  await nativeClick(client, await prepareClick(client, expression))
}

export async function key(client, keyName, code, keyCode, modifiers = 0) {
  const params = { key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers }
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
}

export async function ready(client, expression, timeoutMs = 60000) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    const state = await evaluate(client, `(async () => {
      const failed = document.querySelector('.storage-conflict-notice,.chapter-body-conflict,.chapter-body-save-state.is-error');
      if (failed) return {error:failed.textContent};
      const test = () => Boolean(${expression}) && !document.querySelector('.loading-screen,.view-loading');
      if (!test()) return {ready:false};
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return {ready:test()};
    })()`)
    assert(!state.error, state.error)
    if (state.ready) return
    await delay(20)
  }
  throw new Error(`DOM/data ready timed out (${timeoutMs} ms): ${expression}`)
}

export async function measureClick(client, expression, condition) {
  const point = await prepareClick(client, expression)
  const start = performance.now()
  await nativeClick(client, point)
  await ready(client, condition)
  return performance.now() - start
}

export async function launch(target, profile, canLaunch = () => true) {
  const port = await freePort()
  const envRoot = join(profile, 'benchmark-environment')
  for (const dir of ['home', 'appdata', 'localappdata', 'temp', 'codex']) await mkdir(join(envRoot, dir), { recursive: true })
  const env = {}
  for (const name of ['SystemRoot', 'WINDIR', 'ComSpec', 'SYSTEMDRIVE', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']) {
    if (process.env[name]) env[name] = process.env[name]
  }
  Object.assign(env, {
    NOVEL_DIRECTOR_SMOKE_USER_DATA: profile, ELECTRON_ENABLE_LOGGING: '0',
    HOME: join(envRoot, 'home'), USERPROFILE: join(envRoot, 'home'),
    APPDATA: join(envRoot, 'appdata'), LOCALAPPDATA: join(envRoot, 'localappdata'),
    TEMP: join(envRoot, 'temp'), TMP: join(envRoot, 'temp'), CODEX_HOME: join(envRoot, 'codex'),
    PATH: process.env.SystemRoot ? join(process.env.SystemRoot, 'System32') : ''
  })
  const args = [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--no-first-run', '--disable-background-networking',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    ...(target.mode === 'isolated-out' ? [target.runtimeRoot] : [])]
  assert(canLaunch(), 'Interrupted before Electron launch')
  const startedAt = performance.now()
  const child = spawn(target.executable, args, { cwd: target.runtimeRoot, env, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'] })
  const session = { child, startedAt, port, args, logs: [], processIds: [], exceptions: [], networkRequests: [] }
  child.stdout.on('data', (chunk) => session.logs.push(String(chunk)))
  child.stderr.on('data', (chunk) => session.logs.push(String(chunk)))
  child.on('error', (error) => { session.spawnError = error.message })
  return session
}

export async function connect(session) {
  const endpoints = await discover(session.port, session.child)
  session.client = new CdpClient(endpoints.renderer.webSocketDebuggerUrl)
  session.browser = new CdpClient(endpoints.version.webSocketDebuggerUrl)
  await session.client.open()
  await session.browser.open()
  session.processIds = (await session.browser.send('SystemInfo.getProcessInfo')).processInfo.map((p) => p.id)
  session.version = endpoints.version
  session.client.onEvent = (event) => {
    if (event.method === 'Runtime.exceptionThrown') session.exceptions.push(event.params.exceptionDetails)
    if (event.method === 'Network.requestWillBeSent' && /^(https?|wss?):/.test(event.params.request.url))
      session.networkRequests.push({ url: event.params.request.url, method: event.params.request.method })
  }
  await session.client.send('Network.enable')
  await session.client.send('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] })
  await session.client.send('Runtime.enable')
  await session.client.send('Page.enable')
  await session.client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  session.visibilityBeforeActivation = await evaluate(session.client, 'document.visibilityState')
  await session.client.send('Page.bringToFront')
}

async function closeSession(session) {
  if (!session) return null
  // Also inventory the OS tree, including helpers absent from Chromium's list.
  // Only parent/PID information is read; command lines and profiles are not read.
  if (session.child.pid && session.child.exitCode === null) {
    const script = `$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
      $owned = [System.Collections.Generic.HashSet[int]]::new()
      [void]$owned.Add(${Number(session.child.pid)})
      do { $changed = $false; foreach ($p in $all) {
        if ($owned.Contains([int]$p.ParentProcessId) -and $owned.Add([int]$p.ProcessId)) { $changed = $true }
      } } while ($changed)
      ConvertTo-Json -Compress -InputObject @($owned)`
    try {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true, timeout: 10000 })
      session.processIds = [...new Set([...session.processIds, ...JSON.parse(stdout.trim())])]
    } catch {
      // Fail closed: taskkill owns the whole tree even when OS inventory fails.
      await execFileAsync('taskkill.exe', ['/PID', String(session.child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {})
    }
  }
  const browserOpen = session.browser?.socket.readyState === WebSocket.OPEN
  if (browserOpen) {
    try {
      const info = await session.browser.send('SystemInfo.getProcessInfo')
      session.processIds = [...new Set([...session.processIds, ...info.processInfo.map((p) => p.id)])]
    } catch { /* The process may have failed during startup. */ }
  } else if (session.child.pid && session.child.exitCode === null) {
    // Without a CDP process inventory, terminate the owned Windows process tree.
    await execFileAsync('taskkill.exe', ['/PID', String(session.child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {})
  }
  const result = await closeElectron(session.child, session.client, browserOpen ? session.browser : null, session.processIds)
  session.browser?.close()
  return result
}

export function cleanup(session) {
  if (!session) return Promise.resolve(null)
  session.cleanupPromise ??= closeSession(session)
  return session.cleanupPromise
}

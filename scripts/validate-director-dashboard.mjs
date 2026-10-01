import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { join, extname, resolve } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

// No user store, credentials, provider calls, or native binding is needed.
const compiled = await build({
  stdin: { contents: `export * from './src/services/DirectorNextActionService'; export { normalizeAppData } from './src/shared/defaults'; export { draftContentHash } from './src/services/DraftDiagnosticBindingService'`, resolveDir: repoRoot },
  bundle: true, write: false, platform: 'node', format: 'esm'
})
const { getDirectorDashboard, normalizeAppData, draftContentHash } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
const date = '2026-09-05T08:00:00.000Z'
const project = { id: 'director-demo', name: '雾港来信', genre: '悬疑 · 都市', description: '一封迟到十年的信，让旧港口的灯重新亮起。', createdAt: date, updatedAt: date }
const chapter = (order, patch = {}) => ({ id: `chapter-${order}`, projectId: project.id, order, title: `第 ${order} 章`, body: '旧港的钟停在了十一点。', updatedAt: date, createdAt: date, ...patch })
const job = (id, patch = {}) => ({ id, projectId: project.id, targetChapterOrder: 4, status: 'paused', currentStep: 'await_user_confirmation', createdAt: date, updatedAt: date, ...patch })
const draft = (id, jobId, patch = {}) => ({ id, jobId, projectId: project.id, title: '第四章：灯塔回声', body: '她把信放在灯下，纸上的潮痕开始显出另一行字。', status: 'draft', updatedAt: date, createdAt: date, ...patch })
const fixture = (patch = {}) => normalizeAppData({ projects: [project], ...patch })
const derive = (patch, capabilities) => getDirectorDashboard(fixture(patch), project.id, capabilities)
let checks = 0
function check(name, fn) { fn(); checks += 1; console.log(`PASS ${name}`) }

check('empty project offers one executable create action', () => {
  const result = derive({}); assert.equal(result.actions.length, 1); assert.equal(result.actions[0].kind, 'create_chapter'); assert.equal(result.nextOrder, 1)
})
check('failed generation is resumable', () => assert.equal(derive({ chapterGenerationJobs: [job('failed', { status: 'failed' })] }).actions[0].kind, 'resume_pipeline'))
check('running work wins over newer paused work', () => {
  const result = derive({ chapterGenerationJobs: [job('running', { status: 'running' }), job('paused', { targetChapterOrder: 5, currentStep: 'generate_chapter_plan', updatedAt: '2026-09-06' })] })
  assert.equal(result.actions[0].jobId, 'running')
})
check('completed body waiting for confirmation offers review, not rerun', () => assert.equal(derive({ chapterGenerationJobs: [job('review')], generatedChapterDrafts: [draft('draft', 'review')] }).actions[0].kind, 'review_draft'))
check('pending draft does not compete with a create-same-chapter suggestion', () => assert.ok(!derive({ chapterGenerationJobs: [job('review')], generatedChapterDrafts: [draft('draft', 'review')] }).actions.some((action) => action.kind === 'create_chapter')))
check('accepted or rejected draft is not offered for acceptance again', () => {
  for (const status of ['accepted', 'rejected']) assert.equal(derive({ chapterGenerationJobs: [job('done')], generatedChapterDrafts: [draft('done-draft', 'done', { status })] }).actions[0].kind, 'create_chapter')
})
check('older draft does not revive after its replacement was rejected', () => {
  const result = derive({ chapterGenerationJobs: [job('done')], generatedChapterDrafts: [draft('old', 'done', { updatedAt: '2026-09-04' }), draft('new', 'done', { status: 'rejected' })] })
  assert.equal(result.actions[0].kind, 'create_chapter')
})
check('superseded failed job is not a new todo', () => assert.equal(derive({ chapterGenerationJobs: [job('old', { status: 'failed', createdAt: '2026-09-01' }), job('new', { status: 'completed' })], generatedChapterDrafts: [draft('accepted', 'new', { status: 'accepted' })] }).actions[0].kind, 'create_chapter'))
check('pending memory and state changes share one decision inbox destination', () => {
  const result = derive({ memoryUpdateCandidates: [{ id: 'memory', projectId: project.id, jobId: 'job', status: 'pending' }], characterStateChangeCandidates: [{ id: 'state', projectId: project.id, characterId: 'character', status: 'pending' }] })
  assert.deepEqual(result.actions.map((a) => a.destination).filter(Boolean), ['inbox']); assert.equal(result.pendingCandidateCount, 2)
})
check('no more than one primary plus two secondary, no duplicate destinations', () => {
  const result = derive({ chapters: [chapter(1)], chapterGenerationJobs: [job('failed', { status: 'failed' })], memoryUpdateCandidates: [{ id: 'm', projectId: project.id, status: 'pending' }], characterStateChangeCandidates: [{ id: 's', projectId: project.id, status: 'pending' }] })
  assert.equal(result.actions.length, 3); assert.equal(result.actions.filter((a) => a.destination === 'pipeline').length, 1)
})
check('empty existing chapter is continued before creating another', () => assert.equal(derive({ chapters: [chapter(1, { body: '' })] }).actions[0].kind, 'open_chapter'))
check('most recently edited is distinct from highest chapter order', () => {
  const result = derive({ chapters: [chapter(7, { updatedAt: '2026-09-04' }), chapter(2)] })
  assert.equal(result.recentChapters[0].order, 2); assert.equal(result.nextOrder, 8); assert.equal(result.latestChapterOrder, 7)
})
check('archived chapters do not appear, order remains reserved', () => {
  const result = derive({ chapters: [chapter(9, { archivedAt: date }), chapter(1)], chapterGenerationJobs: [job('archived', { targetChapterOrder: 9, status: 'failed' })] })
  assert.equal(result.chapterCount, 1); assert.equal(result.nextOrder, 10); assert.equal(result.actions[0].kind, 'create_chapter')
})
check('other projects never affect progress or next actions', () => {
  const result = derive({ chapters: [chapter(99, { projectId: 'other' })], chapterGenerationJobs: [job('other', { projectId: 'other', status: 'running' })] })
  assert.equal(result.nextOrder, 1); assert.equal(result.totalWords, 0); assert.equal(result.actions[0].kind, 'create_chapter')
})
check('legacy callers without navigation keep a working create action', () => {
  const result = derive({ chapterGenerationJobs: [job('failed', { status: 'failed' })] }, {})
  assert.equal(result.actions.length, 1); assert.equal(result.actions[0].kind, 'create_chapter')
})
check('derivation is deterministic and does not mutate AppData', () => {
  const data = fixture({ chapters: [chapter(3), chapter(1)] }); const before = JSON.stringify(data)
  assert.deepEqual(getDirectorDashboard(data, project.id), getDirectorDashboard(data, project.id)); assert.equal(JSON.stringify(data), before)
})
const demoDraft = draft('demo-draft', 'demo-job')
check('quality report must match current text and project', () => {
  const result = derive({ chapterGenerationJobs: [job('demo-job')], generatedChapterDrafts: [demoDraft], qualityGateReports: [
    { id: 'stale', projectId: project.id, jobId: 'demo-job', draftId: demoDraft.id, draftContentHash: draftContentHash('deleted text'), createdAt: date },
    { id: 'foreign', projectId: 'other', jobId: 'demo-job', draftId: demoDraft.id, draftContentHash: draftContentHash(demoDraft.body), createdAt: date }
  ] }); assert.equal(result.qualityReport, null)
})

if (process.argv.includes('--ui')) await verifyBrowser()
console.log(JSON.stringify({ ok: true, checks, ui: process.argv.includes('--ui') }))

async function verifyBrowser() {
  const browser = process.env.DIRECTOR_QA_BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync)
  assert.ok(browser, 'Set DIRECTOR_QA_BROWSER to a Chromium executable for --ui')
  const root = join(repoRoot, 'out/renderer')
  assert.ok(existsSync(join(root, 'index.html')), 'Run npm run build before --ui')
  const outputRoot = join(repoRoot, 'tmp', 'director-dashboard')
  await mkdir(outputRoot, { recursive: true })
  const work = await mkdtemp(join(outputRoot, 'qa-'))
  const demo = fixture({
    chapters: [chapter(1, { title: '没有寄信人的信', updatedAt: '2026-09-01' }), chapter(2, { title: '旧港的钟声', updatedAt: '2026-09-03' }), chapter(3, {
      title: '潮水退去之后', body: '林迟推开旧邮局的门。\n\n柜台后的灯还亮着，玻璃上积了薄薄一层盐。她没有立刻去拿那封信，而是先看向墙上的钟。十一点整，和十年前一模一样。\n\n门外有人停下脚步，却迟迟没有进来。', endingHook: '邮戳上的日期，是明天。'
    })], chapterGenerationJobs: [job('demo-job')], generatedChapterDrafts: [demoDraft],
    characterStateChangeCandidates: [{ id: 'demo-state', projectId: project.id, characterId: 'demo-character', status: 'pending' }],
    characters: [{ id: 'demo-character', projectId: project.id, name: '林迟' }],
    characterStateLogs: [{ id: 'demo-log', projectId: project.id, characterId: 'demo-character', note: '得知父亲曾在旧港邮局工作，但还不知道那封信的收件人。', createdAt: date }]
  })
  const server = createServer(async (request, response) => {
    try {
      const path = resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(request.url, 'http://localhost').pathname)}`)
      if (!path.startsWith(`${resolve(root)}\\`) && !path.startsWith(`${resolve(root)}/`)) throw new Error('Invalid asset path')
      const content = await readFile(path)
      response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png' })[extname(path)] ?? 'application/octet-stream')
      response.end(content)
    } catch { response.writeHead(404); response.end() }
  })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${join(work, 'browser')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let socket
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const waitFor = async (fn) => { for (let i = 0; i < 150; i++) { if (await fn()) return; await sleep(100) } throw new Error('Browser assertion timed out') }
  let logs = ''
  child.stderr.on('data', (chunk) => { logs += chunk })
  child.stdout.resume()
  try {
    let port
    await waitFor(async () => { try { port = Number((await readFile(join(work, 'browser/DevToolsActivePort'), 'utf8')).split('\n')[0]); return Boolean(port) } catch { return false } })
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((res) => res.json())
    socket = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
    await new Promise((r, reject) => { socket.addEventListener('open', r, { once: true }); socket.addEventListener('error', reject, { once: true }) })
    let id = 0
    const pending = new Map()
    const errors = []
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data))
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
      const entry = pending.get(message.id)
      if (entry) { clearTimeout(entry.timer); pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result) }
    })
    const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
      const requestId = ++id
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)) }, 10000)
      pending.set(requestId, { resolve: resolvePromise, reject, timer }); socket.send(JSON.stringify({ id: requestId, method, params }))
    })
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return result.result?.value
    }
    await send('Runtime.enable')
    await send('Page.enable')
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__demo = ${JSON.stringify(demo)}; window.__writes = 0; window.__failSave = false;
      window.novelDirector = {
        data: { load: async () => ({ data: window.__demo, storagePath: 'isolated-demo' }), save: async (data) => {
          window.__writes++; await new Promise(r => setTimeout(r, 120));
          if(window.__failSave) throw new Error('QA 模拟保存失败'); window.__demo = data; return { storagePath: 'isolated-demo' };
        } },
        ai: { chatCompletion: async () => { throw new Error('No provider calls in dashboard QA') }, cancelRun: async () => ({ ok: true }) }
      };` })
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` })
    const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
    await waitFor(() => evaluate(`!!document.querySelector('.project-row')`))
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '进入').click()`)
    await waitFor(() => evaluate(`!!document.querySelector('.director-primary-action')`))
    const measurements = []
    for (const [name, width, height, theme] of [['desktop', 1440, 1000, 'light'], ['narrow', 800, 1000, 'light'], ['compact', 390, 844, 'light'], ['dark', 1440, 1000, 'dark']]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await evaluate(`document.documentElement.dataset.theme = '${theme}'`)
      await sleep(120)
      const dimensions = await evaluate(`({ width: window.innerWidth, scroll: document.documentElement.scrollWidth, primaryCount: document.querySelectorAll('.director-primary-action').length, secondaryCount: document.querySelectorAll('.director-secondary-actions button').length })`)
      check(`${name} has no horizontal page overflow and at most three recommendations`, () => { assert.ok(dimensions.scroll <= dimensions.width, JSON.stringify(dimensions)); assert.equal(dimensions.primaryCount, 1); assert.ok(dimensions.secondaryCount <= 2) })
      const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      await writeFile(join(work, `${name}.png`), Buffer.from(screenshot.data, 'base64'))
      measurements.push({ name, ...dimensions })
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 1000, deviceScaleFactor: 1, mobile: false })
    await evaluate(`window.__originalTitle = document.querySelector('.director-heading h1').textContent; document.querySelector('.director-heading h1').textContent = '长项目名与VeryLongUnbrokenProjectTitle'.repeat(10)`)
    await sleep(100)
    check('long Chinese and unbroken Latin project titles wrap in narrow windows', () => {})
    assert.ok(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`))
    await writeFile(join(work, 'long-title.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    await evaluate(`document.querySelector('.director-heading h1').textContent = window.__originalTitle`)
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
    await click('.director-primary-action')
    await waitFor(() => evaluate(`!!document.querySelector('.generation-view')`))
    check('primary review action really opens the pipeline', () => {})
    const back = async () => { await evaluate(`[...document.querySelectorAll('.nav-list button')].find(b => b.textContent.trim() === '工作台').click()`); await waitFor(() => evaluate(`!!document.querySelector('.director-primary-action')`)) }
    await back()
    await click('.director-chapter-list button')
    await waitFor(() => evaluate(`!!document.querySelector('.chapters-view')`))
    check('recent chapter opens its actual editor', () => {})
    assert.ok(await evaluate(`[...document.querySelectorAll('input')].some(input => input.value === '潮水退去之后')`))
    await back()
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__demo.generatedChapterDrafts[0].status = 'accepted'; window.__demo.chapterGenerationJobs[0].status = 'completed';` })
    await send('Page.reload')
    await waitFor(() => evaluate(`!!document.querySelector('.project-row')`))
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '进入').click()`)
    await waitFor(() => evaluate(`!!document.querySelector('.director-primary-action')`))
    await evaluate(`window.__failSave = true`)
    await evaluate(`[...document.querySelectorAll('.director-secondary-actions button')].find(b => b.textContent.includes('创建第')).click()`)
    await waitFor(() => evaluate(`!!document.querySelector('.director-feedback.is-error')`))
    check('failed creation stays on dashboard and surfaces the save error', () => {})
    await evaluate(`window.__failSave = false; window.__writes = 0; [...document.querySelectorAll('.director-secondary-actions button')].find(b => b.textContent.includes('创建第')).click(); [...document.querySelectorAll('.director-secondary-actions button')].find(b => b.textContent.includes('创建第')).click()`)
    await waitFor(() => evaluate(`!!document.querySelector('.chapters-view')`))
    const state = await evaluate(`({ writes: window.__writes, chapters: window.__demo.chapters.length })`)
    check('double click creates one chapter and navigates after save', () => { assert.equal(state.writes, 1); assert.equal(state.chapters, 4) })
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__demo.projects[0].name = '新故事'; for (const key of Object.keys(window.__demo)) if (Array.isArray(window.__demo[key]) && key !== 'projects') window.__demo[key] = [];` })
    await send('Page.reload')
    await waitFor(() => evaluate(`!!document.querySelector('.project-row')`))
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '进入').click()`)
    await waitFor(() => evaluate(`!!document.querySelector('.director-primary-action')`))
    check('empty project renders only one main recommendation', () => {})
    assert.equal(await evaluate(`document.querySelectorAll('.director-action-area button').length`), 1)
    await writeFile(join(work, 'empty.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    check('no uncaught renderer errors', () => assert.deepEqual(errors, []))
    await writeFile(join(work, 'results.json'), JSON.stringify({ date: new Date().toISOString(), mode: 'production renderer, isolated in-memory IPC', measurements, checks }, null, 2))
    console.log(`Screenshots: ${work}`)
    await send('Browser.close').catch(() => {})
  } catch (error) { console.error(logs.slice(-1800)); throw error }
  finally {
    socket?.close()
    if (child.exitCode === null) child.kill()
    await new Promise((r) => server.close(r))
    if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise((r) => child.once('exit', r)), sleep(5000)])
  }
}

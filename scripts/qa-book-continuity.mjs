// Only preview builds into a disposable directory. --packaged uses the existing release as-is.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import { repoRoot as root } from './utils/repo-root.mjs'
import { qaRuntimeTarget, targetIdentity, prepareTarget, writeOfflineQaProfile, connectQaSession, verifyQaOffline, cleanupQaRun } from './utils/long-novel-ui-runtime.mjs'
import { launch, evaluate, click, button, key, ready } from './utils/long-novel-ui-driver.mjs'
import { auditBook, oldBook, continuitySurfaceFixture, firstQuote, laterQuote, oldQuote } from './fixtures/book-continuity-surfaces.mjs'

const Database = createRequire(import.meta.url)('better-sqlite3')
const base = join(root, 'tmp')
await mkdir(base, { recursive: true })
const work = await mkdtemp(join(base, 'continuity-electron-')), profile = join(work, 'profile')
const target = qaRuntimeTarget(root)
let session, db, sink
try {
  if (target.mode === 'isolated-out') {
    const out = join(work, 'built'), { build } = await import('electron-vite')
    target.required = target.required.map(path => join(out, relative(target.out, path)))
    target.out = out
    await build({ root, build: { outDir: out }, logLevel: 'warn' })
  }
  await targetIdentity(root, target)
  await prepareTarget(root, target, work)
  const fixture = continuitySurfaceFixture()
  sink = await writeOfflineQaProfile(profile, fixture)
  session = await launch(target, profile)
  await connectQaSession(target, session, profile)
  const c = session.client, evalUI = js => evaluate(c, js), wait = js => ready(c, js, 12000)
  const el = s => `document.querySelector(${JSON.stringify(s)})`
  const toggle = button('全书核对'), panel = el('.book-continuity-panel'), findings = el('.book-audit-findings')
  const field = selector => el('.book-continuity-panel ' + selector)
  const resultText = field('.book-progress-results') + '?.innerText'
  const input = async (selector, value) => {
    await evalUI(`(() => {const e=${field(selector)}; const prop=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value');
      prop.set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`)
  }
  const focus = expr => evalUI(`(${expr}).focus()`)
  const enter = async expr => {
    await focus(expr)
    const event = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', ...event, text: '\r', unmodifiedText: '\r' })
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event })
  }
  const open = async () => { await enter(toggle); await wait(panel + ' && ' + resultText) }
  const enterBook = async name => {
    const row = `[...document.querySelectorAll('.project-row')].find(e=>e.textContent.includes(${JSON.stringify(name)}))`
    await wait(row); await click(c, button('进入', row)); await wait(toggle)
  }
  const dashboard = async () => {
    await click(c, button('工作台', el('.nav-list'))); await wait(toggle); await open()
  }
  const verifyChapter = async (projectId, order) => {
    const ch = fixture.chapters.find(c => c.projectId === projectId && c.order === order)
    const selected = el('.chapters-view .list-pane .list-item.active')
    await wait(`${selected}?.querySelector('strong').textContent === ${JSON.stringify('第 ' + order + ' 章')} &&
      ${selected}.querySelector('span').textContent === ${JSON.stringify(ch.title)} &&
      ${el('.chapters-view .manuscript-textarea')}?.value === ${JSON.stringify(ch.body)}`)
  }
  const scansSinceLastCheck = async () => (await c.send('Profiler.takePreciseCoverage')).result
    .flatMap(script => script.functions).filter(f => f.functionName === 'createBookContinuityReader')
    .reduce((sum, f) => sum + f.ranges[0].count, 0)
  const currentBookState = () => db.transaction(() => ({
    revision: db.prepare("SELECT value FROM meta WHERE key='revision'").get().value,
    rows: db.prepare('SELECT collection,id,json FROM entities ORDER BY collection,id').all()
  }))()

  await c.send('Profiler.enable')
  await c.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false })
  await enterBook('渡口核对样书')
  db = new Database(join(profile, 'novel-director-data.sqlite'), { readonly: true, fileMustExist: true })
  const before = currentBookState()
  assert.equal(await evalUI('!!' + panel), false)
  assert.equal(await scansSinceLastCheck(), 0, 'A closed audit must not scan')
  await open()
  assert.equal(await scansSinceLastCheck(), 1, 'Opening builds one book reader')
  assert.equal(await evalUI(findings + '.children.length'), 10)
  for (const word of ['冲突', '待核', '未结']) assert((await evalUI(resultText)).includes(word))
  const page1 = await evalUI(findings + '.innerText')
  await enter(field('[aria-label="核对下一页"]')); await wait(field('nav') + '.innerText.includes("第 2 /")')
  assert.notEqual(await evalUI(findings + '.innerText'), page1)
  await enter(field('[aria-label="核对上一页"]')); await wait(findings + '.innerText === ' + JSON.stringify(page1))
  await input('label:nth-of-type(3) select', 'promise')
  await input('label:nth-of-type(4) select', 'open')
  await wait(findings + '?.innerText.includes("归还铜钥匙")')
  assert(!(await evalUI(findings + '.innerText')).includes(firstQuote))
  await input('label:nth-of-type(3) select', 'money')
  await input('label:nth-of-type(4) select', 'conflict')
  await wait(findings + '?.innerText.includes(' + JSON.stringify(firstQuote) + ')')
  assert.equal(await scansSinceLastCheck(), 0, 'Paging and category/status filters must reuse the scan')

  await input('label:nth-of-type(1) input', '6')
  await input('label:nth-of-type(2) input', '5')
  await enter(field('button[type=submit]')); await wait(field('[role=alert]'))
  assert.equal(await evalUI('!!' + findings), false, 'Invalid or unapplied chapter range must not show stale evidence')
  await input('label:nth-of-type(1) input', '5')
  await enter(field('button[type=submit]')); await wait(resultText + '?.includes("筛选结果 1 条")')
  const evidence = field('.book-audit-evidence')
  assert.deepEqual(await evalUI(`[...${evidence}.querySelectorAll('blockquote')].map(e=>e.textContent)`), [firstQuote, laterQuote])
  assert.equal(await evalUI('!!' + field('.book-audit-version[open]')), false)
  assert.doesNotMatch(await evalUI(evidence + '.innerText'), /正文指纹|current-v5|无版本记录/)
  await enter(field('summary[aria-label="第 2 章版本信息"]'))
  await wait(field('.book-audit-version[open]'))
  assert.match(await evalUI(evidence + '.innerText'), /当前正文无版本记录/)
  await key(c, 'Escape', 'Escape', 27)
  await wait(panel + ' && !' + field('.book-audit-version[open]'))
  await enter(field('summary[aria-label="第 5 章版本信息"]'))
  await wait(evidence + '.innerText.includes("current-v5")')
  assert.match(await evalUI(evidence + '.innerText'), /正文指纹/)
  assert.equal(await scansSinceLastCheck(), 1, 'Only applying the new cutoff may rebuild the reader')
  await input('label:nth-of-type(1) input', '2'); await enter(field('button[type=submit]'))
  await wait(resultText + '?.includes("第 2 至 5 章")')
  assert.equal(await scansSinceLastCheck(), 0, 'Changing only the lower bound must reuse the scan')
  assert.equal(await evalUI('!!' + field('.book-audit-version[open]')), false, 'A different range must not inherit expanded version information')
  await input('label:nth-of-type(2) input', '2')
  assert.equal(await evalUI('!!' + findings), false)
  await enter(field('button[type=submit]')); await wait(resultText + '?.includes("筛选结果 0 条")')
  assert.equal(await evalUI('!!' + evidence), false)
  assert.doesNotMatch(await evalUI(panel + '.textContent'), /current-v5|封存附记|11文钱/)
  await input('label:nth-of-type(2) input', '5')
  await enter(field('button[type=submit]')); await wait(evidence + '?.innerText.includes(' + JSON.stringify(laterQuote) + ')')
  await enter(field('summary[aria-label="第 5 章版本信息"]'))
  for (const width of [790, 390, 1280]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    await wait(panel + '.clientWidth > 0')
    assert(await evalUI(`(() => {const p=${panel}, r=p.getBoundingClientRect();return p.scrollWidth<=p.clientWidth+1 &&
      [...p.querySelectorAll('input,select,button,blockquote,summary,details[open] dd')].every(e=>e.getBoundingClientRect().right<=r.right+1)})()`), 'Audit overflows at ' + width)
  }
  await focus(field('input')); await key(c, 'Tab', 'Tab', 9)
  assert.equal(await evalUI('document.activeElement === ' + field('label:nth-of-type(2) input')), true)
  await key(c, 'Escape', 'Escape', 27)
  await wait('!' + panel + ' && document.activeElement === ' + toggle)
  await open()
  for (const order of [2, 5]) {
    await enter(field(`[aria-label="查看第 ${order} 章正式正文"]`))
    await verifyChapter(auditBook, order)
    await dashboard()
  }
  assert.deepEqual(currentBookState(), before, 'Filtering and opening either chapter must not save anything')
  await click(c, button('返回项目列表'))
  await enterBook('无账本旧书')
  const oldState = currentBookState()
  assert.equal(await evalUI('!!' + panel), false)
  await open(); await wait(findings + '?.innerText.includes("27文钱")')
  const oldEvidence = field('[aria-label="查看第 2 章正式正文"]') + ".closest('li')"
  const oldExcerpt = await evalUI(oldEvidence + ".querySelector('blockquote').textContent")
  assert(oldExcerpt && oldQuote.includes(oldExcerpt), 'The legacy quote must come from the current manuscript')
  const oldText = await evalUI(panel + '.innerText')
  assert.match(oldText, /待核/); assert(!oldText.includes('正文指纹'))
  assert(!oldText.includes(laterQuote) && !oldText.includes(firstQuote) && !oldText.includes('current-v5'))
  await enter(field('summary[aria-label="第 2 章版本信息"]')); await wait(oldEvidence + '.innerText.includes("当前正文无版本记录")')
  await enter(field('[aria-label="查看第 2 章正式正文"]'))
  await verifyChapter(oldBook, 2)
  assert.deepEqual(currentBookState(), oldState)
  await verifyQaOffline(session, sink)
} catch (error) {
  if (session?.client) {
    console.error(await evaluate(session.client, "({focused: document.activeElement?.outerHTML.slice(0,400), surface: document.querySelector('.book-progress')?.innerText ?? document.body.innerText.slice(-900)})").catch(() => null))
    for (const e of session.exceptions) console.error(e.exception?.description ?? e.text)
  }
  throw error
} finally {
  db?.close()
  await cleanupQaRun(root, work, session, sink)
}
console.log(`PASS ${target.mode}: lazy scan counts, keyboard, paging, cutoff, two current chapter links, old book, narrow layout, unchanged SQLite and no network requests.`)

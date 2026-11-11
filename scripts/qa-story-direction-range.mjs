// --packaged runs the release executable; the default uses the existing preview output.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { repoRoot as root } from './utils/repo-root.mjs'
import { qaRuntimeTarget, targetIdentity, prepareTarget, connectQaSession, verifyQaOffline, cleanupQaRun } from './utils/long-novel-ui-runtime.mjs'
import { launch, cleanup, evaluate, click, button, ready } from './utils/long-novel-ui-driver.mjs'
import { startProseRejectSink } from './utils/qa-prose-first-fixture.mjs'

const books = [91, 96].map(start => ({ start, id: 'book-' + start, name: '收尾验收 ' + start, goal: '第96章核对回执' + start }))
const data = { projects: books.map(({ id, name }) => ({ id, name })),
  chapters: books.flatMap(({ id: projectId, start }) => Array.from({ length: start - 1 }, (_, i) => ({
    id: projectId + '-' + i, projectId, order: i + 1, title: '样章' + (i + 1), body: '一页虚构记录。', summary: '整理记录。'
  }))),
  settings: { apiProvider: 'openai', apiKey: '', hasApiKey: false, modelName: 'offline-fixture', retryEnabled: false },
  // Import the inconsistent legacy row raw so the desktop itself derives its warning.
  storyDirectionGuides: [{ id: 'legacy-six', projectId: books[0].id, status: 'draft', title: '旧长度',
    startChapterOrder: 91, endChapterOrder: 96, horizonChapters: 5, chapterBeats: [] }] }
const tmp = join(root, 'tmp')
await mkdir(tmp, { recursive: true })
const work = await mkdtemp(join(tmp, 'story-direction-ui-')), profile = join(work, 'profile')
const target = qaRuntimeTarget(root)
let session, c, sink
const nav = 'document.querySelector(".nav-list")', view = 'document.querySelector(".story-direction-view")'
const status = view + '?.querySelector("[role=status]")?.textContent'
const first = '.story-direction-controls input[type=number]:first-of-type'
const last = '.story-direction-controls label:nth-child(2) input[type=number]'
const headings = '[...document.querySelectorAll(".story-direction-editor article h4")].map(e=>e.textContent.trim())'
const read = expr => evaluate(c, expr), wait = expr => ready(c, expr, 15000)
async function press(label, scope) {
  const target = button(label, scope)
  try { await click(c, target) } catch (error) {
    const hit = await read(`(() => {const rect = (${target})?.getBoundingClientRect(); if (!rect) return 'absent';
      const el = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { box: rect.toJSON(), hit: el?.outerHTML.slice(0, 250), dialog: document.querySelector('[role=dialog]')?.innerText }; })()`)
    throw new Error(label + ': ' + JSON.stringify(hit), { cause: error })
  }
}

async function startDesktop() {
  session = await launch(target, profile)
  await connectQaSession(target, session, profile)
  c = session.client
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
}
async function stopDesktop() {
  await verifyQaOffline(session, sink)
  assert.deepEqual((await cleanup(session)).remainingProcessIds, [])
  console.log('CLOSED', JSON.stringify({ pid: session.child.pid, rendererRequests: 0, remainingProcessIds: [] }))
  session = null
}
async function enterBook(book) {
  if (await read('!!' + nav)) await press('返回项目列表')
  const row = '[...document.querySelectorAll(".project-row")].find(e=>e.textContent.includes(' + JSON.stringify(book.name) + '))'
  await wait(row)
  await press('进入', row)
  await wait(nav)
  await wait(nav + '.getBoundingClientRect().left >= 0 && ' + button('剧情导向', nav))
  await press('剧情导向', nav)
  await wait(view)
}
async function change(selector, value) {
  await read(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('Missing fixture control');
    el.focus();
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(String(value))});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true}));
    el.blur();
  })()`)
}
async function stored(book, status) {
  return read(`window.novelDirector.data.load().then(r => r.data.storyDirectionGuides.filter(g =>
    g.projectId === ${JSON.stringify(book.id)} && g.status === ${JSON.stringify(status)} && g.id !== 'legacy-six'))`)
}
function checkGuide(g, book) {
  const expected = Array.from({ length: 97 - book.start }, (_, i) => [i + 1, book.start + i])
  assert.deepEqual([g.startChapterOrder, g.endChapterOrder, g.horizonChapters], [book.start, 96, expected.length])
  assert.deepEqual(g.chapterBeats.map(b => [b.chapterOffset, b.chapterOrder]), expected)
  assert.equal(new Set(g.chapterBeats.map(b => b.id)).size, expected.length)
}
async function checkEditor(book) {
  const expected = Array.from({ length: 97 - book.start }, (_, i) => '第 ' + (book.start + i) + ' 章')
  await wait('(' + headings + ').length === ' + expected.length)
  assert.deepEqual(await read(headings), expected)
}
try {
  await targetIdentity(root, target)
  await prepareTarget(root, target, work)
  sink = await startProseRejectSink()
  data.settings.baseUrl = sink.baseUrl + '/v1'
  await mkdir(profile)
  await writeFile(join(profile, 'novel-director-data.json'), JSON.stringify(data), { flag: 'wx' })
  await startDesktop()
  const saved = new Map()
  for (const book of books) {
    await enterBook(book)
    assert.equal(await read('document.querySelector(' + JSON.stringify(first) + ').valueAsNumber'), book.start)
    if (book.start === 91) {
      await change('.story-direction-controls select', 'legacy-six')
      await wait(view + '.innerText.includes("记录长度为 5 章")')
      assert.match(await read(view + '.innerText'), /91-96 章实际为 6 章/)
    }
    await press('未来 10 章', view)
    await wait('document.querySelector(' + JSON.stringify(last) + ').valueAsNumber === ' + (book.start + 9))
    await change(last, book.start + 30) // Inclusive 31-chapter range exceeds the 30-chapter limit.
    await wait(view + '.querySelector("[role=alert]")')
    assert.match(await read(view + '.querySelector("[role=alert]").textContent'), /最多/)
    assert.equal(await read(button('生成 AI 剧情指导', view) + '.disabled'), true)
    await change(last, 96)
    await press('新建空白导向', view)
    await checkEditor(book)
    await press('保存草稿', view)
    await wait(status + '?.includes("已保存剧情导向草稿")')
    const drafts = await stored(book, 'draft')
    assert.equal(drafts.length, 1)
    checkGuide(drafts[0], book)

    await press('生成 AI 剧情指导', view)
    await wait(status + '?.includes("本地保守剧情指导模板")')
    await checkEditor(book)
    await change('.story-direction-editor article:last-child textarea', book.goal)
    await press('设为当前导向', view)
    await wait(status + '?.includes("已设为当前剧情导向")')
    const active = await stored(book, 'active')
    assert.equal(active.length, 1)
    checkGuide(active[0], book)
    assert.notEqual(drafts[0].id, active[0].id)
    assert.equal(active[0].chapterBeats.at(-1).goal, book.goal)
    saved.set(book.id, active[0])
  }
  await stopDesktop()
  await startDesktop()
  for (const book of books) {
    await enterBook(book)
    await checkEditor(book)
    assert.deepEqual(await stored(book, 'active'), [saved.get(book.id)])
    const drafts = await stored(book, 'draft')
    assert.equal(drafts.length, 1)
    if (book.start === 91) {
      await change('.story-direction-controls select', drafts[0].id)
      await checkEditor(book)
      await change('.story-direction-editor article:last-child textarea', '保留最后一拍')
      await change(first, 96)
      await wait(view + '.innerText.includes("移除 5 个范围外的节拍")')
      assert.equal(await read(button('保存草稿', view) + '.disabled'), true)
      await press('应用章段到草稿', view)
      await checkEditor({ start: 96 })
      checkGuide((await stored(book, 'draft'))[0], book)
      await press('保存草稿', view)
      await wait(status + '?.includes("已保存剧情导向草稿")')
      const [trimmed] = await stored(book, 'draft')
      checkGuide(trimmed, { start: 96 })
      assert.equal(trimmed.id, drafts[0].id)
      assert.equal(trimmed.chapterBeats[0].id, drafts[0].chapterBeats[5].id)
      assert.equal(trimmed.chapterBeats[0].goal, '保留最后一拍')
      assert.deepEqual(await stored(book, 'active'), [saved.get(book.id)])
    }
    await press('Prompt 构建器', nav)
    const control = '.prompt-controls input[type=number]', editor = 'document.querySelector("textarea.prompt-editor")'
    for (const order of [96, 97]) {
      await wait('document.querySelector(' + JSON.stringify(control) + ')')
      await change(control, order)
      await press('构建 Prompt')
      await wait(editor + '?.value.includes("第 ' + order + ' 章写作 Prompt")')
      assert.equal((await read(editor + '.value')).includes(book.goal), order === 96)
    }
    console.log(`PASS desktop ${book.start}-96: create, save, local generation, activate, SQLite restart and Prompt boundary.`)
  }
  await stopDesktop()
} finally {
  await cleanupQaRun(root, work, session, sink)
}

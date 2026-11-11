// Actual renderer, isolated browser profile, synthetic books and an in-memory desktop bridge.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const require = createRequire(import.meta.url)
const at = '2026-11-01T00:00:00.000Z'
const later = '2026-11-02T00:00:00.000Z'

function fixture(normalize) {
  const projectId = 'progress-fixture'
  const chapter = (order, title, body, patch) => ({ id: 'c' + order, projectId, order, title, body, createdAt: at, updatedAt: at, ...patch })
  const job = (order) => ({ id: 'j' + order, projectId, targetChapterOrder: order, status: 'paused',
    currentStep: 'await_user_confirmation', updatedAt: at, createdAt: at })
  const draft = (order) => ({ id: 'd' + order, projectId, jobId: 'j' + order, chapterId: null, title: '第' + order + '章的候选',
    body: '保留的第' + order + '章草稿。', status: 'draft', tokenEstimate: 13, createdAt: at, updatedAt: at })
  const failure = (order, kind, refs) => ({ id: 'f' + order, projectId, chapterOrder: order, chapterId: 'c' + order,
    kind, attemptedAt: later, commitId: 'failed-commit-' + order, versionId: 'failed-version-' + order, reason: '合成写回错误。', ...refs })
  const first = chapter(1, '第一份收据', '甲 \n𠀀。', { updatedAt: later })
  const version = { id: 'accepted-v1', projectId, chapterId: first.id, title: first.title, body: first.body,
    source: 'accept_draft', createdAt: at, note: '', linkedChapterCommitId: 'accepted' }
  const candidate = (id, body, date) => ({ id, sessionId: 'session-5', requestId: 'request-5', title: '修订五',
    body, changedSummary: body, risks: '', preservedFacts: '', status: 'pending', createdAt: date, updatedAt: date })
  return normalize({
    projects: [{ id: projectId, name: '合成进度样书', createdAt: at, updatedAt: at },
      { id: 'foreign', name: '另一部样书', bookWordTarget: { min: 999 }, createdAt: at, updatedAt: at }],
    chapters: [first, chapter(2, '空页', ' \n'), chapter(5, '旧章留存', '旧 稿。'), chapter(6, '归档页', '不入账。', { archivedAt: at }),
      chapter(7, '无回执章', '旧。'), chapter(28, '末页', '末。'), chapter(31, '别书', '不入账。', { projectId: 'foreign' })],
    chapterGenerationJobs: [job(4), job(8), job(9)], generatedChapterDrafts: [draft(4), draft(8), draft(9),
      { ...draft(9), id: 'new-d9', body: '同一任务的另一稿。', updatedAt: later }],
    chapterVersions: [version],
    chapterCommitBundles: [{ id: 'accepted', commitId: 'accepted', projectId, chapterId: first.id,
      acceptedAt: at, chapter: first, chapterVersion: version }],
    chapterWritebackFailures: [failure(5, 'revision_commit', { revisionSessionId: 'session-5', revisionVersionId: 'tried' }),
      failure(8, 'chapter_commit', { jobId: 'j8', draftId: 'd8' }),
      failure(9, 'chapter_commit', { jobId: 'j9', draftId: 'd9' }),
      failure(10, 'chapter_commit', { jobId: 'j10', draftId: 'gone' })],
    revisionSessions: [{ id: 'session-5', projectId, chapterId: 'c5', sourceDraftId: null, status: 'active', createdAt: at, updatedAt: at }],
    revisionRequests: [{ id: 'request-5', sessionId: 'session-5', type: 'custom', targetRange: '', instruction: '校对旧章', createdAt: at }],
    revisionVersions: [candidate('tried', '这是写回失败的修订。', at), candidate('newer', '这是另一份候选。', later)]
  })
}

async function verifyStores(api, work) {
  for (const input of [null, {}, [], '120', { min: 4, max: 1 }, { min: -1 }, { max: 0 },
    { min: '9' }, { min: 1.5 }, { max: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal(api.normalizeBookWordTarget(input), undefined)
    assert.equal(Object.hasOwn(api.normalizeAppData({ projects: [{ id: 'old', bookWordTarget: input }] }).projects[0], 'bookWordTarget'), false)
  }
  assert.deepEqual(api.normalizeBookWordTarget({ min: null, max: 12 }), { max: 12 })
  for (const [name, Store] of [['json', api.JsonStorageService], ['sqlite', api.SqliteStorageService]]) {
    const path = join(work, 'targets.' + name)
    const projects = [undefined, { min: 3 }, { max: 4 }, { min: 15, max: 20 }].map((goal, i) => ({
      id: 'p' + i, name: '样书' + i, createdAt: at, updatedAt: at, ...(goal && { bookWordTarget: goal })
    }))
    const seed = api.normalizeAppData({ projects })
    const store = new Store(path)
    try { await store.save(seed) } finally { store.close?.() }
    const reopened = new Store(path)
    try {
      const byId = (await reopened.load()).projects
      for (const p of seed.projects) assert.deepEqual(byId.find(v => v.id === p.id), p)
      assert.ok(!Object.hasOwn(byId.find(v => v.id === 'p0'), 'bookWordTarget'))
    } finally { reopened.close?.() }
    console.log('PASS ' + name + ' target round trip, including legacy absence and one-sided goals')
  }
}

function installBridge(seed) {
  window.progressQA = { data: seed, writes: 0, fail: false, readers: 0, aiCalls: 0 }
  const qa = window.progressQA
  window.novelDirector = {
    data: { load: async () => ({ data: qa.data, storagePath: 'synthetic-progress' }),
      save: async (data) => {
        qa.writes++
        if (qa.fail) throw new Error('合成保存失败')
        qa.data = structuredClone(data)
        return { storagePath: 'synthetic-progress' }
      } },
    ai: { chatCompletion: () => { qa.aiCalls++; throw new Error('本测试禁止调用模型。') } }
  }
}

async function verifyUI() {
  const qa = window.progressQA
  const $ = (selector, root = document) => root.querySelector(selector)
  const all = (s, root = document) => [...root.querySelectorAll(s)]
  const btn = (name, root = document) => all('button', root).find(el => (el.getAttribute('aria-label') || el.textContent.trim()) === name)
  const check = (condition, message) => { if (!condition) throw new Error(message) }
  async function until(fn, message) {
    for (let i = 0; i < 150; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 25)) }
    throw new Error(message)
  }
  async function click(name, root) {
    const el = btn(name, root)
    check(el && !el.disabled, '不能操作按钮：' + name); el.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  const input = async (label, value) => {
    const el = all('label').find(l => l.textContent.trim() === label)?.querySelector('input')
    check(el, '找不到输入框：' + label)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  const goal = () => $('.book-progress-goal').textContent
  const target = () => qa.data.projects.find(p => p.id === 'progress-fixture')
  const row = n => all('.book-progress-table tbody tr').find(tr => $('th span', tr).textContent === '第 ' + n + ' 章')
  async function openList() { await click('全书进度与缺章'); await until(() => row(1), '未显示章节清单') }
  async function back() { await click('工作台', $('.nav-list')); await until(() => $('.book-progress'), '未回到工作台'); await openList() }

  await until(() => $('.project-row'), '未加载隔离项目')
  await click('进入', all('.project-row').find(el => el.textContent.includes('合成进度样书')))
  await until(() => $('.book-progress'), '未加载进度入口')
  check(!$('.book-progress-list') && qa.readers === 0, '初始不应构建全书清单')
  check(goal().includes('未设置全书目标') && !goal().includes('差'), '未设目标不能显示不足')
  check($('.director-stats dd').textContent === '10字' && $('.director-chapter-list button').textContent.includes('3 字'), '首页累计或最近章节字数有误')
  const initialWrites = qa.writes
  await click('编辑全书目标'); await input('目标下限（字）', '20'); await input('目标上限（字）', '12'); await click('保存目标')
  await until(() => $('.book-target-editor [role=alert]'), '倒置范围未报错')
  check(qa.writes === initialWrites, '无效目标不应写库')
  await input('目标上限（字）', ''); qa.fail = true; await click('保存目标')
  await until(() => $('.book-target-editor [role=alert]')?.textContent.includes('合成保存失败'), '未保留失败后的编辑表单')
  check(goal().includes('未设置') && !Object.hasOwn(target(), 'bookWordTarget'), '保存失败时不能改显示或数据')
  qa.fail = false; await click('保存目标')
  await until(() => goal().includes('距下限还差 10 字'), '下限距离不对')
  check(target().bookWordTarget.min === 20 && !Object.hasOwn(target().bookWordTarget, 'max'), '只设下限被改变')
  await click('编辑全书目标'); await input('目标下限（字）', '6'); await input('目标上限（字）', '18'); await click('保存目标')
  await until(() => goal().includes('已达下限') && goal().includes('6 至 18'), '区间内进度不对')
  await click('编辑全书目标'); await input('目标下限（字）', ''); await input('目标上限（字）', '8'); await click('保存目标')
  await until(() => goal().includes('超出上限 2 字'), '单设上限时的超额不对')
  check(qa.readers === 0, '仅编辑目标不应构建章节清单')

  const beforeList = qa.writes
  await openList()
  check(qa.readers === 1 && all('.book-progress-table tbody tr').length === 25, '清单首屏未分页')
  check($('.book-progress-summary').textContent.includes('从第 1 章连续写至第 1 章') &&
    $('.book-progress-summary').textContent.includes('可分配的新章号第 29 章'), '章号分配误作完整进度')
  for (const [n, status] of [[1,'已正式写回'], [2,'空章'], [3,'缺章'], [4,'仅有草稿'], [5,'写回失败'], [6,'已归档'], [7,'历史正文'], [8,'写回失败']]) {
    check($('.status-badge', row(n))?.textContent === status, '第 ' + n + ' 章状态有误')
  }
  check(row(5).textContent.includes('书中保留：历史正文') && $('.book-progress-count', row(5)).textContent === '3', '旧正文与失败修订未区分')
  $('summary', row(5)).click()
  const details = $('details', row(5))
  check(details.open && details.innerText.includes('未发现本次提交回执或目标版本') && !details.innerText.includes('合成写回错误'),
    '应显示安全的写回原因，不显示原始错误')
  await click('下一页'); await until(() => row(28), '没有翻到末页'); check(!row(1), '分页重复')
  await click('上一页'); await until(() => row(1), '没有回到首页')
  await input('起始章', '7'); await input('结束章', '4'); await click('查看范围')
  await until(() => $('.book-progress-filters [role=alert]'), '无效章段未报错')
  await input('起始章', '4'); await input('结束章', '7'); await click('查看范围')
  await until(() => all('.book-progress-table tbody tr').length === 4, '章段未生效')
  $('.book-progress-check input').click()
  await until(() => all('.book-progress-table tbody tr').length === 2 && row(4) && row(5), '仅看问题分类不对')
  check($('.book-progress-results').textContent.includes('范围正文 5 字') && goal().includes('超出上限 2 字'), '筛选改变全书目标或范围字数')
  await click('重置筛选'); await until(() => row(1), '未恢复全书')
  check(qa.readers === 1 && qa.writes === beforeList, '翻页或筛选不应重建全书清单或写库')

  await click('查看正文', row(5))
  await until(() => {
    const title = $('.chapter-editor-main input[aria-label="章节标题"]')
    return title?.readOnly && title.value === '旧章留存' && $('.chapter-editor-main .manuscript-textarea')?.value === '旧 稿。'
  }, '未定位到第 5 章的只读正式标题与当前正文')
  await back(); await click('回到草稿', row(8))
  await until(() => $('.pipeline-draft-body')?.value === '保留的第8章草稿。', '未定位到失败草稿，而是打开了其他任务')
  await back(); await click('回到草稿', row(9))
  await until(() => $('.revision-textarea.original')?.value === '保留的第9章草稿。', '同任务的更新稿遮住了指定草稿')
  await back(); await click('回到草稿', row(10))
  await until(() => row(10) && $('[role=alert]', row(10))?.textContent.includes('找不到'), '缺失稿件不应打开无关任务')
  await click('回到修订稿', row(5))
  await until(() => $('.revision-version-meta')?.textContent.includes('这是写回失败的修订。'), '没有选中失败修订版本')
  check(!$('.revision-version-meta').textContent.includes('这是另一份候选。'), '恢复定位到了较新的无关候选')
  await back(); check(qa.writes === beforeList && qa.aiCalls === 0, '打开稿件不应提交或调用模型')
  await click('编辑全书目标'); await click('清空目标'); await click('取消')
  check(goal().includes('超出上限 2 字') && qa.writes === beforeList, '取消编辑不应清除目标')
  await click('编辑全书目标'); await click('清空目标'); await click('保存目标')
  await until(() => !Object.hasOwn(target(), 'bookWordTarget') && goal().includes('未设置'), '清空时没有移除项目字段')
  check(qa.data.projects.find(p => p.id === 'foreign').bookWordTarget.min === 999, '修改了另一部书')
  return 'PASS renderer: goal editing, failure handling, pagination, filters, chapter / draft / revision links'
}

function checkLayout() {
  const section = document.querySelector('.book-progress')
  const bounds = section.getBoundingClientRect()
  return section.scrollWidth <= section.clientWidth + 1 && bounds.left >= 0 && bounds.right <= innerWidth + 1 &&
    [...section.querySelectorAll('button, input, table')].every(el => el.getBoundingClientRect().right <= bounds.right + 1)
}

const tmp = join(repoRoot, 'tmp')
await mkdir(tmp, { recursive: true })
const work = await mkdtemp(join(tmp, 'book-progress-ui-'))
try {
  await build({ stdin: { resolveDir: repoRoot, contents: [
    "export { normalizeAppData } from './src/shared/defaults'",
    "export { normalizeBookWordTarget } from './src/shared/normalizers/bookWordTarget'",
    "export { JsonStorageService } from './src/storage/JsonStorageService'",
    "export { SqliteStorageService } from './src/storage/SqliteStorageService'"
  ].join('\n') }, bundle: true, platform: 'node', format: 'esm', external: ['better-sqlite3', 'electron'], outfile: join(work, 'domain.mjs') })
  const api = await import(pathToFileURL(join(work, 'domain.mjs')).href)
  await verifyStores(api, work)
  await build({ entryPoints: [join(repoRoot, 'src/renderer/src/main.tsx')], outfile: join(work, 'ui.js'), bundle: true,
    format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'count-real-readers', setup(builder) {
      builder.onResolve({ filter: /BookProgressService$/ }, args => args.importer.endsWith('BookProgressList.tsx')
        ? { path: 'instrumented', namespace: 'book-reader' } : undefined)
      builder.onLoad({ filter: /.*/, namespace: 'book-reader' }, () => ({ resolveDir: repoRoot, contents:
        "import {createBookProgressReader as real} from './src/services/BookProgressService'; export const createBookProgressReader = (...args) => { window.progressQA.readers++; return real(...args) }" }))
    } }] })
  await writeFile(join(work, 'fixture.js'), '(' + installBridge.toString() + ')(' + JSON.stringify(fixture(api.normalizeAppData)) + ')')
  await writeFile(join(work, 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \u0027self\u0027; img-src \u0027self\u0027 data:; connect-src \u0027none\u0027"><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="fixture.js"></script><script src="ui.js"></script>')
  await writeFile(join(work, 'verify.cjs'), [
    "const { app, BrowserWindow, session } = require('electron'); app.disableHardwareAcceleration();",
    "app.whenReady().then(async () => { session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']}, (_, done) => done({cancel:true}));",
    "const w = new BrowserWindow({show:false, width:1100, height:850, webPreferences:{sandbox:true, backgroundThrottling:false}});",
    "await w.loadFile(require('node:path').join(__dirname,'index.html'));",
    'console.log(await w.webContents.executeJavaScript(' + JSON.stringify('(' + verifyUI.toString() + ')()') + '));',
    "for (const width of [1100, 790, 390]) { w.setContentSize(width, 850); await new Promise(r => setTimeout(r, 100));",
    'if (!await w.webContents.executeJavaScript(' + JSON.stringify('(' + checkLayout.toString() + ')()') + ")) throw new Error('清单横向溢出：' + width) }",
    "console.log('PASS renderer layout: 1100, 790, 390 px');",
    "app.exit(0); }).catch(error => {console.error(error); app.exit(1)})"
  ].join('\n'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const { stdout } = await promisify(execFile)(require('electron'), [join(work, 'verify.cjs'),
    '--user-data-dir=' + join(work, 'browser'), '--disable-background-networking'], { env, windowsHide: true, timeout: 55000 })
  assert.match(stdout, /PASS renderer/)
  console.log(stdout.trim())
} finally { await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }

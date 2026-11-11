// Real desktop, preload, SQLite and receipt journal; the only configured endpoint is a loopback tripwire.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { repoRoot as root } from './utils/repo-root.mjs'
import { qaRuntimeTarget, prepareTarget, targetIdentity, verifyRuntimeIdentity } from './utils/long-novel-ui-runtime.mjs'
import { launch, connect, cleanup, evaluate, click, button, ready } from './utils/long-novel-ui-driver.mjs'

const tmp = join(root, 'tmp')
await mkdir(tmp, { recursive: true })
const work = await mkdtemp(join(tmp, 'project-usage-ui-')), profile = join(work, 'profile')
const target = qaRuntimeTarget(root)
let calls = 0, session
const tripwire = createServer((_req, res) => { calls++; res.writeHead(410); res.end() })
// Synthetic historical receipts only. Current physical dispatches are tested in qa-p2-packaged-main.
const ledger = join(profile, 'novel-director-data.sqlite.usage')
const journalFor = id => join(ledger, createHash('sha256').update(id).digest('hex') + '.jsonl')
async function seedReceipts(rows) {
  await mkdir(ledger, { recursive: true })
  for (const row of rows) await appendFile(journalFor(row.projectId), JSON.stringify(row) + '\n')
}
function checkQuote(text, currency, inputPrice, outputPrice, maxTokens) {
  const numbers = text.replaceAll(',', '')
  const inputs = numbers.match(/预计输入：(\d+) 至 (\d+) token/)
  const amount = numbers.match(/按本书当前价目：([A-Z]{3}) ([\d.]+) 至 ([\d.]+)/)
  assert(inputs && amount && numbers.includes(`预计输出：0 至 ${maxTokens} token`))
  assert.equal(amount[1], currency)
  const expected = [Number(inputs[1]) * inputPrice / 1e6, (Number(inputs[2]) * inputPrice + maxTokens * outputPrice) / 1e6]
  const display = new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 7, useGrouping: false })
  assert.deepEqual(amount.slice(2), expected.map(n => display.format(n)))
}
try {
  await new Promise((done, fail) => tripwire.once('error', fail).listen(0, '127.0.0.1', done))
  const endpoint = 'http://127.0.0.1:' + tripwire.address().port, provider = 'local'
  const at = '2026-10-01T00:00:00.000Z', A = 'pricing-qa-a', B = 'pricing-qa-b'
  const modelA = 'fixture-a', modelB = 'fixture-b', legacyJob = 'pricing-qa-legacy'
  const rates = [{ provider, endpoint, model: modelA, currency: 'CNY', inputPerMillionTokens: 1, outputPerMillionTokens: 2 },
    { provider, endpoint, model: modelB, currency: 'USD', inputPerMillionTokens: 4, outputPerMillionTokens: 0 }]
  const data = {
    settings: { apiProvider: provider, baseUrl: endpoint + '/v1', modelName: modelA, hasApiKey: false, retryEnabled: false,
      pipelineModelRoles: { planner: { modelName: modelB, maxTokens: 321 }, revision: { modelName: modelA, maxTokens: 654 } } },
    projects: [{ id: A, name: '价格甲样书', modelRates: rates }, { id: B, name: '价格乙样书' }],
    chapters: [{ projectId: A, id: 'pricing-qa-chapter', order: 1, title: '测试章节', body: '用于核对修订输入的临时文本。'.repeat(30) }],
    chapterGenerationJobs: [{ id: legacyJob, projectId: A, targetChapterOrder: 1, status: 'completed',
      currentStep: 'await_user_confirmation', createdAt: at, updatedAt: at }],
    generationRunTraces: [{ id: 'pricing-qa-trace', projectId: A, jobId: legacyJob, aiCalls: [{
      callId: 'old-call', role: 'reviewer', stepType: 'quality_gate', model: modelA, provider, attempts: 3,
      usage: { promptTokens: 4, completionTokens: 5 }, outcome: 'success', createdAt: at }] }]
  }
  if (target.mode !== 'packaged') {
    const out = join(work, 'built')
    target.required = target.required.map(p => join(out, relative(target.out, p)))
    target.out = out
    await (await import('electron-vite')).build({ root, build: { outDir: out }, logLevel: 'warn' })
  }
  await targetIdentity(root, target)
  await prepareTarget(root, target, work)
  await mkdir(profile)
  await writeFile(join(profile, 'novel-director-data.json'), JSON.stringify(data), { flag: 'wx' })
  session = await launch(target, profile)
  await connect(session)
  const c = session.client, ui = s => evaluate(c, s), wait = s => ready(c, s, 14000)
  const el = s => `document.querySelector(${JSON.stringify(s)})`
  const press = expr => click(c, expr)
  const table = el('.usage-table'), panel = el('.project-usage'), nav = label => button(label, el('.nav-list'))
  const toggle = button('全书模型用量', panel), dialog = el('.confirm-dialog:not([inert])')
  const openTable = async () => { await press(toggle); await wait(table) }
  const enter = async name => {
    const row = `[...document.querySelectorAll('.project-row')].find(e=>e.textContent.includes(${JSON.stringify(name)}))`
    await wait(row); await press(button('进入', row)); await wait(panel)
  }
  const snapshot = () => ui('window.novelDirector.data.load().then(s=>({revision:s.revision,jobs:s.data.chapterGenerationJobs.length,versions:s.data.revisionVersions.length}))')
  const row = label => `[...${table}.tBodies[0].rows].find(r=>r.cells[0].textContent===${JSON.stringify(label)})`
  const totals = row('全书')
  const totalText = () => ui(totals + '.innerText')
  const currency = (name, val) => `[...${row('全书')}.querySelectorAll(".usage-currency strong")].some(x=>x.textContent===${JSON.stringify(name + ' ' + val)})`
  const waitCurrency = async (name, val) => wait(`${table} && ${currency(name, val)}`)
  const fill = async (expr, v) => ui(`(()=>{const e=${expr}; Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(v)});
    e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`)

  await wait(el('.project-row'))
  const rendererUrl = await ui('location.href')
  verifyRuntimeIdentity(target, await ui('window.novelDirector.app.getRuntimeInfo()'), rendererUrl)
  const path = await ui('window.novelDirector.app.getStoragePath().then(r=>r.storagePath)')
  assert.equal(await realpath(path), await realpath(join(profile, 'novel-director-data.sqlite')))
  console.log('DESKTOP', JSON.stringify({ ...target.observedRuntime, rendererUrl, storagePath: path, pid: session.child.pid,
    port: session.port, tripwire: endpoint }))
  await enter('价格甲样书')
  const receipt = (id, phase, model, usage, patch = {}) => ({ id, callId: id, projectId: A, provider, endpoint,
    model, phase, usage, outcome: 'success', startedAt: at, ...patch })
  await seedReceipts([
    receipt('a1', 'writing', modelA, { promptTokens: 1_000_000, completionTokens: 1_000_000 }),
    receipt('a2', 'planning', modelB, { promptTokens: 1_000_000, completionTokens: 0 }),
    receipt('a3', 'review', modelA, undefined, { outcome: 'failed' }),
    receipt('a4', 'extraction', modelA, { totalTokens: 3 }),
    receipt('a5', 'revision', 'fixture-cli', { totalTokens: 2 }, { provider: 'codex_cli', endpoint: '' }),
    receipt('b1', 'other', modelA, undefined, { projectId: B })
  ])
  const beforeRead = await snapshot()
  await openTable()
  await waitCurrency('CNY', 3); await waitCurrency('USD', 4)
  assert.match(await ui(row('全书') + '.cells[1].textContent'), /^5 次失败 1$/)
  assert.match(await ui(row('审稿') + '.cells[4].textContent'), /未知 1/)
  assert.match(await ui(row('提取') + '.cells[2].textContent'), /输入 未知.*输出 未知/)
  assert.match(await ui(row('修订') + '.cells[5].textContent'), /订阅 1/)
  assert.match(await ui(panel + '.innerText'), /旧重试中有 2 次未报告实耗/)
  await press(el('.usage-coverage summary'))
  assert.match(await ui(panel + '.innerText'), /旧逻辑调用 1 次，不计入实际请求数/)
  assert.deepEqual(await snapshot(), beforeRead)
  await press(button('编辑价目', panel))
  const editor = el('.usage-rate-editor'), firstInput = el('.usage-rate-editor input[type=number]')
  await fill(firstInput, '6')
  await press(button('保存价目', editor))
  await waitCurrency('CNY', 8); await waitCurrency('USD', 4)
  assert.equal(await ui('window.novelDirector.data.load().then(r=>r.data.projects.find(p=>p.id==="pricing-qa-a").modelRates[0].inputPerMillionTokens)'), 6)
  // Add a genuinely new author rate; the URL suffix is not part of the saved price.
  await press(button('编辑价目', panel)); await press(button('添加价目', editor))
  const field = selector => el('.usage-rate-editor fieldset:last-of-type ' + selector)
  await fill(field('select'), 'local'); await fill(field('input[type=url]'), endpoint + '/v1?token=discarded')
  await fill(field('input[maxlength="128"]'), 'fixture-c'); await fill(field('input[maxlength="3"]'), 'eur')
  await fill(field('label:nth-child(5) input'), '0'); await fill(field('label:nth-child(6) input'), '1')
  await press(button('保存价目', editor))
  await wait(panel + '?.innerText.includes("本书价目 3 条") && !' + editor)
  const persisted = await ui('window.novelDirector.data.load().then(r=>r.data.projects.find(p=>p.id==="pricing-qa-a").modelRates)')
  assert.equal(persisted[2].endpoint, endpoint); assert.equal(persisted[2].currency, 'EUR')

  await press(toggle); await wait('!' + table)
  await seedReceipts([receipt('a6', 'other', 'fixture-c', { promptTokens: 0, completionTokens: 1_000_000 })])
  await openTable()
  await waitCurrency('EUR', 1)
  assert.match(await totalText(), /6 次/)
  const beforeCancel = await snapshot(), journal = journalFor(A), receipts = await readFile(journal, 'utf8')
  await press(nav('生产流水线')); await wait(el('.pipeline-config-tools summary'))
  await press(el('.pipeline-config-tools summary')); await press(el('.pipeline-config-start'))
  await wait(dialog)
  const message = () => ui(dialog + '.innerText')
  assert.match(await message(), /流水线启动前估算[\s\S]*预计输入：[\d,]+ 至 [\d,]+ token[\s\S]*预计输出：0 至 321 token[\s\S]*USD [\d.]+ 至 [\d.]+[\s\S]*全书预算未知/u)
  checkQuote(await message(), 'USD', 4, 0, 321)
  await press(button('取消', dialog)); await wait('!' + el('.confirm-overlay'))
  assert.deepEqual(await snapshot(), beforeCancel)
  await press(nav('修订工作台')); await wait(button('生成修订版本'))
  await press(button('生成修订版本')); await wait(dialog)
  assert.match(await message(), /修订发起前估算[\s\S]*预计输入：[\d,]+ 至 [\d,]+ token[\s\S]*预计输出：0 至 654 token[\s\S]*CNY [\d.]+ 至 [\d.]+/u)
  checkQuote(await message(), 'CNY', 6, 2, 654)
  await press(button('取消', dialog)); await wait('!' + el('.confirm-overlay'))
  assert.deepEqual(await snapshot(), beforeCancel)
  assert.equal(await readFile(journal, 'utf8'), receipts)
  await press(button('返回项目列表')); await enter('价格乙样书'); await openTable()
  assert.match(await ui(totals + '.cells[1].textContent'), /^1 次失败 0$/)
  assert(!/CNY|USD|EUR/.test(await totalText()))
  await press(button('返回项目列表')); await enter('价格甲样书'); await openTable(); await waitCurrency('CNY', 8)
  assert.equal(calls, 0, 'A model request reached the loopback tripwire')
  assert.deepEqual(session.exceptions, []); assert.deepEqual(session.networkRequests, [])
  console.log('PASS isolated Electron + SQLite: per-phase physical/legacy/unknown, CNY 3 -> 8, USD 4 unchanged, EUR on reopen, book isolation, both preflights cancelled without writes or requests.')
} finally {
  try {
    const closed = await cleanup(session)
    if (closed) {
      assert.deepEqual(closed.remainingProcessIds, [])
      console.log('CLOSED', JSON.stringify({ pid: session.child.pid, remainingProcessIds: [] }))
    }
  } finally {
    if (tripwire.listening) await new Promise(done => tripwire.close(done))
    assert.equal(dirname(await realpath(work)), await realpath(tmp))
    assert.equal(resolve(profile), join(work, 'profile'))
    await rm(work, { recursive: true, force: true, maxRetries: 4 })
    assert.equal(calls, 0, 'Unexpected loopback request during shutdown')
  }
}

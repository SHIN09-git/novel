// Production renderer and SQLite IPC; only a disposable userData directory with synthetic text.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { repoRoot as root } from './utils/repo-root.mjs'
import { loadDomainModules } from './utils/load-domain-modules.mjs'
import { cardBalanceFixture } from './fixtures/card-balance.mjs'
import { qaRuntimeTarget, targetIdentity, prepareTarget, writeOfflineQaProfile, connectQaSession, verifyQaOffline, cleanupQaRun } from './utils/long-novel-ui-runtime.mjs'
import { launch, cleanup, evaluate, click, button, ready } from './utils/long-novel-ui-driver.mjs'

const { normalizeAppData, CharacterStateService } = await loadDomainModules('shared/defaults', 'services/CharacterStateService')
const { data } = cardBalanceFixture(normalizeAppData, CharacterStateService)
await mkdir(join(root, 'tmp'), { recursive: true })
const work = await mkdtemp(join(root, 'tmp', 'card-balance-ui-')), profile = join(work, 'profile')
const target = qaRuntimeTarget(root)
let session, sink
try {
  await targetIdentity(root, target)
  await prepareTarget(root, target, work)
  sink = await writeOfflineQaProfile(profile, data)
  session = await launch(target, profile)
  await connectQaSession(target, session, profile)
  let c = session.client
  const nav = 'document.querySelector(".nav-list")'
  async function enter() {
    const row = '[...document.querySelectorAll(".project-row")].find(e=>e.textContent.includes("试算样书"))'
    await ready(c, row)
    await click(c, button('进入', row))
    await ready(c, nav)
  }
  async function change(selector, value, isSelect = false) {
    await evaluate(c, '(()=>{const el=document.querySelector(' + JSON.stringify(selector) + ');' +
      'Object.getOwnPropertyDescriptor(' + (isSelect ? 'HTMLSelectElement' : 'HTMLInputElement') +
      '.prototype,"value").set.call(el,' + JSON.stringify(value) + ');el.dispatchEvent(new Event("' +
      (isSelect ? 'change' : 'input') + '",{bubbles:true}))})()')
  }
  await enter()
  await click(c, button('角色', nav))
  const panel = 'document.querySelector(".character-card-review")'
  await ready(c, panel)
  assert.match(await evaluate(c, panel + '.innerText'), /未核对/)
  await change('.character-card-review select', 'c10', true)
  await ready(c, button('保留原卡，核对到第 10 章', panel))
  await click(c, button('保留原卡，核对到第 10 章', panel))
  await ready(c, panel + '?.querySelector("[role=status]")?.textContent.includes("核对到第 10 章")')
  await change('.character-card-review select', 'c12', true)
  await ready(c, panel + '?.innerText.includes("相差 2 章")')
  await click(c, 'document.querySelector(".character-review-evidence summary")')
  await ready(c, panel + '?.innerText.includes("30文")')
  await click(c, button('Prompt 构建器', nav))
  const editor = 'document.querySelector("textarea.prompt-editor")'
  const amount = async (order, expected) => {
    await ready(c, 'document.querySelector(".prompt-controls input[type=number]")')
    await change('.prompt-controls input[type=number]', String(order))
    await click(c, button('构建 Prompt'))
    await ready(c, editor + '?.value.includes("第 ' + order + ' 章写作 Prompt")')
    const prompt = await evaluate(c, editor + '.value')
    const section = prompt.match(/【角色状态账本切片】([\s\S]*?)(?=\n## |$)/u)?.[1] ?? ''
    assert(section.includes('随身现金：' + expected + ' 文'), 'Missing confirmed balance for chapter ' + order)
    assert(!section.includes('钱只剩十文') && section.includes('替船队保管五十文'))
    return section
  }
  await amount(13, 30)
  assert.doesNotMatch(await amount(11, 10), /30 文|三十文/)
  await verifyQaOffline(session, sink)
  const closed = await cleanup(session)
  assert.deepEqual(closed.remainingProcessIds, [])
  console.log('QA_RESTART', JSON.stringify({ pid: session.child.pid, remainingProcessIds: closed.remainingProcessIds }))
  session = await launch(target, profile)
  await connectQaSession(target, session, profile)
  c = session.client
  await ready(c, 'document.querySelector(".project-row") || document.querySelector(".nav-list")')
  if (!await evaluate(c, '!!document.querySelector(".nav-list")')) await enter()
  await click(c, button('角色', nav))
  await ready(c, panel + '?.innerText.includes("相差 2 章")')
  await verifyQaOffline(session, sink)
} finally {
  await cleanupQaRun(root, work, session, sink)
}
console.log(`PASS ${target.mode}: retained card at chapter 10, confirmed marker after a full restart, chapter 13 gets 30 wen, chapter 11 gets 10 wen.`)

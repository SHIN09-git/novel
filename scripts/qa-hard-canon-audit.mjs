// Use the isolated preview by default, or the release executable with --packaged.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { repoRoot as root } from './utils/repo-root.mjs'
import { loadProseFixtureDomain } from './utils/qa-prose-first-fixture.mjs'
import { qaRuntimeTarget, targetIdentity, prepareTarget, writeOfflineQaProfile, connectQaSession, verifyQaOffline, cleanupQaRun } from './utils/long-novel-ui-runtime.mjs'
import { launch, evaluate, click, button, ready } from './utils/long-novel-ui-driver.mjs'

const base = join(root, 'tmp')
await mkdir(base, { recursive: true })
const work = await mkdtemp(join(base, 'canon-desktop-'))
const target = qaRuntimeTarget(root)
const t = '2026-10-01T00:00:00.000Z'
let session, sink
try {
  await targetIdentity(root, target)
  await prepareTarget(root, target, work)
  const { normalizeAppData } = await loadProseFixtureDomain()
  const data = normalizeAppData({
    projects: [{ id: 'qa-p', name: '核查样书', createdAt: t, updatedAt: t }],
    chapterGenerationJobs: [{ id: 'qa-j', projectId: 'qa-p', targetChapterOrder: 1, status: 'completed',
      currentStep: 'await_user_confirmation', createdAt: t, updatedAt: t }],
    generatedChapterDrafts: [{ id: 'qa-d', projectId: 'qa-p', jobId: 'qa-j', title: '铜扣', body: '扣上还剩一道雾印。',
      status: 'draft', createdAt: t, updatedAt: t }]
  })
  const profile = join(work, 'profile')
  sink = await writeOfflineQaProfile(profile, data)
  session = await launch(target, profile)
  await connectQaSession(target, session, profile)
  const c = session.client, nav = name => button(name, 'document.querySelector(".nav-list")')
  const field = label => `([...document.querySelectorAll('.hard-canon-draft .field')].find(e=>e.querySelector('.field-label')?.textContent===${JSON.stringify(label)})?.querySelector('input,select,textarea'))`
  const select = (label, value) => evaluate(c, `(() => {const el=${field(label)}; el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); return el.value})()`)
  const fill = async (label, value) => { await click(c, field(label)); await c.send('Input.insertText', { text: value }) }
  const row = '[...document.querySelectorAll(".project-row")].find(e=>e.textContent.includes("核查样书"))'
  await ready(c, row)
  await click(c, button('进入', row))
  await ready(c, 'document.querySelector(".dashboard-view")')
  await click(c, nav('硬设定包'))
  await ready(c, field('标题'))
  const enterRule = async () => {
    await fill('标题', '禁写雾印')
    await fill('内容', '不使用雾印。')
    await select('检查方式', 'terms')
    await ready(c, field('检查用语（每行一项）'))
    await fill('检查用语（每行一项）', '雾印')
    await select('核查结果', 'block')
  }
  await enterRule()
  await click(c, button('新增条目', 'document.querySelector(".hard-canon-draft")'))
  await ready(c, 'document.querySelector(".hard-canon-item")?.textContent.includes("可机械核查")')
  assert.match(await evaluate(c, 'document.querySelector(".hard-canon-condition").textContent'), /雾印.*确证违规时阻断/)
  const openDraft = async () => {
    await click(c, nav('生产流水线'))
    await ready(c, 'document.querySelector(".pipeline-artifact-tabs")')
    await click(c, button('草稿', 'document.querySelector(".pipeline-artifact-tabs")'))
  }
  await openDraft()
  const accept = button('未完成审稿，直接采纳')
  await ready(c, 'document.querySelector(".pipeline-draft-body") && document.querySelector(".pipeline-diagnostics-summary")', 12000)
  assert.equal(await evaluate(c, 'document.querySelector(".hard-canon-evidence blockquote")?.textContent'), '扣上还剩一道雾印。')
  assert.equal(await evaluate(c, 'document.querySelector(".hard-canon-evidence mark")?.textContent'), '雾印')
  assert.equal(await evaluate(c, `${accept}?.disabled`), true)
  await click(c, nav('硬设定包'))
  await ready(c, 'document.querySelector(".hard-canon-item")')
  await click(c, button('停用', 'document.querySelector(".hard-canon-item")'))
  await ready(c, button('启用', 'document.querySelector(".hard-canon-item")'))
  const storedRules = () => evaluate(c, `window.novelDirector.data.load().then(({data}) =>
    data.hardCanonPacks.find(p => p.projectId === "qa-p").items.map(({id,status}) => ({id,status})))`)
  const before = await storedRules()
  assert.equal(before.length, 1)
  assert.equal(before[0].status, 'inactive')
  await enterRule()
  const reuse = button('复用已有条目', 'document.querySelector(".hard-canon-draft")')
  await ready(c, reuse)
  await click(c, reuse)
  await ready(c, 'document.querySelector(".hard-canon-message")?.innerText.includes("已复用")')
  assert.deepEqual(await storedRules(), before, 'Duplicate entry must neither create nor reactivate a rule')
  await openDraft()
  await ready(c, `${accept} && !${accept}.disabled && !document.querySelector('.hard-canon-evidence')`)
  await verifyQaOffline(session, sink)
} catch (error) {
  if (session?.client) console.error(await evaluate(session.client,
    '({ notice: document.querySelector(".notice")?.textContent, artifact: document.querySelector(".pipeline-current-artifact")?.innerText?.slice(0,350), diagnostics: document.querySelector(".pipeline-diagnostics-summary")?.innerText?.slice(0,350) })').catch(() => null))
  throw error
} finally {
  await cleanupQaRun(root, work, session, sink)
}
console.log(`PASS ${target.mode}: authored a blocking rule, saw exact draft evidence, re-entered the disabled rule without duplicating or reactivating it, verified acceptance unlocked.`)

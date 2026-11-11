// Only the disposable Electron profile and synthetic manuscript are opened.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { repoRoot as root } from './utils/repo-root.mjs'
import { bookProgressFixture } from './fixtures/book-progress.mjs'
import { qaRuntimeTarget, targetIdentity, prepareTarget, writeOfflineQaProfile, connectQaSession, verifyQaOffline, cleanupQaRun } from './utils/long-novel-ui-runtime.mjs'
import { launch, evaluate, click, button, ready } from './utils/long-novel-ui-driver.mjs'

await mkdir(join(root, 'tmp'), { recursive: true })
const work = await mkdtemp(join(root, 'tmp', 'book-progress-ui-')), target = qaRuntimeTarget(root)
const profile = join(work, 'profile')
const Database = createRequire(import.meta.url)('better-sqlite3')
let session, sink
try {
  await targetIdentity(root, target)
  await prepareTarget(root, target, work)
  sink = await writeOfflineQaProfile(profile, bookProgressFixture())
  session = await launch(target, profile)
  await connectQaSession(target, session, profile)
  const c = session.client, table = 'document.querySelector(".book-progress-table")'
  const enterBook = async () => {
    const project = '[...document.querySelectorAll(".project-row")].find(e => e.textContent.includes("全书进度样书"))'
    await ready(c, project)
    await click(c, button('进入', project))
    await ready(c, 'document.querySelector(".book-progress")')
  }
  await enterBook()
  assert.match(await evaluate(c, 'document.querySelector(".book-progress-goal").innerText'), /15,?000/)
  await click(c, button('全书进度与缺章'))
  await ready(c, table)
  await click(c, 'document.querySelector(".book-progress-check input")')
  await ready(c, table + '?.tBodies[0]?.rows.length === 4')
  const rows = await evaluate(c, '[...document.querySelectorAll(".book-progress-table tbody tr")].map(e=>e.innerText)')
  assert.match(rows[0], /66.*缺章/s)
  assert.match(rows[1], /74.*仅有草稿/s)
  assert.match(rows[2], /80.*空章/s)
  assert.match(rows[3], /92.*写回失败.*历史正文/s)
  await click(c, 'document.querySelector("[aria-label=编辑全书目标]")')
  await ready(c, 'document.querySelector(".book-target-editor input")')
  // Use the native value setter to drive React's controlled numeric input.
  await evaluate(c, '(()=>{const el=document.querySelector(".book-target-editor input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,"1000");el.dispatchEvent(new Event("input",{bubbles:true}));})()')
  await click(c, button('保存目标'))
  await ready(c, 'document.querySelector(".book-progress-goal")?.innerText.includes("724")')
  await c.send('Page.reload')
  await ready(c, 'document.querySelector(".project-row") || document.querySelector(".dashboard-view")')
  if (!await evaluate(c, '!!document.querySelector(".dashboard-view")')) await enterBook()
  await ready(c, 'document.querySelector(".book-progress-goal")?.innerText.includes("724")')
  const goDashboard = async () => {
    await click(c, button('工作台', 'document.querySelector(".nav-list")'))
    await ready(c, 'document.querySelector(".book-progress")')
  }
  const selectProblems = async () => {
    await click(c, button('全书进度与缺章'))
    await ready(c, table)
    await click(c, 'document.querySelector(".book-progress-check input")')
  }
  const row74 = '[...document.querySelectorAll(".book-progress-table tr")].find(e=>e.textContent.includes("第 74 章"))'
  const submit74 = async () => {
    await ready(c, row74)
    await click(c, button('回到草稿', row74))
    await ready(c, button('未完成审稿，直接采纳'))
    await click(c, button('未完成审稿，直接采纳'))
    const confirm = button('确认未审稿采纳', 'document.querySelector(".confirm-dialog")')
    await ready(c, confirm)
    await click(c, confirm)
  }
  // The normal QA wait rejects storage warnings, but this deliberate failure must surface one.
  const waitWithNotice = async expression => {
    const end = Date.now() + 10000
    while (!await evaluate(c, 'Boolean(' + expression + ')')) {
      assert(Date.now() < end, 'Expected writeback warning/confirmation did not appear')
      await new Promise(r => setTimeout(r, 30))
    }
  }
  const db = new Database(join(profile, 'novel-director-data.sqlite'), { fileMustExist: true })
  try {
    db.exec("CREATE TRIGGER qa_book_progress BEFORE INSERT ON entities WHEN NEW.collection='chapterVersions' BEGIN SELECT RAISE(ABORT, 'synthetic failed write'); END")
    await selectProblems()
    await submit74()
    await waitWithNotice('document.querySelector(".storage-conflict-notice")?.textContent.includes("本次正式写回未确认")')
    assert.equal(db.prepare("SELECT count(*) AS n FROM entities WHERE collection='chapters' AND project_id=? AND chapter_order=74").get('progress-book').n, 0)
    assert.equal(db.prepare("SELECT count(*) AS n FROM entities WHERE collection='chapterWritebackFailures' AND project_id=? AND chapter_order=74").get('progress-book').n, 1)
    db.exec('DROP TRIGGER qa_book_progress')
    await click(c, button('重新加载最新数据', 'document.querySelector(".storage-conflict-notice")'))
    const confirm = button('重新加载', 'document.querySelector(".confirm-dialog")')
    await waitWithNotice(confirm)
    await click(c, confirm)
    await waitWithNotice('!document.querySelector(".storage-conflict-notice")')
    await goDashboard()
    await selectProblems()
    await ready(c, row74 + '?.textContent.includes("写回失败")')
    await submit74()
    await ready(c, 'document.body.innerText.includes("第 74 章已接受并写入版本链")')
    await goDashboard()
    await selectProblems()
    await ready(c, table + '?.tBodies[0]?.rows.length === 3')
    assert.equal(await evaluate(c, 'Boolean(' + row74 + ')'), false)
    assert.equal(db.prepare("SELECT count(*) AS n FROM entities WHERE collection='chapterCommitBundles' AND project_id=? AND job_id=?").get('progress-book', 'j74').n, 1)
  } finally { db.close() }
  await verifyQaOffline(session, sink)
} finally {
  await cleanupQaRun(root, work, session, sink)
}
console.log(`PASS ${target.mode}: 96-chapter progress and goal, failed SQLite commit rolled back, explicit reload showed the failure, retry from the draft committed once.`)

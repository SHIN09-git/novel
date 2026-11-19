import assert from 'node:assert/strict'
import { copyFile, cp, mkdir, mkdtemp, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'
import { bookProgressFixture, progressBookId } from './fixtures/book-progress.mjs'
import { button, click, connect, evaluate, launch, ready, within } from './utils/long-novel-ui-driver.mjs'
import { cleanupQaRun, verifyQaOffline, writeOfflineQaProfile } from './utils/long-novel-ui-runtime.mjs'

await mkdir(join(repoRoot, 'tmp'), { recursive: true })
const work = await mkdtemp(join(repoRoot, 'tmp', 'agent-library-ui-'))
const runtimeRoot = join(work, 'runtime'), profile = join(work, 'profile')
const panel = "document.querySelector('.home-library-authorization')"
const dialog = "document.querySelector('.confirm-dialog')"
let session, sink

try {
  await mkdir(runtimeRoot)
  await cp(join(repoRoot, 'out'), join(runtimeRoot, 'out'), { recursive: true })
  await copyFile(join(repoRoot, 'package.json'), join(runtimeRoot, 'package.json'))
  sink = await writeOfflineQaProfile(profile, bookProgressFixture())
  session = await launch({ mode: 'isolated-out', runtimeRoot,
    executable: join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe') }, profile)
  await connect(session)
  const { client } = session
  const grant = button('授予全库管理权', panel)
  const inDialog = async (label) => {
    const target = button(label, dialog)
    await ready(client, `${dialog} && (${target})`)
    await click(client, target)
  }
  await ready(client, `${panel} && (${grant}) && !(${grant}).disabled`)
  const before = await evaluate(client, 'window.novelDirector.data.load()')
  assert(within(await realpath(profile), await realpath(before.storagePath)), 'Desktop did not open the disposable library')
  assert.ok(before.data.chapters.length)
  await click(client, grant)
  assert.equal(await evaluate(client, 'window.novelDirector.agentAuthorization.getLibraryAuthorization()'), null)
  await inDialog('授予全库管理权')
  await ready(client, button('撤回全库管理权', panel))
  const issued = await evaluate(client, 'window.novelDirector.agentAuthorization.getLibraryAuthorization()')
  assert.equal(issued.purpose, 'library_manager')

  const archiveControl = "document.querySelector('[aria-label=\"归档《全书进度样书》\"]')"
  await click(client, archiveControl)
  await inDialog('归档项目')
  await ready(client, "document.querySelector('.home-library-records > summary')")
  const archive = await evaluate(client, 'window.novelDirector.data.load()')
  assert.ok(archive.data.projects.find(project => project.id === progressBookId).archivedAt)
  assert.deepEqual(archive.data.chapters, before.data.chapters)
  await click(client, "document.querySelector('.home-library-records > summary')")
  await click(client, button('恢复项目'))
  await ready(client, archiveControl)
  const restored = await evaluate(client, 'window.novelDirector.data.load()')
  assert.equal(restored.data.projects.find(project => project.id === progressBookId).archivedAt, null)

  await click(client, button('撤回全库管理权', panel))
  await inDialog('撤回授权')
  await ready(client, grant)
  assert.equal(await evaluate(client, 'window.novelDirector.agentAuthorization.getLibraryAuthorization()'), null)
  await verifyQaOffline(session, sink)
  console.log('Agent library UI smoke passed: grant, archive, restore, revoke; backend=' +
    (before.storagePath.endsWith('.sqlite') ? 'sqlite' : 'json'))
} finally {
  await cleanupQaRun(repoRoot, work, session, sink)
}

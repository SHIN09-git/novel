import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { repoRoot as root } from './utils/repo-root.mjs'
import { loadProseFixtureDomain, createProseFirstFixture, PROSE_FIXTURE_IDS as ids, startProseRejectSink } from './utils/qa-prose-first-fixture.mjs'
import { targetIdentity, prepareTarget, verifyRuntimeIdentity } from './utils/long-novel-ui-runtime.mjs'
import { launch, connect, cleanup, evaluate, click, button, ready } from './utils/long-novel-ui-driver.mjs'
import { inspectProseDOM, assertProseLayout, PROSE_WORKSPACES } from './utils/qa-prose-first-workspaces.mjs'
import { exerciseCharacterWorkspace } from './utils/qa-character-workspace.mjs'

const baseline = process.argv.includes('--baseline')
const packaged = process.argv.includes('--packaged')
const base = join(root, 'tmp', 'visual-qa', 'hig-workspace')
await mkdir(base, { recursive: true })
const work = await mkdtemp(join(base, baseline ? 'before-' : 'after-'))
const target = { mode: 'isolated-out', packagedDir: join(root, 'release', 'win-unpacked'),
  executable: join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), out: join(root, 'out'),
  binding: join(root, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
  required: ['main/index.js', 'preload/index.cjs', 'renderer/index.html'].map(p => join(root, 'out', p)) }
if (packaged) {
  target.mode = 'packaged'
  target.executable = join(target.packagedDir, 'Novel Director.exe')
  target.out = null
  target.required = []
}
const result = { date: new Date().toISOString(), baseline, packaged, work, screenshots: [], samples: [], checks: [], status: 'running' }
const sink = await startProseRejectSink()
let session
const j = JSON.stringify
try {
  await targetIdentity(root, target)
  await prepareTarget(root, target, work)
  const domain = await loadProseFixtureDomain()
  const data = domain.normalizeAppData(createProseFirstFixture(domain.normalizeAppData({
    projects: [{ id: 'qa-empty', name: '空白项目', createdAt: '2026-09-14T00:00:00Z', updatedAt: '2026-09-14T00:00:00Z' }]
  }), sink.baseUrl, domain.draftContentHash))
  Object.assign(data.projects.find(p => p.id === ids.projectId), { name: '钟楼来信', description: '旧城钟楼的一页失踪账簿，将两个素不相识的人引向同一封信。' })
  data.characters.push({ id: 'qa-lin', projectId: ids.projectId, name: '林默', role: '旧城档案修复员', roleFunction: '旧城档案修复员',
    surfaceGoal: '找到钟楼账簿的缺页', deepDesire: '重新相信自己的判断', deepNeed: '重新相信自己的判断', coreFear: '再次错过真相',
    protagonistRelationship: '对送信人的身份保持怀疑',
    decisionLogic: '先核对证据，再做决定', abilitiesAndResources: '旧地图、铜钥匙、修复工具',
    weaknessAndCost: '右手指节仍有伤', relationshipTension: '对送信人的身份保持怀疑', futureHooks: '缺页背面的印痕',
    isMain: true, createdAt: '2026-09-14T00:00:00Z', updatedAt: '2026-09-14T00:00:00Z' })
  data.characters.push({ id: 'qa-b', projectId: ids.projectId, name: '顾遥', role: '钟楼信使', roleFunction: '钟楼信使',
    surfaceGoal: '把失踪账簿送到指定地点', deepDesire: '证明自己没有背叛同伴', deepNeed: '证明自己没有背叛同伴', coreFear: '信使身份暴露',
    protagonistRelationship: '与林默互相试探', decisionLogic: '先确认退路，再交出信件', abilitiesAndResources: '旧城路线图、封蜡信件',
    weaknessAndCost: '不愿在众人面前解释', relationshipTension: '与林默互相试探', futureHooks: '信封里的第二枚印章',
    isMain: false, createdAt: '2026-09-14T00:00:00Z', updatedAt: '2026-09-14T00:00:00Z' })
  data.characterStateFacts.push({ id: 'qa-injury', projectId: ids.projectId, characterId: 'qa-lin', category: 'physical',
    key: 'right-hand', label: '右手指节伤', value: '拆开账簿时不能连续用力，需要停下换手。', valueType: 'text',
    linkedCardFields: ['weaknessAndCost'], trackingLevel: 'hard', promptPolicy: 'when_relevant', status: 'active',
    sourceChapterOrder: 1, evidence: '右手指节仍有伤，拆线时改用左手。', createdAt: '2026-09-14T00:00:00Z', updatedAt: '2026-09-14T00:00:00Z' })
  const profile = join(work, 'profile')
  await mkdir(profile)
  await writeFile(join(profile, 'novel-director-data.json'), j(domain.normalizeAppData(data)))
  session = await launch(target, profile)
  await connect(session)
  const c = session.client
  await ready(c, 'document.querySelector(".project-row")')
  result.runtime = await evaluate(c, 'window.novelDirector.app.getRuntimeInfo()')
  verifyRuntimeIdentity(target, result.runtime, await evaluate(c, 'location.href'))
  await click(c, button('进入', `[...document.querySelectorAll('.project-row')].find(e=>e.querySelector('h3')?.textContent==='钟楼来信')`))
  await ready(c, 'document.querySelector(".dashboard-view")')
  const pages = [['工作台', '.dashboard-view'], ['章节', '.chapter-workbench'], ['角色', '.characters-view'],
    ['Prompt 构建器', '.prompt-layout'], ['生产流水线', '.generation-view'], ['修订工作台', '.revision-view'], ['连贯阅读', '.reading-view']]
  let expectedTheme = 'light'
  const take = async (name, { preserveScroll = false } = {}) => {
    await c.send('Page.bringToFront')
    assert.equal(await evaluate(c, 'document.documentElement.dataset.theme'), expectedTheme, `${name}: theme must survive saves`)
    if (!preserveScroll) await evaluate(c, 'window.scrollTo(0,0); document.querySelector(".main-panel").scrollTop=0')
    await evaluate(c, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    // Off-screen/discrete animations may keep finished pending; screenshots must not hang on them.
    await evaluate(c, 'Promise.race([Promise.allSettled(document.getAnimations().filter(a => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)), new Promise(resolve=>setTimeout(resolve,1500))])')
    const shot = await c.send('Page.captureScreenshot', { format: 'png' })
    const path = join(work, `${name}.png`)
    await writeFile(path, Buffer.from(shot.data, 'base64'))
    result.screenshots.push(path)
  }
  for (const theme of ['light', 'dark']) {
    await click(c, button('设置', 'document.querySelector(".nav-list")'))
    const themeSelect = `([...document.querySelectorAll('.settings-view .field')].find(e=>e.querySelector('.field-label')?.textContent==='主题')?.querySelector('select'))`
    await ready(c, `Boolean(${themeSelect})`)
    await click(c, themeSelect)
    const keys = theme === 'light' ? [['Home', 36], ['ArrowDown', 40], ['Enter', 13]] : [['End', 35], ['Enter', 13]]
    for (const [key, code] of keys) {
      await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code })
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code })
    }
    await ready(c, `document.documentElement.dataset.theme===${j(theme)}`)
    assert.equal(await evaluate(c, 'window.novelDirector.data.load().then(r=>r.data.settings.theme)'), theme)
    expectedTheme = theme
    await evaluate(c, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    await evaluate(c, 'Promise.allSettled(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished))')
    for (const [label, selector] of pages) {
      await click(c, button(label, 'document.querySelector(".nav-list")'))
      if (label === '角色') await ready(c, 'document.querySelector(".page-header h1")?.textContent.includes("角色")')
      else await ready(c, `document.querySelector(${j(selector)})`)
      if (label === '生产流水线') {
        const draftButton = button('草稿', 'document.querySelector(".pipeline-artifact-tabs")')
        if (await evaluate(c, `Boolean(document.querySelector('.pipeline-artifact-tabs') && ${draftButton})`)) await click(c, draftButton)
      }
      if (label === '修订工作台') {
        await click(c, button('草稿', 'document.querySelector(".revision-source-card")'))
        await ready(c, 'document.querySelector(".revision-compare.has-versions")')
        await click(c, button('修订后', 'document.querySelector(".revision-view-switch")'))
      }
      for (const width of [1440, 1024]) {
        await c.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
        const sample = await evaluate(c, `(() => { const main = document.querySelector('.main-panel').getBoundingClientRect();
          return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,mainWidth:main.width,
            sidebarWidth:document.querySelector('.sidebar').getBoundingClientRect().width,
            activeCount:document.querySelectorAll('.nav-list [aria-current="page"]').length}; })()`)
        result.samples.push({ theme, label, ...sample })
        if (!baseline) {
          assert(sample.documentWidth <= width + 1, `${label} ${width} overflow`); assert.equal(sample.activeCount, 1)
          const spec = ({ '生产流水线': PROSE_WORKSPACES.pipeline, '修订工作台': PROSE_WORKSPACES.revision, '连贯阅读': PROSE_WORKSPACES.reading })[label]
          const inspection = await evaluate(c, `(${inspectProseDOM.toString()})(${j(spec ? { ...spec, expectedText: '林默' }
            : { root: '.app-shell', main: '.main-panel', body: '.workspace-content', expectedText: '' })})`)
          assert(inspection, `Missing visible ${label}`)
          assert(inspection.primaryContrasts.every(v=>v.ratio>=4.5), `${label} primary contrast: ${j(inspection.primaryContrasts)}`)
          assert.deepEqual(inspection.unlabelledTools, [], `${label} unlabelled tool`)
          if (spec) assertProseLayout(inspection, spec)
          result.samples.at(-1).primaryContrasts = inspection.primaryContrasts
        }
        await take(`${theme}-${width}-${pages.findIndex(p => p[0] === label)}-${label.replaceAll(' ', '-')}`)
      }
      if (!baseline && label === '角色') await exerciseCharacterWorkspace(c, { theme, take, result })
    }
    result.checks.push(`${theme}: selected through the real settings control, persisted in isolated SQLite and verified before every screenshot.`)
  }
  if (!baseline) {
    await click(c, button('工作台', 'document.querySelector(".nav-list")'))
    await ready(c, 'document.querySelector(".dashboard-view")')
    await click(c, 'document.querySelector(".sidebar-toggle")')
    assert.equal(await evaluate(c, 'document.querySelector(".sidebar-toggle").getAttribute("aria-expanded")'), 'false')
    assert.equal(await evaluate(c, 'document.querySelector(".sidebar").inert'), true)
    // The new rail has an exit transition; focus is removed immediately, layout after it finishes.
    await ready(c, 'document.querySelector(".sidebar").getBoundingClientRect().width === 0', 3000)
    assert.equal(await evaluate(c, 'document.querySelector(".sidebar").getBoundingClientRect().width'), 0)
    assert(await evaluate(c, 'document.querySelector(".main-panel").getBoundingClientRect().width > innerWidth - 20'))
    await take('sidebar-collapsed')
    await click(c, 'document.querySelector(".sidebar-toggle")')
    assert.equal(await evaluate(c, 'document.querySelector(".sidebar").inert'), false)
    result.checks.push('Sidebar collapse/reopen updates ARIA, removes hidden navigation from focus, and preserves current page.')
    await c.send('Emulation.setEmulatedMedia', { features: [{name:'prefers-reduced-motion',value:'reduce'}] })
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await evaluate(c, 'document.querySelector(".sidebar-toggle").focus()')
    await take('keyboard-focus-reduced-motion')
    assert.notEqual(await evaluate(c, 'getComputedStyle(document.activeElement).outlineStyle'), 'none')
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
    await ready(c, 'document.querySelector(".sidebar-toggle").getAttribute("aria-expanded")==="false"', 3000)
    assert.equal(await evaluate(c, 'document.querySelector(".sidebar-toggle").getAttribute("aria-expanded")'), 'false')
    result.checks.push('Visible keyboard focus with reduced motion.')
    for (const zoom of [1, 1.25]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 900, deviceScaleFactor: 1, mobile: false })
      await evaluate(c, `document.documentElement.style.zoom=${j(String(zoom))}`)
      await take(`narrow-800-zoom-${zoom}`)
      assert(await evaluate(c, 'document.documentElement.scrollWidth <= innerWidth + 1'), 'Narrow/zoomed workspace overflow')
    }
    await evaluate(c, 'document.documentElement.style.zoom=""')
    result.checks.push('Primary-action text contrast >=4.5:1; narrow 800px/125% reflow; prose stays first-screen and unobscured.')
  }
  const stored = await evaluate(c, 'window.novelDirector.data.load().then(r=>({path:r.storagePath,projects:r.data.projects.map(p=>p.id)}))')
  assert(stored.path.startsWith(profile) && stored.path.endsWith('.sqlite'))
  assert(stored.projects.every(p=>p.startsWith('qa-')))
  assert.deepEqual(session.exceptions, [])
  assert.deepEqual(sink.requests, [])
  result.checks.push('All seven routes open in both themes and two desktop sizes; isolated SQLite; zero AI calls or renderer exceptions.')
  result.status = 'passed'
} catch (error) { result.status='failed'; result.error=error.stack; process.exitCode=1 }
finally {
  result.cleanup = await cleanup(session)
  await sink.close()
  await writeFile(join(work, 'report.json'), j(result, null, 2))
  console.log(j({ status: result.status, error: result.error, work, screenshots: result.screenshots.length, checks: result.checks, cleanup: result.cleanup }, null, 2))
}

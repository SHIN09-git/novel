import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { repoRoot as root } from './utils/repo-root.mjs'
import {
  AUTHOR_LONG_PROJECT_NAME,
  createAuthorWorkspaceFixture,
  loadAuthorWorkspaceFixtureDomain
} from './utils/qa-author-workspace-fixture.mjs'
import {
  AUTHOR_WORKSPACE_SELECTOR_CONTRACT,
  HOME_SELECTORS,
  PROMPT_PANEL_IDS,
  PROMPT_SELECTORS,
  PROMPT_TAB_IDS,
  PROMPT_TAB_LABELS,
  TASK_FIELD_LABELS,
  buttonWithText,
  contrastInspectionExpression,
  fieldByLabel,
  firstSelector,
  json,
  projectRowByName
} from './utils/qa-author-workspace-selectors.mjs'
import { targetIdentity, prepareTarget, verifyRuntimeIdentity } from './utils/long-novel-ui-runtime.mjs'
import { launch, connect, cleanup, evaluate, click, ready } from './utils/long-novel-ui-driver.mjs'

const packaged = process.argv.includes('--packaged')
const base = join(root, 'tmp', 'visual-qa', 'author-workspace')
await mkdir(base, { recursive: true })
const work = await mkdtemp(join(base, packaged ? 'packaged-' : 'out-'))
const target = {
  mode: 'isolated-out',
  packagedDir: join(root, 'release', 'win-unpacked'),
  executable: join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
  out: join(root, 'out'),
  binding: join(root, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
  required: ['main/index.js', 'preload/index.cjs', 'renderer/index.html'].map((path) => join(root, 'out', path))
}
if (packaged) {
  target.mode = 'packaged'
  target.executable = join(target.packagedDir, 'Novel Director.exe')
  target.out = null
  target.required = []
}

const result = {
  date: new Date().toISOString(),
  packaged,
  work,
  screenshots: [],
  samples: [],
  checks: [],
  selectorContract: AUTHOR_WORKSPACE_SELECTOR_CONTRACT,
  status: 'running'
}
const j = JSON.stringify
let session

function homeNewProjectForm() {
  return `(${firstSelector([HOME_SELECTORS.newProjectForm])} || [...document.querySelectorAll('.home .panel')].find((panel) => /新建项目|创建新项目/.test(panel.querySelector('h2')?.textContent || '')))`
}

function homeSearch() {
  return firstSelector([HOME_SELECTORS.search])
}

function saveButton(rootExpression) {
  return buttonWithText(['创建项目', '创建并进入工作台', '保存项目', '保存资料', '保存'], rootExpression)
}

async function fillText(client, expression, value) {
  await click(client, expression)
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await client.send('Input.insertText', { text: value })
  await ready(client, `(${expression})?.value === ${json(value)}`)
}

async function screenshot(client, name) {
  const shot = await client.send('Page.captureScreenshot', { format: 'png' })
  const path = join(work, `${name}.png`)
  await writeFile(path, Buffer.from(shot.data, 'base64'))
  result.screenshots.push(path)
}

async function setViewport(client, width, zoom = 1) {
  await client.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
  await evaluate(client, `document.documentElement.style.zoom=${json(String(zoom))}`)
  await evaluate(client, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await evaluate(client, 'Promise.allSettled(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished))')
}

async function returnHome(client) {
  if (await evaluate(client, `Boolean(document.querySelector(${json(HOME_SELECTORS.root)}))`)) return
  const back = buttonWithText(['返回项目列表'])
  await click(client, back)
  await ready(client, `document.querySelector(${json(HOME_SELECTORS.root)})`)
}

async function assertHome(client, screenshotName = 'home-first-screen') {
  await ready(client, `document.querySelector(${json(HOME_SELECTORS.root)})`)
  await evaluate(client, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await evaluate(client, 'Promise.allSettled(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished))')
  const sample = await evaluate(client, `(() => {
    const list = document.querySelector(${json(HOME_SELECTORS.projectList)})
    const rows = [...document.querySelectorAll(${json(HOME_SELECTORS.projectRows)})]
    const box = list?.getBoundingClientRect()
    return { rows: rows.map((row) => ({ name: row.querySelector('h3')?.textContent.trim() || '', width: row.getBoundingClientRect().width,
      scrollWidth: row.scrollWidth, clientWidth: row.clientWidth })), listTop: box?.top ?? null, listBottom: box?.bottom ?? null,
      viewport: innerHeight, pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }
  })()`)
  assert(sample.rows.length >= 2, 'Project list first screen must show seeded projects.')
  assert(sample.rows.some((row) => row.name === AUTHOR_LONG_PROJECT_NAME), 'Long project name is missing from the first project list.')
  assert(sample.listTop >= 0 && sample.listTop < sample.viewport, 'Project list is not visible in the first screen.')
  assert(sample.pageWidth <= sample.viewportWidth + 1, 'Home has horizontal overflow.')
  assert(sample.rows.every((row) => row.scrollWidth <= row.clientWidth + 1), 'Project row content overflows its box.')
  const contrast = await evaluate(client, contrastInspectionExpression())
  for (const key of ['homeSearch', 'homeSearchPlaceholder', 'homeCreate', 'homeImport']) {
    assert(!contrast[key].missing && contrast[key].ratio >= 4.5, `Home contrast ${key}: ${j(contrast[key])}`)
  }
  sample.contrast = contrast
  result.samples.push({ page: 'home-first-screen', ...sample })
  await screenshot(client, screenshotName)
  result.checks.push('首屏优先展示现有项目列表，超长项目名可见且不产生横向溢出。')
}

async function exerciseHome(client) {
  await assertHome(client)
  const search = homeSearch()
  assert(await evaluate(client, `Boolean(${search})`), `Missing Home search selector: ${HOME_SELECTORS.search}`)
  await fillText(client, search, '不存在的隔离搜索词')
  await ready(client, `document.querySelectorAll(${json(HOME_SELECTORS.projectRows)}).length === 0`)
  assert(await evaluate(client, `document.querySelector('.home-empty')?.textContent.includes('没有匹配的项目')`), 'Empty project search did not produce an empty result.')
  await fillText(client, search, '')
  await ready(client, `document.querySelectorAll(${json(HOME_SELECTORS.projectRows)}).length >= 2`)
  result.checks.push('项目搜索的空结果和清空恢复可用。')

  const toggle = firstSelector([HOME_SELECTORS.newProjectToggle])
  assert(await evaluate(client, `Boolean(${toggle})`), `Missing Home new-project toggle selector: ${HOME_SELECTORS.newProjectToggle}`)
  await click(client, toggle)
  const form = homeNewProjectForm()
  await ready(client, `Boolean(${form}) && (${form}).offsetParent !== null`)
  const createName = '隔离新建项目'
  const createNameField = fieldByLabel('项目名（必填）', form)
  await fillText(client, createNameField, createName)
  await click(client, saveButton(form))
  await ready(client, `document.querySelector('.dashboard-view')`)
  await returnHome(client)
  assert(await evaluate(client, `Boolean([...document.querySelectorAll(${json(HOME_SELECTORS.projectRows)})].find((row) => row.querySelector('h3')?.textContent.trim() === ${json(createName)}))`), 'Normal new-project save did not create the project.')
  result.checks.push('新建表单可填写并通过真实隔离 SQLite 保存，成功后进入工作台。')

  const longRow = projectRowByName(AUTHOR_LONG_PROJECT_NAME)
  await click(client, `(${longRow}).querySelector('button[title="编辑项目资料"]')`)
  const editForm = `document.querySelector(${json(HOME_SELECTORS.editForm)})`
  await ready(client, `Boolean(${editForm})`)
  const editedName = '钟楼来信与账簿的编辑验证项目'
  const editNameField = fieldByLabel('项目名（必填）', editForm)
  await fillText(client, editNameField, editedName)
  await click(client, saveButton(editForm))
  await ready(client, `Boolean(${projectRowByName(editedName)})`)
  result.checks.push('现有项目编辑正常写回；保存失败与输入保留由专项行为测试覆盖，不修改冻结 preload API。')
  await screenshot(client, 'home-create-edit-retention')
  await click(client, buttonWithText(['进入'], projectRowByName(editedName)))
  await ready(client, `document.querySelector('.dashboard-view')`)
}

async function assertPromptTabs(client) {
  const state = await evaluate(client, `(() => {
    const list = document.querySelector(${json(PROMPT_SELECTORS.tablist)})
    const tabs = [...(list?.querySelectorAll('[role="tab"]') || [])]
    const panels = ${json(Object.values(PROMPT_PANEL_IDS))}.map((id) => document.getElementById(id))
    return { tablist: Boolean(list), tabs: tabs.map((tab) => ({ id: tab.id, label: tab.textContent.trim(), selected: tab.getAttribute('aria-selected') })),
      panels: panels.map((panel) => ({ id: panel?.id, mounted: Boolean(panel), hidden: panel?.hidden ?? null })),
      editor: Boolean(document.querySelector(${json(PROMPT_SELECTORS.textarea)})) }
  })()`)
  assert(state.tablist, `Missing ${PROMPT_SELECTORS.tablist}`)
  assert.deepEqual(state.tabs.map((tab) => [tab.id, tab.label]), Object.entries(PROMPT_TAB_IDS).map(([key, id]) => [id, PROMPT_TAB_LABELS[key]]))
  assert.deepEqual(state.panels.map((panel) => [panel.id, panel.mounted]), Object.values(PROMPT_PANEL_IDS).map((id) => [id, true]))
  assert(state.editor, `Missing ${PROMPT_SELECTORS.textarea}`)
  return state
}

async function switchPromptTab(client, key) {
  await click(client, `document.getElementById(${json(PROMPT_TAB_IDS[key])})`)
  await ready(client, `document.getElementById(${json(PROMPT_TAB_IDS[key])})?.getAttribute('aria-selected') === 'true' && document.getElementById(${json(PROMPT_PANEL_IDS[key])})?.hidden === false`)
}

async function exercisePrompt(client) {
  await click(client, buttonWithText(['Prompt 构建器'], 'document.querySelector(".nav-list")'))
  await ready(client, `document.querySelector(${json(PROMPT_SELECTORS.root)})`)
  await assertPromptTabs(client)
  await switchPromptTab(client, 'task')
  const taskValues = Object.fromEntries(TASK_FIELD_LABELS.map((label, index) => [label, `QA 任务字段 ${index + 1}`]))
  for (const [label, value] of Object.entries(taskValues)) await fillText(client, fieldByLabel(label, `document.getElementById(${json(PROMPT_PANEL_IDS.task)})`), value)
  const buildButton = buttonWithText(['构建 Prompt'], `document.querySelector(${json(PROMPT_SELECTORS.commandBar)})`)
  assert(await evaluate(client, `Boolean(${buildButton})`), 'Missing Prompt build button in .prompt-command-bar.')
  await click(client, buildButton)
  await ready(client, `document.getElementById(${json(PROMPT_TAB_IDS.editor)})?.getAttribute('aria-selected') === 'true' && document.querySelector(${json(PROMPT_SELECTORS.textarea)})?.value.trim().length > 0`)
  const builtPrompt = await evaluate(client, `document.querySelector(${json(PROMPT_SELECTORS.textarea)})?.value`)
  assert(builtPrompt.includes(taskValues['本章目标']), 'Built Prompt does not contain the edited task field.')
  result.checks.push('任务九字段可编辑，构建按钮成功后自动切换到 Prompt 页。')

  const editedPrompt = `${builtPrompt}\n\nQA 编辑保留标记`
  await fillText(client, `document.querySelector(${json(PROMPT_SELECTORS.textarea)})`, editedPrompt)
  for (const key of ['task', 'context', 'history', 'editor']) await switchPromptTab(client, key)
  assert.equal(await evaluate(client, `document.querySelector(${json(PROMPT_SELECTORS.textarea)})?.value`), editedPrompt)
  result.checks.push('编辑 Prompt 后切换任务/上下文/历史并返回，文本未丢失。')
  await click(client, buildButton)
  await ready(client, 'document.querySelector(".confirm-dialog")')
  await click(client, buttonWithText(['取消'], 'document.querySelector(".confirm-dialog")'))
  await ready(client, '!document.querySelector(".confirm-dialog")')
  await evaluate(client, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  assert.equal(await evaluate(client, `document.querySelector(${json(PROMPT_SELECTORS.textarea)}).value`), editedPrompt)
  await evaluate(client, `document.getElementById(${json(PROMPT_TAB_IDS.editor)}).focus()`)
  for (const [key, code, expected] of [['End', 35, 'history'], ['Home', 36, 'task'], ['ArrowRight', 39, 'editor']]) {
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code })
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code })
    await ready(client, `document.activeElement?.id === ${json(PROMPT_TAB_IDS[expected])} && document.activeElement?.getAttribute('aria-selected') === 'true'`)
  }
  result.checks.push('手动 Prompt 重建前可取消并保留文本；真实键盘 Home/End/方向键切换焦点和页签。')

  const targetField = fieldByLabel('准备写第 N 章', 'document.querySelector(".prompt-controls")')
  const originalTarget = Number(await evaluate(client, `(${targetField}).value`))
  await fillText(client, targetField, String(originalTarget + 1))
  await click(client, buttonWithText(['保存快照'], 'document.querySelector(".prompt-command-bar")'))
  await ready(client, `document.querySelector('.prompt-workspace-message')?.textContent.includes('快照已保存')`)
  const savedSnapshot = await evaluate(client, 'window.novelDirector.data.load().then(r => r.data.promptContextSnapshots[0])')
  assert.equal(savedSnapshot.targetChapterOrder, originalTarget)
  assert.equal(savedSnapshot.chapterTask.goal, taskValues['本章目标'])
  assert(savedSnapshot.finalPrompt.includes('QA 编辑保留标记'))
  result.checks.push('实际保存快照保留文本绑定的章节与任务，不把新配置元数据拼到旧 Prompt 上。')

  for (const theme of ['light', 'dark']) {
    await evaluate(client, `document.documentElement.dataset.theme=${json(theme)}`)
    await switchPromptTab(client, 'editor')
    await evaluate(client, `document.querySelector(${json(PROMPT_SELECTORS.textarea)})?.scrollIntoView({ block: 'center', inline: 'nearest' })`)
    await evaluate(client, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await evaluate(client, 'Promise.allSettled(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished))')
    const contrast = await evaluate(client, contrastInspectionExpression())
    assert(!contrast.textarea.missing && !contrast.header.missing, `Prompt contrast target missing in ${theme} theme.`)
    assert.equal(contrast.header.position, 'sticky', `Prompt command bar is not sticky in ${theme} theme.`)
    assert(contrast.textarea.ratio >= 4.5, `Prompt textarea contrast is too low in ${theme}: ${j(contrast.textarea)}`)
    assert(contrast.header.ratio >= 4.5, `Prompt sticky header contrast is too low in ${theme}: ${j(contrast.header)}`)
    assert(contrast.textarea.rect.top >= 0 && contrast.textarea.rect.bottom <= 900, `Prompt editor was not revealed in ${theme} theme.`)
    result.samples.push({ page: 'prompt-editor', theme, contrast })
    await screenshot(client, `prompt-editor-${theme}`)
  }
  result.checks.push('浅色/深色主题使用真实 computed color 检查 Prompt textarea 与 sticky header 对比度。')

  for (const width of [1440, 1024, 800]) {
    for (const zoom of [1, 1.25]) {
      await setViewport(client, width, zoom)
      const layout = await evaluate(client, `(() => { const root = document.querySelector(${json(PROMPT_SELECTORS.root)}); const bar = document.querySelector(${json(PROMPT_SELECTORS.commandBar)}); const editor = document.querySelector(${json(PROMPT_SELECTORS.textarea)}); return { width: innerWidth, zoom: document.documentElement.style.zoom || '1', scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, root: root?.getBoundingClientRect().toJSON(), bar: bar?.getBoundingClientRect().toJSON(), editor: editor?.getBoundingClientRect().toJSON() } })()`)
      assert(layout.scrollWidth <= layout.clientWidth + 1, `Prompt layout overflows at ${width}px/${zoom * 100}%.`)
      assert(layout.editor?.width > 0 && layout.bar?.width > 0, `Prompt layout collapsed at ${width}px/${zoom * 100}%.`)
      result.samples.push({ page: 'prompt-reflow', ...layout })
      if (zoom === 1) await screenshot(client, `prompt-reflow-${width}`)
    }
  }
  await evaluate(client, 'document.documentElement.style.zoom=""')
  result.checks.push('Prompt 工作区在 800/1024/1440px 与 125% zoom 下无横向溢出并保持编辑区可见。')
}

try {
  await targetIdentity(root, target)
  await prepareTarget(root, target, work)
  const domain = await loadAuthorWorkspaceFixtureDomain()
  const fixture = createAuthorWorkspaceFixture(domain)
  const profile = join(work, 'profile')
  await mkdir(profile)
  await writeFile(join(profile, 'novel-director-data.json'), j(fixture))
  session = await launch(target, profile)
  await connect(session)
  const client = session.client
  await ready(client, `document.querySelector(${json(HOME_SELECTORS.root)})`)
  result.runtime = await evaluate(client, 'window.novelDirector.app.getRuntimeInfo()')
  verifyRuntimeIdentity(target, result.runtime, await evaluate(client, 'location.href'))
  for (const theme of ['light', 'dark']) {
    await evaluate(client, `document.documentElement.dataset.theme=${json(theme)}`)
    for (const width of [1440, 1024, 800]) {
      await setViewport(client, width)
      await assertHome(client, `home-${theme}-${width}`)
    }
  }
  await setViewport(client, 1440)
  await evaluate(client, 'document.documentElement.dataset.theme="light"')
  await exerciseHome(client)
  await exercisePrompt(client)
  const stored = await evaluate(client, 'window.novelDirector.data.load().then((result) => ({ path: result.storagePath, projects: result.data.projects.map((project) => project.name), hasApiKey: result.data.settings.hasApiKey, apiKey: result.data.settings.apiKey }))')
  assert(stored.path.startsWith(profile) && stored.path.endsWith('.sqlite'), 'Storage escaped the isolated author-workspace profile.')
  assert(!stored.hasApiKey && !stored.apiKey, 'Isolated fixture unexpectedly has a credential.')
  assert.deepEqual(session.networkRequests, [], `Unexpected network requests: ${j(session.networkRequests)}`)
  assert.deepEqual(session.exceptions, [])
  result.checks.push('零 AI/外网请求、隔离 SQLite、renderer 无异常。')
  result.status = 'passed'
} catch (error) {
  result.status = 'failed'
  result.error = error.stack
  process.exitCode = 1
} finally {
  result.cleanup = await cleanup(session)
  await writeFile(join(work, 'report.json'), j(result, null, 2))
  console.log(j({ status: result.status, error: result.error, work, screenshots: result.screenshots.length, checks: result.checks, cleanup: result.cleanup }, null, 2))
}

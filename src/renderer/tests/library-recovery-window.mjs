import assert from 'node:assert/strict'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { app, BrowserWindow, ipcMain } from 'electron'
import { normalizeAppData } from '../../shared/defaults'
import { IPC_CHANNELS as channels } from '../../shared/ipc/ipcChannels'
import { StorageRevisionConflictError } from '../../shared/storageRevisionConflict'

const labels = { retry: '重试', choose: '选择已有书库', restore: '从备份恢复到新文件', create: '新建书库' }
const original = '无法打开书库：Z:\\离线磁盘\\' + '长路径'.repeat(20) + '\\原库.sqlite\n磁盘未连接。'
const failure = (error) => ({ ok: false, code: 'LIBRARY_UNAVAILABLE', error })
const loads = [], actions = [], touches = [], imports = [], saves = [], unexpected = []
for (const channel of Object.values(channels)) {
  ipcMain.handle(channel, (_event, ...args) => {
    const records = channel === channels.STORAGE_GET ? loads : channel === channels.APP_RECOVER_LIBRARY ? actions
      : channel === channels.DATA_TOUCH_PROJECT ? touches : channel === channels.STORAGE_IMPORT ? imports
      : channel === channels.STORAGE_SAVE ? saves : null
    if (records) return new Promise((resolve) => records.push({ args, resolve }))
    unexpected.push(channel)
    return failure('测试不允许此操作。')
  })
}

async function until(read, description) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const result = await read()
    if (result) return result
    await delay(15)
  }
  throw new Error('Timed out: ' + description)
}

async function next(records, trigger) {
  const before = records.length
  await trigger()
  return until(() => records[before], 'IPC request')
}

async function verify() {
  let expectedError = original
  const win = new BrowserWindow({ show: false, width: 390, height: 800, useContentSize: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  const run = (code) => win.webContents.executeJavaScript(code)
  const restart = () => next(loads, () => win.loadFile(join(__dirname, 'index.html')))
  const press = (...names) => run(`for (const name of ${JSON.stringify(names)}) {
    [...document.querySelectorAll('button')].find(b => b.textContent.trim() === name).click()
  }`)
  const snapshot = () => run(`({
    error: document.querySelector('.library-recovery-error')?.textContent,
    feedback: document.querySelector('.library-recovery-feedback')?.textContent,
    buttons: [...document.querySelectorAll('button')].map(b => [b.textContent.trim(), b.disabled]),
    editor: Boolean(document.querySelector('.home, .app-shell, form, input, textarea, [contenteditable="true"]')),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  })`)
  async function recoveryPage(busy, feedback) {
    const state = await until(async () => {
      const s = await snapshot()
      return s.error && s.feedback.includes(feedback) && s.buttons.every(([, disabled]) => disabled === busy) && s
    }, 'recovery page: ' + feedback)
    assert.equal(state.error, expectedError)
    assert.deepEqual(state.buttons.map(([name]) => name), Object.values(labels))
    assert.equal(state.editor, false)
    assert.equal(state.overflow, false)
  }
  async function attempt(action, ...duplicates) {
    const request = await next(actions, () => press(labels[action], ...duplicates.map((key) => labels[key])))
    assert.deepEqual(request.args, [action])
    await recoveryPage(true, '')
    return request
  }

  const first = await restart()
  assert.deepEqual(first.args, [])
  assert.equal(await run("Boolean(document.querySelector('.loading-screen'))"), true)
  assert.deepEqual((await snapshot()).buttons, [])
  first.resolve(failure(original))
  await recoveryPage(false, '')
  assert.equal(loads.length, 1, 'StrictMode starts just one read')
  assert.equal(await run("window.novelDirector.app.recoverLibrary({ path: 'fixture.json' }).then(() => false, () => true)"), true)

  ;(await attempt('choose', 'choose', 'create')).resolve({ ok: true, cancelled: true })
  await recoveryPage(false, '已取消')
  ;(await attempt('restore')).resolve(failure('备份无法读取。'))
  await recoveryPage(false, '备份无法读取。')
  ;(await attempt('create')).resolve({ ok: true, cancelled: true })
  await recoveryPage(false, '已取消')
  assert.equal(loads.length, 1, 'cancelled and rejected actions never reload')
  assert.deepEqual(actions.map((call) => call.args), [['choose'], ['restore'], ['create']])

  const retry = await attempt('retry')
  const reread = await next(loads, () => retry.resolve({ ok: true }))
  await recoveryPage(true, '正在读取书库')
  reread.resolve(failure('无法打开书库：Z:\\测试\\另一文件.sqlite\n文件无法读取。'))
  await recoveryPage(false, '另一文件.sqlite')
  assert.equal(saves.length, 0)
  assert.deepEqual(unexpected, [], 'no second path lookup or other side effects')

  const choose = await attempt('choose')
  const opened = await next(loads, () => choose.resolve({ ok: true }))
  await recoveryPage(true, '正在读取书库')
  const book = { data: normalizeAppData({ projects: [{ id: 'fixture', name: '测试书稿' }],
    settings: { hasApiKey: true } }), storagePath: 'Z:\\测试\\选择的书库.json', revision: 'selected-revision' }
  opened.resolve(book)
  await until(() => run("document.querySelector('.home')?.textContent.includes('测试书稿')"), 'recovered project')
  const touch = await next(touches, () => press('进入'))
  assert.deepEqual(touch.args, [{ projectId: 'fixture', expectedStoragePath: book.storagePath, expectedRevision: book.revision }])
  const conflict = new StorageRevisionConflictError()
  touch.resolve({ ok: false, code: conflict.code, error: conflict.message })
  await until(() => run("Boolean(document.querySelector('.storage-conflict-notice'))"), 'revision conflict')
  await press('重新加载最新数据')
  await until(() => run("Boolean(document.querySelector('[role=dialog]'))"), 'confirm reload')
  const reload = await next(loads, () => press('重新加载'))
  await until(() => run("!document.querySelector('[role=dialog]')"), 'confirmation closed')
  await press('进入')
  await until(() => run("document.querySelector('.home')?.textContent.includes('正在打开...')"), 'queued save')
  expectedError = '无法打开书库：' + book.storagePath + '\n磁盘未连接。'
  reload.resolve(failure(expectedError))
  await recoveryPage(false, '')
  assert.equal(touches.length, 1, 'a touch queued behind the failed reload never reaches IPC')

  // A new renderer must perform its own read, even if an earlier recovery dialog completes late.
  const abandoned = await attempt('restore')
  const afterRestart = await restart()
  abandoned.resolve({ ok: true })
  afterRestart.resolve(failure(expectedError))
  await recoveryPage(false, '')
  const create = await attempt('create')
  const created = await next(loads, () => create.resolve({ ok: true }))
  await recoveryPage(true, '正在读取书库')
  created.resolve({ data: normalizeAppData({}), storagePath: 'Z:\\测试\\新书库.sqlite', revision: 'empty-revision' })
  await until(() => run("document.querySelector('.home')?.textContent.includes('还没有小说项目')"), 'genuinely empty library')
  ;(await restart()).resolve(book)
  await until(() => run("document.querySelector('.home')?.textContent.includes('测试书稿')"), 'ordinary startup')
  assert.equal(loads.length, 7, 'one fresh snapshot per open, none from the abandoned dialog')

  for (const action of ['retry', 'restore']) {
    ;(await restart()).resolve(failure(expectedError))
    await recoveryPage(false, '')
    const request = await attempt(action)
    const read = await next(loads, () => request.resolve({ ok: true }))
    const title = action === 'retry' ? '原盘书稿' : '备份书稿'
    read.resolve({ ...book, data: normalizeAppData({ projects: [{ id: 'again', name: title }] }),
      storagePath: action === 'retry' ? book.storagePath : 'Z:\\测试\\备份副本.sqlite', revision: action + '-revision' })
    await until(() => run(`document.querySelector('.home')?.textContent.includes(${JSON.stringify(title)})`), title)
  }
  assert.equal(loads.length, 11)
  assert.equal(saves.length, 0)
  assert.deepEqual(unexpected, [])

  const blocked = await next(imports, () => press('导入 JSON'))
  blocked.resolve({ canceled: false, mergeBlocked: true, revision: 'newer-agent-revision' })
  await until(() => run("document.querySelector('.home-operation-notice')?.textContent.includes('合并已停止')"), 'blocked import')
  assert.equal(touches.length, 1)
  const imported = await next(imports, () => press('导入 JSON'))
  assert.equal(imported.args[0].expectedRevision, 'restore-revision', 'a blocked import cannot adopt an unseen revision')
  const importPath = 'Z:\\测试\\备份副本.sqlite'
  const importedData = { ...book.data, projects: [...book.data.projects, { ...book.data.projects[0], id: 'second', name: '导入样书' }] }
  const afterImport = await next(touches, () => imported.resolve({ storagePath: importPath, canceled: false, revision: 'imported',
    importedProjectIds: ['second'], data: importedData }))
  assert.deepEqual(afterImport.args, [{ projectId: 'second', expectedStoragePath: importPath, expectedRevision: 'imported' }])
  assert.equal(await run("Boolean(document.querySelector('.home'))"), true, 'navigation waits for persistence')
  afterImport.resolve({ ok: false, code: conflict.code, error: conflict.message })
  await until(() => run("document.querySelector('.home-operation-notice')?.textContent.includes('导入后的打开项目失败')"), 'import succeeded but open conflicted')
  await press('重新加载最新数据')
  await until(() => run("Boolean(document.querySelector('[role=dialog]'))"), 'confirm Agent reload')
  const agentReload = await next(loads, () => press('重新加载'))
  await until(() => run("!document.querySelector('[role=dialog]')"), 'reload pending')
  await run("[...document.querySelectorAll('.project-row')].find(r => r.querySelector('h3').textContent === '导入样书').querySelector('.primary-button').click()")
  await until(() => run("document.querySelector('.home')?.textContent.includes('正在打开...')"), 'touch queued behind Agent reload')
  assert.equal(touches.length, 2)
  const queued = await next(touches, () => agentReload.resolve({ storagePath: importPath, revision: 'agent-edit',
    data: { ...importedData, projects: importedData.projects.map(p => ({ ...p, description: 'Agent 已更新' })) } }))
  assert.deepEqual(queued.args, [{ projectId: 'second', expectedStoragePath: importPath, expectedRevision: 'agent-edit' }])
  const updatedAt = '2099-01-02T03:04:05.123Z'
  queued.resolve({ ok: true, storagePath: importPath, revision: 'touched', updatedAt, savedCollections: ['projects'] })
  await until(() => run("document.querySelector('.project-badge strong')?.textContent === '导入样书'"), 'entered imported project')
  await press('返回项目列表')
  await until(() => run("document.querySelector('.project-row h3')?.textContent === '导入样书'"), 'recently opened project first')
  await run("document.querySelector('.project-row [title=编辑项目资料]').click()")
  assert.equal(saves.length, 0, 'neither project open transmitted AppData')
  const save = await next(saves, () => press('保存资料'))
  assert.equal(save.args[0].expectedRevision, 'touched')
  assert.equal(save.args[0].data.projects.find(p => p.id === 'second').lastOpenedAt, updatedAt)
  assert(save.args[0].data.projects.every(p => p.description === 'Agent 已更新'))
  assert.equal(save.args[0].data.settings.hasApiKey, true)
  save.resolve({ ok: true, storagePath: importPath, revision: 'edited' })
  console.log('PASS library recovery: four actions, restart, revision conflicts, queued project open, import and credentials')
}

app.disableHardwareAcceleration()
app.whenReady().then(verify).then(() => app.exit(0), (error) => { console.error(error); app.exit(1) })

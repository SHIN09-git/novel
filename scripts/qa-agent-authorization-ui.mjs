#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'
import { withinDirectory } from './utils/qa-prose-first-workspaces.mjs'
import { CdpClient, evaluate, waitFor, freePort, discover, button, click, fill, reveal,
  launchElectron, closeElectron } from './utils/qa-agent-authorization-driver.mjs'

const root = repoRoot
const packaged = process.argv.includes('--packaged')
assert(process.argv.slice(2).every((arg) => arg === '--packaged'), 'Usage: node scripts/qa-agent-authorization-ui.mjs [--packaged]')
const output = join(root, 'tmp', 'visual-qa', packaged ? 'agent-authorizations-packaged' : 'agent-authorizations')
const panel = "document.querySelector('.agent-authorization-panel')"
const j = JSON.stringify
const projectId = 'qa-w08-agent-authorization'
const grantActions = ['edit_world', 'accept_high_risk_candidates', 'accept_unreviewed_draft', 'accept_draft', 'apply_revision']
const actionLabels = ['编辑世界观与长期设定', '接受高风险候选', '接受未经审阅草稿', '接受草稿', '应用修订', '管理章节', '编辑章节任务']
const executable = packaged
  ? join(root, 'release', 'win-unpacked', 'Novel Director.exe')
  : join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
const nativeBinding = join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
const result = {
  startedAt: new Date().toISOString(), status: 'running', checks: [], issues: [], screenshots: [], sessions: [],
  visualReview: { status: 'pending', note: 'Screenshots require manual inspection after each run.' },
  contract: {
    node: { executable: process.execPath, version: process.version, abi: process.versions.modules },
    electron: { executable, args: ['--remote-debugging-port=<ephemeral>', ...(packaged ? [] : [root])], packaged },
    profileEnvironment: 'NOVEL_DIRECTOR_SMOKE_USER_DATA',
    bridge: { list: 'window.novelDirector.agentAuthorization.list(projectId)',
      grant: 'window.novelDirector.agentAuthorization.grant({projectId, actions, chapterStart, chapterEnd})',
      revoke: 'window.novelDirector.agentAuthorization.revoke({projectId, grantId})' },
    service: { constructor: 'new AgentAuthorizationService(userDataPath)',
      grant: 'grant({storagePath, projectId, actions, chapterStart, chapterEnd})',
      revoke: 'revoke(id, storagePath, projectId)', authorityFile: 'agent-authorizations.json' },
    scope: 'main IPC binds the current database; renderer cannot choose the storage path',
    interaction: 'CDP native mouse/key events; direct IPC is used only for observation and negative cases',
    themes: 'System color-scheme emulation, no AppData settings edits',
    legacyBridge: 'Not exercised; the real Electron bridge is never replaced'
  }
}
let profile, runtimeRoot = root, server, client, browser, child, logs = [], processIds = [], requestCount = 0
const sha = (value) => createHash('sha256').update(value).digest('hex')
const ev = (expression) => evaluate(client, expression)
const until = (expression, timeout) => waitFor(client, expression, timeout)
const uiClick = (expression) => click(client, expression)
const byLabel = (label) => `[...${panel}.querySelectorAll('.agent-authorization-checkbox')].find(e => e.querySelector('span')?.textContent === ${j(label)})`

function check(name, condition, details = null) {
  result.checks.push({ name, passed: Boolean(condition), ...(details === null ? {} : { details }) })
  if (!condition) result.issues.push({ name, details })
}

async function screenshot(filename) {
  const image = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(output, filename), Buffer.from(image.data, 'base64'))
  result.screenshots.push(filename)
}

async function viewport(width, height, theme) {
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] })
  await delay(120)
  assert.equal(await ev('getComputedStyle(document.documentElement).colorScheme'), theme)
}

async function snapshot() {
  const loaded = await ev('window.novelDirector.data.load()')
  assert(loaded.storagePath.toLowerCase().endsWith('.sqlite'), `SQLite required: ${loaded.storagePath}`)
  assert(withinDirectory(await realpath(profile), await realpath(loaded.storagePath)), 'Database escaped isolated profile')
  assert(loaded.data.projects.every((project) => project.id.startsWith('qa-')))
  assert(!loaded.data.settings.apiKey && !loaded.data.settings.hasApiKey)
  const header = (await readFile(loaded.storagePath)).subarray(0, 16).toString()
  assert.equal(header, 'SQLite format 3\0')
  return { dataHash: sha(j(loaded.data)), revision: loaded.revision, storagePath: loaded.storagePath }
}

async function authority() {
  const path = join(profile, result.contract.service.authorityFile)
  if (!existsSync(path)) return { schemaVersion: 1, grants: [] }
  return JSON.parse(await readFile(path, 'utf8'))
}

async function assertUnchanged(before, label) {
  const after = await snapshot()
  check(label, before.dataHash === after.dataHash && before.revision === after.revision, { before, after })
}

async function enterAgent() {
  await until("Boolean(window.novelDirector?.agentAuthorization && [...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='进入'))", 30000)
  await snapshot()
  await uiClick(button('进入'))
  await until("Boolean(document.querySelector('.dashboard-view'))")
  await uiClick(button('Agent 批次'))
  await until(`${panel} && !${panel}.textContent.includes('正在读取...')`)
  if (await ev(`Boolean(${button('展开', panel)})`)) {
    if (!result.initialDisclosure) {
      result.initialDisclosure = 'collapsed'
      await viewport(1280, 720, 'light')
      await screenshot('00-initial-collapsed.png')
    }
    await uiClick(button('展开', panel))
    await until(`Boolean(${panel}.querySelector('.agent-authorization-body'))`)
  }
  await delay(200)
}

async function reloadAgent() {
  await client.send('Page.reload', { ignoreCache: true })
  await enterAgent()
}

async function confirmGrant(expectedActions, name) {
  const before = await snapshot()
  const count = (await authority()).grants.length
  await uiClick(button('授予授权', panel))
  await until("Boolean(document.querySelector('.confirm-dialog'))")
  check(`${name}: no write before confirmation`, (await authority()).grants.length === count)
  check(`${name}: cancel focused`, await ev("document.activeElement?.textContent.trim() === '取消'"))
  const text = await ev("document.querySelector('.confirm-dialog-message').textContent")
  check(`${name}: confirmation lists chosen actions`, expectedActions.every((label) => text.includes(label)), { text })
  await screenshot(`${name}-confirm.png`)
  await uiClick(button('授予授权', "document.querySelector('.confirm-dialog')"))
  await until(`${panel}.textContent.includes('项目授权已授予。') && !document.querySelector('.confirm-dialog')`)
  await until(`${panel}.querySelectorAll('.agent-authorization-row').length === ${count + 1}`)
  await assertUnchanged(before, `${name}: authorization does not change AppData/revision`)
  return (await authority()).grants.at(-1)
}

async function inspectLayout(label, container = '.agent-authorization-panel') {
  const sample = await ev(`(() => {
    const root = document.querySelector(${j(container)}), problems = [];
    const els = [root,...root.querySelectorAll('button,input,label,p,strong,small')];
    for (const e of els) {
      const r=e.getBoundingClientRect(); if(!r.width||!r.height) continue;
      if(e.scrollWidth>e.clientWidth+2 && e.clientWidth>0 && !['INPUT'].includes(e.tagName))
        problems.push({kind:'horizontal-clipping',tag:e.tagName,text:e.textContent.slice(0,100),width:e.clientWidth,scroll:e.scrollWidth});
      if(r.top<0||r.bottom>innerHeight||r.left<0||r.right>innerWidth) continue;
      if(['BUTTON','INPUT'].includes(e.tagName)) {
        const h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        if(!h || !(h===e||e.contains(h))) problems.push({kind:'occluded',tag:e.tagName,text:e.textContent.slice(0,80)});
      }
    }
    return {width:innerWidth,height:innerHeight,theme:getComputedStyle(document.documentElement).colorScheme,
      documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,problems};
  })()`)
  check(`${label}: no clipping or key-control obstruction`, sample.documentWidth <= sample.width && sample.bodyWidth <= sample.width && !sample.problems.length, sample)
}

async function layoutMatrix() {
  for (const theme of ['light', 'dark']) {
    for (const [width, height] of [[1280, 720], [1024, 768]]) {
      const name = `${theme}-${width}x${height}`
      await viewport(width, height, theme)
      await reveal(client, `${panel}.querySelector('.agent-authorization-header')`)
      await screenshot(`layout-${name}-top.png`)
      await inspectLayout(`${name} top`)
      await reveal(client, `${panel}.querySelector('.agent-authorization-submit')`)
      await screenshot(`layout-${name}-actions.png`)
      await inspectLayout(`${name} actions`)
      const contrast = await ev(`(() => {
        const e = document.querySelector('.agent-connect-strip > button'), css = getComputedStyle(e);
        const luminance = value => {
          const rgb = value.match(/[\\d.]+/g).slice(0,3).map(Number).map(n => {
            const x=n/255; return x<=0.04045 ? x/12.92 : ((x+0.055)/1.055)**2.4;
          });
          return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
        };
        const a=luminance(css.color), b=luminance(css.backgroundColor);
        return {ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05),whiteSpace:css.whiteSpace};
      })()`)
      check(`${name}: connection button is legible and single-line`, contrast.ratio >= 4.5 && contrast.whiteSpace === 'nowrap', contrast)
      // Verify that every control can be scrolled into view and hit-tested.
      for (let index = 0; index < 7; index++) {
        const expr = `${panel}.querySelectorAll('.agent-authorization-checkbox')[${index}]`
        await reveal(client, expr)
        assert(await ev(`(() => {const e=${expr},r=e.getBoundingClientRect();
          const h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e.contains(h)||h===e})()`))
      }
    }
  }
  await viewport(1280, 720, 'light')
}

async function negativeCase(name, expression, extra = {}) {
  const before = await snapshot(), raw = j(await authority())
  const response = await ev(`(async () => {try {return {rejected:false,value:await (${expression})}}
    catch(error){return {rejected:true,message:error.message,code:error.code??null}}})()`)
  const unchanged = j(await authority()) === raw
  check(name, response.rejected && unchanged, { ...extra, response, authorityUnchanged: unchanged })
  await assertUnchanged(before, `${name}: AppData unchanged`)
  return response
}

async function writeExternalHandoff(marker) {
  const storagePath = (await snapshot()).storagePath
  const outfile = join(output, 'external-handoff-writer.mjs')
  // This worker is outside the Electron runtime copy, so module resolution keeps
  // using the unchanged Node binding. Only the isolated, existing SQLite is writable.
  await build({ stdin: { resolveDir: root, contents: `
    import assert from 'node:assert/strict';
    import { realpath, readFile } from 'node:fs/promises';
    import { relative, isAbsolute, sep } from 'node:path';
    import { SqliteStorageService } from './src/storage/SqliteStorageService';
    const input = JSON.parse(process.argv[2]);
    const runs = await realpath(input.runs), profile = await realpath(input.profile), path = await realpath(input.storagePath);
    const within = (parent, child) => { const p = relative(parent, child); return p && !isAbsolute(p) && p !== '..' && !p.startsWith('..' + sep) };
    assert(within(runs, profile) && within(profile, path), 'External writer escaped the QA profile');
    assert.equal((await readFile(path)).subarray(0,16).toString(), 'SQLite format 3\\0');
    const storage = new SqliteStorageService(path);
    try {
      const current = await storage.loadSnapshot();
      assert(current.data.projects.length && current.data.projects.every(p => p.id.startsWith('qa-')));
      assert(!current.data.settings.apiKey && !current.data.settings.hasApiKey);
      assert(current.data.projects.some(p => p.id === input.projectId));
      const at = new Date().toISOString();
      const run = { id:'qa-w08-external-handoff', projectId:input.projectId, goal:input.marker,
        mode:'single_chapter', safetyMode:'conservative', targetChapterOrders:[3], status:'paused',
        createdJobIds:[], createdDraftIds:[], createdCommitIds:[], pendingHumanReviewItemIds:[],
        decisions:[], summary:input.marker, warnings:[], startedAt:at, updatedAt:at, completedAt:null, schemaVersion:1 };
      const next = { ...current.data, agentRuns:[...current.data.agentRuns.filter(r=>r.id!==run.id),run] };
      const saved = await storage.saveIfCurrent(next, current.revision);
      console.log(JSON.stringify({ pid:process.pid, node:process.version, abi:process.versions.modules,
        storagePath:path, beforeRevision:current.revision, afterRevision:saved.revision, runId:run.id, marker:input.marker }));
    } finally { storage.close(); }
  ` }, outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
    external: ['better-sqlite3'] })
  const input = { runs: join(output, 'runs'), profile, storagePath, projectId, marker }
  const worker = spawn(process.execPath, [outfile, j(input)], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  worker.stdout.on('data', (chunk) => { stdout += chunk })
  worker.stderr.on('data', (chunk) => { stderr += chunk })
  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => worker.kill(), 15000)
    worker.once('error', (error) => { clearTimeout(timer); resolve({ error }) })
    worker.once('exit', (code) => { clearTimeout(timer); resolve({ code }) })
  })
  assert.equal(outcome.error, undefined)
  assert.equal(outcome.code, 0, stderr)
  return JSON.parse(stdout.trim())
}

async function runExplicitHandoffQA() {
  const refreshButton = button('读取最新结果', "document.querySelector('.agent-runs-view')")
  assert(await ev(`Boolean(${refreshButton})`), 'The new explicit Agent result refresh button has not been implemented/built yet')
  await viewport(1280, 720, 'light')
  await uiClick(byLabel('编辑章节任务'))
  await uiClick(`[...${panel}.querySelectorAll('.agent-authorization-scope label')].find(e=>e.textContent.trim()==='指定范围')`)
  const start = `${panel}.querySelectorAll('input[type=number]')[0]`
  const end = `${panel}.querySelectorAll('input[type=number]')[1]`
  await fill(client, start, '3')
  await fill(client, end, '7')
  const formSnapshot = () => ev(`({selected:[...${panel}.querySelectorAll('input[type=checkbox]')].map(e=>e.checked),
    ranges:[...${panel}.querySelectorAll('input[type=number]')].map(e=>e.value),
    scope:[...${panel}.querySelectorAll('input[type=radio]')].map(e=>e.checked)})`)
  const beforeForm = await formSnapshot()
  const marker = 'QA W08 外部结果等待作者主动读取'
  result.handoff = { worker: await writeExternalHandoff(marker), marker,
    scope: 'Synthetic run metadata written by an independent Node process through the real SQLite service; no AI or formal prose acceptance.' }
  const externalSnapshot = await snapshot()
  await delay(700)
  check('external result does not automatically refresh the Agent page', await ev(`!document.querySelector('.agent-runs-view').textContent.includes(${j(marker)})`))
  check('external write preserves the dirty authorization form', j(beforeForm) === j(await formSnapshot()))
  await reveal(client, `${panel}.querySelector('.agent-authorization-range')`)
  await screenshot('10-handoff-dirty-form-before-refresh.png')
  const created = await confirmGrant(['编辑章节任务'], '11-handoff-grant')
  check('grant after an external write does not replace the UI AppData', await ev(`!document.querySelector('.agent-runs-view').textContent.includes(${j(marker)})`))
  await assertUnchanged(externalSnapshot, 'grant does not overwrite the externally saved run')
  await uiClick(byLabel('管理章节'))
  const dirtyAtRefresh = await formSnapshot()
  await uiClick(refreshButton)
  await until("Boolean(document.querySelector('.confirm-dialog'))")
  const notice = await ev("document.querySelector('.confirm-dialog-message').textContent")
  check('explicit refresh warns about unsaved text', /尚未保存|未保存/.test(notice), { notice })
  await screenshot('12-handoff-refresh-confirm.png')
  await uiClick(button('稍后处理', "document.querySelector('.confirm-dialog')"))
  check('canceling refresh preserves the dirty form and stale UI', j(dirtyAtRefresh) === j(await formSnapshot()) &&
    await ev(`!document.querySelector('.agent-runs-view').textContent.includes(${j(marker)})`))
  await uiClick(refreshButton)
  await until("Boolean(document.querySelector('.confirm-dialog'))")
  await uiClick(button('重新加载', "document.querySelector('.confirm-dialog')"))
  await until(`document.querySelector('.agent-run-list-item')?.textContent.includes(${j(marker)})`)
  check('confirmed explicit refresh exposes the external Agent result', await ev(`document.querySelector('.agent-runs-view').textContent.includes(${j(marker)})`))
  await assertUnchanged(externalSnapshot, 'explicit reload is read-only and keeps the external revision')
  check('confirmed context reload resets rather than silently saves the old grant form',
    await ev(`${panel}.querySelectorAll('input[type=checkbox]:checked').length === 0 && !${panel}.querySelector('input[type=number]')`))
  await reveal(client, "document.querySelector('.agent-run-list-item')")
  await screenshot('13-handoff-external-result-loaded.png')
  const latest = await ev(`window.novelDirector.agentAuthorization.list(${j(projectId)})`)
  assert(latest.some((grant) => grant.id === created.id && grant.status === 'active'))
  await uiClick(button('撤回', `${panel}.querySelector('.agent-authorization-row:not(.revoked)')`))
  await until("Boolean(document.querySelector('.confirm-dialog'))")
  await uiClick(button('撤回授权', "document.querySelector('.confirm-dialog')"))
  await until(`${panel}.querySelectorAll('.agent-authorization-row:not(.revoked)').length === 0`)
  check('revoke keeps the currently loaded result visible', await ev(`document.querySelector('.agent-run-list-item')?.textContent.includes(${j(marker)})`))
  await assertUnchanged(externalSnapshot, 'revoke after handoff leaves AppData/revision unchanged')
  result.finalAuthority = await authority()
  result.finalStorage = await snapshot()
}

async function runWorkflow() {
  await enterAgent()
  result.runtimeInfo = await ev('window.novelDirector.app.getRuntimeInfo()')
  const staleSources = result.sourceFiles.filter((file) => file.file.startsWith('src/') &&
    Date.parse(file.modifiedAt) > Date.parse(result.runtimeInfo.buildTime))
  result.build = { command: packaged ? 'npm.cmd run dist:win' : 'npm.cmd run build', buildTime: result.runtimeInfo.buildTime,
    staleSources, currentAuthorizationSources: staleSources.length === 0 }
  assert.deepEqual(staleSources, [], 'Authorization sources changed after the build; rebuild before claiming current-source QA')
  if (packaged) {
    const manifest = JSON.parse(await readFile(join(root, 'release', 'BUILD_INFO.json'), 'utf8'))
    assert.equal(result.runtimeInfo.mode, 'packaged', 'Packaged QA must use the installed runtime path')
    assert.equal(resolve(result.runtimeInfo.execPath).toLowerCase(), resolve(executable).toLowerCase())
    assert.equal(result.runtimeInfo.version, manifest.version, 'Packaged runtime and release manifest differ')
    result.releaseManifest = manifest
  }
  result.isolatedStorage = await snapshot()
  await viewport(1280, 720, 'light')
  check('empty Agent page exposes authorization panel without a run', await ev("!document.querySelector('.agent-run-list-item')"))
  check('default no grants, no selected action, disabled grant',
    (await authority()).grants.length === 0 && await ev(`${panel}.querySelectorAll('input[type=checkbox]:checked').length === 0 && ${button('授予授权', panel)}.disabled`))
  check('list reads do not initialize authority file', !existsSync(join(profile, result.contract.service.authorityFile)))
  await screenshot('01-empty-light-1280x720.png')
  await uiClick(button('收起', panel))
  check('collapse hides form', await ev(`!${panel}.querySelector('.agent-authorization-body')`))
  await uiClick(button('展开', panel))
  for (const label of actionLabels.slice(0, 5)) {
    if (!await ev(`${byLabel(label)}.querySelector('input').checked`)) await uiClick(byLabel(label))
  }
  check('only five selected actions, all chapters default', await ev(`${panel}.querySelectorAll('input[type=checkbox]:checked').length === 5 && ${panel}.querySelector('input[type=radio]').checked`))
  // Cancellation is also a genuine UI action and must not issue authority.
  await uiClick(button('授予授权', panel))
  await until("Boolean(document.querySelector('.confirm-dialog'))")
  await uiClick(button('取消', "document.querySelector('.confirm-dialog')"))
  check('cancel issues no authorization', (await authority()).grants.length === 0)
  const world = await confirmGrant(actionLabels.slice(0, 5), '02-project-wide')
  check('main IPC stores exact actions, project, trusted path and user provenance',
    j(world.actions) === j(grantActions) && world.projectId === projectId &&
    world.storagePath.toLowerCase() === result.isolatedStorage.storagePath.toLowerCase() &&
    world.chapterStart === null && world.chapterEnd === null && world.grantedBy === 'user' && world.status === 'active', world)
  await reloadAgent()
  check('grant persists across renderer refresh', await ev(`${panel}.querySelectorAll('.agent-authorization-row:not(.revoked)').length === 1`))
  await layoutMatrix()
  await uiClick(byLabel('接受高风险候选'))
  await uiClick(`[...${panel}.querySelectorAll('.agent-authorization-scope label')].find(e=>e.textContent.trim()==='指定范围')`)
  const start = `${panel}.querySelectorAll('input[type=number]')[0]`
  const end = `${panel}.querySelectorAll('input[type=number]')[1]`
  await fill(client, start, '8')
  await fill(client, end, '3')
  const beforeInvalid = j(await authority())
  await uiClick(button('授予授权', panel))
  await until(`${panel}.querySelector('.notice.danger')?.textContent.includes('起始章不能大于结束章')`)
  check('reversed range shows UI error without confirmation or write',
    j(await authority()) === beforeInvalid && await ev("!document.querySelector('.confirm-dialog')"))
  await reveal(client, `${panel}.querySelector('.notice.danger')`)
  await screenshot('03-invalid-range.png')
  await fill(client, start, '2')
  await fill(client, end, '4')
  const ranged = await confirmGrant(['接受高风险候选'], '04-ranged')
  check('range grant persists exact 2..4 and selected action', ranged.chapterStart === 2 && ranged.chapterEnd === 4 && j(ranged.actions) === j(['accept_high_risk_candidates']), ranged)
  await reloadAgent()
  check('range label survives refresh', await ev(`${panel}.textContent.includes('第 2-4 章')`))
  await viewport(1024, 768, 'dark')
  await reveal(client, `${panel}.querySelector('.agent-authorization-list')`)
  await screenshot('05-grants-dark-1024x768.png')
  const beforeRevoke = await snapshot()
  await uiClick(button('撤回', `[...${panel}.querySelectorAll('.agent-authorization-row')].find(e=>e.querySelector('strong').textContent==='第 2-4 章')`))
  await until("Boolean(document.querySelector('.confirm-dialog'))")
  await inspectLayout('dark 1024x768 revoke confirmation', '.confirm-dialog')
  await screenshot('06-revoke-confirm-dark.png')
  await uiClick(button('撤回授权', "document.querySelector('.confirm-dialog')"))
  await until(`${panel}.querySelectorAll('.agent-authorization-row.revoked').length === 1`)
  await assertUnchanged(beforeRevoke, 'revoke does not change AppData/revision')
  await reloadAgent()
  check('revocation survives refresh and retains other active grant',
    await ev(`${panel}.querySelectorAll('.agent-authorization-row.revoked').length===1 && ${panel}.querySelectorAll('.agent-authorization-row:not(.revoked)').length===1`))
  await reveal(client, `${panel}.querySelector('.agent-authorization-list')`)
  await screenshot('07-revoked-reloaded.png')
  await negativeCase('nonexistent project grant is rejected', `window.novelDirector.agentAuthorization.grant(${j({ projectId: 'qa-missing-project', actions: ['edit_world'], chapterStart: null, chapterEnd: null })})`)
  await negativeCase('nonexistent project revoke is rejected', `window.novelDirector.agentAuthorization.revoke(${j({ projectId: 'qa-missing-project', grantId: world.id })})`)
  const fakeStoragePath = join(profile, 'never-created-fake.sqlite')
  await negativeCase('forged storagePath is explicitly rejected', `window.novelDirector.agentAuthorization.grant(${j({ projectId, storagePath: fakeStoragePath, actions: ['edit_world'], chapterStart: null, chapterEnd: null })})`, { fakeStoragePath })
  check('forged storagePath does not create or redirect a database', !existsSync(fakeStoragePath))
  // Clean up any unexpectedly accepted negative-case grant through the UI too.
  await reloadAgent()
  const activeToRevoke = await ev(`${panel}.querySelectorAll('.agent-authorization-row:not(.revoked)').length`)
  for (let remaining = activeToRevoke; remaining > 0; remaining--) {
    await uiClick(button('撤回', `${panel}.querySelector('.agent-authorization-row:not(.revoked)')`))
    await until("Boolean(document.querySelector('.confirm-dialog'))")
    await uiClick(button('撤回授权', "document.querySelector('.confirm-dialog')"))
    await until("!document.querySelector('.confirm-dialog')")
    await until(`${panel}.querySelectorAll('.agent-authorization-row:not(.revoked)').length === ${remaining - 1}`)
  }
  await reloadAgent()
  check('final refresh has no active grants', (await authority()).grants.every((grant) => grant.status === 'revoked'))
  await reveal(client, `${panel}.querySelector('.agent-authorization-list')`)
  await screenshot('08-all-revoked.png')
  result.finalAuthority = await authority()
  result.finalStorage = await snapshot()
}

async function startSession() {
  const port = await freePort()
  const launched = launchElectron(executable, [`--remote-debugging-port=${port}`, ...(packaged ? [] : [runtimeRoot])], runtimeRoot, profile)
  child = launched.child; logs = launched.logs
  const endpoints = await discover(port, child)
  client = new CdpClient(endpoints.renderer.webSocketDebuggerUrl)
  browser = new CdpClient(endpoints.version.webSocketDebuggerUrl)
  await client.open(); await browser.open()
  processIds = (await browser.send('SystemInfo.getProcessInfo')).processInfo.map((p) => p.id)
  result.sessions.push({ pid: child.pid, port, processIds, version: endpoints.version.Browser })
  await client.send('Runtime.enable'); await client.send('Page.enable')
  const exceptions = []
  client.onEvent = (event) => { if (event.method === 'Runtime.exceptionThrown') exceptions.push(event.params.exceptionDetails) }
  result.sessions.at(-1).rendererExceptions = exceptions
}

async function main() {
  assert(withinDirectory(join(root, 'tmp'), output))
  await mkdir(join(output, 'runs'), { recursive: true })
  profile = await mkdtemp(join(output, 'runs', 'profile-'))
  assert(withinDirectory(await realpath(join(root, 'tmp')), await realpath(profile)))
  result.contract.profile = profile
  result.contract.database = join(profile, 'novel-director-data.sqlite')
  result.contract.authorityPath = join(profile, result.contract.service.authorityFile)
  result.nativeBindingBefore = sha(await readFile(nativeBinding))
  // Reuse manage-sqlite-native.mjs's packaged Electron fallback source, but only
  // in this isolated app copy. Never swap/rebuild the repository's Node binding.
  if (process.platform === 'win32' && !packaged) {
    const fallback = join(root, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked',
      'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
    assert(existsSync(fallback), 'Existing Electron binding required; this QA never downloads or rebuilds native modules')
    runtimeRoot = await mkdtemp(join(output, 'runs', 'runtime-'))
    await cp(join(root, 'out'), join(runtimeRoot, 'out'), { recursive: true })
    await copyFile(join(root, 'package.json'), join(runtimeRoot, 'package.json'))
    const sqlite = join(runtimeRoot, 'node_modules', 'better-sqlite3')
    await mkdir(join(sqlite, 'build', 'Release'), { recursive: true })
    await cp(join(root, 'node_modules', 'better-sqlite3', 'lib'), join(sqlite, 'lib'), { recursive: true })
    await copyFile(join(root, 'node_modules', 'better-sqlite3', 'package.json'), join(sqlite, 'package.json'))
    await copyFile(fallback, join(sqlite, 'build', 'Release', 'better_sqlite3.node'))
    result.nativeRuntime = { root: runtimeRoot, bindingSource: fallback, sha256: sha(await readFile(fallback)),
      mode: 'Existing packaged Electron binding in temporary current-build copy; repository binding untouched' }
    result.contract.electron.args = ['--remote-debugging-port=<ephemeral>', runtimeRoot]
    assert.equal(sha(await readFile(join(root, 'out', 'main', 'index.js'))), sha(await readFile(join(runtimeRoot, 'out', 'main', 'index.js'))))
  }
  result.sourceFiles = []
  for (const file of ['src/main/services/AgentAuthorizationService.ts', 'src/main/ipc/agentAuthorizationIpcHandlers.ts',
    'src/preload/index.ts', 'src/renderer/src/views/agent/AgentProjectAuthorizationPanel.tsx',
    'src/renderer/src/App.tsx', 'src/renderer/src/views/AgentRunsView.tsx', 'src/renderer/src/hooks/useAppData.ts',
    'src/renderer/src/styles/views/agent.css', 'out/main/index.js', 'out/preload/index.cjs']) {
    result.sourceFiles.push({ file, sha256: sha(await readFile(join(root, file))), modifiedAt: (await stat(join(root, file))).mtime.toISOString() })
  }
  server = createServer((req, res) => { requestCount++; res.writeHead(403); res.end('QA forbids AI requests') })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  result.noPaidAi = { baseUrl, apiKey: 'empty', autoSummary: false, chapterDiagnostics: false }
  const at = '2026-09-07T00:00:00.000Z'
  const model = { apiProvider: 'local', apiKey: '', hasApiKey: false, baseUrl, modelName: 'qa-reject-only',
    codexCliPath: '', codexCliModel: '', temperature: 0, maxTokens: 256, retryEnabled: false, maxRetries: 0, requestTimeoutMs: 1000 }
  const fixture = { schemaVersion: 3, projects: [{ id: projectId, name: 'W08 项目授权隔离验收', genre: '悬疑',
    description: '无真实小说、无付费 AI 的授权面板 QA。', targetReaders: '', coreAppeal: '', style: '', createdAt: at, updatedAt: at }],
    chapters: [], agentRuns: [], agentActionPreviews: [], settings: { ...model,
      pipelineModelRoles: Object.fromEntries(['planner', 'prose', 'extraction', 'reviewer', 'revision'].map((role) => [role, model])),
      enableAutoSummary: false, enableChapterDiagnostics: false, theme: 'system' } }
  await writeFile(join(profile, 'novel-director-data.json'), j(fixture))
  // Match the existing candidate UI suite: isolated legacy fixture -> Electron main migrates SQLite.
  await startSession()
  await runWorkflow()
  // A full Electron restart proves the grants are not merely renderer memory.
  result.sessions.at(-1).cleanup = await closeElectron(child, client, browser, processIds)
  await writeFile(join(output, 'electron-session-1.log'), logs.join(''))
  child = client = browser = null
  await startSession()
  await enterAgent()
  check('full Electron restart retains revoked history and no active authority',
    (await authority()).grants.length >= 2 && await ev(`${panel}.querySelectorAll('.agent-authorization-row:not(.revoked)').length===0`))
  await viewport(1280, 720, 'light')
  await reveal(client, `${panel}.querySelector('.agent-authorization-list')`)
  await screenshot('09-restarted-history.png')
  await runExplicitHandoffQA()
}

try {
  await main()
} catch (error) {
  result.error = error.stack
  result.issues.push({ name: 'QA execution failed', details: error.message })
  if (client) {
    try {
      await screenshot('failure.png')
      result.failureDom = await ev('document.body.innerText')
    } catch { /* The renderer may already have exited. */ }
  }
} finally {
  if (child) {
    try {
      if (browser) {
        try {
          const latest = await browser.send('SystemInfo.getProcessInfo')
          processIds = [...new Set([...processIds, ...latest.processInfo.map((p) => p.id)])]
        } catch { /* Still run cleanup if the browser has already exited. */ }
      }
      const cleanup = await closeElectron(child, client, browser, processIds)
      if (result.sessions.length) result.sessions.at(-1).cleanup = cleanup
      else result.startupCleanup = cleanup
    } catch (error) { result.issues.push({ name: 'Electron cleanup failed', details: error.message }) }
  }
  if (server) await new Promise((done) => server.close(done))
  check('no AI HTTP requests', requestCount === 0, { requestCount })
  if (result.nativeBindingBefore) {
    result.nativeBindingAfter = sha(await readFile(nativeBinding))
    check('native binding unchanged', result.nativeBindingBefore === result.nativeBindingAfter)
  }
  result.status = result.issues.length ? 'failed' : 'passed'
  result.finishedAt = new Date().toISOString()
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'electron.log'), logs.join(''))
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ status: result.status, passed: result.checks.filter((c) => c.passed).length,
    checks: result.checks.length, issues: result.issues, output }, null, 2))
  if (result.status !== 'passed') process.exitCode = 1
}

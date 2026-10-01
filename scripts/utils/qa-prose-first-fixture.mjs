import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { open, realpath } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import { repoRoot } from './repo-root.mjs'
import { runProseFirstWorkspacesQA, withinDirectory, PROSE_WORKSPACES } from './qa-prose-first-workspaces.mjs'

export const PROSE_FIXTURE_IDS = Object.freeze({ projectId: 'qa-prose-project', chapterId: 'qa-prose-chapter',
  draftId: 'qa-prose-draft', jobId: 'qa-prose-job', planJobId: 'qa-prose-plan-job',
  sessionId: 'qa-prose-session', requestId: 'qa-prose-request', versionId: 'qa-prose-version' })
export const PROSE_PROJECT_NAME = 'W07 正文优先隔离验收'
export const PROSE_TEXT = Object.freeze({
  chapter: '林默把铜钥匙放在窗沿，先核对账簿上的日期。',
  draft: '走廊的灯亮起来时，林默已经翻到缺页的地方。',
  candidate: '林默翻到缺页处，把账簿向灯下挪了半寸。',
  plan: '核对钟楼账簿的缺页，保留寄信人的身份。',
  diagnosis: '核对叙述节奏，不改动既有事实。'
})
const at = '2026-09-07T00:00:00.000Z'
const j = JSON.stringify

export async function loadProseFixtureDomain() {
  const result = await build({ stdin: { contents: `export { draftContentHash } from './src/services/DraftDiagnosticBindingService';
    export { normalizeAppData } from './src/shared/normalizers/appData';`, resolveDir: repoRoot },
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: false, logLevel: 'silent' })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(join(repoRoot, 'package.json')), module, module.exports)
  return module.exports
}

function longProse(opening) {
  return [opening, ...Array.from({ length: 36 }, (_, index) =>
    `第${index + 1}处记录压在纸页内侧。林默扶住书脊，沿着淡去的墨迹逐字核对。窗外响起脚步声，他停下笔，等声音离开才继续。账簿没有解释那道空白，他也没有急着写下结论。`)].join('\n\n')
}

// Pure, additive setup. No production, edited result or acceptance is attributed to UI actions.
export function createProseFirstFixture(original, baseUrl, draftContentHash) {
  const url = new URL(baseUrl)
  assert(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && !url.username && !url.password)
  assert(original.projects.length && original.projects.every((project) => project.id.startsWith('qa-')))
  assert(!original.settings.hasApiKey && !original.settings.apiKey, 'W07 will not replace existing credentials.')
  const data = structuredClone(original), ids = PROSE_FIXTURE_IDS
  const model = { apiProvider: 'local', baseUrl, modelName: 'qa-prose-reject-only', codexCliPath: '', codexCliModel: '',
    temperature: 0, maxTokens: 256, retryEnabled: false, maxRetries: 0, requestTimeoutMs: 5000 }
  const roles = Object.fromEntries(['planner', 'prose', 'extraction', 'reviewer', 'revision'].map((role) => [role, { ...model }]))
  data.settings = { ...data.settings, ...model, pipelineModelRoles: roles, apiKey: '', hasApiKey: false,
    enableAutoSummary: false, enableChapterDiagnostics: false, theme: 'light' }
  const task = { goal: PROSE_TEXT.plan, conflict: '守门人不肯交出钥匙。', endingHook: '最后一行出现熟悉的笔迹。',
    suspenseToKeep: '寄信人的身份。', allowedPayoffs: '缺页留下的印痕。', forbiddenPayoffs: '不揭示幕后主使。',
    readerEmotion: '疑惑与紧张。', targetWordCount: '2000-3000', styleRequirement: '第三人称限知，使用具体动作。' }
  const plan = { chapterTitle: '钟楼缺页', chapterGoal: task.goal, conflictToPush: task.conflict, characterBeats: '核对账簿。',
    foreshadowingToUse: task.allowedPayoffs, foreshadowingNotToReveal: task.forbiddenPayoffs, endingHook: task.endingHook,
    readerEmotionTarget: task.readerEmotion, estimatedWordCount: task.targetWordCount, openingContinuationBeat: '接续进入钟楼。',
    carriedPhysicalState: '手指冰冷。', carriedEmotionalState: '警惕。', unresolvedMicroTensions: '钥匙尚未拿到。',
    forbiddenResets: '不重复介绍到达钟楼。', allowedNovelty: '', forbiddenNovelty: '' }
  const job = { id: ids.jobId, projectId: ids.projectId, targetChapterOrder: 2, chapterTaskSnapshot: task,
    contextSource: 'auto', promptContextSnapshotId: null, aiRunConfig: { ...model, schemaVersion: 1, roles },
    pipelineMode: 'standard', pipelineRecipeId: 'standard', pipelineRecipeVersion: 1, pipelineRecipe: null,
    status: 'completed', currentStep: 'await_user_confirmation', errorMessage: '', createdAt: at, updatedAt: at }
  const planJob = { ...structuredClone(job), id: ids.planJobId, targetChapterOrder: 3, status: 'idle', currentStep: 'generate_chapter_draft',
    createdAt: '2026-09-06T23:59:00.000Z' }
  const chapterBody = longProse(PROSE_TEXT.chapter), draftBody = longProse(PROSE_TEXT.draft)
  const hash = draftContentHash(draftBody)
  const additions = {
    projects: [{ id: ids.projectId, name: PROSE_PROJECT_NAME, genre: '悬疑', description: 'W07 临时长正文，测试完成后恢复。',
      targetReaders: '成年读者', coreAppeal: '证据推理', style: task.styleRequirement, createdAt: at, updatedAt: at, lastOpenedAt: at }],
    chapters: [{ id: ids.chapterId, projectId: ids.projectId, order: 1, title: '窗沿上的钥匙', body: chapterBody,
      summary: '林默核对账簿，等待走廊安静。', newInformation: '', characterChanges: '', newForeshadowing: '', resolvedForeshadowing: '',
      endingHook: '', riskWarnings: '', includedInStageSummary: false, createdAt: at, updatedAt: at }],
    chapterGenerationJobs: [job, planJob],
    chapterGenerationSteps: [job, planJob].map((item) => ({ id: `${item.id}-plan`, jobId: item.id, type: 'generate_chapter_plan',
      status: 'completed', inputSnapshot: '', output: j(plan), errorMessage: '', createdAt: at, updatedAt: at })),
    generatedChapterDrafts: [{ id: ids.draftId, projectId: ids.projectId, chapterId: ids.chapterId, jobId: ids.jobId,
      title: '钟楼缺页草稿', body: draftBody, summary: '缺页留下印痕。', status: 'draft', tokenEstimate: 2400, createdAt: at, updatedAt: at }],
    revisionSessions: [{ id: ids.sessionId, projectId: ids.projectId, chapterId: ids.chapterId, sourceDraftId: ids.draftId,
      status: 'active', createdAt: at, updatedAt: at }],
    revisionRequests: [{ id: ids.requestId, sessionId: ids.sessionId, type: 'custom', targetRange: '', instruction: PROSE_TEXT.diagnosis,
      sourceDraftContentHash: hash, createdAt: at }],
    revisionVersions: [{ id: ids.versionId, sessionId: ids.sessionId, requestId: ids.requestId, title: '钟楼缺页修订候选',
      body: longProse(PROSE_TEXT.candidate), sourceContentHash: hash, changedSummary: PROSE_TEXT.diagnosis,
      risks: '不新增设定。', preservedFacts: '保留账簿、钥匙和窗外脚步声。', status: 'pending', createdAt: at, updatedAt: at }],
    qualityGateReports: [{ id: 'qa-prose-quality', projectId: ids.projectId, chapterId: ids.chapterId, jobId: ids.jobId,
      draftId: ids.draftId, draftContentHash: hash, overallScore: 88, pass: true,
      dimensions: Object.fromEntries(['plotCoherence', 'characterConsistency', 'characterStateConsistency', 'foreshadowingControl',
        'chapterContinuity', 'redundancyControl', 'styleMatch', 'pacing', 'emotionalPayoff', 'originality', 'promptCompliance',
        'contextRelevanceCompliance'].map((key) => [key, 88])),
      issues: [{ type: 'style', severity: 'medium', description: PROSE_TEXT.diagnosis, suggestedFix: '保留具体动作。' }],
      requiredFixes: [], optionalSuggestions: [], createdAt: at }]
  }
  additions.chapterGenerationSteps.push({ id: `${ids.jobId}-draft`, jobId: ids.jobId, type: 'generate_chapter_draft',
    status: 'completed', inputSnapshot: '', output: j({ title: '钟楼缺页草稿', body: draftBody }), errorMessage: '', createdAt: at, updatedAt: at })
  for (const [key, items] of Object.entries(additions)) {
    assert(Array.isArray(data[key]), `Missing normalized collection: ${key}`)
    assert(items.every((item) => !data[key].some((existing) => existing.id === item.id)), `W07 fixture collision: ${key}`)
    data[key] = [...items, ...data[key]]
  }
  return data
}

export async function startProseRejectSink() {
  const requests = []
  const server = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url })
    request.resume()
    response.writeHead(503, { 'content-type': 'application/json', connection: 'close' })
    response.end(j({ error: 'W07 read-only QA must not call AI.' }))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests,
    async close() {
      server.closeAllConnections?.()
      if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    } }
}

// Existing renderer only. Setup/restoration use main IPC; disclosures use native CDP pointer input.
export async function runProseFirstFixtureQA({ client, evaluate, waitFor, captureScreenshot, isolatedUserDataDir }) {
  const ev = (expression) => evaluate(client, expression)
  const until = (expression) => waitFor(client, expression, 30_000)
  assert(withinDirectory(join(repoRoot, 'tmp'), isolatedUserDataDir))
  const profile = await realpath(isolatedUserDataDir)
  assert(withinDirectory(await realpath(join(repoRoot, 'tmp')), profile))
  const load = async () => {
    const loaded = await ev('window.novelDirector.data.load()')
    assert(loaded.storagePath.endsWith('.sqlite') && withinDirectory(isolatedUserDataDir, loaded.storagePath))
    assert(withinDirectory(profile, await realpath(loaded.storagePath)))
    assert(loaded.data.projects.length && loaded.data.projects.every((item) => item.id.startsWith('qa-')))
    assert(!loaded.data.settings.hasApiKey && !loaded.data.settings.apiKey)
    assert(!loaded.data.chapterGenerationJobs.some((item) => item.status === 'running'))
    return loaded
  }
  const original = await load(), domain = await loadProseFixtureDomain()
  const file = await open(original.storagePath, 'r')
  try { const bytes = Buffer.alloc(16); await file.read(bytes, 0, 16, 0); assert.equal(bytes.toString(), 'SQLite format 3\0') }
  finally { await file.close() }
  let seeded = false, result, watching = false, watchPromise, failure
  const cleanupErrors = [], newCalls = new Set(), monitorErrors = []
  let progressSamples = 0
  const progress = async () => {
    const snapshot = await ev(`(async () => {
      const api = window.novelDirector.ai;
      if (typeof api.getCallProgress !== 'function' || typeof api.listCallProgress !== 'function') throw new Error('Missing real preload progress APIs');
      return {latest: await api.getCallProgress({}), runs: await Promise.all(${j([PROSE_FIXTURE_IDS.jobId, PROSE_FIXTURE_IDS.planJobId])}.map(id => api.listCallProgress(id)))};
    })()`)
    progressSamples++
    return [snapshot.latest, ...snapshot.runs.flat()].filter(Boolean)
  }
  const baseline = await progress()
  assert(baseline.every((call) => ['completed', 'failed', 'cancelled'].includes(call.stage)), 'Existing AI transport is still active.')
  const knownCalls = new Set(baseline.map((call) => call.callId))
  const sink = await startProseRejectSink()
  async function assertNoAI() {
    for (const call of await progress()) if (!knownCalls.has(call.callId)) newCalls.add(call.callId)
    assert.equal(sink.requests.length, 0, 'W07 caused loopback HTTP requests.')
    assert.equal(newCalls.size, 0, 'W07 started AI transport, including calls rejected before HTTP.')
    assert.deepEqual(monitorErrors, [], 'AI progress monitor lost coverage.')
  }
  async function reload() {
    await client.send('Page.reload', { ignoreCache: true })
    await until('Boolean(window.novelDirector?.data?.load && document.querySelector(".project-list-panel"))')
  }
  async function click(label, scope = 'body') {
    const clicked = await ev(`(() => {
      const buttons = [...document.querySelectorAll(${j(scope)} + ' button')].filter(button => button.textContent?.trim() === ${j(label)} && !button.disabled);
      if (buttons.length !== 1) return false;
      buttons[0].click(); return true;
    })()`)
    assert(clicked, `Missing unique navigation button: ${scope} / ${label}`)
  }
  const settle = () => ev('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  async function physical(expression) {
    const point = await ev(`(async () => {
      const element = ${expression}; if (!element) return null;
      element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      await new Promise(resolve => requestAnimationFrame(resolve));
      const box = element.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      const hit = document.elementFromPoint(x,y);
      return box.width && box.height && hit && element.contains(hit) ? {x,y} : null;
    })()`)
    assert(point, 'Disclosure pointer did not hit its summary.')
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await client.send('Input.dispatchMouseEvent',
      { type, ...point, ...(type === 'mouseMoved' ? {} : { button: 'left', clickCount: 1 }) })
    await settle()
  }
  async function reveal(selector) {
    // Walk outermost-first, because a nested summary is not hit-testable while its parent is closed.
    for (let count = 0; count < 12; count++) {
      const index = await ev(`(() => {
        const element = document.querySelector(${j(selector)}); if (!element) return -2;
        let parent = null;
        for (let node = element.parentElement; node; node = node.parentElement) {
          if (node.tagName === 'DETAILS' && !node.open && !node.querySelector(':scope > summary')?.contains(element)) parent = node;
        }
        return parent ? [...document.querySelectorAll('details')].indexOf(parent) : -1;
      })()`)
      assert(index !== -2, `Missing disclosure target: ${selector}`)
      if (index === -1) return
      await physical(`document.querySelectorAll('details')[${index}]?.querySelector(':scope > summary')`)
    }
    throw new Error('Disclosure ancestor navigation did not settle.')
  }
  async function resetFirstScreen() {
    const selector = '.pipeline-config-tools, .pipeline-job-list, .pipeline-sidebar, .revision-source-disclosure, .revision-version-meta, .revision-sidebar-tools, .pipeline-original-reports, details:has(.pipeline-config-tools), details:has(.revision-source-card)'
    for (let count = 0; count < 16; count++) {
      const index = await ev(`(() => {
        const target = [...document.querySelectorAll(${j(selector)})].find(item => item.tagName === 'DETAILS' && item.open &&
          ![...item.querySelectorAll('details[open]')].some(child => child.matches(${j(selector)})));
        return target ? [...document.querySelectorAll('details')].indexOf(target) : -1;
      })()`)
      if (index === -1) break
      await physical(`document.querySelectorAll('details')[${index}]?.querySelector(':scope > summary')`)
    }
    await ev(`(() => { for (const element of [document.scrollingElement, ...document.querySelectorAll('.main-panel,.reader-continuous-scroll,.pipeline-main,.revision-compare')])
      element?.scrollTo({top:0,left:0,behavior:'instant'}); })()`)
    await settle()
  }
  async function navigate(label, root) {
    await click(label, '.sidebar')
    await until(`Boolean(document.querySelector(${j(root)}) && !document.querySelector('.view-loading'))`)
  }
  async function selectJob(order) {
    await reveal('.pipeline-job-items')
    const selected = await ev(`(() => {
      const button = [...document.querySelectorAll('.pipeline-job-item')].find(item => item.querySelector('strong')?.textContent?.trim() === ${j(`第 ${order} 章`)});
      button?.click(); return Boolean(button);
    })()`)
    assert(selected, `Missing synthetic job for chapter ${order}`)
    await settle()
  }
  async function openPipeline() {
    await navigate('生产流水线', '.generation-view')
    await selectJob(2)
    await click('草稿', '.pipeline-artifact-tabs')
    await until(`document.querySelector('.pipeline-draft-body')?.value.startsWith(${j(PROSE_TEXT.draft)})`)
    await until(`document.querySelector('.pipeline-original-reports-body')?.textContent.includes(${j(PROSE_TEXT.diagnosis)})`)
    await resetFirstScreen()
  }
  try {
    const seededData = createProseFirstFixture(original.data, sink.baseUrl, domain.draftContentHash)
    seeded = true
    await ev(`window.novelDirector.data.save(${j(seededData)})`)
    await reload()
    await assertNoAI()
    watching = true
    watchPromise = (async () => {
      while (watching) {
        try { await assertNoAI() } catch (error) { monitorErrors.push(error.message); watching = false }
        if (watching) await delay(100)
      }
    })()
    const entered = await ev(`(() => {
      const row = [...document.querySelectorAll('.project-row')].find(item => item.querySelector('h3')?.textContent === ${j(PROSE_PROJECT_NAME)});
      const button = [...(row?.querySelectorAll('button') || [])].find(item => item.textContent?.trim() === '进入');
      button?.click(); return Boolean(button);
    })()`)
    assert(entered, 'Could not enter the W07 synthetic project.')
    await until('Boolean(document.querySelector(".dashboard-view") && !document.querySelector(".view-loading"))')
    const fixtureSettings = (await load()).data.settings
    result = await runProseFirstWorkspacesQA({ client, evaluate, waitFor, captureScreenshot, isolatedUserDataDir,
      fixture: PROSE_FIXTURE_IDS, assertNoAI,
      themes: ['light', 'dark'].map((name) => ({ name, expectedTheme: name, async enter() {
        const previous = await ev('document.documentElement.getAttribute("data-theme")')
        await ev(`document.documentElement.dataset.theme = ${j(name)}`)
        await until(`document.documentElement.dataset.theme === ${j(name)}`)
        return () => ev(previous === null ? 'document.documentElement.removeAttribute("data-theme")' : `document.documentElement.dataset.theme = ${j(previous)}`)
      } })),
      workspaces: [
        { id: 'pipeline', open: openPipeline, expectedText: PROSE_TEXT.draft,
          tools: PROSE_WORKSPACES.pipeline.tools.map((tool) => tool.name === 'diagnostics' ? { ...tool, expectedText: PROSE_TEXT.diagnosis } : tool) },
        { id: 'reading', body: '.reader-chapter-body', expectedText: PROSE_TEXT.chapter, async open() {
          await navigate('连贯阅读', '.reading-view')
          await until(`document.querySelector('.reader-chapter-body')?.textContent.includes(${j(PROSE_TEXT.chapter)})`)
          await resetFirstScreen()
        } },
        { id: 'revision', expectedText: PROSE_TEXT.candidate, body: 'textarea.revision-textarea.revised', async open() {
          await navigate('修订工作台', '.revision-view')
          await reveal('.revision-source-card button')
          await click('草稿', '.revision-source-card')
          await until('Boolean(document.querySelector(".revision-compare.has-versions"))')
          await click('修订后', '.revision-view-switch')
          await until(`document.querySelector('textarea.revision-textarea.revised')?.value.startsWith(${j(PROSE_TEXT.candidate)})`)
          await resetFirstScreen()
        } }
      ],
      pipelinePlan: { expectedText: PROSE_TEXT.plan, async open() {
        // The preceding pipeline scenario deliberately leaves the draft tab selected.
        await selectJob(3)
        await until(`document.querySelector('.pipeline-job-item.active strong')?.textContent?.trim() === '第 3 章'`)
        await resetFirstScreen()
      } }
    })
    assert.deepEqual((await load()).data.settings, fixtureSettings, 'Read-only QA changed temporary model/settings data.')
  } catch (error) {
    failure = error
    try { await captureScreenshot(client, 'prose-first-failure.png') } catch { /* Preserve the original QA failure. */ }
  }
  finally {
    watching = false
    if (watchPromise) await watchPromise
    try { await assertNoAI() } catch (error) { cleanupErrors.push(error) }
    if (seeded) try {
      // Unmount readers/editors before restoration so a late UI save cannot reintroduce the fixture.
      await reload()
      await load()
      await ev(`window.novelDirector.data.save(${j(original.data)})`)
      await reload()
      assert.deepEqual((await load()).data, original.data, 'W07 IPC restoration changed the pre-existing QA snapshot.')
      await assertNoAI()
    } catch (error) { cleanupErrors.push(error) }
    try { await sink.close() } catch (error) { cleanupErrors.push(error) }
  }
  if (failure || cleanupErrors.length) throw new AggregateError([failure, ...cleanupErrors].filter(Boolean),
    [failure, ...cleanupErrors].filter(Boolean).map((error) => error.message).join('\n'))
  return { ...result, aiHttpRequests: sink.requests.length, aiProgressNewCalls: [...newCalls], progressSamples, restored: true,
    checks: ['W07 light/dark each pass four viewport checks for three long-prose workspaces with physical disclosures.',
      'W07 plan-only job remains visible after selecting it from the existing draft tab at all eight theme/viewport combinations.',
      'W07 made zero loopback requests and zero new main-process AI calls; the original isolated SQLite data was restored through IPC.'] }
}

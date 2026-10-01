import assert from 'node:assert/strict'
import { open, realpath } from 'node:fs/promises'
import { createServer } from 'node:http'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { repoRoot } from './repo-root.mjs'

export const TASK_EDITOR_IDS = Object.freeze({ project: 'qa-task-editor-project', chapter: 'qa-task-editor-chapter',
  job: 'qa-task-editor-old-job', draft: 'qa-task-editor-old-draft' })
export const TASK_EDITOR_TASK = Object.freeze({
  goal: '核对钟楼账簿中的缺页，找到下一条证据。', conflict: '守门人拒绝交出钥匙，午夜前必须完成核对。',
  suspenseToKeep: '保留寄信人的身份。', allowedPayoffs: '揭示缺页留下的印痕。', forbiddenPayoffs: '不要揭示幕后主使。',
  endingHook: '最后一行出现主角熟悉的笔迹。', readerEmotion: '疑惑中逐渐紧张。', targetWordCount: '2000-3000',
  styleRequirement: '第三人称限知，叙述克制，避免解释性旁白。'
})
export const TASK_EDITOR_STYLE = '第三人称限知，使用短句和具体动作，让停顿承载紧张感；保留全部事件与人物动机。'
export const TASK_EDITOR_FIELDS = Object.freeze({ goal: '本章目标', conflict: '核心冲突', endingHook: '结尾',
  targetWordCount: '目标字数', styleRequirement: '表达要求', suspenseToKeep: '保留悬念', allowedPayoffs: '允许回收',
  forbiddenPayoffs: '禁止提前揭示', readerEmotion: '读者情绪' })
const roles = ['planner', 'prose', 'extraction', 'reviewer', 'revision']
const editorSelector = '.pipeline-task-editor'
const fieldSelector = (name) => `${editorSelector} [name="${name}"]`
const j = JSON.stringify

function createTaskEditorPlan() {
  return {
    chapterTitle: '钟楼缺页', chapterGoal: TASK_EDITOR_TASK.goal, conflictToPush: TASK_EDITOR_TASK.conflict,
    characterBeats: '林默检查账簿。', foreshadowingToUse: TASK_EDITOR_TASK.allowedPayoffs,
    foreshadowingNotToReveal: TASK_EDITOR_TASK.forbiddenPayoffs, endingHook: TASK_EDITOR_TASK.endingHook,
    readerEmotionTarget: TASK_EDITOR_TASK.readerEmotion, estimatedWordCount: TASK_EDITOR_TASK.targetWordCount,
    openingContinuationBeat: '接续进入钟楼。', carriedPhysicalState: '手指冰冷。', carriedEmotionalState: '警惕。',
    unresolvedMicroTensions: '钥匙尚未拿到。', forbiddenResets: '不能重新介绍到达钟楼。', allowedNovelty: '', forbiddenNovelty: ''
  }
}

function within(parent, child) {
  const path = relative(resolve(parent), resolve(child))
  return Boolean(path) && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
}

// Preparation only: no edited job, saved-task result, generated replacement or UI success is seeded.
export function createPipelineTaskEditorFixture(original, baseUrl) {
  const url = new URL(baseUrl)
  assert(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && !url.username && !url.password,
    'Task editor QA requires a loopback HTTP stub with an explicit port.')
  const data = structuredClone(original)
  assert(!data.projects.some((item) => item.id === TASK_EDITOR_IDS.project), 'Task editor fixture already exists.')
  const at = '2026-09-06T00:00:00.000Z'
  const model = { apiProvider: 'compatible', baseUrl, modelName: 'qa-task-editor-local-only', codexCliPath: '',
    codexCliModel: '', temperature: 0, maxTokens: 256, retryEnabled: false, maxRetries: 0, requestTimeoutMs: 5000 }
  const roleConfigs = Object.fromEntries(roles.map((role) => [role, { ...model }]))
  data.settings = { ...data.settings, ...model, pipelineModelRoles: roleConfigs, apiKey: '', hasApiKey: true,
    enableAutoSummary: false, enableChapterDiagnostics: false }
  const job = { id: TASK_EDITOR_IDS.job, projectId: TASK_EDITOR_IDS.project, targetChapterOrder: 2,
    chapterTaskSnapshot: { ...TASK_EDITOR_TASK }, contextSource: 'auto', promptContextSnapshotId: null,
    aiRunConfig: { ...model, schemaVersion: 1, roles: structuredClone(roleConfigs) }, pipelineMode: 'standard',
    pipelineRecipeId: 'standard', pipelineRecipeVersion: 1, pipelineRecipe: null,
    status: 'completed', currentStep: 'await_user_confirmation', errorMessage: '', createdAt: at, updatedAt: at }
  const draft = { id: TASK_EDITOR_IDS.draft, projectId: job.projectId, chapterId: null, jobId: job.id,
    title: '钟楼缺页', body: '守门人收起钥匙。林默把账簿移到灯下，缺页的印痕正好落在他的指尖。\n钟声响起，他没有翻过最后一页。',
    summary: '账簿留下线索，钥匙仍在守门人手中。', status: 'draft', tokenEstimate: 70, createdAt: at, updatedAt: at }
  const plan = createTaskEditorPlan()
  const additions = {
    projects: [{ id: job.projectId, name: 'W06 任务编辑隔离验收', genre: '悬疑', description: '仅用于本地隔离 QA。',
      targetReaders: '成年读者', coreAppeal: '证据推理', style: TASK_EDITOR_TASK.styleRequirement,
      createdAt: at, updatedAt: at, lastOpenedAt: at }],
    chapters: [{ id: TASK_EDITOR_IDS.chapter, projectId: job.projectId, order: 1, title: '来到钟楼',
      body: '林默走进钟楼，把收到的信放在桌上。', summary: '林默抵达钟楼。', newInformation: '', characterChanges: '',
      newForeshadowing: '', resolvedForeshadowing: '', endingHook: '', riskWarnings: '', includedInStageSummary: false,
      createdAt: at, updatedAt: at }],
    chapterGenerationJobs: [job], generatedChapterDrafts: [draft],
    chapterGenerationSteps: [['generate_chapter_plan', plan], ['generate_chapter_draft', { title: draft.title, body: draft.body }]]
      .map(([type, output]) => ({ id: `${job.id}-${type}`, jobId: job.id, type, status: 'completed', inputSnapshot: '',
        output: j(output), errorMessage: '', createdAt: at, updatedAt: at }))
  }
  for (const [key, items] of Object.entries(additions)) {
    assert(items.every((item) => !data[key].some((existing) => existing.id === item.id)), `Fixture ID collision in ${key}.`)
    data[key] = [...items, ...data[key]]
  }
  return data
}

// Counts every incoming request, including unexpected routes; never forwards anything remotely.
export async function startTaskEditorAIStub() {
  const requests = []
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.once('end', () => {
      let body = null
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {}
      const messages = Array.isArray(body?.messages) ? body.messages : []
      const systemText = messages.filter((item) => item?.role === 'system' && typeof item.content === 'string')
        .map((item) => item.content).join('\n')
      const promptText = messages.filter((item) => typeof item?.content === 'string')
        .map((item) => item.content).join('\n')
      const currentTask = { ...TASK_EDITOR_TASK, styleRequirement: TASK_EDITOR_STYLE }
      const requestKind = systemText.includes('正文作者') ? 'draft' : systemText.includes('章节导演') ? 'plan' : 'other'
      const taskFieldsPresent = Object.fromEntries(Object.entries(currentTask)
        .map(([field, value]) => [field, promptText.includes(value)]))
      requests.push({
        method: request.method,
        path: request.url,
        requestKind,
        model: body?.model ?? null,
        temperature: body?.temperature ?? null,
        maxTokens: body?.max_tokens ?? null,
        messageCount: messages.length,
        responseStatus: requestKind === 'plan' ? 200 : 503,
        taskFieldsPresent,
        hasCurrentTask: Object.values(taskFieldsPresent).every(Boolean)
      })
      if (requestKind === 'plan') {
        response.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
        response.end(j({ id: 'qa-task-editor-plan', object: 'chat.completion', choices: [{ index: 0,
          message: { role: 'assistant', content: j(createTaskEditorPlan()) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
      } else {
        response.writeHead(503, { 'content-type': 'application/json', connection: 'close' })
        response.end(j({ error: { message: 'W06 QA: draft generation stub intentionally returns 503.' } }))
      }
    })
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert(address && typeof address === 'object' && address.address === '127.0.0.1')
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests,
    async close() {
      server.closeAllConnections?.()
      if (server.listening) await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
    } }
}

const protectedCollections = ['generatedChapterDrafts', 'chapters', 'chapterVersions', 'revisionVersions', 'chapterCommitBundles',
  'revisionCommitBundles', 'characters', 'characterStateFacts', 'characterStateTransactions', 'characterStateLogs',
  'characterStateChangeCandidates', 'foreshadowings', 'timelineEvents', 'stageSummaries', 'storyBibles', 'hardCanonPacks',
  'memoryUpdateCandidates', 'candidateDecisionReceipts', 'qualityGateReports', 'consistencyReviewReports', 'redundancyReports']

export function assertTaskEditorSavedState(before, after, { expectedStatus = 'idle' } = {}) {
  const oldJob = before.chapterGenerationJobs.find((item) => item.id === TASK_EDITOR_IDS.job)
  assert(oldJob, 'Missing baseline source job.')
  for (const item of before.chapterGenerationJobs) assert.deepEqual(after.chapterGenerationJobs.find((job) => job.id === item.id), item,
    'Saving a new task modified or removed an existing job.')
  for (const item of before.chapterGenerationSteps) assert.deepEqual(after.chapterGenerationSteps.find((step) => step.id === item.id), item,
    'Saving a new task modified or removed an old step/output.')
  for (const key of protectedCollections) assert.deepEqual(after[key], before[key], `Task editing changed ${key}.`)
  const oldIds = new Set(before.chapterGenerationJobs.map((item) => item.id))
  const added = after.chapterGenerationJobs.filter((item) => !oldIds.has(item.id))
  assert.equal(added.length, 1, 'One task save must create exactly one new job.')
  const [job] = added
  assert.equal(job.projectId, oldJob.projectId)
  assert.equal(job.targetChapterOrder, oldJob.targetChapterOrder)
  assert.deepEqual(job.chapterTaskSnapshot, { ...oldJob.chapterTaskSnapshot, styleRequirement: TASK_EDITOR_STYLE })
  assert.equal(job.status, expectedStatus, 'The edited task should wait for explicit generation.')
  assert.equal(job.taskEdit?.sourceJobId, oldJob.id)
  assert.deepEqual(job.taskEdit?.changedFields, ['styleRequirement'])
  assert(['expression', 'context'].includes(job.taskEdit?.scope), 'The edited task has an unknown preparation scope.')
  assert.deepEqual(job.aiRunConfig, oldJob.aiRunConfig, 'Task editing changed the captured local-only model configuration.')
  assert(!after.generatedChapterDrafts.some((item) => item.jobId === job.id), 'Task saving generated or copied a replacement draft.')
  return job
}

// The local preparation phase must carry the edited task into the real pipeline
// input and prompt without advancing into an AI-backed step.
export function assertTaskEditorRequirementsInSteps(before, after, job) {
  const source = before.chapterGenerationJobs.find((item) => item.id === TASK_EDITOR_IDS.job)
  assert(source, 'Missing source job while checking edited pipeline steps.')
  const steps = after.chapterGenerationSteps.filter((step) => step.jobId === job.id)
  const byType = new Map(steps.map((step) => [step.type, step]))
  assert.equal(steps.length, 14, 'The new job must receive the complete pipeline step list.')
  assert(steps.every((step) => step.status !== 'running' && step.status !== 'failed'),
    'Saving an edited task left a pipeline step running or failed.')

  const draft = byType.get('generate_chapter_draft')
  assert.equal(draft?.status, 'pending', '正文必须等待显式生成。')
  assert.equal(draft?.output, '', '正文 step 在显式生成前不能有输出。')

  if (job.taskEdit?.scope === 'context') {
    // This fixture has no complete old context snapshot, so saving deterministically
    // prepares needs/budget/prompt and leaves plan generation for the user action.
    for (const type of ['context_need_planning', 'context_budget_selection', 'build_context']) {
      assert.equal(byType.get(type)?.status, 'completed', `Task preparation did not complete ${type}.`)
    }
    for (const type of ['generate_chapter_plan', 'context_need_planning_from_plan', 'context_budget_selection_delta',
      'rebuild_context_with_plan']) {
      const step = byType.get(type)
      assert.equal(step?.status, 'pending', `${type} must wait for explicit generation.`)
      assert.equal(step?.output, '', `${type} must not contain generated output before explicit generation.`)
    }
  } else {
    // A valid old plan/context can be reused for an expression-only edit. In that
    // branch upstream plan/context steps may already be completed; the draft is
    // still the first step that must wait for explicit generation.
    assert.equal(byType.get('generate_chapter_plan')?.status, 'completed',
      'Expression-only reuse should retain the patched completed plan.')
    assert.equal(byType.get('rebuild_context_with_plan')?.status, 'completed',
      'Expression-only reuse should retain the patched completed context.')
  }

  const buildContext = byType.get('build_context')
  assert(buildContext?.output, 'The prepared job has no persisted build_context prompt.')
  for (const [field, value] of Object.entries(job.chapterTaskSnapshot)) {
    assert(buildContext.output.includes(value), `The new build_context prompt is missing edited ${field}.`)
  }

  for (const step of steps) {
    const input = JSON.parse(step.inputSnapshot)
    assert(input && typeof input === 'object' && !Array.isArray(input), `${step.type} inputSnapshot is not an options object.`)
  }

  assert.deepEqual(after.chapterGenerationJobs.find((item) => item.id === source.id), source,
    'Preparing the edited task changed the historical source job.')
  return { buildContextPrompt: buildContext.output, steps }
}

// UNBOUND callbacks, identical to the parent candidate QA: evaluate(client, expression),
// waitFor(client, BooleanExpression, timeout), captureScreenshot(client, filename).
// Caller owns the running app. Importing this module never starts an app or HTTP server.
export async function runPipelineTaskEditorQA({ client, evaluate, waitFor, captureScreenshot, isolatedUserDataDir,
  taskTabLabel = '任务书', expectedStatus = 'idle' }) {
  assert(client && typeof client.send === 'function')
  for (const dependency of [evaluate, waitFor, captureScreenshot]) assert.equal(typeof dependency, 'function')
  assert(typeof isolatedUserDataDir === 'string' && within(resolve(repoRoot, 'tmp'), isolatedUserDataDir),
    'W06 requires caller-owned isolated userData under repository tmp.')
  const realTmp = await realpath(resolve(repoRoot, 'tmp'))
  const realUserData = await realpath(isolatedUserDataDir)
  assert(within(realTmp, realUserData), 'Isolated userData resolves outside repository tmp.')
  const ev = (expression) => evaluate(client, expression)
  const until = (expression) => waitFor(client, expression, 30_000)
  const load = async () => {
    const loaded = await ev('(async () => await window.novelDirector.data.load())()')
    assert(typeof loaded.storagePath === 'string' && loaded.storagePath.endsWith('.sqlite') && within(isolatedUserDataDir, loaded.storagePath))
    assert(within(realUserData, await realpath(loaded.storagePath)), 'SQLite resolves outside isolated userData.')
    return loaded
  }
  const original = await load()
  assert(!original.data.settings.hasApiKey && !original.data.settings.apiKey, 'Refusing to replace a pre-existing credential; supply a fresh isolated QA profile.')
  assert(!original.data.chapterGenerationJobs.some((job) => job.status === 'running'), 'Another QA job is running.')
  const file = await open(original.storagePath, 'r')
  try {
    const header = Buffer.alloc(16)
    await file.read(header, 0, 16, 0)
    assert.equal(header.toString(), 'SQLite format 3\0', 'W06 needs actual isolated SQLite, not a JSON fixture bridge.')
  } finally { await file.close() }
  const viewport = await ev('({width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio})')
  const stub = await startTaskEditorAIStub()
  const checks = [], screenshots = []
  let seeded = false, credentialSet = false, result, failure
  const cleanupFailures = []

  async function pointerClick(expression, label, click = true, repeat = 1) {
    const point = await ev(`(async () => {
      const element = ${expression}
      if (!element || ${click ? 'element.disabled' : 'false'}) return null
      element.scrollIntoView({block:'center', inline:'nearest', behavior:'instant'})
      await new Promise(resolve => requestAnimationFrame(resolve))
      const rect = element.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2
      const hit = document.elementFromPoint(x, y)
      return rect.width > 0 && rect.height > 0 && hit && element.contains(hit) ? {x,y} : null
    })()`)
    assert(point, `UI control is missing, disabled or obscured: ${label}.`)
    if (!click) return
    for (let index = 0; index < repeat; index++) {
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: index + 1 })
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: index + 1 })
    }
  }
  const button = (scope, label) => `[...document.querySelectorAll(${j(`${scope} button`)})].find(item => item.textContent?.trim() === ${j(label)})`
  const clickButton = (scope, label) => pointerClick(button(scope, label), label)
  const doubleClickButton = (scope, label) => pointerClick(button(scope, label), label, true, 2)
  const buttonState = async (label, disabled) => until(`Boolean(${button(editorSelector, label)}?.disabled === ${disabled})`)
  const optionalButtonState = async (label, disabled) => until(`Boolean((() => {
    const control = ${button(editorSelector, label)}
    return !control || control.disabled === ${disabled}
  })())`)
  const primaryButtonState = async (disabled) => until(`Boolean(document.querySelector('.pipeline-top-status-inner > button')?.disabled === ${disabled})`)
  const taskEditingLockedState = () => until(`Boolean((() => {
    const fieldset = document.querySelector('fieldset.pipeline-config-fields')
    const targetChapter = fieldset?.querySelector('input[type="number"]')
    return fieldset?.matches(':disabled') && targetChapter?.matches(':disabled')
  })())`)
  async function showTask() {
    await clickButton('.pipeline-artifact-tabs', taskTabLabel)
    await until(`Boolean(document.querySelector(${j(editorSelector)}))`)
    if (!await ev('Boolean(document.querySelector(".pipeline-task-advanced")?.open)')) {
      await pointerClick('document.querySelector(".pipeline-task-advanced > summary")', '更多任务要求')
    }
  }
  async function assertFields(task) {
    for (const [name, label] of Object.entries(TASK_EDITOR_FIELDS)) {
      await until(`Boolean(document.querySelector(${j(fieldSelector(name))})?.value === ${j(task[name])})`)
      const actualLabel = await ev(`document.querySelector(${j(fieldSelector(name))})?.labels?.[0]?.textContent?.trim()`)
      assert.equal(actualLabel, label, `Incorrect label for ${name}.`)
      await pointerClick(`document.querySelector(${j(fieldSelector(name))})`, label, false)
    }
  }
  async function editStyle(text) {
    await pointerClick(`document.querySelector(${j(fieldSelector('styleRequirement'))})`, '表达要求')
    await ev(`(() => { const input = document.querySelector(${j(fieldSelector('styleRequirement'))});
      input.focus(); input.setSelectionRange(0, input.value.length) })()`)
    await client.send('Input.insertText', { text })
    await until(`Boolean(document.querySelector(${j(fieldSelector('styleRequirement'))})?.value === ${j(text)})`)
  }
  async function reloadPipeline() {
    await client.send('Page.reload', { ignoreCache: true })
    const row = `[...document.querySelectorAll('.project-row')].find(item => item.querySelector('h3')?.textContent === 'W06 任务编辑隔离验收')`
    await until(`Boolean(${row})`)
    await pointerClick(`[...(${row}?.querySelectorAll('button') ?? [])].find(item => item.textContent?.trim() === '进入')`, '进入隔离项目')
    await until('Boolean(document.querySelector(".dashboard-view") && !document.querySelector(".view-loading"))')
    await clickButton('.sidebar', '生产流水线')
    await until('Boolean(document.querySelector(".pipeline-job-item.active"))')
    await showTask()
  }
  const assertNoAI = () => assert.deepEqual(stub.requests, [], 'Opening, editing, saving or reloading a task triggered an AI HTTP request.')
  async function screenshot(name) {
    await captureScreenshot(client, name)
    screenshots.push(name)
  }
  async function waitForStubRequestCount(expected) {
    const deadline = Date.now() + 30_000
    while (stub.requests.length < expected && Date.now() < deadline) await delay(40)
    assert.equal(stub.requests.length, expected, `Expected ${expected} local AI request(s), received ${stub.requests.length}.`)
  }
  async function assertNarrowLayout() {
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 720, deviceScaleFactor: 1, mobile: false })
    await until('innerWidth === 1024 && innerHeight === 720')
    await assertFields({ ...TASK_EDITOR_TASK, styleRequirement: TASK_EDITOR_STYLE })
    for (const label of ['重置未保存更改', '保存任务', '按此任务生成']) await pointerClick(button(editorSelector, label), label, false)
    const layout = await ev(`(() => {
      const root = document.querySelector(${j(editorSelector)}), mainPanel = document.querySelector('.main-panel, .pipeline-main'), problems = []
      const nodes = [...root.querySelectorAll('label, input, textarea, summary, button, .pipeline-task-heading, .pipeline-task-impact')]
        .filter(node => node.getClientRects().length && node.getBoundingClientRect().width > 0)
      const rects = nodes.map(node => ({node, rect:node.getBoundingClientRect()}))
      const name = node => node.name || node.textContent.trim().slice(0,40)
      const overwideChildren = mainPanel ? [...mainPanel.querySelectorAll('*')].map(node => {
        const rect = node.getBoundingClientRect()
        return { tag: node.tagName.toLowerCase(), className: typeof node.className === 'string' ? node.className.trim().slice(0, 80) : '',
          width: Math.round(Math.max(node.scrollWidth, rect.width)), clientWidth: Math.round(node.clientWidth) }
      }).filter(item => item.width > item.clientWidth + 2).slice(0, 20) : []
      const panelMetrics = mainPanel ? { scrollWidth: Math.round(mainPanel.scrollWidth), clientWidth: Math.round(mainPanel.clientWidth), overwideChildren } : null
      if (document.documentElement.scrollWidth > innerWidth + 2) problems.push('document horizontal overflow: ' + JSON.stringify({scrollWidth: document.documentElement.scrollWidth, clientWidth: innerWidth}))
      if (root.scrollWidth > root.clientWidth + 2) problems.push('task editor horizontal overflow: ' + JSON.stringify({scrollWidth: root.scrollWidth, clientWidth: root.clientWidth}))
      if (!mainPanel) problems.push('missing .main-panel/.pipeline-main scroll container')
      else if (mainPanel.scrollWidth > mainPanel.clientWidth + 2) problems.push('main panel horizontal overflow: ' + JSON.stringify(panelMetrics))
      for (let i = 0; i < rects.length; i++) {
        const {node,rect} = rects[i]
        if (rect.left < -1 || rect.right > innerWidth + 1) problems.push('outside viewport: ' + name(node))
        if (node.tagName === 'BUTTON' && (node.scrollWidth > node.clientWidth + 2 || node.scrollHeight > node.clientHeight + 2)) problems.push('clipped button text: ' + name(node))
        if (node.tagName === 'LABEL' || node.tagName === 'BUTTON') {
          const range = document.createRange(); range.selectNodeContents(node)
          for (const text of range.getClientRects()) if (text.left < rect.left - 1 || text.right > rect.right + 1 || text.top < rect.top - 1 || text.bottom > rect.bottom + 1) problems.push('text overflow: ' + name(node))
        }
        for (const other of rects.slice(i + 1)) if (!node.contains(other.node) && !other.node.contains(node) &&
          Math.min(rect.right, other.rect.right) - Math.max(rect.left, other.rect.left) > 1 &&
          Math.min(rect.bottom, other.rect.bottom) - Math.max(rect.top, other.rect.top) > 1) problems.push('overlap: ' + name(node) + ' / ' + name(other.node))
      }
      return { problems, mainPanel: panelMetrics }
    })()`)
    assert.deepEqual(layout.problems, [], `Task editor has layout or hit-target problems at 1024x720: ${JSON.stringify(layout)}`)
    await screenshot('pipeline-task-editor-narrow-actions.png')
    await pointerClick(`document.querySelector(${j(fieldSelector('goal'))})`, '本章目标', false)
    await screenshot('pipeline-task-editor-narrow-fields.png')
  }

  try {
    const fixture = createPipelineTaskEditorFixture(original.data, stub.baseUrl)
    credentialSet = true
    await ev(`window.novelDirector.credentials.setApiKey('TEST_LOCAL_W06_QA_CREDENTIAL')`)
    seeded = true
    await ev(`window.novelDirector.data.save(${j(fixture)})`)
    await reloadPipeline()
    const before = (await load()).data
    assert.equal(before.chapterGenerationJobs.filter((job) => job.projectId === TASK_EDITOR_IDS.project).length, 1)
    await assertFields(TASK_EDITOR_TASK)
    await buttonState('保存任务', true)
    await buttonState('重置未保存更改', true)
    await optionalButtonState('按此任务生成', true)
    assertNoAI()
    checks.push('Existing completed job opens its task tab with all nine labelled task fields, including advanced requirements.')

    const dirtyBeforeReset = '这段未保存的表达要求应被重置。'
    await editStyle(dirtyBeforeReset)
    await buttonState('保存任务', false)
    await optionalButtonState('按此任务生成', true)
    await primaryButtonState(true)
    await taskEditingLockedState()
    await clickButton('.pipeline-artifact-tabs', '草稿')
    await until(`Boolean(document.querySelector(${j(fieldSelector('styleRequirement'))})?.value === ${j(dirtyBeforeReset)})`)
    await clickButton('.pipeline-artifact-tabs', '任务书')
    await assertFields({ ...TASK_EDITOR_TASK, styleRequirement: dirtyBeforeReset })
    await buttonState('保存任务', false)
    await primaryButtonState(true)
    await taskEditingLockedState()
    assert.deepEqual((await load()).data, before, 'Typing alone persisted a task.')
    await clickButton(editorSelector, '重置未保存更改')
    await assertFields(TASK_EDITOR_TASK)
    await buttonState('保存任务', true)
    await primaryButtonState(false)
    assert.deepEqual((await load()).data, before, 'Reset wrote a task/job instead of discarding only local edits.')
    checks.push('A completed job has no task-editor generate button; dirty input survives switching away from the hidden-but-mounted task tab, while the outer generate button is disabled until reset.')

    await editStyle(TASK_EDITOR_STYLE)
    await buttonState('保存任务', false)
    await doubleClickButton(editorSelector, '保存任务')
    await until(`(async () => { const {data} = await window.novelDirector.data.load(); return Boolean(data.chapterGenerationJobs.some(job =>
      job.projectId === ${j(TASK_EDITOR_IDS.project)} && job.id !== ${j(TASK_EDITOR_IDS.job)} && job.chapterTaskSnapshot?.styleRequirement === ${j(TASK_EDITOR_STYLE)})) })()`)
    await until(`document.querySelector(${j(editorSelector)})?.getAttribute('aria-busy') === 'false'`)
    await buttonState('保存任务', true)
    await buttonState('按此任务生成', false)
    const saved = (await load()).data
    const newJob = assertTaskEditorSavedState(before, saved, { expectedStatus })
    assertTaskEditorRequirementsInSteps(before, saved, newJob)
    await showTask()
    await assertFields(newJob.chapterTaskSnapshot)
    await delay(750)
    assertNoAI()
    assertTaskEditorSavedState(before, (await load()).data, { expectedStatus })
    assertTaskEditorRequirementsInSteps(before, (await load()).data, newJob)
    await screenshot('pipeline-task-editor-saved.png')
    checks.push('Saving a style edit creates exactly one non-running job with the original eight other fields; old jobs, draft, outputs, canonical facts and versions remain unchanged, with zero local AI HTTP requests.')
    checks.push('The new job snapshot and persisted build_context prompt carry all nine edited requirements; step inputSnapshot remains the existing options object, deterministic preparation or reusable completed upstream steps are preserved, and prose waits for explicit generation.')

    // Do not select a job after reload: that would hide an incorrect default restoration.
    await reloadPipeline()
    await assertFields(newJob.chapterTaskSnapshot)
    assert.equal(assertTaskEditorSavedState(before, (await load()).data, { expectedStatus }).id, newJob.id)
    assertNoAI()
    await buttonState('按此任务生成', false)
    await primaryButtonState(false)
    checks.push('After an actual Page.reload and project/pipeline navigation, the edited task is displayed without manually reselecting its job; SQLite retains the same single new job.')

    // Prove the historical draft is still reachable through the actual job rail, not only present in a fixture object.
    if (!await ev('Boolean(document.querySelector("details.pipeline-job-list")?.open)')) {
      await pointerClick('document.querySelector("details.pipeline-job-list > summary")', '运行历史')
    }
    const oldButton = `[...document.querySelectorAll('.pipeline-job-item')].find(item => item.dataset.status === 'completed' || item.querySelector('small')?.textContent?.trim().startsWith('completed'))`
    await pointerClick(oldButton, '旧 completed job')
    await clickButton('.pipeline-artifact-tabs', '草稿')
    const oldDraft = before.generatedChapterDrafts.find((item) => item.id === TASK_EDITOR_IDS.draft)
    await until(`Boolean(document.querySelector('.pipeline-draft-body')?.value === ${j(oldDraft.body)})`)
    await showTask()
    await assertFields(TASK_EDITOR_TASK)
    const newButton = `[...document.querySelectorAll('.pipeline-job-item')].find(item => item.dataset.status === ${j(expectedStatus)} || item.querySelector('small')?.textContent?.trim().startsWith(${j(expectedStatus)}))`
    await pointerClick(newButton, '新的待生成 job')
    await showTask()
    await assertFields(newJob.chapterTaskSnapshot)
    checks.push('Selecting the old job still displays its unchanged draft and original task; selecting the new job restores the edited task without mixing the two runs.')

    await assertNarrowLayout()
    assert.equal(assertTaskEditorSavedState(before, (await load()).data, { expectedStatus }).id, newJob.id)
    assertNoAI()
    checks.push('At 1024x720, all nine fields and three form buttons have reachable hit targets, non-overlapping rectangles and unclipped labels; narrow layout does not write data or invoke AI.')

    // Keep all edit/reload/narrow assertions above AI-free. The remaining journey
    // deliberately uses the real renderer and a loopback 503 so only failure and
    // resume behavior are inspected, never remote generation quality.
    const requestsBeforeGenerate = stub.requests.length
    assert.equal(requestsBeforeGenerate, 0, 'Explicit generation must start with zero AI HTTP requests.')
    await client.send('Emulation.setDeviceMetricsOverride', { ...viewport, mobile: false })
    await until(`innerWidth === ${viewport.width} && innerHeight === ${viewport.height}`)
    await showTask()
    await assertFields(newJob.chapterTaskSnapshot)
    await buttonState('按此任务生成', false)
    await clickButton(editorSelector, '按此任务生成')
    await waitForStubRequestCount(requestsBeforeGenerate + 2)
    await until(`(async () => { const {data} = await window.novelDirector.data.load(); const job = data.chapterGenerationJobs.find(item => item.id === ${j(newJob.id)}); const steps = data.chapterGenerationSteps.filter(item => item.jobId === ${j(newJob.id)}); const status = type => steps.find(item => item.type === type)?.status; return job?.status === 'failed' && job?.currentStep === 'generate_chapter_draft' && status('generate_chapter_plan') === 'completed' && status('context_need_planning_from_plan') === 'completed' && status('context_budget_selection_delta') === 'completed' && status('rebuild_context_with_plan') === 'completed' && status('generate_chapter_draft') === 'failed' })()`)
    await screenshot('pipeline-task-editor-generation-failed.png')

    const preparedSteps = saved.chapterGenerationSteps.filter((step) => step.jobId === newJob.id)
    const preparationTypes = ['context_need_planning', 'context_budget_selection', 'build_context']
    const upstreamTypes = [...preparationTypes, 'generate_chapter_plan', 'context_need_planning_from_plan', 'context_budget_selection_delta', 'rebuild_context_with_plan']
    const failed = (await load()).data
    const failedJob = failed.chapterGenerationJobs.find((item) => item.id === newJob.id)
    assert(failedJob, 'Explicit generation removed the edited job.')
    assert.equal(failedJob.status, 'failed')
    assert.equal(failedJob.currentStep, 'generate_chapter_draft')
    assert.deepEqual(failedJob.chapterTaskSnapshot, newJob.chapterTaskSnapshot, 'Generation changed the saved task snapshot.')
    assert.deepEqual(failedJob.aiRunConfig, newJob.aiRunConfig, 'Generation changed the frozen model configuration.')
    for (const type of preparationTypes) {
      assert.deepEqual(failed.chapterGenerationSteps.find((step) => step.jobId === newJob.id && step.type === type),
        preparedSteps.find((step) => step.type === type), `Generation repeated or changed ${type} before the draft failure.`)
      assert.equal(failed.chapterGenerationSteps.find((step) => step.jobId === newJob.id && step.type === type)?.status, 'completed')
    }
    for (const type of upstreamTypes.slice(preparationTypes.length)) {
      assert.equal(failed.chapterGenerationSteps.find((step) => step.jobId === newJob.id && step.type === type)?.status, 'completed', `${type} did not complete before the draft failure.`)
    }
    assert.equal(failed.chapterGenerationSteps.filter((step) => step.jobId === newJob.id).length, preparedSteps.length)
    assert(!failed.generatedChapterDrafts.some((draft) => draft.jobId === newJob.id), 'A failed draft run created a draft.')

    const currentTask = { ...TASK_EDITOR_TASK, styleRequirement: TASK_EDITOR_STYLE }
    const explicitRequests = stub.requests.slice(requestsBeforeGenerate)
    assert.deepEqual(explicitRequests.map((request) => request.requestKind), ['plan', 'draft'], 'The first explicit run must call plan once, then prose once.')
    assert.deepEqual(explicitRequests.map((request) => request.responseStatus), [200, 503])
    assert.equal(explicitRequests.filter((request) => request.requestKind === 'plan').length, 1)
    for (const request of explicitRequests) {
      assert.equal(request.model, newJob.aiRunConfig.modelName, 'The request did not use the frozen model.')
      assert.equal(request.temperature, newJob.aiRunConfig.temperature)
      assert.equal(request.maxTokens, newJob.aiRunConfig.maxTokens)
      assert(request.hasCurrentTask, `${request.requestKind} request did not carry the current task requirements.`)
      for (const field of Object.keys(currentTask)) assert.equal(request.taskFieldsPresent[field], true, `${request.requestKind} request is missing task field ${field}.`)
    }
    const planOutput = JSON.parse(failed.chapterGenerationSteps.find((step) => step.jobId === newJob.id && step.type === 'generate_chapter_plan').output)
    const expectedPlan = createTaskEditorPlan()
    for (const field of ['chapterGoal', 'conflictToPush', 'foreshadowingToUse', 'foreshadowingNotToReveal', 'endingHook', 'readerEmotionTarget', 'estimatedWordCount']) {
      assert.equal(planOutput[field], expectedPlan[field], `The stub plan did not preserve the task field mapped to ${field}.`)
    }
    checks.push('After all save/reload/narrow checks reported zero AI requests, the real “按此任务生成” action sent exactly one frozen-model plan request and one prose request carrying all nine task fields; the valid plan completed the three plan-gap steps, then the loopback 503 stopped the same job at draft with seven upstream steps complete and no draft.')

    await until(`Boolean([...document.querySelectorAll('.pipeline-step-rail button')].find(item => item.textContent?.trim() === '重试失败步骤')?.disabled === false)`)
    await clickButton('.pipeline-step-rail', '重试失败步骤')
    await waitForStubRequestCount(requestsBeforeGenerate + 3)
    await until(`(async () => { const {data} = await window.novelDirector.data.load(); const job = data.chapterGenerationJobs.find(item => item.id === ${j(newJob.id)}); const steps = data.chapterGenerationSteps.filter(item => item.jobId === ${j(newJob.id)}); return job?.status === 'failed' && job?.currentStep === 'generate_chapter_draft' && steps.find(item => item.type === 'generate_chapter_draft')?.status === 'failed' })()`)
    await screenshot('pipeline-task-editor-retry-failed.png')
    const retried = (await load()).data
    const retriedJob = retried.chapterGenerationJobs.find((item) => item.id === newJob.id)
    assert(retriedJob, 'Retry removed the edited job.')
    assert.equal(retriedJob.status, 'failed')
    assert.equal(retriedJob.currentStep, 'generate_chapter_draft')
    assert.deepEqual(retriedJob.chapterTaskSnapshot, failedJob.chapterTaskSnapshot, 'Retry changed the task snapshot.')
    assert.deepEqual(retriedJob.aiRunConfig, failedJob.aiRunConfig, 'Retry changed the frozen model configuration.')
    for (const type of upstreamTypes) {
      assert.deepEqual(retried.chapterGenerationSteps.find((step) => step.jobId === newJob.id && step.type === type),
        failed.chapterGenerationSteps.find((step) => step.jobId === newJob.id && step.type === type), `Retry repeated or changed completed upstream step ${type}.`)
    }
    assert.equal(retried.chapterGenerationSteps.filter((step) => step.jobId === newJob.id).length, preparedSteps.length)
    assert(!retried.generatedChapterDrafts.some((draft) => draft.jobId === newJob.id), 'Retry created a draft after the prose failure.')
    const retryRequests = stub.requests.slice(requestsBeforeGenerate)
    assert.deepEqual(retryRequests.map((request) => request.requestKind), ['plan', 'draft', 'draft'])
    assert.deepEqual(retryRequests.map((request) => request.responseStatus), [200, 503, 503])
    assert.equal(retryRequests.filter((request) => request.requestKind === 'plan').length, 1, 'Retry must not repeat plan generation.')
    for (const request of retryRequests) {
      assert.equal(request.model, newJob.aiRunConfig.modelName)
      assert(request.hasCurrentTask, 'A retry request lost the current task requirements.')
      for (const field of Object.keys(currentTask)) assert.equal(request.taskFieldsPresent[field], true, `Retry ${request.requestKind} request is missing task field ${field}.`)
    }
    checks.push('The actual “重试失败步骤” action kept the same job, task snapshot and frozen model, issued only the draft request again, preserved all seven completed upstream steps and did not repeat plan or context preparation.')
    result = { checks, screenshots, jobId: newJob.id, requestsBeforeGenerate, initialHttpRequests: explicitRequests.length,
      initialExplicitRequests: explicitRequests, retryRequests: retryRequests.slice(2), explicitRequests: retryRequests, aiHttpRequests: stub.requests.length,
      setup: 'Only a synthetic source task/old draft are injected through IPC in verified isolated SQLite; setup is not a UI journey.',
      scope: 'Existing production/packaged CDP renderer; save/reset/navigation/generation/retry use real UI input and real HTTP to a loopback service. The stub returns a valid ChapterPlan once and intentionally returns 503 for prose; this checks task/model request identity and failure recovery only, not remote generation quality.' }
  } catch (error) {
    failure = error
    try { await screenshot('pipeline-task-editor-failure.png') } catch {}
  }
  finally {
    if (seeded) try { await load(); await ev(`window.novelDirector.data.save(${j(original.data)})`) } catch (error) { cleanupFailures.push(error) }
    if (credentialSet) try { await ev('window.novelDirector.credentials.deleteApiKey()') } catch (error) { cleanupFailures.push(error) }
    try { await client.send('Emulation.setDeviceMetricsOverride', { ...viewport, mobile: false }) } catch (error) { cleanupFailures.push(error) }
    if (seeded) try {
      await client.send('Page.reload', { ignoreCache: true })
      await until('Boolean(window.novelDirector?.data?.load && document.querySelector(".project-list-panel"))')
    } catch (error) { cleanupFailures.push(error) }
    try { await stub.close() } catch (error) { cleanupFailures.push(error) }
  }
  if (failure || cleanupFailures.length) {
    const errors = [failure, ...cleanupFailures].filter(Boolean)
    throw new AggregateError(errors, `Pipeline task editor QA or cleanup failed: ${errors.map((error) => error.message).join('\n')}`)
  }
  return result
}

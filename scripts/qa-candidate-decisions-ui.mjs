#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'
import { runRewriteCancellation } from './utils/qa-rewrite-cancellation.mjs'
import { runReadingRewriteQA, runQuickRewritePersistenceQA } from './utils/qa-reading-rewrite.mjs'
import { runAuthorDecisions } from './utils/qa-author-decisions.mjs'
import { runCandidateUndoQA } from './utils/qa-candidate-undo.mjs'
import { runPipelineTaskEditorQA } from './utils/qa-pipeline-task-editor.mjs'
import { runProseFirstFixtureQA } from './utils/qa-prose-first-fixture.mjs'

const root = repoRoot
const packaged = process.argv.includes('--packaged')
const taskEditorOnly = process.argv.includes('--task-editor-only')
const proseOnly = process.argv.includes('--prose-only')
const qaMode = packaged ? 'packaged' : 'production-preview'
const electronExecutable = packaged
  ? join(root, 'release', 'win-unpacked', 'Novel Director.exe')
  : join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
const visualDir = join(root, 'tmp', 'visual-qa', `${proseOnly ? 'prose-first-workspaces' : taskEditorOnly ? 'pipeline-task-editor' : 'candidate-decisions'}${packaged ? '-packaged' : ''}`)
const userDataDir = join(visualDir, 'isolated-user-data')
const hashBuildDir = join(root, 'tmp', packaged ? 'candidate-decisions-ui-hash-packaged' : 'candidate-decisions-ui-hash')
const tmpRoot = resolve(root, 'tmp')
const timestamp = '2026-09-06T00:00:00.000Z'
const draftTargetRange = '她把银钥匙藏进袖口。'
const draftBody = `${draftTargetRange}\n走廊尽头的警报灯仍在闪烁，林默没有回头。`
const seededRevisionBody = `${draftTargetRange}\n走廊尽头的警报灯仍在闪烁，林默把门禁卡压在掌心。`
const editedRevisionBody = `${draftTargetRange}\n走廊尽头的警报灯仍在闪烁，林默把门禁卡压在掌心，等警报掩住开锁声。`
let fixtureDraftHash = ''
const qaResult = {
  date: new Date().toISOString(),
  mode: qaMode,
  status: 'running',
  screenshots: [],
  checks: [],
  sqlite: false,
  noAutoAi: false,
  revisionRequirementInput: null,
  revisionCandidateViewport: null
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function managedTmpDirectory(path) {
  const target = resolve(path)
  const relation = relative(tmpRoot, target)
  assert(
    Boolean(relation) && !isAbsolute(relation) && relation !== '..' && !relation.startsWith(`..${sep}`),
    `Refusing recursive cleanup outside the managed tmp directory: ${target}`
  )
  return target
}

async function clearManagedTmpDirectory(path) {
  await rm(managedTmpDirectory(path), { recursive: true, force: true })
}

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function findFreePort() {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolvePromise(port))
    })
  })
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
  }

  async open() {
    await Promise.race([
      new Promise((resolvePromise, reject) => {
        this.socket.addEventListener('open', resolvePromise, { once: true })
        this.socket.addEventListener('error', reject, { once: true })
        this.socket.addEventListener('close', () => reject(new Error('CDP closed while opening.')), { once: true })
      }),
      wait(10_000).then(() => { throw new Error('Timed out opening CDP.') })
    ])
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timeout)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result ?? {})
    })
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout)
        pending.reject(new Error('CDP closed before the command completed.'))
      }
      this.pending.clear()
    })
  }

  send(method, params = {}) {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`CDP is not open: ${method}`))
    const id = this.nextId++
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timed out waiting for CDP ${method}.`))
      }, 15_000)
      this.pending.set(id, { resolve: resolvePromise, reject, timeout })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.socket.close()
  }
}

async function discoverRenderer(port) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
      const renderer = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (renderer) return renderer
    } catch {
      // Electron has not exposed its renderer target yet.
    }
    await wait(50)
  }
  throw new Error('Electron did not expose a renderer CDP target.')
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'Renderer evaluation failed.')
  return result.result?.value
}

async function waitFor(client, expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) return
    await wait(40)
  }
  throw new Error(`Timed out waiting for renderer condition: ${expression}`)
}

async function captureScreenshot(client, filename) {
  await client.send('Page.enable')
  const result = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  const path = join(visualDir, filename)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, Buffer.from(result.data, 'base64'))
  qaResult.screenshots.push(filename)
}

async function setViewport(client, width, height) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  })
  await wait(100)
}

async function assertNoHorizontalOverflow(client, viewport) {
  const dimensions = await evaluate(client, `(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body?.scrollWidth ?? 0
  }))()`)
  assert(dimensions.documentWidth <= dimensions.viewport && dimensions.bodyWidth <= dimensions.viewport,
    `${viewport} has horizontal overflow: ${JSON.stringify(dimensions)}`)
}

async function assertRevisionCandidatePrimaryVisible(client) {
  const layout = await evaluate(client, `(() => {
    const body = document.querySelector('textarea.revision-textarea.revised')
    const accept = [...document.querySelectorAll('button')].find((item) =>
      ['接受版本', '作为整章版本接受'].includes(item.textContent?.trim() ?? '')
    )
    if (!(body instanceof HTMLTextAreaElement) || !(accept instanceof HTMLButtonElement)) return null
    const bodyRect = body.getBoundingClientRect()
    const acceptRect = accept.getBoundingClientRect()
    return {
      viewport: String(window.innerWidth) + 'x' + String(window.innerHeight),
      candidateBodyTop: Math.round(bodyRect.top),
      candidateBodyHeight: Math.round(bodyRect.height),
      acceptButtonTop: Math.round(acceptRect.top),
      acceptButtonBottom: Math.round(acceptRect.bottom),
      innerHeight: window.innerHeight
    }
  })()`)
  assert(layout && layout.viewport === '1280x720', `Revision candidate viewport is not 1280x720: ${JSON.stringify(layout)}`)
  assert(layout.candidateBodyTop >= 0 && layout.candidateBodyTop < layout.innerHeight - 100,
    `Revision candidate body is not visible in the first viewport: ${JSON.stringify(layout)}`)
  assert(layout.acceptButtonTop >= 0 && layout.acceptButtonBottom <= layout.innerHeight,
    `Revision accept button is not fully visible in the first viewport: ${JSON.stringify(layout)}`)
  qaResult.revisionCandidateViewport = layout
}

async function pressKey(client, key, { shift = false } = {}) {
  const keyDetails = key === 'Tab'
    ? { code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 }
    : key === 'Escape'
      ? { code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }
      : { code: key }
  const modifiers = shift ? 8 : 0
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers, ...keyDetails })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers, ...keyDetails })
}

async function activeButtonLabel(client) {
  return evaluate(client, `document.activeElement instanceof HTMLButtonElement ? document.activeElement.textContent?.trim() : null`)
}

async function clickButton(client, label) {
  const clicked = await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === ${JSON.stringify(label)} && !item.disabled)
    if (!button) return false
    button.focus()
    button.click()
    return true
  })()`)
  if (!clicked) throw new Error(`Could not click button: ${label}`)
}

async function openEvent(client, marker) {
  const opened = await evaluate(client, `(() => {
    const article = [...document.querySelectorAll('.inbox-event')].find((item) => item.textContent?.includes(${JSON.stringify(marker)}))
    const summary = article?.querySelector('summary')
    if (!summary || article.querySelector('details')?.open) return Boolean(summary)
    summary.click()
    return true
  })()`)
  if (!opened) throw new Error(`Could not expand inbox event containing: ${marker}`)
}

async function clickEventButton(client, marker, label) {
  const clicked = await evaluate(client, `(() => {
    const article = [...document.querySelectorAll('.inbox-event')].find((item) => item.textContent?.includes(${JSON.stringify(marker)}))
    const button = [...(article?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.trim() === ${JSON.stringify(label)} && !item.disabled)
    if (!button) return false
    button.focus()
    button.click()
    return true
  })()`)
  if (!clicked) throw new Error(`Could not click "${label}" for event: ${marker}`)
}

async function clickCandidateButton(client, candidateId, label) {
  const clicked = await evaluate(client, `(() => {
    const candidate = document.querySelector('[data-candidate-id=${JSON.stringify(candidateId)}]')
    const button = [...(candidate?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.trim() === ${JSON.stringify(label)} && !item.disabled)
    if (!button) return false
    button.focus()
    button.click()
    return true
  })()`)
  if (!clicked) throw new Error(`Could not click "${label}" for candidate: ${candidateId}`)
}

async function mainStorageSnapshot(client) {
  return evaluate(client, `(async () => {
    const loaded = await window.novelDirector.data.load()
    return {
      storagePath: loaded.storagePath,
      receipts: loaded.data.candidateDecisionReceipts.map((receipt) => ({
        id: receipt.id,
        decisions: receipt.decisions.map((item) => ({ candidateId: item.candidateId, decision: item.decision }))
      })),
      memory: Object.fromEntries(loaded.data.memoryUpdateCandidates.map((item) => [item.id, item.status])),
      state: Object.fromEntries(loaded.data.characterStateChangeCandidates.map((item) => [item.id, item.status])),
      revisions: {
        sessions: loaded.data.revisionSessions.map((item) => ({ id: item.id, sourceDraftId: item.sourceDraftId, status: item.status })),
        requests: loaded.data.revisionRequests.map((item) => ({
          id: item.id, sessionId: item.sessionId, targetRange: item.targetRange, instruction: item.instruction,
          sourceEditorialVerdictId: item.sourceEditorialVerdictId, sourceEditorialIssueId: item.sourceEditorialIssueId
        })),
        versions: loaded.data.revisionVersions.map((item) => ({
          id: item.id, sessionId: item.sessionId, requestId: item.requestId, body: item.body,
          status: item.status, sourceContentHash: item.sourceContentHash
        })),
        drafts: Object.fromEntries(loaded.data.generatedChapterDrafts.map((item) => [item.id, {
          body: item.body, status: item.status, chapterId: item.chapterId
        }])),
        draftBodies: Object.fromEntries(loaded.data.generatedChapterDrafts.map((item) => [item.id, item.body])),
        chapters: Object.fromEntries(loaded.data.chapters.map((item) => [item.id, { body: item.body, status: item.status }])),
        chapterVersionIds: loaded.data.chapterVersions.map((item) => item.id),
        revisionCommitVersionIds: loaded.data.revisionCommitBundles.map((item) => item.revisionVersionId ?? null)
      }
    }
  })()`)
}

async function assertSqliteStorage(client) {
  const { storagePath } = await mainStorageSnapshot(client)
  assert(storagePath.endsWith('.sqlite'), `Expected SQLite storage path, received: ${storagePath}`)
  assert(resolve(storagePath).startsWith(resolve(userDataDir)), `Storage escaped the isolated userData: ${storagePath}`)
  const header = await readFile(storagePath)
  assert(header.subarray(0, 16).equals(Buffer.from('SQLite format 3\u0000')), `Storage is not a SQLite database: ${storagePath}`)
  qaResult.sqlite = true
  qaResult.checks.push('The isolated storage backend is SQLite.')
}

async function seedReloadCandidateThroughMainProcess(client) {
  const candidate = memoryCandidate('qa-reload-memory', '重载候选证据：档案柜夹层留下一张编号纸条。', '重载后的编号纸条')
  const saved = await evaluate(client, `(async () => {
    const candidate = ${JSON.stringify(candidate)}
    const loaded = await window.novelDirector.data.load()
    if (loaded.data.memoryUpdateCandidates.some((item) => item.id === candidate.id)) return false
    await window.novelDirector.data.save({
      ...loaded.data,
      memoryUpdateCandidates: [...loaded.data.memoryUpdateCandidates, candidate]
    })
    return true
  })()`)
  assert(saved, 'Could not seed the reload candidate through the main-process storage save.')
}

async function seedRevisionVersionThroughMainProcess(client) {
  const seeded = await evaluate(client, `(async () => {
    const loaded = await window.novelDirector.data.load()
    const session = loaded.data.revisionSessions.find((item) => item.sourceDraftId === 'qa-draft' && item.status === 'active')
    const request = session
      ? loaded.data.revisionRequests.find((item) => item.sessionId === session.id && item.sourceEditorialIssueId === 'qa-editorial-blocker')
      : null
    const draft = loaded.data.generatedChapterDrafts.find((item) => item.id === 'qa-draft')
    if (!session || !request || !draft || !request.sourceDraftContentHash ||
      loaded.data.revisionVersions.some((item) => item.id === 'qa-pending-revision-version')) return null
    const now = new Date().toISOString()
    const version = {
      id: 'qa-pending-revision-version',
      sessionId: session.id,
      requestId: request.id,
      title: '银钥匙动作衔接 · 修订候选',
      body: ${JSON.stringify(seededRevisionBody)},
      changedSummary: '补足开锁动作与警报之间的衔接。',
      risks: '不新增设定。',
      preservedFacts: '保留银钥匙、警报与林默未回头。',
      sourceContentHash: request.sourceDraftContentHash,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    }
    await window.novelDirector.data.save({
      ...loaded.data,
      revisionVersions: [...loaded.data.revisionVersions, version]
    })
    return {
      versionId: version.id,
      sessionId: session.id,
      requestId: request.id,
      sourceContentHash: version.sourceContentHash,
      draftChapterId: draft.chapterId
    }
  })()`)
  assert(seeded, 'Could not seed a pending revision version for the C2 revision session.')
  assert(seeded.sourceContentHash === fixtureDraftHash, 'Seeded revision version does not match the current C2 draft hash.')
  return seeded
}

async function reloadIntoRevisionDraft(client) {
  await client.send('Page.reload', { ignoreCache: true })
  await waitFor(client, `Boolean([...document.querySelectorAll('button')].some((item) => item.textContent?.trim() === '进入'))`, 30_000)
  await clickButton(client, '进入')
  await waitFor(client, `Boolean(document.querySelector('.dashboard-view') && !document.querySelector('.view-loading'))`)
  await clickButton(client, '修订工作台')
  await waitFor(client, `Boolean(document.querySelector('.revision-view') && !document.querySelector('.view-loading'))`)
  await clickButton(client, '草稿')
  await waitFor(client, `Boolean(document.querySelector('.revision-view .revision-compare.has-versions'))`)
}

async function editRevisionCandidateBody(client, value) {
  await client.send('Page.bringToFront')
  const focused = await evaluate(client, `(() => {
    const textarea = document.querySelector('textarea.revision-textarea.revised')
    if (!(textarea instanceof HTMLTextAreaElement)) return false
    textarea.focus()
    textarea.setSelectionRange(0, textarea.value.length)
    return document.activeElement === textarea
  })()`)
  assert(focused, 'Could not focus the pending revision version in the workbench textarea.')
  // Use native input instead of bypassing React's value tracker with a DOM setter.
  await client.send('Input.insertText', { text: value })
  await waitFor(client, `document.querySelector('textarea.revision-textarea.revised')?.value === ${JSON.stringify(value)}`)
  const point = await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('.revision-view-switch button')]
      .find((item) => item.textContent?.trim() === '修订后')
    if (!button) return null
    const rect = button.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  assert(point, 'Could not locate the revision tab for a native focus change.')
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
}

function assertReceipt(snapshot, candidateIds, decision) {
  const receipt = snapshot.receipts.find((item) =>
    item.decisions.length === candidateIds.length &&
    candidateIds.every((candidateId) => item.decisions.some((entry) => entry.candidateId === candidateId && entry.decision === decision))
  )
  assert(receipt, `Main storage has no ${decision} receipt for: ${candidateIds.join(', ')}`)
}

function settings() {
  return {
    apiProvider: 'openai', apiKey: '', hasApiKey: false, baseUrl: 'https://api.openai.com/v1', modelName: 'gpt-4.1',
    codexCliPath: 'codex', codexCliModel: '', temperature: 0.8, maxTokens: 8000, retryEnabled: true, maxRetries: 3,
    requestTimeoutMs: 300000, pipelineModelRoles: {}, enableAutoSummary: false, enableChapterDiagnostics: false,
    defaultTokenBudget: 16000, defaultPromptMode: 'standard', theme: 'system'
  }
}

function memoryCandidate(id, evidence, title, patch = null) {
  return {
    id, projectId: 'qa-project', jobId: 'qa-job', type: 'foreshadowing', targetId: null,
    proposedPatch: patch ?? {
      schemaVersion: 1, kind: 'foreshadowing_create', summary: `${title}将成为伏笔`, sourceChapterOrder: 3, warnings: [],
      candidate: {
        title, description: `${title}的虚构描述。`, firstChapterOrder: 3, suggestedWeight: 'medium',
        expectedPayoff: '后续章节验证该线索。', relatedCharacterIds: ['qa-character'], recommendedTreatmentMode: 'hint', notes: 'Electron UI QA fixture.'
      }
    },
    evidence, confidence: 0.86, status: 'pending', createdAt: timestamp, updatedAt: timestamp
  }
}

function fixture(draftHash) {
  const batchEvidence = '批量事件证据：林默用银钥匙打开档案柜。'
  const legacyEvidence = '损坏候选证据：旧录音带只剩一段杂音。'
  return {
    schemaVersion: 3,
    projects: [{
      id: 'qa-project', name: '候选决定界面验收', genre: '悬疑', description: '仅用于隔离 Electron UI 验收。',
      targetReaders: '成年读者', coreAppeal: '证据推理', style: '克制清晰', createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp
    }],
    storyBibles: [],
    chapters: [{
      id: 'qa-chapter', projectId: 'qa-project', order: 3, title: '银钥匙', body: '林默用银钥匙打开档案柜，手掌留下浅色烫痕。',
      summary: '', newInformation: '', characterChanges: '', newForeshadowing: '', resolvedForeshadowing: '', endingHook: '', riskWarnings: '',
      includedInStageSummary: false, createdAt: timestamp, updatedAt: timestamp
    }],
    characters: [{
      id: 'qa-character', projectId: 'qa-project', name: '林默', role: '主角', roleFunction: '', surfaceGoal: '', deepNeed: '', coreFear: '',
      decisionLogic: '', abilitiesAndResources: '', weaknessAndCost: '', relationshipTension: '', futureHooks: '', createdAt: timestamp, updatedAt: timestamp
    }],
    characterStateLogs: [], characterStateFacts: [], characterStateTransactions: [], foreshadowings: [], timelineEvents: [], stageSummaries: [],
    promptVersions: [], promptContextSnapshots: [], storyDirectionGuides: [], hardCanonPacks: [], contextNeedPlans: [], chapterContinuityBridges: [],
    chapterGenerationJobs: [{
      id: 'qa-job', projectId: 'qa-project', targetChapterOrder: 3, promptContextSnapshotId: null, contextSource: 'auto', status: 'completed',
      currentStep: 'await_user_confirmation', createdAt: timestamp, updatedAt: timestamp, errorMessage: ''
    }],
    chapterGenerationSteps: [],
    generatedChapterDrafts: [{
      id: 'qa-draft', projectId: 'qa-project', chapterId: 'qa-chapter', jobId: 'qa-job', title: '银钥匙草稿', body: draftBody,
      summary: '林默在警报响起前藏起银钥匙。', status: 'draft', tokenEstimate: 36, createdAt: timestamp, updatedAt: timestamp
    }],
    memoryUpdateCandidates: [
      memoryCandidate('qa-batch-memory', batchEvidence, '银钥匙的来历'),
      memoryCandidate('qa-reject-memory', '单条拒绝证据：门卫的纸条被风吹走。', '门卫纸条'),
      memoryCandidate('qa-broken-memory', legacyEvidence, '损坏旧候选', '{this is invalid legacy json'),
      memoryCandidate('qa-valid-after-legacy', legacyEvidence, '录音带编号')
    ],
    characterStateChangeCandidates: [{
      id: 'qa-batch-state', projectId: 'qa-project', jobId: 'qa-job', characterId: 'qa-character', chapterId: 'qa-chapter', chapterOrder: 3,
      candidateType: 'create_fact', targetFactId: null,
      proposedFact: {
        id: 'qa-state-fact', projectId: 'qa-project', characterId: 'qa-character', category: 'physical', key: 'left-palm-burn', label: '左手掌烫痕',
        valueType: 'text', value: '左手掌留有新鲜烫痕。', unit: '', linkedCardFields: ['weaknessAndCost'], trackingLevel: 'hard',
        promptPolicy: 'when_relevant', status: 'active', sourceChapterId: 'qa-chapter', sourceChapterOrder: 3, evidence: batchEvidence,
        confidence: 0.9, createdAt: timestamp, updatedAt: timestamp
      },
      proposedTransaction: null, beforeValue: null, afterValue: '左手掌留有新鲜烫痕。', evidence: batchEvidence,
      confidence: 0.9, riskLevel: 'high', status: 'pending', createdAt: timestamp, updatedAt: timestamp
    }],
    candidateDecisionReceipts: [], consistencyReviewReports: [], contextBudgetProfiles: [], qualityGateReports: [], generationRunTraces: [],
    runTraceAuthorSummaries: [], redundancyReports: [], editorialVerdicts: [{
      id: 'qa-editorial-verdict', projectId: 'qa-project', chapterId: 'qa-chapter', jobId: 'qa-job', draftId: 'qa-draft',
      draftContentHash: draftHash, draftRevision: timestamp, status: 'blocked', coverage: { quality: 'current', consistency: 'current' }, canAccept: false,
      summary: '有一处必须先修订的衔接问题。', blockers: [{
        id: 'qa-editorial-blocker', level: 'blocker', source: 'consistency_review', code: 'previous_chapter_contradiction',
        title: '银钥匙的藏匿动作需要交代', evidence: [draftTargetRange],
        recommendation: '只调整这句，补足动作动机，不改变警报后的既有情节。', sourceId: 'qa-consistency-report'
      }], advisories: [], actions: [{ actionType: 'revise_draft', label: '修订这处动作', reason: '证据可唯一定位。', priority: 1 }],
      sourceRefs: { qualityGateReportId: null, consistencyReviewReportId: 'qa-consistency-report', redundancyReportId: null,
        noveltyAuditTraceId: null, generationRunTraceId: null, characterStateIssueIds: [], ignoredStaleReportIds: [] },
      schemaVersion: 1, createdAt: timestamp, updatedAt: timestamp
    }], revisionCandidates: [], revisionSessions: [], revisionRequests: [],
    revisionVersions: [], chapterVersions: [], chapterCommitBundles: [], revisionCommitBundles: [], agentRuns: [], agentActionPreviews: [], settings: settings()
  }
}

async function loadDraftContentHash() {
  await clearManagedTmpDirectory(hashBuildDir)
  await mkdir(hashBuildDir, { recursive: true })
  const outfile = join(hashBuildDir, 'draft-content-hash.mjs')
  await build({
    entryPoints: [join(root, 'src', 'services', 'DraftDiagnosticBindingService.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  const module = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
  return module.draftContentHash(draftBody)
}

async function launchElectron(port) {
  const logs = []
  const launchArgs = [`--remote-debugging-port=${port}`]
  if (!packaged) launchArgs.push(root)
  const child = spawn(electronExecutable, launchArgs, {
    cwd: root,
    env: { ...process.env, NOVEL_DIRECTOR_SMOKE_USER_DATA: userDataDir, ELECTRON_ENABLE_LOGGING: '0' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', (chunk) => logs.push(String(chunk)))
  child.stderr.on('data', (chunk) => logs.push(String(chunk)))
  return { child, logs }
}

async function closeElectron(child, client) {
  try {
    if (client) await Promise.race([client.send('Browser.close').catch(() => undefined), wait(250)])
  } finally {
    client?.close()
  }
  if (await waitForProcessExit(child, 5_000)) return

  try {
    child.kill()
  } catch {
    // The process may have exited in the gap before the fallback kill.
  }
  if (await waitForProcessExit(child, 5_000)) return

  try {
    child.kill('SIGKILL')
  } catch {
    // A final exit check below determines whether cleanup actually completed.
  }
  if (!await waitForProcessExit(child, 5_000)) {
    throw new Error(`Electron process ${child.pid} did not exit after cleanup.`)
  }
}

async function waitForProcessExit(child, timeoutMs) {
  if (hasProcessExited(child)) return true
  return new Promise((resolvePromise) => {
    let settled = false
    const finish = (exited) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.off('exit', onExit)
      resolvePromise(exited)
    }
    const onExit = () => finish(true)
    const timeout = setTimeout(() => finish(hasProcessExited(child)), timeoutMs)
    child.once('exit', onExit)
  })
}

function hasProcessExited(child) {
  return child.exitCode !== null || child.signalCode !== null
}

async function withElectron(action) {
  const port = await findFreePort()
  const { child, logs } = await launchElectron(port)
  let client = null
  try {
    const renderer = await discoverRenderer(port)
    client = new CdpClient(renderer.webSocketDebuggerUrl)
    await client.open()
    await client.send('Runtime.enable')
    return await action(client)
  } catch (error) {
    if (client) {
      try {
        await captureScreenshot(client, 'failure.png')
        const state = await evaluate(client, `({ active: document.activeElement?.className,
          editedBody: document.querySelector('textarea.revision-textarea.revised')?.value,
          view: document.querySelector('.revision-view')?.textContent?.slice(-2000) })`)
        await writeFile(join(visualDir, 'failure.json'), JSON.stringify({ error: error.message, state }, null, 2))
      } catch { /* The renderer may already have exited. */ }
    }
    throw new Error(`${error.message}\nElectron output:\n${logs.join('')}`)
  } finally {
    await closeElectron(child, client)
  }
}

async function bootstrapFixture() {
  await clearManagedTmpDirectory(visualDir)
  await mkdir(userDataDir, { recursive: true })
  const draftHash = await loadDraftContentHash()
  fixtureDraftHash = draftHash
  await writeFile(join(userDataDir, 'novel-director-data.json'), `${JSON.stringify(fixture(draftHash), null, 2)}\n`, 'utf8')
  await withElectron(async (client) => {
    await waitFor(client, `Boolean(window.novelDirector?.data?.load && [...document.querySelectorAll('button')].some((item) => item.textContent?.trim() === '进入'))`, 30_000)
  })
}

async function runQa() {
  await withElectron(async (client) => {
    await waitFor(client, `Boolean([...document.querySelectorAll('button')].some((item) => item.textContent?.trim() === '进入'))`, 30_000)
    await assertSqliteStorage(client)
    await clickButton(client, '进入')
    await waitFor(client, `Boolean(document.querySelector('.dashboard-view') && !document.querySelector('.view-loading'))`)
    await clickButton(client, '决策收件箱')
    await waitFor(client, `Boolean(document.querySelector('.decision-inbox-view') && document.querySelectorAll('.inbox-event').length === 3)`)
    await captureScreenshot(client, '01-inbox.png')

    await openEvent(client, '批量事件证据')
    await captureScreenshot(client, '02-batch-expanded.png')
    await clickEventButton(client, '批量事件证据', '接受本事件并写入')
    await waitFor(client, `Boolean(document.querySelector('.confirm-dialog'))`)
    assert(await activeButtonLabel(client) === '先返回核对', 'A confirmation with a cancel action must initially focus Cancel.')
    await pressKey(client, 'Tab', { shift: true })
    assert(await activeButtonLabel(client) === '确认处理', 'Shift+Tab did not wrap focus to the final confirmation action.')
    await pressKey(client, 'Tab')
    assert(await activeButtonLabel(client) === '先返回核对', 'Tab did not wrap focus back to the first dialog action.')
    await pressKey(client, 'Tab')
    assert(await activeButtonLabel(client) === '确认处理', 'Tab did not move focus to the confirmation action.')
    await pressKey(client, 'Tab', { shift: true })
    assert(await activeButtonLabel(client) === '先返回核对', 'Shift+Tab did not stay within the confirmation dialog.')
    await pressKey(client, 'Escape')
    await waitFor(client, `!document.querySelector('.confirm-dialog')`)
    await waitFor(client, `document.activeElement instanceof HTMLButtonElement && document.activeElement.textContent?.trim() === '接受本事件并写入'`)

    await clickEventButton(client, '批量事件证据', '接受本事件并写入')
    await waitFor(client, `Boolean(document.querySelector('.confirm-dialog'))`)
    await captureScreenshot(client, '03-high-risk-confirmation.png')
    await clickButton(client, '确认处理')
    await waitFor(client, `(async () => {
      const loaded = await window.novelDirector.data.load()
      return loaded.data.memoryUpdateCandidates.some((item) => item.id === 'qa-batch-memory' && item.status === 'accepted') &&
        loaded.data.characterStateChangeCandidates.some((item) => item.id === 'qa-batch-state' && item.status === 'accepted')
    })()`)
    let snapshot = await mainStorageSnapshot(client)
    assert(snapshot.memory['qa-batch-memory'] === 'accepted', 'Batch memory candidate was not accepted in main storage.')
    assert(snapshot.state['qa-batch-state'] === 'accepted', 'Batch state candidate was not accepted in main storage.')
    assertReceipt(snapshot, ['qa-batch-memory', 'qa-batch-state'], 'accept')
    qaResult.checks.push('High-risk confirmation traps focus, cancels with Escape, and persists one atomic batch receipt.')
    await captureScreenshot(client, '04-after-batch-accept.png')

    await openEvent(client, '单条拒绝证据')
    await clickCandidateButton(client, 'qa-reject-memory', '拒绝')
    await waitFor(client, `(async () => (await window.novelDirector.data.load()).data.memoryUpdateCandidates.some((item) => item.id === 'qa-reject-memory' && item.status === 'rejected'))()`)
    snapshot = await mainStorageSnapshot(client)
    assertReceipt(snapshot, ['qa-reject-memory'], 'reject')

    await openEvent(client, '损坏候选证据')
    const groupAcceptDisabled = await evaluate(client, `(() => {
      const article = [...document.querySelectorAll('.inbox-event')].find((item) => item.textContent?.includes('损坏候选证据'))
      return [...(article?.querySelectorAll('button') ?? [])].some((item) => item.textContent?.trim() === '接受本事件并写入' && item.disabled)
    })()`)
    assert(groupAcceptDisabled, 'Malformed group still allows batch acceptance.')
    await captureScreenshot(client, '05-malformed-candidate.png')
    await clickCandidateButton(client, 'qa-broken-memory', '拒绝')
    await waitFor(client, `(async () => (await window.novelDirector.data.load()).data.memoryUpdateCandidates.some((item) => item.id === 'qa-broken-memory' && item.status === 'rejected'))()`)
    await openEvent(client, '损坏候选证据')
    await clickCandidateButton(client, 'qa-valid-after-legacy', '接受')
    await waitFor(client, `(async () => (await window.novelDirector.data.load()).data.memoryUpdateCandidates.some((item) => item.id === 'qa-valid-after-legacy' && item.status === 'accepted'))()`)
    snapshot = await mainStorageSnapshot(client)
    assertReceipt(snapshot, ['qa-broken-memory'], 'reject')
    assertReceipt(snapshot, ['qa-valid-after-legacy'], 'accept')
    assert(snapshot.receipts.length === 4, `Expected four persisted receipts, received ${snapshot.receipts.length}.`)
    qaResult.checks.push('Malformed candidates disable group acceptance but remain individually rejectable.')
    await captureScreenshot(client, '06-complete.png')

    await clickButton(client, '生产流水线')
    await waitFor(client, `Boolean(document.querySelector('.generation-view') && !document.querySelector('.view-loading'))`)
    await waitFor(client, `Boolean([...document.querySelectorAll('button')].some((item) => item.textContent?.trim() === '修这一处'))`, 30_000)
    await clickButton(client, '修这一处')
    await waitFor(client, `Boolean(document.querySelector('.revision-view .revision-compare.no-versions'))`, 30_000)
    await waitFor(client, `(async () => {
      const loaded = await window.novelDirector.data.load()
      return loaded.data.revisionSessions.some((item) => item.sourceDraftId === 'qa-draft' && item.status === 'active') &&
        loaded.data.revisionRequests.some((item) => item.sourceEditorialVerdictId === 'qa-editorial-verdict' && item.sourceEditorialIssueId === 'qa-editorial-blocker')
    })()`)
    snapshot = await mainStorageSnapshot(client)
    const revisionSession = snapshot.revisions.sessions.find((item) => item.sourceDraftId === 'qa-draft' && item.status === 'active')
    const revisionRequest = snapshot.revisions.requests.find((item) => item.sessionId === revisionSession?.id)
    assert(revisionSession, 'Editorial blocker did not persist an active revision session for the source draft.')
    assert(revisionRequest?.targetRange === draftTargetRange, 'Editorial blocker did not persist the unique evidence target range.')
    assert(revisionRequest?.instruction.includes('银钥匙的藏匿动作需要交代'), 'Editorial blocker instruction was not persisted.')
    assert(snapshot.revisions.versions.length === 0, 'Opening an editorial revision request must not auto-generate a revision version.')
    assert(snapshot.revisions.draftBodies['qa-draft'] === draftBody, 'Opening an editorial revision request must not alter the draft body.')
    qaResult.noAutoAi = true
    qaResult.checks.push('C2 editorial blocker persists its source request without generating a version or changing the draft.')
    const revisionForm = await evaluate(client, `(() => {
      const valueFor = (label) => [...document.querySelectorAll('label.field')]
        .find((field) => field.querySelector('.field-label')?.textContent?.trim() === label)
        ?.querySelector('textarea')?.value ?? null
      return { targetRange: valueFor('局部修订文本'), instruction: valueFor('修改要求') }
    })()`)
    assert(revisionForm.targetRange === draftTargetRange, 'Revision workbench did not display the persisted target range.')
    assert(revisionForm.instruction?.includes('银钥匙的藏匿动作需要交代'), 'Revision workbench did not display the persisted instruction.')

    await setViewport(client, 1440, 900)
    await assertNoHorizontalOverflow(client, '1440x900 revision empty state')
    await captureScreenshot(client, '07-revision-empty-1440x900.png')
    await setViewport(client, 1280, 720)
    await assertNoHorizontalOverflow(client, '1280x720 revision empty state')
    const requirementInput = await evaluate(client, `(() => {
      const field = [...document.querySelectorAll('label.field')]
        .find((item) => item.querySelector('.field-label')?.textContent?.trim() === '修改要求')
      const textarea = field?.querySelector('textarea')
      if (!textarea) return null
      const rect = textarea.getBoundingClientRect()
      return { top: Math.round(rect.top), height: Math.round(rect.height), innerHeight: window.innerHeight }
    })()`)
    assert(requirementInput && requirementInput.top < requirementInput.innerHeight - 100,
      `Revision requirement input is not visible above the 1280x720 fold: ${JSON.stringify(requirementInput)}`)
    qaResult.revisionRequirementInput = { viewport: '1280x720', ...requirementInput }
    qaResult.checks.push('Revision empty state has no horizontal overflow and keeps the requirement input above the 1280x720 fold.')
    await captureScreenshot(client, '08-revision-empty-1280x720.png')

    // This fixture is saved through the main-process IPC, then reloaded so the
    // renderer must render and decide against fresh persisted data without AI.
    await seedReloadCandidateThroughMainProcess(client)
    await client.send('Page.reload', { ignoreCache: true })
    await waitFor(client, `Boolean([...document.querySelectorAll('button')].some((item) => item.textContent?.trim() === '进入'))`, 30_000)
    await clickButton(client, '进入')
    await waitFor(client, `Boolean(document.querySelector('.dashboard-view') && !document.querySelector('.view-loading'))`)
    await clickButton(client, '决策收件箱')
    await waitFor(client, `Boolean(document.querySelector('[data-candidate-id="qa-reload-memory"]'))`)
    await openEvent(client, '重载候选证据')
    await clickCandidateButton(client, 'qa-reload-memory', '接受')
    await waitFor(client, `(async () => (await window.novelDirector.data.load()).data.memoryUpdateCandidates.some((item) => item.id === 'qa-reload-memory' && item.status === 'accepted'))()`)
    snapshot = await mainStorageSnapshot(client)
    assertReceipt(snapshot, ['qa-reload-memory'], 'accept')
    qaResult.checks.push('A fixture candidate saved through the main process is rendered after reload and accepted through the inbox UI.')

    const seededRevision = await seedRevisionVersionThroughMainProcess(client)
    await reloadIntoRevisionDraft(client)
    await setViewport(client, 1280, 720)
    await clickButton(client, '修订后')
    await waitFor(client, `document.querySelector('textarea.revision-textarea.revised')?.value === ${JSON.stringify(seededRevisionBody)}`)
    await assertRevisionCandidatePrimaryVisible(client)
    await editRevisionCandidateBody(client, editedRevisionBody)
    await waitFor(client, `(async () => (await window.novelDirector.data.load()).data.revisionVersions
      .some((item) => item.id === 'qa-pending-revision-version' && item.body === ${JSON.stringify(editedRevisionBody)} && item.status === 'pending'))()`)

    const beforeRevisionAcceptance = await mainStorageSnapshot(client)
    const beforeDraft = beforeRevisionAcceptance.revisions.drafts['qa-draft']
    const beforeLinkedChapter = seededRevision.draftChapterId
      ? beforeRevisionAcceptance.revisions.chapters[seededRevision.draftChapterId]
      : null
    const beforeChapterVersionCount = beforeRevisionAcceptance.revisions.chapterVersionIds.length

    await clickButton(client, '接受版本')
    await waitFor(client, `Boolean(document.querySelector('.confirm-dialog'))`)
    const confirmationCount = await evaluate(client, `document.querySelectorAll('.confirm-dialog').length`)
    assert(confirmationCount === 1, `Revision acceptance should show one confirmation dialog, received ${confirmationCount}.`)
    await clickButton(client, '接受修订')
    await waitFor(client, `(async () => {
      const loaded = await window.novelDirector.data.load()
      return loaded.data.revisionVersions.some((item) => item.id === 'qa-pending-revision-version' &&
        item.body === ${JSON.stringify(editedRevisionBody)} && item.status === 'accepted')
    })()`)
    await waitFor(client, `!document.querySelector('.confirm-dialog')`)

    snapshot = await mainStorageSnapshot(client)
    const acceptedVersion = snapshot.revisions.versions.find((item) => item.id === seededRevision.versionId)
    const acceptedDraft = snapshot.revisions.drafts['qa-draft']
    assert(acceptedVersion?.body === editedRevisionBody && acceptedVersion.status === 'accepted',
      'Accepted revision version did not retain the locally edited body.')
    assert(acceptedDraft?.body === editedRevisionBody, 'Accepting the revision version did not update the source draft body.')
    if (seededRevision.draftChapterId) {
      const acceptedChapter = snapshot.revisions.chapters[seededRevision.draftChapterId]
      assert(acceptedDraft?.status === 'accepted', 'A linked source draft was not marked accepted.')
      assert(acceptedChapter?.body === editedRevisionBody,
        'A linked source draft did not write the accepted revision body to its chapter.')
      assert(snapshot.revisions.chapterVersionIds.length === beforeChapterVersionCount + 1,
        'A linked source draft acceptance did not create exactly one chapter version.')
      assert(snapshot.revisions.revisionCommitVersionIds.includes(seededRevision.versionId),
        'A linked source draft acceptance did not persist its revision commit bundle.')
    } else {
      assert(acceptedDraft?.status === 'draft', 'An unlinked draft was incorrectly marked as formally accepted.')
      assert(snapshot.revisions.chapterVersionIds.length === beforeChapterVersionCount,
        'An unlinked draft acceptance incorrectly created a chapter version.')
      assert(JSON.stringify(snapshot.revisions.chapters) === JSON.stringify(beforeRevisionAcceptance.revisions.chapters),
        'An unlinked draft acceptance incorrectly changed a formal chapter.')
    }
    assert(beforeDraft?.body === draftBody, 'The revision fixture source draft changed before acceptance.')
    if (beforeLinkedChapter) {
      assert(beforeLinkedChapter.body !== editedRevisionBody, 'The linked chapter changed before revision acceptance.')
    }

    await reloadIntoRevisionDraft(client)
    await clickButton(client, '修订后')
    await waitFor(client, `document.querySelector('textarea.revision-textarea.original')?.value === ${JSON.stringify(editedRevisionBody)}`)
    await waitFor(client, `document.querySelector('textarea.revision-textarea.revised')?.value === ${JSON.stringify(editedRevisionBody)}`)
    qaResult.checks.push('A pending C2 revision version keeps its body and accept action visible at 1280x720, is edited, accepted with one confirmation, written to its valid target, and remains readable after reload.')
    await captureScreenshot(client, '09-revision-version-accepted-reloaded.png')

    await clickButton(client, '设置')
    await waitFor(client, `Boolean(document.querySelector('.settings-runtime-info'))`)
    await evaluate(client, `document.querySelector('.settings-runtime-info').open = true`)
    const runtimeInfo = await evaluate(client, `window.novelDirector.app.getRuntimeInfo()`)
    const expectedVersion = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
    assert(runtimeInfo.version === expectedVersion, `Running version mismatch: ${runtimeInfo.version} / ${expectedVersion}`)
    assert(Number.isFinite(Date.parse(runtimeInfo.buildTime)), 'Runtime build time is missing or invalid.')
    assert(runtimeInfo.mode === (packaged ? 'packaged' : 'preview'), 'Runtime mode does not match the launched executable.')
    await waitFor(client, `document.querySelector('.settings-runtime-info')?.textContent.includes(${JSON.stringify(expectedVersion)})`)
    await assertNoHorizontalOverflow(client, '1280x720 runtime info')
    await evaluate(client, `document.querySelector('.settings-runtime-info').scrollIntoView({ block: 'center' })`)
    qaResult.runtimeInfo = runtimeInfo
    qaResult.checks.push('Settings displays the actual running version, UTC build time, executable, data path and runtime mode.')
    await captureScreenshot(client, '10-runtime-info.png')

    const cancellation = await runRewriteCancellation({ client, evaluate, waitFor, clickButton, captureScreenshot })
    qaResult.checks.push(...cancellation.checks)
    qaResult.rewriteCancellation = { timing: cancellation.timing, provider: 'loopback-stub-only' }

    assert(beforeLinkedChapter, 'Restore QA requires a revision linked to a formal chapter.')
    const beforeRestore = await mainStorageSnapshot(client)
    await clickButton(client, '版本历史')
    await waitFor(client, `Boolean(document.querySelector('.version-history-item'))`)
    const openedBaseline = await evaluate(client, `(() => {
      const button = [...document.querySelectorAll('.version-history-item')]
        .find((item) => item.textContent?.includes('修订前正文'))
      button?.click()
      return Boolean(button)
    })()`)
    assert(openedBaseline, 'The first revision beforeText is missing from the version history UI.')
    await waitFor(client, `document.querySelector('.version-preview-text')?.textContent === ${JSON.stringify(beforeLinkedChapter.body)}`)
    await clickButton(client, '恢复此版本')
    await waitFor(client, `Boolean(document.querySelector('.confirm-dialog'))`)
    await clickButton(client, '创建恢复版本')
    await waitFor(client, `(async () => (await window.novelDirector.data.load()).data.chapters
      .find((item) => item.id === 'qa-chapter')?.body === ${JSON.stringify(beforeLinkedChapter.body)})()`)
    await waitFor(client, `document.querySelector('textarea.manuscript-textarea')?.value === ${JSON.stringify(beforeLinkedChapter.body)}`)
    const afterRestore = await mainStorageSnapshot(client)
    assert(afterRestore.revisions.chapterVersionIds.length === beforeRestore.revisions.chapterVersionIds.length + 1,
      'Restoring the virtual baseline must create exactly one committed chapter version.')
    assert(beforeRestore.revisions.chapterVersionIds.every((id) => afterRestore.revisions.chapterVersionIds.includes(id)),
      'Restoring the virtual baseline removed a previous committed version.')
    await evaluate(client, `document.querySelector('.version-history-panel').scrollIntoView({ block: 'start' })`)
    await captureScreenshot(client, '13-restored-before-revision.png')
    qaResult.checks.push('The virtual pre-revision body can be restored through the UI as one new committed version without deleting previous versions.')
    qaResult.checks.push(...await runAuthorDecisions({ client, evaluate, waitFor, clickButton, openEvent,
      clickCandidateButton, captureScreenshot, assertNoHorizontalOverflow }))
    const readingDriver = { client,
      evaluate: async (expression) => {
        try { return await evaluate(client, expression) }
        catch (error) { throw new Error(`Reading QA evaluation (${expression.slice(0, 180)}): ${error.message}`) }
      },
      waitFor: (expression, timeout) => waitFor(client, expression, timeout),
      clickButton: (label) => clickButton(client, label),
      captureScreenshot: (_client, filename) => captureScreenshot(client, filename) }
    const reading = await runReadingRewriteQA(readingDriver)
    qaResult.checks.push(...reading.checks)
    qaResult.readingRewrite = { provider: 'loopback-stub-only', requestCount: reading.requestCount }
    const persistence = await runQuickRewritePersistenceQA(readingDriver)
    qaResult.checks.push(...persistence.checks)
    qaResult.quickRewritePersistence = { provider: 'loopback-stub-only', requestCount: persistence.requestCount }
    const candidateUndo = await runCandidateUndoQA({ client, evaluate, waitFor, clickButton, openEvent,
      clickCandidateButton, isolatedUserDataDir: userDataDir,
      captureScreenshot: (_client, filename) => captureScreenshot(client, filename) })
    qaResult.checks.push(...candidateUndo.checks)
    qaResult.candidateUndo = { setup: candidateUndo.setup, scope: candidateUndo.scope }
    await runTaskEditorQa(client)
    await runProseQa(client)
    await assertSqliteStorage(client)
  })
}

async function runTaskEditorQa(client) {
  await waitFor(client, 'Boolean(window.novelDirector?.data?.load)', 30_000)
  const result = await runPipelineTaskEditorQA({ client, evaluate, waitFor, captureScreenshot, isolatedUserDataDir: userDataDir })
  qaResult.checks.push(...result.checks)
  qaResult.sqlite = true
  qaResult.noAutoAi = true
  qaResult.taskEditor = { setup: result.setup, scope: result.scope, jobId: result.jobId,
    requestsBeforeGenerate: result.requestsBeforeGenerate, explicitRequests: result.explicitRequests,
    aiHttpRequests: result.aiHttpRequests }
}

async function runProseQa(client) {
  await waitFor(client, 'Boolean(window.novelDirector?.data?.load)', 30_000)
  const result = await runProseFirstFixtureQA({ client, evaluate, waitFor, captureScreenshot, isolatedUserDataDir: userDataDir })
  qaResult.checks.push(...result.checks)
  qaResult.proseFirstWorkspaces = result
  qaResult.sqlite = true
  qaResult.noAutoAi = true
}

async function writeQaResult() {
  qaResult.status = 'passed'
  await writeFile(join(visualDir, 'result.json'), `${JSON.stringify(qaResult, null, 2)}\n`, 'utf8')
}

async function main() {
  if (proseOnly && taskEditorOnly) throw new Error('--prose-only and --task-editor-only cannot be combined.')
  if (packaged && process.platform !== 'win32') {
    throw new Error('--packaged is supported only on Windows because it launches the Windows release executable.')
  }
  if (!packaged && (!existsSync(join(root, 'out', 'main', 'index.js')) || !existsSync(join(root, 'out', 'renderer', 'index.html')))) {
    throw new Error('Production build output is missing. Build the app before running this Electron UI QA script.')
  }
  if (!existsSync(electronExecutable)) {
    throw new Error(`${packaged ? 'Packaged application' : 'Electron executable'} not found: ${electronExecutable}`)
  }
  await bootstrapFixture()
  if (proseOnly) await withElectron(runProseQa)
  else if (taskEditorOnly) await withElectron(runTaskEditorQa)
  else await runQa()
  await writeQaResult()
  console.log(`candidate decisions ${qaMode} UI QA passed; screenshots: ${visualDir}`)
}

main().catch((error) => {
  console.error(`candidate decisions UI QA failed: ${error.message}`)
  process.exitCode = 1
})

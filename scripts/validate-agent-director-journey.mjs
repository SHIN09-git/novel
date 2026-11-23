#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'
import { validateChapterWorkItemReconnect } from './utils/chapter-work-item-reconnect.mjs'
import { assertStaleCandidates, leaveStoppedClaim, oldEnding, revisedEnding, verifyDraftRevisionLoop } from './utils/agent-priority-fixes.mjs'
import { checkGenerationGate, openBookWithOneGrant, rejectedRevisionMarker, verifyBookRevisionBatch } from './utils/agent-book-creative-workflow.mjs'
import { openLibraryWithOneGrant, verifyArchiveAndHistory } from './utils/agent-library-management.mjs'
import { mockAgentEndpoint, openPackagedAgentJourney } from './utils/packaged-agent-journey.mjs'
import { openReviewRecovery } from './fixtures/agent-director-review-recovery.mjs'

const tempRoot = join(repoRoot, 'tmp')
const originalFetch = globalThis.fetch
const originalApiKey = process.env.NOVEL_DIRECTOR_API_KEY
const originalRegistry = process.env.NOVEL_DIRECTOR_API_REGISTRY
const priorityFixes = process.argv.includes('--priority-fixes')
const libraryManagement = process.argv.includes('--library-management')
const bookCreative = libraryManagement || process.argv.includes('--book-creative')
const nativeProse = process.argv.includes('--agent-prose')
const settlement = process.argv.includes('--chapter-settlement')
const useWorkItems = priorityFixes || bookCreative || nativeProse || settlement || process.argv.includes('--work-items')
const useSqlite = process.argv.includes('--sqlite')
const packaged = process.argv.includes('--packaged')
if (packaged) assert(useSqlite && bookCreative && !priorityFixes, '--packaged requires --sqlite and an authorization workflow')
const selected = process.argv.indexOf('--packaged-dir')
let unpacked
if (packaged) {
  assert(selected !== -1 && process.argv[selected + 1] && !process.argv[selected + 1].startsWith('-'),
    '--packaged requires --packaged-dir <candidate unpacked directory>; there is no release fallback')
  unpacked = await realpath(resolve(process.argv[selected + 1]))
  const gitCommon = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  const oldPackage = join(dirname(gitCommon), 'release', 'win-unpacked')
  assert(!existsSync(oldPackage) || relative(await realpath(oldPackage), unpacked) !== '', 'Refusing the main checkout release package')
} else assert.equal(selected, -1, '--packaged-dir needs --packaged')
const recoveryJourney = useSqlite && bookCreative && nativeProse && settlement
await mkdir(tempRoot, { recursive: true })
const directory = await mkdtemp(join(tempRoot, 'agent-director-journey-'))
const logPath = packaged || recoveryJourney ? directory + '.jsonl' : null
const log = (event, details) => {
  if (logPath) appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), event, ...details }) + '\n')
}
if (logPath) console.log('JOURNEY_LOG', logPath)
log('start', { repoRoot, directory, unpacked, packaged, argv: process.argv.slice(2) })
const workItemMode = useWorkItems ? { responseMode: 'work_item' } : {}
let projectId = 'director-journey-project'
const humanUpdateMarker = 'HUMAN_APPDATA_UPDATE_AFTER_CHAPTER_2'
const mockRequests = []
let pauseDraftChapter = 3

function chapterFromPrompt(prompt) {
  const taskMarker = /DIRECTOR_CHAPTER_(\d+)_TASK/.exec(prompt)
  if (taskMarker) return Number(taskMarker[1])
  const target = /Target chapter:\s*(\d+)/.exec(prompt)
  return target ? Number(target[1]) : 0
}

function planFixture(chapterOrder) {
  return {
    chapterTitle: `Mock Chapter ${chapterOrder}`,
    chapterGoal: `推进第 ${chapterOrder} 章的调查。`,
    conflictToPush: '主角必须在有限线索中确认下一步。',
    characterBeats: '主角核对记录并保持谨慎。',
    foreshadowingToUse: '',
    foreshadowingNotToReveal: '不解释蓝色信封的来源。',
    endingHook: `第 ${chapterOrder} 号纸条滑入门缝。`,
    readerEmotionTarget: '平静中逐步增加疑问。',
    estimatedWordCount: '2800-3400',
    openingContinuationBeat: chapterOrder === 1 ? '从整理桌面开始。' : '从上一章门缝中的纸条继续。',
    carriedPhysicalState: '主角留在房间内。',
    carriedEmotionalState: '谨慎而清醒。',
    unresolvedMicroTensions: '蓝色信封的来源仍未知。',
    forbiddenResets: '不得跳过当前纸条的核对。',
    allowedNovelty: {
      allowedNewCharacters: [],
      allowedNewRules: [],
      allowedNewSystemMechanics: [],
      allowedNewOrganizationsOrRanks: [],
      allowedLoreReveals: [],
      notes: ''
    },
    forbiddenNovelty: {
      forbiddenNewCharacters: [],
      forbiddenNewRules: [],
      forbiddenSystemMechanics: [],
      forbiddenOrganizationsOrRanks: [],
      forbiddenLoreReveals: [],
      notes: ''
    }
  }
}

function proseFixture(chapterOrder, short = false) {
  if (short) return '这是一段故意中断的短稿。'
  const opening = chapterOrder === 1
    ? '林澄把桌上的记录按日期排好，窗外的雨声很轻。'
    : `林澄接住上一章留下的第 ${chapterOrder - 1} 号纸条，仍站在门边。`
  const middle = Array.from({ length: 72 }, (_, index) => {
    const minute = index + 1
    const action = ['核对纸张边缘', '比对记录编号', '检查门锁状态', '记下走廊声音'][index % 4]
    return `第 ${minute} 分钟，林澄${action}，把确认过的事实写进本章记录，没有替未知来源补上解释。`
  }).join('')
  return `${opening}${middle}核对结束时，第 ${chapterOrder} 号纸条从门缝滑了进来。`
}

function reviewFixture(chapterOrder) {
  return {
    chapterReview: {
      summary: `第 ${chapterOrder} 章完成一次记录核对并留下下一章入口。`,
      newInformation: `确认第 ${chapterOrder} 号记录存在。`,
      characterChanges: '',
      newForeshadowing: '',
      resolvedForeshadowing: '',
      endingHook: `第 ${chapterOrder} 号纸条滑入门缝。`,
      riskWarnings: '',
      continuityBridgeSuggestion: {
        lastSceneLocation: '林澄的房间',
        lastPhysicalState: '未受伤，站在门边',
        lastEmotionalState: '谨慎而清醒',
        lastUnresolvedAction: `核对第 ${chapterOrder} 号纸条`,
        lastDialogueOrThought: '',
        immediateNextBeat: '接住并检查纸条',
        mustContinueFrom: `门缝中的第 ${chapterOrder} 号纸条`,
        mustNotReset: '不得跳过纸条核对',
        openMicroTensions: '蓝色信封来源未知'
      },
      characterStateChangeSuggestions: []
    },
    characterSuggestions: [],
    foreshadowingExtraction: {
      newForeshadowingCandidates: [],
      advancedForeshadowingIds: [],
      resolvedForeshadowingIds: [],
      abandonedForeshadowingCandidates: [],
      statusChanges: []
    },
    analysisMode: 'unified',
    warnings: []
  }
}

function reviewForPrompt(chapterOrder, prompt) {
  const fixture = reviewFixture(chapterOrder)
  if (libraryManagement && settlement && prompt.includes('第 5 号纸条从门缝滑了进来')) {
    // Leave one unselected proposal for the existing post-revocation authorization probe.
    fixture.foreshadowingExtraction.newForeshadowingCandidates.push({
      title: '第五张纸条的来源', description: '第五张纸条从门缝滑入，来源未知。', firstChapterOrder: 5,
      suggestedWeight: 'medium', recommendedTreatmentMode: 'hint', expectedPayoff: '确认纸条来源',
      relatedCharacterIds: [], notes: ''
    })
  }
  if (!priorityFixes || chapterOrder !== 2) return fixture
  const state = (category, key, label, afterValue, evidence) => ({
    characterId: 'director-character', category, key, label, changeType: 'create_fact',
    beforeValue: null, afterValue, delta: null, evidence, confidence: 0.95, riskLevel: 'high',
    suggestedTransactionType: 'create', linkedCardFields: ['abilitiesAndResources']
  })
  if (prompt.includes(revisedEnding)) {
    fixture.chapterReview.endingHook = '钱袋里只剩三枚铜钱。'
    fixture.chapterReview.newInformation = '钱袋仅余三枚铜钱。'
    fixture.chapterReview.continuityBridgeSuggestion.mustContinueFrom = fixture.chapterReview.endingHook
    fixture.chapterReview.characterStateChangeSuggestions = [
      state('resource', 'cash', '钱袋余额', 3, '他清点后只剩三枚铜钱。'),
      state('physical', 'wrist', '左腕酸痛', '仍有些酸痛', '他的左腕仍有些酸痛。')
    ]
    fixture.foreshadowingExtraction.newForeshadowingCandidates = [{
      title: '铜钱刻痕', description: '钱袋里有一枚铜钱带横刻。', firstChapterOrder: 2,
      suggestedWeight: 'medium', recommendedTreatmentMode: 'hint', expectedPayoff: '待确认来源',
      relatedCharacterIds: ['director-character'], notes: ''
    }]
  } else {
    fixture.chapterReview.characterStateChangeSuggestions = [state('inventory', 'paper-note', '新纸条', '发现纸条', oldEnding)]
  }
  return fixture
}

function consistencyFixture() {
  return {
    timelineProblems: [],
    settingConflicts: [],
    characterOOC: [],
    foreshadowingMisuse: [],
    pacingProblems: [],
    emotionPayoffProblems: [],
    suggestions: [],
    severitySummary: 'low',
    issues: []
  }
}

function qualityFixture() {
  const dimensions = Object.fromEntries([
    'plotCoherence', 'characterConsistency', 'characterStateConsistency', 'foreshadowingControl',
    'chapterContinuity', 'redundancyControl', 'styleMatch', 'pacing', 'emotionalPayoff',
    'originality', 'promptCompliance', 'contextRelevanceCompliance'
  ].map((key) => [key, 92]))
  return { overallScore: 92, pass: true, dimensions, issues: [], requiredFixes: [], optionalSuggestions: [] }
}

function mockPayload(prompt) {
  const chapterOrder = chapterFromPrompt(prompt)
  if (prompt.includes('You are planning the target chapter')) return planFixture(chapterOrder)
  if (prompt.includes('You are drafting a novel chapter') || prompt.includes('请根据下方唯一的 ChapterTask 写出完整的小说第一章')) {
    return { title: `Mock Chapter ${chapterOrder}`, body: proseFixture(chapterOrder, pauseDraftChapter === chapterOrder) }
  }
  if (prompt.includes('请一次完成章节生成后的结构化分析')) return reviewForPrompt(chapterOrder, prompt)
  if (prompt.includes('请阅读章节正文与上下文')) return reviewForPrompt(chapterOrder, prompt).chapterReview
  if (prompt.includes('请从章节正文中提取角色当前戏剧状态变化')) return { suggestions: [] }
  if (prompt.includes('请从章节正文中提取伏笔信息')) return reviewFixture(chapterOrder).foreshadowingExtraction
  if (prompt.includes('You are a continuity editor')) return consistencyFixture()
  if (prompt.includes('You are a quality gate reviewer')) {
    const review = qualityFixture()
    return bookCreative && prompt.includes(rejectedRevisionMarker) ? { ...review, overallScore: 25, pass: false,
      requiredFixes: ['删除与本章无关的测试段落。'] } : review
  }
  throw new Error(`Unexpected local mock-model request: ${prompt.slice(0, 120)}`)
}

function completionResponse(payload) {
  return new Response(JSON.stringify({
    id: 'local-mock-completion',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(payload) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function scriptedResponse(request) {
  const prompt = (request.messages ?? []).map((message) => String(message.content ?? '')).join('\n')
  const chapterOrder = chapterFromPrompt(prompt)
  mockRequests.push({ chapterOrder, prompt })
  return completionResponse(mockPayload(prompt))
}
if (!packaged) globalThis.fetch = async (url, options = {}) => {
  const target = String(url)
  if (recoveryJourney) {
    assert(recovery?.allows(target), 'Only the two fixture loopbacks may receive model requests')
    return originalFetch(url, { ...options, redirect: 'error' })
  }
  assert.equal(target, 'http://127.0.0.1:9/v1/chat/completions', 'The fixture may call only its loopback mock endpoint.')
  assert.equal(options.method, 'POST')
  return scriptedResponse(JSON.parse(String(options.body ?? '{}')))
}
process.env.NOVEL_DIRECTOR_API_KEY = ''

function taskFixture(chapterOrder) {
  return {
    goal: `DIRECTOR_CHAPTER_${chapterOrder}_TASK：推进当前记录核对。` +
      (priorityFixes && chapterOrder === 3 ? '林澄核对钱袋余额，确认能承担的资源开销。检查铜钱刻痕。' : ''),
    conflict: '走廊噪音干扰判断，但不引入新规则。',
    suspenseToKeep: '保留蓝色信封来源。',
    allowedPayoffs: '只确认当前记录编号。',
    forbiddenPayoffs: '不得揭示蓝色信封来源。',
    endingHook: `第 ${chapterOrder} 号纸条滑入门缝。`,
    readerEmotion: '平静中逐步增加疑问。',
    targetWordCount: '2800-3400',
    styleRequirement: '使用连续场景和具体动作，保持克制。'
  }
}

function fixture(api, mockBaseUrl = 'http://127.0.0.1:9/v1') {
  const timestamp = '2026-09-07T00:00:00.000Z'
  const data = api.normalizeAppData({
    schemaVersion: 3,
    projects: [{
      id: projectId,
      name: 'W08 Director Journey Fixture',
      genre: '悬疑',
      description: '隔离的五章导演流程 fixture。',
      targetReaders: '',
      coreAppeal: '连续调查与克制悬念。',
      style: '具体、克制、连续场景。',
      createdAt: timestamp,
      updatedAt: timestamp
    }],
    storyBibles: [{
      projectId,
      worldbuilding: '故事发生在一间普通公寓，不存在超自然规则。',
      corePremise: '主角按顺序核对匿名记录。',
      protagonistDesire: '确认记录来源。',
      protagonistFear: '把猜测误当事实。',
      mainConflict: '信息不足但必须继续判断。',
      powerSystem: '',
      bannedTropes: '不得凭空出现救援规则。',
      styleSample: '',
      narrativeTone: '克制。',
      immutableFacts: '蓝色信封来源尚未确认。',
      updatedAt: timestamp
    }],
    characters: [{
      id: 'director-character',
      projectId,
      name: '林澄',
      role: '主角',
      surfaceGoal: '核对记录。',
      deepDesire: '只相信可验证事实。',
      coreFear: '误判线索。',
      selfDeception: '',
      knownInformation: '知道记录按数字排序。',
      unknownInformation: '不知道蓝色信封来源。',
      protagonistRelationship: '本人',
      emotionalState: '平静',
      nextActionTendency: '继续核对',
      forbiddenWriting: '',
      isMain: true,
      lastChangedChapter: null,
      createdAt: timestamp,
      updatedAt: timestamp
    }]
  })
  return {
    ...data,
    settings: {
      ...data.settings,
      apiProvider: 'local',
      baseUrl: mockBaseUrl,
      modelName: 'w08-local-mock',
      hasApiKey: false,
      requestTimeoutMs: 5000,
      retryEnabled: false,
      maxRetries: 0,
      defaultTokenBudget: 12000,
      maxTokens: 5000
    }
  }
}

async function loadApi() {
  const outfile = join(directory, 'api.mjs')
  await build({
    stdin: {
      contents: [
        "export { AgentToolService } from './src/agent/tools/AgentToolService'",
        "export { AgentAuthorizationService } from './src/main/services/AgentAuthorizationService'",
        "export { JsonStorageService } from './src/storage/JsonStorageService'",
        "export * from './src/storage/SqliteStorageService'",
        ...(existsSync(join(repoRoot, 'src/main/libraryFiles.ts')) ? ["export { libraryStores, writeNewLibrary } from './src/main/libraryFiles'"] : []),
        "export { claimAgentJobExecution } from './src/agent/agentJobExecution'",
        "export { readCandidateDraftSource } from './src/services/CandidateDraftSource'",
        "export { invalidateDraftDiagnosticsAfterChange } from './src/services/DraftDiagnosticBindingService'",
        "export { normalizeAppData } from './src/shared/defaults'"
      ].join('\n'),
      resolveDir: repoRoot,
      loader: 'ts'
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3', 'electron'],
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

function withoutNullTimestamps(reference) {
  return Object.fromEntries(Object.entries(reference).filter(([key, value]) =>
    value !== null || (key !== 'sourceUpdatedAt' && key !== 'sourceSnapshotUpdatedAt')))
}

let storage, endpoint, packagedQa, recovery, releaseSummary
try {
  process.env.NOVEL_DIRECTOR_API_REGISTRY = join(directory, 'registry.json')
  if (recoveryJourney) {
    recovery = await openReviewRecovery(scriptedResponse, log)
    if (!packaged) Object.assign(process.env, recovery.fixtureEnv)
  } else if (packaged) endpoint = await mockAgentEndpoint(scriptedResponse)
  await writeFile(process.env.NOVEL_DIRECTOR_API_REGISTRY, JSON.stringify({ version: 1, apis: recovery?.registry ?? {} }))
  const api = await loadApi()
  const userDataPath = packaged ? join(directory, 'appdata', 'Novel Director') : join(directory, 'profile')
  const storagePath = packaged ? join(userDataPath, 'novel-director-data.sqlite')
    : join(directory, useSqlite ? 'director-journey.sqlite' : 'director-journey.json')
  await mkdir(userDataPath, { recursive: true })
  const seed = fixture(api, recovery?.baseUrl ?? endpoint?.baseUrl)
  if (packaged) {
    assert(!existsSync(storagePath))
    packagedQa = await openPackagedAgentJourney({ unpacked, profile: userDataPath, storagePath,
      registryPath: process.env.NOVEL_DIRECTOR_API_REGISTRY, fixtureEnv: recovery?.fixtureEnv, log })
    storage = api.createExistingLibraryStorage?.(storagePath) ?? new api.SqliteStorageService(storagePath)
    const empty = await storage.loadSnapshot()
    assert.equal(empty.data.projects.length, 0)
    await storage.saveIfCurrent(seed, empty.revision)
  } else if (api.writeNewLibrary) {
    storage = (await api.writeNewLibrary(storagePath, api.libraryStores, seed)).storage
  } else {
    storage = new (useSqlite ? api.SqliteStorageService : api.JsonStorageService)(storagePath)
    await storage.save(seed)
  }

  const metrics = { toolCalls: 0, compactReplyBytes: 0, mcpResultBytes: 0, fullDraftBytes: 0 }
  const call = async (name, args = {}) => {
    const input = name === 'listAvailableChannels' ? {} : { storagePath, userDataPath, ...args }
    log('tool', { name, projectId: args.projectId, jobId: args.jobId, operationId: args.operationId })
    const result = packagedQa ? await packagedQa.call(name, input)
      : await api.AgentToolService.callTool({ name: `agent.${name}`, arguments: input })
    metrics.toolCalls += 1
    metrics.compactReplyBytes += Buffer.byteLength(JSON.stringify(result))
    metrics.mcpResultBytes += Buffer.byteLength(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false
    }))
    if (name === 'getDraftText') metrics.fullDraftBytes += Buffer.byteLength(result.data.text ?? '')
    return result
  }
  const snapshot = () => storage.loadSnapshot()
  const authority = packagedQa?.authority ?? new api.AgentAuthorizationService(userDataPath)
  let library = null
  if (libraryManagement) {
    const otherStoragePath = join(directory, 'outside-library.json')
    if (api.writeNewLibrary) (await api.writeNewLibrary(otherStoragePath, api.libraryStores, fixture(api))).storage.close?.()
    else await new api.JsonStorageService(otherStoragePath).save(fixture(api))
    library = await openLibraryWithOneGrant({ call, authority, storagePath, otherProjectId: projectId, snapshot,
      otherStoragePath, otherProfile: join(directory, 'other-profile') })
  }
  const bookGrant = library?.grant ?? (bookCreative ? await openBookWithOneGrant({ call, authority, storagePath, otherProjectId: projectId, snapshot }) : null)
  if (bookGrant) projectId = library?.projectId ?? bookGrant.projectId

  const queued = await call('continueAgentRun', {
    projectId,
    startChapterOrder: 1,
    chapterCount: 5,
    goal: '按标准单章闭环依次完成五章。',
    safetyMode: 'autonomous',
    ...workItemMode
  })
  let workItem = queued.data.workItem
  if (useWorkItems) {
    assert.deepEqual(workItem.range, { from: 1, to: 5, count: 5 })
    assert.equal(workItem.chapterOrder, 1)
    assert.deepEqual(Object.keys(workItem.task).sort(), ['goal', 'read'])
    assert.equal(workItem.nextAction.tool, 'agent.retryChapterPipeline')
    assert.equal((await snapshot()).data.chapterGenerationJobs.length, 1)
    assert.equal(queued.data.agentRun, undefined)
  } else {
    assert.deepEqual(queued.data.targetChapterOrders, [1, 2, 3, 4, 5])
    assert.equal(queued.data.createdJobCount, 1, 'continueAgentRun must prepare only the first job.')
  }
  const agentRunId = useWorkItems ? workItem.agentRunId : queued.data.agentRun.id
  const firstSourceJobId = useWorkItems ? workItem.job.id : queued.data.currentJob.id

  const grant = bookGrant ?? await authority.grant({
    storagePath,
    projectId,
    actions: ['edit_chapter_task', 'accept_draft', ...(settlement ? ['manage_chapters'] : []),
      ...(priorityFixes || settlement ? ['accept_high_risk_candidates'] : [])],
    chapterStart: 1,
    chapterEnd: 5
  })

  const events = []
  const chapterEvidence = []
  let reconnectProbe = null
  let reReviewCalls = 0
  let relatedCandidateId
  for (let chapterOrder = 1; chapterOrder <= 5; chapterOrder++) {
    const beforeTask = await snapshot()
    assert.equal(beforeTask.data.chapterCommitBundles.length, chapterOrder - 1, 'The previous chapter must commit before preparing the next one.')
    assert.equal(
      beforeTask.data.chapterGenerationJobs.some((job) => job.targetChapterOrder > chapterOrder),
      false,
      'The fixture must not pre-create future chapter jobs.'
    )

    let source
    if (useWorkItems) {
      assert.equal(workItem.chapterOrder, chapterOrder)
      const edit = chapterOrder === 1 ? workItem.editTask : workItem.nextAction
      assert.equal(edit.tool, 'agent.previewChapterTaskEdit')
      source = edit.arguments
    } else {
      const taskRead = await call('getChapterTask', {
        projectId,
        chapterOrder,
        ...(chapterOrder === 1
          ? { sourceJobId: firstSourceJobId }
          : { sourceJobId: null, sourceSnapshotId: null })
      })
      assert.ok(taskRead.data.source)
      assert.ok(taskRead.data.editReference)
      source = withoutNullTimestamps(taskRead.data.editReference)
    }

    const editArguments = {
      projectId,
      ...source,
      agentRunId,
      operationId: `director-task-${chapterOrder}`,
      reason: `导演明确准备第 ${chapterOrder} 章任务。`,
      task: taskFixture(chapterOrder),
      budgetMode: 'standard',
      budgetMaxTokens: 12000,
      pipelineMode: recovery && chapterOrder === 4 ? 'conservative' : 'standard',
      refreshContext: false
    }
    const taskPreview = await call('previewChapterTaskEdit', editArguments)
    assert.equal(taskPreview.data.persisted, false)
    assert.equal(taskPreview.data.invokesAI, false)
    const taskApplied = await call('applyChapterTaskEdit', {
      ...editArguments,
      expectedPreviewHash: taskPreview.data.previewHash,
      expectedRevision: taskPreview.storage.revision
    })
    assert.equal(taskApplied.data.authorizationGrantId, grant.id)
    assert.equal(taskApplied.data.job.status, 'idle')
    assert.equal(taskApplied.data.nextExecution.tool, 'agent.retryChapterPipeline')
    const afterTask = await snapshot()
    const editDecision = afterTask.data.agentRuns.find((run) => run.id === agentRunId)?.decisions
      .find((decision) => decision.jobId === taskApplied.data.job.id && decision.step === 'edit_chapter_task')
    assert.equal(editDecision?.result, 'applied', 'A saved task edit must not remain pending_human.')
    events.push(`task:${chapterOrder}`)

    if (priorityFixes && chapterOrder === 3) {
      const handoff = (await call('getChapterWorkItem', { projectId, agentRunId })).data.continuity
      assert.equal(handoff.status, 'related_candidates_pending')
      assert.equal(handoff.total, 2)
      const stateHint = handoff.candidates.find(item => item.kind === 'character_state')
      assert.match(stateHint.title, /钱袋余额/)
      assert.equal(handoff.candidates.find(item => item.kind === 'memory').title, '铜钱刻痕')
      relatedCandidateId = stateHint.candidateId
      const detail = await call('getCandidateDetail', stateHint.read.arguments)
      assert.ok(JSON.stringify(detail.data).includes(relatedCandidateId))
      assert.equal(afterTask.data.characterStateFacts.length, 0, 'The handoff must not write pending facts to canon.')
    }
    const execute = (args = taskApplied.data.nextExecution.arguments) =>
      call('retryChapterPipeline', { ...args, ...workItemMode })
    let pipeline
    if (nativeProse && chapterOrder === 4) {
      const paused = await execute({ ...taskApplied.data.nextExecution.arguments, stopAfterStep: 'build_prompt' })
      const item = paused.data.workItem
      assert.equal(item.state, 'awaiting_prose_draft')
      const handoff = (await call('getChapterDraftHandoff', item.nextAction.arguments)).data
      assert.ok(handoff.messages.some(m => m.content.includes('DIRECTOR_CHAPTER_4_TASK')))
      const body = '　　' + proseFixture(4) + '\n'
      recovery?.arm()
      pipeline = await call('submitChapterDraft', { ...handoff.nextAction.arguments, title: '第四章', body, actorTag: 'prose-writer' })
      assert.equal(pipeline.data.workItem.draft.actorTag, 'prose-writer')
      if (recovery) pipeline = await recovery.recover({ failed: pipeline.data.workItem, snapshot, call, body })
    } else pipeline = await execute()
    if (chapterOrder === 3) {
      const failed = pipeline.data.workItem
      assert.equal(useWorkItems ? failed.job.resumeFrom : pipeline.data.failedStep?.type, 'generate_chapter_draft',
        'Chapter 3 must pause at the injected draft failure.')
      assert.equal((await snapshot()).data.chapterCommitBundles.length, 2)
      events.push('pause:3')
      pauseDraftChapter = 0
      if (useWorkItems) {
        assert.equal(failed.nextAction.tool, 'agent.retryChapterPipeline')
        assert.equal(failed.nextAction.arguments.jobId, taskApplied.data.job.id)
      }
      let resume = failed?.nextAction
      if (priorityFixes) {
        await leaveStoppedClaim({ directory, storage, storagePath, jobId: taskApplied.data.job.id })
        const reopened = (await call('getChapterWorkItem', { projectId, agentRunId })).data
        assert.equal(reopened.state, 'resume_pipeline')
        assert.equal(reopened.job.executorState, 'stopped')
        assert.equal(reopened.job.resumeFrom, 'generate_chapter_draft')
        assert.equal(reopened.nextAction.arguments.jobId, taskApplied.data.job.id)
        resume = reopened.nextAction
      }
      pipeline = await execute(resume?.arguments)
      if (!useWorkItems) assert.equal(pipeline.data.resumedFromStep, 'generate_chapter_draft')
      events.push('resume:3')
    }
    let reviewItem = pipeline.data.workItem
    if (useWorkItems) {
      assert.equal(reviewItem.state, 'review_draft')
      assert.deepEqual(Object.keys(reviewItem.task), ['read'])
      assert.equal(reviewItem.task.read.arguments.sourceJobId, taskApplied.data.job.id)
      assert.equal(reviewItem.draft.read.tool, 'agent.getDraftText')
      assert.equal(reviewItem.review.complete, true)
      assert.equal(reviewItem.acceptance.state, 'available')
      assert.equal(reviewItem.acceptance.mode, 'reviewed')
      assert.equal(reviewItem.acceptance.preview.tool, 'agent.previewChapterAcceptance')
      if (chapterOrder === 1) reconnectProbe = (await snapshot()).data
    } else {
      assert.equal(pipeline.data.failedStep, null)
      assert.equal(pipeline.data.awaitingAcceptance, true)
      assert.equal(pipeline.data.draftIds.length, 1)
    }
    events.push(`pipeline:${chapterOrder}`)

    if (bookCreative && chapterOrder === 1) await checkGenerationGate({ call, snapshot, storage, projectId, agentRunId, item: reviewItem })
    if (priorityFixes && chapterOrder === 2) {
      const revised = await verifyDraftRevisionLoop({ api, call, snapshot, projectId, agentRunId, item: reviewItem, modelRequests: mockRequests })
      reviewItem = revised.item
      reReviewCalls = revised.reReviewCalls
    }
    const draftId = useWorkItems ? reviewItem.draft.id : pipeline.data.draftIds[0]
    const draftRead = await call('getDraftText', useWorkItems ? reviewItem.draft.read.arguments : { draftId, detail: 'full' })
    if (nativeProse && chapterOrder === 4) assert.equal(draftRead.data.text, '　　' + proseFixture(4) + '\n')
    if (priorityFixes && chapterOrder === 2) {
      assert.ok(draftRead.data.text.includes(revisedEnding))
      assert.ok(!draftRead.data.text.includes(oldEnding))
    } else assert.match(draftRead.data.text, new RegExp(`第 ${chapterOrder} 号纸条`))
    if (!useWorkItems) {
      const diagnostics = await call('getRunDiagnostics', { jobId: taskApplied.data.job.id })
      assert.equal(diagnostics.data.steps.find((step) => step.type === 'quality_gate')?.status, 'completed')
      const recommendation = await call('getAcceptanceRecommendation', { jobId: taskApplied.data.job.id })
      assert.ok(recommendation.data.recommendation)
    }

    const current = await snapshot()
    const quality = current.data.qualityGateReports.find((report) => report.jobId === taskApplied.data.job.id &&
      report.draftId === draftId && (!useWorkItems || report.draftContentHash === reviewItem.draft.draftContentHash))
    assert.ok(quality, 'Acceptance must use a report bound to the current draft.')
    if (useWorkItems) {
      assert.deepEqual(reviewItem.review.reports.find(report => report.kind === 'quality_gate'), { kind: 'quality_gate', reportId: quality.id })
    }
    let consistencyId
    if (recoveryJourney) {
      for (const kind of ['consistency', 'quality_gate']) {
        const selected = reviewItem.review.reports.find(report => report.kind === kind)
        assert(selected, 'Missing chapter report: ' + kind)
        const { data } = await call('getDraftReviewReport', { ...reviewItem.review.readReport.arguments, ...selected })
        assert.equal(data.draftContentHash, reviewItem.draft.draftContentHash)
        assert.equal(data.draftId, draftId)
        assert.equal(data.report.id, selected.reportId)
        if (kind === 'quality_gate') assert.equal(data.report.pass, true)
        else consistencyId = data.report.id
      }
    }
    const summaryCandidate = settlement && current.data.memoryUpdateCandidates.find(c => c.type === 'chapter_review' && c.sourceDraftId === draftId)
    if (settlement) assert.ok(summaryCandidate, 'The director chose the review summary from this draft.')
    const acceptancePreview = await call(settlement ? 'previewChapterSettlement' : 'previewChapterAcceptance', {
      ...(useWorkItems ? reviewItem.acceptance.preview.arguments : {
        projectId, agentRunId, jobId: taskApplied.data.job.id, draftId, mode: 'reviewed'
      }),
      operationId: `director-accept-${chapterOrder}`,
      ...(settlement ? { finalTitle: `定名：纸条之${chapterOrder}`, decisions: [{ kind: 'memory_update',
        candidateId: summaryCandidate.id, decision: 'accept' }] } : {}),
      reason: `已读取第 ${chapterOrder} 章完整正文和当前报告，明确决定采纳本次 mock fixture 输出。`
    })
    assert.equal(acceptancePreview.data.review.mode, 'reviewed')
    const accepted = await call(settlement ? 'applyChapterSettlement' : 'applyChapterAcceptance', {
      projectId,
      previewId: settlement ? acceptancePreview.data.previewId : acceptancePreview.data.preview.id,
      expectedPreviewHash: acceptancePreview.data.previewHash,
      ...workItemMode
    })
    assert.equal(accepted.data.formalCommit, true)
    assert.equal(accepted.data.authorizationGrantId, grant.id)
    const committed = await snapshot()
    assert.equal(committed.data.chapterCommitBundles.length, chapterOrder)
    if (settlement) {
      assert.equal(committed.data.chapters.find(c => c.id === accepted.data.chapterId).title, `定名：纸条之${chapterOrder}`)
      assert.equal(committed.data.memoryUpdateCandidates.find(c => c.id === summaryCandidate.id).status, 'accepted')
      assert.equal(committed.data.candidateDecisionReceipts.length, chapterOrder)
      if (recoveryJourney) {
        const receipt = committed.data.candidateDecisionReceipts.find(r => r.id === accepted.data.candidateReceiptId)
        assert(receipt.decisions.some(d => d.candidateId === summaryCandidate.id && d.decision === 'accept'))
        const entry = { order: chapterOrder, title: acceptancePreview.data.finalTitle, commitId: accepted.data.commitId,
          qualityId: quality.id, consistencyId, candidateReceiptId: receipt.id, bodyHash: reviewItem.draft.draftContentHash }
        log('settlement', entry)
        chapterEvidence.push({ ...entry, body: draftRead.data.text })
      }
    }
    assert.equal(committed.data.chapters.find((chapter) => chapter.projectId === projectId && chapter.order === chapterOrder)?.body, draftRead.data.text)
    if (useWorkItems) {
      workItem = accepted.data.workItem
      assert.equal(workItem.lastReceipt.commitId, accepted.data.commitId)
      if (chapterOrder < 5) {
        assert.equal(workItem.state, 'prepare_task')
        assert.deepEqual(Object.keys(workItem.task).sort(), ['goal', 'read'])
      } else assert.equal(workItem.state, 'complete')
    }
    events.push(`commit:${chapterOrder}`)

    if (chapterOrder === 2) {
      const authorSnapshot = await snapshot()
      const chapter = authorSnapshot.data.chapters.find((item) => item.projectId === projectId && item.order === 2)
      chapter.summary = `${chapter.summary} ${humanUpdateMarker}`
      chapter.endingHook = `${chapter.endingHook} ${humanUpdateMarker}`
      chapter.updatedAt = '2026-09-07T12:00:00.000Z'
      await storage.saveIfCurrent(authorSnapshot.data, authorSnapshot.revision)
      events.push('human-update:2')
    }
  }

  assert.ok(
    mockRequests.some((request) =>
      request.prompt.includes('DIRECTOR_CHAPTER_3_TASK') && request.prompt.includes(humanUpdateMarker)),
    'The next chapter context must include the human AppData update committed after chapter 2.'
  )
  assert.deepEqual(events, [
    'task:1', 'pipeline:1', 'commit:1',
    'task:2', 'pipeline:2', 'commit:2', 'human-update:2',
    'task:3', 'pause:3', 'resume:3', 'pipeline:3', 'commit:3',
    'task:4', 'pipeline:4', 'commit:4',
    'task:5', 'pipeline:5', 'commit:5'
  ])

  const final = await snapshot()
  assert.equal(final.data.chapters.filter((chapter) => chapter.projectId === projectId).length, 5)
  assert.equal(final.data.chapterCommitBundles.length, 5)
  if (recoveryJourney) {
    recovery.verify()
    assert.equal(chapterEvidence.length, 5)
    if (packagedQa) await packagedQa.inspectChapters(final.data.projects.find(p => p.id === projectId).name, chapterEvidence)
  }
  assert.deepEqual(final.data.agentRuns.find((run) => run.id === agentRunId)?.targetChapterOrders, [1, 2, 3, 4, 5])
  if (priorityFixes) {
    assert.ok(relatedCandidateId)
    const candidate = final.data.characterStateChangeCandidates.find(item => item.id === relatedCandidateId)
    const chapter = final.data.chapters.find(item => item.projectId === projectId && item.order === 2)
    assert.equal(chapter.body.includes(revisedEnding), true)
    const { sourceDraftId: _draft, sourceDraftContentHash: _hash, ...olderRecord } = final.data.memoryUpdateCandidates
      .find(item => item.proposedPatch.kind === 'foreshadowing_create')
    final.data.memoryUpdateCandidates.push({ ...olderRecord, id: 'legacy-unbound-fixture' })
    // Simulate a later official edit which removes the sentence underpinning the pending fact.
    chapter.body = chapter.body.replace(revisedEnding, '林澄收起了钱袋。')
    await storage.saveIfCurrent(final.data, final.revision)
    await assertStaleCandidates(call, snapshot, projectId, agentRunId, [['character_state', candidate.id]])
    const legacy = await call('previewCandidateDecisions', { projectId,
      decisions: [{ kind: 'memory', candidateId: 'legacy-unbound-fixture', decision: 'accept' }] })
    assert.equal(legacy.data.items[0].sourceStatus, 'unverified')
    assert.notEqual(legacy.data.authorization, 'stale_source')
  }
  const journeyMockCalls = mockRequests.length
  assert.equal(journeyMockCalls - reReviewCalls, recovery ? 21 : nativeProse ? 20 : 21)
  if (!priorityFixes && !bookCreative) assert.equal(metrics.toolCalls, nativeProse ? 34 : useWorkItems ? 32 : 47)
  const mcpReconnectChecks = useWorkItems && !packaged
    ? await validateChapterWorkItemReconnect({ api, directory, projectId, data: reconnectProbe, agentRunId }) : 0
  assert(!mockRequests.slice(journeyMockCalls).some(request => request.prompt.includes('You are drafting a novel chapter') ||
    request.prompt.includes('请根据下方唯一的 ChapterTask 写出完整的小说第一章')))
  const reconnectReviewMockCalls = mockRequests.length - journeyMockCalls
  const management = library ? await verifyArchiveAndHistory({ call, snapshot, ...library, modelRequests: mockRequests }) : {}
  const creative = bookGrant ? await verifyBookRevisionBatch({ call, snapshot, projectId, grant: bookGrant, authority,
    storagePath, modelRequests: mockRequests, stagedErrata: process.argv.includes('--staged-errata'), storage }) : {}
  if (library) {
    assert.equal((await call('getLibraryAuthorization')).data.active, false)
    const args = { projectId: library.otherProjectId, operationId: 'library-revoked-edit', action: 'archive', reason: '不允许撤权后继续。' }
    const preview = (await call('previewProjectAction', args)).data
    assert.equal(preview.authorized, false)
    await assert.rejects(call('applyProjectAction', { ...args, expectedFingerprint: preview.fingerprint }), { code: 'AGENT_AUTHORIZATION_REQUIRED' })
    await assert.rejects(call('createProject', { operationId: 'library-revoked-create', name: '撤权后', reason: '测试撤权。' }), /没有可用的开书授权/)
    const stored = await snapshot()
    const candidate = stored.data.memoryUpdateCandidates.find(item => item.projectId === projectId && item.status === 'pending')
    assert.ok(candidate)
    const selection = { kind: 'memory', candidateId: candidate.id, decision: 'reject' }
    const decisionPreview = (await call('previewCandidateDecisions', { projectId, decisions: [selection] })).data
    assert.equal(decisionPreview.requiresConfirmation, false)
    assert.equal(decisionPreview.agentCanApply, false)
    await assert.rejects(call('applyCandidateDecisions', { projectId, operationId: 'library-revoked-candidate',
      reason: '普通候选也需要有效授权。', decisions: [{ ...selection, expectedFingerprint: decisionPreview.items[0].expectedFingerprint }] }),
    { code: 'AGENT_CANDIDATE_AUTHORIZATION_REQUIRED' })
    assert.equal((await snapshot()).revision, stored.revision)
  }
  const summary = {
    ok: true,
    mode: libraryManagement ? 'library_management' : bookCreative ? 'book_creative' : priorityFixes ? 'priority_fixes' : useWorkItems ? 'work_item' : 'legacy',
    ...metrics,
    mcpReconnectChecks,
    storage: useSqlite ? 'isolated-sqlite' : 'isolated-json',
    chaptersCommitted: 5,
    pipelineEntry: packaged ? 'shipped Electron MCP over stdio' : 'agent.retryChapterPipeline via AgentToolService.callTool',
    model: packaged || recovery ? 'isolated loopback mock endpoint' : 'in-process local mock response fixture',
    ...(packagedQa ? { packagedEvidence: await packagedQa.evidence() } : {}),
    mockModelCalls: journeyMockCalls + (recovery ? 1 : 0),
    ...(settlement ? { formalSettlements: 5 } : {}),
    ...(nativeProse ? { agentAuthoredChapter: 4 } : {}),
    ...(recovery ? { recoveredReviewChapter: 4, uiChaptersVerified: packaged ? chapterEvidence.length : 0 } : {}),
    ...(priorityFixes ? { sameDraftReReviewMockCalls: reReviewCalls, recoveredAfterProcessExit: true } : {}),
    reconnectReviewMockCalls,
    ...creative,
    ...management,
    paidModelCalls: 0,
    pausedAndResumedChapter: 3,
    humanUpdateObservedByChapter: 3,
    sequentialFormalCommits: true
  }
  log('checks-passed', summary)
  if (recovery && packagedQa) {
    releaseSummary = { version: summary.packagedEvidence.version, asarSha256: summary.packagedEvidence.asarSha256,
      authorization: summary.mode, storage: 'desktop-created SQLite', agentAuthoredChapter: 4,
      chapters: chapterEvidence.map(({ order, title }) => ({ order, title, gatePassed: true, settled: true,
        reviewSummaryCandidateAccepted: true, uiVerified: ['body', 'title', 'consistencyReport', 'qualityGateReport', 'commitReceipt'] })),
      recovery: { chapter: 4, failedStep: 'consistency_review', simulatedHttpStatus: 503, switchCommands: 1,
        retryUsedRegisteredLoopback: true, previousStepsAndBodyUnchanged: true },
      stagedErrataVerified: process.argv.includes('--staged-errata'),
      mcpWireRequests: summary.packagedEvidence.mcpWireRequests, authorGrantFromUi: true, defaultMcpLibraryMatchesDesktop: true,
      paidModelCalls: 0 }
  }
  console.log(JSON.stringify(summary))
} catch (error) {
  log('failed', { error: error.stack })
  throw error
} finally {
  try {
    try { await packagedQa?.close() } finally { await endpoint?.close(); await recovery?.close() }
  } catch (error) {
    log('cleanup-failed', { error: error.stack })
    throw error
  }
  storage?.close?.()
  globalThis.fetch = originalFetch
  if (originalApiKey === undefined) delete process.env.NOVEL_DIRECTOR_API_KEY
  else process.env.NOVEL_DIRECTOR_API_KEY = originalApiKey
  if (originalRegistry === undefined) delete process.env.NOVEL_DIRECTOR_API_REGISTRY
  else process.env.NOVEL_DIRECTOR_API_REGISTRY = originalRegistry
  const child = relative(tempRoot, directory)
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Refusing to clean outside the isolated fixture root.')
  await rm(directory, { recursive: true, force: true, maxRetries: 6 })
  log('cleanup-complete', {})
  if (releaseSummary) {
    const path = directory + '.summary.json'
    await writeFile(path, JSON.stringify({ ...releaseSummary, cleanExit: true, mcpExitCode: 0, desktopExitCode: 0, remainingProcesses: 0 }, null, 2) + '\n', { flag: 'wx' })
    console.log('JOURNEY_RELEASE_SUMMARY', path)
  }
}

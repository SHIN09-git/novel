#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import NativeDatabase from 'better-sqlite3'
import { build } from 'esbuild'
import {
  createLongNovelFixture,
  LONG_NOVEL_PROJECT_ID,
  LONG_NOVEL_SECOND_PROJECT_ID
} from './fixtures/long-novel-performance.mjs'
import { repoRoot } from './utils/repo-root.mjs'

const OVERVIEW_COLLECTIONS = [
  'projects',
  'chapters',
  'characters',
  'characterStateFacts',
  'foreshadowings',
  'timelineEvents',
  'stageSummaries',
  'hardCanonPacks',
  'storyDirectionGuides',
  'chapterGenerationJobs',
  'memoryUpdateCandidates',
  'characterStateChangeCandidates'
]
const EXCLUDED_LARGE_COLLECTIONS = [
  'chapterGenerationSteps',
  'chapterVersions',
  'chapterCommitBundles',
  'revisionCommitBundles',
  'generationRunTraces',
  'generatedChapterDrafts',
  'promptContextSnapshots'
]
const SECRET = 'OVERVIEW_API_KEY_MUST_NEVER_APPEAR'
const PROSE_SENTINEL = 'FULL_CHAPTER_PROSE_FROM_NON_OVERVIEW_TOOL'
const HISTORY_SENTINEL = 'HISTORY_OR_TRACE_PAYLOAD_MUST_NOT_BE_LOADED'
const testRoot = join(repoRoot, 'tmp', 'agent-overview-scoped-read')

function isInside(parent, child) {
  const path = relative(parent, child)
  return Boolean(path) && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
}

function captureError(fn) {
  try {
    fn()
    return null
  } catch (error) {
    return error
  }
}

async function captureAsyncError(fn) {
  try {
    await fn()
    return null
  } catch (error) {
    return error
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function makeFixture() {
  const data = createLongNovelFixture(5)
  const at = '2026-09-07T02:00:00.000Z'
  data.settings.apiKey = SECRET
  data.settings.hasApiKey = true
  data.projects[0].updatedAt = '2026-09-07T03:00:00.000Z'
  data.chapters[0].body = `${PROSE_SENTINEL}\n${data.chapters[0].body}`
  data.chapters[4].archivedAt = at
  data.chapters[4].updatedAt = at

  const legacyJob = data.chapterGenerationJobs[0]
  delete legacyJob.pipelineMode
  const legacyStep = data.chapterGenerationSteps.find((step) => step.jobId === legacyJob.id)
  legacyStep.inputSnapshot = JSON.stringify({ pipelineMode: 'aggressive', marker: HISTORY_SENTINEL })
  data.chapterGenerationSteps[1].output = HISTORY_SENTINEL.repeat(20)
  data.chapterVersions[0].body = HISTORY_SENTINEL.repeat(20)
  data.chapterCommitBundles[0] = {
    ...data.chapterCommitBundles[0],
    chapter: { ...data.chapterCommitBundles[0].chapter, body: HISTORY_SENTINEL.repeat(20) }
  }
  data.generationRunTraces[0].contextWarnings = [HISTORY_SENTINEL]
  data.promptContextSnapshots[0].finalPrompt = HISTORY_SENTINEL.repeat(20)

  const secondActive = {
    ...data.chapters[0],
    id: 'second-active-chapter',
    projectId: LONG_NOVEL_SECOND_PROJECT_ID,
    order: 2,
    title: '第二项目正文',
    body: '第二项目的合成正文。',
    archivedAt: null,
    createdAt: at,
    updatedAt: at
  }
  const secondArchived = {
    ...secondActive,
    id: 'second-archived-chapter',
    order: 7,
    title: '第二项目存档章节',
    archivedAt: at
  }
  data.chapters.push(secondActive, secondArchived)
  data.characters.push({
    ...data.characters[0],
    id: 'second-character',
    projectId: LONG_NOVEL_SECOND_PROJECT_ID,
    name: '第二项目角色'
  })
  data.foreshadowings.push({
    ...data.foreshadowings[0],
    id: 'second-hook',
    projectId: LONG_NOVEL_SECOND_PROJECT_ID,
    title: '第二项目伏笔',
    status: 'unresolved'
  })
  data.hardCanonPacks = [{
    id: 'hard-canon-main',
    projectId: LONG_NOVEL_PROJECT_ID,
    title: '合成硬设定',
    description: '',
    items: [
      { id: 'canon-active', projectId: LONG_NOVEL_PROJECT_ID, category: 'world_rule', title: '规则',
        content: '固定规则。', priority: 'must', status: 'active', sourceType: 'manual', createdAt: at, updatedAt: at },
      { id: 'canon-inactive', projectId: LONG_NOVEL_PROJECT_ID, category: 'other', title: '旧规则',
        content: '停用规则。', priority: 'medium', status: 'inactive', sourceType: 'manual', createdAt: at, updatedAt: at }
    ],
    maxPromptTokens: 900,
    schemaVersion: 1,
    createdAt: at,
    updatedAt: at
  }]
  data.storyDirectionGuides = [{
    id: 'direction-main',
    projectId: LONG_NOVEL_PROJECT_ID,
    title: '当前方向',
    status: 'active',
    source: 'manual',
    horizonChapters: 5,
    startChapterOrder: 6,
    endChapterOrder: 10,
    chapterBeats: [],
    createdAt: at,
    updatedAt: at
  }]
  data.memoryUpdateCandidates = [
    { id: 'memory-pending', projectId: LONG_NOVEL_PROJECT_ID, jobId: legacyJob.id,
      type: 'chapter_review_update', sourceChapterId: data.chapters[0].id, sourceChapterOrder: 1,
      proposedPatch: {}, evidence: '合成证据', confidence: 0.8, status: 'pending', createdAt: at, updatedAt: at },
    { id: 'memory-accepted', projectId: LONG_NOVEL_PROJECT_ID, jobId: legacyJob.id,
      type: 'chapter_review_update', sourceChapterId: data.chapters[0].id, sourceChapterOrder: 1,
      proposedPatch: {}, evidence: '合成证据', confidence: 0.8, status: 'accepted', createdAt: at, updatedAt: at },
    { id: 'memory-second', projectId: LONG_NOVEL_SECOND_PROJECT_ID, jobId: null,
      type: 'chapter_review_update', sourceChapterId: secondActive.id, sourceChapterOrder: 2,
      proposedPatch: {}, evidence: '合成证据', confidence: 0.8, status: 'rejected', createdAt: at, updatedAt: at }
  ]
  data.characterStateChangeCandidates = [
    { id: 'state-pending', projectId: LONG_NOVEL_PROJECT_ID, jobId: legacyJob.id,
      characterId: data.characters[0].id, chapterId: data.chapters[0].id, chapterOrder: 1,
      candidateType: 'create_fact', targetFactId: null, proposedFact: null, proposedTransaction: null,
      beforeValue: null, afterValue: '合成状态', evidence: '合成证据', confidence: 0.8,
      riskLevel: 'low', status: 'pending', createdAt: at, updatedAt: at },
    { id: 'state-rejected', projectId: LONG_NOVEL_PROJECT_ID, jobId: legacyJob.id,
      characterId: data.characters[0].id, chapterId: data.chapters[0].id, chapterOrder: 1,
      candidateType: 'create_fact', targetFactId: null, proposedFact: null, proposedTransaction: null,
      beforeValue: null, afterValue: '合成状态', evidence: '合成证据', confidence: 0.8,
      riskLevel: 'low', status: 'rejected', createdAt: at, updatedAt: at }
  ]
  return data
}

const instrumentation = {
  phase: 'setup',
  connections: [],
  statements: [],
  pragmas: [],
  execs: [],
  afterStatement: null
}

function instrumentDatabase(db, filename, options) {
  const connection = {
    filename: String(filename),
    options: options ?? {},
    openedIn: instrumentation.phase,
    closed: false,
    transactionDepth: 0,
    transactionCalls: 0
  }
  instrumentation.connections.push(connection)
  const originalPrepare = db.prepare.bind(db)
  const originalPragma = db.pragma.bind(db)
  const originalExec = db.exec.bind(db)
  const originalTransaction = db.transaction.bind(db)
  const originalClose = db.close.bind(db)

  db.prepare = (sql) => {
    const statement = originalPrepare(sql)
    return new Proxy(statement, {
      get(target, property) {
        const value = Reflect.get(target, property, target)
        if (!['all', 'get', 'run'].includes(property) || typeof value !== 'function') {
          return typeof value === 'function' ? value.bind(target) : value
        }
        return (...args) => {
          const event = {
            phase: instrumentation.phase,
            connection,
            sql: String(sql),
            method: property,
            args,
            transactionDepth: connection.transactionDepth
          }
          instrumentation.statements.push(event)
          const result = value.apply(target, args)
          instrumentation.afterStatement?.(event, result)
          return result
        }
      }
    })
  }
  db.pragma = (source, pragmaOptions) => {
    instrumentation.pragmas.push({ phase: instrumentation.phase, connection, source: String(source) })
    return pragmaOptions === undefined
      ? originalPragma(source)
      : originalPragma(source, pragmaOptions)
  }
  db.exec = (sql) => {
    instrumentation.execs.push({ phase: instrumentation.phase, connection, sql: String(sql) })
    return originalExec(sql)
  }
  db.transaction = (fn) => {
    connection.transactionCalls += 1
    return originalTransaction((...args) => {
      connection.transactionDepth += 1
      try {
        return fn(...args)
      } finally {
        connection.transactionDepth -= 1
      }
    })
  }
  db.close = () => {
    try {
      return originalClose()
    } finally {
      connection.closed = true
    }
  }
  return db
}

function InstrumentedDatabase(filename, options) {
  return instrumentDatabase(new NativeDatabase(filename, options), filename, options)
}
Object.setPrototypeOf(InstrumentedDatabase, NativeDatabase)
InstrumentedDatabase.prototype = NativeDatabase.prototype

function phaseEvents(phase) {
  return {
    connections: instrumentation.connections.filter((item) => item.openedIn === phase),
    statements: instrumentation.statements.filter((item) => item.phase === phase),
    pragmas: instrumentation.pragmas.filter((item) => item.phase === phase),
    execs: instrumentation.execs.filter((item) => item.phase === phase)
  }
}

function assertConnectionsClosed(phase) {
  const open = phaseEvents(phase).connections.filter((connection) => !connection.closed)
  assert.equal(open.length, 0, `${phase}: every SQLite handle must be closed.`)
}

function assertScopedSql(phase) {
  const events = phaseEvents(phase)
  assert(events.connections.length > 0, `${phase}: expected a SQLite connection.`)
  assert(events.connections.every((item) => item.options.readonly === true && item.options.fileMustExist === true),
    `${phase}: overview connections must be native read-only connections.`)
  const entityReads = events.statements.filter((item) => /\bFROM\s+entities\b/i.test(item.sql))
  assert(entityReads.length > 0, `${phase}: expected a scoped entities query.`)
  for (const read of entityReads) {
    assert.match(read.sql, /WHERE\s+collection\s+IN\s*\(/i)
    assert.equal(read.transactionDepth, 1, `${phase}: collection read must run in the snapshot transaction.`)
    assert.deepEqual(read.args, OVERVIEW_COLLECTIONS, `${phase}: query must bind exactly the 12 overview collections.`)
  }
  const revisionReads = events.statements.filter((item) => /\bFROM\s+meta\b/i.test(item.sql))
  assert.equal(revisionReads.length, entityReads.length, `${phase}: each collection snapshot needs one revision read.`)
  assert(revisionReads.every((item) => item.transactionDepth === 1), `${phase}: revision must share the read transaction.`)
  assert(!events.statements.some((item) => /\bFROM\s+app_settings\b/i.test(item.sql)),
    `${phase}: overview must not read settings.`)
  assert(!events.execs.some((item) => /CREATE\s+TABLE|CREATE\s+INDEX/i.test(item.sql)),
    `${phase}: read-only overview must not initialize schema.`)
  assert(!events.pragmas.some((item) => /journal_mode\s*=/i.test(item.source)),
    `${phase}: read-only overview must not change journal mode.`)
  assert(events.connections.every((connection) => events.pragmas.some((item) =>
    item.connection === connection && /query_only\s*=\s*ON/i.test(item.source))),
  `${phase}: every overview connection must enable query_only.`)
  const observed = JSON.stringify(events.statements.map((item) => ({ sql: item.sql, args: item.args })))
  for (const collection of EXCLUDED_LARGE_COLLECTIONS) {
    assert(!observed.includes(collection), `${phase}: must not request ${collection}.`)
  }
  assertConnectionsClosed(phase)
}

function legacyPayload(modules, data, name, args) {
  const result = modules.handleAgentReadTool(name, args, data)
  assert.equal(result.handled, true, `${name}: legacy full-data handler must handle the tool.`)
  return result.payload
}

async function fileState(path) {
  try {
    const info = await stat(path)
    return { exists: true, size: info.size, mtimeMs: info.mtimeMs,
      hash: createHash('sha256').update(await readFile(path)).digest('hex') }
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false }
    throw error
  }
}

function contentState(state) {
  return state.exists
    ? { exists: true, size: state.size, hash: state.hash }
    : { exists: false }
}

await mkdir(testRoot, { recursive: true })
const workspace = await mkdtemp(join(testRoot, 'run-'))
assert(isInside(join(repoRoot, 'tmp'), workspace), 'Test workspace must stay under G:/novel/tmp.')
const entryPath = join(workspace, 'entry.mjs')
const require = createRequire(import.meta.url)
const sqliteModulePath = require.resolve('better-sqlite3')
const sqliteModule = require.cache[sqliteModulePath] ?? (require(sqliteModulePath), require.cache[sqliteModulePath])
const originalSqliteExport = sqliteModule.exports
let setupStorage = null
let consistencyWriter = null

try {
  await build({
    stdin: {
      resolveDir: repoRoot,
      contents: `
        export { normalizeAppData } from './src/shared/defaults';
        export { SqliteStorageService, loadSqliteSnapshotReadonly } from './src/storage/SqliteStorageService';
        export { loadAgentRuntimeData } from './src/agent/AgentRuntime';
        export { loadAgentProjectOverview } from './src/agent/AgentProjectOverviewRuntime';
        export { AGENT_PROJECT_OVERVIEW_COLLECTIONS } from './src/agent/agentProjectOverviewData';
        export { AgentToolService } from './src/agent/tools/AgentToolService';
        export { handleAgentReadTool } from './src/agent/tools/agentToolReadHandlers';
      `
    },
    outfile: entryPath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    logLevel: 'silent'
  })
  sqliteModule.exports = InstrumentedDatabase
  const modules = await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
  assert.deepEqual([...modules.AGENT_PROJECT_OVERVIEW_COLLECTIONS], OVERVIEW_COLLECTIONS,
    'The overview contract must contain exactly the expected 12 collections.')

  const sqlitePath = join(workspace, 'novel-director-data.sqlite')
  const userDataPath = join(workspace, 'user-data')
  await mkdir(userDataPath, { recursive: true })
  await writeFile(join(userDataPath, 'app-config.json'), JSON.stringify({ storagePath: sqlitePath }), 'utf8')
  const fixture = modules.normalizeAppData(makeFixture())
  instrumentation.phase = 'setup'
  setupStorage = new modules.SqliteStorageService(sqlitePath)
  await setupStorage.save(fixture)
  setupStorage.close()
  setupStorage = null

  // Keep this row in the legacy on-disk shape: no pipelineMode on the job, while
  // its step snapshot carries the mode. Full normalization restores it from steps;
  // overview normalization intentionally cannot and need not do so.
  const patchDb = new NativeDatabase(sqlitePath)
  try {
    const jobRow = patchDb.prepare('SELECT json FROM entities WHERE collection = ? AND id = ?')
      .get('chapterGenerationJobs', 'perf-job-1')
    const legacyJob = JSON.parse(jobRow.json)
    delete legacyJob.pipelineMode
    delete legacyJob.pipelineRecipe
    delete legacyJob.pipelineRecipeId
    delete legacyJob.pipelineRecipeVersion
    patchDb.prepare('UPDATE entities SET json = ? WHERE collection = ? AND id = ?')
      .run(JSON.stringify(legacyJob), 'chapterGenerationJobs', 'perf-job-1')
    const settings = JSON.parse(patchDb.prepare('SELECT json FROM app_settings WHERE id = ?').get('default').json)
    settings.apiKey = SECRET
    settings.hasApiKey = true
    patchDb.prepare('UPDATE app_settings SET json = ? WHERE id = ?').run(JSON.stringify(settings), 'default')
  } finally {
    patchDb.close()
  }
  assertConnectionsClosed('setup')

  instrumentation.phase = 'legacy-full-baseline'
  const fullRuntime = await modules.loadAgentRuntimeData({ storagePath: sqlitePath, userDataPath })
  assert.equal(fullRuntime.data.chapterGenerationJobs.find((job) => job.id === 'perf-job-1').pipelineMode, 'aggressive',
    'Legacy full normalization must recover pipelineMode from generation steps.')
  assertConnectionsClosed('legacy-full-baseline')

  const cases = [
    { name: 'agent.listProjects', args: {} },
    { name: 'agent.getProjectDigest', args: { project: fixture.projects[0].name } },
    { name: 'agent.getProjectDigest', args: { projectId: LONG_NOVEL_SECOND_PROJECT_ID } },
    { name: 'agent.getNextChapterTarget', args: { projectId: LONG_NOVEL_PROJECT_ID } },
    { name: 'agent.getNextChapterTarget', args: { project: fixture.projects[1].name } },
    { name: 'agent.getPendingHumanReviewItems', args: { projectId: LONG_NOVEL_PROJECT_ID } },
    { name: 'agent.getPendingHumanReviewItems', args: { projectId: LONG_NOVEL_SECOND_PROJECT_ID } }
  ]
  const sqliteResponses = []
  instrumentation.phase = 'sqlite-fastpath'
  for (const testCase of cases) {
    const expected = legacyPayload(modules, fullRuntime.data, testCase.name, testCase.args)
    const response = await modules.AgentToolService.callTool({
      name: testCase.name,
      arguments: { userDataPath, ...testCase.args }
    })
    assert.deepEqual(response.data, expected, `${testCase.name}: scoped SQLite output must equal the old full-read output.`)
    assert.equal(response.storage.source, 'sqlite')
    assert.equal(response.storage.storagePath, sqlitePath)
    assert.equal(response.storage.revision, fullRuntime.revision)
    sqliteResponses.push(response)
  }
  const list = sqliteResponses[0].data
  const firstProject = list.find((item) => item.id === LONG_NOVEL_PROJECT_ID)
  const secondProject = list.find((item) => item.id === LONG_NOVEL_SECOND_PROJECT_ID)
  assert.equal(list.length, 2, 'Multi-project list must retain both projects.')
  assert.equal(firstProject.archivedChapterCount, 1, 'Archived chapters must remain represented in project counts.')
  assert.equal(secondProject.archivedChapterCount, 1, 'Archived chapters must be scoped to their own project.')
  assert.equal(sqliteResponses[3].data.nextChapterOrder, 6, 'Archived highest orders must not be reused.')
  assert.equal(sqliteResponses[4].data.nextChapterOrder, 8, 'Second-project archived orders must not be reused.')
  assert(!JSON.stringify(sqliteResponses).includes(SECRET), 'Overview tool output must not expose settings secrets.')
  assert(!JSON.stringify(sqliteResponses).includes(HISTORY_SENTINEL), 'Overview tool output must not expose history/trace payloads.')
  assertScopedSql('sqlite-fastpath')

  instrumentation.phase = 'overview-shape'
  const overview = await modules.loadAgentProjectOverview({ userDataPath })
  assert.deepEqual(Object.keys(overview.data).sort(), [...OVERVIEW_COLLECTIONS].sort(),
    'Overview runtime must return only the 12 collection contract.')
  assert.equal(overview.data.chapterGenerationJobs.find((job) => job.id === 'perf-job-1').pipelineMode, null,
    'Overview may omit the step-derived legacy pipelineMode that no overview summary exposes.')
  assertScopedSql('overview-shape')

  const noCachePath = join(workspace, 'no-cache.sqlite')
  await copyFile(sqlitePath, noCachePath)
  instrumentation.phase = 'no-cache'
  const beforeMutation = await modules.AgentToolService.callTool({
    name: 'agent.listProjects', arguments: { storagePath: noCachePath, userDataPath }
  })
  const noCacheWriter = new NativeDatabase(noCachePath)
  try {
    const row = noCacheWriter.prepare('SELECT json FROM entities WHERE collection = ? AND id = ?')
      .get('projects', LONG_NOVEL_PROJECT_ID)
    const changedProject = { ...JSON.parse(row.json), name: '无缓存更新后的项目名', updatedAt: '2026-09-07T03:30:00.000Z' }
    noCacheWriter.transaction(() => {
      noCacheWriter.prepare('UPDATE entities SET json = ?, title = ?, updated_at = ? WHERE collection = ? AND id = ?')
        .run(JSON.stringify(changedProject), changedProject.name, changedProject.updatedAt,
          'projects', LONG_NOVEL_PROJECT_ID)
      noCacheWriter.prepare('UPDATE meta SET value = ? WHERE key = ?').run('no-cache-new-revision', 'revision')
    })()
  } finally {
    noCacheWriter.close()
  }
  const afterMutation = await modules.AgentToolService.callTool({
    name: 'agent.listProjects', arguments: { storagePath: noCachePath, userDataPath }
  })
  assert.notEqual(afterMutation.storage.revision, beforeMutation.storage.revision,
    'A later overview call must observe a newer persisted revision.')
  assert.equal(afterMutation.storage.revision, 'no-cache-new-revision')
  assert.equal(afterMutation.data.find((project) => project.id === LONG_NOVEL_PROJECT_ID).name,
    '无缓存更新后的项目名', 'A later overview call must observe newer persisted data.')
  assertScopedSql('no-cache')

  instrumentation.phase = 'unknown-project-errors'
  for (const { name, args } of [
    { name: 'agent.getProjectDigest', args: { projectId: 'unknown-project' } },
    { name: 'agent.getNextChapterTarget', args: { project: 'unknown-project' } },
    { name: 'agent.getPendingHumanReviewItems', args: {} }
  ]) {
    const expectedError = captureError(() => legacyPayload(modules, fullRuntime.data, name, args))
    const actualError = await captureAsyncError(() => modules.AgentToolService.callTool({
      name,
      arguments: { storagePath: sqlitePath, userDataPath, ...args }
    }))
    assert(expectedError && actualError, `${name}: both full and scoped paths must reject invalid project input.`)
    assert.equal(errorMessage(actualError), errorMessage(expectedError), `${name}: scoped error must preserve legacy behavior.`)
  }
  assertScopedSql('unknown-project-errors')

  const sqliteBefore = await fileState(sqlitePath)
  const walBefore = await fileState(`${sqlitePath}-wal`)
  const shmBefore = await fileState(`${sqlitePath}-shm`)
  instrumentation.phase = 'readonly-invariants'
  await modules.loadAgentProjectOverview({ storagePath: sqlitePath, userDataPath })
  assert.deepEqual(await fileState(sqlitePath), sqliteBefore, 'Read-only overview must not modify the SQLite database file.')
  assert.deepEqual(await fileState(`${sqlitePath}-wal`), walBefore, 'Read-only overview must not create or modify WAL data.')
  assert.deepEqual(contentState(await fileState(`${sqlitePath}-shm`)), contentState(shmBefore),
    'Read-only overview may touch SHM lock metadata but must not change its bytes.')
  assertScopedSql('readonly-invariants')

  const transactionPath = join(workspace, 'transaction-consistency.sqlite')
  await copyFile(sqlitePath, transactionPath)
  consistencyWriter = new NativeDatabase(transactionPath)
  consistencyWriter.pragma('journal_mode = WAL')
  const oldRevision = consistencyWriter.prepare('SELECT value FROM meta WHERE key = ?').get('revision').value
  const oldProject = JSON.parse(consistencyWriter.prepare(
    'SELECT json FROM entities WHERE collection = ? AND id = ?'
  ).get('projects', LONG_NOVEL_PROJECT_ID).json)
  const newRevision = 'revision-written-between-overview-queries'
  const newProject = { ...oldProject, name: '并发写入后的项目名', updatedAt: '2026-09-07T04:00:00.000Z' }
  let injected = false
  instrumentation.phase = 'transaction-consistency'
  instrumentation.afterStatement = (event) => {
    if (injected || event.connection.filename !== transactionPath) return
    if (!/\bFROM\s+(?:entities|meta)\b/i.test(event.sql)) return
    injected = true
    consistencyWriter.transaction(() => {
      consistencyWriter.prepare('UPDATE entities SET json = ?, title = ?, updated_at = ? WHERE collection = ? AND id = ?')
        .run(JSON.stringify(newProject), newProject.name, newProject.updatedAt, 'projects', LONG_NOVEL_PROJECT_ID)
      consistencyWriter.prepare('UPDATE meta SET value = ? WHERE key = ?').run(newRevision, 'revision')
    })()
  }
  const consistent = await modules.loadAgentProjectOverview({ storagePath: transactionPath, userDataPath })
  instrumentation.afterStatement = null
  assert.equal(injected, true, 'Concurrency hook must commit between the two overview read statements.')
  assert.equal(consistent.revision, oldRevision, 'Returned revision must belong to the original read snapshot.')
  assert.equal(consistent.data.projects.find((project) => project.id === LONG_NOVEL_PROJECT_ID).name, oldProject.name,
    'Overview payload must remain on the same snapshot as its revision.')
  assert.equal(consistencyWriter.prepare('SELECT value FROM meta WHERE key = ?').get('revision').value, newRevision,
    'The concurrent writer must have committed a newer revision.')
  assert.equal(JSON.parse(consistencyWriter.prepare(
    'SELECT json FROM entities WHERE collection = ? AND id = ?'
  ).get('projects', LONG_NOVEL_PROJECT_ID).json).name, newProject.name,
  'The concurrent writer must have committed the newer payload.')
  consistencyWriter.close()
  consistencyWriter = null
  assertScopedSql('transaction-consistency')

  const fullTransactionPath = join(workspace, 'full-transaction-consistency.sqlite')
  await copyFile(sqlitePath, fullTransactionPath)
  consistencyWriter = new NativeDatabase(fullTransactionPath)
  consistencyWriter.pragma('journal_mode = WAL')
  const oldFullRevision = consistencyWriter.prepare('SELECT value FROM meta WHERE key = ?').get('revision').value
  const oldFullProject = JSON.parse(consistencyWriter.prepare(
    'SELECT json FROM entities WHERE collection = ? AND id = ?'
  ).get('projects', LONG_NOVEL_PROJECT_ID).json)
  const newFullRevision = 'revision-written-between-full-snapshot-queries'
  const newFullProject = {
    ...oldFullProject,
    name: '完整读取并发写入后的项目名',
    updatedAt: '2026-09-07T05:00:00.000Z'
  }
  let fullInjected = false
  instrumentation.phase = 'full-transaction-consistency'
  instrumentation.afterStatement = (event) => {
    if (fullInjected || event.connection.filename !== fullTransactionPath) return
    if (!/\bFROM\s+(?:entities|meta|app_settings)\b/i.test(event.sql)) return
    fullInjected = true
    consistencyWriter.transaction(() => {
      consistencyWriter.prepare('UPDATE entities SET json = ?, title = ?, updated_at = ? WHERE collection = ? AND id = ?')
        .run(JSON.stringify(newFullProject), newFullProject.name, newFullProject.updatedAt,
          'projects', LONG_NOVEL_PROJECT_ID)
      consistencyWriter.prepare('UPDATE meta SET value = ? WHERE key = ?').run(newFullRevision, 'revision')
    })()
  }
  const consistentFull = await modules.loadSqliteSnapshotReadonly(fullTransactionPath)
  instrumentation.afterStatement = null
  assert.equal(fullInjected, true, 'Full-reader concurrency hook must commit between snapshot queries.')
  assert.equal(consistentFull.revision, oldFullRevision,
    'Full-reader revision must belong to the original read snapshot.')
  assert.equal(consistentFull.data.projects.find((project) => project.id === LONG_NOVEL_PROJECT_ID).name,
    oldFullProject.name, 'Full-reader payload must remain on the same snapshot as its revision.')
  assert.equal(consistencyWriter.prepare('SELECT value FROM meta WHERE key = ?').get('revision').value,
    newFullRevision, 'The concurrent writer must commit after the full-reader snapshot starts.')
  consistencyWriter.close()
  consistencyWriter = null
  const fullTransactionEvents = phaseEvents('full-transaction-consistency')
  assert(fullTransactionEvents.statements.filter((item) => /\bFROM\s+(?:entities|meta|app_settings)\b/i.test(item.sql))
    .every((item) => item.transactionDepth === 1),
  'Full payload and revision queries must all share one read transaction.')
  assert(!fullTransactionEvents.execs.some((item) => /CREATE\s+TABLE|CREATE\s+INDEX/i.test(item.sql)))
  assert(!fullTransactionEvents.pragmas.some((item) => /journal_mode\s*=/i.test(item.source)))
  assertConnectionsClosed('full-transaction-consistency')

  instrumentation.phase = 'full-tool'
  const fullText = await modules.AgentToolService.callTool({
    name: 'agent.getChapterText',
    arguments: { storagePath: sqlitePath, userDataPath, projectId: LONG_NOVEL_PROJECT_ID,
      chapterOrder: 1, detail: 'full', maxChars: 10000 }
  })
  assert(fullText.data.text.includes(PROSE_SENTINEL), 'A non-overview full-detail tool must still read chapter prose.')
  assert(!JSON.stringify(fullText).includes(SECRET), 'A full-detail content tool must not expose the settings API key.')
  const fullEvents = phaseEvents('full-tool')
  assert(fullEvents.statements.some((item) => /SELECT\s+collection,\s*json\s+FROM\s+entities\s+ORDER\s+BY/i.test(item.sql)),
    'Non-overview tools must retain the legacy full entity read.')
  assert(fullEvents.statements.some((item) => /\bFROM\s+app_settings\b/i.test(item.sql)),
    'Non-overview tools must retain the legacy complete snapshot read.')
  assertConnectionsClosed('full-tool')

  const jsonDir = join(workspace, 'json-fallback')
  const jsonSqlitePath = join(jsonDir, 'novel-director-data.sqlite')
  const jsonPath = join(jsonDir, 'novel-director-data.json')
  await mkdir(jsonDir, { recursive: true })
  const jsonRaw = `${JSON.stringify(fixture, null, 2)}\n`
  await writeFile(jsonPath, jsonRaw, 'utf8')
  instrumentation.phase = 'json-fallback'
  const jsonOverview = await modules.loadAgentProjectOverview({ storagePath: jsonSqlitePath, userDataPath: jsonDir })
  assert.equal(jsonOverview.source, 'json')
  assert.equal(jsonOverview.storagePath, jsonPath)
  assert.equal(jsonOverview.revision, createHash('sha256').update(jsonRaw).digest('hex'))
  assert.deepEqual(Object.keys(jsonOverview.data).sort(), [...OVERVIEW_COLLECTIONS].sort())
  for (const testCase of cases) {
    const expected = legacyPayload(modules, fixture, testCase.name, testCase.args)
    const response = await modules.AgentToolService.callTool({
      name: testCase.name,
      arguments: { storagePath: jsonSqlitePath, userDataPath: jsonDir, ...testCase.args }
    })
    assert.deepEqual(response.data, expected, `${testCase.name}: JSON fallback must preserve the old full-reader result.`)
    assert.equal(response.storage.source, 'json')
    assert(!JSON.stringify(response).includes(SECRET))
  }
  assert.equal(phaseEvents('json-fallback').connections.length, 0, 'JSON fallback must not open SQLite.')
  assert(!await fileState(jsonSqlitePath).then((item) => item.exists), 'JSON fallback must not create a sibling SQLite file.')

  const emptyDir = join(workspace, 'empty')
  const emptyPath = join(emptyDir, 'novel-director-data.sqlite')
  await mkdir(emptyDir, { recursive: true })
  instrumentation.phase = 'empty-directory'
  const emptyOverview = await modules.loadAgentProjectOverview({ storagePath: emptyPath, userDataPath: emptyDir })
  assert.equal(emptyOverview.source, 'empty')
  assert.equal(emptyOverview.revision, '0')
  assert.deepEqual(Object.keys(emptyOverview.data).sort(), [...OVERVIEW_COLLECTIONS].sort())
  assert(Object.values(emptyOverview.data).every((items) => Array.isArray(items) && items.length === 0))
  const emptyList = await modules.AgentToolService.callTool({
    name: 'agent.listProjects', arguments: { storagePath: emptyPath, userDataPath: emptyDir }
  })
  assert.deepEqual(emptyList.data, [])
  assert.equal(emptyList.storage.source, 'empty')
  assert.deepEqual(await readdir(emptyDir), [], 'Empty-directory reads must not create storage or config files.')
  assert.equal(phaseEvents('empty-directory').connections.length, 0, 'Empty-directory reads must not open SQLite.')

  const malformedPath = join(workspace, 'missing-schema.sqlite')
  const malformed = new NativeDatabase(malformedPath)
  malformed.exec('CREATE TABLE unrelated (id TEXT PRIMARY KEY)')
  malformed.close()
  instrumentation.phase = 'missing-schema-error'
  const malformedError = await captureAsyncError(() => modules.loadAgentProjectOverview({
    storagePath: malformedPath, userDataPath
  }))
  assert(malformedError, 'An existing malformed-schema database must fail instead of being initialized.')
  assert.match(errorMessage(malformedError), /no such table: entities/i)
  assertConnectionsClosed('missing-schema-error')
  const malformedCheck = new NativeDatabase(malformedPath, { readonly: true })
  try {
    const tables = malformedCheck.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all().map((row) => row.name)
    assert.deepEqual(tables, ['unrelated'], 'Failed read-only overview must not create application schema.')
  } finally {
    malformedCheck.close()
  }

  assert(instrumentation.connections.every((connection) => connection.closed),
    'All instrumented SQLite handles must be closed at test completion.')
  console.log('Agent project overview scoped read validation passed.')
} finally {
  instrumentation.afterStatement = null
  consistencyWriter?.close()
  setupStorage?.close()
  sqliteModule.exports = originalSqliteExport
  assert(isInside(testRoot, workspace), 'Refusing to clean a directory outside the dedicated test root.')
  await rm(workspace, { recursive: true, force: true })
}

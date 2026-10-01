import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import Database from 'better-sqlite3'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(root, 'tmp', 'sqlite-storage-test')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function bundle(entryPoint, outfileName) {
  const outfile = join(outDir, outfileName)
  await build({
    entryPoints: [join(root, entryPoint)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3'],
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function makeData(base, overrides = {}) {
  return {
    ...base,
    schemaVersion: 3,
    projects: [],
    storyBibles: [],
    chapters: [],
    characters: [],
    characterStateLogs: [],
    characterStateFacts: [],
    characterStateTransactions: [],
    characterStateChangeCandidates: [],
    foreshadowings: [],
    timelineEvents: [],
    stageSummaries: [],
    promptVersions: [],
    promptContextSnapshots: [],
    storyDirectionGuides: [],
    contextNeedPlans: [],
    chapterContinuityBridges: [],
    chapterGenerationJobs: [],
    chapterGenerationSteps: [],
    generatedChapterDrafts: [],
    memoryUpdateCandidates: [],
    consistencyReviewReports: [],
    contextBudgetProfiles: [],
    qualityGateReports: [],
    generationRunTraces: [],
    redundancyReports: [],
    revisionCandidates: [],
    revisionSessions: [],
    revisionRequests: [],
    revisionVersions: [],
    chapterVersions: [],
    settings: {
      ...base.settings,
      apiKey: '',
      hasApiKey: false
    },
    ...overrides
  }
}

function now() {
  return '2026-01-01T00:00:00.000Z'
}

function project(id) {
  return {
    id,
    name: `Project ${id}`,
    genre: '悬疑',
    description: '',
    targetReaders: '',
    coreAppeal: '',
    style: '',
    createdAt: now(),
    updatedAt: now()
  }
}

function chapter(id, projectId, order) {
  return {
    id,
    projectId,
    order,
    title: `第 ${order} 章`,
    body: `正文 ${order}`,
    summary: '',
    newInformation: '',
    characterChanges: '',
    newForeshadowing: '',
    resolvedForeshadowing: '',
    endingHook: '',
    riskWarnings: '',
    includedInStageSummary: false,
    createdAt: now(),
    updatedAt: now()
  }
}

function character(id, projectId) {
  return {
    id,
    projectId,
    name: `角色 ${id}`,
    role: '',
    surfaceGoal: '',
    deepDesire: '',
    coreFear: '',
    selfDeception: '',
    knownInformation: '',
    unknownInformation: '',
    protagonistRelationship: '',
    emotionalState: '',
    nextActionTendency: '',
    forbiddenWriting: '',
    lastChangedChapter: null,
    isMain: true,
    createdAt: now(),
    updatedAt: now()
  }
}

function characterStateFact(id, projectId, characterId) {
  return {
    id,
    projectId,
    characterId,
    category: 'physical',
    key: 'right-arm',
    label: '右臂灼痛',
    valueType: 'text',
    value: '右臂灼痛，不能长时间挥剑',
    unit: '',
    linkedCardFields: ['weaknessAndCost', 'abilitiesAndResources'],
    trackingLevel: 'hard',
    promptPolicy: 'when_relevant',
    status: 'active',
    sourceChapterId: null,
    sourceChapterOrder: 1,
    evidence: '第 1 章',
    confidence: 1,
    createdAt: now(),
    updatedAt: now()
  }
}

function runTrace(id, projectId, jobId) {
  return {
    id,
    projectId,
    jobId,
    targetChapterOrder: 2,
    promptContextSnapshotId: null,
    contextSource: 'auto',
    selectedChapterIds: [],
    selectedStageSummaryIds: [],
    selectedCharacterIds: [],
    selectedForeshadowingIds: [],
    selectedTimelineEventIds: [],
    foreshadowingTreatmentModes: {},
    foreshadowingTreatmentOverrides: {},
    omittedContextItems: [],
    contextWarnings: [],
    finalPromptTokenEstimate: 0,
    contextTokenEstimate: 0,
    originalContextTokenEstimate: 0,
    forcedContextBlocks: [],
    compressionRecords: [],
    promptBlockOrder: [],
    generatedDraftId: null,
    consistencyReviewReportId: null,
    qualityGateReportId: null,
    revisionSessionIds: [],
    acceptedRevisionVersionId: null,
    acceptedMemoryCandidateIds: [],
    rejectedMemoryCandidateIds: [],
    continuityBridgeId: null,
    continuitySource: null,
    redundancyReportId: null,
    continuityWarnings: [],
    contextNeedPlanId: null,
    requiredCharacterCardFields: {},
    requiredStateFactCategories: {},
    contextNeedPlanWarnings: [],
    contextNeedPlanMatchedItems: [],
    contextNeedPlanOmittedItems: [],
    includedCharacterStateFactIds: [],
    characterStateWarnings: [],
    characterStateIssueIds: [],
    noveltyAudit: null,
    storyDirectionGuideId: null,
    storyDirectionGuideSource: null,
    storyDirectionGuideHorizon: null,
    storyDirectionGuideStartChapterOrder: null,
    storyDirectionGuideEndChapterOrder: null,
    storyDirectionBeatId: null,
    storyDirectionAppliedToChapterTask: false,
    createdAt: now(),
    updatedAt: now()
  }
}

function sqliteText(dbPath, sql) {
  const db = new Database(dbPath)
  try {
    return db.prepare(sql).all().map((row) => JSON.stringify(row)).join('\n')
  } finally {
    db.close()
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const checks = []

  const defaultsModule = await bundle('src/shared/defaults.ts', 'defaults.mjs')
  const storageModule = await bundle('src/storage/SqliteStorageService.ts', 'sqlite-storage.mjs')
  const storageServiceModule = await bundle('src/storage/StorageService.ts', 'storage-service.mjs')
  const jsonStorageModule = await bundle('src/storage/JsonStorageService.ts', 'json-storage.mjs')
  const bundleServiceModule = await bundle('src/services/GenerationRunBundleService.ts', 'generation-run-bundle.mjs')
  const mergeModule = await bundle('src/main/DataMergeService.ts', 'data-merge.mjs')

  const { EMPTY_APP_DATA } = defaultsModule
  const { SqliteStorageService, createStorageService } = storageModule
  const { resolveSqliteStoragePath, SQLITE_DATA_FILE_NAME } = storageServiceModule
  const { JsonStorageService } = jsonStorageModule
  const { buildGenerationRunBundle, applyGenerationRunBundleToAppData } = bundleServiceModule
  const base = makeData(EMPTY_APP_DATA)

  const rendererSource = await readFile(join(root, 'src', 'renderer', 'src', 'hooks', 'useAppData.ts'), 'utf-8')
  const preloadSource = await readFile(join(root, 'src', 'preload', 'index.ts'), 'utf-8')
  const mainSource = await readFile(join(root, 'src', 'main', 'ipc', 'registerIpcHandlers.ts'), 'utf-8')
  const dataIpcSource = await readFile(join(root, 'src', 'main', 'ipc', 'dataIpcHandlers.ts'), 'utf-8')
  const storageManagementSource = await readFile(join(root, 'src', 'main', 'ipc', 'storageManagementIpcHandlers.ts'), 'utf-8')
  const backupIpcSource = await readFile(join(root, 'src', 'main', 'ipc', 'backupIpcHandlers.ts'), 'utf-8')
  const storageOpsSource = await readFile(join(root, 'src', 'main', 'ipc', 'storageDataOperations.ts'), 'utf-8')
  const dataMergeSource = [
    await readFile(join(root, 'src', 'main', 'DataMergeService.ts'), 'utf-8'),
    await readFile(join(root, 'src', 'main', 'dataMerge', 'dataFileStorage.ts'), 'utf-8')
  ].join('\n')
  const mainIndexSource = await readFile(join(root, 'src', 'main', 'index.ts'), 'utf-8')
  const appConfigSource = await readFile(join(root, 'src', 'main', 'AppConfigService.ts'), 'utf-8')
  const storageServiceSource = await readFile(join(root, 'src', 'storage', 'StorageService.ts'), 'utf-8')
  const sqliteSource = await readFile(join(root, 'src', 'storage', 'SqliteStorageService.ts'), 'utf-8')
  const agentRuntimeSource = await readFile(join(root, 'src', 'agent', 'AgentRuntime.ts'), 'utf-8')
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8'))

  checks.push(
    assert(
      !/better-sqlite3|SqliteStorageService|node:sqlite/i.test(rendererSource) &&
        !/better-sqlite3|SqliteStorageService|node:sqlite/i.test(preloadSource),
      'SQLite backend stays out of renderer and preload boundaries'
    )
  )

  checks.push(
    assert(
      agentRuntimeSource.includes('revision: string') &&
        agentRuntimeSource.includes('loadSqliteSnapshotReadonly(sqlitePath)') &&
        agentRuntimeSource.includes('.saveIfCurrent(') &&
        agentRuntimeSource.includes('isLoadedAgentRuntime(runtime) ? runtime.revision : undefined') &&
        agentRuntimeSource.includes('adoptRuntimeWriteResult(runtime, result') &&
        agentRuntimeSource.includes('storage.close?.()'),
      'Agent Runtime uses read-only snapshots, carries revisions into writes, and closes short-lived write connections'
    )
  )

  checks.push(
    assert(
      preloadSource.includes('load: loadStorageData') &&
        preloadSource.includes('save: saveStorageData') &&
        preloadSource.includes('expectedRevision: storageRevision') &&
        preloadSource.includes('saveGenerationRunBundle') &&
        !preloadSource.includes('better-sqlite3'),
      'preload keeps compatible window.novelDirector.data.load/save API shape and carries revisions internally'
    )
  )

  checks.push(
    assert(
        rendererSource.includes('OperationQueue') &&
        rendererSource.includes('createOperationQueue()') &&
        rendererSource.includes('saveGenerationRunBundle(nextInput: SaveDataInput, bundle: GenerationRunBundle)') &&
        rendererSource.includes('getNovelDirectorDataApi') &&
        rendererSource.includes('dataApi.saveGenerationRunBundle(bundle)') &&
        rendererSource.includes('persisted = await dataApi.save(next)') &&
        rendererSource.includes('commitPersistedData(next)') &&
        !rendererSource.includes('save failed; falling back to full AppData save'),
      'full AppData and bundle saves share one queue; fallback is used only when an older preload lacks the bundle IPC'
    )
  )

  checks.push(
    assert(
      storageServiceSource.includes('saveGenerationRunBundle(bundle: GenerationRunBundle, expectedRevision?: string)') &&
        storageServiceSource.includes('saveIfCurrent(data: AppData, expectedRevision?: string)') &&
        dataIpcSource.includes('IPC_CHANNELS.DATA_SAVE_GENERATION_RUN_BUNDLE') &&
        sqliteSource.includes('db.transaction') &&
        sqliteSource.includes('this.assertExpectedRevision(db, expectedRevision)') &&
        sqliteSource.includes('validateGenerationRunBundle(bundle, existing)'),
      'StorageService and IPC expose transactional GenerationRunBundle persistence'
    )
  )

  const bundleTransactionStart = sqliteSource.indexOf('private async saveEntityBundle<TContext>(')
  const bundleTransactionEnd = sqliteSource.indexOf('private writeEntityEntries(', bundleTransactionStart)
  const bundleTransactionSource = sqliteSource.slice(bundleTransactionStart, bundleTransactionEnd)
  checks.push(
    assert(
      bundleTransactionStart >= 0 &&
        bundleTransactionSource.includes('const existing = readExisting(db)') &&
        sqliteSource.includes('(db) => readGenerationBundleValidationContext(db, bundle.jobId)') &&
        bundleTransactionSource.indexOf('this.assertExpectedRevision(db, expectedRevision)') >= 0 &&
        bundleTransactionSource.indexOf('this.assertExpectedRevision(db, expectedRevision)') <
          bundleTransactionSource.indexOf('const existing =') &&
        bundleTransactionSource.indexOf('const existing =') <
          bundleTransactionSource.indexOf('entries = buildEntries(existing)') &&
        bundleTransactionSource.indexOf('entries = buildEntries(existing)') <
          bundleTransactionSource.indexOf('this.writeEntityEntries('),
      'bundle revision check, current-state validation, entry planning, and upsert share one short SQLite transaction'
    )
  )

  checks.push(
    assert(
      packageJson.dependencies?.['better-sqlite3'] &&
        appConfigSource.includes('SQLITE_DATA_FILE_NAME') &&
        SQLITE_DATA_FILE_NAME === 'novel-director-data.sqlite',
      'better-sqlite3 is declared and default app storage file is SQLite'
    )
  )

  checks.push(
    assert(
      storageServiceSource.includes('close?(): void') &&
        storageServiceSource.includes('backupTo(targetPath: string): Promise<void>') &&
        sqliteSource.includes('await db.backup(targetPath)') &&
        sqliteSource.includes('close(): void') &&
        mainIndexSource.includes('storage.close?.()'),
      'storage switching closes stale SQLite connections and exposes WAL-safe backup support'
    )
  )

  checks.push(
    assert(
      preloadSource.includes("ImportDataRequest = { expectedRevision: storageRevision, strategy }") &&
        preloadSource.includes('expectedRevision: storageRevision') &&
        dataIpcSource.includes('request?.expectedRevision ?? currentSnapshot.revision') &&
        backupIpcSource.includes('request.expectedRevision') &&
        storageManagementSource.includes('request.expectedRevision') &&
        dataMergeSource.includes('targetSnapshot.revision') &&
        dataMergeSource.includes('return await storage.loadSnapshot()') &&
        dataMergeSource.includes('storage.close?.()'),
      'import, backup restore, and migration merge preserve revision guards, return coherent snapshots, and close temporary storage handles'
    )
  )

  const emptyDbPath = join(outDir, 'empty', 'novel-director-data.sqlite')
  const emptyStorage = new SqliteStorageService(emptyDbPath)
  const emptyLoaded = await emptyStorage.load()
  emptyStorage.close()
  checks.push(
    assert(
      existsSync(emptyDbPath) && emptyLoaded.projects.length === 0 && emptyLoaded.settings.apiKey === '',
      'SQLiteStorageService initializes an empty database from EMPTY_APP_DATA',
      { emptyDbPath, projects: emptyLoaded.projects.length, apiKey: emptyLoaded.settings.apiKey }
    )
  )

  const selectedLegacyJsonPath = join(outDir, 'selected-json', 'novel-director-data.json')
  const sqliteResolvedFromJson = resolveSqliteStoragePath(selectedLegacyJsonPath)
  const storageFromJsonSelection = createStorageService(selectedLegacyJsonPath)
  checks.push(
    assert(
      sqliteResolvedFromJson.endsWith('novel-director-data.sqlite') &&
        storageFromJsonSelection.getStoragePath() === sqliteResolvedFromJson,
      'explicit legacy JSON path resolves to adjacent SQLite backend path for active storage',
      { selectedLegacyJsonPath, sqliteResolvedFromJson, activePath: storageFromJsonSelection.getStoragePath() }
    )
  )

  const roundTripPath = join(outDir, 'roundtrip', 'novel-director-data.sqlite')
  const roundTripData = makeData(base, {
    projects: [project('project-1')],
    chapters: [chapter('chapter-1', 'project-1', 1)],
    characters: [character('character-1', 'project-1')],
    characterStateFacts: [characterStateFact('fact-1', 'project-1', 'character-1')],
    generationRunTraces: [runTrace('trace-1', 'project-1', 'job-1')],
    settings: { ...base.settings, apiKey: 'TEST_PLAINTEXT_KEY_SHOULD_NOT_PERSIST', hasApiKey: true }
  })
  const roundTripStorage = new SqliteStorageService(roundTripPath)
  await roundTripStorage.save(roundTripData)
  const roundTripLoaded = await roundTripStorage.load()
  roundTripStorage.close()
  const sqlitePayloadText = sqliteText(roundTripPath, 'SELECT json FROM app_settings UNION ALL SELECT json FROM entities')
  checks.push(
    assert(
      roundTripLoaded.projects[0]?.id === 'project-1' &&
        roundTripLoaded.chapters[0]?.id === 'chapter-1' &&
        roundTripLoaded.characters[0]?.id === 'character-1' &&
        roundTripLoaded.characterStateFacts[0]?.id === 'fact-1' &&
        roundTripLoaded.generationRunTraces[0]?.id === 'trace-1',
      'SQLite save/load round-trips primary AppData collections',
      {
        projects: roundTripLoaded.projects.length,
        chapters: roundTripLoaded.chapters.length,
        characters: roundTripLoaded.characters.length,
        facts: roundTripLoaded.characterStateFacts.length,
        traces: roundTripLoaded.generationRunTraces.length
      }
    )
  )
  checks.push(
    assert(
      roundTripLoaded.settings.apiKey === '' && !sqlitePayloadText.includes('TEST_PLAINTEXT_KEY_SHOULD_NOT_PERSIST'),
      'settings.apiKey is stripped before writing SQLite payload JSON',
      { apiKey: roundTripLoaded.settings.apiKey }
    )
  )

  const concurrentSqlitePath = join(outDir, 'concurrent-sqlite', 'novel-director-data.sqlite')
  const sqliteWriterA = new SqliteStorageService(concurrentSqlitePath)
  const sqliteWriterB = new SqliteStorageService(concurrentSqlitePath)
  await sqliteWriterA.save(makeData(base, { projects: [project('shared-initial')] }))
  const sqliteSnapshotA = await sqliteWriterA.loadSnapshot()
  const sqliteSnapshotB = await sqliteWriterB.loadSnapshot()
  await sqliteWriterB.saveIfCurrent(
    makeData(base, { projects: [project('writer-b-current')] }),
    sqliteSnapshotB.revision
  )
  let staleSqliteBlocked = false
  try {
    await sqliteWriterA.saveIfCurrent(
      makeData(base, { projects: [project('writer-a-stale')] }),
      sqliteSnapshotA.revision
    )
  } catch (error) {
    staleSqliteBlocked = error?.code === 'STORAGE_REVISION_CONFLICT'
  }
  const concurrentSqliteLoaded = await sqliteWriterB.load()
  sqliteWriterA.close()
  sqliteWriterB.close()
  checks.push(
    assert(
      staleSqliteBlocked &&
        concurrentSqliteLoaded.projects.some((item) => item.id === 'writer-b-current') &&
        !concurrentSqliteLoaded.projects.some((item) => item.id === 'writer-a-stale'),
      'SQLite optimistic revision blocks a stale full AppData save from overwriting another writer',
      { staleSqliteBlocked, projects: concurrentSqliteLoaded.projects }
    )
  )

  const legacyDir = join(outDir, 'legacy-migration')
  await mkdir(legacyDir, { recursive: true })
  const legacyJsonPath = join(legacyDir, 'novel-director-data.json')
  const legacySqlitePath = join(legacyDir, 'novel-director-data.sqlite')
  await writeFile(legacyJsonPath, JSON.stringify(makeData(base, { projects: [project('legacy-project')] }), null, 2), 'utf-8')
  const migratedStorage = new SqliteStorageService(legacySqlitePath)
  const migrated = await migratedStorage.load()
  migratedStorage.close()
  const legacyFiles = await readdir(legacyDir)
  checks.push(
    assert(
      migrated.projects[0]?.id === 'legacy-project' &&
        legacyFiles.some((name) => name.startsWith('novel-director-data.json.before-sqlite-migrate.')) &&
        (await exists(legacyJsonPath)),
      'empty SQLite database imports adjacent legacy JSON and keeps a before-sqlite backup',
      { legacyFiles }
    )
  )

  const mislabeledDir = join(outDir, 'mislabeled-sqlite-with-legacy')
  await mkdir(mislabeledDir, { recursive: true })
  const mislabeledJsonPath = join(mislabeledDir, 'novel-director-data.json')
  const mislabeledSqlitePath = join(mislabeledDir, 'novel-director-data.sqlite')
  await writeFile(
    mislabeledJsonPath,
    JSON.stringify(
      makeData(base, {
        projects: [project('full-legacy-project')],
        chapters: [chapter('full-legacy-chapter', 'full-legacy-project', 1)]
      }),
      null,
      2
    ),
    'utf-8'
  )
  await writeFile(
    mislabeledSqlitePath,
    JSON.stringify(makeData(base, { projects: [project('tiny-mislabeled-project')] }), null, 2),
    'utf-8'
  )
  const recoveredMislabeledStorage = new SqliteStorageService(mislabeledSqlitePath)
  const recoveredMislabeled = await recoveredMislabeledStorage.load()
  recoveredMislabeledStorage.close()
  const mislabeledFiles = await readdir(mislabeledDir)
  const recoveredHeader = await readFile(mislabeledSqlitePath)
  checks.push(
    assert(
      recoveredMislabeled.projects.some((item) => item.id === 'full-legacy-project') &&
        recoveredMislabeled.chapters.some((item) => item.id === 'full-legacy-chapter') &&
        !recoveredMislabeled.projects.some((item) => item.id === 'tiny-mislabeled-project') &&
        mislabeledFiles.some((name) => name.startsWith('novel-director-data.sqlite.invalid-sqlite.')) &&
        recoveredHeader.subarray(0, 15).toString('utf-8') === 'SQLite format 3',
      'invalid JSON content at a .sqlite path is backed up and recovered from the richer adjacent legacy JSON',
      { mislabeledFiles, projects: recoveredMislabeled.projects.map((item) => item.id) }
    )
  )

  const onlyMislabeledDir = join(outDir, 'mislabeled-sqlite-only')
  await mkdir(onlyMislabeledDir, { recursive: true })
  const onlyMislabeledSqlitePath = join(onlyMislabeledDir, 'novel-director-data.sqlite')
  await writeFile(
    onlyMislabeledSqlitePath,
    JSON.stringify(makeData(base, { projects: [project('mislabeled-json-project')] }), null, 2),
    'utf-8'
  )
  const recoveredOnlyMislabeledStorage = new SqliteStorageService(onlyMislabeledSqlitePath)
  const recoveredOnlyMislabeled = await recoveredOnlyMislabeledStorage.load()
  recoveredOnlyMislabeledStorage.close()
  const onlyMislabeledFiles = await readdir(onlyMislabeledDir)
  checks.push(
    assert(
      recoveredOnlyMislabeled.projects.some((item) => item.id === 'mislabeled-json-project') &&
        onlyMislabeledFiles.some((name) => name.startsWith('novel-director-data.sqlite.invalid-sqlite.')),
      'invalid JSON content at a .sqlite path can still be recovered when no adjacent legacy JSON exists',
      { onlyMislabeledFiles }
    )
  )

  const transactionPath = join(outDir, 'transaction', 'novel-director-data.sqlite')
  const transactionStorage = new SqliteStorageService(transactionPath)
  await transactionStorage.save(makeData(base, { projects: [project('before-failure')] }))
  transactionStorage.close()
  const txDb = new Database(transactionPath)
  txDb.exec(`
    CREATE TRIGGER fail_character_insert
    BEFORE INSERT ON entities
    WHEN NEW.collection = 'characters'
    BEGIN
      SELECT RAISE(FAIL, 'simulated transaction failure');
    END;
  `)
  txDb.close()
  let transactionFailed = false
  const failingStorage = new SqliteStorageService(transactionPath)
  try {
    await failingStorage.save(
      makeData(base, {
        projects: [project('after-failure')],
        characters: [character('trigger-character', 'after-failure')]
      })
    )
  } catch {
    transactionFailed = true
  }
  failingStorage.close()
  const afterFailureStorage = new SqliteStorageService(transactionPath)
  const afterFailure = await afterFailureStorage.load()
  afterFailureStorage.close()
  checks.push(
    assert(
      transactionFailed &&
        afterFailure.projects.some((item) => item.id === 'before-failure') &&
        !afterFailure.projects.some((item) => item.id === 'after-failure') &&
        afterFailure.characters.length === 0,
      'SQLite save is transactional and does not leave half-written AppData on failure',
      { transactionFailed, projects: afterFailure.projects, characters: afterFailure.characters }
    )
  )

  const jsonPath = join(outDir, 'legacy-json', 'novel-director-data.json')
  const jsonStorage = new JsonStorageService(jsonPath)
  await jsonStorage.save(makeData(base, { projects: [project('json-project')] }))
  const jsonLoaded = await jsonStorage.load()
  checks.push(assert(jsonLoaded.projects[0]?.id === 'json-project', 'JsonStorageService remains usable as legacy fallback'))

  const concurrentJsonPath = join(outDir, 'concurrent-json', 'novel-director-data.json')
  const jsonWriterA = new JsonStorageService(concurrentJsonPath)
  const jsonWriterB = new JsonStorageService(concurrentJsonPath)
  await jsonWriterA.save(makeData(base, { projects: [project('json-shared-initial')] }))
  const jsonSnapshotA = await jsonWriterA.loadSnapshot()
  const jsonSnapshotB = await jsonWriterB.loadSnapshot()
  await jsonWriterB.saveIfCurrent(
    makeData(base, { projects: [project('json-writer-b-current')] }),
    jsonSnapshotB.revision
  )
  let staleJsonBlocked = false
  try {
    await jsonWriterA.saveIfCurrent(
      makeData(base, { projects: [project('json-writer-a-stale')] }),
      jsonSnapshotA.revision
    )
  } catch (error) {
    staleJsonBlocked = error?.code === 'STORAGE_REVISION_CONFLICT'
  }
  const concurrentJsonLoaded = await jsonWriterB.load()
  checks.push(
    assert(
      staleJsonBlocked &&
        concurrentJsonLoaded.projects.some((item) => item.id === 'json-writer-b-current') &&
        !concurrentJsonLoaded.projects.some((item) => item.id === 'json-writer-a-stale'),
      'JSON fallback rejects a stale snapshot before replacing the data file',
      { staleJsonBlocked, projects: concurrentJsonLoaded.projects }
    )
  )

  function generationRunData(jobId, projectId = 'bundle-project') {
    const timestamp = now()
    const job = {
      id: jobId,
      projectId,
      targetChapterOrder: 2,
      promptContextSnapshotId: null,
      contextSource: 'auto',
      status: 'completed',
      currentStep: 'await_user_confirmation',
      createdAt: timestamp,
      updatedAt: timestamp,
      errorMessage: ''
    }
    const contextNeedPlan = {
      id: `${jobId}-context-plan`,
      projectId,
      targetChapterOrder: 2,
      source: 'generation_pipeline',
      chapterIntent: '推进第二章',
      expectedSceneType: 'custom',
      expectedCharacters: [],
      requiredCharacterCardFields: {},
      requiredStateFactCategories: {},
      requiredForeshadowingIds: [],
      forbiddenForeshadowingIds: [],
      requiredTimelineEventIds: [],
      requiredWorldbuildingKeys: [],
      mustCheckContinuity: [],
      retrievalPriorities: [],
      exclusionRules: [],
      contextNeeds: [],
      warnings: [],
      createdAt: timestamp,
      updatedAt: timestamp
    }
    const contextBudgetProfile = {
      id: `${jobId}-budget-profile`,
      projectId,
      name: '第二章流水线预算',
      maxTokens: 12000,
      mode: 'standard',
      includeRecentChaptersCount: 3,
      includeStageSummariesCount: 2,
      includeMainCharacters: true,
      includeRelatedCharacters: true,
      includeForeshadowingWeights: ['high', 'medium'],
      includeTimelineEventsCount: 5,
      styleSampleMaxChars: 1200,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    const draft = {
      id: `${jobId}-draft`,
      projectId,
      chapterId: null,
      jobId,
      title: '第二章',
      body: '正文',
      summary: '摘要',
      status: 'draft',
      tokenEstimate: 10,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    return makeData(base, {
      projects: [project(projectId)],
      chapterGenerationJobs: [job],
      chapterGenerationSteps: [
        {
          id: `${jobId}-context-plan-step`,
          jobId,
          type: 'context_need_planning',
          status: 'completed',
          inputSnapshot: '{}',
          output: JSON.stringify(contextNeedPlan),
          errorMessage: '',
          createdAt: timestamp,
          updatedAt: timestamp
        },
        {
          id: `${jobId}-budget-step`,
          jobId,
          type: 'context_budget_selection',
          status: 'completed',
          inputSnapshot: '{}',
          output: JSON.stringify({ profile: contextBudgetProfile }),
          errorMessage: '',
          createdAt: timestamp,
          updatedAt: timestamp
        },
        {
          id: `${jobId}-step`,
          jobId,
          type: 'generate_chapter_draft',
          status: 'completed',
          inputSnapshot: '{}',
          output: '{}',
          errorMessage: '',
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ],
      contextNeedPlans: [contextNeedPlan],
      contextBudgetProfiles: [contextBudgetProfile],
      generatedChapterDrafts: [draft],
      memoryUpdateCandidates: [
        {
          id: `${jobId}-memory`,
          projectId,
          jobId,
          type: 'chapter_review',
          targetId: null,
          proposedPatch: { schemaVersion: 1, kind: 'legacy_raw', summary: '候选', rawText: '{}' },
          evidence: '证据',
          confidence: 0.5,
          status: 'pending',
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ],
      characterStateChangeCandidates: [
        {
          id: `${jobId}-state-candidate`,
          projectId,
          jobId,
          characterId: 'character-1',
          chapterId: null,
          chapterOrder: 2,
          candidateType: 'create_fact',
          targetFactId: null,
          proposedFact: null,
          proposedTransaction: null,
          beforeValue: null,
          afterValue: '右臂灼痛',
          evidence: '证据',
          confidence: 0.7,
          riskLevel: 'medium',
          status: 'pending',
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ],
      redundancyReports: [
        {
          id: `${jobId}-redundancy`,
          projectId,
          jobId,
          chapterId: null,
          draftId: draft.id,
          repeatedPhrases: [],
          repeatedSceneDescriptions: [],
          repeatedExplanations: [],
          overusedIntensifiers: [],
          redundantParagraphs: [],
          compressionSuggestions: [],
          overallRedundancyScore: 0,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ],
      consistencyReviewReports: [
        {
          id: `${jobId}-consistency`,
          projectId,
          jobId,
          chapterId: null,
          promptContextSnapshotId: null,
          issues: [],
          suggestions: '',
          severitySummary: 'low',
          createdAt: timestamp
        }
      ],
      qualityGateReports: [
        {
          id: `${jobId}-quality`,
          projectId,
          jobId,
          chapterId: null,
          draftId: draft.id,
          promptContextSnapshotId: null,
          overallScore: 90,
          pass: true,
          dimensions: {},
          issues: [],
          requiredFixes: [],
          optionalSuggestions: [],
          createdAt: timestamp
        }
      ],
      generationRunTraces: [
        {
          ...runTrace(`${jobId}-trace`, projectId, jobId),
          generatedDraftId: draft.id,
          consistencyReviewReportId: `${jobId}-consistency`,
          qualityGateReportId: `${jobId}-quality`,
          redundancyReportId: `${jobId}-redundancy`,
          contextNeedPlanId: contextNeedPlan.id
        }
      ]
    })
  }

  const bundlePath = join(outDir, 'bundle-save', 'novel-director-data.sqlite')
  const bundleStorage = new SqliteStorageService(bundlePath)
  await bundleStorage.save(makeData(base, { projects: [project('unrelated-project')] }))
  const bundleData = generationRunData('bundle-job')
  const bundleRecord = buildGenerationRunBundle(bundleData, 'bundle-job')
  const bundleWrite = await bundleStorage.saveGenerationRunBundle(bundleRecord)
  const bundleLoaded = await bundleStorage.load()
  await bundleStorage.saveGenerationRunBundle(bundleRecord)
  const bundleLoadedTwice = await bundleStorage.load()
  bundleStorage.close()
  checks.push(
    assert(
      bundleWrite.savedCollections.includes('chapterGenerationJobs') &&
        bundleWrite.savedCollections.includes('contextNeedPlans') &&
        bundleWrite.savedCollections.includes('contextBudgetProfiles') &&
        bundleLoaded.projects.some((item) => item.id === 'unrelated-project') &&
        bundleLoaded.chapterGenerationJobs.some((item) => item.id === 'bundle-job') &&
        bundleLoaded.contextNeedPlans.some((item) => item.id === 'bundle-job-context-plan') &&
        bundleLoaded.contextBudgetProfiles.some((item) => item.id === 'bundle-job-budget-profile') &&
        bundleLoaded.generatedChapterDrafts.some((item) => item.id === 'bundle-job-draft') &&
        bundleLoaded.characterStateChangeCandidates.some((item) => item.id === 'bundle-job-state-candidate') &&
        bundleLoaded.redundancyReports.some((item) => item.id === 'bundle-job-redundancy') &&
        bundleLoaded.generationRunTraces.some((item) => item.generatedDraftId === 'bundle-job-draft') &&
        bundleLoadedTwice.chapterGenerationJobs.filter((item) => item.id === 'bundle-job').length === 1 &&
        bundleLoadedTwice.generatedChapterDrafts.filter((item) => item.id === 'bundle-job-draft').length === 1,
      'SQLiteStorageService.saveGenerationRunBundle transactionally upserts bundle records without deleting unrelated data or duplicating repeated saves',
      { savedCollections: bundleWrite.savedCollections }
    )
  )

  const staleBundlePath = join(outDir, 'stale-bundle-save', 'novel-director-data.sqlite')
  const staleBundleWriterA = new SqliteStorageService(staleBundlePath)
  const staleBundleWriterB = new SqliteStorageService(staleBundlePath)
  await staleBundleWriterA.save(makeData(base, { projects: [project('stale-bundle-initial')] }))
  const staleBundleSnapshotA = await staleBundleWriterA.loadSnapshot()
  const staleBundleSnapshotB = await staleBundleWriterB.loadSnapshot()
  await staleBundleWriterB.saveIfCurrent(
    makeData(base, { projects: [project('stale-bundle-external-update')] }),
    staleBundleSnapshotB.revision
  )
  let staleBundleBlocked = false
  try {
    await staleBundleWriterA.saveGenerationRunBundle(bundleRecord, staleBundleSnapshotA.revision)
  } catch (error) {
    staleBundleBlocked = error?.code === 'STORAGE_REVISION_CONFLICT'
  }
  const staleBundleLoaded = await staleBundleWriterB.load()
  staleBundleWriterA.close()
  staleBundleWriterB.close()
  checks.push(
    assert(
      staleBundleBlocked &&
        staleBundleLoaded.projects.some((item) => item.id === 'stale-bundle-external-update') &&
        !staleBundleLoaded.chapterGenerationJobs.some((item) => item.id === bundleRecord.jobId),
      'stale GenerationRunBundle save is rejected before it can diverge renderer memory from external storage',
      { staleBundleBlocked, projects: staleBundleLoaded.projects }
    )
  )

  const incrementalPath = join(outDir, 'bundle-incremental', 'novel-director-data.sqlite')
  const incrementalStorage = new SqliteStorageService(incrementalPath)
  await incrementalStorage.save(makeData(base))
  const incrementalData = generationRunData('incremental-job')
  const firstBundle = {
    ...buildGenerationRunBundle(incrementalData, 'incremental-job'),
    generatedDrafts: [],
    qualityGateReports: [],
    consistencyReviewReports: [],
    memoryUpdateCandidates: [],
    characterStateChangeCandidates: [],
    redundancyReports: [],
    runTrace: undefined
  }
  await incrementalStorage.saveGenerationRunBundle(firstBundle)
  await incrementalStorage.saveGenerationRunBundle(buildGenerationRunBundle(incrementalData, 'incremental-job'))
  const incrementalLoaded = await incrementalStorage.load()
  incrementalStorage.close()
  checks.push(
    assert(
      incrementalLoaded.chapterGenerationJobs.some((item) => item.id === 'incremental-job') &&
        incrementalLoaded.generatedChapterDrafts.some((item) => item.id === 'incremental-job-draft') &&
        incrementalLoaded.qualityGateReports.some((item) => item.id === 'incremental-job-quality'),
      'incremental bundles for the same jobId merge into one complete run record'
    )
  )

  const jsonBundlePath = join(outDir, 'json-bundle-fallback', 'novel-director-data.json')
  const jsonBundleStorage = new JsonStorageService(jsonBundlePath)
  await jsonBundleStorage.save(makeData(base))
  await jsonBundleStorage.saveGenerationRunBundle(buildGenerationRunBundle(generationRunData('json-bundle-job'), 'json-bundle-job'))
  const jsonBundleLoaded = await jsonBundleStorage.load()
  checks.push(
    assert(
      jsonBundleLoaded.chapterGenerationJobs.some((item) => item.id === 'json-bundle-job') &&
        jsonBundleLoaded.contextNeedPlans.some((item) => item.id === 'json-bundle-job-context-plan') &&
        jsonBundleLoaded.contextBudgetProfiles.some((item) => item.id === 'json-bundle-job-budget-profile') &&
        jsonBundleLoaded.generationRunTraces.some((item) => item.jobId === 'json-bundle-job'),
      'JsonStorageService.saveGenerationRunBundle works as fallback'
    )
  )

  const bundleFailurePath = join(outDir, 'bundle-transaction-failure', 'novel-director-data.sqlite')
  const bundleFailureStorage = new SqliteStorageService(bundleFailurePath)
  await bundleFailureStorage.save(makeData(base, { projects: [project('before-bundle-failure')] }))
  bundleFailureStorage.close()
  const bundleFailureDb = new Database(bundleFailurePath)
  bundleFailureDb.exec(`
    CREATE TRIGGER fail_bundle_memory_insert
    BEFORE INSERT ON entities
    WHEN NEW.collection = 'memoryUpdateCandidates'
    BEGIN
      SELECT RAISE(FAIL, 'simulated bundle transaction failure');
    END;
  `)
  bundleFailureDb.close()
  let bundleTransactionFailed = false
  const failingBundleStorage = new SqliteStorageService(bundleFailurePath)
  try {
    await failingBundleStorage.saveGenerationRunBundle(buildGenerationRunBundle(generationRunData('failing-bundle'), 'failing-bundle'))
  } catch {
    bundleTransactionFailed = true
  }
  failingBundleStorage.close()
  const afterBundleFailureStorage = new SqliteStorageService(bundleFailurePath)
  const afterBundleFailure = await afterBundleFailureStorage.load()
  afterBundleFailureStorage.close()
  checks.push(
    assert(
      bundleTransactionFailed &&
        afterBundleFailure.projects.some((item) => item.id === 'before-bundle-failure') &&
        !afterBundleFailure.chapterGenerationJobs.some((item) => item.id === 'failing-bundle') &&
        !afterBundleFailure.generatedChapterDrafts.some((item) => item.id === 'failing-bundle-draft'),
      'SQLite bundle save rolls back the entire bundle when a transaction fails',
      { bundleTransactionFailed }
    )
  )

  const fullSaveAfterBundleData = applyGenerationRunBundleToAppData(makeData(base, { projects: [project('queue-project')] }), bundleRecord)
  const fullAfterBundlePath = join(outDir, 'full-after-bundle', 'novel-director-data.sqlite')
  const fullAfterBundleStorage = new SqliteStorageService(fullAfterBundlePath)
  await fullAfterBundleStorage.save(makeData(base, { projects: [project('queue-project')] }))
  await fullAfterBundleStorage.saveGenerationRunBundle(bundleRecord)
  await fullAfterBundleStorage.save(fullSaveAfterBundleData)
  const fullAfterBundleLoaded = await fullAfterBundleStorage.load()
  fullAfterBundleStorage.close()
  checks.push(
    assert(
      fullAfterBundleLoaded.chapterGenerationJobs.some((item) => item.id === 'bundle-job') &&
        fullAfterBundleLoaded.projects.some((item) => item.id === 'queue-project'),
      'local apply plus queued full save preserves bundle records after a subsequent full AppData save'
    )
  )

  const mergeSourcePath = join(outDir, 'merge-source.sqlite')
  const mergeTargetPath = join(outDir, 'merge-target.sqlite')
  const mergeSourceStorage = new SqliteStorageService(mergeSourcePath)
  await mergeSourceStorage.save(makeData(base, { projects: [project('merge-source')] }))
  const mergeSourceSnapshot = await mergeSourceStorage.loadSnapshot()
  mergeSourceStorage.close()
  const mergeTargetStorage = new SqliteStorageService(mergeTargetPath)
  await mergeTargetStorage.save(makeData(base, { projects: [project('merge-target')] }))
  mergeTargetStorage.close()
  const preview = await mergeModule.createMigrationMergePreview(mergeSourcePath, mergeTargetPath)
  const confirmed = await mergeModule.confirmMigrationMerge(mergeSourcePath, mergeTargetPath, mergeSourceSnapshot.revision)
  const sourceBackupStorage = new SqliteStorageService(confirmed.sourceBackupPath)
  const sourceBackupData = await sourceBackupStorage.load()
  sourceBackupStorage.close()
  const targetBackupStorage = new SqliteStorageService(confirmed.targetBackupPath)
  const targetBackupData = await targetBackupStorage.load()
  targetBackupStorage.close()
  checks.push(
    assert(
      preview.canAutoMerge &&
        confirmed.data.projects.some((item) => item.id === 'merge-source') &&
        confirmed.data.projects.some((item) => item.id === 'merge-target') &&
        sourceBackupData.projects.some((item) => item.id === 'merge-source') &&
        targetBackupData.projects.some((item) => item.id === 'merge-target') &&
        (await exists(confirmed.sourceBackupPath)) &&
        (await exists(confirmed.targetBackupPath)),
      'migration merge uses revision guards and creates readable WAL-safe SQLite backups',
      {
        canAutoMerge: preview.canAutoMerge,
        sourceBackupPath: confirmed.sourceBackupPath,
        targetBackupPath: confirmed.targetBackupPath
      }
    )
  )

  const staleMergeSourcePath = join(outDir, 'stale-merge-source.sqlite')
  const staleMergeTargetPath = join(outDir, 'stale-merge-target.sqlite')
  const staleMergeSource = new SqliteStorageService(staleMergeSourcePath)
  await staleMergeSource.save(makeData(base, { projects: [project('stale-source-before')] }))
  const staleMergeSnapshot = await staleMergeSource.loadSnapshot()
  await staleMergeSource.saveIfCurrent(
    makeData(base, { projects: [project('stale-source-after')] }),
    staleMergeSnapshot.revision
  )
  staleMergeSource.close()
  const staleMergeTarget = new SqliteStorageService(staleMergeTargetPath)
  await staleMergeTarget.save(makeData(base, { projects: [project('stale-target')] }))
  staleMergeTarget.close()
  let staleMergeBlocked = false
  try {
    await mergeModule.confirmMigrationMerge(
      staleMergeSourcePath,
      staleMergeTargetPath,
      staleMergeSnapshot.revision
    )
  } catch (error) {
    staleMergeBlocked = error?.code === 'STORAGE_REVISION_CONFLICT'
  }
  const staleTargetAfter = new SqliteStorageService(staleMergeTargetPath)
  const staleTargetData = await staleTargetAfter.load()
  staleTargetAfter.close()
  checks.push(
    assert(
      staleMergeBlocked &&
        staleTargetData.projects.some((item) => item.id === 'stale-target') &&
        !staleTargetData.projects.some((item) => item.id === 'stale-source-before'),
      'stale migration merge is rejected without modifying its target'
    )
  )

  checks.push(
    assert(
      dataIpcSource.includes('IPC_CHANNELS.STORAGE_EXPORT') &&
        dataIpcSource.includes('IPC_CHANNELS.STORAGE_IMPORT') &&
        dataIpcSource.includes('JSON.stringify(sanitizeAppDataForPersistence(data), null, 2)') &&
        dataIpcSource.includes('storage.saveIfCurrent(') &&
        dataIpcSource.includes('nextData,') &&
        dataIpcSource.includes('createBackup(currentSnapshot.data, false)') &&
        dataIpcSource.includes("request?.strategy === 'merge'"),
      'export/import JSON IPC shape remains compatible while import saves through active storage backend'
    )
  )

  checks.push(
    assert(
      mainSource.includes('registerStorageManagementIpcHandlers(context)') &&
        storageManagementSource.includes('const activeStoragePath = nextStorage.getStoragePath()') &&
        storageManagementSource.includes('storagePath: activeStoragePath') &&
        storageManagementSource.includes('filters: [{ name: \'本地数据文件\', extensions: [\'sqlite\', \'db\', \'json\'] }]'),
      'migration IPC returns the actual active SQLite path and keeps local-data file picker compatibility'
    )
  )

  checks.push(
    assert(
      storageOpsSource.includes('.before-migrate.${Date.now()}.bak') &&
        storageOpsSource.includes('storage.backupTo(backupPath)') &&
        !storageOpsSource.includes('.before-migrate.${Date.now()}.json'),
      'storage migration backups keep a truthful .bak suffix and use backend-aware snapshots'
    )
  )

  const failed = checks.filter((check) => !check.ok)
  const report = { ok: failed.length === 0, totalChecks: checks.length, failed }
  console.log(JSON.stringify(report, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})

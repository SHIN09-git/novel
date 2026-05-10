import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import Database from 'better-sqlite3'

const root = resolve('.')
const outDir = join(root, 'tmp', 'revision-commit-bundle-test')

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

async function read(relativePath) {
  return readFile(join(root, relativePath), 'utf-8')
}

function now() {
  return '2026-01-01T00:00:00.000Z'
}

function makeData(overrides = {}) {
  return {
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
    chapterCommitBundles: [],
    revisionCommitBundles: [],
    settings: {
      apiProvider: 'openai',
      apiKey: '',
      hasApiKey: false,
      baseUrl: 'https://api.openai.com/v1',
      modelName: 'gpt-4.1',
      temperature: 0.8,
      maxTokens: 8000,
      enableAutoSummary: false,
      enableChapterDiagnostics: false,
      defaultTokenBudget: 16000,
      defaultPromptMode: 'standard',
      theme: 'system'
    },
    ...overrides
  }
}

function project(id) {
  return {
    id,
    name: `Project ${id}`,
    genre: '',
    description: '',
    targetReaders: '',
    coreAppeal: '',
    style: '',
    createdAt: now(),
    updatedAt: now()
  }
}

function chapter(id, projectId, body = 'old body') {
  return {
    id,
    projectId,
    order: 1,
    title: 'Chapter 1',
    body,
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

function fixture() {
  const projectId = 'project-1'
  const chapterId = 'chapter-1'
  const sessionId = 'session-1'
  const versionId = 'revision-version-1'
  const draftId = 'draft-1'
  const jobId = 'job-1'
  return makeData({
    projects: [project(projectId)],
    chapters: [chapter(chapterId, projectId)],
    chapterVersions: [
      {
        id: 'base-version-1',
        projectId,
        chapterId,
        source: 'generated_draft',
        title: 'Chapter 1',
        body: 'old body',
        note: 'base',
        createdAt: '2025-12-31T00:00:00.000Z'
      }
    ],
    generatedChapterDrafts: [
      {
        id: draftId,
        projectId,
        jobId,
        chapterId,
        title: 'Chapter 1',
        body: 'draft body',
        summary: '',
        tokenEstimate: 2,
        status: 'draft',
        createdAt: now(),
        updatedAt: now()
      }
    ],
    revisionSessions: [
      {
        id: sessionId,
        projectId,
        chapterId,
        sourceDraftId: draftId,
        status: 'active',
        createdAt: now(),
        updatedAt: now()
      }
    ],
    revisionVersions: [
      {
        id: versionId,
        sessionId,
        requestId: 'request-1',
        title: 'AI revision',
        body: 'new revised body',
        changedSummary: '',
        risks: '',
        preservedFacts: '',
        status: 'pending',
        createdAt: now(),
        updatedAt: now()
      }
    ],
    generationRunTraces: [
      {
        id: 'trace-1',
        projectId,
        jobId,
        targetChapterOrder: 1,
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
        contextTokenEstimate: 0,
        forcedContextBlocks: [],
        compressionRecords: [],
        promptBlockOrder: [],
        finalPromptTokenEstimate: 0,
        generatedDraftId: draftId,
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
        noveltyAuditResult: null,
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
    ]
  })
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const checks = []

  const serviceModule = await bundle('src/services/RevisionCommitBundleService.ts', 'revision-commit-service.mjs')
  const sqliteModule = await bundle('src/storage/SqliteStorageService.ts', 'sqlite-storage.mjs')
  const jsonModule = await bundle('src/storage/JsonStorageService.ts', 'json-storage.mjs')
  const {
    buildRevisionCommitBundle,
    applyRevisionCommitBundleToAppData,
    validateRevisionCommitBundle
  } = serviceModule
  const { SqliteStorageService } = sqliteModule
  const { JsonStorageService } = jsonModule

  const typesSource = await read('src/shared/types.ts')
  const storageSource = await read('src/storage/StorageService.ts')
  const preloadSource = await read('src/preload/index.ts')
  const ipcSource = await read('src/main/ipc/registerIpcHandlers.ts')
  const hookSource = await read('src/renderer/src/hooks/useAppData.ts')
  const studioSource = await read('src/renderer/src/views/RevisionStudioView.tsx')
  const packageSource = await read('package.json')

  checks.push(
    assert(
      typesSource.includes('export interface RevisionCommitBundle') &&
        typesSource.includes('revisionCommitBundles: RevisionCommitBundle[]') &&
        storageSource.includes('saveRevisionCommitBundle(bundle: RevisionCommitBundle)') &&
        preloadSource.includes('saveRevisionCommitBundle: (bundle: RevisionCommitBundle)') &&
        ipcSource.includes('storage.saveRevisionCommitBundle(request.bundle)') &&
        hookSource.includes('saveRevisionCommitBundle(buildCommit: RevisionCommitSaveInput)') &&
        studioSource.includes('buildRevisionCommitBundle') &&
        studioSource.includes('saveRevisionCommitBundle'),
      'RevisionCommitBundle is typed and wired through storage, IPC, preload, renderer queue and RevisionStudioView'
    )
  )

  const data = fixture()
  const bundleCommit = buildRevisionCommitBundle({
    appData: data,
    projectId: 'project-1',
    chapterId: 'chapter-1',
    revisionCommitId: 'revision-commit-1',
    newChapterVersionId: 'chapter-version-2',
    revisionSessionId: 'session-1',
    revisionVersionId: 'revision-version-1',
    revisedAt: now(),
    revisedBy: 'user_with_ai',
    afterText: 'new revised body',
    revisionReason: 'AI revision',
    revisionNote: 'accept revision'
  })
  validateRevisionCommitBundle(bundleCommit, data)
  const applied = applyRevisionCommitBundleToAppData(data, bundleCommit)
  const appliedTwice = applyRevisionCommitBundleToAppData(applied, bundleCommit)
  checks.push(
    assert(
      applied.chapters.find((item) => item.id === 'chapter-1')?.body === 'new revised body' &&
        applied.chapterVersions.some((item) => item.id === 'chapter-version-2' && item.body === 'new revised body') &&
        applied.chapterVersions.find((item) => item.id === 'chapter-version-2')?.baseChapterVersionId === 'base-version-1' &&
        applied.revisionVersions.find((item) => item.id === 'revision-version-1')?.status === 'accepted' &&
        applied.revisionSessions.find((item) => item.id === 'session-1')?.status === 'completed' &&
        applied.generatedChapterDrafts.find((item) => item.id === 'draft-1')?.status === 'accepted' &&
        applied.generationRunTraces.find((item) => item.id === 'trace-1')?.acceptedRevisionVersionId === 'revision-version-1' &&
        appliedTwice.chapterVersions.filter((item) => item.id === 'chapter-version-2').length === 1 &&
        appliedTwice.revisionCommitBundles.filter((item) => item.revisionCommitId === 'revision-commit-1').length === 1,
      'RevisionCommitBundle apply updates chapter, version chain, revision metadata, draft, trace and remains idempotent'
    )
  )

  let validationFailed = false
  try {
    validateRevisionCommitBundle({ ...bundleCommit, projectId: '' }, data)
  } catch {
    validationFailed = true
  }
  checks.push(assert(validationFailed, 'RevisionCommitBundle validation rejects missing projectId'))

  const sqlitePath = join(outDir, 'revision.sqlite')
  const sqliteStorage = new SqliteStorageService(sqlitePath, { legacyJsonPath: join(outDir, 'legacy.json') })
  await sqliteStorage.save(data)
  const write = await sqliteStorage.saveRevisionCommitBundle(bundleCommit)
  await sqliteStorage.saveRevisionCommitBundle(bundleCommit)
  const sqliteLoaded = await sqliteStorage.load()
  checks.push(
    assert(
      write.ok &&
        write.savedCollections.includes('revisionCommitBundles') &&
        write.savedCollections.includes('chapterVersions') &&
        sqliteLoaded.chapters.find((item) => item.id === 'chapter-1')?.body === 'new revised body' &&
        sqliteLoaded.revisionCommitBundles.filter((item) => item.revisionCommitId === 'revision-commit-1').length === 1 &&
        sqliteLoaded.settings.apiKey === '',
      'SQLiteStorageService.saveRevisionCommitBundle transactionally upserts revision commit records without duplicates or API keys'
    )
  )
  sqliteStorage.close()

  const failingPath = join(outDir, 'revision-fail.sqlite')
  const failingStorage = new SqliteStorageService(failingPath, { legacyJsonPath: join(outDir, 'legacy-fail.json') })
  await failingStorage.save(data)
  failingStorage.close()
  const db = new Database(failingPath)
  db.exec(`
    CREATE TRIGGER fail_revision_commit_chapter_version
    BEFORE INSERT ON entities
    WHEN NEW.collection = 'chapterVersions'
    BEGIN
      SELECT RAISE(FAIL, 'simulated chapter version failure');
    END;
  `)
  db.close()
  const failingStorageWithTrigger = new SqliteStorageService(failingPath, { legacyJsonPath: join(outDir, 'legacy-fail.json') })
  let transactionFailed = false
  try {
    await failingStorageWithTrigger.saveRevisionCommitBundle(bundleCommit)
  } catch {
    transactionFailed = true
  }
  failingStorageWithTrigger.close()
  const afterFailure = new SqliteStorageService(failingPath, { legacyJsonPath: join(outDir, 'legacy-fail.json') })
  const failedLoaded = await afterFailure.load()
  checks.push(
    assert(
      transactionFailed &&
        failedLoaded.revisionCommitBundles.length === 0 &&
        failedLoaded.chapters.find((item) => item.id === 'chapter-1')?.body === 'old body' &&
        !failedLoaded.chapterVersions.some((item) => item.id === 'chapter-version-2'),
      'SQLite transaction rollback prevents half-written revision commits'
    )
  )
  afterFailure.close()

  const jsonPath = join(outDir, 'revision.json')
  const jsonStorage = new JsonStorageService(jsonPath)
  await jsonStorage.save(data)
  await jsonStorage.saveRevisionCommitBundle(bundleCommit)
  const jsonLoaded = await jsonStorage.load()
  checks.push(
    assert(
      jsonLoaded.chapters.find((item) => item.id === 'chapter-1')?.body === 'new revised body' &&
        jsonLoaded.revisionCommitBundles.some((item) => item.revisionCommitId === 'revision-commit-1'),
      'JsonStorageService.saveRevisionCommitBundle remains available as fallback'
    )
  )

  const fullSavePath = join(outDir, 'full-save-after-revision.sqlite')
  const fullSaveStorage = new SqliteStorageService(fullSavePath, { legacyJsonPath: join(outDir, 'legacy-full.json') })
  await fullSaveStorage.save(data)
  const memoryAfterCommit = applyRevisionCommitBundleToAppData(data, bundleCommit)
  await fullSaveStorage.saveRevisionCommitBundle(bundleCommit)
  await fullSaveStorage.save(memoryAfterCommit)
  const fullSaveLoaded = await fullSaveStorage.load()
  checks.push(
    assert(
      fullSaveLoaded.revisionCommitBundles.some((item) => item.revisionCommitId === 'revision-commit-1') &&
        fullSaveLoaded.chapters.find((item) => item.id === 'chapter-1')?.body === 'new revised body',
      'full AppData save after revision commit preserves the committed revision when renderer memory is updated'
    )
  )
  fullSaveStorage.close()

  checks.push(assert(packageSource.includes('validate-p2c-revision-commit-bundle.mjs'), 'npm test runs the P2C revision commit validation script'))

  const failed = checks.filter((check) => !check.ok)
  for (const check of checks) {
    console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.message}`)
    if (!check.ok) console.log(JSON.stringify(check.details, null, 2))
  }
  if (failed.length > 0) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

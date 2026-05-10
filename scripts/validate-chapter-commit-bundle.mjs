import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import Database from 'better-sqlite3'

const root = resolve('.')
const outDir = join(root, 'tmp', 'chapter-commit-bundle-test')

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
    chapterCommitBundles: [],
    revisionCommitBundles: [],
    settings: {
      ...base.settings,
      apiKey: '',
      hasApiKey: false
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

function chapter(id, projectId, order, body = 'old body') {
  return {
    id,
    projectId,
    order,
    title: `Chapter ${order}`,
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

function fixture(base) {
  const projectId = 'project-1'
  const jobId = 'job-1'
  const draft = {
    id: 'draft-1',
    projectId,
    chapterId: null,
    jobId,
    title: 'Accepted title',
    body: 'accepted body',
    summary: 'accepted summary',
    status: 'draft',
    tokenEstimate: 12,
    createdAt: now(),
    updatedAt: now()
  }
  return makeData(base, {
    projects: [project(projectId)],
    chapters: [chapter('chapter-1', projectId, 11, 'old chapter body')],
    generatedChapterDrafts: [draft],
    qualityGateReports: [
      {
        id: 'quality-1',
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
        createdAt: now()
      }
    ],
    consistencyReviewReports: [
      {
        id: 'consistency-1',
        projectId,
        jobId,
        chapterId: null,
        promptContextSnapshotId: null,
        issues: [],
        suggestions: '',
        severitySummary: 'low',
        createdAt: now()
      }
    ],
    redundancyReports: [
      {
        id: 'redundancy-1',
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
        createdAt: now(),
        updatedAt: now()
      }
    ],
    generationRunTraces: [
      {
        id: 'trace-1',
        projectId,
        jobId,
        targetChapterOrder: 11,
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
        generatedDraftId: draft.id,
        consistencyReviewReportId: 'consistency-1',
        qualityGateReportId: 'quality-1',
        revisionSessionIds: [],
        acceptedRevisionVersionId: null,
        acceptedMemoryCandidateIds: [],
        rejectedMemoryCandidateIds: [],
        continuityBridgeId: null,
        continuitySource: null,
        redundancyReportId: 'redundancy-1',
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
  const defaultsModule = await bundle('src/shared/defaults.ts', 'defaults.mjs')
  const serviceModule = await bundle('src/services/ChapterCommitBundleService.ts', 'chapter-commit-service.mjs')
  const sqliteModule = await bundle('src/storage/SqliteStorageService.ts', 'sqlite-storage.mjs')
  const jsonModule = await bundle('src/storage/JsonStorageService.ts', 'json-storage.mjs')

  const { EMPTY_APP_DATA } = defaultsModule
  const {
    buildAcceptedDraftCommitBundle,
    applyChapterCommitBundleToAppData,
    validateChapterCommitBundle
  } = serviceModule
  const { SqliteStorageService } = sqliteModule
  const { JsonStorageService } = jsonModule

  const typesSource = await read('src/shared/types.ts')
  const storageServiceSource = await read('src/storage/StorageService.ts')
  const ipcSource = await read('src/shared/ipc/ipcChannels.ts')
  const preloadSource = await read('src/preload/index.ts')
  const mainIpcSource = await read('src/main/ipc/registerIpcHandlers.ts')
  const hookSource = await read('src/renderer/src/hooks/useAppData.ts')
  const draftAcceptanceSource = await read('src/renderer/src/views/generation/useDraftAcceptance.ts')
  const runTests = await read('scripts/run-tests.mjs')
  const base = makeData(EMPTY_APP_DATA)
  const data = fixture(base)

  checks.push(
    assert(
        typesSource.includes('export interface ChapterCommitBundle') &&
        typesSource.includes('chapterCommitBundles: ChapterCommitBundle[]') &&
        typesSource.includes("acceptedBy: 'user'"),
      'ChapterCommitBundle is declared and persisted as an AppData collection'
    )
  )

  const commit = buildAcceptedDraftCommitBundle({
    appData: data,
    projectId: 'project-1',
    draftId: 'draft-1',
    targetChapterOrder: 11,
    commitId: 'commit-1',
    chapterId: 'chapter-1',
    acceptedAt: now(),
    chapterVersionId: 'version-1',
    commitNote: 'accept draft'
  })

  const applied = applyChapterCommitBundleToAppData(data, commit)
  const appliedTwice = applyChapterCommitBundleToAppData(applied, commit)
  checks.push(
    assert(
      applied.chapters.find((item) => item.id === 'chapter-1')?.body === 'accepted body' &&
        applied.chapterVersions.find((item) => item.id === 'version-1')?.body === 'old chapter body' &&
        applied.generatedChapterDrafts.find((item) => item.id === 'draft-1')?.status === 'accepted' &&
        applied.qualityGateReports.find((item) => item.id === 'quality-1')?.chapterId === 'chapter-1' &&
        applied.consistencyReviewReports.find((item) => item.id === 'consistency-1')?.chapterId === 'chapter-1' &&
        applied.redundancyReports.find((item) => item.id === 'redundancy-1')?.chapterId === 'chapter-1' &&
        applied.chapterCommitBundles[0]?.commitId === 'commit-1',
      'accepting a draft commit updates the chapter, saves a prior version, marks draft accepted, and links reports'
    )
  )

  checks.push(
    assert(
      appliedTwice.chapterCommitBundles.filter((item) => item.commitId === 'commit-1').length === 1 &&
        appliedTwice.chapterVersions.filter((item) => item.id === 'version-1').length === 1 &&
        appliedTwice.generatedChapterDrafts.filter((item) => item.id === 'draft-1').length === 1,
      'applying the same ChapterCommitBundle is idempotent'
    )
  )

  let validationFailed = false
  try {
    validateChapterCommitBundle({ ...commit, projectId: '' }, data)
  } catch (error) {
    validationFailed = String(error).includes('projectId')
  }
  checks.push(assert(validationFailed, 'ChapterCommitBundle validation rejects missing projectId'))

  checks.push(
    assert(
      storageServiceSource.includes('saveChapterCommitBundle(bundle: ChapterCommitBundle)') &&
        ipcSource.includes('DATA_SAVE_CHAPTER_COMMIT_BUNDLE') &&
        mainIpcSource.includes('storage.saveChapterCommitBundle(request.bundle)') &&
        preloadSource.includes('saveChapterCommitBundle: (bundle: ChapterCommitBundle)') &&
        hookSource.includes('saveChapterCommitBundle(buildCommit: ChapterCommitSaveInput)') &&
        draftAcceptanceSource.includes('saveChapterCommitBundle(buildCommit)'),
      'StorageService, IPC, preload, renderer queue and acceptDraft all use saveChapterCommitBundle'
    )
  )

  const sqlitePath = join(outDir, 'commit.sqlite')
  const sqliteStorage = new SqliteStorageService(sqlitePath)
  await sqliteStorage.save(data)
  const write = await sqliteStorage.saveChapterCommitBundle(commit)
  await sqliteStorage.saveChapterCommitBundle(commit)
  const sqliteLoaded = await sqliteStorage.load()
  sqliteStorage.close()
  checks.push(
    assert(
      write.savedCollections.includes('chapterCommitBundles') &&
        sqliteLoaded.chapters.find((item) => item.id === 'chapter-1')?.body === 'accepted body' &&
        sqliteLoaded.chapterVersions.filter((item) => item.id === 'version-1').length === 1 &&
        sqliteLoaded.chapterCommitBundles.filter((item) => item.commitId === 'commit-1').length === 1,
      'SQLiteStorageService.saveChapterCommitBundle transactionally upserts commit records without duplicates'
    )
  )

  const failurePath = join(outDir, 'commit-failure.sqlite')
  const failureStorage = new SqliteStorageService(failurePath)
  await failureStorage.save(data)
  failureStorage.close()
  const db = new Database(failurePath)
  db.exec(`
    CREATE TRIGGER fail_commit_version_insert
    BEFORE INSERT ON entities
    WHEN NEW.collection = 'chapterVersions'
    BEGIN
      SELECT RAISE(FAIL, 'simulated commit failure');
    END;
  `)
  db.close()
  let transactionFailed = false
  const failingStorage = new SqliteStorageService(failurePath)
  try {
    await failingStorage.saveChapterCommitBundle(commit)
  } catch {
    transactionFailed = true
  }
  failingStorage.close()
  const afterFailureStorage = new SqliteStorageService(failurePath)
  const afterFailure = await afterFailureStorage.load()
  afterFailureStorage.close()
  checks.push(
    assert(
      transactionFailed &&
        afterFailure.chapters.find((item) => item.id === 'chapter-1')?.body === 'old chapter body' &&
        afterFailure.chapterVersions.length === 0 &&
        afterFailure.chapterCommitBundles.length === 0,
      'SQLite chapter commit save rolls back if any commit entity fails'
    )
  )

  const jsonPath = join(outDir, 'commit.json')
  const jsonStorage = new JsonStorageService(jsonPath)
  await jsonStorage.save(data)
  await jsonStorage.saveChapterCommitBundle(commit)
  const jsonLoaded = await jsonStorage.load()
  checks.push(
    assert(
      jsonLoaded.chapterCommitBundles.some((item) => item.commitId === 'commit-1') &&
        jsonLoaded.generatedChapterDrafts.find((item) => item.id === 'draft-1')?.status === 'accepted',
      'JsonStorageService.saveChapterCommitBundle remains available as fallback'
    )
  )

  checks.push(
    assert(
      runTests.includes('validate-chapter-commit-bundle.mjs'),
      'npm test runs validate-chapter-commit-bundle.mjs'
    )
  )

  const failed = checks.filter((check) => !check.ok)
  console.log(JSON.stringify({ ok: failed.length === 0, totalChecks: checks.length, failed }, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})

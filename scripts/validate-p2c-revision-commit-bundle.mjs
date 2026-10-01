import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import Database from 'better-sqlite3'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
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

  const typesSource = [
    await read('src/shared/types.ts'),
    await read('src/shared/types/appData.ts'),
    await read('src/shared/types/revision.ts')
  ].join('\n')
  const storageSource = await read('src/storage/StorageService.ts')
  const preloadSource = await read('src/preload/index.ts')
  const ipcSource = await read('src/main/ipc/registerIpcHandlers.ts')
  const dataIpcSource = await read('src/main/ipc/dataIpcHandlers.ts')
  const hookSource = await read('src/renderer/src/hooks/useAppData.ts')
  const studioSource = [
    await read('src/renderer/src/views/RevisionStudioView.tsx'),
    await read('src/renderer/src/views/revision/revisionVersionActions.ts')
  ].join('\n')
  const runTestsSource = await read('scripts/run-tests.mjs')

  checks.push(
    assert(
      typesSource.includes('export interface RevisionCommitBundle') &&
        typesSource.includes('revisionCommitBundles: RevisionCommitBundle[]') &&
        storageSource.includes('saveRevisionCommitBundle(bundle: RevisionCommitBundle, expectedRevision?: string)') &&
        preloadSource.includes('saveRevisionCommitBundle: (bundle: RevisionCommitBundle)') &&
        ipcSource.includes('registerDataIpcHandlers(context)') &&
        dataIpcSource.includes('storage.saveRevisionCommitBundle(request.bundle, request.expectedRevision)') &&
        hookSource.includes('saveRevisionCommitBundle(buildCommit: RevisionCommitSaveInput)') &&
        studioSource.includes('buildRevisionCommitBundle') &&
        studioSource.includes('saveRevisionCommitBundle') &&
        !hookSource.includes('RevisionCommitBundle save failed; falling back to full AppData save.'),
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
  const projectScopedBundle = buildRevisionCommitBundle({
    appData: {
      ...data,
      chapterVersions: [
        {
          ...data.chapterVersions[0],
          id: 'foreign-newer-version',
          projectId: 'project-2',
          createdAt: '2027-01-01T00:00:00.000Z'
        },
        ...data.chapterVersions
      ],
      generatedChapterDrafts: [
        {
          ...data.generatedChapterDrafts[0],
          projectId: 'project-2',
          chapterId: 'foreign-chapter'
        },
        ...data.generatedChapterDrafts
      ],
      generationRunTraces: [
        { ...data.generationRunTraces[0], id: 'foreign-trace', projectId: 'project-2' },
        ...data.generationRunTraces
      ],
      chapterCommitBundles: [
        {
          id: 'foreign-commit',
          commitId: 'foreign-commit',
          projectId: 'project-2',
          chapterId: 'chapter-1',
          acceptedAt: '2027-01-01T00:00:00.000Z'
        },
        {
          id: 'local-commit',
          commitId: 'local-commit',
          projectId: 'project-1',
          chapterId: 'chapter-1',
          acceptedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    },
    projectId: 'project-1',
    chapterId: 'chapter-1',
    revisionCommitId: 'revision-commit-scoped',
    newChapterVersionId: 'chapter-version-scoped',
    revisionSessionId: 'session-1',
    revisionVersionId: 'revision-version-1',
    revisedAt: now(),
    revisedBy: 'user_with_ai',
    afterText: 'new revised body'
  })
  checks.push(
    assert(
      projectScopedBundle.baseChapterVersionId === 'base-version-1' &&
        projectScopedBundle.generatedDraft?.projectId === 'project-1' &&
        projectScopedBundle.linkedGenerationRunTraceId === 'trace-1' &&
        projectScopedBundle.linkedChapterCommitId === 'local-commit',
      'RevisionCommitBundle builder scopes versions, drafts, traces and chapter commits to the target project'
    )
  )
  validateRevisionCommitBundle(bundleCommit, data)
  const applied = applyRevisionCommitBundleToAppData(data, bundleCommit)
  const appliedTwice = applyRevisionCommitBundleToAppData(applied, bundleCommit)
  checks.push(
    assert(
      applied.chapters.find((item) => item.id === 'chapter-1')?.body === 'new revised body' &&
        applied.chapterVersions.some((item) => item.id === 'chapter-version-2' && item.body === 'new revised body') &&
        applied.chapterVersions.find((item) => item.id === 'chapter-version-2')?.source === 'user_with_ai_revision' &&
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

  const dataAfterLaterRevision = {
    ...applied,
    chapters: applied.chapters.map((item) =>
      item.id === 'chapter-1'
        ? { ...item, body: 'newest revision body', updatedAt: '2026-01-02T00:00:00.000Z' }
        : item
    ),
    chapterVersions: [
      {
        ...bundleCommit.chapterVersion,
        id: 'chapter-version-3',
        body: 'newest revision body',
        linkedRevisionCommitId: 'revision-commit-2',
        baseChapterVersionId: bundleCommit.chapterVersion.id,
        createdAt: '2026-01-02T00:00:00.000Z'
      },
      ...applied.chapterVersions
    ]
  }
  const replayedOldRevisionCommit = applyRevisionCommitBundleToAppData(dataAfterLaterRevision, bundleCommit)
  checks.push(
    assert(
      replayedOldRevisionCommit === dataAfterLaterRevision &&
        replayedOldRevisionCommit.chapters.find((item) => item.id === 'chapter-1')?.body === 'newest revision body',
      'replaying revision A after revision B is a no-op and cannot roll the manuscript back to A'
    )
  )

  let immutableRevisionCommitBlocked = false
  try {
    validateRevisionCommitBundle(
      {
        ...bundleCommit,
        afterText: 'tampered revision body',
        chapter: { ...bundleCommit.chapter, body: 'tampered revision body' },
        chapterVersion: { ...bundleCommit.chapterVersion, body: 'tampered revision body' }
      },
      applied
    )
  } catch {
    immutableRevisionCommitBlocked = true
  }
  let staleRevisionCommitBlocked = false
  try {
    validateRevisionCommitBundle(
      bundleCommit,
      {
        ...data,
        chapters: data.chapters.map((item) =>
          item.id === 'chapter-1' ? { ...item, body: 'newer concurrent chapter body' } : item
        )
      }
    )
  } catch {
    staleRevisionCommitBlocked = true
  }
  checks.push(
    assert(
      immutableRevisionCommitBlocked && staleRevisionCommitBlocked,
      'revision commits are immutable and stale beforeText cannot overwrite a newer chapter body'
    )
  )

  let changedRevisionMetadataBlocked = false
  try {
    validateRevisionCommitBundle({ ...bundleCommit, revisionNote: 'changed after persistence' }, applied)
  } catch {
    changedRevisionMetadataBlocked = true
  }
  let foreignBaseVersionBlocked = false
  try {
    validateRevisionCommitBundle(
      {
        ...bundleCommit,
        baseChapterVersionId: 'foreign-base-version',
        chapterVersion: { ...bundleCommit.chapterVersion, baseChapterVersionId: 'foreign-base-version' }
      },
      {
        ...data,
        chapterVersions: [
          ...data.chapterVersions,
          { ...data.chapterVersions[0], id: 'foreign-base-version', projectId: 'project-2' }
        ]
      }
    )
  } catch {
    foreignBaseVersionBlocked = true
  }
  let foreignLinkedCommitBlocked = false
  try {
    validateRevisionCommitBundle(
      {
        ...bundleCommit,
        linkedChapterCommitId: 'foreign-chapter-commit',
        chapterVersion: { ...bundleCommit.chapterVersion, linkedChapterCommitId: 'foreign-chapter-commit' }
      },
      {
        ...data,
        chapterCommitBundles: [
          {
            id: 'foreign-chapter-commit',
            commitId: 'foreign-chapter-commit',
            projectId: 'project-2',
            chapterId: 'chapter-1',
            acceptedAt: now()
          }
        ]
      }
    )
  } catch {
    foreignLinkedCommitBlocked = true
  }
  let foreignLinkedTraceBlocked = false
  try {
    validateRevisionCommitBundle(
      {
        ...bundleCommit,
        linkedGenerationRunTraceId: 'foreign-linked-trace',
        generationRunTrace: undefined,
        chapterVersion: {
          ...bundleCommit.chapterVersion,
          linkedGenerationRunTraceId: 'foreign-linked-trace'
        }
      },
      {
        ...data,
        generationRunTraces: [
          ...data.generationRunTraces,
          { ...data.generationRunTraces[0], id: 'foreign-linked-trace', projectId: 'project-2' }
        ]
      }
    )
  } catch {
    foreignLinkedTraceBlocked = true
  }
  let crossProjectVersionCollisionBlocked = false
  try {
    validateRevisionCommitBundle(
      bundleCommit,
      {
        ...data,
        chapterVersions: [
          ...data.chapterVersions,
          { ...bundleCommit.chapterVersion, projectId: 'project-2' }
        ]
      }
    )
  } catch {
    crossProjectVersionCollisionBlocked = true
  }
  checks.push(
    assert(
      changedRevisionMetadataBlocked &&
        foreignBaseVersionBlocked &&
        foreignLinkedCommitBlocked &&
        foreignLinkedTraceBlocked &&
        crossProjectVersionCollisionBlocked,
      'revision validation protects immutable metadata, version ancestry and cross-project associations'
    )
  )

  let validationFailed = false
  try {
    validateRevisionCommitBundle({ ...bundleCommit, projectId: '' }, data)
  } catch {
    validationFailed = true
  }
  checks.push(assert(validationFailed, 'RevisionCommitBundle validation rejects missing projectId'))

  let terminalVersionRejected = false
  try {
    buildRevisionCommitBundle({
      appData: {
        ...data,
        revisionVersions: data.revisionVersions.map((version) =>
          version.id === 'revision-version-1' ? { ...version, status: 'rejected' } : version
        )
      },
      projectId: 'project-1',
      chapterId: 'chapter-1',
      revisionCommitId: 'revision-commit-terminal',
      newChapterVersionId: 'chapter-version-terminal',
      revisionSessionId: 'session-1',
      revisionVersionId: 'revision-version-1',
      revisedAt: now(),
      afterText: 'must not be committed'
    })
  } catch {
    terminalVersionRejected = true
  }
  checks.push(assert(terminalVersionRejected, 'RevisionCommitBundle refuses to accept a terminal revision version'))

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

  const replayPath = join(outDir, 'revision-replay.sqlite')
  const replayStorage = new SqliteStorageService(replayPath, { legacyJsonPath: join(outDir, 'legacy-replay.json') })
  await replayStorage.save(data)
  await replayStorage.saveRevisionCommitBundle(bundleCommit)
  const committedForReplay = await replayStorage.load()
  await replayStorage.save({
    ...committedForReplay,
    chapters: committedForReplay.chapters.map((chapter) =>
      chapter.id === 'chapter-1'
        ? { ...chapter, body: 'newest revision body', updatedAt: '2026-09-06T12:00:00.000Z' }
        : chapter
    )
  })
  const beforeReplay = await replayStorage.loadSnapshot()
  const replayWrite = await replayStorage.saveRevisionCommitBundle(bundleCommit)
  const afterReplay = await replayStorage.loadSnapshot()
  replayStorage.close()
  checks.push(
    assert(
      afterReplay.data.chapters.find((item) => item.id === 'chapter-1')?.body === 'newest revision body' &&
        afterReplay.revision === beforeReplay.revision &&
        replayWrite.savedCollections.length === 0,
      'replaying an old revision commit after a newer chapter state is a storage-level no-op'
    )
  )

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

  await jsonStorage.save({
    ...jsonLoaded,
    chapters: jsonLoaded.chapters.map((chapter) =>
      chapter.id === 'chapter-1'
        ? { ...chapter, body: 'newest JSON revision body', updatedAt: '2026-09-06T12:00:00.000Z' }
        : chapter
    )
  })
  const jsonBeforeReplay = await jsonStorage.loadSnapshot()
  const jsonReplayWrite = await jsonStorage.saveRevisionCommitBundle(bundleCommit)
  const jsonAfterReplay = await jsonStorage.loadSnapshot()
  checks.push(
    assert(
      jsonAfterReplay.data.chapters.find((item) => item.id === 'chapter-1')?.body === 'newest JSON revision body' &&
        jsonAfterReplay.revision === jsonBeforeReplay.revision &&
        jsonReplayWrite.savedCollections.length === 0,
      'JSON fallback also treats an old revision commit replay as a no-op'
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

  checks.push(assert(runTestsSource.includes('validate-p2c-revision-commit-bundle.mjs'), 'npm test runs the P2C revision commit validation script'))

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

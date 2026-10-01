import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import Database from 'better-sqlite3'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
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

function draftContentHash(body) {
  const normalized = String(body ?? '').replace(/\r\n?/g, '\n')
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= BigInt(normalized.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `draft-v1-${hash.toString(16).padStart(16, '0')}-${normalized.length}`
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
  const contentHash = draftContentHash(draft.body)
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
        draftContentHash: contentHash,
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
        draftId: draft.id,
        draftContentHash: contentHash,
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
        draftContentHash: contentHash,
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

  const typesSource = [
    await read('src/shared/types.ts'),
    await read('src/shared/types/appData.ts'),
    await read('src/shared/types/trace.ts')
  ].join('\n')
  const storageServiceSource = await read('src/storage/StorageService.ts')
  const ipcSource = await read('src/shared/ipc/ipcChannels.ts')
  const preloadSource = await read('src/preload/index.ts')
  const mainIpcSource = await read('src/main/ipc/registerIpcHandlers.ts')
  const dataIpcSource = await read('src/main/ipc/dataIpcHandlers.ts')
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

  const baseCommit = buildAcceptedDraftCommitBundle({
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
  const projectScopedCommit = buildAcceptedDraftCommitBundle({
    appData: {
      ...data,
      qualityGateReports: [
        { ...data.qualityGateReports[0], id: 'foreign-quality', projectId: 'project-2' },
        ...data.qualityGateReports
      ],
      consistencyReviewReports: [
        { ...data.consistencyReviewReports[0], id: 'foreign-consistency', projectId: 'project-2' },
        ...data.consistencyReviewReports
      ],
      redundancyReports: [
        { ...data.redundancyReports[0], id: 'foreign-redundancy', projectId: 'project-2' },
        ...data.redundancyReports
      ],
      generationRunTraces: [
        { ...data.generationRunTraces[0], id: 'foreign-trace', projectId: 'project-2' },
        ...data.generationRunTraces
      ]
    },
    projectId: 'project-1',
    draftId: 'draft-1',
    targetChapterOrder: 11,
    commitId: 'commit-project-scoped',
    chapterId: 'chapter-1',
    acceptedAt: now(),
    chapterVersionId: 'version-project-scoped'
  })
  checks.push(
    assert(
      projectScopedCommit.qualityGateReportId === 'quality-1' &&
        projectScopedCommit.consistencyReviewReportId === 'consistency-1' &&
        projectScopedCommit.generationRunTraceId === 'trace-1' &&
        projectScopedCommit.redundancyReports?.[0]?.id === 'redundancy-1',
      'ChapterCommitBundle builder ignores same-job reports and traces from another project'
    )
  )
  const newChapterCommit = buildAcceptedDraftCommitBundle({
    appData: { ...data, chapters: [] },
    projectId: 'project-1',
    draftId: 'draft-1',
    targetChapterOrder: 11,
    commitId: 'commit-new-chapter',
    chapterId: 'chapter-new',
    acceptedAt: now(),
    chapterVersionId: null
  })
  checks.push(
    assert(
      newChapterCommit.chapterVersion?.body === 'accepted body' &&
        newChapterCommit.chapterVersion?.source === 'generated_draft' &&
        newChapterCommit.chapterVersion?.linkedChapterCommitId === 'commit-new-chapter' &&
        !newChapterCommit.previousChapterVersion,
      'accepting a draft into a new chapter still creates a formal generated-draft version'
    )
  )
  const acceptedStateCandidate = {
    id: 'state-candidate-1',
    projectId: 'project-1',
    characterId: 'character-1',
    chapterId: null,
    chapterOrder: 11,
    candidateType: 'create_fact',
    targetFactId: null,
    proposedFact: null,
    proposedTransaction: null,
    beforeValue: null,
    afterValue: '右手结晶化',
    evidence: '草稿正文确认右手结晶化。',
    confidence: 0.9,
    riskLevel: 'medium',
    status: 'accepted',
    createdAt: now(),
    updatedAt: now()
  }
  const appliedStateFact = {
    id: 'state-fact-1',
    projectId: 'project-1',
    characterId: 'character-1',
    category: 'physical',
    key: 'right-hand-crystallized',
    label: '右手结晶化',
    valueType: 'text',
    value: '右手结晶化',
    unit: '',
    linkedCardFields: ['weaknessAndCost', 'abilitiesAndResources'],
    trackingLevel: 'hard',
    promptPolicy: 'when_relevant',
    status: 'active',
    sourceChapterId: 'chapter-1',
    sourceChapterOrder: 11,
    evidence: '草稿正文确认右手结晶化。',
    confidence: 0.9,
    createdAt: now(),
    updatedAt: now()
  }
  const appliedStateTransaction = {
    id: 'state-transaction-1',
    projectId: 'project-1',
    characterId: 'character-1',
    factId: appliedStateFact.id,
    chapterId: null,
    chapterOrder: 11,
    transactionType: 'create',
    beforeValue: null,
    afterValue: appliedStateFact.value,
    delta: null,
    reason: '接受草稿时确认角色状态。',
    evidence: appliedStateFact.evidence,
    source: 'pipeline',
    status: 'accepted',
    createdAt: now(),
    updatedAt: now()
  }
  const commit = {
    ...baseCommit,
    acceptedCharacterStateChangeCandidates: [acceptedStateCandidate],
    appliedCharacterStateFacts: [appliedStateFact],
    appliedCharacterStateTransactions: [appliedStateTransaction]
  }

  const applied = applyChapterCommitBundleToAppData(data, commit)
  const appliedTwice = applyChapterCommitBundleToAppData(applied, commit)
  checks.push(
    assert(
      applied.chapters.find((item) => item.id === 'chapter-1')?.body === 'accepted body' &&
        applied.chapterVersions.find((item) => item.id === 'version-1')?.body === 'accepted body' &&
        applied.chapterVersions.find((item) => item.id === 'version-1')?.source === 'generated_draft' &&
        applied.chapterVersions.find((item) => item.id === 'version-1')?.baseChapterVersionId === 'version-1:before' &&
        applied.chapterVersions.find((item) => item.id === 'version-1:before')?.body === 'old chapter body' &&
        applied.generatedChapterDrafts.find((item) => item.id === 'draft-1')?.status === 'accepted' &&
        applied.qualityGateReports.find((item) => item.id === 'quality-1')?.chapterId === 'chapter-1' &&
        applied.consistencyReviewReports.find((item) => item.id === 'consistency-1')?.chapterId === 'chapter-1' &&
        applied.redundancyReports.find((item) => item.id === 'redundancy-1')?.chapterId === 'chapter-1' &&
        applied.characterStateChangeCandidates.find((item) => item.id === 'state-candidate-1')?.status === 'accepted' &&
        applied.characterStateFacts.find((item) => item.id === 'state-fact-1')?.value === '右手结晶化' &&
        applied.characterStateTransactions.find((item) => item.id === 'state-transaction-1')?.factId === 'state-fact-1' &&
        applied.characterStateTransactions.find((item) => item.id === 'state-transaction-1')?.chapterId === 'chapter-1' &&
        applied.chapterCommitBundles[0]?.commitId === 'commit-1',
      'accepting a draft commit updates the chapter, saves a prior version, marks draft accepted, links reports, and applies state ledger records'
    )
  )

  checks.push(
    assert(
      appliedTwice.chapterCommitBundles.filter((item) => item.commitId === 'commit-1').length === 1 &&
        appliedTwice.chapterVersions.filter((item) => item.id === 'version-1').length === 1 &&
        appliedTwice.chapterVersions.filter((item) => item.id === 'version-1:before').length === 1 &&
        appliedTwice.generatedChapterDrafts.filter((item) => item.id === 'draft-1').length === 1 &&
        appliedTwice.characterStateTransactions.filter((item) => item.id === 'state-transaction-1').length === 1,
      'applying the same ChapterCommitBundle is idempotent'
    )
  )

  const chapterAfterLaterRevision = {
    ...applied,
    chapters: applied.chapters.map((item) =>
      item.id === 'chapter-1'
        ? { ...item, body: 'later revision body', updatedAt: '2026-01-02T00:00:00.000Z' }
        : item
    )
  }
  const replayedOldChapterCommit = applyChapterCommitBundleToAppData(chapterAfterLaterRevision, commit)
  checks.push(
    assert(
      replayedOldChapterCommit === chapterAfterLaterRevision &&
        replayedOldChapterCommit.chapters.find((item) => item.id === 'chapter-1')?.body === 'later revision body',
      'replaying an older ChapterCommitBundle after a later revision is a no-op and cannot roll back the chapter'
    )
  )

  let duplicateAcceptanceBlocked = false
  try {
    buildAcceptedDraftCommitBundle({
      appData: applied,
      projectId: 'project-1',
      draftId: 'draft-1',
      targetChapterOrder: 11,
      commitId: 'commit-duplicate',
      chapterId: 'chapter-1',
      acceptedAt: now(),
      chapterVersionId: 'version-duplicate'
    })
  } catch {
    duplicateAcceptanceBlocked = true
  }
  checks.push(
    assert(
      duplicateAcceptanceBlocked && draftAcceptanceSource.includes("item.id === draft.id && item.status === 'draft'"),
      'an already accepted draft cannot create a second commit or be flipped to rejected by a stale action'
    )
  )

  let immutableCommitBlocked = false
  try {
    validateChapterCommitBundle(
      { ...commit, chapter: { ...commit.chapter, body: 'tampered accepted body' } },
      applied
    )
  } catch {
    immutableCommitBlocked = true
  }
  let craftedSecondCommitBlocked = false
  try {
    validateChapterCommitBundle(
      {
        ...commit,
        id: 'commit-crafted-second',
        commitId: 'commit-crafted-second',
        chapterVersion: {
          ...commit.chapterVersion,
          id: 'version-crafted-second',
          linkedChapterCommitId: 'commit-crafted-second'
        },
        previousChapterVersion: undefined
      },
      applied
    )
  } catch {
    craftedSecondCommitBlocked = true
  }
  checks.push(
    assert(
      immutableCommitBlocked && craftedSecondCommitBlocked,
      'persisted chapter commits are immutable and an accepted draft cannot be recommitted through a crafted bundle'
    )
  )

  let changedCommitMetadataBlocked = false
  try {
    validateChapterCommitBundle({ ...commit, commitNote: 'changed after persistence' }, applied)
  } catch {
    changedCommitMetadataBlocked = true
  }
  let foreignMemoryCandidateBlocked = false
  try {
    validateChapterCommitBundle(
      {
        ...commit,
        acceptedMemoryUpdateCandidates: [
          { id: 'memory-foreign', projectId: 'project-2', jobId: 'job-1', status: 'accepted' }
        ]
      },
      data
    )
  } catch {
    foreignMemoryCandidateBlocked = true
  }
  let pendingMemoryCandidateBlocked = false
  try {
    validateChapterCommitBundle(
      {
        ...commit,
        acceptedMemoryUpdateCandidates: [
          { id: 'memory-pending', projectId: 'project-1', jobId: 'job-1', status: 'pending' }
        ]
      },
      data
    )
  } catch {
    pendingMemoryCandidateBlocked = true
  }
  let foreignWorldUpdateBlocked = false
  try {
    validateChapterCommitBundle(
      {
        ...commit,
        appliedForeshadowingUpdates: [{ id: 'foreign-foreshadowing', projectId: 'project-2' }]
      },
      data
    )
  } catch {
    foreignWorldUpdateBlocked = true
  }
  let crossProjectFactCollisionBlocked = false
  try {
    validateChapterCommitBundle(
      commit,
      {
        ...data,
        characterStateFacts: [{ ...appliedStateFact, projectId: 'project-2' }]
      }
    )
  } catch {
    crossProjectFactCollisionBlocked = true
  }
  checks.push(
    assert(
      changedCommitMetadataBlocked &&
        foreignMemoryCandidateBlocked &&
        pendingMemoryCandidateBlocked &&
        foreignWorldUpdateBlocked &&
        crossProjectFactCollisionBlocked,
      'chapter commit validation protects immutable metadata, accepted-candidate boundaries and cross-project entities'
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
        storageServiceSource.includes('saveChapterCommitBundle(bundle: ChapterCommitBundle, expectedRevision?: string)') &&
        ipcSource.includes('DATA_SAVE_CHAPTER_COMMIT_BUNDLE') &&
        mainIpcSource.includes('registerDataIpcHandlers(context)') &&
        dataIpcSource.includes('storage.saveChapterCommitBundle(request.bundle, request.expectedRevision)') &&
        preloadSource.includes('saveChapterCommitBundle: (bundle: ChapterCommitBundle)') &&
        hookSource.includes('saveChapterCommitBundle(buildCommit: ChapterCommitSaveInput)') &&
        draftAcceptanceSource.includes('saveChapterCommitBundle(buildCommit)') &&
        !hookSource.includes('ChapterCommitBundle save failed; falling back to full AppData save.'),
      'StorageService, IPC, preload, renderer queue and acceptDraft use the transactional path without bypassing rejected commits'
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
        write.savedCollections.includes('characterStateTransactions') &&
        sqliteLoaded.chapters.find((item) => item.id === 'chapter-1')?.body === 'accepted body' &&
        sqliteLoaded.chapterVersions.filter((item) => item.id === 'version-1').length === 1 &&
        sqliteLoaded.characterStateTransactions.filter((item) => item.id === 'state-transaction-1').length === 1 &&
        sqliteLoaded.characterStateTransactions.find((item) => item.id === 'state-transaction-1')?.chapterId === 'chapter-1' &&
        sqliteLoaded.chapterCommitBundles.filter((item) => item.commitId === 'commit-1').length === 1,
      'SQLiteStorageService.saveChapterCommitBundle transactionally upserts commit records without duplicates'
    )
  )

  const replayPath = join(outDir, 'commit-replay.sqlite')
  const replayStorage = new SqliteStorageService(replayPath)
  await replayStorage.save(data)
  await replayStorage.saveChapterCommitBundle(commit)
  const committedForReplay = await replayStorage.load()
  await replayStorage.save({
    ...committedForReplay,
    chapters: committedForReplay.chapters.map((chapter) =>
      chapter.id === 'chapter-1'
        ? { ...chapter, body: 'later revision body', updatedAt: '2026-09-06T12:00:00.000Z' }
        : chapter
    )
  })
  const beforeReplay = await replayStorage.loadSnapshot()
  const replayWrite = await replayStorage.saveChapterCommitBundle(commit)
  const afterReplay = await replayStorage.loadSnapshot()
  replayStorage.close()
  checks.push(
    assert(
      afterReplay.data.chapters.find((item) => item.id === 'chapter-1')?.body === 'later revision body' &&
        afterReplay.revision === beforeReplay.revision &&
        replayWrite.savedCollections.length === 0,
      'replaying an old chapter commit after a later revision is a storage-level no-op'
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
        jsonLoaded.generatedChapterDrafts.find((item) => item.id === 'draft-1')?.status === 'accepted' &&
        jsonLoaded.characterStateTransactions.find((item) => item.id === 'state-transaction-1')?.chapterId === 'chapter-1',
      'JsonStorageService.saveChapterCommitBundle remains available as fallback'
    )
  )

  await jsonStorage.save({
    ...jsonLoaded,
    chapters: jsonLoaded.chapters.map((chapter) =>
      chapter.id === 'chapter-1'
        ? { ...chapter, body: 'later JSON revision body', updatedAt: '2026-09-06T12:00:00.000Z' }
        : chapter
    )
  })
  const jsonBeforeReplay = await jsonStorage.loadSnapshot()
  const jsonReplayWrite = await jsonStorage.saveChapterCommitBundle(commit)
  const jsonAfterReplay = await jsonStorage.loadSnapshot()
  checks.push(
    assert(
      jsonAfterReplay.data.chapters.find((item) => item.id === 'chapter-1')?.body === 'later JSON revision body' &&
        jsonAfterReplay.revision === jsonBeforeReplay.revision &&
        jsonReplayWrite.savedCollections.length === 0,
      'JSON fallback also treats an old chapter commit replay as a no-op'
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

import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import Database from 'better-sqlite3'

const root = resolve('.')
const outDir = join(root, 'tmp', 'version-chain-restore-test')

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
  return '2026-02-01T00:00:00.000Z'
}

function makeData(overrides = {}) {
  return {
    schemaVersion: 3,
    projects: [
      {
        id: 'project-1',
        name: 'Project 1',
        genre: '',
        description: '',
        targetReaders: '',
        coreAppeal: '',
        style: '',
        createdAt: now(),
        updatedAt: now()
      }
    ],
    storyBibles: [],
    chapters: [
      {
        id: 'chapter-1',
        projectId: 'project-1',
        order: 1,
        title: 'Chapter 1',
        body: 'current chapter body',
        summary: '',
        newInformation: '',
        characterChanges: '',
        newForeshadowing: '',
        resolvedForeshadowing: '',
        endingHook: '',
        riskWarnings: '',
        includedInStageSummary: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z'
      }
    ],
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
    consistencyReviewReports: [{ id: 'consistency-1', projectId: 'project-1' }],
    contextBudgetProfiles: [],
    qualityGateReports: [{ id: 'quality-1', projectId: 'project-1' }],
    generationRunTraces: [
      {
        id: 'trace-1',
        projectId: 'project-1',
        jobId: 'job-1',
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
        generatedDraftId: 'draft-1',
        consistencyReviewReportId: 'consistency-1',
        qualityGateReportId: 'quality-1',
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
    ],
    redundancyReports: [],
    revisionCandidates: [],
    revisionSessions: [],
    revisionRequests: [],
    revisionVersions: [],
    chapterVersions: [
      {
        id: 'version-generated-1',
        projectId: 'project-1',
        chapterId: 'chapter-1',
        source: 'generated_draft',
        title: 'Chapter 1',
        body: 'accepted draft body',
        note: 'accepted draft',
        createdAt: '2026-01-01T10:00:00.000Z',
        linkedChapterCommitId: 'chapter-commit-1',
        linkedGenerationRunTraceId: 'trace-1'
      },
      {
        id: 'version-revision-1',
        projectId: 'project-1',
        chapterId: 'chapter-1',
        source: 'ai_revision',
        title: 'Chapter 1',
        body: 'AI revised body',
        note: 'AI assisted revision',
        createdAt: '2026-01-02T10:00:00.000Z',
        linkedRevisionCommitId: 'revision-commit-old',
        linkedGenerationRunTraceId: 'trace-1',
        baseChapterVersionId: 'version-generated-1'
      }
    ],
    chapterCommitBundles: [
      {
        schemaVersion: 1,
        id: 'chapter-commit-1',
        commitId: 'chapter-commit-1',
        projectId: 'project-1',
        chapterId: 'chapter-1',
        jobId: 'job-1',
        generatedDraftId: 'draft-1',
        acceptedAt: '2026-01-01T10:00:00.000Z',
        acceptedBy: 'user',
        chapter: { id: 'chapter-1', projectId: 'project-1', title: 'Chapter 1', body: 'accepted draft body' },
        chapterVersion: {
          id: 'version-generated-1',
          projectId: 'project-1',
          chapterId: 'chapter-1',
          source: 'generated_draft',
          title: 'Chapter 1',
          body: 'accepted draft body',
          note: 'accepted draft',
          createdAt: '2026-01-01T10:00:00.000Z'
        },
        qualityGateReportId: 'quality-1',
        consistencyReviewReportId: 'consistency-1',
        generationRunTraceId: 'trace-1'
      }
    ],
    revisionCommitBundles: [
      {
        schemaVersion: 1,
        id: 'revision-commit-old',
        revisionCommitId: 'revision-commit-old',
        projectId: 'project-1',
        chapterId: 'chapter-1',
        baseChapterVersionId: 'version-generated-1',
        newChapterVersionId: 'version-revision-1',
        revisedAt: '2026-01-02T10:00:00.000Z',
        revisedBy: 'user_with_ai',
        beforeText: 'accepted draft body',
        afterText: 'AI revised body',
        chapter: { id: 'chapter-1', projectId: 'project-1', title: 'Chapter 1', body: 'AI revised body' },
        chapterVersion: {
          id: 'version-revision-1',
          projectId: 'project-1',
          chapterId: 'chapter-1',
          source: 'ai_revision',
          title: 'Chapter 1',
          body: 'AI revised body',
          note: 'AI assisted revision',
          createdAt: '2026-01-02T10:00:00.000Z',
          linkedRevisionCommitId: 'revision-commit-old',
          baseChapterVersionId: 'version-generated-1'
        },
        linkedGenerationRunTraceId: 'trace-1'
      }
    ],
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

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const checks = []

  const chainModule = await bundle('src/services/ChapterVersionChainService.ts', 'chapter-version-chain.mjs')
  const revisionModule = await bundle('src/services/RevisionCommitBundleService.ts', 'revision-commit-service.mjs')
  const sqliteModule = await bundle('src/storage/SqliteStorageService.ts', 'sqlite-storage.mjs')
  const jsonModule = await bundle('src/storage/JsonStorageService.ts', 'json-storage.mjs')
  const {
    getChapterVersionChain,
    getChapterVersionDetail,
    buildRestoreRevisionCommitBundle
  } = chainModule
  const { applyRevisionCommitBundleToAppData } = revisionModule
  const { SqliteStorageService } = sqliteModule
  const { JsonStorageService } = jsonModule

  const chaptersSource = await read('src/renderer/src/views/ChaptersView.tsx')
  const panelSource = await read('src/renderer/src/views/chapters/ChapterVersionHistoryPanel.tsx')
  const sqliteSource = await read('src/storage/SqliteStorageService.ts')
  const jsonSource = await read('src/storage/JsonStorageService.ts')
  const ipcSource = await read('src/main/ipc/registerIpcHandlers.ts')
  const runTestsSource = await read('scripts/run-tests.mjs')

  checks.push(
    assert(
      chaptersSource.includes('saveRevisionCommitBundle') &&
        chaptersSource.includes('buildRestoreRevisionCommitBundle') &&
        chaptersSource.includes('restoreChapterVersionEntry') &&
        panelSource.includes('RevisionDiffView') &&
        panelSource.includes('恢复此版本') &&
        panelSource.includes('关联记录'),
      '章节页使用 RevisionCommitBundle 恢复路径，并提供预览、Diff、关联记录 UI'
    )
  )

  const data = makeData()
  const chain = getChapterVersionChain(data, 'chapter-1')
  const generatedEntry = chain.find((entry) => entry.id === 'version-generated-1')
  const revisionEntry = chain.find((entry) => entry.id === 'version-revision-1')
  checks.push(
    assert(
      chain[0]?.isCurrent &&
        chain[0]?.sourceKind === 'current' &&
        generatedEntry?.sourceKind === 'generated_draft' &&
        revisionEntry?.sourceKind === 'ai_revision',
      '版本链能识别当前版本、AI 草稿采纳版本和 AI 辅助修订版本'
    )
  )

  const generatedDetail = getChapterVersionDetail(data, 'version-generated-1')
  const revisionDetail = getChapterVersionDetail(data, 'version-revision-1')
  checks.push(
    assert(
      generatedDetail?.chapterCommitBundle?.commitId === 'chapter-commit-1' &&
        generatedDetail?.generationRunTrace?.id === 'trace-1' &&
        generatedDetail?.qualityGateReport?.id === 'quality-1' &&
        generatedDetail?.consistencyReviewReport?.id === 'consistency-1' &&
        revisionDetail?.revisionCommitBundle?.revisionCommitId === 'revision-commit-old',
      '版本详情能关联草稿提交、修订提交、Run Trace、质量门禁和一致性审稿'
    )
  )

  const restoreBundle = buildRestoreRevisionCommitBundle({
    appData: data,
    projectId: 'project-1',
    chapterId: 'chapter-1',
    sourceVersionId: 'version-generated-1',
    revisionCommitId: 'restore-commit-1',
    newChapterVersionId: 'restore-version-1',
    restoredAt: now(),
    note: 'restore generated version'
  })
  const restored = applyRevisionCommitBundleToAppData(data, restoreBundle)
  let repeatedRestoreBlocked = false
  try {
    buildRestoreRevisionCommitBundle({
      appData: restored,
      projectId: 'project-1',
      chapterId: 'chapter-1',
      sourceVersionId: 'version-generated-1',
      revisionCommitId: 'restore-commit-2',
      newChapterVersionId: 'restore-version-2',
      restoredAt: now()
    })
  } catch {
    repeatedRestoreBlocked = true
  }
  checks.push(
    assert(
      restoreBundle.afterText === 'accepted draft body' &&
        restored.chapters.find((item) => item.id === 'chapter-1')?.body === 'accepted draft body' &&
        restored.chapterVersions.some((item) => item.id === 'restore-version-1') &&
        restored.chapterVersions.some((item) => item.id === 'version-generated-1') &&
        repeatedRestoreBlocked,
      '恢复历史版本会创建新的 RevisionCommitBundle 和 chapterVersion，保留旧版本，并阻止重复恢复当前正文'
    )
  )

  const sqlitePath = join(outDir, 'version-chain.sqlite')
  const sqliteStorage = new SqliteStorageService(sqlitePath, { legacyJsonPath: join(outDir, 'legacy.json') })
  await sqliteStorage.save({ ...data, settings: { ...data.settings, apiKey: 'TEST_PLAINTEXT_KEY_SHOULD_NOT_PERSIST' } })
  const sqliteWrite = await sqliteStorage.saveRevisionCommitBundle(restoreBundle)
  const sqliteLoaded = await sqliteStorage.load()
  sqliteStorage.close()
  const db = new Database(sqlitePath, { readonly: true })
  const sqlitePayload = db.prepare('SELECT group_concat(json, char(10)) AS payload FROM entities').get()?.payload ?? ''
  db.close()
  checks.push(
    assert(
      sqliteWrite.ok &&
        sqliteWrite.savedCollections.includes('revisionCommitBundles') &&
        sqliteLoaded.chapters.find((item) => item.id === 'chapter-1')?.body === 'accepted draft body' &&
        sqliteLoaded.revisionCommitBundles.some((item) => item.revisionCommitId === 'restore-commit-1') &&
        !sqlitePayload.includes('TEST_PLAINTEXT_KEY_SHOULD_NOT_PERSIST'),
      'SQLite saveRevisionCommitBundle 事务化保存恢复提交，且不会写入明文 API Key'
    )
  )

  const failingPath = join(outDir, 'version-chain-fail.sqlite')
  const failingStorage = new SqliteStorageService(failingPath, { legacyJsonPath: join(outDir, 'legacy-fail.json') })
  await failingStorage.save(data)
  failingStorage.close()
  const failingDb = new Database(failingPath)
  failingDb.exec(`
    CREATE TRIGGER fail_restore_commit
    BEFORE INSERT ON entities
    WHEN NEW.collection = 'revisionCommitBundles'
    BEGIN
      SELECT RAISE(FAIL, 'simulated restore commit failure');
    END;
  `)
  failingDb.close()
  const failingStorageWithTrigger = new SqliteStorageService(failingPath, { legacyJsonPath: join(outDir, 'legacy-fail.json') })
  let transactionFailed = false
  try {
    await failingStorageWithTrigger.saveRevisionCommitBundle(restoreBundle)
  } catch {
    transactionFailed = true
  }
  failingStorageWithTrigger.close()
  const afterFailureStorage = new SqliteStorageService(failingPath, { legacyJsonPath: join(outDir, 'legacy-fail.json') })
  const afterFailure = await afterFailureStorage.load()
  afterFailureStorage.close()
  checks.push(
    assert(
      transactionFailed &&
        afterFailure.chapters.find((item) => item.id === 'chapter-1')?.body === 'current chapter body' &&
        !afterFailure.chapterVersions.some((item) => item.id === 'restore-version-1') &&
        !afterFailure.revisionCommitBundles.some((item) => item.revisionCommitId === 'restore-commit-1'),
      'SQLite transaction 失败时不会留下半恢复提交'
    )
  )

  const jsonPath = join(outDir, 'version-chain.json')
  const jsonStorage = new JsonStorageService(jsonPath)
  await jsonStorage.save(data)
  await jsonStorage.saveRevisionCommitBundle(restoreBundle)
  const jsonLoaded = await jsonStorage.load()
  checks.push(
    assert(
      jsonLoaded.chapters.find((item) => item.id === 'chapter-1')?.body === 'accepted draft body' &&
        jsonLoaded.revisionCommitBundles.some((item) => item.revisionCommitId === 'restore-commit-1'),
      'JsonStorageService saveRevisionCommitBundle fallback 仍然可用'
    )
  )

  checks.push(
    assert(
      sqliteSource.includes('saveRevisionCommitBundle') &&
        jsonSource.includes('saveRevisionCommitBundle') &&
        ipcSource.includes('STORAGE_EXPORT') &&
        ipcSource.includes('STORAGE_IMPORT'),
      'SQLite/JSON 存储和 JSON 导入导出入口保持存在'
    )
  )
  checks.push(assert(runTestsSource.includes('validate-version-chain-restore.mjs'), 'npm test 运行版本链恢复验证脚本'))

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

import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'
import {
  createEmptyChapterRestoreFixture,
  EMPTY_CHAPTER_ID,
  EMPTY_CHAPTER_PROJECT_ID,
  HISTORICAL_VERSION_ID,
  OTHER_CHAPTER_ID,
  OTHER_PROJECT_ID
} from './fixtures/empty-chapter-restore-fixture.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'empty-chapter-restore-test')
const restoredAt = '2026-09-22T01:00:00.000Z'

function assert(condition, message, details = {}) {
  return { ok: Boolean(condition), message, details }
}

function capture(action) {
  try {
    return { value: action(), error: null }
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) }
  }
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

function buildRestore(buildRestoreRevisionCommitBundle, appData, suffix) {
  return buildRestoreRevisionCommitBundle({
    appData,
    projectId: EMPTY_CHAPTER_PROJECT_ID,
    chapterId: EMPTY_CHAPTER_ID,
    sourceVersionId: HISTORICAL_VERSION_ID,
    revisionCommitId: `empty-restore-commit-${suffix}`,
    newChapterVersionId: `empty-restore-version-${suffix}`,
    restoredAt,
    note: 'restore non-empty history over empty chapter'
  })
}

function targetChapter(data) {
  return data.chapters.find((chapter) => chapter.id === EMPTY_CHAPTER_ID)
}

function otherProjectSlice(data) {
  return JSON.stringify({
    project: data.projects.find((project) => project.id === OTHER_PROJECT_ID),
    chapter: data.chapters.find((chapter) => chapter.id === OTHER_CHAPTER_ID),
    versions: data.chapterVersions.filter((version) => version.projectId === OTHER_PROJECT_ID)
  })
}

function preservedRestore(data, commitId, versionId) {
  return (
    targetChapter(data)?.body === 'historical non-empty body' &&
    data.revisionCommitBundles.some((commit) => commit.revisionCommitId === commitId && commit.beforeText === '') &&
    data.chapterVersions.some((version) => version.id === HISTORICAL_VERSION_ID && version.body === 'historical non-empty body') &&
    data.chapterVersions.some((version) => version.id === versionId && version.body === 'historical non-empty body')
  )
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const checks = []

  const chainModule = await bundle('src/services/ChapterVersionChainService.ts', 'chapter-version-chain.mjs')
  const revisionModule = await bundle('src/services/RevisionCommitBundleService.ts', 'revision-commit-service.mjs')
  const sqliteModule = await bundle('src/storage/SqliteStorageService.ts', 'sqlite-storage.mjs')
  const jsonModule = await bundle('src/storage/JsonStorageService.ts', 'json-storage.mjs')
  const appDataModule = await bundle('src/shared/normalizers/appData.ts', 'app-data-normalizer.mjs')
  const { buildRestoreRevisionCommitBundle, getChapterVersionChain } = chainModule
  const { applyRevisionCommitBundleToAppData } = revisionModule
  const { SqliteStorageService } = sqliteModule
  const { JsonStorageService } = jsonModule
  const { normalizeAppData, sanitizeAppDataForPersistence } = appDataModule

  const data = createEmptyChapterRestoreFixture()
  const restore = buildRestore(buildRestoreRevisionCommitBundle, data, 'memory')
  const baseline = capture(() => applyRevisionCommitBundleToAppData(data, restore))
  checks.push(
    assert(
      !baseline.error,
      '空字符串 beforeText 的历史版本恢复可通过内存提交验证',
      { baselineError: baseline.error }
    )
  )

  if (!baseline.error) {
    const restored = baseline.value
    checks.push(
      assert(
        restore.beforeText === '' &&
          preservedRestore(restored, restore.revisionCommitId, restore.newChapterVersionId) &&
          getChapterVersionChain(restored, EMPTY_CHAPTER_ID).some((entry) => entry.id === HISTORICAL_VERSION_ID),
        '恢复提交保留空 beforeText 与原始 version chain'
      )
    )
    checks.push(
      assert(
        applyRevisionCommitBundleToAppData(restored, restore) === restored,
        '内存重复提交保持幂等'
      )
    )

    const missingBeforeText = { ...restore }
    delete missingBeforeText.beforeText
    const nullBeforeText = { ...restore, beforeText: null }
    const staleData = {
      ...data,
      chapters: data.chapters.map((chapter) =>
        chapter.id === EMPTY_CHAPTER_ID ? { ...chapter, body: 'concurrent replacement' } : chapter
      )
    }
    checks.push(assert(Boolean(capture(() => applyRevisionCommitBundleToAppData(data, missingBeforeText)).error), '缺省 beforeText 仍被拒绝'))
    checks.push(assert(Boolean(capture(() => applyRevisionCommitBundleToAppData(data, nullBeforeText)).error), 'null beforeText 仍被拒绝'))
    checks.push(assert(Boolean(capture(() => applyRevisionCommitBundleToAppData(staleData, restore)).error), '与当前正文不符的 beforeText 仍按 stale 拒绝'))

    const whitespaceData = createEmptyChapterRestoreFixture({ body: ' \t\n' })
    const whitespaceRestore = buildRestore(buildRestoreRevisionCommitBundle, whitespaceData, 'whitespace')
    checks.push(
      assert(
        whitespaceRestore.beforeText === ' \t\n' && !capture(() => applyRevisionCommitBundleToAppData(whitespaceData, whitespaceRestore)).error,
        '空白字符正文也可作为有效 beforeText 恢复历史版本'
      )
    )

    const exported = sanitizeAppDataForPersistence(restored)
    const imported = normalizeAppData(JSON.parse(JSON.stringify(exported)))
    checks.push(
      assert(
        preservedRestore(imported, restore.revisionCommitId, restore.newChapterVersionId),
        '导出再导入保留空 baseline 与原始 version chain'
      )
    )

    const jsonPath = join(outDir, 'empty-chapter.json')
    const jsonStorage = new JsonStorageService(jsonPath)
    await jsonStorage.save(data)
    const jsonBefore = await jsonStorage.loadSnapshot()
    const jsonOther = otherProjectSlice(jsonBefore.data)
    const jsonWrite = await jsonStorage.saveRevisionCommitBundle(restore)
    const jsonAfter = await jsonStorage.loadSnapshot()
    const jsonReplay = await jsonStorage.saveRevisionCommitBundle(restore)
    checks.push(
      assert(
        jsonWrite.ok &&
          preservedRestore(jsonAfter.data, restore.revisionCommitId, restore.newChapterVersionId) &&
          otherProjectSlice(jsonAfter.data) === jsonOther &&
          jsonReplay.savedCollections.length === 0 &&
          jsonReplay.revision === jsonAfter.revision,
        'JSON fallback 保存恢复、保留其他 project 并支持幂等重放'
      )
    )

    const sqlitePath = join(outDir, 'empty-chapter.sqlite')
    const sqliteStorage = new SqliteStorageService(sqlitePath, { legacyJsonPath: join(outDir, 'unused-legacy.json') })
    await sqliteStorage.save(data)
    const sqliteBefore = await sqliteStorage.loadSnapshot()
    const sqliteOther = otherProjectSlice(sqliteBefore.data)
    const sqliteWrite = await sqliteStorage.saveRevisionCommitBundle(restore)
    const sqliteAfter = await sqliteStorage.loadSnapshot()
    const sqliteReplay = await sqliteStorage.saveRevisionCommitBundle(restore)
    sqliteStorage.close()
    checks.push(
      assert(
        sqliteWrite.ok &&
          sqliteWrite.savedCollections.includes('revisionCommitBundles') &&
          preservedRestore(sqliteAfter.data, restore.revisionCommitId, restore.newChapterVersionId) &&
          otherProjectSlice(sqliteAfter.data) === sqliteOther &&
          sqliteReplay.savedCollections.length === 0 &&
          sqliteReplay.revision === sqliteAfter.revision,
        'SQLite 短事务保存恢复、保留其他 project 并支持幂等重放'
      )
    )
  } else {
    console.log(`BASELINE_REJECTED ${baseline.error}`)
    console.log('PENDING success-path storage checks await the revisionCommitValidation.ts fix.')
  }

  for (const check of checks) {
    console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.message}`)
    if (!check.ok && Object.keys(check.details).length > 0) console.log(JSON.stringify(check.details, null, 2))
  }
  if (checks.some((check) => !check.ok)) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

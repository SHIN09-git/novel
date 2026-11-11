import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'
import { bookProgressFixture, fixtureTime as t, progressBookId as p, wideText } from './fixtures/book-progress.mjs'

const base = join(repoRoot, 'tmp')
await mkdir(base, { recursive: true })
const tmp = await mkdtemp(join(base, 'book-progress-'))
try {
  const file = join(tmp, 'api.mjs')
  const modules = ['shared/defaults', 'services/BookProgressService', 'services/BookWritebackService', 'services/ChapterCommitBundleService',
    'services/RevisionCommitBundleService', 'services/ChapterVersionChainService', 'services/ChapterLifecycleService',
    'services/DirectorNextActionService', 'services/chapterTaskContractText', 'agent/tools/AgentToolService',
    'agent/AgentReadableSummaryService', 'storage/JsonStorageService', 'storage/SqliteStorageService']
  await build({ stdin: { contents: modules.map(path => `export * from './src/${path}'`).join('\n'), resolveDir: repoRoot },
    bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: file, external: ['electron', 'better-sqlite3'] })
  const api = await import(pathToFileURL(file).href)
  const data = api.normalizeAppData(bookProgressFixture())
  const get = (d, opt) => api.buildBookProgress(d, p, opt)
  const proof = d => api.createBookWritebackIndex(d, p).verifyJob('j92')
  const row = (d, n) => get(d, { fromChapter: n, toChapter: n }).rows[0]
  const overview = get(data, { limit: 200 })
  assert.equal(overview.totalWords, 92 * 3)
  assert.equal(overview.chapterCount, 92)
  assert.equal(overview.goal.remainingToMin, 15000)
  assert.equal(overview.completeThrough, 65)
  assert.equal(overview.nextAssignableOrder, 97)
  const target = api.AgentReadableSummaryService.getNextChapterTarget(data, p)
  assert.equal(target.nextChapterOrder, target.nextAssignableOrder)
  assert.equal(target.progressTool, 'agent.getBookProgress')
  assert.deepEqual(overview.missingRanges, [66, 74, 80].map(n => ({ from: n, to: n })))
  assert.deepEqual(overview.completeRanges, [[1, 65], [67, 73], [75, 79], [81, 87], [89, 96]].map(([from, to]) => ({ from, to })))
  assert.deepEqual(get(data, { issuesOnly: true }).rows.map(r => [r.order, r.status]),
    [[66, 'missing'], [74, 'draft_only'], [80, 'empty'], [92, 'writeback_failed']])
  assert.deepEqual([row(data, 92).manuscriptStatus, row(data, 92).wordCount], ['historical', 3])
  assert.equal(row(data, 88).status, 'archived')
  assert.equal(row(data, 74).draftId, 'd74')
  assert.equal(row(data, 66).draftId, null)
  const orphan = { ...data, generatedChapterDrafts: data.generatedChapterDrafts.map(d =>
    d.id === 'd66' ? { ...d, chapterId: 'unavailable-import', status: 'accepted' } : d) }
  assert.equal(row(orphan, 66).status, 'draft_only')
  assert.equal(get(orphan).totalWords, overview.totalWords)
  assert(!api.createBookWritebackIndex(orphan, p).verifyJob('j66').confirmed)
  assert.equal(get(data, { fromChapter: 90, toChapter: 96 }).range.totalWords, 21)
  assert.equal(api.visibleCharacterCount(wideText), 3)
  assert.equal(api.AgentReadableSummaryService.getProjectDigest(data, p).manuscript.totalWords, overview.totalWords)
  assert.equal(api.AgentReadableSummaryService.getChapterProductionState(data, p, 92).chapter.wordCount, 3)
  assert.equal(api.AgentReadableSummaryService.getChapterText(data, p, 92, {}).wordCount, 3)
  assert.equal(api.buildBookProgress(data, 'other-book').goal.remainingToMin, null)
  assert.equal(get({ ...data, chapters: [...data.chapters, { ...data.chapters[0], id: 'duplicate-order' }] }).totalWords, overview.totalWords)
  assert.equal(get(data, { fromChapter: 1, toChapter: 1000000000, offset: 999999999, limit: 5 }).rows[0].order, 1000000000)
  assert.throws(() => get(data, { fromChapter: 7, toChapter: 4 }))
  assert(!proof(data).confirmed)
  // Use actual commit and restore builders; neither the draft nor any previous version is additive.
  const clean = { ...data, chapterWritebackFailures: [] }
  const accepted = api.buildAcceptedDraftCommitBundle({ appData: clean, projectId: p, chapterId: 'c92', draftId: 'd92',
    targetChapterOrder: 92, commitId: 'commit92', chapterVersionId: 'first92', acceptedAt: t, acceptanceMode: 'unreviewed' })
  const filed = api.applyChapterCommitBundleToAppData(clean, accepted)
  assert.equal(row(filed, 92).status, 'committed')
  assert(proof(filed).confirmed)
  assert(!proof({ ...filed, chapterVersions: filed.chapterVersions.filter(v => v.id !== 'first92') }).confirmed)
  assert(!proof({ ...filed, chapterCommitBundles: filed.chapterCommitBundles.map(c => ({ ...c, jobId: 'unrelated' })) }).confirmed)
  const newAttempt = { ...filed.generatedChapterDrafts.find(d => d.id === 'd92'), id: 'd92-second-attempt', status: 'draft',
    createdAt: '2026-10-02T00:00:00.000Z' }
  assert(!proof({ ...filed, generatedChapterDrafts: [...filed.generatedChapterDrafts, newAttempt] }).confirmed)
  const revision = api.buildRevisionCommitBundle({ appData: filed, projectId: p, chapterId: 'c92', revisionCommitId: 'rev92',
    newChapterVersionId: 'second92', revisedAt: '2026-10-03T00:00:00.000Z', afterText: '长一段。' })
  const revised = api.applyRevisionCommitBundleToAppData(filed, revision)
  assert.equal(get(revised).totalWords, 277)
  assert.equal(proof(revised).versionId, 'second92')
  const archived = api.archiveChapterInAppData(revised, 'c92', '2026-10-04T00:00:00Z')
  assert.equal(get(archived).totalWords, 273)
  assert(!proof(archived).confirmed)
  const restore = api.buildRestoreRevisionCommitBundle({ appData: revised, projectId: p, chapterId: 'c92', sourceVersionId: 'first92',
    newChapterVersionId: 'third92', revisionCommitId: 'restore92', restoredAt: '2026-10-05T00:00:00.000Z' })
  const restored = api.applyRevisionCommitBundleToAppData(revised, restore)
  assert.equal(get(restored).totalWords, 276)
  assert.equal(proof(restored).versionId, 'third92')
  assert(!proof({ ...restored, chapterVersions: restored.chapterVersions.filter(v => v.id !== 'third92') }).confirmed,
    'a newer restore missing its version cannot borrow an older receipt for the same text')
  assert(!proof({ ...restored, chapters: restored.chapters.map(c => c.id === 'c92' ? { ...c, body: '未形成版本的修改。' } : c) }).confirmed)
  const broken = { ...restored, chapterVersions: restored.chapterVersions.map(v => v.id === 'third92' ? { ...v, baseChapterVersionId: v.id } : v) }
  assert(!proof(broken).confirmed)
  for (const [kind, Storage] of [['json', api.JsonStorageService], ['sqlite', api.SqliteStorageService]]) {
    const space = join(tmp, kind)
    await mkdir(space)
    const storagePath = join(space, 'novel-director-data.' + kind)
    const store = new Storage(storagePath)
    try {
      await store.save(data)
      const before = await store.loadSnapshot()
      const args = { storagePath, userDataPath: space, project: '全书进度样书', issuesOnly: true, offset: 1, limit: 3 }
      const result = await api.AgentToolService.callTool({ name: 'agent.getBookProgress', arguments: args })
      assert.equal(result.storage.source, kind)
      assert.deepEqual(result.data, get(before.data, args))
      assert.deepEqual(await store.loadSnapshot(), before, 'a progress query must not modify a book')
      assert(!JSON.stringify(result.data).includes('只存在草稿') && !JSON.stringify(result.data).includes('不能串书'))
      assert(!result.data.rows.some(r => 'body' in r || 'chapterVersion' in r || 'chapter' in r))
      if (kind === 'json') assert.deepEqual(get(api.normalizeAppData(JSON.parse(await readFile(storagePath, 'utf8')))), get(data))
      await assert.rejects(api.AgentToolService.callTool({ name: 'agent.getBookProgress', arguments: { ...args, limit: -1 } }))
      console.log(`PASS ${kind}: 96-chapter book, read-only MCP identical to desktop, chapter range, pagination and goal`)
    } finally { store.close?.() }
  }
  console.log('PASS manuscript count, failure over old body, writeback lineage, archive, revisions and restore')
} finally { await rm(tmp, { recursive: true, force: true, maxRetries: 3 }) }

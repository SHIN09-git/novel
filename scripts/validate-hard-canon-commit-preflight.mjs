import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const base = join(repoRoot, 'tmp')
await mkdir(base, { recursive: true })
const tmp = await mkdtemp(join(base, 'canon-commit-'))
const t = '2026-10-01T00:00:00.000Z'
const later = '2026-10-02T00:00:00.000Z'
const original = '柜门边留着一道雾印。'
const edited = '柜门的铜扣已经松了。'
const rule = (enforcement = 'block') => ({
  id: 'word-rule', projectId: 'p', title: '禁写雾印', content: '正文不得出现雾印。',
  category: 'prohibition', priority: 'medium', status: 'active', createdAt: t, updatedAt: t,
  check: { kind: 'literal', mode: 'terms', terms: ['雾印'], enforcement, maxPerChapter: 0 }
})
const attach = (data, items) => ({ ...data, hardCanonPacks: [
  { ...data.hardCanonPacks.find(pack => pack.projectId === 'p'), items }
] })

try {
  const file = join(tmp, 'api.mjs')
  await build({ stdin: { contents: [
    'shared/defaults', 'services/ChapterCommitBundleService', 'services/RevisionCommitBundleService',
    'services/ChapterVersionChainService', 'services/HardCanonPreflight', 'services/DirectorNextActionService',
    'agent/AgentDecisionService', 'agent/agentVersionReaders', 'storage/JsonStorageService', 'storage/SqliteStorageService'
  ].map(path => `export * from './src/${path}'`).join('\n'), resolveDir: repoRoot, loader: 'ts' },
    outfile: file, format: 'esm', platform: 'node', target: 'node22', external: ['electron', 'better-sqlite3'],
    bundle: true, logLevel: 'silent' })
  const api = await import(pathToFileURL(file).href)
  const fixture = api.normalizeAppData({
    projects: [{ id: 'p', name: '虚构核查样书', createdAt: t, updatedAt: t }],
    chapterGenerationJobs: [{ id: 'job', projectId: 'p', targetChapterOrder: 2, status: 'completed',
      currentStep: 'await_user_confirmation', createdAt: t, updatedAt: t }],
    generatedChapterDrafts: [{ id: 'draft', jobId: 'job', projectId: 'p', chapterId: null,
      title: '橱柜', body: original, summary: '', status: 'draft', createdAt: t, updatedAt: t }]
  })
  const buildAcceptance = (appData, mode) => api.buildAcceptedDraftCommitBundle({
    appData, projectId: 'p', chapterId: 'c2', draftId: 'draft', targetChapterOrder: 2,
    commitId: 'adopt', chapterVersionId: 'first', acceptedAt: t, acceptanceMode: mode
  })
  const restore = appData => api.buildRestoreRevisionCommitBundle({ appData, projectId: 'p',
    chapterId: 'c2', sourceVersionId: 'first', revisionCommitId: 'restore', newChapterVersionId: 'third',
    restoredAt: '2026-10-03T00:00:00.000Z' })
  for (const [name, Storage] of [['json', api.JsonStorageService], ['sqlite', api.SqliteStorageService]]) {
    const storage = new Storage(join(tmp, 'book.' + name))
    try {
      await storage.save(fixture)
      const plain = await storage.load()
      const beforeRule = buildAcceptance(plain, 'unreviewed')
      const legacy = buildAcceptance(plain, undefined)
      await storage.save(attach(plain, [rule()]))
      const blocked = await storage.loadSnapshot()
      assert.equal(api.AgentDecisionService.buildAcceptanceRecommendation(blocked.data, 'job').recommendation, 'revise')
      assert.match(api.getDirectorDashboard(blocked.data, 'p').actions[0].reason, /雾印/)
      const agent = api.AgentDecisionService.buildAcceptanceRecommendation(blocked.data, 'job').hardCanon
      assert.equal(agent.findings[0].ruleId, 'word-rule')
      assert.equal(original.slice(agent.findings[0].start, agent.findings[0].end), agent.findings[0].excerpt)
      assert.equal(agent.findings[0].sentence, original)
      const repeated = { ...blocked.data, generatedChapterDrafts: [{ ...blocked.data.generatedChapterDrafts[0], body: original.repeat(4) }] }
      assert.equal(api.AgentDecisionService.buildAcceptanceRecommendation(repeated, 'job').hardCanon.findings.length, 3)
      assert.equal(api.AgentDecisionService.buildAcceptanceRecommendation(repeated, 'job', undefined, 'full').hardCanon.findings.length, 4)
      for (const mode of ['unreviewed', 'reviewed', undefined]) assert.throws(() => buildAcceptance(blocked.data, mode), /硬设定核查未通过.*雾印/)
      for (const preview of [legacy, beforeRule]) {
        await assert.rejects(storage.saveChapterCommitBundle(preview, blocked.revision), /硬设定核查未通过.*雾印/)
        assert.deepEqual(await storage.loadSnapshot(), blocked)
      }
      // Even a nonblocking change must not silently accept a preview that said there were no checks.
      await storage.save(attach(blocked.data, [rule('review')]))
      const advisory = await storage.loadSnapshot()
      await assert.rejects(storage.saveChapterCommitBundle(beforeRule, advisory.revision), /硬设定或全书计数已变化/)
      const accepted = buildAcceptance(advisory.data, 'unreviewed')
      assert.equal(accepted.acceptanceReview.hardCanonCheck.reviewCount, 1)
      await storage.saveChapterCommitBundle(accepted, advisory.revision)
      const persisted = await storage.loadSnapshot()
      assert.deepEqual(persisted.data.chapterCommitBundles[0].acceptanceReview.hardCanonCheck, accepted.acceptanceReview.hardCanonCheck)
      const revision = api.buildRevisionCommitBundle({ appData: persisted.data, projectId: 'p', chapterId: 'c2',
        revisionCommitId: 'rewrite', newChapterVersionId: 'second', revisedAt: later, afterText: edited })
      await storage.saveRevisionCommitBundle(revision, persisted.revision)
      const revised = await storage.loadSnapshot()
      assert.equal(revised.data.chapters[0].body, edited)
      const oldRestore = restore(revised.data)
      await storage.save(attach(revised.data, [rule()]))
      const today = await storage.loadSnapshot()
      assert.deepEqual((await storage.saveChapterCommitBundle(accepted, today.revision)).savedCollections, [])
      assert.deepEqual((await storage.saveRevisionCommitBundle(revision, today.revision)).savedCollections, [])
      assert.throws(() => restore(today.data), /硬设定核查未通过.*雾印/)
      await assert.rejects(storage.saveRevisionCommitBundle(oldRestore, today.revision), /硬设定核查未通过.*雾印/)
      assert.deepEqual(await storage.loadSnapshot(), today)
      const oldVersion = api.getVersionDetail(today.data, 'p', 2, 'first', { detail: 'full' })
      assert.equal(oldVersion.metadata.currentHardCanon.findings[0].severity, 'block')
      assert.ok(!api.getVersionDetail(today.data, 'p', 2, 'second', { detail: 'full' }).metadata.currentHardCanon.findings.length)
      assert.equal(api.getVersionDetail(today.data, 'p', 2, 'first').metadata.currentHardCanon, undefined)
      await storage.save(attach(today.data, []))
      await storage.saveRevisionCommitBundle(restore(await storage.load()))
      const final = await storage.load()
      assert.equal(final.chapters[0].body, original)
      assert.deepEqual(new Set(final.chapterVersions.map(v => v.id)), new Set(['first', 'second', 'third']))
      console.log(`PASS ${name}: preview, advisory, stale receipts, transactional acceptance/revision, restore and historical replay`)
    } finally { storage.close?.() }
  }
} finally {
  await rm(tmp, { recursive: true, force: true })
}

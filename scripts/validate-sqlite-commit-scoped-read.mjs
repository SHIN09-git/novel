import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import Database from 'better-sqlite3'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const base = join(repoRoot, 'tmp')
mkdirSync(base, { recursive: true })
const root = mkdtempSync(join(base, 'sqlite-commit-context-'))
after(() => { assert.equal(dirname(root), base); rmSync(root, { recursive: true, force: true }) })
const runtime = await build({ stdin: { resolveDir: repoRoot, contents: [
  'shared/defaults', 'services/DraftDiagnosticBindingService', 'services/ChapterCommitBundleService',
  'services/RevisionCommitBundleService', 'storage/SqliteStorageService'
].map(path => `export * from './src/${path}'`).join('\n') }, write: false,
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' })

// Observe exactly what a real transaction reads, separately from preflight and verification loads.
let seen
const json = { ...JSON, stringify: JSON.stringify, parse(text, ...args) {
  const row = JSON.parse(text, ...args)
  if (seen && row?.unrelatedHistory) seen.unrelated.push(row.id)
  return row
} }
function Binding(file, options) {
  return new Database(file, { ...options, verbose(sql) { if (seen) seen.sql.push(sql) } })
}
const require = createRequire(import.meta.url)
const localRequire = id => id === 'better-sqlite3' ? Binding
  : id === 'node:module' ? { ...require(id), createRequire: () => localRequire } : require(id)
const mod = { exports: {} }
new Function('require', 'module', 'exports', 'JSON', runtime.outputFiles[0].text)(localRequire, mod, mod.exports, json)
const api = mod.exports
const t = '2026-01-01T00:00:00Z', t2 = '2026-01-02T00:00:00Z'
const stamp = { createdAt: t, updatedAt: t }, copy = structuredClone
const body = 'The source manuscript.'
const report = { id: 'quality', projectId: 'book', jobId: 'job', draftId: 'draft',
  chapterId: 'ch', draftContentHash: api.draftContentHash(body), pass: true, ...stamp }

function fixture() {
  return api.normalizeAppData({
    projects: [{ id: 'book', ...stamp }, { id: 'other', ...stamp }],
    chapters: [
      { id: 'ch', projectId: 'book', order: 2, title: 'Two', body: 'Old text', ...stamp },
      { id: 'one', projectId: 'book', order: 1, title: 'One', body: 'A lost key', unrelatedHistory: true, ...stamp },
      { id: 'other-ch', projectId: 'other', order: 2, title: 'Two', body: 'Foreign text', unrelatedHistory: true, ...stamp }
    ],
    chapterGenerationJobs: [{ id: 'job', projectId: 'book', targetChapterOrder: 2, status: 'completed', ...stamp }],
    generatedChapterDrafts: [
      { id: 'draft', projectId: 'book', jobId: 'job', chapterId: 'ch', title: 'Target', body, status: 'draft', ...stamp },
      { id: 'other-draft', projectId: 'book', jobId: 'job', title: 'Later draft', body: 'Do not adopt', status: 'draft', unrelatedHistory: true, ...stamp }
    ],
    qualityGateReports: [report, { ...report, id: 'other-quality', draftId: 'other-draft', unrelatedHistory: true }],
    consistencyReviewReports: [{ ...report, id: 'stale', draftContentHash: api.draftContentHash('Former source') }],
    revisionSessions: [{ id: 'session', projectId: 'book', chapterId: 'ch', sourceDraftId: 'draft', status: 'active', ...stamp }],
    revisionVersions: [{ id: 'rv', sessionId: 'session', body: 'Revised text', status: 'pending',
      sourceContentHash: api.draftContentHash(body), ...stamp }],
    chapterVersions: [{ id: 'foreign-v', projectId: 'other', chapterId: 'other-ch', title: 'Two', body: 'Old foreign', ...stamp }],
    revisionCommitBundles: [{ id: 'old', revisionCommitId: 'old', projectId: 'other', chapterId: 'other-ch', unrelatedHistory: true }]
  })
}

const adopt = data => api.buildAcceptedDraftCommitBundle({ appData: data, projectId: 'book', chapterId: 'ch',
  draftId: 'draft', targetChapterOrder: 2, commitId: 'adopt', chapterVersionId: 'v2', acceptedAt: t2, acceptanceMode: 'reviewed' })
const revise = data => api.buildRevisionCommitBundle({ appData: data, projectId: 'book', chapterId: 'ch',
  revisionCommitId: 'revise', newChapterVersionId: 'v3', revisionVersionId: 'rv', revisedAt: t2 })
async function library(t, data = fixture()) {
  const file = join(mkdtempSync(join(root, 'book-')), 'fiction.sqlite')
  const seed = new api.SqliteStorageService(file)
  try { await seed.save(data) } finally { seed.close() }
  const store = api.createExistingLibraryStorage(file)
  const peer = new Database(file, { fileMustExist: true })
  t.after(() => { store.close(); peer.close() })
  return { store, peer, file }
}
async function narrow(action) {
  seen = { unrelated: [], sql: [] }
  try {
    const result = await action()
    assert.deepEqual(seen.unrelated, [], 'parsed an unrelated manuscript, report or historical receipt')
    assert.ok(!seen.sql.some(s => /FROM entities(?: ORDER BY|$)/i.test(s)), 'read the entire library')
    assert.ok(seen.sql.some(s => /^BEGIN/i.test(s)) && seen.sql.some(s => /^COMMIT/i.test(s)))
    return { result, sql: seen.sql }
  } finally { seen = undefined }
}
async function rejectLikeFull(store, bundle, pattern) {
  const before = await store.loadSnapshot()
  const revision = Boolean(bundle.revisionCommitId)
  const apply = revision ? api.applyRevisionCommitBundleToAppData : api.applyChapterCommitBundleToAppData
  const method = revision ? 'saveRevisionCommitBundle' : 'saveChapterCommitBundle'
  let expected
  assert.throws(() => apply(before.data, bundle), err => { expected = err.message; return pattern.test(expected) })
  await assert.rejects(store[method](bundle, before.revision), err => err.message === expected)
  assert.deepEqual(await store.loadSnapshot(), before)
}

test('cold writer: both transactions read scoped payloads; CAS and historical replay preserve the version chain', async t => {
  const { store, peer, file } = await library(t)
  const initial = await store.loadSnapshot()
  const chapter = adopt(initial.data)
  const { result: first, sql } = await narrow(() => store.saveChapterCommitBundle(chapter, initial.revision))
  const changed = await store.loadSnapshot(), revision = revise(changed.data)
  // The validator must resolve persisted version -> session -> source draft even with only a version ID in the packet.
  delete revision.generatedDraft
  delete revision.revisionSession
  delete revision.revisionSessionId
  delete revision.revisionVersion
  await assert.rejects(store.saveRevisionCommitBundle(revision, initial.revision), { code: 'STORAGE_REVISION_CONFLICT' })
  assert.deepEqual(await store.loadSnapshot(), changed)
  const { result: second, sql: revSql } = await narrow(() => store.saveRevisionCommitBundle(revision, first.revision))
  for (const [key, queries] of [['chapterCommitBundles', sql], ['revisionCommitBundles', revSql]]) {
    const lookup = queries.find(s => s.includes('SELECT id FROM entities') && s.includes(key))
    assert.ok(lookup)
    assert.match(peer.prepare('EXPLAIN QUERY PLAN ' + lookup).all().map(r => r.detail).join(' '),
      new RegExp('SEARCH entities USING (?:COVERING )?INDEX idx_alias_' + key))
  }
  for (const [key, packet] of [['saveChapterCommitBundle', chapter], ['saveRevisionCommitBundle', revision]]) {
    const { result } = await narrow(() => store[key](packet, second.revision))
    assert.deepEqual(result.savedCollections, [])
    assert.equal(result.revision, second.revision)
  }
  const reopened = api.createExistingLibraryStorage(file)
  try {
    const final = await reopened.load()
    assert.equal(final.chapters.find(c => c.id === 'ch').body, revision.afterText)
    assert.equal(final.chapters.find(c => c.id === 'other-ch').body, 'Foreign text')
    assert.equal(final.generatedChapterDrafts.find(d => d.id === 'other-draft').status, 'draft')
    assert.deepEqual(final.chapterVersions.filter(v => v.projectId === 'book').map(v => v.id).sort(), ['v2', 'v2:before', 'v3'])
    assert.equal(final.revisionVersions[0].status, 'accepted')
  } finally { reopened.close() }
})

test('full and scoped validation reject mismatched secondary diagnostics, stored ID-only links and foreign ID collisions', async t => {
  const { store } = await library(t)
  const data = await store.load(), good = adopt(data)
  const stale = data.consistencyReviewReports[0]
  for (const explicit of [true, false]) {
    for (const embedded of [true, false]) {
      const b = copy(good)
      if (!explicit) delete b.acceptanceReview
      b.consistencyReviewReportId = stale.id
      b.consistencyReviewReports = embedded ? [stale] : []
      await rejectLikeFull(store, b, /does not match the accepted draft text/)
    }
  }
  const swapped = copy(good)
  swapped.previousChapterVersion.id = swapped.chapterVersion.baseChapterVersionId = 'foreign-v'
  await rejectLikeFull(store, swapped, /another project/)
  const revision = revise(data)
  revision.baseChapterVersionId = revision.chapterVersion.baseChapterVersionId = 'foreign-v'
  await rejectLikeFull(store, revision, /does not match the target chapter/)
  const old = revise(data)
  delete old.revisionSession
  delete old.revisionSessionId
  delete old.generatedDraft
  delete old.revisionVersion
  data.generatedChapterDrafts.find(d => d.id === 'draft').body = 'Edited after preview'
  await store.save(data)
  await rejectLikeFull(store, old, /sourceContentHash/)
})

test('legacy receipt aliases remain visible across peer writes; failed old-library writes roll back index installation too', async t => {
  const { store, peer } = await library(t)
  const data = await store.load(), b = adopt(data)
  peer.exec('DROP INDEX idx_alias_chapterCommitBundles; DROP INDEX idx_alias_revisionCommitBundles')
  const indexes = () => peer.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'idx_alias_%' ORDER BY name").all()
  const before = await store.loadSnapshot()
  peer.exec(`CREATE TRIGGER fail_late BEFORE INSERT ON meta WHEN NEW.key = 'revision'
    BEGIN SELECT RAISE(ABORT, 'late marker'); END`)
  await assert.rejects(store.saveChapterCommitBundle(b, before.revision), /late marker/)
  assert.deepEqual(await store.loadSnapshot(), before)
  assert.deepEqual(indexes(), [])
  peer.exec('DROP TRIGGER fail_late')
  await store.saveChapterCommitBundle(b, before.revision)
  assert.equal(indexes().length, 2)
  const rename = peer.prepare("UPDATE entities SET id = ?, json = json_set(json, '$.id', ?) WHERE collection = ? AND id = ?")
  rename.run('physical-adopt', 'physical-adopt', 'chapterCommitBundles', 'adopt')
  await rejectLikeFull(store, b, /immutable/)
  const revision = revise(await store.load())
  assert.equal(revision.linkedChapterCommitId, 'adopt')
  await narrow(() => store.saveRevisionCommitBundle(revision))
  rename.run('physical-revise', 'physical-revise', 'revisionCommitBundles', 'revise')
  await rejectLikeFull(store, revision, /immutable/)
})

test('the current project remains authoritative for book-wide rules, order collisions and latest job evidence', async t => {
  const { store, peer } = await library(t)
  const data = await store.load(), b = adopt(data), revision = revise(data)
  data.hardCanonPacks.find(p => p.projectId === 'book').items.push({
    id: 'book-count', projectId: 'book', title: 'Limit', content: 'At most one of these per book.',
    status: 'active', check: { kind: 'literal', mode: 'terms', terms: ['lost key', 'source manuscript', 'Revised text'],
      maxPerBook: 1, enforcement: 'block' }, ...stamp
  })
  await store.save(data)
  await rejectLikeFull(store, b, /硬设定/)
  await rejectLikeFull(store, revision, /硬设定/)
  data.hardCanonPacks = []
  data.chapters.find(c => c.id === 'ch').id = 'different-chapter-same-order'
  await store.save(data)
  await rejectLikeFull(store, b, /目标章节已变化/)
  data.chapters.find(c => c.id === 'different-chapter-same-order').id = 'ch'
  data.qualityGateReports.push({ ...report, id: 'later-quality', pass: false, createdAt: t2 })
  await store.save(data)
  peer.prepare("UPDATE entities SET job_id = NULL, project_id = NULL WHERE collection = 'qualityGateReports' AND id = 'later-quality'").run()
  await rejectLikeFull(store, b, /immutable/)
})

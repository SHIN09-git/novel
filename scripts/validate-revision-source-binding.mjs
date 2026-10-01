#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const tempRoot = join(repoRoot, 'tmp')
await mkdir(tempRoot, { recursive: true })
const outDir = await mkdtemp(join(tempRoot, 'revision-source-binding-'))
const timestamp = '2026-09-06T00:00:00.000Z'
let checks = 0
async function test(label, run) {
  await run()
  checks++
  console.log(`PASS ${label}`)
}

try {
  const outfile = join(outDir, 'services.mjs')
  await build({
    stdin: {
      contents: `
        export { assertRevisionSourceMatches } from './src/services/RevisionSourceBindingService';
        export { buildRevisionCommitBundle, validateRevisionCommitBundle, applyRevisionCommitBundleToAppData } from './src/services/RevisionCommitBundleService';
        export { draftContentHash } from './src/services/DraftDiagnosticBindingService';
        export { normalizeAppData } from './src/shared/defaults';
        export { createStorageService } from './src/storage/SqliteStorageService';
        export { JsonStorageService } from './src/storage/JsonStorageService';
      `,
      resolveDir: repoRoot, loader: 'ts'
    },
    outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22',
    external: ['better-sqlite3', 'electron'], logLevel: 'silent'
  })
  const {
    assertRevisionSourceMatches: checkSource, buildRevisionCommitBundle: buildBundle,
    validateRevisionCommitBundle: validate, applyRevisionCommitBundleToAppData: apply,
    draftContentHash: hash, normalizeAppData, createStorageService, JsonStorageService
  } = await import(pathToFileURL(outfile).href)

  function fixture({ draft = true, bound = true } = {}) {
    return normalizeAppData({
      projects: [{ id: 'p', name: 'Revision binding fixture', createdAt: timestamp, updatedAt: timestamp }],
      chapters: [{ id: 'ch', projectId: 'p', order: 1, title: 'Chapter', body: 'Current chapter body.', createdAt: timestamp, updatedAt: timestamp }],
      generatedChapterDrafts: draft ? [{
        id: 'draft', projectId: 'p', chapterId: 'ch', jobId: 'job', title: 'Draft', body: 'Different source draft body.',
        status: 'draft', createdAt: timestamp, updatedAt: timestamp
      }] : [],
      revisionSessions: [{ id: 'session', projectId: 'p', chapterId: 'ch', sourceDraftId: draft ? 'draft' : null, status: 'active', createdAt: timestamp, updatedAt: timestamp }],
      revisionVersions: [{
        id: 'revision', sessionId: 'session', requestId: 'request', title: 'Revised version', body: 'AI revised body.',
        changedSummary: '', risks: '', preservedFacts: '', status: 'pending', createdAt: timestamp, updatedAt: timestamp,
        ...(bound ? {
          sourceContentHash: hash(draft ? 'Different source draft body.' : 'Current chapter body.'),
          sourceChapterContentHash: hash('Current chapter body.')
        } : {})
      }]
    })
  }
  function makeBundle(data, overrides = {}) {
    return buildBundle({
      appData: data, projectId: 'p', chapterId: 'ch', revisionCommitId: 'commit', newChapterVersionId: 'chapter-version',
      revisionSessionId: 'session', revisionVersionId: 'revision', revisedAt: timestamp, ...overrides
    })
  }
  let storeCount = 0
  async function withStorage(sqlite, data, run) {
    const storagePath = join(outDir, `store-${++storeCount}.${sqlite ? 'sqlite' : 'json'}`)
    const storage = sqlite ? createStorageService(storagePath) : new JsonStorageService(storagePath)
    try {
      await storage.save(data)
      await run(storage, storagePath)
    } finally { storage.close?.() }
  }

  await test('source helper enforces present hashes, preserves absent-field compatibility and CRLF hash semantics', () => {
    const version = fixture().revisionVersions[0]
    checkSource(version, 'Different source draft body.', 'Current chapter body.')
    assert.throws(() => checkSource(version, 'Changed draft.', 'Current chapter body.'), /sourceContentHash/)
    assert.throws(() => checkSource(version, 'Changed draft.', 'Current chapter body.'), /修订所依据的正文已变化/)
    assert.throws(() => checkSource(version, 'Different source draft body.', 'Changed chapter.'), /sourceChapterContentHash/)
    assert.throws(() => checkSource(version, 'Different source draft body.'), /sourceChapterContentHash/)
    checkSource(fixture({ bound: false }).revisionVersions[0], 'Any legacy source.')
    checkSource({ ...version, sourceContentHash: hash('a\r\nb'), sourceChapterContentHash: undefined }, 'a\nb')
    assert.throws(() => checkSource({ ...version, sourceContentHash: '' }, 'Different source draft body.', 'Current chapter body.'))
    assert.throws(() => checkSource({ ...version, sourceContentHash: null }, 'Different source draft body.', 'Current chapter body.'))
    checkSource({ ...version, sourceContentHash: undefined }, 'Source is unbound.', 'Current chapter body.')
  })
  await test('builder uses the original draft body and separately guards the target chapter', () => {
    const data = fixture()
    const bundle = makeBundle(data)
    validate(bundle, data)
    const changedDraft = structuredClone(data)
    changedDraft.generatedChapterDrafts[0].body = 'Author edited draft.'
    assert.throws(() => makeBundle(changedDraft), /sourceContentHash/)
    const changedChapter = structuredClone(data)
    changedChapter.chapters[0].body = 'Author edited chapter.'
    assert.throws(() => makeBundle(changedChapter), /sourceChapterContentHash/)
    const missingDraft = structuredClone(data)
    missingDraft.generatedChapterDrafts = []
    assert.throws(() => makeBundle(missingDraft), /missing source draft/)
  })
  await test('chapter-only revisions bind sourceContentHash to the actual chapter body', () => {
    const data = fixture({ draft: false })
    validate(makeBundle(data), data)
    data.chapters[0].body = 'A newer chapter.'
    assert.throws(() => makeBundle(data), /sourceContentHash/)
  })
  await test('transaction validation uses stored hashes even if payload hashes or embedded records are removed', () => {
    const data = fixture()
    const bundle = makeBundle(data)
    const changed = structuredClone(data)
    changed.generatedChapterDrafts[0].body = 'Changed since generation.'
    for (const mutate of [
      (b) => { delete b.revisionVersion.sourceContentHash; delete b.revisionVersion.sourceChapterContentHash },
      (b) => { delete b.revisionVersion },
      (b) => { delete b.revisionVersionId; delete b.revisionSessionId; delete b.revisionSession },
      (b) => { b.revisionVersionId = ''; delete b.revisionVersion.sourceContentHash },
      (b) => { b.revisionVersion.sourceContentHash = hash(changed.generatedChapterDrafts[0].body) },
      (b) => { b.revisionSession.sourceDraftId = null }
    ]) {
      const forged = structuredClone(bundle)
      mutate(forged)
      assert.throws(() => validate(forged, changed))
      assert.throws(() => apply(changed, forged))
    }
    const stripped = structuredClone(bundle)
    delete stripped.revisionVersion.sourceContentHash
    assert.throws(() => validate(stripped, data), /cannot change or remove/)
  })
  await test('forging a fresh beforeText cannot disguise an old revision baseline', () => {
    const data = fixture()
    const bundle = makeBundle(data)
    const changed = structuredClone(data)
    changed.chapters[0].body = 'New chapter while AI worked.'
    bundle.beforeText = changed.chapters[0].body
    assert.throws(() => validate(bundle, changed), /sourceChapterContentHash/)
    const onlySource = fixture({ draft: false })
    delete onlySource.revisionVersions[0].sourceChapterContentHash
    const chapterBundle = makeBundle(onlySource)
    onlySource.chapters[0].body = 'New chapter.'
    chapterBundle.beforeText = onlySource.chapters[0].body
    assert.throws(() => validate(chapterBundle, onlySource), /sourceContentHash/)
  })
  await test('source identity cannot switch through submitted session or generated draft records', () => {
    const data = fixture()
    const bundle = makeBundle(data)
    const switchedSession = structuredClone(bundle)
    switchedSession.revisionSession.sourceDraftId = null
    assert.throws(() => validate(switchedSession, data), /source draft/)
    const switchedDraft = structuredClone(bundle)
    switchedDraft.generatedDraft.id = 'other-draft'
    assert.throws(() => validate(switchedDraft, data), /source draft/)
    const movedDraft = structuredClone(data)
    movedDraft.generatedChapterDrafts[0].chapterId = 'other-chapter'
    const withoutDraftPayload = structuredClone(bundle)
    delete withoutDraftPayload.generatedDraft
    assert.throws(() => validate(withoutDraftPayload, movedDraft), /another chapter/)
  })
  await test('legacy versions without hashes remain buildable and committable', () => {
    const legacy = fixture({ bound: false })
    legacy.chapters[0].body = 'Current legacy chapter.'
    legacy.generatedChapterDrafts[0].body = 'Current legacy draft.'
    const result = apply(legacy, makeBundle(legacy))
    assert.equal(result.chapters[0].body, 'AI revised body.')
  })
  await test('historical replay ignores later source changes or removed source records but rejects altered commit content', () => {
    const data = fixture()
    const bundle = makeBundle(data)
    const committed = apply(data, bundle)
    const current = {
      ...committed, chapters: committed.chapters.map((chapter) => ({ ...chapter, body: 'Later author text.' })),
      revisionVersions: [], revisionSessions: [], generatedChapterDrafts: []
    }
    assert.equal(apply(current, bundle), current)
    assert.throws(() => apply(current, { ...bundle, revisionNote: 'Altered history' }), /immutable/)
  })

  for (const sqlite of [false, true]) {
    const label = sqlite ? 'SQLite' : 'JSON'
    await test(`${label}: late stale-source failures roll back all effects and cannot be bypassed by stripping hashes`, async () => {
      await withStorage(sqlite, fixture(), async (storage, path) => {
        const initial = await storage.loadSnapshot()
        assert.ok(initial.data.revisionVersions[0].sourceContentHash)
        const bundle = makeBundle(initial.data)
        const changed = structuredClone(initial.data)
        changed.generatedChapterDrafts[0].body = 'New source draft after preview.'
        await storage.saveIfCurrent(changed, initial.revision)
        const before = await storage.loadSnapshot()
        const bytes = await readFile(path)
        for (const mutate of [
          () => {},
          (b) => { delete b.revisionVersion.sourceContentHash; delete b.revisionVersion.sourceChapterContentHash },
          (b) => { delete b.revisionVersion },
          (b) => { delete b.revisionVersionId },
          (b) => { b.revisionVersionId = ''; delete b.revisionVersion.sourceContentHash }
        ]) {
          const forged = structuredClone(bundle)
          mutate(forged)
          await assert.rejects(storage.saveRevisionCommitBundle(forged, before.revision))
          assert.deepEqual(await storage.loadSnapshot(), before)
          assert.deepEqual(await readFile(path), bytes)
        }
      })
    })
    await test(`${label}: chapter binding rejects a rebuilt beforeText in the actual storage transaction`, async () => {
      await withStorage(sqlite, fixture(), async (storage) => {
        const initial = await storage.loadSnapshot()
        const bundle = makeBundle(initial.data)
        const changed = structuredClone(initial.data)
        changed.chapters[0].body = 'New target chapter.'
        await storage.saveIfCurrent(changed, initial.revision)
        const before = await storage.loadSnapshot()
        bundle.beforeText = before.data.chapters[0].body
        await assert.rejects(storage.saveRevisionCommitBundle(bundle, before.revision), /sourceChapterContentHash/)
        assert.deepEqual(await storage.loadSnapshot(), before)
      })
    })
    await test(`${label}: bound and legacy versions commit; exact replay never rolls back newer records or advances revision`, async () => {
      for (const bound of [true, false]) {
        await withStorage(sqlite, fixture({ bound }), async (storage, path) => {
          const initial = await storage.loadSnapshot()
          const bundle = makeBundle(initial.data)
          await storage.saveRevisionCommitBundle(bundle, initial.revision)
          const committed = await storage.loadSnapshot()
          assert.equal(committed.data.chapters[0].body, bundle.afterText)
          const changed = structuredClone(committed.data)
          changed.chapters[0].body = 'Later author text, never overwrite.'
          changed.generatedChapterDrafts[0].body = 'Later draft text.'
          changed.revisionVersions[0].sourceContentHash = hash('Changed binding after history')
          await storage.saveIfCurrent(changed, committed.revision)
          const before = await storage.loadSnapshot()
          const bytes = await readFile(path)
          const replay = await storage.saveRevisionCommitBundle(bundle, before.revision)
          assert.deepEqual(replay.savedCollections, [])
          assert.equal(replay.revision, before.revision)
          assert.deepEqual(await storage.loadSnapshot(), before)
          assert.deepEqual(await readFile(path), bytes)
          await assert.rejects(storage.saveRevisionCommitBundle({ ...bundle, revisionNote: 'Modified replay' }, before.revision), /immutable/)
          await assert.rejects(storage.saveRevisionCommitBundle(bundle, initial.revision), (error) => error.code === 'STORAGE_REVISION_CONFLICT')
        })
      }
    })
  }
  console.log(`Revision source binding validation passed (${checks} checks).`)
} finally {
  const relativePath = relative(tempRoot, outDir)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) throw new Error('Refusing cleanup outside test workspace.')
  await rm(outDir, { recursive: true, force: true })
}

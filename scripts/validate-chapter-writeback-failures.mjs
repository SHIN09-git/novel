import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const parent = join(repoRoot, 'tmp')
await mkdir(parent, { recursive: true })
const tmp = await mkdtemp(join(parent, 'chapter-writeback-failures-'))
assert.equal(dirname(tmp), parent)
const early = '2024-01-01T00:00:00.000Z'
const old = 'Synthetic old manuscript.', draftText = 'Synthetic proposed manuscript.', edited = 'Synthetic revised manuscript.'
const sensitive = ['sk', 'test', 'fixture12345678'].join('-')
let api

async function loadApi() {
  const paths = ['shared/defaults', 'services/ChapterWritebackFailureService', 'services/ChapterCommitBundleService',
    'services/RevisionCommitBundleService', 'services/ChapterVersionChainService', 'storage/JsonStorageService',
    'storage/SqliteStorageService', 'agent/AgentRuntime', 'agent/tools/agentChapterAcceptanceTools',
    'main/ipc/dataIpcHandlers', 'shared/ipc/ipcChannels', 'main/DataMergeService', 'main/dataMerge/referenceRemapping',
    'main/services/AgentAuthorizationService']
  const file = join(tmp, 'test-api.mjs')
  await build({ stdin: { contents: paths.map((p) => "export * from './src/" + p + "'").join('\n') +
    "\nexport { handlers } from 'electron'", resolveDir: repoRoot }, outfile: file,
    platform: 'node', format: 'esm', target: 'node22', bundle: true, external: ['better-sqlite3'], logLevel: 'silent',
    plugins: [{ name: 'isolated-desktop', setup(b) {
      b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents:
        'export const handlers = new Map(), ipcMain = { handle: (k,f) => handlers.set(k,f) }, ' +
        'app = { isReady: () => false, isPackaged: true }, dialog = {}, shell = {}, safeStorage = {}' }))
    } }] })
  return import(pathToFileURL(file).href)
}

function fixture(mode) {
  const chapter = { id: 'ch', projectId: 'p', order: 2, title: 'Old title', body: old, createdAt: early, updatedAt: early }
  const base = { id: 'base', projectId: 'p', chapterId: 'ch', title: chapter.title, body: old, source: 'manual_revision', createdAt: early }
  return api.normalizeAppData({
    projects: [{ id: 'p', name: 'Synthetic book' }, { id: 'other', name: 'Independent book' }],
    chapters: mode === 'new' ? [] : [chapter],
    chapterVersions: mode === 'new' || mode === 'replace' ? [] : [base,
      ...(mode === 'restore' ? [{ ...base, id: 'historical', title: 'Historical title', body: edited, createdAt: '2023-01-01T00:00:00.000Z' }] : [])],
    chapterGenerationJobs: [{ id: 'j', projectId: 'p', targetChapterOrder: 2, status: 'completed', currentStep: 'await_user_confirmation' }],
    generatedChapterDrafts: [{ id: 'd', projectId: 'p', jobId: 'j', chapterId: null, status: 'draft', title: 'Proposed title',
      body: draftText, summary: '', createdAt: early, updatedAt: early }],
    agentRuns: [{ id: 'run', projectId: 'p', createdJobIds: ['j'] }],
    revisionSessions: [{ id: 's', projectId: 'p', chapterId: 'ch', sourceDraftId: 'd', status: 'active' }],
    revisionVersions: [{ id: 'rv', sessionId: 's', status: 'pending', title: 'Candidate', body: edited }]
  })
}

function makeBundle(mode, data, id, at) {
  if (mode === 'new' || mode === 'replace') return api.buildAcceptedDraftCommitBundle({
    appData: data, projectId: 'p', targetChapterOrder: 2, chapterId: 'new-' + id, draftId: 'd',
    acceptedAt: at, acceptanceMode: 'unreviewed', commitId: id, chapterVersionId: id + '-v'
  })
  if (mode === 'restore') return api.buildRestoreRevisionCommitBundle({ appData: data, projectId: 'p', chapterId: 'ch',
    sourceVersionId: 'historical', revisionCommitId: id, newChapterVersionId: id + '-v', restoredAt: at })
  return api.buildRevisionCommitBundle({ appData: data, projectId: 'p', chapterId: 'ch',
    revisionCommitId: id, newChapterVersionId: id + '-v', revisedAt: at,
    ...(mode === 'candidate' ? { revisionSessionId: 's', revisionVersionId: 'rv' } : { afterText: edited, revisionReason: 'Manual correction' }) })
}

async function openBook(name, backend, mode) {
  const dir = await mkdtemp(join(tmp, name + '-'))
  const storagePath = join(dir, 'book.' + backend), options = { storagePath, userDataPath: dir }
  const Type = backend === 'json' ? api.JsonStorageService : api.SqliteStorageService
  const store = new Type(storagePath)
  await store.save(fixture(mode))
  const read = () => api.loadAgentRuntimeData(options)
  api.registerDataIpcHandlers({ getStorage: () => store, backupService: { maybeCreateAutomaticBackup: async () => null } })
  const commit = async (bundle, path, expectedRevision) => {
    const isRevision = 'revisionCommitId' in bundle
    const runtime = await read()
    if (path === 'agent') return (isRevision ? api.saveAgentRevisionCommitBundle : api.saveAgentChapterCommitBundle)(
      bundle, { ...runtime, revision: expectedRevision ?? runtime.revision })
    const channel = isRevision ? api.IPC_CHANNELS.DATA_SAVE_REVISION_COMMIT_BUNDLE : api.IPC_CHANNELS.DATA_SAVE_CHAPTER_COMMIT_BUNDLE
    const result = await api.handlers.get(channel)(null, { bundle, expectedRevision: expectedRevision ?? runtime.revision })
    if (!result.ok) throw Object.assign(new Error(result.error), { code: result.code })
    return result
  }
  return { backend, store, storagePath, Type, read, commit }
}

function sql(file, statement) {
  const db = new Database(file, { fileMustExist: true })
  try { db.exec(statement) } finally { db.close() }
}

// An actual filesystem/SQLite write fails. The optional hook runs only AFTER the failed write releases its lock.
async function interrupt(book, run, between, { blockEvidence = false } = {}) {
  const { backend, storagePath, Type } = book
  const tempFile = storagePath + '.tmp'
  if (backend === 'json') await mkdir(tempFile)
  else sql(storagePath, "CREATE TRIGGER interrupt_version BEFORE INSERT ON entities WHEN NEW.collection='chapterVersions' " +
    "BEGIN SELECT RAISE(ABORT, 'synthetic formal write refused'); END;" + (blockEvidence
      ? "CREATE TRIGGER interrupt_evidence BEFORE INSERT ON entities WHEN NEW.collection='chapterWritebackFailures' " +
        "BEGIN SELECT RAISE(ABORT, 'secondary failure'); END;" : ''))
  const record = Type.prototype.recordChapterWritebackFailureIfUncommitted
  let observed = 0
  Type.prototype.recordChapterWritebackFailureIfUncommitted = async function (failure) {
    assert.equal(this.getStoragePath(), storagePath)
    observed++
    if (backend === 'json' && !blockEvidence) await rmdir(tempFile)
    await between?.(failure)
    return record.call(this, failure)
  }
  try {
    await run()
    return observed
  } finally {
    Type.prototype.recordChapterWritebackFailureIfUncommitted = record
    if (backend === 'json') await rmdir(tempFile).catch((e) => { if (e.code !== 'ENOENT') throw e })
    else sql(storagePath, 'DROP TRIGGER IF EXISTS interrupt_version; DROP TRIGGER IF EXISTS interrupt_evidence;')
  }
}

const openFailures = (data) => api.unresolvedChapterWritebackFailures(data, 'p')
const writeError = /synthetic formal write refused|EISDIR|EPERM|EACCES/
function verifyAlternatives(data, retry, mode, failure) {
  const revision = 'revisionCommitId' in retry
  const collection = revision ? 'revisionCommitBundles' : 'chapterCommitBundles'
  function check(edit, message) {
    const receipt = structuredClone(retry)
    const snapshot = { ...data, [collection]: [receipt], chapterVersions: [...data.chapterVersions, structuredClone(receipt.chapterVersion)] }
    edit(snapshot, receipt, snapshot.chapterVersions.at(-1))
    assert.equal(openFailures(snapshot).length, 1, message)
  }
  check((s) => { s[collection] = [] }, 'a version alone is not a receipt')
  check((s) => { s.chapterVersions = data.chapterVersions }, 'the embedded version is not an independent stored version')
  check((_, r) => { r[revision ? 'revisedAt' : 'acceptedAt'] = failure.attemptedAt }, 'retry must be later, not simultaneous or older')
  check((_, _r, v) => { v.createdAt = early }, 'a recent receipt cannot borrow an older target version')
  check((_, _r, v) => { delete v[revision ? 'linkedRevisionCommitId' : 'linkedChapterCommitId'] }, 'replacement IDs need a linked version')
  check((_, r) => { r.projectId = 'other' }, 'same IDs in another project')
  check((_, r, v) => { v.body = r.chapter.body = r.chapterVersion.body = r.afterText = 'Different target' }, 'same source IDs but different target text')
  check((_, _r, v) => { v.body = old }, 'receipt does not match the stored version')
  check((_, _r, v) => { v.baseChapterVersionId = 'unrelated-base' }, 'stored ancestry must agree with the receipt')
  check((_, _r, v) => { v.chapterId = 'different-chapter' }, 'version belongs to another chapter')
  if (revision) {
    check((_, r) => { r.beforeText = 'Another baseline' }, 'different source text')
    check((_, r) => { r.baseChapterVersionId = 'another-base' }, 'same baseline text but different base version')
    if (mode === 'candidate') {
      check((_, r) => { r.revisionVersionId = 'other-candidate' }, 'same session, different candidate')
      check((_, r) => { r.revisionSessionId = 'other-session' }, 'same candidate ID, different session')
    } else check((_, r) => { r.revisionReason = 'Unrelated operation' }, 'manual edit and restore are not interchangeable')
  } else {
    check((_, r) => { r.generatedDraftId = 'other-draft' }, 'same job but different draft')
    check((_, r) => { r.jobId = 'other-job' }, 'same draft ID but different job')
    if (mode === 'replace') check((_, r) => { r.previousChapterVersion.body = 'Other prior chapter' }, 'automatic before-image must match')
  }
}

async function exerciseRetry(backend, mode) {
  const book = await openBook(mode, backend, mode)
  try {
    const before = await book.read(), failed = makeBundle(mode, before.data, 'first', early)
    const path = (mode === 'candidate' || mode === 'new') === (backend === 'sqlite') ? 'agent' : 'desktop'
    const count = await interrupt(book, async () => {
      await assert.rejects(book.commit(failed, path), writeError)
    }, async () => {
      assert.deepEqual((await book.read()).data, before.data, 'the failed transaction must finish rolling back before observation')
    })
    assert.equal(count, 1)
    const reopened = await book.read(), [failure] = openFailures(reopened.data)
    assert.deepEqual({ ...reopened.data, chapterWritebackFailures: [] }, before.data, 'only new evidence may differ')
    assert.notEqual(reopened.revision, before.revision)
    assert.equal(reopened.data.chapterWritebackFailures.length, 1)
    assert.equal(failure.commitId, 'first')
    assert.equal(failure.versionId, 'first-v')
    assert.equal(failure.chapterOrder, 2)
    assert.equal(failure.chapterId, failed.chapterId)
    const isChapter = mode === 'new' || mode === 'replace'
    assert.equal(failure.kind, isChapter ? 'chapter_commit' : 'revision_commit')
    if (isChapter || mode === 'candidate') assert.deepEqual([failure.jobId, failure.draftId], ['j', 'd'])
    if (mode === 'candidate') assert.deepEqual([failure.revisionSessionId, failure.revisionVersionId], ['s', 'rv'])
    for (const marker of [old, edited, draftText, book.storagePath, 'synthetic formal write refused', sensitive]) {
      assert.ok(!JSON.stringify(failure).includes(marker))
    }
    const retry = makeBundle(mode, reopened.data, 'retry', new Date(Date.parse(failure.attemptedAt) + 1000).toISOString())
    verifyAlternatives(reopened.data, retry, mode, failure)
    await book.commit(retry, path === 'desktop' ? 'agent' : 'desktop')
    const done = (await book.read()).data
    assert.equal(done.chapters[0].body, isChapter ? draftText : edited)
    assert.deepEqual(openFailures(done), [], 'a later real retry may allocate new commit and version IDs')
    assert.equal(done.chapterWritebackFailures.length, 1, 'history is retained, not bulk-cleared')
    const unrelated = { ...failure, id: 'separate', commitId: 'different', versionId: 'different-version',
      intentFingerprint: 'writeback-v1:draft-v1-0000000000000000-0' }
    assert.deepEqual(openFailures({ ...done, chapterWritebackFailures: [failure, unrelated] }).map((v) => v.id), ['separate'])
    if (mode === 'manual' || mode === 'restore') {
      const exported = JSON.parse(JSON.stringify(api.sanitizeAppDataForPersistence(done)))
      assert.deepEqual(api.normalizeAppData(exported).chapterWritebackFailures, done.chapterWritebackFailures)
      const merged = api.mergeAppData(done, api.normalizeAppData({ projects: [{ id: 'p', name: 'Different target book' }] }),
        { sourcePath: 'source', targetPath: 'target' })
      assert.equal(merged.preview.canAutoMerge, true)
      const imported = merged.mergedData.chapterWritebackFailures[0]
      assert.notEqual(imported.projectId, 'p')
      assert.notEqual(imported.baseChapterVersionId, 'base')
      assert.deepEqual(api.unresolvedChapterWritebackFailures(merged.mergedData, imported.projectId), [])
      if (mode === 'restore') {
        const pending = api.mergeAppData(reopened.data, api.normalizeAppData({ projects: [{ id: 'p', name: 'Another book' }] }),
          { sourcePath: 'source', targetPath: 'target' }).mergedData
        const [f] = pending.chapterWritebackFailures
        const source = pending.chapterVersions.find((v) => v.projectId === f.projectId && v.body === edited)
        const restored = api.buildRestoreRevisionCommitBundle({ appData: pending, projectId: f.projectId, chapterId: f.chapterId,
          sourceVersionId: source.id, revisionCommitId: 'after-import', newChapterVersionId: 'v-after-import', restoredAt: retry.revisedAt })
        assert.deepEqual(api.unresolvedChapterWritebackFailures(api.applyRevisionCommitBundleToAppData(pending, restored), f.projectId), [])
      }
    }
    console.log('PASS', backend, path, mode, 'rollback, independent reopen, binding checks and new-ID retry')
  } finally { book.store.close?.() }
}

async function competingWrites(backend) {
  const book = await openBook('competing', backend, 'manual')
  try {
    const before = await book.read(), failed = makeBundle('manual', before.data, 'retry-me', early)
    await interrupt(book, () => assert.rejects(book.commit(failed, 'agent'), writeError), async () => {
      if (backend === 'sqlite') sql(book.storagePath, 'DROP TRIGGER interrupt_version')
      const peer = new book.Type(book.storagePath)
      try {
        const snap = await peer.loadSnapshot()
        await peer.saveIfCurrent({ ...snap.data, projects: snap.data.projects.map((p) => p.id === 'other'
          ? { ...p, name: 'Saved between rollback and evidence' } : p) }, snap.revision)
      } finally { peer.close?.() }
    })
    const observed = await book.read()
    assert.equal(observed.data.projects.find((p) => p.id === 'other').name, 'Saved between rollback and evidence')
    assert.equal(openFailures(observed.data).length, 1)
    await assert.rejects(book.store.saveIfCurrent(before.data, before.revision), (e) => e.code === 'STORAGE_REVISION_CONFLICT')
    await book.commit(failed, 'agent')
    assert.deepEqual(openFailures((await book.read()).data), [], 'exact idempotent retry even when the preview timestamp predates the failure')
    const next = makeBundle('manual', (await book.read()).data, 'ack-lost', early)
    const save = book.store.saveRevisionCommitBundle.bind(book.store)
    const original = new Error('synthetic lost acknowledgement')
    book.store.saveRevisionCommitBundle = async (...args) => { await save(...args); throw original }
    await assert.rejects(api.observeFormalChapterWrites(book.store).saveRevisionCommitBundle(next), (e) => e === original)
    const afterAck = await book.read()
    assert.equal(afterAck.data.revisionCommitBundles.length, 2)
    assert.equal(afterAck.data.chapterWritebackFailures.length, 1, 'never label a committed write as failed')
    console.log('PASS', backend, 'competing save, exact replay and lost acknowledgement')
  } finally { book.store.close?.() }
}

async function exclusions(backend) {
  const book = await openBook('exclusions', backend, 'manual')
  try {
    const before = await book.read(), bundle = makeBundle('manual', before.data, 'not-written', early)
    assert.equal(await interrupt(book, () => assert.rejects(book.store.saveRevisionCommitBundle(bundle), writeError)), 0)
    assert.deepEqual(await book.read(), before, 'direct storage API still rolls back without writing any evidence')
    const legacy = makeBundle('replace', before.data, 'legacy', early)
    legacy.chapterVersion = { ...legacy.chapterVersion, source: 'before_accept_draft', body: old, linkedChapterCommitId: null }
    assert.equal(await interrupt(book, () => assert.rejects(book.commit(legacy, 'agent'), writeError)), 0,
      'a before-image alone cannot identify a target version for the failed write')
    await assert.rejects(book.commit(bundle, 'agent', 'stale-revision'), (e) => e.code === 'STORAGE_REVISION_CONFLICT')
    await assert.rejects(book.commit({ ...bundle, beforeText: 'wrong base' }, 'agent'), /stale/)
    assert.deepEqual(await book.read(), before)
    const preview = await api.previewAgentChapterAcceptance(before.data, { projectId: 'p', agentRunId: 'run', jobId: 'j', draftId: 'd',
      reason: 'Fixture preview', mode: 'unreviewed', operationId: 'test' }, before)
    const state = await book.read()
    const args = { projectId: 'p', previewId: preview.preview.id, expectedPreviewHash: preview.previewHash }
    await assert.rejects(api.applyAgentChapterAcceptance(state.data, { ...args, expectedPreviewHash: 'wrong' }, state), /预览/)
    await assert.rejects(api.applyAgentChapterAcceptance(state.data, args, state), (e) => e.code === 'AGENT_AUTHORIZATION_REQUIRED')
    assert.equal((await book.read()).data.chapterWritebackFailures.length, 0)
    await interrupt(book, async () => {
      await assert.rejects(book.commit(bundle, 'agent'), (e) => writeError.test(e.message) && !/secondary/.test(e.message))
    }, undefined, { blockEvidence: true })
    assert.deepEqual(await book.read(), state, 'an unwritable journal must not mask the original failure or change storage')
    await new api.AgentAuthorizationService(state.userDataPath).grant({ storagePath: book.storagePath, projectId: 'p',
      chapterStart: 2, chapterEnd: 2, actions: ['accept_draft', 'accept_unreviewed_draft'] })
    await interrupt(book, () => assert.rejects(api.applyAgentChapterAcceptance(state.data, args, state), writeError))
    const failed = await book.read()
    assert.equal(openFailures(failed.data).length, 1)
    assert.equal(failed.data.agentActionPreviews[0].status, 'pending')
    const save = book.Type.prototype.saveIfCurrent, metadataError = new Error('synthetic metadata failure')
    book.Type.prototype.saveIfCurrent = function (data, ...rest) {
      if (data.agentActionPreviews.some((row) => row.status === 'applied')) throw metadataError
      return save.call(this, data, ...rest)
    }
    try { await assert.rejects(api.applyAgentChapterAcceptance(failed.data, args, failed), (e) => e === metadataError) }
    finally { book.Type.prototype.saveIfCurrent = save }
    const applied = await book.read()
    assert.equal(applied.data.chapterCommitBundles.length, 1)
    assert.equal(applied.data.chapterWritebackFailures.length, 1, 'a metadata failure after commit is not a second writeback failure')
    assert.deepEqual(openFailures(applied.data), [])
    assert.equal((await api.applyAgentChapterAcceptance(applied.data, args, applied)).replayed, true)
    console.log('PASS', backend, 'direct rollback, preview/grant/validation refusals, unwritable evidence and authorized MCP recovery')
  } finally { book.store.close?.() }
}

async function ambiguousReadback(backend) {
  const scenarios = ['receipt-only', 'version-only', 'project-removed', ...(backend === 'json' ? ['unreadable'] : [])]
  for (const state of scenarios) {
    const book = await openBook(state, backend, 'manual')
    try {
      const before = await book.read(), bundle = makeBundle('manual', before.data, 'interrupted', early)
      await interrupt(book, () => assert.rejects(book.commit(bundle, 'agent'), writeError), async () => {
        if (state === 'unreadable') return writeFile(book.storagePath, '{unreadable', 'utf8')
        if (backend === 'sqlite') sql(book.storagePath, 'DROP TRIGGER interrupt_version')
        const snap = await book.store.loadSnapshot()
        const data = { ...snap.data }
        if (state === 'receipt-only') data.revisionCommitBundles = [bundle]
        if (state === 'version-only') data.chapterVersions = [...data.chapterVersions, bundle.chapterVersion]
        if (state === 'project-removed') data.projects = data.projects.filter((row) => row.id !== 'p')
        await book.store.saveIfCurrent(data, snap.revision)
      })
      if (state === 'unreadable') assert.equal(await readFile(book.storagePath, 'utf8'), '{unreadable')
      else assert.equal((await book.read()).data.chapterWritebackFailures.length, 0, state)
    } finally { book.store.close?.() }
  }
  console.log('PASS', backend, 'partial evidence and removed/unreadable targets are not proof of a failed commit')
}

function checkImport() {
  const dirty = { id: 'f', projectId: 'p', chapterId: 'ch', chapterOrder: 2, kind: 'revision_commit',
    commitId: 'shared', versionId: 'shared', attemptedAt: early, reason: sensitive, body: old, error: { token: sensitive }, path: tmp }
  const data = api.normalizeAppData({ projects: [{ id: 'p' }], settings: { apiKey: 'private-fixture-key' },
    chapterWritebackFailures: [null, [], dirty, ...[{ chapterOrder: 0 }, { chapterOrder: 1.5 }, { kind: 'preview' }, { projectId: 'missing' },
      { versionId: sensitive }, { commitId: 'private-fixture-key' }, { attemptedAt: 'yesterday' }, { jobId: tmp }].map((fields) => ({ ...dirty, ...fields }))] })
  assert.equal(data.chapterWritebackFailures.length, 1)
  const [row] = data.chapterWritebackFailures
  for (const marker of [sensitive, old, tmp, 'private-fixture-key']) assert.ok(!JSON.stringify(row).includes(marker))
  assert.deepEqual(openFailures({ ...data, chapterWritebackFailures: [null, dirty] }), [row], 'sanitize raw projections too')
  const remaps = api.createIdRemaps()
  for (const [coll, id] of [['chapterVersions', 'version'], ['chapterCommitBundles', 'chapter'], ['revisionCommitBundles', 'revision']]) {
    api.rememberId(remaps, coll, 'shared', id)
  }
  for (const [kind, expected] of [['chapter_commit', 'chapter'], ['revision_commit', 'revision']]) {
    const mapped = api.remapReferencesDeep({ ...row, kind }, remaps)
    assert.deepEqual([mapped.commitId, mapped.versionId], [expected, 'version'])
  }
  assert.deepEqual(api.normalizeAppData({}).chapterWritebackFailures, [])
  console.log('PASS legacy/defaults, allowlisted import/projection and kind-specific remaps')
}

try {
  api = await loadApi()
  const browser = await build({ entryPoints: [join(repoRoot, 'src/services/ChapterWritebackFailureService.ts')], bundle: true,
    platform: 'browser', format: 'esm', write: false, metafile: true, logLevel: 'silent' })
  assert.ok(!Object.keys(browser.metafile.inputs).some((p) => /(?:^|[\\/])storage[\\/]|sqlite|node_modules/.test(p)))
  checkImport()
  for (const backend of ['sqlite', 'json']) {
    for (const mode of ['new', 'replace', 'candidate', 'manual', 'restore']) await exerciseRetry(backend, mode)
    await competingWrites(backend)
    await ambiguousReadback(backend)
    await exclusions(backend)
  }
  console.log('PASS browser import contains no Node/SQLite runtime; all fixtures isolated')
} finally {
  await rm(tmp, { recursive: true, force: true })
}

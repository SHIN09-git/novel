#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const tmpRoot = resolve(repoRoot, 'tmp')
await mkdir(tmpRoot, { recursive: true })
const outDir = await mkdtemp(join(tmpRoot, 'candidate-decision-undo-storage-'))
const stores = []
const timestamp = '2026-09-06T00:00:00.000Z'
const originalWindow = globalThis.window
let checks = 0
let bundleCount = 0
let api

function checked(message) {
  checks += 1
  console.log(`  ok - ${message}`)
}

async function bundle(contents, plugins = []) {
  const outfile = join(outDir, `fixture-${++bundleCount}.mjs`)
  await build({ stdin: { contents, resolveDir: repoRoot, sourcefile: 'undo-storage-fixture.ts' },
    outfile, bundle: true, platform: 'node', format: 'esm', target: 'node24',
    external: ['better-sqlite3'], plugins, logLevel: 'silent' })
  return import(pathToFileURL(outfile).href)
}

function fixture() {
  const project = (id) => ({ id, name: id, genre: 'mystery', description: '', targetReaders: '',
    coreAppeal: '', style: '', createdAt: timestamp, updatedAt: timestamp })
  const event = (id, projectId) => ({ id, projectId, title: 'The observatory signal begins',
    chapterOrder: 3, storyTime: 'night', narrativeOrder: 3, participantCharacterIds: [],
    result: 'The locked observatory activates.', downstreamImpact: 'Return before dawn.',
    createdAt: timestamp, updatedAt: timestamp })
  return api.normalizeAppData({ projects: [project('p1'), project('p2')],
    chapterGenerationJobs: [{ id: 'job1', projectId: 'p1', targetChapterOrder: 3,
      promptContextSnapshotId: null, contextSource: 'auto', status: 'completed',
      currentStep: 'await_user_confirmation', errorMessage: '', createdAt: timestamp, updatedAt: timestamp }],
    chapters: [{ id: 'ch1', projectId: 'p1', order: 3, title: 'Chapter 3',
      body: 'Preserved author prose.', summary: 'Original summary.', createdAt: timestamp, updatedAt: timestamp }],
    timelineEvents: [event('foreign-event', 'p2')],
    foreshadowings: [{ id: 'new-event', projectId: 'p2', title: 'Same ID in another collection',
      description: 'Must survive the undo.', status: 'planted', createdAt: timestamp, updatedAt: timestamp }],
    memoryUpdateCandidates: [{ id: 'candidate1', projectId: 'p1', jobId: 'job1', type: 'timeline_event',
      targetId: null, proposedPatch: { schemaVersion: 1, kind: 'timeline_event_create',
        summary: 'The signal begins.', sourceChapterOrder: 3, warnings: [], event: event('new-event', 'p1') },
      evidence: 'Observed in the chapter.', confidence: 0.91, status: 'pending',
      createdAt: timestamp, updatedAt: timestamp }] })
}

function acceptCommand(data, id = 'accept1') {
  const preview = api.previewCandidateDecisions(data, { projectId: 'p1',
    decisions: [{ kind: 'memory', candidateId: 'candidate1', decision: 'accept' }] })
  return { id, projectId: 'p1', actor: { kind: 'user' }, reason: 'Accept the author proposal.',
    decidedAt: timestamp, schemaVersion: 1, confirmedHighRisk: true,
    decisions: preview.items.map(({ kind, candidateId, decision, expectedFingerprint }) =>
      ({ kind, candidateId, decision, expectedFingerprint })) }
}

function undoCommand(data, id = 'undo1', receiptId = 'accept1') {
  const preview = api.previewCandidateDecisionUndo(data, { projectId: 'p1', receiptId })
  assert.equal(preview.status, 'ready', JSON.stringify(preview))
  assert.ok(preview.expectedFingerprint)
  return { id, projectId: 'p1', actor: { kind: 'user' }, reason: 'Undo after explicit author confirmation.',
    decidedAt: '2026-09-06T00:01:00.000Z', schemaVersion: 1, confirmedHighRisk: true, decisions: [],
    undo: { receiptId, expectedFingerprint: preview.expectedFingerprint } }
}

function storeFor(kind, name) {
  const path = join(outDir, `${name}.${kind === 'sqlite' ? 'sqlite' : 'json'}`)
  const storage = kind === 'sqlite'
    ? new api.SqliteStorageService(path, { legacyJsonPath: join(outDir, `${name}-absent.json`) })
    : new api.JsonStorageService(path)
  stores.push(storage)
  return storage
}

async function seed(storage) {
  await storage.save(fixture())
  const before = await storage.loadSnapshot()
  const accepted = await storage.executeCandidateDecision(acceptCommand(before.data), before.revision)
  const snapshot = await storage.loadSnapshot()
  const receipt = snapshot.data.candidateDecisionReceipts.find((item) => item.id === 'accept1')
  assert.ok(receipt.effects?.length, 'persisted receipt must retain complete undo evidence')
  assert.deepEqual(receipt.effects, accepted.receipt.effects)
  assert.deepEqual(accepted.removedRecords ?? [], [], 'ordinary acceptance remains compatible')
  return { before, accepted, snapshot }
}

const revisionConflict = (error) => error.code === 'STORAGE_REVISION_CONFLICT'
const ordered = (records) => [...records].sort((a, b) => a.id.localeCompare(b.id))

function assertUndone(data, acceptedData) {
  assert.equal(data.timelineEvents.some((item) => item.id === 'new-event'), false)
  assert.deepEqual(data.timelineEvents, acceptedData.timelineEvents.filter((item) => item.id !== 'new-event'))
  assert.deepEqual(data.foreshadowings, acceptedData.foreshadowings)
  assert.deepEqual(data.chapters, acceptedData.chapters)
  assert.equal(data.memoryUpdateCandidates[0].status, 'pending')
  assert.deepEqual(data.candidateDecisionReceipts.find((item) => item.id === 'accept1'),
    acceptedData.candidateDecisionReceipts.find((item) => item.id === 'accept1'))
  const undo = data.candidateDecisionReceipts.find((item) => item.id === 'undo1')
  assert.equal(undo.operation, 'undo')
  assert.equal(undo.undoesReceiptId, 'accept1')
}

async function testStorage(kind) {
  const storage = storeFor(kind, `${kind}-roundtrip`)
  const { before, snapshot } = await seed(storage)
  const command = undoCommand(snapshot.data)
  await assert.rejects(storage.executeCandidateDecision(command, before.revision), revisionConflict)
  assert.deepEqual(await storage.loadSnapshot(), snapshot)
  checked(`${kind}: stale undo revision is rejected without changing records or receipts`)

  const saved = await storage.executeCandidateDecision(command, snapshot.revision)
  assert.deepEqual(saved.removedRecords, [{ collection: 'timelineEvents', ids: ['new-event'] }])
  assert.ok(saved.savedCollections.includes('timelineEvents'))
  assert.ok(saved.savedCollections.includes('candidateDecisionReceipts'))
  const after = await storage.loadSnapshot()
  assertUndone(after.data, snapshot.data)
  const merged = api.normalizeAppData(api.applyCandidateDecisionChanges(snapshot.data, saved.changes, saved.removedRecords))
  for (const collection of api.CANDIDATE_DECISION_COLLECTIONS) {
    assert.deepEqual(ordered(merged[collection]), ordered(after.data[collection]), collection)
  }
  checked(`${kind}: undo removal, candidate restoration and both receipts survive a normalized reload`)

  await assert.rejects(storage.saveIfCurrent(snapshot.data, snapshot.revision), revisionConflict)
  assert.deepEqual(await storage.loadSnapshot(), after)
  checked(`${kind}: stale full save cannot resurrect undone records`)

  const replay = await storage.executeCandidateDecision(command, before.revision)
  assert.equal(replay.replayed, true)
  assert.equal(replay.revision, after.revision)
  assert.deepEqual(replay.changes, {})
  assert.deepEqual(replay.removedRecords, [])
  assert.deepEqual(replay.savedCollections, [])
  assert.deepEqual(await storage.loadSnapshot(), after)
  await assert.rejects(storage.executeCandidateDecision({ ...command, reason: 'Altered replay.' }, after.revision))
  const repeated = await storage.executeCandidateDecision({ ...command, id: 'second-undo' }, after.revision)
  assert.equal(repeated.replayed, true)
  assert.equal(repeated.receipt.id, command.id)
  assert.deepEqual(repeated.removedRecords, [])
  assert.deepEqual(await storage.loadSnapshot(), after)
  checked(`${kind}: exact replay is write-free; altered replay and repeated undo do not mutate storage`)

  const sanitized = storeFor(kind, `${kind}-missing-evidence`)
  const journal = await seed(sanitized)
  const staleCommand = undoCommand(journal.snapshot.data)
  const redacted = structuredClone(journal.snapshot.data)
  redacted.candidateDecisionReceipts[0].effects = '[REDACTED]'
  await sanitized.saveIfCurrent(redacted, journal.snapshot.revision)
  const unavailable = await sanitized.loadSnapshot()
  assert.equal(api.previewCandidateDecisionUndo(unavailable.data, { projectId: 'p1', receiptId: 'accept1' }).status, 'unavailable')
  await assert.rejects(sanitized.executeCandidateDecision(staleCommand, unavailable.revision))
  assert.deepEqual(await sanitized.loadSnapshot(), unavailable)
  checked(`${kind}: absent or sanitizer-redacted undo evidence fails closed with no partial undo`)
}

async function testSqliteRollback() {
  const storage = storeFor('sqlite', 'sqlite-rollback')
  const { snapshot } = await seed(storage)
  const db = new Database(storage.getStoragePath())
  try {
    db.exec(`CREATE TRIGGER fail_undo_receipt BEFORE INSERT ON entities
      WHEN NEW.collection = 'candidateDecisionReceipts' AND NEW.id = 'undo1'
      BEGIN SELECT RAISE(FAIL, 'simulated undo receipt failure'); END;`)
    const command = undoCommand(snapshot.data)
    await assert.rejects(storage.executeCandidateDecision(command, snapshot.revision), /simulated undo receipt failure/)
    assert.deepEqual(await storage.loadSnapshot(), snapshot)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM entities WHERE collection = ? AND id = ?')
      .get('timelineEvents', 'new-event').count, 1)
    checked('sqlite: a receipt insert failure rolls back earlier deletes, upserts and revision together')
    db.exec('DROP TRIGGER fail_undo_receipt')
    await storage.executeCandidateDecision(command, snapshot.revision)
    assertUndone((await storage.loadSnapshot()).data, snapshot.data)
    checked('sqlite: the same command succeeds after rollback; unrelated collection/foreign project IDs survive')
  } finally { db.close() }
}

async function testJsonRace() {
  const storage = storeFor('json', 'json-race')
  const { snapshot } = await seed(storage)
  const command = undoCommand(snapshot.data)
  const save = storage.saveIfCurrent.bind(storage)
  let concurrent
  storage.saveIfCurrent = async (data, revision) => {
    concurrent = { ...snapshot.data, chapters: snapshot.data.chapters.map((item) => ({ ...item, body: 'Concurrent author prose.' })) }
    await save(concurrent, snapshot.revision)
    return save(data, revision)
  }
  await assert.rejects(storage.executeCandidateDecision(command, snapshot.revision), revisionConflict)
  storage.saveIfCurrent = save
  const after = await storage.loadSnapshot()
  assert.deepEqual(after.data, api.normalizeAppData(concurrent))
  assert.equal(after.data.candidateDecisionReceipts.length, 1)
  assert.ok(after.data.timelineEvents.some((item) => item.id === 'new-event'))
  checked('json: a write racing between preview/apply and file replacement prevents the entire undo')
}

function reviewFixture() {
  const data = fixture()
  Object.assign(data.memoryUpdateCandidates[0], { type: 'chapter_review', targetId: 'ch1',
    proposedPatch: { schemaVersion: 1, kind: 'chapter_review_update', summary: 'Review the chapter.',
      sourceChapterOrder: 3, targetChapterId: 'ch1', targetChapterOrder: 3, warnings: [],
      review: { summary: 'Accepted review.', newInformation: '', characterChanges: '', newForeshadowing: '',
        resolvedForeshadowing: '', endingHook: '', riskWarnings: '' }, continuityBridgeSuggestion: null } })
  return data
}

async function writeLegacySecretFixture(storage, kind, data) {
  if (kind === 'json') return writeFile(storage.getStoragePath(), JSON.stringify(data), 'utf8')
  const db = new Database(storage.getStoragePath())
  try {
    db.transaction(() => {
      db.prepare('UPDATE app_settings SET json = ? WHERE id = ?').run(JSON.stringify(data.settings), 'default')
      for (const collection of ['chapters', 'candidateDecisionReceipts']) {
        for (const entity of data[collection]) db.prepare('UPDATE entities SET json = ? WHERE collection = ? AND id = ?')
          .run(JSON.stringify(entity), collection, entity.id)
      }
    })()
  } finally { db.close() }
}

function assertNoSecret(value, secret) {
  assert.equal(JSON.stringify(value).includes(JSON.stringify(secret).slice(1, -1)), false,
    'a persisted or returned candidate payload must not contain the known credential')
}

async function testUndoSensitiveJournal(kind) {
  const key = 'opaque-local-fixture-credential-7319'
  const storage = storeFor(kind, `${kind}-undo-sensitive-journal`)
  await storage.save(reviewFixture())
  const initial = await storage.loadSnapshot()
  await storage.executeCandidateDecision(acceptCommand(initial.data), initial.revision)
  const accepted = await storage.loadSnapshot()
  const legacy = structuredClone(accepted.data)
  legacy.settings.apiKey = key
  legacy.chapters[0].summary = `Author current value accidentally contains ${key}.`
  await writeLegacySecretFixture(storage, kind, legacy)
  const before = await storage.loadSnapshot()
  const preview = api.previewCandidateDecisionUndo(before.data, { projectId: 'p1', receiptId: 'accept1' })
  assert.equal(preview.status, 'conflict')
  const command = { ...undoCommand(accepted.data), reason: `Author confirms undo ${key}`,
    undo: { receiptId: 'accept1', expectedFingerprint: preview.expectedFingerprint, restoreChangedFields: true } }
  const result = await storage.executeCandidateDecision(command, before.revision)
  assertNoSecret(result, key)
  assert.equal(result.receipt.effects, undefined, 'redacted journals must not remain executable undo evidence')
  const after = await storage.loadSnapshot()
  assert.equal(after.data.chapters[0].summary, initial.data.chapters[0].summary)
  if (kind === 'sqlite') {
    const db = new Database(storage.getStoragePath())
    try {
      assertNoSecret(db.prepare('SELECT * FROM entities').all(), key)
      // The test inserted this legacy setting before the command; incremental writes leave settings alone.
      assert.equal(db.prepare('SELECT json FROM app_settings WHERE id = ?').get('default').json, JSON.stringify(legacy.settings))
    } finally { db.close() }
  } else assertNoSecret(JSON.parse(await readFile(storage.getStoragePath(), 'utf8')), key)
  assertNoSecret(await storage.executeCandidateDecision(command, before.revision), key)
  assert.deepEqual(await storage.loadSnapshot(), after)
  checked(`${kind}: known settings key in undo reason/current-value journal is absent from entity rows and first/replayed responses`)

  const unsafe = structuredClone(accepted.data)
  unsafe.settings.apiKey = key
  const effect = unsafe.candidateDecisionReceipts[0].effects.find((item) => item.collection === 'chapters')
  effect.fields.find((field) => field.path.join('.') === 'summary').before.value = `Unsafe restore ${key}`
  await storage.save(unsafe)
  await writeLegacySecretFixture(storage, kind, unsafe)
  const unsafeSnapshot = await storage.loadSnapshot()
  await assert.rejects(storage.executeCandidateDecision(undoCommand(unsafeSnapshot.data), unsafeSnapshot.revision), (error) => {
    assertNoSecret(error.message, key)
    return true
  })
  assert.deepEqual(await storage.loadSnapshot(), unsafeSnapshot)
  checked(`${kind}: restoring a credential into a live target fails atomically without echoing the secret`)

  const missingTarget = structuredClone(accepted.data)
  missingTarget.settings.apiKey = key
  missingTarget.chapters = []
  missingTarget.candidateDecisionReceipts[0].effects.find((item) => item.collection === 'chapters').title = key
  await storage.save(missingTarget)
  await writeLegacySecretFixture(storage, kind, missingTarget)
  const missingSnapshot = await storage.loadSnapshot()
  await assert.rejects(storage.executeCandidateDecision(command, missingSnapshot.revision), (error) => {
    assert.equal(error.code, 'CANDIDATE_UNDO_UNAVAILABLE')
    assertNoSecret({ message: error.message, stack: error.stack, code: error.code }, key)
    return true
  })
  assert.deepEqual(await storage.loadSnapshot(), missingSnapshot)
  checked(`${kind}: rejected undo errors redact known keys in journal titles without losing error codes or writing`)
}

function testPureReceiptSanitizer() {
  const key = 'known-opaque-fixture-key-5192'
  const nestedKey = 'nested-unrecognized-fixture-key-2876'
  const data = api.normalizeAppData(reviewFixture())
  data.settings.apiKey = key
  const before = structuredClone(data)
  const command = { ...acceptCommand(data), reason: `Author decision ${key}` }
  const applied = api.applyCandidateDecisionCommand(data, command)
  const clean = api.sanitizeCandidateDecisionWrite(data, applied)
  assert.deepEqual(clean.receipt.effects, applied.receipt.effects)
  assertNoSecret(clean.receipt, key)
  checked('pure sanitizer: reason-only redaction keeps the complete undo journal and command fingerprint')

  const journal = applied.receipt.effects[0].fields[0]
  journal.before = { exists: true, value: { nested: [false, 0, null, { text: key, apiKey: nestedKey }] } }
  const raw = structuredClone(applied)
  const safe = api.sanitizeCandidateDecisionWrite(data, applied)
  assert.deepEqual(data, before)
  assert.deepEqual(applied, raw, 'recursive sanitization must not mutate source or decision results')
  assertNoSecret(safe.receipt, key)
  assertNoSecret(safe.receipt, nestedKey)
  assert.equal(safe.receipt.effects, undefined)
  assert.equal(safe.receipt.commandFingerprint, applied.receipt.commandFingerprint)
  assert.equal(api.previewCandidateDecisionUndo(safe.data, { projectId: 'p1', receiptId: 'accept1' }).status, 'unavailable')
  const insertValues = api.entityInsertValues({ collection: 'candidateDecisionReceipts', value: safe.receipt }, 0, timestamp)
  assertNoSecret(insertValues, key)
  assertNoSecret(insertValues, nestedKey)
  assert.deepEqual(JSON.parse(insertValues.at(-1)), safe.receipt)
  checked('pure sanitizer: nested array/object credentials never reach mapper output; altered journals fail closed without mutating inputs')
}

async function testSqliteRemovalBoundary() {
  const storage = storeFor('sqlite', 'sqlite-removal-boundary')
  const { snapshot } = await seed(storage)
  globalThis.__undoStorageService = { ...api }
  const { executeSqliteCandidateDecision } = await bundle(
    `export { executeSqliteCandidateDecision } from './src/storage/sqlite/sqliteCandidateDecisions.ts';`,
    [{ name: 'malformed-service-result', setup(builder) {
      builder.onResolve({ filter: /\/CandidateDecisionService$/ }, () => ({ path: 'service', namespace: 'undo-boundary' }))
      builder.onLoad({ filter: /.*/, namespace: 'undo-boundary' }, () => ({ contents: `
        export const CANDIDATE_DECISION_COLLECTIONS = globalThis.__undoStorageService.CANDIDATE_DECISION_COLLECTIONS;
        export const applyCandidateDecisionCommand = (...args) => globalThis.__undoStorageService.applyCandidateDecisionCommand(...args);
        export const candidateDecisionChanges = (...args) => globalThis.__undoStorageService.candidateDecisionChanges(...args);
        export const candidateDecisionRemovals = (...args) => globalThis.__undoStorageService.candidateDecisionRemovals(...args);` }))
    } }])
  const db = new Database(storage.getStoragePath())
  try {
    for (const invalid of [
      { collection: 'app_settings', ids: ['settings'] },
      { collection: 'timelineEvents', ids: ['foreign-event'] },
      { collection: 'timelineEvents', ids: ['missing-event'] },
      { collection: 'foreshadowings', ids: ['new-event'] }
    ]) {
      globalThis.__undoStorageService.applyCandidateDecisionCommand = (data) => ({
        data: { ...data, timelineEvents: data.timelineEvents.filter((item) => item.id !== 'new-event'),
          foreshadowings: invalid.collection === 'foreshadowings' ? [] : data.foreshadowings },
        receipt: { updatedAt: timestamp }, replayed: false })
      // A valid removal runs first so every rejection must also roll back that deletion.
      globalThis.__undoStorageService.candidateDecisionRemovals = () => [
        { collection: 'timelineEvents', ids: ['new-event'] }, invalid]
      assert.throws(() => executeSqliteCandidateDecision(db, storage.getStoragePath(),
        undoCommand(snapshot.data), snapshot.revision), /Candidate decision (cannot remove|removal does not match)/)
      assert.deepEqual(await storage.loadSnapshot(), snapshot)
    }
    checked('sqlite: disallowed collection, retained ID, absent ID and foreign project removal all roll back')
  } finally { db.close(); delete globalThis.__undoStorageService }
}

function bridgePlugin() {
  return { name: 'isolated-undo-bridge', setup(builder) {
    builder.onResolve({ filter: /^(electron|react)$/ }, ({ path }) => ({ path, namespace: 'undo-mock' }))
    builder.onLoad({ filter: /.*/, namespace: 'undo-mock' }, ({ path }) => ({ contents: path === 'react'
      ? `export const useRef = value => ({current:value});
         export const useState = value => [value, () => {}];
         export const useEffect = effect => globalThis.__undoEffects.push(effect);`
      : `export const ipcRenderer = {invoke: (...args) => globalThis.__undoInvoke(...args)};
         export const contextBridge = {exposeInMainWorld: (key, value) => {globalThis.window[key] = value}};` }))
  } }
}

async function testRendererBridge(fallback = false) {
  const storage = storeFor('json', `renderer-${fallback ? 'fallback' : 'ipc'}`)
  const { snapshot } = await seed(storage)
  const calls = []
  let failDecision = false
  const channels = api.IPC_CHANNELS
  globalThis.window = {}
  globalThis.__undoEffects = []
  globalThis.__undoInvoke = async (channel, request) => {
    calls.push({ channel, request: structuredClone(request) })
    try {
      if (channel === channels.STORAGE_GET) return { ok: true, ...(await storage.loadSnapshot()), storagePath: storage.getStoragePath() }
      if (channel === channels.STORAGE_SAVE) {
        if (failDecision) throw new Error('simulated transport failure')
        return await storage.saveIfCurrent(request.data, request.expectedRevision)
      }
      if (channel === channels.DATA_EXECUTE_CANDIDATE_DECISION) {
        if (failDecision) throw new Error('simulated transport failure')
        return await storage.executeCandidateDecision(request.command, request.expectedRevision)
      }
      throw new Error(`Unexpected IPC channel: ${channel}`)
    } catch (error) { return { ok: false, error: error.message, code: error.code } }
  }
  const { useAppData } = await bundle(`import './src/preload/index.ts';
    export { useAppData } from './src/renderer/src/hooks/useAppData.ts';`, [bridgePlugin()])
  if (fallback) delete window.novelDirector.data.executeCandidateDecision
  const hook = useAppData()
  globalThis.__undoEffects[0]()
  for (let attempt = 0; attempt < 100 && !hook.getCurrentData().projects.length; attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  assert.equal(hook.getCurrentData().projects.length, 2)
  const command = undoCommand(hook.getCurrentData())
  failDecision = true
  await assert.rejects(hook.executeCandidateDecision(command), /simulated transport failure/)
  assert.deepEqual(hook.getCurrentData(), snapshot.data)
  assert.deepEqual(await storage.loadSnapshot(), snapshot)
  failDecision = false

  const undo = hook.executeCandidateDecision(command)
  const laterSave = hook.saveData((current) => ({ ...current,
    chapters: current.chapters.map((item) => ({ ...item, summary: 'Saved after undo.' })) }))
  await undo
  assert.equal((await laterSave).ok, true)
  const after = await storage.loadSnapshot()
  assert.equal(after.data.timelineEvents.some((item) => item.id === 'new-event'), false)
  assert.equal(after.data.candidateDecisionReceipts.length, 2)
  assert.equal(after.data.chapters[0].summary, 'Saved after undo.')
  assert.deepEqual(api.normalizeAppData(hook.getCurrentData()), after.data)
  if (!fallback) {
    const decision = calls.filter((item) => item.channel === channels.DATA_EXECUTE_CANDIDATE_DECISION).at(-1)
    assert.equal(decision.request.expectedRevision, snapshot.revision)
    assert.deepEqual(decision.request.command.decisions, [])
    assert.deepEqual(decision.request.command.undo, command.undo)
    assert.notEqual(calls.filter((item) => item.channel === channels.STORAGE_SAVE).at(-1).request.expectedRevision, snapshot.revision)

    await storage.saveIfCurrent({ ...after.data,
      chapters: after.data.chapters.map((item) => ({ ...item, summary: 'External edit before replay.' })) }, after.revision)
    await hook.executeCandidateDecision(command)
    assert.equal(hook.getCurrentData().chapters[0].summary, 'External edit before replay.')
    assert.equal(calls.at(-1).channel, channels.STORAGE_GET)
    checked('renderer/preload: undo replay reloads external writes and refreshes the bridge revision')
  }
  checked(`renderer ${fallback ? 'legacy fallback' : 'IPC'}: failure preserves state; queued undo then full save retains deletions and receipts`)

  const fresh = await storage.loadSnapshot()
  await storage.saveIfCurrent({ ...fresh.data, chapters: fresh.data.chapters.map((item) => ({ ...item, body: 'External latest prose.' })) }, fresh.revision)
  const localBefore = structuredClone(hook.getCurrentData())
  const staleSave = await hook.saveData((current) => ({ ...current, chapters: current.chapters.map((item) => ({ ...item, body: 'Stale prose.' })) }))
  assert.equal(staleSave.ok, false)
  assert.deepEqual(hook.getCurrentData(), localBefore)
  assert.equal((await storage.loadSnapshot()).data.chapters[0].body, 'External latest prose.')
  checked(`renderer ${fallback ? 'legacy fallback' : 'IPC'}: an externally stale full save is rejected without changing local state`)
}

try {
  api = await bundle(`export * from './src/services/CandidateDecisionService.ts';
    export { previewCandidateDecisionUndo } from './src/services/CandidateDecisionUndoService.ts';
    export { normalizeAppData } from './src/shared/defaults.ts';
    export { SqliteStorageService } from './src/storage/SqliteStorageService.ts';
    export { JsonStorageService, sanitizeCandidateDecisionWrite } from './src/storage/JsonStorageService.ts';
    export { entityInsertValues } from './src/storage/sqlite/sqliteEntityMapper.ts';
    export { IPC_CHANNELS } from './src/shared/ipc/ipcChannels.ts';`)
  await testStorage('sqlite')
  await testStorage('json')
  await testUndoSensitiveJournal('sqlite')
  await testUndoSensitiveJournal('json')
  testPureReceiptSanitizer()
  await testSqliteRollback()
  await testSqliteRemovalBoundary()
  await testJsonRace()
  await testRendererBridge()
  await testRendererBridge(true)
  const mainSource = await readFile(join(repoRoot, 'src/main/ipc/dataIpcHandlers.ts'), 'utf8')
  assert.match(mainSource, /assertCurrentStorage\(context, storage\)[\s\S]*return storage\.executeCandidateDecision\(\s*\{\s*\.\.\.request\.command,\s*actor:\s*\{\s*kind:\s*'user'\s*\}\s*\},\s*request\.expectedRevision\s*\)/)
  checked('main IPC keeps the same decision entry, user actor and optimistic revision without stripping removals')
  console.log(`PASS: candidate decision undo storage (${checks} checks; isolated SQLite/JSON and mocked renderer IPC).`)
} finally {
  for (const storage of stores) storage.close?.()
  if (originalWindow === undefined) delete globalThis.window
  else globalThis.window = originalWindow
  delete globalThis.__undoEffects
  delete globalThis.__undoInvoke
  delete globalThis.__undoStorageService
  const child = relative(tmpRoot, resolve(outDir))
  assert.ok(child && !child.startsWith('..') && !isAbsolute(child), 'cleanup stays inside the isolated tmp directory')
  await rm(outDir, { recursive: true, force: true })
}

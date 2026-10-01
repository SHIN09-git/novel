#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const tempRoot = join(repoRoot, 'tmp')
await mkdir(tempRoot, { recursive: true })
const outDir = await mkdtemp(join(tempRoot, 'agent-revision-tools-'))
const databases = new Map()
const nativePaths = new Set()
const nativeHandles = new Set()
globalThis.__agentRevisionDatabases = databases
globalThis.__agentRevisionNativePaths = nativePaths
globalThis.__agentRevisionNativeHandles = nativeHandles
globalThis.fetch = async () => { throw new Error('Network is forbidden in Agent revision fixtures.') }
let checks = 0
let fixtureId = 0
let NativeDatabase
let nativeSkipReason = ''
let nativeChecks = 0
const timestamp = '2026-09-06T10:00:00.000Z'
const body = 'The clock stood still. She pocketed the note. Someone closed the window.'
const target = 'She pocketed the note.'
const replacement = 'She folded the note and hid it.'
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }
async function test(label, run) { await run(); checks++; console.log(`PASS ${label}`) }

try {
  if (process.versions.electron) throw new Error('Run Agent revision fixtures with Node, not Electron.')
  try {
    const Database = createRequire(import.meta.url)('better-sqlite3')
    const probe = new Database(':memory:')
    try { assert.ok(probe.prepare('SELECT sqlite_version() AS version').get().version); NativeDatabase = Database }
    finally { probe.close() }
  } catch (error) {
    nativeSkipReason = `Node ${process.version} ABI ${process.versions.modules}: ${error.message ?? error}`
    if (process.argv.includes('--require-native')) throw new Error(`Required native SQLite unavailable: ${nativeSkipReason}`)
  }
  const outfile = join(outDir, 'api.mjs')
  await build({
    stdin: { contents: `
      export { AgentToolService } from './src/agent/tools/AgentToolService';
      export { AgentAuthorizationService } from './src/main/services/AgentAuthorizationService';
      export { buildNamedAgentToolCall } from './src/agent/tools/agentCliToolCall';
      export { resolvePipelineRoleSettings } from './src/services/PipelineRunContextService';
      export { loadAgentRuntimeData, saveAgentRuntimeData, saveAgentRevisionCommitBundle } from './src/agent/AgentRuntime';
      export { normalizeAppData } from './src/shared/defaults';
      export { draftContentHash } from './src/services/DraftDiagnosticBindingService';
      export { revisionFingerprint, revisionAudit } from './src/agent/revision/agentRevisionModel';
      export { applyApprovedAgentRevisionCommit } from './src/agent/revision/agentRevisionCommits';
      export { buildRevisionCommitBundle, validateRevisionCommitBundle } from './src/services/RevisionCommitBundleService';
      export { JsonStorageService } from './src/storage/JsonStorageService';
      export { SqliteStorageService } from './src/storage/SqliteStorageService';
    `, resolveDir: repoRoot, loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22',
    external: ['better-sqlite3', 'electron'], logLevel: 'silent',
    plugins: [{ name: 'isolated-agent-revision-boundaries', setup(builder) {
      builder.onResolve({ filter: /AgentPipelineExecutor$/ }, () => ({ path: 'ai', namespace: 'revision-fixture' }))
      builder.onResolve({ filter: /SqliteStorageService$/ }, () => ({ path: 'sqlite', namespace: 'revision-fixture' }))
      builder.onResolve({ filter: /^real-revision-sqlite$/ }, () => ({ path: join(repoRoot, 'src/storage/SqliteStorageService.ts') }))
      builder.onLoad({ filter: /.*/, namespace: 'revision-fixture' }, ({ path }) => ({ contents: path === 'ai' ? `
        export const executeAgentChapterPipeline = () => { throw new Error('Pipeline forbidden in revision fixture'); };
        export const createHeadlessTransport = () => ({ transport: { chatCompletion: (request) => globalThis.__agentRevisionAI(request) } });
      ` : `
        import { SqliteStorageService, loadSqliteSnapshotReadonly as readNative,
          loadSqliteCollectionsReadonly as readNativeCollections } from 'real-revision-sqlite';
        export { SqliteStorageService };
        export const createStorageService = (path) => {
          if (globalThis.__agentRevisionNativePaths.has(path)) {
            // No JSON fallback: this branch must construct and use the real native service.
            const storage = new SqliteStorageService(path);
            globalThis.__agentRevisionNativeHandles.add(storage);
            const close = storage.close.bind(storage);
            storage.close = () => { close(); globalThis.__agentRevisionNativeHandles.delete(storage); };
            return storage;
          }
          const storage = globalThis.__agentRevisionDatabases.get(path);
          if (!storage) throw new Error('Native/unregistered SQLite path forbidden: ' + path);
          return storage;
        };
        export const loadSqliteSnapshotReadonly = (path) => globalThis.__agentRevisionNativePaths.has(path)
          ? readNative(path) : createStorageService(path).loadSnapshot();
        export const loadSqliteCollectionsReadonly = async (path, collections) => {
          if (globalThis.__agentRevisionNativePaths.has(path)) return readNativeCollections(path, collections);
          const snapshot = await createStorageService(path).loadSnapshot();
          return { revision: snapshot.revision,
            data: Object.fromEntries(collections.map(key => [key, snapshot.data[key]])) };
        };
      `, loader: 'js' }))
    } }]
  })
  const api = await import(pathToFileURL(outfile).href)
  const hash = api.draftContentHash
  const copy = (value) => structuredClone(value)
  function fixture() {
    return api.normalizeAppData({
      settings: { apiProvider: 'local', hasApiKey: true },
      projects: ['p1', 'p2'].map((id) => ({ id, name: id, createdAt: timestamp, updatedAt: timestamp })),
      chapters: ['p1', 'p2'].map((id) => ({ id: `ch-${id}`, projectId: id, order: 1, title: id, body, createdAt: timestamp, updatedAt: timestamp })),
      chapterGenerationJobs: ['p1', 'p2'].map((id) => ({ id: `job-${id}`, projectId: id, targetChapterOrder: 1, status: 'completed', createdAt: timestamp, updatedAt: timestamp })),
      generatedChapterDrafts: ['p1', 'p2'].map((id) => ({ id: `draft-${id}`, projectId: id, chapterId: `ch-${id}`, jobId: `job-${id}`, title: id, body, status: 'draft', createdAt: timestamp, updatedAt: timestamp })),
      agentRuns: ['p1', 'p2'].map((id) => ({ id: `run-${id}`, projectId: id, goal: 'Revise prose only', mode: 'single_chapter', safetyMode: 'conservative',
        status: 'running', targetChapterOrders: [1], createdJobIds: [], createdDraftIds: [], createdCommitIds: [], pendingHumanReviewItemIds: [], decisions: [],
        summary: '', warnings: [], startedAt: timestamp, updatedAt: timestamp, schemaVersion: 1 })),
      characters: [{ id: 'foreign-character', projectId: 'p2', name: 'FOREIGN_CONTEXT_MARKER', isMain: true, createdAt: timestamp, updatedAt: timestamp }]
    })
  }

  function uiCandidateFixture(sourceDraftId = null) {
    const data = fixture()
    data.revisionSessions.push({ id: 'ui-session', projectId: 'p1', chapterId: 'ch-p1', sourceDraftId,
      status: 'active', createdAt: timestamp, updatedAt: timestamp })
    data.revisionRequests.push({ id: 'ui-request', sessionId: 'ui-session', type: 'custom',
      targetRange: '', instruction: 'Keep this author revision.', createdAt: timestamp })
    data.revisionVersions.push({ id: 'ui-version', sessionId: 'ui-session', requestId: 'ui-request', title: 'Author candidate',
      body: 'The author revised this directly.', changedSummary: 'Author edit.', risks: '', preservedFacts: '',
      sourceContentHash: hash(body), sourceChapterContentHash: hash(body), responseScope: 'as_requested',
      status: 'draft', createdAt: timestamp, updatedAt: timestamp })
    return data
  }

  function sqliteBoundary(initial, storagePath) {
    // Real revision validator, bundle application and entity mapping; simulated database I/O and rollback.
    let state = { data: copy(initial), revision: 'initial' }
    let inTransaction = false, failEntity = false, failMetadata = false
    const db = { transaction: (fn) => (...args) => {
      const before = copy(state)
      inTransaction = true
      try { return fn(...args) } catch (error) { state = before; throw error } finally { inTransaction = false }
    } }
    const storage = Object.create(api.SqliteStorageService.prototype)
    Object.assign(storage, {
      storagePath, open: async () => db, isEmpty: () => false,
      readAppData: () => copy(state.data), currentRevision: () => state.revision,
      writeEntityEntries: (_db, entries) => {
        assert.ok(inTransaction)
        for (const { collection, value } of entries) {
          const index = state.data[collection].findIndex((item) => item.id === value.id)
          if (index < 0) state.data[collection].push(copy(value)); else state.data[collection][index] = copy(value)
          if (failEntity) { failEntity = false; throw new Error('Injected entity rollback') }
        }
      },
      writeRevisionMeta: (_db, revision) => { assert.ok(inTransaction); state.revision = revision },
      loadSnapshot: async () => copy(state), close: () => {},
      saveIfCurrent: async (data, expected) => {
        assert.equal(expected, state.revision, 'SQLite boundary CAS')
        if (failMetadata) { failMetadata = false; throw new Error('Injected metadata failure') }
        state = { data: api.normalizeAppData(copy(data)), revision: `${state.revision}-save` }
        return { ok: true, storagePath, revision: state.revision }
      }
    })
    return { storage, failEntity: () => { failEntity = true }, failMetadata: () => { failMetadata = true } }
  }

  async function harness(kind, initial = fixture()) {
    const dir = join(outDir, `fixture-${++fixtureId}`)
    await mkdir(dir)
    const storagePath = join(dir, kind === 'json' ? 'data.json' : 'data.sqlite')
    let boundary
    let storage
    if (kind === 'json') {
      storage = new api.JsonStorageService(storagePath)
      await storage.save(initial)
    } else if (kind === 'sqlite-native') {
      assert.ok(NativeDatabase, 'Native fixture must never use the simulated boundary.')
      nativePaths.add(storagePath)
      // Each direct fixture operation closes its handle and the next read reopens the real file.
      const withNative = async (operation) => {
        const current = new api.SqliteStorageService(storagePath)
        nativeHandles.add(current)
        try { return await operation(current) }
        finally { current.close(); nativeHandles.delete(current) }
      }
      storage = {
        loadSnapshot: () => withNative((current) => current.loadSnapshot()),
        saveIfCurrent: (data, expected) => withNative((current) => current.saveIfCurrent(data, expected))
      }
      await withNative((current) => current.save(initial))
    } else {
      boundary = sqliteBoundary(initial, storagePath)
      storage = boundary.storage
      databases.set(storagePath, storage)
      const { writeFile } = await import('node:fs/promises')
      await writeFile(storagePath, 'isolated simulated SQLite boundary; not a database')
    }
    const paths = { storagePath, userDataPath: dir }
    const call = async (name, args = {}) => (await api.AgentToolService.callTool(api.buildNamedAgentToolCall({
      name: `agent.${name}`, 'arguments-json': JSON.stringify({ ...paths, projectId: 'p1', ...args })
    }))).data
    const snapshot = () => storage.loadSnapshot()
    const edit = async (mutate) => { const current = await snapshot(); mutate(current.data); await storage.saveIfCurrent(current.data, current.revision) }
    const write = { agentRunId: 'run-p1', reason: 'Agent inspected source; prose only.' }
    const sourceArgs = (source) => ({ expectedSourceHash: source.sourceContentHash, expectedChapterHash: source.sourceChapterContentHash })
    const request = async (extra = {}) => {
      const source = (await call('getRevisionSessions', { chapterId: 'ch-p1' })).currentSource
      return call('createRevisionRequest', { ...write, operationId: 'request', chapterId: 'ch-p1', instruction: 'Tighten the action.', ...sourceArgs(source), ...extra })
    }
    const generate = (req, extra = {}) => call('generateRevisionVersion', { ...write, operationId: 'generate', requestId: req.requestId,
      expectedRequestHash: req.requestHash, ...sourceArgs(req.source), ...extra })
    const preview = (version, extra = {}) => call('previewRevisionCommit', { ...write, operationId: 'preview', versionId: version.version.id,
      expectedVersionHash: version.versionHash, ...sourceArgs(version.currentSource), ...extra })
    const apply = (preview, extra = {}) => call('applyApprovedRevisionCommit', { agentRunId: 'run-p1', previewId: preview.preview.id,
      expectedPreviewHash: preview.previewHash, confirm: true, ...extra })
    let response = async () => ({ ok: true, content: JSON.stringify({ revisedText: body.replace(target, replacement), changedSummary: 'Tighter action.', risks: '', preservedFacts: 'Same facts.' }) })
    const calls = []
    globalThis.__agentRevisionAI = (input) => { calls.push(input); return response(input) }
    return { call, request, generate, preview, apply, snapshot, edit, write, sourceArgs, boundary, calls, paths,
      respond: (fn) => { response = fn }, prepare: async () => preview(await generate(await request())) }
  }

  if (NativeDatabase) {
    await test('sqlite-native: real candidate -> preview -> transactional commit -> reopen -> replay never overwrites later prose', async () => {
      const h = await harness('sqlite-native')
      assert.equal((await readFile(h.paths.storagePath)).subarray(0, 16).toString(), 'SQLite format 3\0')
      assert.equal(databases.has(h.paths.storagePath), false, 'Native fixture cannot use simulated I/O')
      const req = await h.request()
      const v = await h.generate(req)
      const before = await h.snapshot()
      assert.equal(v.version.status, 'pending')
      assert.equal(before.data.chapters.find((chapter) => chapter.id === 'ch-p1').body, body)
      assert.equal(before.data.revisionVersions.find((version) => version.id === v.version.id).sourceContentHash, hash(body))
      assert.equal(before.data.revisionCommitBundles.length, 0)
      const p = await h.preview(v)
      assert.equal((await h.snapshot()).data.revisionCommitBundles.length, 0)
      const committed = await h.apply(p)
      assert.equal(committed.commitSave.storagePath, h.paths.storagePath)
      const persisted = await h.snapshot()
      const bundle = persisted.data.revisionCommitBundles.find((item) => item.revisionCommitId === committed.revisionCommitId)
      assert.ok(bundle)
      assert.equal(bundle.revisedBy, 'agent')
      assert.equal(bundle.chapterVersion.source, 'agent_revision')
      assert.deepEqual(bundle.actor, { kind: 'agent', agentRunId: 'run-p1', actionPreviewId: p.preview.id })
      assert.equal(bundle.beforeText, body)
      assert.equal(bundle.afterText, body.replace(target, replacement))
      assert.equal(persisted.data.chapterVersions.find((version) => version.id === bundle.newChapterVersionId).body, bundle.afterText)
      assert.equal(persisted.data.revisionVersions.find((version) => version.id === v.version.id).status, 'accepted')
      assert.equal(persisted.data.agentActionPreviews.find((preview) => preview.id === p.preview.id).status, 'applied')
      const decision = persisted.data.agentRuns.find((run) => run.id === 'run-p1').decisions.find((item) => item.step === 'apply_action_preview')
      assert.equal(api.revisionAudit(decision.evidence).actor.kind, 'agent')
      assert.equal((await h.apply(p)).replayed, true)
      assert.deepEqual(await h.snapshot(), persisted, 'Exact replay must not write rows or change the storage revision')
      await h.edit((data) => { data.chapters.find((chapter) => chapter.id === 'ch-p1').body = 'Later native author prose.' })
      const later = await h.snapshot()
      assert.equal((await h.apply(p)).replayed, true)
      assert.deepEqual(await h.snapshot(), later, 'Replay must not overwrite later native prose or metadata')
      const db = new NativeDatabase(h.paths.storagePath, { readonly: true, fileMustExist: true })
      try {
        assert.equal(db.prepare("SELECT count(*) AS n FROM entities WHERE collection = 'revisionCommitBundles'").get().n, 1)
        const row = db.prepare("SELECT json FROM entities WHERE collection = 'chapters' AND id = ?").get('ch-p1')
        assert.equal(JSON.parse(row.json).body, 'Later native author prose.')
        assert.deepEqual(db.prepare('PRAGMA integrity_check').all(), [{ integrity_check: 'ok' }])
      } finally { db.close() }
      assert.equal(nativeHandles.size, 0, 'All native storage handles must be closed before leaving the test')
      nativeChecks++
    })
  } else {
    console.log(`SKIP sqlite-native: ${nativeSkipReason}. No rebuild attempted; use --require-native for release verification.`)
  }

  for (const kind of ['json', ...(NativeDatabase ? ['sqlite-native'] : [])]) {
    for (const sourceDraftId of [null, 'draft-p1']) {
      await test(`${kind}: UI ${sourceDraftId ? 'draft' : 'chapter'} candidate direct approval, typed actor validation and immutable replay`, async () => {
        const h = await harness(kind, uiCandidateFixture(sourceDraftId))
        const before = await h.snapshot()
        assert.ok(before.data.agentRuns.every((run) => run.decisions.length === 0))
        const v = await h.call('getRevisionVersion', { versionId: 'ui-version', detail: 'full' })
        const p = await h.preview(v)
        const ready = await h.snapshot()
        assert.deepEqual(ready.data.revisionVersions, before.data.revisionVersions, 'Preview must not fork or supersede the UI candidate')
        assert.equal(ready.data.chapters[0].body, body)
        assert.equal(ready.data.revisionCommitBundles.length, 0)
        const actor = { kind: 'agent', agentRunId: 'run-p1', actionPreviewId: p.preview.id }
        const bundle = api.buildRevisionCommitBundle({ appData: ready.data, projectId: 'p1', chapterId: 'ch-p1',
          revisionCommitId: 'actor-validation-commit', newChapterVersionId: 'actor-validation-version',
          revisionSessionId: 'ui-session', revisionVersionId: 'ui-version', revisedAt: timestamp,
          revisedBy: 'agent', actor, revisionReason: 'Actor boundary fixture.' })
        api.validateRevisionCommitBundle(bundle, ready.data)
        for (const wrongActor of [undefined, { ...actor, kind: 'user' }, { ...actor, agentRunId: 'run-p2' },
          { ...actor, actionPreviewId: 'missing-preview' }]) {
          const bad = { ...bundle, actor: wrongActor }
          assert.throws(() => api.validateRevisionCommitBundle(bad, ready.data), /actor|foreign|preview/i)
          const runtime = await api.loadAgentRuntimeData(h.paths)
          await assert.rejects(api.saveAgentRevisionCommitBundle(bad, runtime), /actor|foreign|preview/i)
          assert.deepEqual(await h.snapshot(), ready, 'Rejected actor must not write data or advance revision')
        }
        await h.apply(p)
        const accepted = await h.snapshot()
        const commit = accepted.data.revisionCommitBundles[0]
        assert.equal(commit.revisedBy, 'agent')
        assert.equal(commit.chapterVersion.source, 'agent_revision')
        assert.deepEqual(commit.actor, actor)
        assert.equal(accepted.data.revisionVersions.length, 1, 'No fake edit/fork needed for approval')
        assert.equal(accepted.data.revisionVersions[0].id, 'ui-version')
        assert.equal(accepted.data.revisionVersions[0].body, v.version.body)
        assert.equal(accepted.data.revisionVersions[0].status, 'accepted')
        assert.equal(accepted.data.chapters[0].body, v.version.body)
        assert.deepEqual(accepted.data.revisionRequests, before.data.revisionRequests)
        assert.ok(accepted.data.agentRuns[0].decisions.every((decision) => !['generate_revision_version', 'edit_revision_version'].includes(decision.step)))
        assert.equal(h.calls.length, 0, 'Direct approval must not call AI')
        if (sourceDraftId) assert.equal(accepted.data.generatedChapterDrafts[0].body, v.version.body)
        for (const wrongActor of [undefined, { ...actor, kind: 'user' }, { ...actor, agentRunId: 'run-p2' },
          { ...actor, actionPreviewId: 'different-preview' }]) {
          await h.edit((data) => { data.revisionCommitBundles[0].actor = wrongActor })
          const tampered = await h.snapshot()
          await assert.rejects(h.apply(p), /does not match/)
          assert.deepEqual(await h.snapshot(), tampered, 'Replay must reject a receipt with the wrong actor')
        }
        await h.edit((data) => { data.revisionCommitBundles[0].actor = actor; data.chapters[0].body = 'Later author change.' })
        const later = await h.snapshot()
        assert.equal((await h.apply(p)).replayed, true)
        assert.deepEqual(await h.snapshot(), later)
        assert.equal(nativeHandles.size, 0)
        if (kind === 'sqlite-native') nativeChecks++
      })
    }
  }
  for (const mutation of ['missing-hash', 'stale-hash', 'foreign-session', 'foreign-request']) {
    await test(`json: UI candidate ${mutation} cannot bypass source/session validation`, async () => {
      const data = uiCandidateFixture()
      if (mutation === 'missing-hash') delete data.revisionVersions[0].sourceContentHash
      if (mutation === 'stale-hash') data.revisionVersions[0].sourceContentHash = hash('Old source.')
      if (mutation === 'foreign-session') data.revisionSessions[0].projectId = 'p2'
      if (mutation === 'foreign-request') data.revisionRequests[0].sessionId = 'foreign-session'
      const h = await harness('json', data)
      const before = await h.snapshot()
      await assert.rejects(h.call('previewRevisionCommit', { ...h.write, operationId: 'ui-preview', versionId: 'ui-version',
        expectedVersionHash: api.revisionFingerprint(before.data.revisionVersions[0]), expectedSourceHash: hash(body), expectedChapterHash: hash(body) }),
      /binding|source|project|foreign|正文/i)
      assert.deepEqual(await h.snapshot(), before)
      assert.equal(h.calls.length, 0)
    })
  }
  await test('json: known Agent candidate provenance still rejects job reassignment before preview', async () => {
    const h = await harness('json')
    const v = await h.generate(await h.request({ draftId: 'draft-p1' }))
    await h.edit((data) => {
      data.chapterGenerationJobs.push({ ...data.chapterGenerationJobs[0], id: 'replacement-job' })
      data.generatedChapterDrafts[0].jobId = 'replacement-job'
    })
    const before = await h.snapshot()
    await assert.rejects(h.preview(v), /source\/job binding changed/)
    assert.deepEqual(await h.snapshot(), before)
  })

  await test('seven strict descriptors are registered', () => {
    const names = ['getRevisionSessions', 'getRevisionVersion', 'createRevisionRequest', 'generateRevisionVersion', 'editRevisionVersion', 'previewRevisionCommit', 'applyApprovedRevisionCommit']
    for (const name of names) {
      const definition = api.AgentToolService.listTools().find((tool) => tool.name === `agent.${name}`)
      assert.ok(definition); assert.equal(definition.inputSchema.additionalProperties, false)
      assert.equal(api.buildNamedAgentToolCall({ name: definition.name }).name, definition.name)
    }
    const allNames = api.AgentToolService.listTools().map((tool) => tool.name)
    assert.equal(new Set(allNames).size, allNames.length)
  })
  await test('CLI named tools preserve null/boolean/text arguments and reject unknown names or non-object JSON', () => {
    const args = { projectId: 'p1', confirm: true, expectedChapterHash: null, body: '  Untrimmed text.\n' }
    const call = api.buildNamedAgentToolCall({ name: 'agent.editRevisionVersion', 'arguments-json': JSON.stringify(args), storage: 'explicit.json' })
    assert.deepEqual(call.arguments, { ...args, storagePath: 'explicit.json' })
    assert.throws(() => api.buildNamedAgentToolCall({ name: 'agent.unknown' }), /unknown/)
    assert.throws(() => api.buildNamedAgentToolCall({ name: 'agent.getRevisionSessions', 'arguments-json': '[]' }), /JSON object/)
  })
  for (const mode of ['chapter-global-role', 'draft-frozen-role', 'draft-frozen-base', 'draft-no-snapshot']) {
    await test(`revision configuration matches UI: ${mode}`, async () => {
      const data = fixture()
      data.settings.modelName = 'global-base'
      data.settings.pipelineModelRoles = { revision: { modelName: 'global-revision', temperature: 0.2, maxTokens: 2345 } }
      if (mode === 'draft-frozen-role' || mode === 'draft-frozen-base') {
        data.chapterGenerationJobs[0].aiRunConfig = { ...data.settings, schemaVersion: 1, modelName: 'frozen-base', temperature: 0.4, maxTokens: 4567,
          ...(mode === 'draft-frozen-role' ? { roles: { revision: { modelName: 'frozen-revision', temperature: 0.6, maxTokens: 6789 } } } : {}) }
      }
      const h = await harness('json', data)
      const draft = mode !== 'chapter-global-role'
      const req = await h.request(draft ? { draftId: 'draft-p1' } : {})
      const current = (await h.snapshot()).data
      const job = draft ? current.chapterGenerationJobs.find((item) => item.id === 'job-p1') : null
      const expected = api.resolvePipelineRoleSettings(job?.aiRunConfig, current.settings, 'revision')
      await h.generate(req)
      const actual = h.calls[0]
      for (const field of ['apiProvider', 'baseUrl', 'modelName', 'temperature', 'maxTokens', 'retryEnabled', 'maxRetries', 'requestTimeoutMs', 'codexCliPath', 'codexCliModel']) {
        assert.equal(actual.settings[field], expected[field], `${mode}: ${field}`)
      }
      assert.equal(actual.settings.modelName, mode === 'draft-frozen-role' ? 'frozen-revision' : mode === 'draft-frozen-base' ? 'frozen-base' : 'global-revision')
      assert.equal(actual.runId, draft ? 'job-p1' : 'run-p1')
      const decision = (await h.snapshot()).data.agentRuns[0].decisions.find((item) => item.step === 'generate_revision_version')
      assert.equal(api.revisionAudit(decision.evidence).aiRunId, actual.runId)
      assert.ok(api.revisionAudit(decision.evidence).modelConfigHash)
    })
  }

  for (const kind of ['json', 'sqlite-boundary']) {
    await test(`${kind}: request/generate/preview/commit and exact replay preserve later prose`, async () => {
      const h = await harness(kind)
      const before = await h.snapshot()
      const req = await h.request()
      const version = await h.generate(req)
      assert.equal(version.version.status, 'pending')
      assert.equal((await h.snapshot()).data.chapters[0].body, body)
      assert.equal(h.calls.length, 1)
      assert.equal((await h.generate(req)).replayed, true)
      assert.equal(h.calls.length, 1)
      assert.ok(!JSON.stringify(h.calls[0]).includes('FOREIGN_CONTEXT_MARKER'))
      const p = await h.preview(version)
      assert.equal(p.binding.actor.kind, 'agent')
      assert.equal((await h.snapshot()).data.revisionCommitBundles.length, 0)
      const accepted = await h.apply(p)
      assert.equal(accepted.formalCommit, true)
      const current = (await h.snapshot()).data
      const commit = current.revisionCommitBundles[0]
      assert.equal(commit.revisedBy, 'agent'); assert.equal(commit.chapterVersion.source, 'agent_revision')
      assert.deepEqual(commit.actor, { kind: 'agent', agentRunId: 'run-p1', actionPreviewId: p.preview.id })
      assert.equal(commit.beforeText, body); assert.equal(commit.afterText, body.replace(target, replacement))
      assert.equal(current.agentActionPreviews[0].status, 'applied')
      assert.equal(current.agentRuns[0].createdCommitIds.length, 1)
      assert.equal(current.revisionVersions[0].status, 'accepted')
      assert.deepEqual(current.characters, before.data.characters)
      assert.deepEqual(current.hardCanonPacks, before.data.hardCanonPacks)
      await h.edit((data) => { data.chapters[0].body = 'Later author edit.' })
      const replay = await h.apply(p)
      assert.equal(replay.replayed, true)
      assert.equal((await h.snapshot()).data.chapters[0].body, 'Later author edit.')
      assert.equal((await h.snapshot()).data.revisionCommitBundles.length, 1)
    })
    await test(`${kind}: project, AgentRun and draft/job isolation before a model call`, async () => {
      const h = await harness(kind)
      await assert.rejects(h.request({ agentRunId: 'run-p2' }), /AgentRun/)
      await assert.rejects(h.request({ draftId: 'draft-p2', chapterId: 'ch-p1' }), /draft/i)
      const req = await h.request()
      await assert.rejects(h.call('generateRevisionVersion', { ...h.write, projectId: 'p2', agentRunId: 'run-p2', operationId: 'foreign', requestId: req.requestId,
        expectedRequestHash: req.requestHash, ...h.sourceArgs(req.source) }), /project/)
      const version = await h.generate(req)
      await assert.rejects(h.call('getRevisionVersion', { projectId: 'p2', versionId: version.version.id }), /project/)
      const p = await h.preview(version)
      await assert.rejects(h.apply(p, { projectId: 'p2', agentRunId: 'run-p2' }), /project/)
      assert.equal(h.calls.length, 1)
    })
    await test(`${kind}: operation collision and source/hash confirmation are enforced`, async () => {
      const h = await harness(kind)
      const req = await h.request()
      assert.equal((await h.request()).replayed, true)
      await assert.rejects(h.request({ instruction: 'Different instruction.' }), /operationId/)
      await assert.rejects(h.generate(req, { expectedSourceHash: 'stale' }), /hash/)
      const p = await h.preview(await h.generate(req))
      await assert.rejects(h.apply(p, { confirm: false }), error => error.code === 'AGENT_AUTHORIZATION_REQUIRED')
      await assert.rejects(h.apply(p, { expectedPreviewHash: 'stale' }), /Confirm/)
      await assert.rejects(h.apply(p, { approvalToken: 'pretend-human' }), /Unsupported/)
      await h.edit((data) => { data.chapters[0].body += ' Changed.' })
      await assert.rejects(h.apply(p), /source|binding|正文/)
      assert.equal((await h.snapshot()).data.revisionCommitBundles.length, 0)
    })
    await test(`${kind}: a generated session ID cannot reuse a foreign project's session`, async () => {
      const data = fixture()
      data.revisionSessions.push({ id: 'agent-revision-request-session', projectId: 'p2', chapterId: 'ch-p2', sourceDraftId: null,
        status: 'active', createdAt: timestamp, updatedAt: timestamp })
      const h = await harness(kind, data)
      await assert.rejects(h.request(), /session ID collision/)
      assert.equal((await h.snapshot()).data.revisionRequests.length, 0)
      assert.equal(h.calls.length, 0)
    })
    await test(`${kind}: request provenance prevents same-project draft job reassignment before generation`, async () => {
      const h = await harness(kind)
      const req = await h.request({ draftId: 'draft-p1' })
      await h.edit((data) => {
        data.chapterGenerationJobs.push({ ...data.chapterGenerationJobs[0], id: 'replacement-job' })
        data.generatedChapterDrafts.find((item) => item.id === 'draft-p1').jobId = 'replacement-job'
      })
      await assert.rejects(h.generate(req), /source\/job binding changed/)
      assert.equal(h.calls.length, 0)
    })
    await test(`${kind}: explicit candidate edits preserve prior text and invalidate its preview`, async () => {
      const h = await harness(kind)
      const v = await h.generate(await h.request())
      const p = await h.preview(v)
      const edited = await h.call('editRevisionVersion', { ...h.write, operationId: 'edit', versionId: v.version.id, expectedVersionHash: v.versionHash,
        ...h.sourceArgs(v.currentSource), body: '  Explicit Agent edit.\n' })
      const full = await h.call('getRevisionVersion', { versionId: edited.version.id, detail: 'full' })
      assert.equal(full.version.body, '  Explicit Agent edit.\n')
      assert.equal((await h.snapshot()).data.revisionVersions.find((item) => item.id === v.version.id).status, 'superseded')
      await assert.rejects(h.apply(p), /active|changed/)
      await h.apply(await h.preview(edited, { operationId: 'edited-preview' }))
      assert.equal((await h.snapshot()).data.chapters[0].body, '  Explicit Agent edit.\n')
    })
    await test(`${kind}: failed AI returns no fabricated version; local broader response requires acknowledgement`, async () => {
      const h = await harness(kind)
      const req = await h.request({ targetRange: target })
      h.respond(async () => ({ ok: false, error: 'stub provider failed' }))
      await assert.rejects(h.generate(req), /stub provider failed/)
      assert.equal((await h.snapshot()).data.revisionVersions.length, 0)
      h.respond(async () => ({ ok: true, content: JSON.stringify({ revisedText: body.replace(target, replacement), changedSummary: '', risks: '', preservedFacts: '' }) }))
      const v = await h.generate(req)
      assert.equal(v.version.responseScope, 'broader_than_requested')
      const p = await h.preview(v)
      await assert.rejects(h.apply(p), /broader/)
      await h.apply(p, { acceptBroaderResponse: true })
      assert.equal((await h.snapshot()).data.chapters[0].body, body.replace(target, replacement))
    })
    await test(`${kind}: late AI response keeps original binding without overwriting newer source`, async () => {
      const h = await harness(kind)
      const hold = deferred(), started = deferred()
      const req = await h.request()
      h.respond(() => { started.resolve(); return hold.promise })
      const generating = h.generate(req)
      await started.promise
      await h.edit((data) => { data.chapters[0].body = 'New source while waiting.' })
      hold.resolve({ ok: true, content: JSON.stringify({ revisedText: 'Late generated candidate.', changedSummary: '', risks: '', preservedFacts: '' }) })
      const version = await generating
      assert.equal(version.stale, true)
      assert.equal(version.version.sourceContentHash, hash(body))
      await assert.rejects(h.preview(version), /source|正文/)
      assert.equal((await h.snapshot()).data.chapters[0].body, 'New source while waiting.')
    })
    await test(`${kind}: draft candidates retain draft/chapter binding and unlinked drafts cannot commit`, async () => {
      const initial = fixture(); initial.generatedChapterDrafts[0].chapterId = null
      const h = await harness(kind, initial)
      const source = (await h.call('getRevisionSessions', { draftId: 'draft-p1' })).currentSource
      const req = await h.call('createRevisionRequest', { ...h.write, operationId: 'draft-request', draftId: 'draft-p1', instruction: 'Revise draft.', ...h.sourceArgs(source) })
      const version = await h.generate(req)
      assert.equal(version.session.sourceDraftId, 'draft-p1')
      await assert.rejects(h.preview(version), /unlinked draft/)
      await h.edit((data) => { data.generatedChapterDrafts[0].chapterId = 'ch-p1' })
      await assert.rejects(h.call('getRevisionSessions', { chapterId: 'ch-p2', draftId: 'draft-p1' }), /project/)
      assert.equal((await h.call('getRevisionVersion', { versionId: version.version.id })).stale, true)
    })
    await test(`${kind}: archived and human-required previews cannot be overridden by Agent confirmation`, async () => {
      const h = await harness(kind)
      const p = await h.prepare()
      await h.edit((data) => { data.agentActionPreviews[0].requiresHumanApproval = true })
      await assert.rejects(h.apply(p), error => error.code === 'AGENT_AUTHORIZATION_REQUIRED')
      await h.edit((data) => { data.agentActionPreviews[0].requiresHumanApproval = false; data.chapters[0].archivedAt = timestamp })
      await assert.rejects(h.apply(p), /archived/)
      assert.equal((await h.snapshot()).data.revisionCommitBundles.length, 0)
    })
    await test(`${kind}: linked draft commits update only its bound draft and chapter`, async () => {
      const h = await harness(kind)
      const source = (await h.call('getRevisionSessions', { draftId: 'draft-p1' })).currentSource
      const req = await h.request({ draftId: 'draft-p1', ...h.sourceArgs(source) })
      const v = await h.generate(req)
      await h.apply(await h.preview(v))
      const data = (await h.snapshot()).data
      assert.equal(data.generatedChapterDrafts.find((draft) => draft.id === 'draft-p1').body, body.replace(target, replacement))
      assert.equal(data.generatedChapterDrafts.find((draft) => draft.id === 'draft-p2').body, body)
      assert.equal(data.chapters.find((chapter) => chapter.id === 'ch-p2').body, body)
    })
    for (const mutation of ['missing-draft', 'foreign-job', 'same-project-job', 'request-change', 'candidate-change']) {
      await test(`${kind}: ${mutation} after preview cannot change the approved source/version`, async () => {
        const h = await harness(kind)
        const req = await h.request({ draftId: 'draft-p1' })
        const p = await h.preview(await h.generate(req))
        await h.edit((data) => {
          if (mutation === 'missing-draft') data.generatedChapterDrafts = data.generatedChapterDrafts.filter((item) => item.id !== 'draft-p1')
          if (mutation === 'foreign-job') data.generatedChapterDrafts.find((item) => item.id === 'draft-p1').jobId = 'job-p2'
          if (mutation === 'same-project-job') {
            data.chapterGenerationJobs.push({ ...data.chapterGenerationJobs[0], id: 'replacement-job' })
            data.generatedChapterDrafts.find((item) => item.id === 'draft-p1').jobId = 'replacement-job'
          }
          if (mutation === 'request-change') data.revisionRequests[0].instruction = 'New instruction after preview.'
          if (mutation === 'candidate-change') data.revisionVersions[0].body = 'Edited after preview.'
        })
        await assert.rejects(h.apply(p), /missing|foreign|changed/)
        assert.equal((await h.snapshot()).data.revisionCommitBundles.length, 0)
      })
    }
    await test(`${kind}: concurrent write at the transaction boundary fails CAS without metadata changes`, async () => {
      const h = await harness(kind)
      const p = await h.prepare()
      const runtime = await api.loadAgentRuntimeData(h.paths)
      await h.edit((data) => { data.chapters[0].body = 'Concurrent author prose.' })
      await assert.rejects(api.applyApprovedAgentRevisionCommit(runtime.data, {
        projectId: 'p1', agentRunId: 'run-p1', previewId: p.preview.id, expectedPreviewHash: p.previewHash, confirm: true
      }, runtime))
      const data = (await h.snapshot()).data
      assert.equal(data.chapters[0].body, 'Concurrent author prose.')
      assert.equal(data.agentActionPreviews.find((preview) => preview.id === p.preview.id).status, 'pending')
    })
  }

  await test('json: metadata failure after formal commit recovers without rolling back later prose', async () => {
    const h = await harness('json')
    const p = await h.prepare()
    const original = api.JsonStorageService.prototype.saveIfCurrent
    api.JsonStorageService.prototype.saveIfCurrent = async function (data, expected) {
      if (data.agentActionPreviews.some((preview) => preview.id === p.preview.id && preview.status === 'applied')) throw new Error('Injected JSON metadata failure')
      return original.call(this, data, expected)
    }
    try { await assert.rejects(h.apply(p), /Injected JSON metadata failure/) }
    finally { api.JsonStorageService.prototype.saveIfCurrent = original }
    assert.equal((await h.snapshot()).data.revisionCommitBundles.length, 1)
    await h.edit((data) => { data.chapters[0].body = 'Later JSON prose.' })
    await h.apply(p)
    const data = (await h.snapshot()).data
    assert.equal(data.chapters[0].body, 'Later JSON prose.')
    assert.equal(data.agentActionPreviews[0].status, 'applied')
    assert.equal(data.revisionCommitBundles.length, 1)
  })
  await test('json: no API configuration cannot save the local fallback as generated prose', async () => {
    const data = fixture(); data.settings.apiProvider = 'openai'; data.settings.hasApiKey = false
    const previous = process.env.NOVEL_DIRECTOR_API_KEY
    delete process.env.NOVEL_DIRECTOR_API_KEY
    try {
      const h = await harness('json', data)
      await assert.rejects(h.generate(await h.request()), /fallback|did not generate/)
      assert.equal(h.calls.length, 0)
      assert.equal((await h.snapshot()).data.revisionVersions.length, 0)
    } finally { if (previous === undefined) delete process.env.NOVEL_DIRECTOR_API_KEY; else process.env.NOVEL_DIRECTOR_API_KEY = previous }
  })

  await test('sqlite-boundary: injected entity failure rolls back manuscript, versions, metadata and revision', async () => {
    const h = await harness('sqlite-boundary')
    const p = await h.prepare()
    const before = await h.snapshot()
    h.boundary.failEntity()
    await assert.rejects(h.apply(p), /Injected entity rollback/)
    assert.deepEqual(await h.snapshot(), before)
    await h.apply(p)
    assert.equal((await h.snapshot()).data.revisionCommitBundles.length, 1)
  })
  await test('sqlite-boundary: commit survives metadata failure; retry preserves intervening later prose', async () => {
    const h = await harness('sqlite-boundary')
    const p = await h.prepare()
    h.boundary.failMetadata()
    await assert.rejects(h.apply(p), /Injected metadata failure/)
    const partial = (await h.snapshot()).data
    assert.equal(partial.revisionCommitBundles.length, 1)
    assert.equal(partial.agentActionPreviews[0].status, 'pending')
    await h.edit((data) => { data.chapters[0].body = 'Later persisted prose.' })
    await h.apply(p)
    const current = (await h.snapshot()).data
    assert.equal(current.chapters[0].body, 'Later persisted prose.')
    assert.equal(current.agentActionPreviews[0].status, 'applied')
    assert.equal(current.agentRuns[0].decisions.filter((decision) => decision.step === 'apply_action_preview').length, 1)
  })
  for (const kind of ['json', ...(NativeDatabase ? ['sqlite-native'] : [])]) {
    await test(`${kind}: project grant replaces repetitive acknowledgement, records authority and revokes the next apply`, async () => {
      const h = await harness(kind)
      const p = await h.prepare()
      const authority = new api.AgentAuthorizationService(h.paths.userDataPath)
      const grant = await authority.grant({ storagePath: h.paths.storagePath, projectId: 'p1', actions: ['apply_revision'], chapterStart: 1, chapterEnd: 1 })
      const applied = await h.apply(p, { confirm: false })
      const bundle = (await h.snapshot()).data.revisionCommitBundles.find(item => item.revisionCommitId === applied.revisionCommitId)
      assert.equal(bundle.actor.authorizationGrantId, grant.id)
      await authority.revoke(grant.id, h.paths.storagePath, 'p1')
      assert.equal((await h.apply(p, { confirm: false })).replayed, true)
      const next = await h.request({ operationId: 'next-request' })
      const candidate = await h.generate(next, { operationId: 'next-generate' })
      const preview = await h.preview(candidate, { operationId: 'next-preview' })
      await assert.rejects(h.apply(preview, { confirm: false }), error => error.code === 'AGENT_AUTHORIZATION_REQUIRED')
      assert.equal((await h.snapshot()).data.revisionCommitBundles.length, 1)
    })
  }
  console.log(`Agent revision tools passed (${checks} focused checks; ${nativeChecks} real native SQLite check). JSON: real isolated files. SQLite fault injection: simulated I/O/rollback, separate from native. AI: real AIService with stub transport. No UI QA.`)
  console.log(nativeChecks ? `Native SQLite: Node ${process.version} ABI ${process.versions.modules}; real isolated file, reopened reads, direct SQL integrity check; all handles closed.` : `Native SQLite: SKIP (${nativeSkipReason}).`)
} finally {
  for (const handle of nativeHandles) { try { handle.close() } finally { nativeHandles.delete(handle) } }
  delete globalThis.__agentRevisionDatabases
  delete globalThis.__agentRevisionNativePaths
  delete globalThis.__agentRevisionNativeHandles
  delete globalThis.__agentRevisionAI
  const child = relative(tempRoot, outDir)
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Refusing cleanup outside the isolated fixture root.')
  await rm(outDir, { recursive: true, force: true })
}

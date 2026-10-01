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
const outDir = await mkdtemp(join(tempRoot, 'agent-candidate-undo-'))
const nativePaths = new Set(), handles = new Set()
globalThis.__candidateUndoNativePaths = nativePaths
globalThis.__candidateUndoHandles = handles
globalThis.fetch = async () => { throw new Error('Network forbidden in candidate undo fixtures.') }
const timestamp = '2026-09-06T10:00:00.000Z'
// Exercise provider-pattern redaction without checking in a token-shaped literal.
const secret = ['sk', 'test', 'undo', 'private', 'fixture', '123456'].join('-')
const fieldText = `Before/after TEST_FIXTURE_TEXT. ${'Event context. '.repeat(60)}FULL_FIELD_MARKER`
let checks = 0, nativeChecks = 0, fixtureId = 0, NativeDatabase, skipReason = ''
async function test(label, run) { await run(); checks++; console.log(`PASS ${label}`) }

try {
  if (process.versions.electron) throw new Error('Use Node, not Electron, for isolated undo fixtures.')
  try {
    const Database = createRequire(import.meta.url)('better-sqlite3')
    const probe = new Database(':memory:')
    try { assert.ok(probe.prepare('SELECT sqlite_version() AS version').get().version); NativeDatabase = Database }
    finally { probe.close() }
  } catch (error) {
    skipReason = `Node ${process.version} ABI ${process.versions.modules}: ${error.message ?? error}`
    if (process.argv.includes('--require-native')) throw new Error(`Required native SQLite unavailable: ${skipReason}`)
    console.log(`SKIP native SQLite: ${skipReason}. No rebuild or fallback.`)
  }
  const outfile = join(outDir, 'api.mjs')
  await build({
    stdin: { contents: `
      export { AgentToolService } from './src/agent/tools/AgentToolService';
      export { buildNamedAgentToolCall } from './src/agent/tools/agentCliToolCall';
      export { handleAgentWriteTool } from './src/agent/tools/agentToolWriteHandlers';
      export { handleAgentReadTool } from './src/agent/tools/agentToolReadHandlers';
      export { loadAgentRuntimeData, saveAgentRuntimeData, saveAgentCandidateDecision } from './src/agent/AgentRuntime';
      export { normalizeAppData } from './src/shared/defaults';
      export { previewCandidateDecisions, applyCandidateDecisionCommand } from './src/services/CandidateDecisionService';
      export { previewCandidateDecisionUndo } from './src/services/CandidateDecisionUndoService';
      export { JsonStorageService } from './src/storage/JsonStorageService';
      export { SqliteStorageService } from './src/storage/SqliteStorageService';
      export { createIdRemaps, rememberId, remapReferencesDeep } from './src/main/dataMerge/referenceRemapping';
      export { mergeAppData } from './src/main/DataMergeService';
    `, resolveDir: repoRoot, loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22',
    external: ['better-sqlite3', 'electron'], logLevel: 'silent',
    plugins: [{ name: 'candidate-undo-isolation', setup(builder) {
      builder.onResolve({ filter: /AgentPipelineExecutor$/ }, () => ({ path: 'ai', namespace: 'undo-fixture' }))
      builder.onResolve({ filter: /SqliteStorageService$/ }, () => ({ path: 'sqlite', namespace: 'undo-fixture' }))
      builder.onResolve({ filter: /^real-undo-sqlite$/ }, () => ({ path: join(repoRoot, 'src/storage/SqliteStorageService.ts') }))
      builder.onLoad({ filter: /.*/, namespace: 'undo-fixture' }, ({ path }) => ({ contents: path === 'ai' ? `
        export const executeAgentChapterPipeline = () => { throw new Error('AI forbidden'); };
        export const createHeadlessTransport = () => { throw new Error('AI forbidden'); };
      ` : `
        import { SqliteStorageService, loadSqliteSnapshotReadonly as readNative,
          loadSqliteCollectionsReadonly as readNativeCollections } from 'real-undo-sqlite';
        export { SqliteStorageService };
        function check(path) { if (!globalThis.__candidateUndoNativePaths.has(path)) throw new Error('Unregistered SQLite path forbidden: ' + path); }
        export const createStorageService = (path) => {
          check(path);
          const storage = new SqliteStorageService(path);
          globalThis.__candidateUndoHandles.add(storage);
          const close = storage.close.bind(storage);
          storage.close = () => { close(); globalThis.__candidateUndoHandles.delete(storage); };
          return storage;
        };
        export const loadSqliteSnapshotReadonly = (path) => { check(path); return readNative(path); };
        export const loadSqliteCollectionsReadonly = (path, collections) => { check(path); return readNativeCollections(path, collections); };
      `, loader: 'js' }))
    } }]
  })
  const api = await import(pathToFileURL(outfile).href)
  const copy = (value) => structuredClone(value)
  function fixture() {
    const data = api.normalizeAppData({
      projects: ['p1', 'p2'].map((id) => ({ id, name: id, createdAt: timestamp, updatedAt: timestamp })),
      chapters: [{ id: 'ch1', projectId: 'p1', order: 1, title: 'Fixture chapter', body: 'Fixture prose only.', createdAt: timestamp, updatedAt: timestamp }],
      chapterGenerationJobs: [{ id: 'job1', projectId: 'p1', targetChapterOrder: 1, status: 'completed', createdAt: timestamp, updatedAt: timestamp }],
      memoryUpdateCandidates: ['m1', 'm2', 'foreign'].map((id) => ({
        id, projectId: id === 'foreign' ? 'p2' : 'p1', jobId: 'job1', type: 'timeline_event', targetId: null,
        proposedPatch: { schemaVersion: 1, kind: 'timeline_event_create', summary: 'Fixture event.', warnings: [],
          event: { title: `Event ${id}`, result: fieldText, chapterOrder: 1 } },
        evidence: 'Fixture evidence.', confidence: 0.9, status: 'pending', createdAt: timestamp, updatedAt: timestamp
      })),
      agentRuns: ['p1', 'p2'].map((projectId) => ({ id: `run-${projectId}`, projectId, goal: 'Undo fixture', mode: 'single_chapter',
        safetyMode: 'conservative', status: 'running', targetChapterOrders: [1], decisions: [], createdJobIds: [], createdDraftIds: [],
        createdCommitIds: [], pendingHumanReviewItemIds: [], summary: '', warnings: [], startedAt: timestamp, updatedAt: timestamp, schemaVersion: 1 }))
    })
    return data
  }
  async function harness(kind = 'json', data = fixture()) {
    const dir = join(outDir, `fixture-${++fixtureId}`)
    await mkdir(dir)
    const storagePath = join(dir, kind === 'json' ? 'data.json' : 'data.sqlite')
    if (kind !== 'json') nativePaths.add(storagePath)
    const withStorage = async (fn) => {
      const storage = kind === 'json' ? new api.JsonStorageService(storagePath) : new api.SqliteStorageService(storagePath)
      if (kind !== 'json') handles.add(storage)
      try { return await fn(storage) } finally { storage.close?.(); handles.delete(storage) }
    }
    await withStorage((storage) => storage.save(data))
    const paths = { storagePath, userDataPath: dir }
    const call = (name, args = {}) => api.AgentToolService.callTool(api.buildNamedAgentToolCall({
      name: `agent.${name}`, 'arguments-json': JSON.stringify({ ...paths, projectId: 'p1', ...args })
    }))
    const snapshot = () => api.loadAgentRuntimeData(paths)
    const edit = (fn) => withStorage(async (storage) => {
      const current = await storage.loadSnapshot(); fn(current.data); await storage.saveIfCurrent(current.data, current.revision)
    })
    const decide = async (candidateId = 'm1', decision = 'accept', extra = {}) => {
      const p = await call('previewCandidateDecisions', { decisions: [{ kind: 'memory', candidateId, decision }] })
      return call('applyCandidateDecisions', { operationId: `decide-${candidateId}`, reason: 'Fixture decision.', agentRunId: 'run-p1',
        decisions: p.data.items.map(({ kind, candidateId, decision, expectedFingerprint }) => ({ kind, candidateId, decision, expectedFingerprint })), ...extra })
    }
    const preview = (receiptId = 'decide-m1', extra = {}) => call('previewCandidateDecisionUndo', { receiptId, ...extra })
    const undoArgs = (p, extra = {}) => ({ operationId: 'undo-m1', receiptId: p.data.receiptId, expectedFingerprint: p.data.expectedFingerprint,
      expectedRevision: p.storage.revision, confirm: true, agentRunId: 'run-p1', reason: 'Undo fixture decision.', ...extra })
    const undo = (p, extra = {}) => call('undoCandidateDecision', undoArgs(p, extra))
    return { paths, call, snapshot, edit, decide, preview, undo, undoArgs, withStorage }
  }

  await test('all three undo capabilities use strict CLI/MCP schemas and registered handlers', async () => {
    for (const name of ['getCandidateDecisionHistory', 'previewCandidateDecisionUndo', 'undoCandidateDecision']) {
      const tool = api.AgentToolService.listTools().find((item) => item.name === `agent.${name}`)
      assert.ok(tool); assert.equal(tool.inputSchema.additionalProperties, false)
      assert.equal(tool.riskLevel, name === 'undoCandidateDecision' ? 'write_commit' : 'read')
      assert.equal(tool.inputSchema.properties.actor, undefined)
      assert.equal(api.buildNamedAgentToolCall({ name: tool.name }).name, tool.name)
    }
    const h = await harness()
    await assert.rejects(h.call('getCandidateDecisionHistory', { offset: -1 }), /offset/)
    await assert.rejects(h.call('previewCandidateDecisionUndo', { receiptId: 'missing', detail: 'invalid' }))
    await assert.rejects(h.call('undoCandidateDecision', { actor: { kind: 'user' } }), /Unsupported/)
  })
  for (const kind of ['json', ...(NativeDatabase ? ['sqlite-native'] : [])]) {
    await test(`${kind}: own low-risk undo removes created records, refreshes Runtime and replays without overwriting later data`, async () => {
      const h = await harness(kind)
      await h.decide()
      const accepted = await h.snapshot()
      assert.equal(accepted.data.timelineEvents.length, 1)
      assert.ok(accepted.data.candidateDecisionReceipts[0].effects.length)
      const p = await h.preview()
      assert.equal(p.data.status, 'ready'); assert.equal(p.data.agentCanUndo, true)
      const runtime = await h.snapshot()
      const result = await api.handleAgentWriteTool('agent.undoCandidateDecision', { projectId: 'p1', ...h.undoArgs(p) }, runtime.data, runtime)
      assert.equal(result.payload.receipt.operation, 'undo')
      assert.equal(result.payload.receipt.undoesReceiptId, 'decide-m1')
      assert.equal(result.payload.receipt.actor.kind, 'agent')
      assert.equal(runtime.data.timelineEvents.length, 0)
      assert.equal(runtime.data.memoryUpdateCandidates[0].status, 'pending')
      assert.ok(result.payload.removedRecords.some((item) => item.collection === 'timelineEvents'))
      assert.deepEqual(runtime.data, (await h.snapshot()).data)
      await api.saveAgentRuntimeData({ ...runtime.data, projects: runtime.data.projects.map((item) => item.id === 'p1' ? { ...item, name: 'Later name' } : item) }, runtime)
      assert.equal((await h.snapshot()).data.timelineEvents.length, 0, 'Runtime must not resurrect removed records')
      await h.edit((data) => { data.chapters[0].body = 'Later author prose.' })
      const later = await h.snapshot()
      assert.equal((await h.undo(p)).data.replayed, true)
      assert.deepEqual(await h.snapshot(), later)
      assert.equal((await h.preview()).data.status, 'already_undone')
      assert.equal((await h.preview()).data.agentCanUndo, false)
      assert.equal(handles.size, 0)
      if (kind === 'sqlite-native') nativeChecks++
    })
    await test(`${kind}: read history/preview are compact, scoped, paginated and redact full snapshot values`, async () => {
      const h = await harness(kind)
      await h.decide(); await h.decide('m2', 'reject')
      const before = await h.snapshot()
      const compact = await h.call('getCandidateDecisionHistory', { limit: 1 })
      assert.equal(compact.data.total, 2); assert.equal(compact.data.nextOffset, 1)
      assert.equal(compact.data.receipts.length, 1)
      assert.ok(!JSON.stringify(compact.data).includes('FULL_FIELD_MARKER'))
      const full = await h.call('getCandidateDecisionHistory', { receiptId: 'decide-m1', detail: 'full' })
      assert.ok(JSON.stringify(full.data).includes('FULL_FIELD_MARKER')); assert.ok(!JSON.stringify(full.data).includes(secret))
      const page = await h.call('getCandidateDecisionHistory', { offset: 1, limit: 1 })
      assert.notEqual(page.data.receipts[0].id, compact.data.receipts[0].id)
      const p = await h.preview(), fullPreview = await h.preview('decide-m1', { detail: 'full' })
      assert.ok(p.data.items.every((item) => item.fields === undefined))
      assert.ok(fullPreview.data.items.some((item) => item.fields.length))
      assert.equal(p.data.expectedFingerprint, fullPreview.data.expectedFingerprint)
      assert.ok(JSON.stringify(fullPreview.data).includes('FULL_FIELD_MARKER'))
      assert.ok(!JSON.stringify(fullPreview.data).includes(secret))
      // Simulate a legacy snapshot only in memory; new writes must reject this target.
      const legacy = copy(before.data)
      legacy.timelineEvents[0].result += ` ${secret}`
      const effect = legacy.candidateDecisionReceipts.find((item) => item.id === 'decide-m1').effects.find((item) => item.collection === 'timelineEvents')
      effect.fields.find((field) => field.path[0] === 'result').after.value = legacy.timelineEvents[0].result
      const legacyBefore = copy(legacy)
      assert.ok(JSON.stringify(legacy).includes(secret), 'Redaction fixture must actually contain sensitive text')
      for (const [name, extra] of [['getCandidateDecisionHistory', {}], ['previewCandidateDecisionUndo', { receiptId: 'decide-m1' }]]) {
        const output = api.handleAgentReadTool(`agent.${name}`, { projectId: 'p1', detail: 'full', ...extra }, legacy)
        assert.equal(output.handled, true)
        assert.ok(!JSON.stringify(output.payload).includes(secret))
        assert.ok(JSON.stringify(output.payload).includes('[REDACTED]'))
        assert.ok(JSON.stringify(output.payload).includes('FULL_FIELD_MARKER'))
      }
      assert.deepEqual(legacy, legacyBefore, 'Reading legacy evidence must not rewrite it')
      assert.equal((await h.call('getCandidateDecisionHistory', { projectId: 'p2' })).data.total, 0)
      await assert.rejects(h.preview('decide-m1', { projectId: 'p2' }))
      assert.deepEqual(await h.snapshot(), before)
      if (kind === 'sqlite-native') nativeChecks++
    })
    await test(`${kind}: explicit confirmation, current fingerprint/revision and project/run binding are required`, async () => {
      const h = await harness(kind); await h.decide(); const p = await h.preview()
      for (const extra of [{ confirm: false }, { confirm: 'true' }, { confirm: undefined }, { expectedFingerprint: 'stale' },
        { expectedRevision: 'stale' }, { projectId: 'p2' }, { agentRunId: 'run-p2' }, { restoreChangedFields: 'true' },
        { confirmedHighRisk: true }, { approvalToken: 'pretend-user' }]) {
        const before = await h.snapshot()
        await assert.rejects(h.undo(p, extra))
        assert.deepEqual(await h.snapshot(), before)
      }
      await h.edit((data) => { data.timelineEvents[0].result = 'Later event edit.' })
      const current = await h.snapshot()
      await assert.rejects(h.undo(p, { expectedRevision: current.revision }))
      assert.deepEqual(await h.snapshot(), current)
      if (kind === 'sqlite-native') nativeChecks++
    })
    await test(`${kind}: operationId pins command fields; an already undone receipt cannot produce a second undo`, async () => {
      const h = await harness(kind); await h.decide(); const p = await h.preview(); await h.undo(p)
      for (const extra of [{ reason: 'Different reason.' }, { receiptId: 'other-receipt' }, { expectedFingerprint: 'other' },
        { decidedAt: '2026-09-07T10:00:00.000Z' }, { agentRunId: 'run-p2' }, { restoreChangedFields: true }]) {
        const before = await h.snapshot(); await assert.rejects(h.undo(p, extra)); assert.deepEqual(await h.snapshot(), before)
      }
      const before = await h.snapshot()
      const repeated = await h.undo(p, { operationId: 'second-undo', expectedRevision: before.revision })
      assert.equal(repeated.data.replayed, true); assert.equal(repeated.data.receipt.id, 'undo-m1')
      assert.deepEqual(await h.snapshot(), before)
      if (kind === 'sqlite-native') nativeChecks++
    })
    await test(`${kind}: field conflict requires fresh preview and explicit restore while unrelated prose stays intact`, async () => {
      const data = fixture(); data.chapters[0].summary = 'Original summary.'
      data.memoryUpdateCandidates[0].type = 'chapter_review'
      data.memoryUpdateCandidates[0].proposedPatch = { schemaVersion: 1, kind: 'chapter_review_update', summary: 'Review fixture.', warnings: [],
        targetChapterId: 'ch1', targetChapterOrder: 1, review: { summary: 'Accepted summary.' }, continuityBridgeSuggestion: null }
      const h = await harness(kind, data); await h.decide()
      await h.edit((current) => { current.chapters[0].body = 'Later unrelated prose.'; current.chapters[0].title = 'Later title.' })
      const ready = await h.preview(); assert.equal(ready.data.status, 'ready')
      await h.edit((current) => { current.chapters[0].summary = 'Later summary.' })
      const conflict = await h.preview('decide-m1', { detail: 'full' })
      assert.equal(conflict.data.status, 'conflict'); assert.equal(conflict.data.canRestoreConflicts, true)
      assert.ok(conflict.data.items.some((item) => item.fields.some((field) => field.conflicted)))
      const before = await h.snapshot()
      await assert.rejects(h.undo(conflict), (error) => error.code === 'CANDIDATE_UNDO_CONFLICT')
      await assert.rejects(h.undo(ready, { expectedRevision: before.revision, restoreChangedFields: true }), (error) => error.code === 'CANDIDATE_PREVIEW_STALE')
      assert.deepEqual(await h.snapshot(), before)
      await h.undo(conflict, { restoreChangedFields: true })
      const restored = await h.snapshot()
      assert.equal(restored.data.chapters[0].summary, 'Original summary.')
      assert.equal(restored.data.chapters[0].body, 'Later unrelated prose.')
      assert.equal(restored.data.chapters[0].title, 'Later title.')
      assert.equal((await h.undo(conflict, { restoreChangedFields: true })).data.replayed, true)
      assert.deepEqual(await h.snapshot(), restored)
      if (kind === 'sqlite-native') nativeChecks++
    })
    await test(`${kind}: low-risk state undo deactivates facts, retains ledger history and creates one compensation`, async () => {
      const data = fixture()
      data.characters.push({ id: 'c1', projectId: 'p1', name: 'Fixture character', createdAt: timestamp, updatedAt: timestamp })
      data.characterStateChangeCandidates.push({ id: 's1', projectId: 'p1', jobId: 'job1', characterId: 'c1', chapterId: 'ch1', chapterOrder: 1,
        candidateType: 'create_fact', targetFactId: null, proposedFact: { id: 'fact-s1', projectId: 'p1', characterId: 'c1', category: 'knowledge',
          key: 'fixture-knowledge', label: 'Fixture state', valueType: 'text', value: 'Known', unit: '', linkedCardFields: [], trackingLevel: 'hard',
          promptPolicy: 'when_relevant', status: 'active', sourceChapterId: 'ch1', sourceChapterOrder: 1, evidence: 'Fixture evidence.', confidence: 0.9,
          createdAt: timestamp, updatedAt: timestamp }, proposedTransaction: null, beforeValue: null, afterValue: 'Known', evidence: 'Fixture evidence.',
        confidence: 0.9, riskLevel: 'low', status: 'pending', createdAt: timestamp, updatedAt: timestamp })
      const h = await harness(kind, data)
      const selected = await h.call('previewCandidateDecisions', { decisions: [{ kind: 'character_state', candidateId: 's1', decision: 'accept' }] })
      await h.call('applyCandidateDecisions', { operationId: 'decide-m1', reason: 'Fixture state decision.', agentRunId: 'run-p1',
        decisions: selected.data.items.map(({ kind, candidateId, decision, expectedFingerprint }) => ({ kind, candidateId, decision, expectedFingerprint })) })
      const accepted = await h.snapshot(); const p = await h.preview(); await h.undo(p)
      const undone = await h.snapshot()
      assert.equal(undone.data.characterStateFacts[0].status, 'inactive')
      assert.equal(undone.data.characterStateChangeCandidates[0].status, 'pending')
      assert.equal(undone.data.characterStateTransactions.length, accepted.data.characterStateTransactions.length + 1)
      for (const record of accepted.data.characterStateTransactions) assert.deepEqual(undone.data.characterStateTransactions.find((item) => item.id === record.id), record)
      assert.equal((await h.undo(p)).data.replayed, true)
      assert.deepEqual(await h.snapshot(), undone)
      if (kind === 'sqlite-native') nativeChecks++
    })
    await test(`${kind}: Runtime does not reauthorize high-risk undo through client flags or stale cached data`, async () => {
      const data = fixture(); data.memoryUpdateCandidates[0].proposedPatch.warnings = ['High-risk fixture event.']
      const h = await harness(kind, data)
      await h.withStorage(async (storage) => {
        const snapshot = await storage.loadSnapshot()
        const p = api.previewCandidateDecisions(snapshot.data, { projectId: 'p1', decisions: [{ kind: 'memory', candidateId: 'm1', decision: 'accept' }] })
        await storage.executeCandidateDecision({ id: 'decide-m1', projectId: 'p1', actor: { kind: 'user' }, reason: 'Fixture human path.',
          decidedAt: timestamp, schemaVersion: 1, decisions: p.items, confirmedHighRisk: true }, snapshot.revision)
      })
      const p = await h.preview()
      assert.equal(p.data.requiresConfirmation, true); assert.equal(p.data.authorization, 'human_required'); assert.equal(p.data.agentCanUndo, false)
      const before = await h.snapshot()
      await assert.rejects(h.undo(p), (error) => error.code === 'AGENT_CANDIDATE_AUTHORIZATION_REQUIRED')
      const runtime = await h.snapshot()
      runtime.data.candidateDecisionReceipts[0].effects = []
      await assert.rejects(api.saveAgentCandidateDecision({ id: 'direct-undo', projectId: 'p1', actor: { kind: 'agent' }, reason: 'Cannot fake human.',
        decidedAt: timestamp, schemaVersion: 1, decisions: [], confirmedHighRisk: true,
        undo: { receiptId: 'decide-m1', expectedFingerprint: p.data.expectedFingerprint } }, runtime, runtime.revision),
      (error) => error.code === 'AGENT_CANDIDATE_AUTHORIZATION_REQUIRED')
      assert.deepEqual(await h.snapshot(), before)
      await h.withStorage((storage) => storage.executeCandidateDecision({ id: 'human-undo', projectId: 'p1', actor: { kind: 'user' },
        reason: 'Fixture trusted human undo.', decidedAt: timestamp, schemaVersion: 1, decisions: [], confirmedHighRisk: true,
        undo: { receiptId: p.data.receiptId, expectedFingerprint: p.data.expectedFingerprint } }, before.revision))
      const undone = await h.snapshot()
      const replay = await h.undo(p, { expectedRevision: undone.revision })
      assert.equal(replay.data.replayed, true); assert.equal(replay.data.receipt.id, 'human-undo')
      assert.equal(replay.data.receipt.actor.kind, 'user', 'Returning an existing receipt must not relabel its actor')
      assert.deepEqual(await h.snapshot(), undone, 'Already undone high-risk decisions are no-op, not new Agent permission')
      if (kind === 'sqlite-native') nativeChecks++
    })
    await test(`${kind}: sensitive candidate targets fail atomically instead of saving redacted replacement prose`, async () => {
      const data = fixture(); data.memoryUpdateCandidates[0].proposedPatch.event.result += ` ${secret}`
      const h = await harness(kind, data)
      const before = await h.snapshot()
      await assert.rejects(h.decide(), (error) => /target contains sensitive data/.test(error.message) && !error.message.includes(secret))
      assert.deepEqual(await h.snapshot(), before)
      assert.equal(before.data.timelineEvents.length, 0)
      assert.equal(before.data.candidateDecisionReceipts.length, 0)
      assert.equal(before.data.memoryUpdateCandidates[0].status, 'pending')
      if (kind === 'sqlite-native') nativeChecks++
    })
    await test(`${kind}: live references prevent deletion and legacy journal titles are redacted in errors`, async () => {
      const h = await harness(kind); await h.decide()
      await h.edit((current) => {
        // Seed only historical metadata, never accept a sensitive live target.
        current.candidateDecisionReceipts[0].effects.find((effect) => effect.collection === 'timelineEvents').title = `Legacy title ${secret}`
        current.hardCanonPacks.find((pack) => pack.projectId === 'p1').items.push({ id: 'dependent-canon', projectId: 'p1',
          category: 'timeline_anchor', title: 'Fixture dependent', content: 'Keep this event.', priority: 'must', status: 'active',
          relatedTimelineEventIds: [current.timelineEvents[0].id], createdAt: timestamp, updatedAt: timestamp })
      })
      const p = await h.preview('decide-m1', { detail: 'full' })
      assert.equal(p.data.status, 'unavailable'); assert.equal(p.data.agentCanUndo, false)
      assert.ok(!JSON.stringify(p.data).includes(secret))
      assert.ok(JSON.stringify(p.data).includes('[REDACTED]'))
      const before = await h.snapshot()
      await assert.rejects(h.undo(p, { restoreChangedFields: true }), (error) =>
        error.code === 'CANDIDATE_UNDO_UNAVAILABLE' && !error.message.includes(secret))
      assert.deepEqual(await h.snapshot(), before)
      if (kind === 'sqlite-native') nativeChecks++
    })
    await test(`${kind}: missing legacy effects are unavailable, not reconstructed from current records`, async () => {
      const h = await harness(kind); await h.decide()
      await h.edit((data) => { delete data.candidateDecisionReceipts[0].effects })
      const p = await h.preview(); assert.equal(p.data.status, 'unavailable'); assert.equal(p.data.agentCanUndo, false)
      const before = await h.snapshot(); await assert.rejects(h.undo(p)); assert.deepEqual(await h.snapshot(), before)
      if (kind === 'sqlite-native') nativeChecks++
    })
  }

  await test('remapped imports disable undo effects and remap receipt links without guessing historical IDs', async () => {
    const h = await harness(); await h.decide(); const accepted = (await h.snapshot()).data
    const receipt = accepted.candidateDecisionReceipts[0]
    const identity = api.createIdRemaps(); api.rememberId(identity, 'projects', 'p1', 'p1')
    assert.deepEqual(api.remapReferencesDeep(receipt, identity), receipt)
    for (const [collection, oldId, newId] of [['projects', 'p1', 'imported-p1'], ['timelineEvents', accepted.timelineEvents[0].id, 'imported-event'],
      ['characters', 'historical-path-character', 'new-character']]) {
      const maps = api.createIdRemaps(); api.rememberId(maps, collection, oldId, newId)
      assert.equal(api.remapReferencesDeep(receipt, maps).effects, undefined)
    }
    const maps = api.createIdRemaps()
    api.rememberId(maps, 'candidateDecisionReceipts', receipt.id, 'remapped-receipt')
    api.rememberId(maps, 'chapters', receipt.id, 'ambiguous-chapter')
    assert.equal(api.remapReferencesDeep({ undoesReceiptId: receipt.id }, maps).undoesReceiptId, 'remapped-receipt')
    const target = fixture(); target.projects[0].name = 'Existing different project'
    const targetBefore = copy(target)
    const merged = api.mergeAppData(accepted, target, { sourcePath: 'isolated-source', targetPath: 'isolated-target' }).mergedData
    const imported = merged.candidateDecisionReceipts.find((item) => item.id === receipt.id || item.reason === receipt.reason)
    assert.ok(imported); assert.equal(imported.effects, undefined)
    assert.equal(api.previewCandidateDecisionUndo(merged, { projectId: imported.projectId, receiptId: imported.id }).status, 'unavailable')
    assert.deepEqual(target, targetBefore); assert.ok(receipt.effects.length)
  })
  if (NativeDatabase) {
    await test('sqlite-native: injected DELETE failure rolls back undo receipt, fields, removed rows and revision', async () => {
      const h = await harness('sqlite-native'); await h.decide(); const p = await h.preview()
      assert.equal((await readFile(h.paths.storagePath)).subarray(0, 16).toString(), 'SQLite format 3\0')
      const db = new NativeDatabase(h.paths.storagePath)
      try { db.exec("CREATE TRIGGER fail_undo_delete BEFORE DELETE ON entities WHEN OLD.collection = 'timelineEvents' BEGIN SELECT RAISE(ABORT, 'Injected undo delete failure'); END") }
      finally { db.close() }
      const before = await h.snapshot()
      await assert.rejects(h.undo(p), /Injected undo delete failure/)
      assert.deepEqual(await h.snapshot(), before)
      const repair = new NativeDatabase(h.paths.storagePath)
      try { repair.exec('DROP TRIGGER fail_undo_delete') } finally { repair.close() }
      await h.undo(p)
      assert.equal((await h.snapshot()).data.timelineEvents.length, 0)
      assert.equal(handles.size, 0)
      nativeChecks++
    })
  }
  console.log(`Agent candidate undo passed (${checks} checks; ${nativeChecks} real native SQLite checks). JSON: real isolated files. AI/UI: not called.`)
  console.log(NativeDatabase ? `Native Node ${process.version} ABI ${process.versions.modules}; all handles closed.` : `Native SKIP: ${skipReason}`)
} finally {
  for (const handle of handles) { try { handle.close() } finally { handles.delete(handle) } }
  delete globalThis.__candidateUndoNativePaths
  delete globalThis.__candidateUndoHandles
  const child = relative(tempRoot, outDir)
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Refusing cleanup outside isolated fixture root.')
  await rm(outDir, { recursive: true, force: true })
}

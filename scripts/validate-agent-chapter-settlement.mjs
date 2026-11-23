#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const tmp = join(repoRoot, 'tmp')
await mkdir(tmp, { recursive: true })
const parent = await realpath(tmp)
const root = await mkdtemp(join(parent, 'agent-settlement-'))
const time = '2026-09-07T12:00:00.000Z'
const dates = { createdAt: time, updatedAt: time }
const projectId = 'test-project'
const body = 'Lin opened the envelope with her bandaged hand and read the reply.'
const oldBody = 'Lin waited for the letter.'
const finalTitle = 'The reply'
const acceptDraft = 'accept_draft'
const acceptHigh = 'accept_high_risk_candidates'
const memory = (candidateId, decision = 'accept') => ({ kind: 'memory', candidateId, decision })
const high = { kind: 'character_state', candidateId: 'injury', decision: 'accept' }

async function loadApi() {
  const file = join(root, 'api.mjs')
  await build({ stdin: { resolveDir: repoRoot, contents: `
    export { AgentToolService } from './src/agent/tools/AgentToolService'
    export { AgentAuthorizationService } from './src/main/services/AgentAuthorizationService'
    export { JsonStorageService } from './src/storage/JsonStorageService'
    export { SqliteStorageService } from './src/storage/SqliteStorageService'
    export { normalizeAppData } from './src/shared/defaults'
    export { draftContentHash } from './src/services/DraftDiagnosticBindingService'
  ` }, outfile: file, bundle: true, platform: 'node', format: 'esm', target: 'node22',
    external: ['better-sqlite3', 'electron'], logLevel: 'silent' })
  return import(pathToFileURL(file).href)
}

function fixture(api) {
  const orders = [2, 3]
  const binding = n => ({
    projectId, jobId: `job-${n}`, sourceDraftId: `draft-${n}`,
    sourceDraftContentHash: api.draftContentHash(n === 2 ? body : 'Lin returned home.')
  })
  const event = (id, n) => ({
    id, ...binding(n), type: 'timeline_event', status: 'pending', targetId: null,
    evidence: n === 2 ? body : 'Lin returned home.', confidence: 0.95, ...dates,
    proposedPatch: { kind: 'timeline_event_create', schemaVersion: 1, summary: id, warnings: [],
      event: { title: id, chapterOrder: n, result: id } }
  })
  return api.normalizeAppData({
    projects: [{ id: projectId, name: 'Settlement fixture', ...dates }],
    chapters: orders.map(n => ({ id: `chapter-${n}`, projectId, order: n, title: `Old ${n}`, body: oldBody, ...dates })),
    characters: [{ id: 'lin', projectId, name: 'Lin', ...dates }],
    agentRuns: [{ id: 'run', projectId, goal: 'Review chapter two', createdJobIds: ['job-2'], createdDraftIds: ['draft-2'],
      targetChapterOrders: [2], status: 'running', startedAt: time, updatedAt: time }],
    chapterGenerationJobs: orders.map(n => ({ id: `job-${n}`, projectId, targetChapterOrder: n, status: 'completed', ...dates })),
    generatedChapterDrafts: orders.map(n => ({ id: `draft-${n}`, projectId, jobId: `job-${n}`, chapterId: `chapter-${n}`,
      status: 'draft', title: `Draft ${n}`, body: n === 2 ? body : 'Lin returned home.', ...dates })),
    qualityGateReports: orders.map(n => ({ id: `report-${n}`, projectId, jobId: `job-${n}`, draftId: `draft-${n}`,
      chapterId: `chapter-${n}`, draftContentHash: binding(n).sourceDraftContentHash, pass: true, overallScore: 96, ...dates })),
    editorialVerdicts: [{ id: 'editorial-2', projectId, jobId: 'job-2', draftId: 'draft-2', status: 'approved',
      draftContentHash: binding(2).sourceDraftContentHash, draftRevision: time, sourceRefs: { qualityGateReportId: 'report-2' },
      summary: 'The evidence supports the chapter.', ...dates }],
    memoryUpdateCandidates: [event('reply', 2), event('declined', 2), event('omitted', 2), event('other-chapter', 3)],
    characterStateChangeCandidates: [{ id: 'injury', ...binding(2), chapterId: 'chapter-2', chapterOrder: 2,
      characterId: 'lin', candidateType: 'create_fact', status: 'pending', riskLevel: 'high', evidence: body, confidence: 0.95,
      proposedFact: { id: 'injured-hand', projectId, characterId: 'lin', category: 'physical', key: 'hand',
        label: 'Hand injury', valueType: 'text', value: 'Bandaged', trackingLevel: 'hard', ...dates }, ...dates }]
  })
}

let checks = 0
async function withBook(api, backend, label, run) {
  const userDataPath = await mkdtemp(join(root, backend + '-'))
  const storagePath = join(userDataPath, 'fixture.' + backend)
  const storage = backend === 'json' ? new api.JsonStorageService(storagePath) : new api.SqliteStorageService(storagePath)
  const authority = new api.AgentAuthorizationService(userDataPath)
  const call = async (name, args) => {
    const result = await api.AgentToolService.callTool({ name: 'agent.' + name, arguments: { ...args, projectId, userDataPath, storagePath } })
    assert.equal(result.storage.source, backend)
    assert.equal(result.storage.storagePath, storagePath)
    return result.data
  }
  const preview = (decisions, extra = {}) => call('previewChapterSettlement', {
    agentRunId: 'run', jobId: 'job-2', draftId: 'draft-2', operationId: 'settle-2',
    reason: 'Reviewed the chapter and selected the supported changes.', decisions, ...extra
  })
  try {
    await storage.save(fixture(api))
    await run({ call, preview, storagePath,
      apply: (p, hash = p.previewHash) => call('applyChapterSettlement', { previewId: p.previewId, expectedPreviewHash: hash }),
      grant: (actions, first = 2, last = 2) => authority.grant({ projectId, storagePath, actions, chapterStart: first, chapterEnd: last }),
      revoke: g => authority.revoke(g.id, storagePath, projectId),
      read: () => storage.loadSnapshot(),
      edit: async change => {
        const snapshot = await storage.loadSnapshot()
        change(snapshot.data)
        await storage.saveIfCurrent(snapshot.data, snapshot.revision)
      }
    })
    checks++
    console.log(`  ok - ${backend}: ${label}`)
  } catch (error) {
    console.error(`  FAIL - ${backend}: ${label}`)
    throw error
  } finally { storage.close?.() }
}

const find = (rows, id) => {
  const row = rows.find(item => item.id === id)
  assert.ok(row, `Missing fixture row: ${id}`)
  return row
}

async function unchangedAfterRejection(h, run, expected) {
  const before = await h.read()
  await assert.rejects(run, expected)
  assert.deepEqual(await h.read(), before, 'A rejected request changed persisted data or revision')
}

function assertCommitted(data, result, title) {
  assert.equal(result.replayed, false)
  assert.equal(result.chapterId, 'chapter-2')
  assert.ok(typeof result.commitId === 'string' && result.commitId.length)
  const chapter = find(data.chapters, result.chapterId)
  assert.equal(chapter.body, body)
  assert.equal(chapter.title, title)
  assert.equal(find(data.generatedChapterDrafts, 'draft-2').status, 'accepted')
  assert.equal(data.chapterCommitBundles.length, 1)
  const [bundle] = data.chapterCommitBundles
  assert.equal(bundle.commitId, result.commitId)
  assert.equal(bundle.acceptanceReview.mode, 'reviewed')
  assert.equal(bundle.acceptanceReview.qualityGateReportId, 'report-2')
  assert.equal(bundle.acceptanceReview.editorialVerdictId, 'editorial-2')
  const versions = data.chapterVersions.filter(v => v.linkedChapterCommitId === result.commitId)
  assert.equal(versions.length, 1)
  assert.equal(versions[0].body, body)
  assert.equal(versions[0].title, title)
  assert.ok(data.chapterVersions.some(v => v.chapterId === chapter.id && v.body === oldBody))
}

function assertReceipt(data, result, decisions) {
  assert.ok(typeof result.candidateReceiptId === 'string' && result.candidateReceiptId.length)
  assert.equal(data.candidateDecisionReceipts.length, 1)
  const receipt = find(data.candidateDecisionReceipts, result.candidateReceiptId)
  const pairs = items => items.map(i => [i.kind, i.candidateId, i.decision]).sort(([a, b], [c, d]) => a.localeCompare(c) || b.localeCompare(d))
  assert.deepEqual(pairs(receipt.decisions), pairs(decisions))
}

// Fail writes on either side: this catches two separate transactions in either order.
async function interruptApply(h, p, collection) {
  if (!collection) {
    const path = h.storagePath + '.tmp'
    await mkdir(path)
    try { await unchangedAfterRejection(h, () => h.apply(p), /EISDIR|EPERM|EACCES/) }
    finally { await rmdir(path) }
    return
  }
  const db = new Database(h.storagePath, { fileMustExist: true })
  try {
    db.exec(`CREATE TRIGGER stop_settlement BEFORE INSERT ON entities WHEN NEW.collection = '${collection}'
      BEGIN SELECT RAISE(ABORT, 'settlement fixture fault'); END;`)
    await unchangedAfterRejection(h, () => h.apply(p), /settlement fixture fault/)
    db.exec('DROP TRIGGER stop_settlement')
  } finally { db.close() }
}

try {
  const api = await loadApi()
  const backends = ['json', 'sqlite']
  for (const backend of backends) {
    await withBook(api, backend, 'fixture has reviewed prose and independently classified low/high-risk candidates', async h => {
      const low = await h.call('previewCandidateDecisions', { decisions: [memory('reply'), memory('other-chapter')] })
      assert.equal(low.requiresConfirmation, false)
      const risky = await h.call('previewCandidateDecisions', { decisions: [high] })
      assert.equal(risky.requiresConfirmation, true)
      const reviewed = await h.call('previewChapterAcceptance', { agentRunId: 'run', jobId: 'job-2', draftId: 'draft-2',
        mode: 'reviewed', operationId: 'fixture-control', reason: 'Check review binding.' })
      assert.equal(reviewed.review.qualityStatus, 'passed')
    })
  }
  const descriptors = api.AgentToolService.listTools()
  for (const name of ['previewChapterSettlement', 'applyChapterSettlement']) {
    assert.ok(descriptors.some(t => t.name === 'agent.' + name), `MCP tool not registered: agent.${name}`)
  }
  for (const backend of backends) {
    const test = (label, run) => withBook(api, backend, label, run)

    await test('low risk: draft grant suffices; amendment, rejection, omitted candidates and replay', async h => {
      const decisions = [{ ...memory('reply'), amendment: { kind: 'memory', patch: { kind: 'timeline_event_create',
        event: { title: 'The sealed reply' } } } }, memory('declined', 'reject')]
      const grant = await h.grant([acceptDraft])
      const before = (await h.read()).data
      const p = await h.preview(decisions)
      for (const key of ['previewId', 'previewHash']) assert.ok(typeof p[key] === 'string' && p[key].length, key)
      assert.deepEqual(p.candidatePreview.items.map(i => i.candidateId).sort(), ['declined', 'reply'])
      const afterPreview = (await h.read()).data
      for (const key of ['chapters', 'chapterVersions', 'generatedChapterDrafts', 'chapterCommitBundles',
        'memoryUpdateCandidates', 'characterStateChangeCandidates', 'candidateDecisionReceipts', 'timelineEvents'])
        assert.deepEqual(afterPreview[key], before[key], `Preview changed ${key}`)
      await unchangedAfterRejection(h, () => h.apply(p, p.previewHash + '-wrong'))
      await h.revoke(grant)
      await unchangedAfterRejection(h, () => h.apply(p), { code: 'AGENT_AUTHORIZATION_REQUIRED' })
      await h.grant([acceptDraft])
      const r = await h.apply(p)
      const { data } = await h.read()
      assertCommitted(data, r, 'Draft 2')
      assertReceipt(data, r, decisions)
      assert.deepEqual(data.timelineEvents.map(e => e.title), ['The sealed reply'])
      assert.equal(find(data.memoryUpdateCandidates, 'reply').status, 'accepted')
      assert.equal(find(data.memoryUpdateCandidates, 'declined').status, 'rejected')
      for (const id of ['omitted', 'other-chapter']) assert.equal(find(data.memoryUpdateCandidates, id).status, 'pending')
      assert.equal(find(data.characterStateChangeCandidates, 'injury').status, 'pending')
      assert.equal(data.characterStateFacts.length, 0)
      assert.deepEqual(find(data.chapters, 'chapter-3'), find(before.chapters, 'chapter-3'))

      await h.edit(d => { find(d.chapters, r.chapterId).body = 'Later author edit.' })
      const edited = await h.read()
      const replay = await h.apply(p)
      assert.equal(replay.replayed, true)
      for (const key of ['commitId', 'chapterId', 'candidateReceiptId']) assert.equal(replay[key], r[key])
      assert.deepEqual(await h.read(), edited, 'Replay rewrote an author edit, duplicated effects or advanced revision')
    })

    await test('high risk: both permissions must cover the target chapter at apply time', async h => {
      const decisions = [memory('reply'), high]
      const valid = await h.grant([acceptDraft, acceptHigh])
      const p = await h.preview(decisions)
      await h.revoke(valid)
      for (const actions of [[acceptDraft], [acceptHigh]]) {
        const insufficient = await h.grant(actions)
        await unchangedAfterRejection(h, () => h.apply(p), { code: 'AGENT_AUTHORIZATION_REQUIRED' })
        await h.revoke(insufficient)
      }
      await h.grant([acceptDraft, acceptHigh], 3, 3)
      await unchangedAfterRejection(h, () => h.apply(p), { code: 'AGENT_AUTHORIZATION_REQUIRED' })
      await h.grant([acceptDraft, acceptHigh])
      const r = await h.apply(p)
      const { data } = await h.read()
      assertCommitted(data, r, 'Draft 2')
      assertReceipt(data, r, decisions)
      assert.equal(find(data.characterStateChangeCandidates, 'injury').status, 'accepted')
      assert.deepEqual(data.characterStateFacts.map(f => f.value), ['Bandaged'])
      assert.equal(data.timelineEvents.length, 1)
    })

    await test('empty decisions commit only the reviewed chapter; final title requires chapter management', async h => {
      await h.grant([acceptDraft])
      const p = await h.preview([], { finalTitle })
      await unchangedAfterRejection(h, () => h.apply(p), { code: 'AGENT_AUTHORIZATION_REQUIRED' })
      await h.grant([acceptDraft, 'manage_chapters'])
      const r = await h.apply(p)
      const { data } = await h.read()
      assertCommitted(data, r, finalTitle)
      assert.equal(r.candidateReceiptId, null)
      assert.equal(data.candidateDecisionReceipts.length, 0)
      assert.ok([...data.memoryUpdateCandidates, ...data.characterStateChangeCandidates].every(c => c.status === 'pending'))
      assert.equal(data.timelineEvents.length + data.characterStateFacts.length, 0)
    })

    await test('missing current review cannot be overridden by an unreviewed-draft grant', async h => {
      await h.grant([acceptDraft, 'accept_unreviewed_draft', acceptHigh])
      await h.edit(d => { find(d.qualityGateReports, 'report-2').draftContentHash = 'previous-body-hash' })
      await unchangedAfterRejection(h, () => h.preview([]))
    })

    await test('valid candidate from another chapter of the same project cannot be selected', async h => {
      await h.grant([acceptDraft, acceptHigh], 2, 3)
      for (const decision of ['accept', 'reject']) {
        await unchangedAfterRejection(h, () => h.preview([memory('reply'), memory('other-chapter', decision)]))
      }
    })

    await test('a candidate extracted from this draft may not write to another chapter', async h => {
      await h.grant([acceptDraft, acceptHigh], 2, 3)
      await h.edit(d => { find(d.memoryUpdateCandidates, 'reply').proposedPatch.event.chapterOrder = 3 })
      await unchangedAfterRejection(h, () => h.preview([memory('reply')]))
    })

    for (const [field, decisions, change] of [
      ['selected candidate', [memory('reply')], d => { find(d.memoryUpdateCandidates, 'reply').evidence += ' Corrected evidence.' }],
      ['draft body', [], d => { find(d.generatedChapterDrafts, 'draft-2').body += ' She put it away.' }],
      ['current draft ID even with identical prose', [], d => { d.generatedChapterDrafts.push({
        ...find(d.generatedChapterDrafts, 'draft-2'), id: 'newer-draft', updatedAt: '2030-01-01T00:00:00.000Z' }) }],
      ['existing quality report content', [], d => { find(d.qualityGateReports, 'report-2').overallScore = 95 }],
      ['existing editorial verdict content', [], d => { find(d.editorialVerdicts, 'editorial-2').summary = 'Revised editorial assessment.' }],
      ['current quality report ID', [], d => { d.qualityGateReports.push({ ...find(d.qualityGateReports, 'report-2'),
        id: 'replacement-report', createdAt: '2026-09-08T12:00:00.000Z' }) }]
    ]) {
      await test(`a change to ${field} invalidates a previously valid preview`, async h => {
        await h.grant([acceptDraft])
        const p = await h.preview(decisions)
        await h.edit(change)
        await unchangedAfterRejection(h, () => h.apply(p))
      })
    }

    for (const collection of backend === 'sqlite' ? ['chapterCommitBundles', 'candidateDecisionReceipts'] : [null]) {
      await test(`atomic rollback and retry at ${collection ?? 'JSON file replacement'}`, async h => {
        await h.grant([acceptDraft])
        const decisions = [memory('reply')]
        const p = await h.preview(decisions)
        await interruptApply(h, p, collection)
        const r = await h.apply(p)
        const { data } = await h.read()
        assertCommitted(data, r, 'Draft 2')
        assertReceipt(data, r, decisions)
        assert.equal(data.timelineEvents.length, 1)
      })
    }
  }
  console.log(`Chapter settlement: ${checks} integration checks passed.`)
} finally {
  const target = await realpath(root)
  assert.equal(dirname(target), parent, 'Refusing cleanup outside the test workspace')
  await rm(target, { recursive: true, force: true })
}

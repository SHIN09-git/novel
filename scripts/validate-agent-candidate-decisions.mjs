#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const tempRoot = join(repoRoot, 'tmp')
await mkdir(tempRoot, { recursive: true })
const outDir = await mkdtemp(join(tempRoot, 'agent-candidate-decisions-'))
const timestamp = '2026-09-06T10:00:00.000Z'
let checks = 0
async function test(label, run) {
  await run()
  checks++
  console.log(`  ok - ${label}`)
}

try {
  const outfile = join(outDir, 'api.mjs')
  await build({
    stdin: {
      contents: `
        export { AgentToolService } from './src/agent/tools/AgentToolService';
        export { loadAgentRuntimeData, saveAgentRuntimeData } from './src/agent/AgentRuntime';
        export { handleAgentWriteTool } from './src/agent/tools/agentToolWriteHandlers';
        export { normalizeAppData } from './src/shared/defaults';
        export { createStorageService } from './src/storage/SqliteStorageService';
        export { JsonStorageService } from './src/storage/JsonStorageService';
      `,
      resolveDir: repoRoot, loader: 'ts'
    },
    outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22',
    external: ['better-sqlite3', 'electron'], logLevel: 'silent'
  })
  const { AgentToolService, loadAgentRuntimeData, saveAgentRuntimeData, handleAgentWriteTool, normalizeAppData, createStorageService, JsonStorageService } = await import(pathToFileURL(outfile).href)
  const evidence = `A verified event. ${'Evidence context. '.repeat(70)}END_OF_EVIDENCE`
  function memory(id, overrides = {}) {
    return {
      id, projectId: 'p1', jobId: 'job1', type: 'timeline_event', targetId: null,
      proposedPatch: {
        schemaVersion: 1, kind: 'timeline_event_create', summary: 'Record the event.', warnings: [],
        event: { title: `Event ${id}`, result: 'The message arrived.', chapterOrder: 1 }
      },
      evidence, confidence: 0.9, status: 'pending', createdAt: timestamp, updatedAt: timestamp,
      ...overrides
    }
  }
  function state(id, overrides = {}) {
    return {
      id, projectId: 'p1', jobId: 'job1', characterId: 'c1', chapterId: 'ch1', chapterOrder: 1,
      candidateType: 'create_fact', targetFactId: null,
      proposedFact: {
        id: `fact-${id}`, projectId: 'p1', characterId: 'c1', category: 'knowledge', key: `knowledge-${id}`,
        label: 'Message', valueType: 'text', value: 'Understood', unit: '', linkedCardFields: [],
        trackingLevel: 'hard', promptPolicy: 'when_relevant', status: 'active',
        sourceChapterId: 'ch1', sourceChapterOrder: 1, evidence, confidence: 0.9,
        createdAt: timestamp, updatedAt: timestamp
      },
      proposedTransaction: null, beforeValue: null, afterValue: 'Understood', evidence, confidence: 0.9,
      riskLevel: 'low', status: 'pending', createdAt: timestamp, updatedAt: timestamp,
      ...overrides
    }
  }
  function fixture() {
    return normalizeAppData({
      projects: ['p1', 'p2'].map((id) => ({ id, name: id, createdAt: timestamp, updatedAt: timestamp })),
      chapters: [{ id: 'ch1', projectId: 'p1', order: 1, title: 'Chapter', body: 'The message arrived.', createdAt: timestamp, updatedAt: timestamp }],
      characters: [{ id: 'c1', projectId: 'p1', name: 'Test Character', createdAt: timestamp, updatedAt: timestamp }],
      chapterGenerationJobs: [{ id: 'job1', projectId: 'p1', targetChapterOrder: 1, status: 'completed', createdAt: timestamp, updatedAt: timestamp }],
      memoryUpdateCandidates: [memory('m1'), memory('m2', { evidence: 'Another event.' }), memory('foreign', { projectId: 'p2' })],
      characterStateChangeCandidates: [state('s1'), state('high', { riskLevel: 'high', evidence: 'A high risk change.' })]
    })
  }
  let counter = 0
  async function harness(data = fixture(), sqlite = false) {
    const dir = join(outDir, `fixture-${++counter}`)
    await mkdir(dir)
    const storagePath = join(dir, sqlite ? 'data.sqlite' : 'data.json')
    if (sqlite) {
      const storage = createStorageService(storagePath)
      try { await storage.save(data) } finally { storage.close?.() }
    } else {
      await writeFile(storagePath, JSON.stringify(data), 'utf8')
    }
    const paths = { storagePath, userDataPath: dir }
    const call = (name, args = {}) => AgentToolService.callTool({ name: `agent.${name}`, arguments: { ...paths, projectId: 'p1', ...args } })
    const snapshot = () => loadAgentRuntimeData(paths)
    const preview = (decisions) => call('previewCandidateDecisions', { decisions })
    const apply = (previewResult, extra = {}) => call('applyCandidateDecisions', {
      operationId: 'op1', reason: 'Reviewed source evidence.',
      decisions: previewResult.data.items.map(({ kind, candidateId, decision, amendment, expectedFingerprint }) => ({
        kind, candidateId, decision, expectedFingerprint, ...(amendment ? { amendment } : {})
      })),
      ...extra
    })
    const withStorage = async (run) => {
      const storage = sqlite ? createStorageService(storagePath) : new JsonStorageService(storagePath)
      try { return await run(storage) } finally { storage.close?.() }
    }
    const edit = (change) => withStorage(async (storage) => {
      const current = await storage.loadSnapshot()
      change(current.data)
      await storage.saveIfCurrent(current.data, current.revision)
    })
    return { paths, call, snapshot, preview, apply, withStorage, edit }
  }
  const select = (kind, candidateId, decision = 'accept') => ({ kind, candidateId, decision })
  const memoryAmendment = {
    kind: 'memory',
    patch: {
      kind: 'timeline_event_create',
      summary: 'Amended event summary.',
      event: { title: 'Amended event', result: 'The amended message arrived.' }
    }
  }
  const stateAmendment = {
    kind: 'character_state',
    label: 'Confirmed message',
    category: 'knowledge',
    targetValue: 'Confirmed',
    linkedCardFields: ['futureHooks']
  }
  const mixed = [select('memory', 'm1'), select('character_state', 's1', 'reject')]
  const commandFor = (p, extra = {}) => ({
    id: 'op1', projectId: 'p1', actor: { kind: 'agent' }, reason: 'Reviewed source evidence.',
    decidedAt: timestamp, schemaVersion: 1, confirmedHighRisk: false,
    decisions: p.data.items.map(({ kind, candidateId, decision, amendment, expectedFingerprint }) => ({
      kind, candidateId, decision, expectedFingerprint, ...(amendment ? { amendment } : {})
    })),
    ...extra
  })

  await test('MCP descriptors expose strict candidate schemas and read-only previews', async () => {
    const tools = AgentToolService.listTools()
    for (const name of ['getDecisionInbox', 'previewCandidateDecisions', 'applyCandidateDecisions']) {
      const tool = tools.find((item) => item.name === `agent.${name}`)
      assert.ok(tool)
      assert.equal(tool.riskLevel, name === 'applyCandidateDecisions' ? 'write_commit' : 'read')
      assert.equal(tool.inputSchema.additionalProperties, false)
      assert.equal(tool.inputSchema.properties.actor, undefined)
    }
    const apply = tools.find((item) => item.name === 'agent.applyCandidateDecisions')
    assert.ok(apply.inputSchema.properties.decisions.items.required.includes('expectedFingerprint'))
  })
  await test('inbox uses shared event grouping, compact defaults, full detail and pagination without writes', async () => {
    const h = await harness()
    const before = await readFile(h.paths.storagePath, 'utf8')
    const compact = await h.call('getDecisionInbox')
    const group = compact.data.groups.find((item) => item.memoryCandidateIds.includes('m1'))
    assert.ok(group.characterStateCandidateIds.includes('s1'))
    assert.equal(group.candidates, undefined)
    assert.ok(!JSON.stringify(compact.data).includes('END_OF_EVIDENCE'))
    assert.ok(!JSON.stringify(compact.data).includes('foreign'))
    const full = await h.call('getDecisionInbox', { detail: 'full' })
    assert.ok(JSON.stringify(full.data).includes('END_OF_EVIDENCE'))
    assert.ok(full.data.groups.some((item) => item.candidates.length === 2))
    const page = await h.call('getDecisionInbox', { limit: 1 })
    assert.equal(page.data.groups.length, 1)
    assert.equal(page.data.nextOffset, 1)
    const next = await h.call('getDecisionInbox', { limit: 1, offset: 1 })
    assert.notEqual(next.data.groups[0].id, page.data.groups[0].id)
    const preview = await h.preview(mixed)
    assert.ok(preview.data.items.every((item) => item.expectedFingerprint))
    assert.equal(preview.storage.revision, compact.storage.revision)
    assert.equal(await readFile(h.paths.storagePath, 'utf8'), before)
  })
  await test('mixed decisions persist through storage; omitted timestamp is stable across fresh-request retry', async () => {
    const h = await harness()
    const p = await h.preview(mixed)
    const applied = await h.apply(p, { expectedRevision: p.storage.revision })
    assert.equal(applied.data.replayed, false)
    assert.equal(applied.data.receipt.actor.kind, 'agent')
    assert.equal(applied.data.changes, undefined)
    const saved = await h.snapshot()
    assert.equal(saved.data.memoryUpdateCandidates.find((item) => item.id === 'm1').status, 'accepted')
    assert.equal(saved.data.characterStateChangeCandidates.find((item) => item.id === 's1').status, 'rejected')
    assert.equal(saved.data.timelineEvents.length, 1)
    const replay = await h.apply(p, { expectedRevision: p.storage.revision })
    assert.equal(replay.data.replayed, true)
    assert.equal(replay.data.receipt.decidedAt, applied.data.receipt.decidedAt)
    assert.equal(replay.storage.revision, applied.storage.revision)
    assert.deepEqual((await h.snapshot()).data, saved.data)
    await assert.rejects(h.apply(p, { reason: 'Changed reason.' }))
    await assert.rejects(h.apply(p, { decidedAt: '2026-09-07T10:00:00.000Z' }))
    await assert.rejects(h.apply(p, { operationId: 'new-op' }))
  })
  await test('caller-fixed timestamps and runtime delta merge preserve unrelated records', async () => {
    const h = await harness()
    const p = await h.preview(mixed)
    const runtime = await h.snapshot()
    const args = {
      projectId: 'p1', operationId: 'fixed-op', reason: 'Fixed time.', decidedAt: timestamp,
      decisions: p.data.items.map(({ kind, candidateId, decision, expectedFingerprint }) => ({ kind, candidateId, decision, expectedFingerprint }))
    }
    const result = await handleAgentWriteTool('agent.applyCandidateDecisions', args, runtime.data, runtime)
    assert.equal(result.payload.receipt.decidedAt, timestamp)
    assert.equal(runtime.data.projects.length, 2)
    assert.equal(runtime.data.memoryUpdateCandidates.length, 3)
    assert.equal(runtime.data.characterStateChangeCandidates.length, 2)
    assert.equal(runtime.data.candidateDecisionReceipts.length, 1)
    assert.deepEqual(runtime.data, (await h.snapshot()).data)
    const replay = await h.call('applyCandidateDecisions', args)
    assert.equal(replay.data.replayed, true)
  })
  await test('high-risk acceptance fails closed for every client acknowledgement in JSON and SQLite', async () => {
    for (const sqlite of [false, true]) {
      const data = fixture()
      data.memoryUpdateCandidates.find((item) => item.id === 'm2').proposedPatch.warnings = ['High-risk memory change.']
      const h = await harness(data, sqlite)
      const p = await h.preview([select('memory', 'm1'), select('character_state', 'high')])
      const memoryPreview = await h.preview([select('memory', 'm2')])
      const amendedHighPreview = await h.preview([{ ...select('character_state', 'high'), amendment: stateAmendment }])
      assert.equal(memoryPreview.data.agentCanApply, false)
      assert.equal(p.data.requiresConfirmation, true)
      assert.equal(p.data.agentCanApply, false)
      assert.equal(p.data.authorization, 'human_required')
      assert.equal(amendedHighPreview.data.requiresConfirmation, true)
      assert.equal(amendedHighPreview.data.agentCanApply, false)
      const before = await h.snapshot()
      for (const approval of [{}, { confirmedHighRisk: true }, { confirm: true }, { approvalToken: 'reviewed-by-human' }]) {
        await assert.rejects(h.apply(p, approval), (error) => error.code === 'AGENT_CANDIDATE_AUTHORIZATION_REQUIRED')
        await assert.rejects(h.apply(memoryPreview, approval), (error) => error.code === 'AGENT_CANDIDATE_AUTHORIZATION_REQUIRED')
        await assert.rejects(h.apply(amendedHighPreview, approval), (error) => error.code === 'AGENT_CANDIDATE_AUTHORIZATION_REQUIRED')
        assert.deepEqual(await h.snapshot(), before)
      }
      const rejection = await h.preview([select('character_state', 'high', 'reject')])
      assert.equal(rejection.data.requiresConfirmation, false)
      await h.apply(rejection)
    }
  })
  await test('acknowledgements remain command-stable for permitted low-risk decisions', async () => {
    for (const approval of [{ confirm: true }, { approvalToken: 'reviewed-by-human' }]) {
      const h = await harness()
      const p = await h.preview([select('character_state', 's1')])
      const applied = await h.apply(p, approval)
      assert.equal(applied.data.receipt.actor.kind, 'agent')
      assert.equal((await h.snapshot()).data.characterStateFacts.length, 1)
      assert.equal((await h.apply(p, approval)).data.replayed, true)
    }
  })
  await test('amendments use the shared union, alter the preview fingerprint, and replay stably', async () => {
    const tools = AgentToolService.listTools()
    const previewTool = tools.find((item) => item.name === 'agent.previewCandidateDecisions')
    const applyTool = tools.find((item) => item.name === 'agent.applyCandidateDecisions')
    assert.ok(previewTool.inputSchema.properties.decisions.items.properties.amendment.oneOf)
    assert.ok(applyTool.inputSchema.properties.decisions.items.properties.amendment.oneOf)
    const memoryBranch = previewTool.inputSchema.properties.decisions.items.properties.amendment.oneOf
      .find((branch) => branch.properties.kind.enum.includes('memory'))
    assert.deepEqual(memoryBranch.properties.patch.oneOf.map((patch) => patch.properties.kind.enum[0]), [
      'chapter_review_update', 'character_state_update', 'foreshadowing_create',
      'foreshadowing_status_update', 'stage_summary_create', 'timeline_event_create'
    ])
    const stateBranch = previewTool.inputSchema.properties.decisions.items.properties.amendment.oneOf
      .find((branch) => branch.properties.kind.enum.includes('character_state'))
    assert.deepEqual(Object.keys(stateBranch.properties).sort(), ['category', 'kind', 'label', 'linkedCardFields', 'targetValue'].sort())
    const stagePatch = memoryBranch.properties.patch.oneOf
      .find((patch) => patch.properties.kind.enum.includes('stage_summary_create'))
    assert.deepEqual(Object.keys(stagePatch.properties.stageSummary.properties).sort(), [
      'compressedPlotSummary', 'irreversibleChanges', 'endingCarryoverState', 'emotionalAftertaste', 'pacingState'
    ].sort())
    for (const legacyField of [
      'coveredChapterRange', 'plotProgress', 'characterRelations', 'secrets',
      'foreshadowingPlanted', 'foreshadowingResolved', 'unresolvedQuestions', 'nextStageDirection'
    ]) assert.equal(stagePatch.properties.stageSummary.properties[legacyField], undefined)

    const h = await harness()
    const plain = await h.preview([select('memory', 'm1')])
    const amended = await h.preview([
      { ...select('memory', 'm1'), amendment: memoryAmendment },
      { ...select('character_state', 's1'), amendment: stateAmendment }
    ])
    assert.equal(amended.data.items[0].amendment.patch.event.title, 'Amended event')
    assert.equal(amended.data.items[1].amendment.targetValue, 'Confirmed')
    assert.equal(amended.data.items[0].amendmentPreview.before.patch.event.title, 'Event m1')
    assert.equal(amended.data.items[0].amendmentPreview.after.patch.event.title, 'Amended event')
    assert.equal(amended.data.items[1].amendmentPreview.before.targetValue, 'Understood')
    assert.equal(amended.data.items[1].amendmentPreview.after.targetValue, 'Confirmed')
    assert.notEqual(amended.data.items[0].expectedFingerprint, plain.data.items[0].expectedFingerprint)
    const applied = await h.apply(amended, { decidedAt: timestamp })
    assert.equal(applied.data.replayed, false)
    assert.deepEqual(applied.data.receipt.decisions[0].amendment, memoryAmendment)
    assert.equal(applied.data.receipt.amendments.length, 2)
    assert.equal(applied.data.receipt.amendments[1].after.targetValue, 'Confirmed')
    const saved = await h.snapshot()
    assert.equal(saved.data.memoryUpdateCandidates.find((item) => item.id === 'm1').proposedPatch.event.title, 'Amended event')
    assert.equal(saved.data.characterStateChangeCandidates.find((item) => item.id === 's1').proposedFact.value, 'Confirmed')
    assert.equal((await h.apply(amended, { decidedAt: timestamp })).data.replayed, true)

    const stageData = fixture()
    stageData.memoryUpdateCandidates.push(memory('stage-1', {
      type: 'stage_summary',
      proposedPatch: {
        schemaVersion: 1, kind: 'stage_summary_create', summary: 'Original stage summary.', warnings: [],
        stageSummary: { compressedPlotSummary: 'Original compressed plot.', plotProgress: 'Legacy plot progress.' }
      }
    }))
    const stageHarness = await harness(stageData)
    const stageAmendment = {
      kind: 'memory', patch: {
        kind: 'stage_summary_create', stageSummary: { compressedPlotSummary: 'Amended compressed plot.' }
      }
    }
    const stagePreview = await stageHarness.preview([{ ...select('memory', 'stage-1'), amendment: stageAmendment }])
    assert.equal(stagePreview.data.items[0].amendmentPreview.after.patch.stageSummary.compressedPlotSummary, 'Amended compressed plot.')
    for (const legacyField of [
      'coveredChapterRange', 'plotProgress', 'characterRelations', 'secrets',
      'foreshadowingPlanted', 'foreshadowingResolved', 'unresolvedQuestions', 'nextStageDirection'
    ]) {
      await assert.rejects(stageHarness.preview([{
        ...select('memory', 'stage-1'),
        amendment: { ...stageAmendment, patch: { ...stageAmendment.patch, stageSummary: { [legacyField]: 'Do not edit legacy.' } } }
      }]))
    }
  })
  await test('amendments redact for display, refuse credential persistence and retain clean long values/replay', async () => {
    const data = fixture()
    const secret = 'fixture-private-credential-987654321'
    const providerKey = ['sk', 'proj', 'ABCDEFGHIJKLMNOP'].join('-')
    const bearer = 'fixture-bearer-secret'
    const longText = 'Long amendment value that must remain intact. '.repeat(20)
    data.settings.apiKey = secret
    const amendment = {
      kind: 'memory',
      patch: {
        kind: 'timeline_event_create',
        summary: `${longText}${secret} ${providerKey} api_key=provider-format-key Authorization: Bearer ${bearer}`,
        event: { title: longText, participantCharacterIds: ['c1'], result: longText, downstreamImpact: 'A long downstream impact.' }
      }
    }
    const h = await harness(data)
    const preview = await h.call('previewCandidateDecisions', {
      detail: 'compact', maxChars: 8,
      decisions: [{ ...select('memory', 'm1'), amendment }]
    })
    const item = preview.data.items[0]
    assert.equal(preview.data.amendmentRedacted, true)
    const previewText = JSON.stringify(preview.data)
    for (const value of [secret, providerKey, 'provider-format-key', bearer]) assert.ok(!previewText.includes(value))
    assert.equal(item.amendment.patch.event.title, longText)
    assert.ok(item.amendment.patch.summary.length > 8)
    assert.ok(Array.isArray(item.amendment.patch.event.participantCharacterIds))
    assert.ok(item.amendmentPreview.after.patch.event.title.length <= 11)
    await assert.rejects(h.call('applyCandidateDecisions', {
      operationId: 'redacted-amendment-op', reason: 'Do not apply a redacted payload.',
      decisions: [{ kind: item.kind, candidateId: item.candidateId, decision: item.decision,
        amendment: item.amendment, expectedFingerprint: item.expectedFingerprint }]
    }), (error) => error.code === 'CANDIDATE_PREVIEW_STALE')

    const rawApply = {
      operationId: 'long-amendment-op', reason: `Reviewed the original authorized amendment. ${secret}`, decidedAt: timestamp,
      decisions: [{ kind: 'memory', candidateId: 'm1', decision: 'accept', amendment, expectedFingerprint: item.expectedFingerprint }]
    }
    const beforeRejectedWrite = await h.snapshot()
    await assert.rejects(h.call('applyCandidateDecisions', rawApply), (error) => {
      for (const value of [secret, providerKey, 'provider-format-key', bearer]) assert.ok(!error.message.includes(value))
      return /sensitive data/.test(error.message)
    })
    assert.deepEqual(await h.snapshot(), beforeRejectedWrite)
    const cleanAmendment = { ...amendment, patch: { ...amendment.patch, summary: longText } }
    const cleanPreview = await h.preview([{ ...select('memory', 'm1'), amendment: cleanAmendment }])
    const cleanApply = { ...rawApply, decisions: [{ ...rawApply.decisions[0], amendment: cleanAmendment,
      expectedFingerprint: cleanPreview.data.items[0].expectedFingerprint }] }
    const applied = await h.call('applyCandidateDecisions', cleanApply)
    assert.equal(applied.data.amendmentRedacted, undefined)
    const appliedText = JSON.stringify(applied.data)
    for (const value of [secret, providerKey, 'provider-format-key', bearer]) assert.ok(!appliedText.includes(value))
    assert.equal(applied.data.receipt.decisions[0].amendment.patch.event.title, longText)
    assert.ok(Array.isArray(applied.data.receipt.decisions[0].amendment.patch.event.participantCharacterIds))
    const saved = await h.snapshot()
    assert.equal(saved.data.memoryUpdateCandidates.find((candidate) => candidate.id === 'm1').proposedPatch.event.title, longText)
    assert.equal(saved.data.memoryUpdateCandidates.find((candidate) => candidate.id === 'm1').proposedPatch.summary, longText)
    assert.ok(!JSON.stringify(saved.data.candidateDecisionReceipts).includes(secret))
    const replay = await h.call('applyCandidateDecisions', cleanApply)
    assert.equal(replay.data.replayed, true)
    assert.equal(replay.data.amendmentRedacted, undefined)
  })
  await test('compact previews preserve clean executable amendments and typed state values', async () => {
    const longText = 'A precise author amendment that must not be shortened. '.repeat(20)
    const h = await harness()
    const preview = await h.call('previewCandidateDecisions', {
      detail: 'compact', maxChars: 8,
      decisions: [{ ...select('memory', 'm1'), amendment: {
        kind: 'memory', patch: { kind: 'timeline_event_create', event: { title: longText, result: longText } }
      } }]
    })
    assert.equal(preview.data.amendmentRedacted, undefined)
    assert.equal(preview.data.items[0].amendment.patch.event.title, longText)
    const applied = await h.apply(preview)
    assert.equal(applied.data.receipt.decisions[0].amendment.patch.event.title, longText)
    assert.equal((await h.snapshot()).data.timelineEvents[0].result, longText)
    assert.equal((await h.apply(preview)).data.replayed, true)

    for (const [valueType, before, after] of [
      ['number', 10000, 5000], ['boolean', false, true], ['list', ['Old key'], ['Black key', 'Map']]
    ]) {
      const data = fixture()
      const candidate = data.characterStateChangeCandidates.find((item) => item.id === 's1')
      candidate.proposedFact.valueType = valueType
      candidate.proposedFact.value = before
      candidate.afterValue = before
      const typed = await harness(data)
      const p = await typed.call('previewCandidateDecisions', {
        detail: 'compact', maxChars: 8,
        decisions: [{ ...select('character_state', 's1'), amendment: {
          kind: 'character_state', targetValue: after,
          linkedCardFields: ['abilitiesAndResources', 'weaknessAndCost']
        } }]
      })
      const item = p.data.items[0]
      assert.deepEqual(item.amendment.targetValue, after)
      assert.deepEqual(item.amendmentPreview.after.linkedCardFields, ['abilitiesAndResources', 'weaknessAndCost'])
      await typed.apply(p)
      assert.deepEqual((await typed.snapshot()).data.characterStateFacts[0].value, after)
    }
  })
  await test('amendment parsing is strict and cannot add authorization or cross candidate kinds', async () => {
    const h = await harness()
    const invalid = [
      { ...select('memory', 'm1'), amendment: { ...memoryAmendment, extra: true } },
      { ...select('memory', 'm1'), amendment: { kind: 'memory', patch: { ...memoryAmendment.patch, event: { title: 'x', unknown: true } } } },
      { ...select('character_state', 's1'), amendment: { ...stateAmendment, targetValue: { invalid: true } } },
      { ...select('character_state', 's1'), amendment: { ...stateAmendment, linkedCardFields: ['unknown'] } },
      { ...select('character_state', 's1', 'reject'), amendment: stateAmendment },
      { ...select('character_state', 's1'), amendment: memoryAmendment }
    ]
    for (const decision of invalid) await assert.rejects(h.preview([decision]))
    assert.equal((await h.snapshot()).data.candidateDecisionReceipts.length, 0)
  })
  await test('agent run attribution is project-bound and cannot change under a reused operation ID', async () => {
    const data = fixture()
    data.agentRuns = ['p1', 'p2'].map((projectId) => ({
      id: `run-${projectId}`, projectId, goal: 'Test', mode: 'single_chapter', safetyMode: 'conservative',
      targetChapterOrders: [1], status: 'completed', createdJobIds: [], createdDraftIds: [], createdCommitIds: [],
      pendingHumanReviewItemIds: [], decisions: [], summary: '', warnings: [],
      startedAt: timestamp, updatedAt: timestamp, schemaVersion: 1
    }))
    const h = await harness(data)
    const p = await h.preview(mixed)
    await assert.rejects(h.apply(p, { agentRunId: 'run-p2' }))
    const applied = await h.apply(p, { agentRunId: 'run-p1' })
    assert.deepEqual(applied.data.receipt.actor, { kind: 'agent', agentRunId: 'run-p1' })
    await assert.rejects(h.apply(p))
    const replay = await h.apply(p, { agentRunId: 'run-p1' })
    assert.equal(replay.data.replayed, true)
    await h.edit((data) => { data.agentRuns = [] })
    const afterRunRemoval = await h.snapshot()
    assert.equal((await h.apply(p, { agentRunId: 'run-p1' })).data.replayed, true)
    await assert.rejects(h.apply(p, { agentRunId: 'run-p2' }), (error) => error.code === 'CANDIDATE_COMMAND_CONFLICT')
    assert.deepEqual(await h.snapshot(), afterRunRemoval)
  })
  await test('malformed arguments, identity injection, foreign candidates and duplicate selections fail without writes', async () => {
    const h = await harness()
    const p = await h.preview(mixed)
    const before = await readFile(h.paths.storagePath, 'utf8')
    for (const decisions of [[], null, [select('invalid', 'm1')], [select('memory', 'm1', 'delete')], [select('memory', 'foreign')], [select('memory', 'm1'), select('memory', 'm1')]]) {
      await assert.rejects(h.preview(decisions))
    }
    for (const args of [
      { actor: { kind: 'user' } }, { agentRunId: 'missing-run' }, { confirmedHighRisk: 'true' },
      { operationId: '' }, { reason: '' }, { expectedRevision: 1 }, { decidedAt: 'not-a-date' },
      { decisions: mixed }, { decisions: [{ ...p.data.items[0], actor: { kind: 'user' } }] }
    ]) await assert.rejects(h.apply(p, args))
    await assert.rejects(h.call('getDecisionInbox', { offset: -1 }))
    await assert.rejects(h.call('getDecisionInbox', { detail: 'invalid' }))
    assert.equal(await readFile(h.paths.storagePath, 'utf8'), before)
  })
  await test('explicit expectedRevision is never replaced by the latest loaded revision', async () => {
    const h = await harness()
    const p = await h.preview(mixed)
    await assert.rejects(h.apply(p, { expectedRevision: ` ${p.storage.revision} ` }), (error) => error.code === 'STORAGE_REVISION_CONFLICT')
    const changed = (await h.snapshot()).data
    changed.projects[1].name = 'Concurrent unrelated edit'
    await writeFile(h.paths.storagePath, JSON.stringify(changed), 'utf8')
    await assert.rejects(h.apply(p, { expectedRevision: p.storage.revision }), (error) => error.code === 'STORAGE_REVISION_CONFLICT')
    assert.equal((await h.snapshot()).data.candidateDecisionReceipts.length, 0)
    await h.apply(p)
  })
  await test('stale fingerprints and late batch failure do not partially apply any candidate', async () => {
    const h = await harness()
    const p = await h.preview(mixed)
    const changed = (await h.snapshot()).data
    changed.memoryUpdateCandidates[0].evidence = 'Edited evidence'
    await writeFile(h.paths.storagePath, JSON.stringify(changed), 'utf8')
    await assert.rejects(h.apply(p), (error) => error.code === 'CANDIDATE_PREVIEW_STALE')
    assert.equal((await h.snapshot()).data.timelineEvents.length, 0)
    const broken = fixture()
    broken.characterStateChangeCandidates[0].characterId = 'missing-character'
    broken.characterStateChangeCandidates[0].proposedFact.characterId = 'missing-character'
    const batch = await harness(broken)
    const bp = await batch.preview([select('memory', 'm1'), select('character_state', 's1')])
    const before = await readFile(batch.paths.storagePath, 'utf8')
    await assert.rejects(batch.apply(bp))
    assert.equal(await readFile(batch.paths.storagePath, 'utf8'), before)
  })

  await test('SQLite API applies and replays against isolated transaction-backed storage', async () => {
    const h = await harness(fixture(), true)
    const beforeRead = await readFile(h.paths.storagePath)
    const p = await h.preview(mixed)
    await h.call('getDecisionInbox')
    assert.deepEqual(await readFile(h.paths.storagePath), beforeRead)
    const applied = await h.apply(p, { decidedAt: timestamp, expectedRevision: p.storage.revision })
    assert.equal(applied.storage.source, 'sqlite')
    const replay = await h.apply(p, { decidedAt: timestamp, expectedRevision: p.storage.revision })
    assert.equal(replay.data.replayed, true)
    assert.equal(replay.storage.revision, applied.storage.revision)
    assert.equal((await h.snapshot()).data.timelineEvents.length, 1)
  })
  await test('compact output cannot be expanded via maxChars and full output still redacts secrets', async () => {
    const data = fixture()
    const secret = 'fixture-private-credential-987654321'
    data.settings.apiKey = secret
    data.memoryUpdateCandidates[0].evidence = `${secret} Authorization: Bearer fixture-bearer-secret ${evidence}`
    const h = await harness(data)
    const before = await h.snapshot()
    for (const detail of ['compact', 'summary', 'full']) {
      const inbox = await h.call('getDecisionInbox', { detail, maxChars: 100000 })
      const preview = await h.call('previewCandidateDecisions', { detail, maxChars: 100000, decisions: [select('memory', 'm1')] })
      for (const response of [inbox, preview]) {
        assert.ok(!JSON.stringify(response.data).includes(secret))
        assert.ok(!JSON.stringify(response.data).includes('fixture-bearer-secret'))
      }
      if (detail !== 'full') {
        assert.ok(!JSON.stringify(inbox.data).includes('END_OF_EVIDENCE'))
        assert.ok(preview.data.items[0].evidence.length <= 323)
        assert.ok(inbox.data.groups.every((group) => group.candidates === undefined))
      } else {
        assert.ok(JSON.stringify(inbox.data).includes('END_OF_EVIDENCE'))
      }
    }
    const short = await h.call('previewCandidateDecisions', { detail: 'full', maxChars: 8, decisions: [select('memory', 'm1')] })
    const ordinary = await h.preview([select('memory', 'm1')])
    assert.ok(short.data.items[0].evidence.length <= 8)
    assert.equal(short.data.items[0].expectedFingerprint, ordinary.data.items[0].expectedFingerprint)
    await assert.rejects(h.call('previewCandidateDecisions', { decisions: mixed, actor: { kind: 'user' }, detail: 'full' }))
    await assert.rejects(h.apply(ordinary, { detail: 'full', actor: { kind: 'user' } }))
    assert.deepEqual(await h.snapshot(), before)
  })
  await test('historical replay preserves newer state and refreshes a stale runtime before its next save', async () => {
    for (const sqlite of [false, true]) {
      const h = await harness(fixture(), sqlite)
      const p = await h.preview(mixed)
      const runtime = await h.snapshot()
      await h.apply(p, { decidedAt: timestamp })
      await h.edit((data) => {
        data.timelineEvents[0].result = 'Author corrected the accepted event.'
        data.projects[1].name = 'New unrelated author edit'
        data.chapters[0].body = 'New chapter text'
      })
      const current = await h.snapshot()
      const bytes = await readFile(h.paths.storagePath)
      const args = {
        projectId: 'p1', operationId: 'op1', reason: 'Reviewed source evidence.', decidedAt: timestamp,
        decisions: commandFor(p).decisions, expectedRevision: runtime.revision
      }
      const replay = await handleAgentWriteTool('agent.applyCandidateDecisions', args, runtime.data, runtime)
      assert.equal(replay.payload.replayed, true)
      assert.deepEqual(await h.snapshot(), current)
      assert.deepEqual(await readFile(h.paths.storagePath), bytes)
      assert.equal(runtime.revision, current.revision)
      assert.deepEqual(runtime.data, current.data)
      await saveAgentRuntimeData(runtime.data, runtime)
      assert.deepEqual((await h.snapshot()).data, current.data)
    }
  })
  await test('historical high-risk agent receipts replay, but user receipts cannot be impersonated', async () => {
    for (const sqlite of [false, true]) {
      for (const actor of [{ kind: 'agent' }, { kind: 'user' }]) {
        const h = await harness(fixture(), sqlite)
        const p = await h.preview([select('character_state', 'high')])
        // Seed a pre-hardening receipt through real storage, never through an
        // Agent handler or production store. It is history, not new permission.
        await h.withStorage((storage) => storage.executeCandidateDecision(commandFor(p, { actor, confirmedHighRisk: true }), p.storage.revision))
        await h.edit((data) => { data.characterStateFacts[0].value = 'Author correction after acceptance' })
        const before = await h.snapshot()
        if (actor.kind === 'agent') {
          const result = await h.apply(p, { confirmedHighRisk: true })
          assert.equal(result.data.replayed, true)
          await assert.rejects(h.apply(p, { confirmedHighRisk: true, reason: 'Different command' }), (error) => error.code === 'CANDIDATE_COMMAND_CONFLICT')
        } else {
          await assert.rejects(h.apply(p, { confirmedHighRisk: true }), (error) => error.code === 'CANDIDATE_COMMAND_CONFLICT')
        }
        assert.deepEqual(await h.snapshot(), before)
      }
    }
  })
  await test('accepted candidates are no-op only for the original operation, never partially reaccepted or reversed', async () => {
    for (const sqlite of [false, true]) {
      const h = await harness(fixture(), sqlite)
      const p = await h.preview([select('memory', 'm1'), select('character_state', 's1')])
      await h.apply(p)
      const before = await h.snapshot()
      assert.equal((await h.apply(p)).data.replayed, true)
      await assert.rejects(h.apply(p, { operationId: 'second-op' }), (error) => error.code === 'CANDIDATE_ALREADY_DECIDED')
      await assert.rejects(h.apply(p, { operationId: 'reverse-op', decisions: commandFor(p).decisions.map((item) => ({ ...item, decision: 'reject' })) }), (error) => error.code === 'CANDIDATE_ALREADY_DECIDED')
      const pending = await h.preview([select('memory', 'm2')])
      await assert.rejects(h.apply(p, { operationId: 'partial-op', decisions: [...commandFor(pending).decisions, ...commandFor(p).decisions] }))
      await assert.rejects(h.preview([select('memory', 'm1')]), (error) => error.code === 'CANDIDATE_ALREADY_DECIDED')
      assert.deepEqual(await h.snapshot(), before)
    }
  })
  await test('a caller cannot supply a newer revision to bypass assessment on a stale runtime', async () => {
    for (const sqlite of [false, true]) {
      const h = await harness(fixture(), sqlite)
      const p = await h.preview([select('character_state', 's1')])
      const runtime = await h.snapshot()
      await h.edit((data) => { data.characterStateChangeCandidates.find((item) => item.id === 's1').riskLevel = 'high' })
      const current = await h.snapshot()
      await assert.rejects(handleAgentWriteTool('agent.applyCandidateDecisions', {
        projectId: 'p1', operationId: 'op1', reason: 'Reviewed source evidence.',
        decisions: commandFor(p).decisions, confirmedHighRisk: true, expectedRevision: current.revision
      }, runtime.data, runtime), (error) => error.code === 'STORAGE_REVISION_CONFLICT')
      assert.deepEqual(await h.snapshot(), current)
      const fresh = await h.preview([select('character_state', 's1')])
      await assert.rejects(h.apply(fresh, { confirmedHighRisk: true }), (error) => error.code === 'AGENT_CANDIDATE_AUTHORIZATION_REQUIRED')
    }
  })
  await test('same fixed operation retried concurrently converges to one receipt and one effect', async () => {
    for (const sqlite of [false, true]) {
      const h = await harness(fixture(), sqlite)
      const p = await h.preview([select('memory', 'm1')])
      const results = await Promise.allSettled([
        h.apply(p, { decidedAt: timestamp }), h.apply(p, { decidedAt: timestamp })
      ])
      assert.ok(results.some((result) => result.status === 'fulfilled'))
      for (const result of results) {
        if (result.status === 'rejected') assert.equal(result.reason.code, 'STORAGE_REVISION_CONFLICT')
      }
      assert.equal((await h.apply(p, { decidedAt: timestamp })).data.replayed, true)
      const current = await h.snapshot()
      assert.equal(current.data.timelineEvents.length, 1)
      assert.equal(current.data.candidateDecisionReceipts.length, 1)
    }
  })
  await test('authorization rechecks stored state even when cached data is paired with a newer revision', async () => {
    for (const sqlite of [false, true]) {
      const h = await harness(fixture(), sqlite)
      const p = await h.preview([select('character_state', 's1')])
      const runtime = await h.snapshot()
      await h.edit((data) => { data.characterStateChangeCandidates.find((item) => item.id === 's1').riskLevel = 'high' })
      const current = await h.snapshot()
      // Model a torn/cached snapshot: old data with the new revision. Neither
      // this data nor a cached receipt may serve as authorization evidence.
      runtime.revision = current.revision
      runtime.data.candidateDecisionReceipts.push({ ...commandFor(p), commandFingerprint: 'cached', updatedAt: timestamp, changedRecords: [] })
      await assert.rejects(handleAgentWriteTool('agent.applyCandidateDecisions', {
        projectId: 'p1', operationId: 'op1', reason: 'Reviewed source evidence.', decidedAt: timestamp,
        decisions: commandFor(p).decisions, confirmedHighRisk: true, expectedRevision: current.revision
      }, runtime.data, runtime), (error) => error.code === 'AGENT_CANDIDATE_AUTHORIZATION_REQUIRED')
      assert.deepEqual(await h.snapshot(), current)
    }
  })
  console.log(`Agent candidate decision API validation passed (${checks} behavior checks).`)
  if (process.argv.includes('--audit-shared')) {
    // Observational probes for the shared-kernel owner, not assertions that
    // freeze known shared defects into the Agent regression contract.
    for (const sqlite of [false, true]) {
      const data = fixture()
      data.chapters.push({ ...data.chapters[0], id: 'ch2', order: 2, body: 'Original second chapter.' })
      data.memoryUpdateCandidates = [memory('chapter-memory', {
        type: 'chapter_review', targetId: 'ch2',
        proposedPatch: {
          schemaVersion: 1, kind: 'chapter_review_update', warnings: [], summary: 'Reviewed chapter two.',
          targetChapterId: null, targetChapterOrder: 2, review: { summary: 'Reviewed chapter two.' },
          continuityBridgeSuggestion: null
        }
      })]
      const h = await harness(data, sqlite)
      const before = await h.preview([select('memory', 'chapter-memory')])
      await h.edit((current) => {
        const chapter = current.chapters.find((item) => item.id === 'ch2')
        chapter.body = 'Rewritten second chapter after preview.'
        chapter.updatedAt = '2026-09-08T00:00:00.000Z'
      })
      const after = await h.preview([select('memory', 'chapter-memory')])
      let acceptedOldPreview = false
      try { await h.apply(before); acceptedOldPreview = true } catch { /* Report rejection as a corrected/shared guard. */ }
      const stateHarness = await harness(fixture(), sqlite)
      const statePreview = await stateHarness.preview([select('character_state', 's1')])
      const stateReceipt = await stateHarness.apply(statePreview, { decidedAt: timestamp })
      const stateData = (await stateHarness.snapshot()).data
      console.log('Shared audit observation:', JSON.stringify({
        storage: sqlite ? 'sqlite' : 'json',
        actualTargetChangeLeftFingerprintUnchanged: before.data.items[0].expectedFingerprint === after.data.items[0].expectedFingerprint,
        acceptedOldPreview,
        receiptDecidedAt: stateReceipt.data.receipt.decidedAt,
        factUpdatedAt: stateData.characterStateFacts[0].updatedAt,
        transactionCreatedAt: stateData.characterStateTransactions[0].createdAt
      }))
    }
  }
} finally {
  const relativePath = relative(tempRoot, outDir)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) throw new Error('Refusing cleanup outside test workspace.')
  await rm(outDir, { recursive: true, force: true })
}

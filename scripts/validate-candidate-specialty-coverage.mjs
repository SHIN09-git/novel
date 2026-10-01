#!/usr/bin/env node
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const timestamp = '2026-09-06T10:00:00.000Z'
const decidedAt = '2026-09-06T11:00:00.000Z'
export const SPECIALTY_KINDS = Object.freeze([
  'foreshadowing_create', 'foreshadowing_status_update', 'timeline_event_create'
])
export const SPECIALTY_IDS = Object.freeze({
  project: 'qa-specialty-project', foreignProject: 'qa-specialty-foreign',
  chapter: 'qa-specialty-chapter', character: 'qa-specialty-character',
  foreshadowing: 'qa-specialty-existing-hook', event: 'qa-specialty-event', job: 'qa-specialty-job',
  foreignHook: 'qa-specialty-foreign-hook', foreignEvent: 'qa-specialty-foreign-event'
})
export const SPECIALTY_EVIDENCE = 'The sealed clock opens when Lin places the silver key on its dial.'

// Importing this file does not run tests, open storage or launch an application.
export async function loadSpecialtyRuntime() {
  const tmpRoot = resolve(repoRoot, 'tmp')
  await mkdir(tmpRoot, { recursive: true })
  const outDir = await mkdtemp(join(tmpRoot, 'candidate-specialty-'))
  const undoPath = join(repoRoot, 'src/services/CandidateDecisionUndoService.ts')
  try {
    const exports = [
      'src/shared/defaults/index.ts', 'src/shared/normalizers/memoryUpdate.ts',
      'src/services/CandidateDecisionService.ts', 'src/services/DecisionInboxService.ts',
      'src/renderer/src/views/generation/pipelineSteps/memoryExtraction.ts',
      ...(existsSync(undoPath) ? ['src/services/CandidateDecisionUndoService.ts'] : [])
    ]
    const outfile = join(outDir, 'runtime.mjs')
    await build({
      stdin: { contents: exports.map((path) => `export * from './${path}'`).join('\n'),
        resolveDir: repoRoot, sourcefile: 'candidate-specialty-entry.ts', loader: 'ts' },
      outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'
    })
    return await import(pathToFileURL(outfile).href)
  } finally {
    const relation = relative(tmpRoot, resolve(outDir))
    assert(relation && !isAbsolute(relation) && relation !== '..' && !relation.startsWith(`..${sep}`))
    await rm(outDir, { recursive: true, force: true })
  }
}

function project(id) {
  return { id, name: id, genre: 'mystery', description: '', targetReaders: '', coreAppeal: '',
    style: '', createdAt: timestamp, updatedAt: timestamp }
}

function hook(id, projectId) {
  return { id, projectId, title: 'The sealed clock', firstChapterOrder: 1,
    description: 'The clock has never opened.', status: 'unresolved', weight: 'high', treatmentMode: 'hint',
    expectedPayoff: 'Learn what opens it.', payoffMethod: '', relatedCharacterIds: [], relatedMainPlot: '',
    notes: 'Keep the engraving intact.', actualPayoffChapter: null, createdAt: timestamp, updatedAt: timestamp }
}

export async function createSpecialtyFixture(runtime) {
  const data = structuredClone(runtime.EMPTY_APP_DATA)
  data.settings = { ...data.settings, baseUrl: 'http://127.0.0.1:1', modelName: 'synthetic-only',
    apiKey: '', hasApiKey: false, retryEnabled: false, maxRetries: 0 }
  data.projects = [project(SPECIALTY_IDS.project), project(SPECIALTY_IDS.foreignProject)]
  data.chapters = [{ id: SPECIALTY_IDS.chapter, projectId: SPECIALTY_IDS.project, order: 3,
    title: 'The clock opens', body: SPECIALTY_EVIDENCE, summary: '', newInformation: '', characterChanges: '',
    newForeshadowing: '', resolvedForeshadowing: '', endingHook: '', riskWarnings: '', includedInStageSummary: false,
    createdAt: timestamp, updatedAt: timestamp }]
  data.characters = [{ id: SPECIALTY_IDS.character, projectId: SPECIALTY_IDS.project, name: 'Lin', role: 'protagonist',
    surfaceGoal: '', deepDesire: '', coreFear: '', selfDeception: '', knownInformation: '', unknownInformation: '',
    protagonistRelationship: '', emotionalState: 'watchful', nextActionTendency: 'listen', forbiddenWriting: '',
    lastChangedChapter: null, isMain: true, createdAt: timestamp, updatedAt: timestamp }]
  data.foreshadowings = [hook(SPECIALTY_IDS.foreshadowing, SPECIALTY_IDS.project), hook(SPECIALTY_IDS.foreignHook, SPECIALTY_IDS.foreignProject)]
  data.timelineEvents = [{ id: SPECIALTY_IDS.foreignEvent, projectId: SPECIALTY_IDS.foreignProject, title: 'Unrelated event',
    chapterOrder: 1, storyTime: 'dawn', narrativeOrder: 1, participantCharacterIds: [], result: 'Unchanged',
    downstreamImpact: '', createdAt: timestamp, updatedAt: timestamp }]
  const job = { id: SPECIALTY_IDS.job, projectId: SPECIALTY_IDS.project, targetChapterOrder: 3,
    status: 'completed', currentStep: 'await_user_confirmation', promptContextSnapshotId: null, contextSource: 'auto',
    errorMessage: '', createdAt: timestamp, updatedAt: timestamp }
  const step = { id: 'qa-specialty-extraction', jobId: job.id, type: 'extract_foreshadowing_updates',
    status: 'running', input: '', output: '', errorMessage: '', startedAt: timestamp, completedAt: null,
    createdAt: timestamp, updatedAt: timestamp }
  data.chapterGenerationJobs = [job]
  data.chapterGenerationSteps = [step]
  const extraction = {
    newForeshadowingCandidates: [{ title: 'A second key under the dial', firstChapterOrder: 3,
      description: SPECIALTY_EVIDENCE, suggestedWeight: 'medium', recommendedTreatmentMode: 'hint',
      expectedPayoff: 'Find the second lock.', relatedCharacterIds: [SPECIALTY_IDS.character], notes: 'The key stays hidden.' }],
    statusChanges: [{ foreshadowingId: SPECIALTY_IDS.foreshadowing, suggestedStatus: 'resolved',
      recommendedTreatmentMode: 'payoff', evidenceText: SPECIALTY_EVIDENCE, notes: 'The first lock opens.', confidence: 0.92 }],
    advancedForeshadowingIds: [], resolvedForeshadowingIds: [SPECIALTY_IDS.foreshadowing], abandonedForeshadowingCandidates: []
  }
  let extractionCalls = 0
  const state = { working: data, draftResult: { body: SPECIALTY_EVIDENCE }, context: {}, noveltyAuditResult: null }
  const untouched = structuredClone(data)
  await runtime.runForeshadowingUpdateExtractionStep({
    env: { project: data.projects[0], scoped: { characters: data.characters, foreshadowings: [data.foreshadowings[0]] },
      updateStepInData: (current, id, change) => ({ ...current,
        chapterGenerationSteps: current.chapterGenerationSteps.map((item) => item.id === id ? { ...item, ...change } : item) }),
      getAiService: async (role) => {
        assert.equal(role, 'extraction')
        return { extractForeshadowing: async (body) => {
          assert.equal(body, SPECIALTY_EVIDENCE)
          extractionCalls++
          return { ok: true, data: structuredClone(extraction), usedAI: true }
        } }
      }
    }, state, job, step, options: { targetChapterOrder: 3 }
  })
  assert.equal(extractionCalls, 1)
  assert.deepEqual(data, untouched, 'Extraction must not mutate its input AppData.')
  assert.deepEqual(state.working.foreshadowings, data.foreshadowings, 'Extraction must not auto-accept hooks.')
  const extracted = state.working.memoryUpdateCandidates
  assert.deepEqual(extracted.map((item) => item.proposedPatch.kind).sort(), SPECIALTY_KINDS.slice(0, 2).sort())
  // Timeline has a structured MemoryUpdatePatch boundary; no timeline extraction step exists today.
  const timeline = runtime.normalizeMemoryUpdateCandidate({
    id: 'qa-specialty-timeline', projectId: SPECIALTY_IDS.project, jobId: job.id, type: 'timeline_event', targetId: null,
    proposedPatch: { schemaVersion: 1, kind: 'timeline_event_create', summary: 'The clock opens', sourceChapterOrder: 3, warnings: [],
      event: { id: SPECIALTY_IDS.event, projectId: SPECIALTY_IDS.project, title: 'The clock opens', chapterOrder: 3,
        storyTime: 'midnight', narrativeOrder: 3, participantCharacterIds: [SPECIALTY_IDS.character],
        result: 'The first lock opens.', downstreamImpact: 'Find the second lock.', createdAt: timestamp, updatedAt: timestamp } },
    evidence: SPECIALTY_EVIDENCE, confidence: 0.92, status: 'pending', createdAt: timestamp, updatedAt: timestamp
  })
  return { ...state.working, memoryUpdateCandidates: [...extracted.map((item) => runtime.normalizeMemoryUpdateCandidate({
    ...item, id: `qa-specialty-${item.proposedPatch.kind}`, createdAt: timestamp, updatedAt: timestamp
  })), timeline] }
}

const candidateFor = (data, kind) => {
  const candidate = data.memoryUpdateCandidates.find((item) => item.proposedPatch.kind === kind)
  assert(candidate, `Missing ${kind} fixture`)
  return candidate
}
const selectionFor = (data, kind, decision = 'accept', amendment) => ({
  kind: 'memory', candidateId: candidateFor(data, kind).id, decision, ...(amendment ? { amendment } : {})
})
const inbox = (runtime, data) => runtime.listDecisionInboxGroups({ projectId: SPECIALTY_IDS.project,
  jobs: data.chapterGenerationJobs, memoryCandidates: data.memoryUpdateCandidates, characterStateChangeCandidates: data.characterStateChangeCandidates })

function prepare(runtime, data, selections, id) {
  const snapshot = structuredClone(data)
  const preview = runtime.previewCandidateDecisions(data, { projectId: SPECIALTY_IDS.project, decisions: selections })
  assert.deepEqual(data, snapshot, 'Preview mutated AppData.')
  const command = { id, projectId: SPECIALTY_IDS.project, schemaVersion: 1, actor: { kind: 'user' },
    reason: 'Synthetic specialty coverage', decidedAt, confirmedHighRisk: preview.requiresConfirmation,
    decisions: preview.items.map(({ kind, candidateId, decision, expectedFingerprint, amendment }) =>
      ({ kind, candidateId, decision, expectedFingerprint, ...(amendment ? { amendment } : {}) })) }
  return { preview, command }
}

const canonical = (data) => ({ foreshadowings: data.foreshadowings, timelineEvents: data.timelineEvents })
function assertUnrelated(before, after) {
  for (const key of ['chapters', 'characters', 'characterStateFacts', 'characterStateTransactions', 'chapterVersions',
    'revisionVersions', 'chapterCommitBundles', 'revisionCommitBundles', 'hardCanonPacks']) assert.deepEqual(after[key], before[key], key)
  for (const [key, value] of Object.entries(before)) {
    if (Array.isArray(value)) assert.deepEqual(after[key].filter((item) => item.projectId === SPECIALTY_IDS.foreignProject || item.id === SPECIALTY_IDS.foreignProject),
      value.filter((item) => item.projectId === SPECIALTY_IDS.foreignProject || item.id === SPECIALTY_IDS.foreignProject), `Foreign ${key} changed`)
  }
}

export function specialtyFact(data, kind) {
  if (kind === 'foreshadowing_create') return data.foreshadowings.find((item) => item.projectId === SPECIALTY_IDS.project && item.id !== SPECIALTY_IDS.foreshadowing)
  if (kind === 'foreshadowing_status_update') return data.foreshadowings.find((item) => item.id === SPECIALTY_IDS.foreshadowing)
  return data.timelineEvents.find((item) => item.id === SPECIALTY_IDS.event)
}

function assertAccepted(before, after, kind, patch = candidateFor(after, kind).proposedPatch) {
  assert.equal(candidateFor(after, kind).status, 'accepted')
  const fact = specialtyFact(after, kind)
  assert(fact, `${kind} did not reach its canonical collection`)
  assert.equal(fact.projectId, SPECIALTY_IDS.project)
  if (kind === 'foreshadowing_create') {
    for (const key of ['title', 'description', 'expectedPayoff', 'relatedCharacterIds', 'notes']) assert.deepEqual(fact[key], patch.candidate[key], key)
    assert.equal(fact.weight, patch.candidate.suggestedWeight)
    assert.equal(fact.treatmentMode, patch.candidate.recommendedTreatmentMode)
    assert.equal(fact.firstChapterOrder, 3)
    assert.equal(fact.status, 'unresolved')
    assert.equal(after.foreshadowings.length, before.foreshadowings.length + 1)
  } else if (kind === 'foreshadowing_status_update') {
    assert.equal(fact.status, patch.suggestedStatus)
    assert.equal(fact.treatmentMode, patch.recommendedTreatmentMode)
    assert.equal(fact.actualPayoffChapter, patch.suggestedStatus === 'resolved' ? 3 : before.foreshadowings[0].actualPayoffChapter)
    assert.equal(fact.notes, [before.foreshadowings[0].notes, patch.notes || patch.evidenceText].filter(Boolean).join('\n'))
    assert.equal(after.foreshadowings.length, before.foreshadowings.length)
  } else {
    for (const key of ['title', 'storyTime', 'participantCharacterIds', 'result', 'downstreamImpact', 'chapterOrder', 'narrativeOrder']) assert.deepEqual(fact[key], patch.event[key], key)
    assert.equal(after.timelineEvents.length, before.timelineEvents.length + 1)
  }
  assertUnrelated(before, after)
}

export function specialtyAmendment(kind) {
  const fields = kind === 'foreshadowing_create' ? { candidate: {
    title: 'Author edited second key', description: 'The silver key reveals a concealed inscription.', suggestedWeight: 'high',
    recommendedTreatmentMode: 'advance', expectedPayoff: 'Read the inscription.', relatedCharacterIds: [SPECIALTY_IDS.character], notes: 'Author note.'
  } } : kind === 'foreshadowing_status_update' ? { suggestedStatus: 'partial', recommendedTreatmentMode: 'advance',
    evidenceText: 'Only the outer lock opens.', notes: 'Keep the inner lock unresolved.'
  } : { event: { title: 'Author edited clock opening', storyTime: 'just before midnight',
    participantCharacterIds: [SPECIALTY_IDS.character], result: 'Only the outer lock opens.', downstreamImpact: 'Read the inscription.' } }
  return { kind: 'memory', patch: { kind, ...fields } }
}

function prepareUndo(runtime, data, receiptId, id) {
  const snapshot = structuredClone(data)
  const preview = runtime.previewCandidateDecisionUndo(data, { projectId: SPECIALTY_IDS.project, receiptId })
  assert.deepEqual(data, snapshot, 'Undo preview mutated AppData.')
  return { preview, command: { id, projectId: SPECIALTY_IDS.project, schemaVersion: 1, actor: { kind: 'user' },
    reason: 'Undo synthetic specialty', decidedAt: '2026-09-06T12:00:00.000Z', confirmedHighRisk: preview.requiresConfirmation,
    decisions: [], undo: { receiptId, expectedFingerprint: preview.expectedFingerprint } } }
}

function assertRestoredCandidate(before, after, kind) {
  const original = candidateFor(before, kind)
  const restored = candidateFor(after, kind)
  assert.equal(restored.status, 'pending')
  assert.deepEqual(restored.proposedPatch, original.proposedPatch, 'Undo did not restore the original proposal.')
  assert.equal(restored.id, original.id)
}

async function main() {
  const runtime = await loadSpecialtyRuntime()
  const base = await createSpecialtyFixture(runtime)
  const decisionsOnly = process.argv.includes('--decisions-only')
  let checks = 0
  const failures = []
  async function test(label, run) {
    try { await run(); checks++; console.log(`  ok - ${label}`) }
    catch (error) { failures.push({ label, error }); console.error(`  FAIL - ${label}: ${error.stack ?? error}`) }
  }

  await test('production extraction step (stubbed AI result) and structured timeline candidates enter Inbox without new kinds or automatic facts', () => {
    const snapshot = structuredClone(base)
    const groups = inbox(runtime, base)
    assert.equal(groups.length, 1)
    assert.equal(groups[0].candidates.length, 3)
    assert.deepEqual(new Set(groups[0].impactAreas), new Set(['foreshadowing', 'timeline']))
    assert(groups[0].candidates.every((item) => item.kind === 'memory_update'))
    assert.deepEqual(new Set(groups[0].memoryCandidateIds), new Set(base.memoryUpdateCandidates.map((item) => item.id)))
    assert(base.memoryUpdateCandidates.every((item) => item.status === 'pending'))
    assert.equal(base.foreshadowings.length, 2)
    assert.equal(base.timelineEvents.length, 1)
    assert.deepEqual(base, snapshot)
  })

  for (const kind of SPECIALTY_KINDS) {
    for (const mode of ['accept', 'reject', 'edit']) await test(`${kind}: ${mode} reaches facts/status/receipt with stable replay and a remaining partial group`, () => {
      const data = structuredClone(base)
      const original = structuredClone(data)
      const selected = selectionFor(data, kind, mode === 'reject' ? 'reject' : 'accept', mode === 'edit' ? specialtyAmendment(kind) : undefined)
      const { preview, command } = prepare(runtime, data, [selected], `${kind}-${mode}`)
      const roundtrip = runtime.previewCandidateDecisions(data, { projectId: SPECIALTY_IDS.project, decisions: JSON.parse(JSON.stringify(preview.items)) })
      assert.deepEqual(roundtrip, preview, 'Normalized preview roundtrip changed fingerprint/amendment.')
      const applied = runtime.applyCandidateDecisionCommand(data, command)
      assert.deepEqual(data, original, 'Command mutated input AppData.')
      if (mode === 'reject') {
        assert.equal(candidateFor(applied.data, kind).status, 'rejected')
        assert.deepEqual(canonical(applied.data), canonical(original))
        assertUnrelated(original, applied.data)
      } else assertAccepted(original, applied.data, kind)
      assert.equal(applied.receipt.decisions[0].candidateId, selected.candidateId)
      assert.equal(applied.receipt.decisions[0].expectedFingerprint, preview.items[0].expectedFingerprint)
      if (mode === 'edit') {
        const audit = applied.receipt.amendments[0]
        assert.deepEqual(audit.before, preview.items[0].amendmentPreview.before)
        assert.deepEqual(audit.after, preview.items[0].amendmentPreview.after)
        assert.deepEqual(audit.after.patch, candidateFor(applied.data, kind).proposedPatch)
        assert.deepEqual(audit.amendment, preview.items[0].amendment)
      }
      const groups = inbox(runtime, applied.data)
      assert.equal(groups.length, 1)
      assert.equal(groups[0].candidates.length, 2)
      assert(!groups[0].candidateIds.includes(selected.candidateId))
      const replay = runtime.applyCandidateDecisionCommand(applied.data, JSON.parse(JSON.stringify(command)))
      assert.equal(replay.replayed, true)
      assert.deepEqual(replay.data, applied.data)
      assert.deepEqual(replay.receipt, applied.receipt)
    })
    await test(`${kind}: stale preview and cross-project commands leave every fact unchanged`, () => {
      const data = structuredClone(base)
      const { command } = prepare(runtime, data, [selectionFor(data, kind)], `${kind}-stale`)
      candidateFor(data, kind).evidence += ' The source was revised.'
      const original = structuredClone(data)
      assert.throws(() => runtime.applyCandidateDecisionCommand(data, command), { code: 'CANDIDATE_PREVIEW_STALE' })
      assert.deepEqual(data, original)
      assert.throws(() => runtime.previewCandidateDecisions(base, { projectId: SPECIALTY_IDS.foreignProject,
        decisions: [selectionFor(base, kind)] }))
      assert.throws(() => runtime.applyCandidateDecisionCommand(base, { ...command, projectId: SPECIALTY_IDS.foreignProject }))
    })
  }

  await test('resolved hook remains high risk even when amended to partial; acceptance requires explicit confirmation', () => {
    const { preview, command } = prepare(runtime, base, [selectionFor(base, SPECIALTY_KINDS[1], 'accept', specialtyAmendment(SPECIALTY_KINDS[1]))], 'risk')
    assert.equal(preview.requiresConfirmation, true)
    assert.equal(preview.items[0].risk, 'high')
    assert.throws(() => runtime.applyCandidateDecisionCommand(base, { ...command, confirmedHighRisk: false }), { code: 'CANDIDATE_CONFIRMATION_REQUIRED' })
    assert.throws(() => runtime.previewCandidateDecisions(base, { projectId: SPECIALTY_IDS.project,
      decisions: [selectionFor(base, SPECIALTY_KINDS[1], 'accept', { ...specialtyAmendment(SPECIALTY_KINDS[1]), patch: { ...specialtyAmendment(SPECIALTY_KINDS[1]).patch, warnings: [] } })] }))
  })

  for (const decision of ['accept', 'reject', 'mixed']) await test(`specialty batch ${decision}: one command/receipt, exact statuses and canonical effects`, () => {
    const selections = SPECIALTY_KINDS.map((kind, index) => selectionFor(base, kind,
      decision === 'reject' || (decision === 'mixed' && index === 1) ? 'reject' : 'accept', decision === 'mixed' && index !== 1 ? specialtyAmendment(kind) : undefined))
    const { command } = prepare(runtime, base, selections, `batch-${decision}`)
    const result = runtime.applyCandidateDecisionCommand(base, command)
    assert.equal(result.data.candidateDecisionReceipts.length, 1)
    assert.equal(result.receipt.decisions.length, 3)
    assert.equal(inbox(runtime, result.data).length, 0)
    for (const [index, kind] of SPECIALTY_KINDS.entries()) {
      assert.equal(candidateFor(result.data, kind).status, selections[index].decision === 'accept' ? 'accepted' : 'rejected')
      if (selections[index].decision === 'accept') {
        // Each assertion sees the other specialty effects already present in the batch.
        const before = { ...base, foreshadowings: kind === 'foreshadowing_status_update'
          ? result.data.foreshadowings.map((item) => item.id === SPECIALTY_IDS.foreshadowing ? base.foreshadowings[0] : item) : base.foreshadowings }
        assertAccepted(before, result.data, kind)
      }
    }
    if (decision === 'reject') assert.deepEqual(canonical(result.data), canonical(base))
    if (decision === 'mixed') assert.deepEqual(specialtyFact(result.data, SPECIALTY_KINDS[1]), specialtyFact(base, SPECIALTY_KINDS[1]))
    assertUnrelated(base, result.data)
    assert.deepEqual(runtime.applyCandidateDecisionCommand(result.data, command).data, result.data)
  })

  await test('a late invalid specialty in a batch never mutates input or emits partial facts/receipt', () => {
    const data = structuredClone(base)
    const status = candidateFor(data, SPECIALTY_KINDS[1])
    status.targetId = SPECIALTY_IDS.foreignHook
    status.proposedPatch.foreshadowingId = SPECIALTY_IDS.foreignHook
    const { command } = prepare(runtime, data, SPECIALTY_KINDS.map((kind) => selectionFor(data, kind)), 'invalid-batch')
    const original = structuredClone(data)
    assert.throws(() => runtime.applyCandidateDecisionCommand(data, command))
    assert.deepEqual(data, original)
  })

  if (!decisionsOnly) {
    await test('undo API is available (required, not silently skipped)', () => assert.equal(typeof runtime.previewCandidateDecisionUndo, 'function'))
    if (typeof runtime.previewCandidateDecisionUndo === 'function') {
      for (const kind of SPECIALTY_KINDS) for (const mode of ['accept', 'edit']) await test(`${kind}: ${mode} then undo restores facts/proposal and preserves history/replay`, () => {
        const { command } = prepare(runtime, base, [selectionFor(base, kind, 'accept', mode === 'edit' ? specialtyAmendment(kind) : undefined)], `${kind}-${mode}-before-undo`)
        const accepted = runtime.applyCandidateDecisionCommand(base, command)
        const snapshot = structuredClone(accepted.data)
        const { preview, command: undoCommand } = prepareUndo(runtime, accepted.data, accepted.receipt.id, `${kind}-${mode}-undo`)
        assert.equal(preview.status, 'ready')
        assert(preview.expectedFingerprint)
        assert(preview.items.some((item) => item.collection === (kind.startsWith('foreshadowing') ? 'foreshadowings' : 'timelineEvents')))
        assert.deepEqual(accepted.data, snapshot)
        const undone = runtime.applyCandidateDecisionCommand(accepted.data, undoCommand)
        assert.equal(undone.receipt.operation, 'undo')
        assert.equal(undone.receipt.undoesReceiptId, accepted.receipt.id)
        assert.deepEqual(accepted.data, snapshot)
        const fact = specialtyFact(undone.data, kind)
        if (kind === 'foreshadowing_status_update') {
          for (const key of ['status', 'treatmentMode', 'actualPayoffChapter', 'notes']) assert.deepEqual(fact[key], specialtyFact(base, kind)[key], key)
        } else assert.equal(fact, undefined, 'Undo must remove the created canonical record.')
        assertRestoredCandidate(base, undone.data, kind)
        assert.equal(inbox(runtime, undone.data)[0].candidates.length, 3)
        assertUnrelated(base, undone.data)
        assert.deepEqual(undone.data.candidateDecisionReceipts.find((item) => item.id === accepted.receipt.id), accepted.receipt, 'Undo rewrote its audit history.')
        assert.equal(undone.data.candidateDecisionReceipts.length, 2)
        const replay = runtime.applyCandidateDecisionCommand(undone.data, undoCommand)
        assert.equal(replay.replayed, true)
        assert.deepEqual(replay.data, undone.data)
        assert.equal(runtime.previewCandidateDecisionUndo(undone.data, { projectId: SPECIALTY_IDS.project, receiptId: accepted.receipt.id }).status, 'already_undone')
        const reaccept = prepare(runtime, undone.data, [selectionFor(undone.data, kind)], `${kind}-${mode}-reaccept`)
        assertAccepted(undone.data, runtime.applyCandidateDecisionCommand(undone.data, reaccept.command).data, kind)
      })

      for (const kind of SPECIALTY_KINDS) await test(`${kind}: undo rejects stale fingerprints and conflicts until a fresh explicit restore`, () => {
        const accepted = runtime.applyCandidateDecisionCommand(base, prepare(runtime, base, [selectionFor(base, kind)], `${kind}-conflict-source`).command)
        const stale = prepareUndo(runtime, accepted.data, accepted.receipt.id, `${kind}-stale-undo`)
        const current = structuredClone(accepted.data)
        const field = kind === 'foreshadowing_status_update' ? 'notes' : 'title'
        specialtyFact(current, kind)[field] = 'Later author change.'
        const snapshot = structuredClone(current)
        assert.throws(() => runtime.applyCandidateDecisionCommand(current, stale.command), { code: 'CANDIDATE_PREVIEW_STALE' })
        const fresh = prepareUndo(runtime, current, accepted.receipt.id, `${kind}-restore-undo`)
        assert.equal(fresh.preview.status, 'conflict')
        assert.equal(fresh.preview.canRestoreConflicts, true)
        assert(fresh.preview.items.some((item) => item.fields.some((itemField) => itemField.path.join('.') === field && itemField.conflicted)))
        assert.throws(() => runtime.applyCandidateDecisionCommand(current, fresh.command), { code: 'CANDIDATE_UNDO_CONFLICT' })
        assert.deepEqual(current, snapshot)
        const restored = runtime.applyCandidateDecisionCommand(current, { ...fresh.command, undo: { ...fresh.command.undo, restoreChangedFields: true } })
        assertRestoredCandidate(base, restored.data, kind)
        if (kind === 'foreshadowing_status_update') assert.equal(specialtyFact(restored.data, kind).notes, specialtyFact(base, kind).notes)
        else assert.equal(specialtyFact(restored.data, kind), undefined)
        assertUnrelated(base, restored.data)
      })

      for (const decision of ['accept', 'reject']) await test(`batch ${decision} undo restores all three specialties in one compensating receipt`, () => {
        const accepted = runtime.applyCandidateDecisionCommand(base, prepare(runtime, base,
          SPECIALTY_KINDS.map((kind) => selectionFor(base, kind, decision)), `batch-${decision}-undo-source`).command)
        const prepared = prepareUndo(runtime, accepted.data, accepted.receipt.id, `batch-${decision}-undo`)
        assert.equal(prepared.preview.status, 'ready')
        const undone = runtime.applyCandidateDecisionCommand(accepted.data, prepared.command)
        for (const kind of SPECIALTY_KINDS) assertRestoredCandidate(base, undone.data, kind)
        const withoutTime = (items) => items.map(({ updatedAt: _updatedAt, ...item }) => item)
        assert.deepEqual(withoutTime(undone.data.foreshadowings), withoutTime(base.foreshadowings))
        assert.deepEqual(undone.data.timelineEvents, base.timelineEvents)
        assert.equal(undone.data.candidateDecisionReceipts.length, 2)
        assert.equal(undone.receipt.undoesReceiptId, accepted.receipt.id)
        assertUnrelated(base, undone.data)
      })

      await test('hook status undo preserves later unrelated fields and another accepted specialty', () => {
        const kind = 'foreshadowing_status_update'
        const accepted = runtime.applyCandidateDecisionCommand(base, prepare(runtime, base, [selectionFor(base, kind)], 'status-source').command)
        const next = runtime.applyCandidateDecisionCommand(accepted.data,
          prepare(runtime, accepted.data, [selectionFor(accepted.data, 'timeline_event_create')], 'timeline-later').command).data
        const current = structuredClone(next)
        specialtyFact(current, kind).title = 'Later title outside the accepted status fields.'
        const prepared = prepareUndo(runtime, current, accepted.receipt.id, 'status-only-undo')
        assert.equal(prepared.preview.status, 'ready')
        assert.throws(() => runtime.applyCandidateDecisionCommand(current, { ...prepared.command, confirmedHighRisk: false }), { code: 'CANDIDATE_CONFIRMATION_REQUIRED' })
        const undone = runtime.applyCandidateDecisionCommand(current, prepared.command)
        assert.equal(specialtyFact(undone.data, kind).title, specialtyFact(current, kind).title)
        assert.equal(specialtyFact(undone.data, kind).status, 'unresolved')
        assert.deepEqual(undone.data.timelineEvents, current.timelineEvents)
        assert.equal(candidateFor(undone.data, 'timeline_event_create').status, 'accepted')
        assertUnrelated(base, undone.data)
      })
    }
  }
  console.log(`\n${checks} behavioral checks passed; ${failures.length} failed. ${decisionsOnly ? 'DECISIONS ONLY: undo not verified.' : 'Undo is required.'}`)
  console.log('Scope: synthetic AppData + production extraction/Inbox/decision services; not SQLite, Electron or remote AI QA.')
  console.log('Coverage gap: timeline candidates enter at the structured patch boundary; no production timeline extraction step was found.')
  if (failures.length) process.exitCode = 1
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error); process.exitCode = 1 })
}

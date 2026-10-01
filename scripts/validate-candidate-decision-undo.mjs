#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const dir = join(repoRoot, 'tmp', 'candidate-undo-regression')
await mkdir(dir, { recursive: true })
async function load(entry, name) {
  const outfile = join(dir, `${name}.mjs`)
  await build({ entryPoints: [join(repoRoot, entry)], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
  return import(pathToFileURL(outfile).href)
}
const defaults = await load('src/shared/defaults.ts', 'defaults')
const decisions = await load('src/services/CandidateDecisionService.ts', 'decisions')
const undoService = await load('src/services/CandidateDecisionUndoService.ts', 'undo')
const stamp = '2026-09-06T10:00:00.000Z'
let checks = 0
function test(name, run) { run(); checks++; console.log(`ok ${checks} - ${name}`) }
function fixture() {
  return defaults.normalizeAppData({ ...structuredClone(defaults.EMPTY_APP_DATA),
    projects: [{ id: 'p', name: '合成撤销样例', createdAt: stamp, updatedAt: stamp }, { id: 'other', name: '其他项目' }],
    characters: [{ id: 'c', projectId: 'p', name: '林澄' }],
    chapters: [{ id: 'chapter', projectId: 'p', order: 1, title: '合成章节', body: '保留正文，不属于决定历史。' }],
    characterStateFacts: [{ id: 'cash', projectId: 'p', characterId: 'c', category: 'resource', key: 'cash', label: '余额',
      valueType: 'number', value: 10000, status: 'active', trackingLevel: 'hard', promptPolicy: 'when_relevant',
      linkedCardFields: ['abilitiesAndResources'], createdAt: stamp, updatedAt: stamp }],
    characterStateChangeCandidates: [{ id: 'spend', projectId: 'p', characterId: 'c', chapterId: 'chapter', chapterOrder: 1,
      candidateType: 'update_fact', targetFactId: 'cash', beforeValue: 10000, afterValue: 5000, riskLevel: 'low', status: 'pending',
      evidence: '购买器材后余额五千。', createdAt: stamp, updatedAt: stamp }] })
}
function decide(data, id = 'decision', choice = 'accept') {
  const preview = decisions.previewCandidateDecisions(data, { projectId: 'p', decisions: [{ kind: 'character_state', candidateId: 'spend', decision: choice }] })
  return decisions.applyCandidateDecisionCommand(data, { id, projectId: 'p', actor: { kind: 'user' }, reason: '合成决定',
    schemaVersion: 1, decidedAt: stamp, decisions: preview.items, confirmedHighRisk: true })
}
function command(data, receiptId = 'decision', options = {}) {
  const preview = undoService.previewCandidateDecisionUndo(data, { projectId: 'p', receiptId })
  return { id: `undo-${receiptId}`, projectId: 'p', actor: { kind: 'user' }, reason: '撤销合成决定',
    schemaVersion: 1, decidedAt: '2026-09-06T10:01:00.000Z', decisions: [], confirmedHighRisk: true,
    undo: { receiptId, expectedFingerprint: preview.expectedFingerprint, ...options } }
}
const original = fixture()
const accepted = decide(original)
let restored
test('accept records field history without full chapter prose', () => {
  assert.equal(accepted.data.characterStateFacts[0].value, 5000)
  assert.ok(accepted.receipt.effects.some((effect) => effect.collection === 'characterStateFacts'))
  assert.ok(!JSON.stringify(accepted.receipt).includes(original.chapters[0].body))
})
test('undo restores value and candidate, retains original transaction and receipt', () => {
  const input = command(accepted.data)
  restored = decisions.applyCandidateDecisionCommand(accepted.data, input)
  assert.equal(restored.data.characterStateFacts[0].value, 10000)
  assert.equal(restored.data.characterStateChangeCandidates[0].status, 'pending')
  assert.equal(restored.data.characterStateTransactions.length, accepted.data.characterStateTransactions.length + 1)
  assert.deepEqual(restored.data.candidateDecisionReceipts[0], accepted.receipt)
  assert.equal(restored.receipt.undoesReceiptId, accepted.receipt.id)
  assert.equal(original.characterStateFacts[0].value, 10000)
  assert.equal(accepted.data.characterStateFacts[0].value, 5000)
})
test('same command replay is a no-op after later edits', () => {
  const later = structuredClone(restored.data); later.characterStateFacts[0].value = 12000
  const replay = decisions.applyCandidateDecisionCommand(later, command(accepted.data))
  assert.equal(replay.replayed, true); assert.equal(replay.data, later)
})
test('different operation id cannot undo same receipt twice', () => {
  const next = { ...command(accepted.data), id: 'another-undo' }
  assert.equal(decisions.applyCandidateDecisionCommand(restored.data, next).replayed, true)
  assert.equal(undoService.previewCandidateDecisionUndo(restored.data, { projectId: 'p', receiptId: 'decision' }).status, 'already_undone')
})
test('reaccept after undo applies once and remains a separate decision', () => {
  const next = decide(restored.data, 'second-decision')
  assert.equal(next.data.characterStateFacts[0].value, 5000)
  assert.equal(next.data.candidateDecisionReceipts.length, 3)
})
test('unrelated fields survive undo without conflict', () => {
  const next = structuredClone(accepted.data)
  next.characterStateFacts[0].unit = '元'; next.characterStateFacts[0].updatedAt = '2026-09-07T00:00:00Z'
  assert.equal(undoService.previewCandidateDecisionUndo(next, { projectId: 'p', receiptId: 'decision' }).status, 'ready')
  const result = decisions.applyCandidateDecisionCommand(next, command(next))
  assert.equal(result.data.characterStateFacts[0].unit, '元')
  assert.deepEqual(result.data.projects[1], next.projects[1])
  assert.deepEqual(result.data.chapters, next.chapters)
})
test('changed field requires explicit restore after preview', () => {
  const next = structuredClone(accepted.data); next.characterStateFacts[0].value = 3000
  const preview = undoService.previewCandidateDecisionUndo(next, { projectId: 'p', receiptId: 'decision' })
  assert.equal(preview.status, 'conflict'); assert.equal(preview.canRestoreConflicts, true)
  const field = preview.items.find((item) => item.id === 'cash').fields.find((field) => field.path[0] === 'value')
  assert.equal(field.current.value, 3000); assert.equal(field.before.value, 10000)
  assert.throws(() => decisions.applyCandidateDecisionCommand(next, command(next)), /核对差异/)
  assert.equal(decisions.applyCandidateDecisionCommand(next, command(next, 'decision', { restoreChangedFields: true })).data.characterStateFacts[0].value, 10000)
})
test('stale undo preview cannot overwrite a newer change', () => {
  const cmd = command(accepted.data); const next = structuredClone(accepted.data); next.characterStateFacts[0].value = 2000
  assert.throws(() => decisions.applyCandidateDecisionCommand(next, { ...cmd, undo: { ...cmd.undo, restoreChangedFields: true } }), /重新查看/)
})
test('missing target cannot be guessed or force restored', () => {
  const next = structuredClone(accepted.data); next.characterStateFacts = []
  const preview = undoService.previewCandidateDecisionUndo(next, { projectId: 'p', receiptId: 'decision' })
  assert.equal(preview.status, 'unavailable'); assert.equal(preview.canRestoreConflicts, false)
})
test('old receipts remain viewable but lack invented undo data', () => {
  const next = structuredClone(accepted.data); delete next.candidateDecisionReceipts[0].effects
  const normalized = defaults.normalizeAppData(next)
  assert.equal(normalized.candidateDecisionReceipts.length, 1)
  assert.equal(undoService.previewCandidateDecisionUndo(normalized, { projectId: 'p', receiptId: 'decision' }).status, 'unavailable')
})
test('history survives normalized JSON roundtrip', () => {
  const next = defaults.normalizeAppData(JSON.parse(JSON.stringify(accepted.data)))
  assert.equal(undoService.previewCandidateDecisionUndo(next, { projectId: 'p', receiptId: 'decision' }).status, 'ready')
  assert.equal(decisions.applyCandidateDecisionCommand(next, command(next)).data.characterStateFacts[0].value, 10000)
})
test('undo rejection returns candidate to pending without world mutation', () => {
  const rejected = decide(fixture(), 'reject', 'reject')
  const next = decisions.applyCandidateDecisionCommand(rejected.data, command(rejected.data, 'reject')).data
  assert.equal(next.characterStateChangeCandidates[0].status, 'pending')
  assert.deepEqual(next.characterStateFacts, original.characterStateFacts)
  assert.equal(next.characterStateTransactions.length, 0)
})
test('created facts deactivate and history is retained', () => {
  const data = fixture(); data.characterStateFacts = []
  Object.assign(data.characterStateChangeCandidates[0], { candidateType: 'create_fact', targetFactId: null, beforeValue: null,
    proposedFact: { ...original.characterStateFacts[0], id: '', value: 5000 } })
  const created = decide(data)
  assert.equal(undoService.previewCandidateDecisionUndo(created.data, { projectId: 'p', receiptId: 'decision' }).status,
    'ready', JSON.stringify(created.receipt.effects))
  const next = decisions.applyCandidateDecisionCommand(created.data, command(created.data)).data
  assert.equal(next.characterStateFacts[0].status, 'inactive')
  assert.equal(next.characterStateChangeCandidates[0].status, 'pending')
  assert.equal(next.characterStateTransactions.at(-1).transactionType, 'invalidate')
  const reapplied = decide(next, 'reaccept-created').data
  assert.equal(reapplied.characterStateFacts.filter((fact) => fact.status === 'active').length, 1)
  assert.equal(reapplied.characterStateFacts.filter((fact) => fact.status === 'inactive').length, 1)
})
test('an explicitly identified created fact can be accepted again after undo', () => {
  const data = fixture(); data.characterStateFacts = []
  Object.assign(data.characterStateChangeCandidates[0], { candidateType: 'create_fact', targetFactId: null, beforeValue: null,
    proposedFact: { ...original.characterStateFacts[0], id: 'new-fact', value: 5000 } })
  const created = decide(data)
  const next = decisions.applyCandidateDecisionCommand(created.data, command(created.data)).data
  const reapplied = decide(next, 'again').data
  assert.equal(reapplied.characterStateFacts.find((fact) => fact.id === 'new-fact').status, 'inactive')
  assert.equal(reapplied.characterStateFacts.filter((fact) => fact.status === 'active').length, 1)
})
test('another project cannot restore this receipt', () => {
  assert.throws(() => undoService.previewCandidateDecisionUndo(accepted.data, { projectId: 'other', receiptId: 'decision' }), /没有这次决定/)
})
test('unsafe or prose-writing journals are entirely discarded', () => {
  for (const path of [['__proto__', 'polluted'], ['body']]) {
    const data = structuredClone(accepted.data)
    data.candidateDecisionReceipts[0].effects[0].fields[0].path = path
    assert.equal(defaults.normalizeAppData(data).candidateDecisionReceipts[0].effects, undefined)
    assert.equal(undoService.previewCandidateDecisionUndo(data, { projectId: 'p', receiptId: 'decision' }).status, 'unavailable')
  }
  assert.equal({}.polluted, undefined)
})
test('undo command cannot carry hidden extra decisions', () => {
  const cmd = command(accepted.data); cmd.decisions = accepted.receipt.decisions
  assert.throws(() => decisions.applyCandidateDecisionCommand(accepted.data, cmd), /参数不完整/)
})
test('undo preserves other later trace membership', () => {
  const data = structuredClone(accepted.data)
  data.generationRunTraces = [{ id: 'trace', projectId: 'p', acceptedMemoryCandidateIds: ['mine', 'later'], updatedAt: stamp }]
  data.candidateDecisionReceipts[0].effects.push({ collection: 'generationRunTraces', id: 'trace', title: '来源运行', created: false,
    fields: [{ path: ['acceptedMemoryCandidateIds'], before: { exists: true, value: [] }, after: { exists: true, value: ['mine'] } }] })
  assert.equal(undoService.previewCandidateDecisionUndo(data, { projectId: 'p', receiptId: 'decision' }).status, 'ready')
  const next = decisions.applyCandidateDecisionCommand(data, command(data)).data
  assert.deepEqual(next.generationRunTraces[0].acceptedMemoryCandidateIds, ['later'])
})
test('same-value later decision is still shown before restoring', () => {
  const data = structuredClone(accepted.data)
  data.candidateDecisionReceipts.push({ ...structuredClone(accepted.receipt), id: 'later', decidedAt: '2026-09-06T10:00:30.000Z' })
  const preview = undoService.previewCandidateDecisionUndo(data, { projectId: 'p', receiptId: 'decision' })
  assert.equal(preview.status, 'conflict')
})
test('compensation rejects a reused command id with different payload', () => {
  assert.throws(() => decisions.applyCandidateDecisionCommand(restored.data, { ...command(accepted.data), reason: 'changed' }), /不同决定/)
})
test('imported journals cannot mark chapters as newly created deletable records', () => {
  const data = structuredClone(accepted.data)
  data.candidateDecisionReceipts[0].effects.push({ collection: 'chapters', id: 'chapter', title: '章节', created: true,
    fields: [{ path: ['title'], before: { exists: false }, after: { exists: true, value: data.chapters[0].title } }] })
  assert.equal(defaults.normalizeAppData(data).candidateDecisionReceipts[0].effects, undefined)
  assert.equal(undoService.previewCandidateDecisionUndo(data, { projectId: 'p', receiptId: 'decision' }).status, 'unavailable')
  assert.equal(data.chapters[0].body, original.chapters[0].body)
})
test('created effects must not contain pre-existing fields', () => {
  const data = structuredClone(accepted.data)
  data.candidateDecisionReceipts[0].effects.find((effect) => effect.collection === 'characterStateFacts').created = true
  assert.equal(defaults.normalizeAppData(data).candidateDecisionReceipts[0].effects, undefined)
})
test('reassigned facts cannot change another character through an old undo', () => {
  const data = defaults.normalizeAppData(JSON.parse(JSON.stringify(accepted.data)))
  data.characters.push({ ...data.characters[0], id: 'c2', name: '叶青' })
  data.characterStateFacts[0].characterId = 'c2'
  const preview = undoService.previewCandidateDecisionUndo(data, { projectId: 'p', receiptId: 'decision' })
  assert.equal(preview.status, 'unavailable')
  assert.equal(preview.canRestoreConflicts, false)
  assert.throws(() => decisions.applyCandidateDecisionCommand(data, command(data, 'decision', { restoreChangedFields: true })), /所属记录发生变化/)
  assert.equal(data.characterStateFacts[0].value, 5000)
})
test('live references distinguish entity collections even when IDs match', () => {
  const data = structuredClone(accepted.data)
  const event = { id: 'c', projectId: 'p', title: '钟声', participantCharacterIds: [], result: '钟响了' }
  data.timelineEvents = [event, { ...event, id: 'another-event', participantCharacterIds: ['c'] }]
  data.candidateDecisionReceipts[0].effects.push({ collection: 'timelineEvents', id: 'c', title: '钟声', created: true,
    fields: Object.entries(event).filter(([key]) => !['id', 'projectId'].includes(key))
      .map(([key, value]) => ({ path: [key], before: { exists: false }, after: { exists: true, value } })) })
  assert.equal(undoService.previewCandidateDecisionUndo(data, { projectId: 'p', receiptId: 'decision' }).status, 'ready')
  const next = decisions.applyCandidateDecisionCommand(data, command(data)).data
  assert.ok(next.characters.some((item) => item.id === 'c'))
  assert.deepEqual(next.timelineEvents.map((item) => item.id), ['another-event'])
  data.hardCanonPacks = [{ id: 'canon', projectId: 'p', items: [{ id: 'anchor', relatedTimelineEventIds: ['c'] }] }]
  assert.equal(undoService.previewCandidateDecisionUndo(data, { projectId: 'p', receiptId: 'decision' }).status, 'unavailable')
  data.hardCanonPacks[0].items[0] = { id: 'anchor', sourceType: 'timeline', sourceId: 'c' }
  assert.equal(undoService.previewCandidateDecisionUndo(data, { projectId: 'p', receiptId: 'decision' }).status, 'unavailable')
})
console.log(JSON.stringify({ ok: true, checks }, null, 2))

import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

// Synthetic fixtures; the shared desktop/Agent steps run in memory, without a provider or an author library.
globalThis.fetch = () => { throw new Error('Network is disabled in this regression') }
const compiled = await build({ stdin: { resolveDir: repoRoot, contents: `
  export * from './src/services/characterState/stateAsOf'
  export * from './src/services/characterState/stateSelection'
  export * from './src/services/CharacterStateService'
  export * from './src/services/CandidateDecisionService'
  export { previewCandidateDecisionUndo } from './src/services/CandidateDecisionUndoService'
  export * from './src/services/DraftDiagnosticBindingService'
  export * from './src/services/HardCanonAuditService'
  export * from './src/shared/defaults'
  export * from './src/renderer/src/utils/promptContext'
  export * from './src/renderer/src/utils/projectData'
  export * from './src/renderer/src/views/generation/pipelineSteps/contextPlanning'
  export { runRebuildContextWithPlanStep } from './src/renderer/src/views/generation/pipelineSteps/chapterGeneration'
  export { runQualityGateStep } from './src/renderer/src/views/generation/pipelineSteps/qualityCheck'
  export { buildChapterAiContext } from './src/renderer/src/views/chapters/chapterAiContext'
  export { characterStateFactsPresentInPrompt } from './src/renderer/src/views/generation/contextSelectionTraceRuntime'
` }, write: false, bundle: true, platform: 'node', format: 'esm', target: 'node22' })
const m = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].contents).toString('base64'))
const project = 'sample', char = 'clerk', day = n => '2022-01-' + String(n).padStart(2, '0') + 'T00:00:00.000Z'
const ch = (order, patch = {}) => ({ id: 'c' + order, projectId: project, order, body: '抄表员核对了表格。', updatedAt: day(1), ...patch })
const book = [ch(1, { body: '清点之后，账面留有四十文。' }), ch(4), ch(8)]
const fact = (order, value, patch = {}) => ({ id: 'cash', projectId: project, characterId: char, category: 'resource', key: 'cash',
  label: '现金余额', unit: '文', valueType: 'number', value, status: 'active', trackingLevel: 'hard', promptPolicy: 'always',
  linkedCardFields: ['abilitiesAndResources'], confidence: 1, sourceChapterId: order ? 'c' + order : null,
  sourceChapterOrder: order, evidence: '', createdAt: day(1), updatedAt: day(order || 1), ...patch })
const tx = (order, value, patch = {}) => ({ id: 'tx' + order, projectId: project, characterId: char, factId: 'cash',
  chapterId: order ? 'c' + order : null, chapterOrder: order, status: 'accepted', source: 'chapter_review', transactionType: 'update',
  beforeValue: null, afterValue: value, delta: null, reason: '', evidence: '账面留有四十文', createdAt: day(order || 1), updatedAt: day(order || 1), ...patch })
const current = fact(8, 980, { evidence: '仅在第八章变更的说明' }), first = tx(1, 40)
const at = m.projectCharacterStatesAtChapter
const values = (...args) => at(...args).map(f => f.value)
const select = (facts, order, plan = null) => m.getRelevantCharacterStatesForPrompt([char], plan, order, facts)
let checks = 0
async function test(label, fn) { await fn(); console.log('ok ' + ++checks + ' - ' + label) }

await test('only matching accepted after-values; future before-values, deltas and proposals cannot establish a balance', () => {
  const rows = [tx(8, 980, { beforeValue: 777 }), tx(1, 81, { status: 'pending' }), tx(1, 82, { status: 'rejected' }),
    tx(1, null, { beforeValue: 300, delta: -9 }), tx(1, 84, { characterId: 'else' }), tx(1, 85, { projectId: 'else' })]
  assert.deepEqual(values([current], rows, 3, book), [])
  const before = structuredClone([current, first])
  const [old] = at([current], [...rows, first], 3, book)
  assert.deepEqual([old.value, old.evidence, old.sourceChapterOrder, old.sourceChapterId], [40, first.evidence, 1, 'c1'])
  assert.deepEqual([current, first], before)
  assert.deepEqual(values([current], [tx(1, 0)], 3, book), [0])
})
await test('scope includes project, character, category, stable key and unit, not the display name or array order', () => {
  const rows = [fact(1, 10), fact(4, 20, { id: 'different-id', label: '改过的名称' }), fact(8, 30),
    fact(1, 1, { id: 'silver', unit: '两' }), fact(1, 2, { projectId: 'b' }), fact(1, 3, { key: 'team.cash' }),
    fact(1, 4, { category: 'custom' }), fact(1, 5, { characterId: 'someone' })]
  assert.deepEqual(values(rows, [], 5).sort((a, b) => a - b), [1, 2, 3, 4, 5, 20])
  assert.deepEqual(at(rows, [], 5), at([...rows].reverse(), [], 5))
  assert.deepEqual(values([fact(1, 10), fact(1, 20, { id: 'disputes' })], [], 5, book), [])
})
await test('complete, partial and absent chapter directories; known archived and foreign IDs never pass', () => {
  assert.deepEqual(values([current], [first], 3, [book[1]]), [])
  assert.deepEqual(values([current], [first], 3, [book[1]], 'partial'), [40])
  assert.deepEqual(values([current], [first], 3), [40])
  for (const coverage of ['complete', 'partial']) {
    assert.deepEqual(values([current], [first], 3, [{ ...book[0], archivedAt: day(2) }], coverage), [])
    assert.deepEqual(values([current], [first], 3, [{ ...book[0], projectId: 'foreign' }], coverage), [])
  }
  assert.deepEqual(values([current], [tx(1, 40, { chapterId: null })], 3, [book[0], ch(1, { id: 'archive', archivedAt: day(2) })]), [])
  assert.deepEqual(values([fact(null, 40, { sourceChapterId: 'c1' })], [], 3), [])
})
await test('stable chapter ID moves forward and backward, including an order previously beyond the cutoff', () => {
  const moved = [ch(2, { id: 'c8', body: book[0].body }), ch(8, { id: 'c1', body: book[0].body })]
  assert.deepEqual(at([current], [], 3, moved).map(f => [f.value, f.sourceChapterOrder]), [[980, 2]])
  assert.deepEqual(values([fact(1, 40)], [], 3, moved), [])
  const later = fact(9, 111)
  assert.deepEqual(values([later], [tx(8, 20), tx(1, 40)], 3, moved), [20])
  assert.deepEqual(values([later], [tx(8, 20)], 3, [ch(2, { id: 'c8', body: '改后没有旧证据。' })]), [])
})
await test('old prose cannot reappear through the mutable fact; explicitly dated manual settings need not quote a chapter', () => {
  const mirror = fact(1, 40, { evidence: first.evidence })
  const revised = [ch(1, { body: '账面已经清空。' })]
  assert.deepEqual(values([mirror], [first], 3, revised), [])
  assert.deepEqual(values([mirror], [first], 3, [ch(1, { body: '并非账面留有四十文。' })]), [])
  assert.deepEqual(values([mirror], [tx(1, 40, { evidence: '现有40' })], 3, [ch(1, { body: '现有400文。' })]), [])
  const bound = tx(1, 40, { sourceBodyHash: m.draftContentHash(book[0].body), evidence: '基于该版本的概述' })
  assert.deepEqual(values([mirror], [bound], 3, book), [40])
  assert.deepEqual(values([mirror], [bound], 3, revised), [])
  assert.deepEqual(values([mirror], [bound], 3, [book[0], ch(1, { body: '修订稿。', updatedAt: day(2) })]), [])
  assert.deepEqual(values([mirror], [{ ...first, source: 'manual', evidence: '作者设定，并非引文。' }], 3, revised), [40])
  assert.deepEqual(values([mirror], [], 3, revised), [40])
  assert.deepEqual(values([current], [tx(1, 99, { chapterId: null, evidence: '' })], 3, []), [])
})
await test('undated hand settings only for a genuinely new chapter in a complete project directory', () => {
  const setting = fact(null, 17), foreign = ch(30, { projectId: 'other' }), archived = ch(31, { archivedAt: day(2) })
  const all = [...book, foreign, archived, ch(10, { body: '  ' })]
  for (const target of [1, 3, 8]) assert.deepEqual(values([setting], [], target, all), [])
  for (const chapters of [undefined, []]) assert.deepEqual(values([setting], [], 9, chapters, 'partial'), [])
  const [now] = at([setting], [], 9, all)
  assert.deepEqual([now.value, now.sourceChapterOrder, now.currentAsOfChapter], [17, null, 9])
  assert.equal(select([now], 9).length, 1); assert.equal(select([now], 7).length, 0)
  assert.equal(select([{ ...now, promptPolicy: 'manual_only' }], 9).length, 0)
  for (const bad of [{ sourceChapterId: 'deleted' }, { status: 'retconned' }, { status: 'inactive' }]) {
    assert.deepEqual(values([{ ...setting, ...bad }], [], 9, all), [])
  }
  assert.deepEqual(values([setting], [tx(12, 17, { source: 'manual' })], 9, all), [])
  assert.deepEqual(values([setting], [tx(1, 17, { evidence: '已被删掉的句子' })], 9, all), [])
  assert.equal(m.normalizeAppData({ ...m.EMPTY_APP_DATA, characterStateFacts: [now] }).characterStateFacts[0].currentAsOfChapter, undefined)
})
await test('all selector branches reject future facts before considering priority or relevance', () => {
  for (const policy of ['always', 'when_relevant', 'manual_only']) {
    for (const plan of [null, { requiredStateFactCategories: { [char]: ['resource'] }, mustCheckContinuity: [] },
      { requiredStateFactCategories: {}, mustCheckContinuity: ['money'] }]) {
      assert.deepEqual(select([fact(8, 2, { promptPolicy: policy })], 3, plan), [])
    }
  }
})
const library = (extra = {}) => m.normalizeAppData({ ...structuredClone(m.EMPTY_APP_DATA),
  projects: [{ id: project, name: '虚构账簿' }, { id: 'other', name: '隔离项目' }],
  characters: [{ id: char, projectId: project, name: '小简', isMain: true }],
  chapters: book, ...extra })
await test('manual and candidate updates preserve actual dated rows only; no history on a metadata-only edit or a read', () => {
  const svc = m.CharacterStateService, base = library({ characterStateFacts: [fact(1, 40)] })
  const edited = svc.createOrUpdateFact(fact(4, 80, { label: '新余额' }), base)
  assert.deepEqual(edited.characterStateTransactions.map(t => t.afterValue), [80, 40])
  assert.deepEqual(at(edited.characterStateFacts, edited.characterStateTransactions, 2, book).map(f => [f.value, f.label]), [[40, '现金余额']])
  const metadata = svc.createOrUpdateFact({ ...edited.characterStateFacts[0], linkedCardFields: ['surfaceGoal'] }, edited)
  assert.deepEqual(metadata.characterStateTransactions, edited.characterStateTransactions)
  const changedUnit = svc.createOrUpdateFact(fact(8, 3, { unit: '两' }), metadata)
  const roundTrip = m.normalizeAppData(JSON.parse(JSON.stringify(changedUnit)))
  assert.deepEqual(at(roundTrip.characterStateFacts, roundTrip.characterStateTransactions, 5, book).map(f => [f.value, f.unit]), [[80, '文']])
  assert.deepEqual(at(roundTrip.characterStateFacts, roundTrip.characterStateTransactions, 8, book).map(f => [f.value, f.unit]), [[3, '两']])
  assert.deepEqual(base.characterStateTransactions, [])
  const candidate = { id: 'spend', characterId: char, projectId: project, targetFactId: 'cash', candidateType: 'transaction',
    chapterId: 'c4', chapterOrder: 4, beforeValue: 40, afterValue: 21, status: 'pending', riskLevel: 'medium',
    evidence: book[1].body, confidence: 1, proposedTransaction: tx(4, 21, { sourceBodyHash: m.draftContentHash(book[1].body) }) }
  const withCandidate = library({ characterStateFacts: [fact(1, 40)], characterStateChangeCandidates: [candidate] })
  const decisions = m.previewCandidateDecisions(withCandidate, { projectId: project, decisions: [
    { kind: 'character_state', candidateId: 'spend', decision: 'accept' }] }).items
  const command = { id: 'decision', projectId: project, decisions, actor: { kind: 'user' }, confirmedHighRisk: true,
    reason: '虚构核对', schemaVersion: 1, decidedAt: day(4) }
  const accepted = m.applyCandidateDecisionCommand(withCandidate, command).data
  assert.deepEqual(m.characterStatesForProjectAtChapter(accepted, project, 3).map(f => f.value), [40])
  assert.deepEqual(m.characterStatesForProjectAtChapter(accepted, project, 5).map(f => f.value), [21])
  const undo = m.previewCandidateDecisionUndo(accepted, { projectId: project, receiptId: command.id })
  const restored = m.applyCandidateDecisionCommand(accepted, { ...command, id: 'undo', decisions: [],
    undo: { receiptId: command.id, expectedFingerprint: undo.expectedFingerprint } }).data
  assert.deepEqual(m.characterStatesForProjectAtChapter(m.normalizeAppData(restored), project, 5).map(f => f.value), [40])
  assert.ok(restored.characterStateTransactions.some(t => t.afterValue === 21 && t.status === 'accepted'))
})
await test('resolve ends the interval; invalidated, archived or retired records do not authorize historical resurrection', () => {
  const closed = fact(4, 40, { status: 'resolved' })
  assert.deepEqual(values([closed], [first, tx(4, null, { source: 'manual', transactionType: 'resolve' })], 2, book), [40])
  assert.deepEqual(values([closed], [first], 4, book), [])
  assert.deepEqual(values([closed], [first, tx(4, 40, { source: 'manual', transactionType: 'update' })], 4, book), [])
  for (const status of ['retconned', 'inactive']) assert.deepEqual(values([{ ...current, status }], [first], 3, book), [])
  assert.deepEqual(values([current], [first, tx(1, null, { source: 'manual', reversesTransactionIds: [first.id] })], 3, book), [])
  assert.deepEqual(values([current], [first, tx(1, null, { source: 'manual', reason: '撤销候选决定 old；补偿记录 undo' })], 3, book), [])
  assert.deepEqual(values([fact(1, 40)], [first, tx(4, 82, { source: 'manual', reason: '撤销候选决定 old；补偿记录 undo' })], 5, book), [])
})
await test('budget replays the last official chapter, not an empty shell; unselected facts can only suppress stale card text', () => {
  const p = library().projects[0], target = 4, profile = m.createContextBudgetProfile(project, 'balanced', 8000)
  const cost = (chapters, card, facts = []) => {
    const data = library({ chapters, characterStateFacts: facts,
      characters: [{ id: char, name: '小简', projectId: project, isMain: true, abilitiesAndResources: card }] })
    return m.selectBudgetContext(p, data, target, profile, { characterIds: [char] }).estimatedTokens
  }
  const cashCard = '余额999文。'.repeat(35)
  for (const chapters of [[ch(1), ch(4)], [ch(1), ch(8)]]) {
    assert.equal(cost(chapters, cashCard), cost(chapters, ''))
  }
  const next = [ch(1), ch(4, { body: '  ' }), ch(5, { archivedAt: day(1) }), ch(6, { projectId: 'other' })]
  assert.ok(cost(next, cashCard) > cost(next, ''))
  const soft = fact(1, 43, { trackingLevel: 'soft', promptPolicy: 'when_relevant' })
  assert.equal(cost(next, cashCard, [soft]), cost(next, ''), 'strip the stale claim but do not add the unselected ledger row')
  assert.ok(cost(next, cashCard, [{ ...soft, promptPolicy: 'always' }]) > cost(next, ''))
})
await test('conditional HardCanon gates use an independent earlier observation, not a future or revised quotation', () => {
  const d = library()
  const rule = { id: 'silent', projectId: project, title: '昏迷时不能开口', content: '', status: 'active',
    check: { kind: 'actor_action', actor: '小简', characterId: char, state: '昏迷', actions: ['开口'], effect: 'forbid', enforcement: 'block' } }
  d.hardCanonPacks = [{ id: 'rules', projectId: project, items: [rule] }]
  d.characterStateFacts = [fact(8, '清醒', { category: 'physical', valueType: 'text', label: '意识', key: 'alert', unit: '' })]
  d.chapters[0].body = '小简陷入昏迷。'
  d.characterStateTransactions = [tx(1, '昏迷', { evidence: d.chapters[0].body })]
  const audit = () => m.auditHardCanon(d, { projectId: project, chapterOrder: 3, body: '小简开口。' }).findings.map(f => f.severity)
  assert.deepEqual(audit(), ['block'])
  d.chapters[0].body = '小简正在抄表。'; assert.deepEqual(audit(), ['review'])
})
await test('desktop and Agent shared pipeline: automatic and rebuilt prompt, final Trace and quality input agree', async () => {
  const data = library({ characterStateFacts: [current, fact(1, 721, { projectId: 'other', id: 'foreign', label: '异书账户' })],
    characterStateTransactions: [first, tx(2, 111, { chapterId: 'missing', source: 'manual' })] })
  const p = data.projects[0], scoped = m.projectData(data, p.id), target = 3
  const job = { id: 'job', projectId: p.id, targetChapterOrder: target, contextSource: 'auto', pipelineMode: 'standard' }
  const options = { targetChapterOrder: target, estimatedWordCount: '900', readerEmotionTarget: '好奇', budgetMode: 'balanced', budgetMaxTokens: 6000 }
  const state = { working: data, context: '', contextNeedPlan: null, contextNeedPlanFromPlan: null, plan: null }
  const ctx = { job, options, state, step: { id: 'step', jobId: job.id, type: 'build_context' }, snapshot: null,
    activeStoryDirectionGuide: null, storyDirectionTracePatch: {}, env: {
      project: p, scoped, updateStepInData: d => d, getAiSettings: () => data.settings, runId: 'dry-run'
    } }
  m.runContextNeedPlanningStep(ctx)
  m.runContextBudgetSelectionStep(ctx)
  const direct = m.buildPipelineContext(p, data, target, '好奇', '900')
  assert.match(direct, /现金余额：40 文/); assert.doesNotMatch(direct, /异书账户|980 文|111 文/)
  const chapterAI = m.buildChapterAiContext({ ...scoped, project: p, selectedChapter: ch(target),
    characterStateFacts: m.characterStatesForProjectAtChapter(data, project, target) })
  assert.match(chapterAI, /现金余额：40 文/); assert.doesNotMatch(chapterAI, /异书账户|980 文|111 文/)
  for (const buildPrompt of [m.runBuildContextStep, m.runRebuildContextWithPlanStep]) {
    buildPrompt(ctx)
    assert.match(state.context, /现金余额：40 文/); assert.doesNotMatch(state.context, /异书账户|980 文|111 文/)
    assert.deepEqual(state.working.generationRunTraces[0].includedCharacterStateFactIds, ['cash'])
    const wrong = state.context.replace('现金余额：40 文', '现金余额：400 文')
    assert.deepEqual(m.characterStateFactsPresentInPrompt(wrong, at([current], [first], target, book), scoped.characters), [])
  }
  state.draftResult = { title: '核表', body: '小简花费 60 文。' }
  const stop = new Error('fixture received gate input')
  ctx.env.diagnostics = { auditNovelty: async () => ({}), evaluateQualityGate: async request => {
    assert.deepEqual(request.characterStateFacts.map(f => f.value), [40])
    assert.ok(m.CharacterStateService.validateCharacterStateInText(request.chapterDraft.body, request.characterStateFacts, scoped.characters)
      .some(i => i.type === 'resource_underflow')); throw stop
  } }
  await assert.rejects(m.runQualityGateStep(ctx), error => error === stop)
})
console.log('Character state as-of: ' + checks + ' groups passed (synthetic, offline).')

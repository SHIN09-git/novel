#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const require = createRequire(join(repoRoot, 'package.json'))
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const result = await build({
  stdin: { contents: `
    export * from './src/renderer/src/views/DecisionInboxView';
    export * from './src/renderer/src/views/inbox/decisionInboxUiModel';
    export * from './src/renderer/src/views/inbox/DecisionInboxHistory';
    export * from './src/renderer/src/views/inbox/DecisionInboxUndoPreview';
    export * from './src/services/CandidateDecisionUndoService';
    export { EMPTY_APP_DATA } from './src/shared/defaults';
  `, resolveDir: repoRoot },
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', packages: 'external',
  loader: { '.css': 'empty', '.png': 'dataurl' }, write: false, logLevel: 'silent'
})
const code = result.outputFiles[0].text
function load(react = React) {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)((id) => id === 'react' ? react : require(id), module, module.exports)
  return module.exports
}
const ui = load()
const timestamp = '2026-09-06T10:00:00.000Z'
function fixture() {
  const data = structuredClone(ui.EMPTY_APP_DATA)
  const project = { id: 'project-ui', name: 'UI fixture', createdAt: timestamp, updatedAt: timestamp }
  data.projects = [project]
  data.characters = [{ id: 'character-ui', projectId: project.id, name: '林', emotionalState: '紧张' }]
  data.chapterGenerationJobs = [{ id: 'job-ui', projectId: project.id, targetChapterOrder: 3 }]
  data.memoryUpdateCandidates = ['timeline-a', 'timeline-b'].map((id) => ({
    id, projectId: project.id, jobId: 'job-ui', type: 'timeline_event', targetId: null,
    evidence: '钟楼的灯亮了。', confidence: 0.9, status: 'pending', createdAt: timestamp, updatedAt: timestamp,
    proposedPatch: { schemaVersion: 1, kind: 'timeline_event_create', summary: `事件 ${id}`, sourceChapterOrder: 3,
      warnings: [], event: { id: `event-${id}`, projectId: project.id, title: id, chapterOrder: 3,
        storyTime: '夜里', narrativeOrder: 3, participantCharacterIds: [], result: '灯亮了', downstreamImpact: '等待回信',
        createdAt: timestamp, updatedAt: timestamp } }
  }))
  const receipt = { id: 'receipt-ui', projectId: project.id, actor: { kind: 'user' }, reason: '作者确认角色变化',
    decidedAt: timestamp, updatedAt: timestamp, schemaVersion: 1, commandFingerprint: 'original',
    decisions: [{ kind: 'memory', candidateId: 'prior-candidate', decision: 'accept', expectedFingerprint: 'candidate' }],
    changedRecords: [{ collection: 'characters', ids: ['character-ui'] }], requiresConfirmation: true,
    effects: [{ collection: 'characters', id: 'character-ui', title: '林', created: false,
      fields: [{ path: ['emotionalState'], before: { exists: true, value: '平静' }, after: { exists: true, value: '紧张' } }] }] }
  data.candidateDecisionReceipts = [receipt]
  return { data, project, receipt }
}

function render(Component, props) { return renderToStaticMarkup(React.createElement(Component, props)) }
function undoHtml(preview, extra = {}) {
  return render(ui.DecisionInboxUndoPreview, { preview, disabled: false, onUndo() {}, onCancel() {}, onRelatedReceipt() {}, ...extra })
}
function submitTag(html) { return html.match(/<button[^>]*>确认撤销这次处理<\/button>/)?.[0] ?? '' }

// Run event handlers with hook state and effects; no DOM, persistence, IPC, or model requests.
function viewHarness(initial, confirm = async () => true) {
  const slots = []
  let cursor = 0
  let pendingEffects = []
  let props = initial
  function useEffect(callback, dependencies) {
    const index = cursor++
    const previous = slots[index]
    if (previous && dependencies?.every((item, i) => Object.is(item, previous.dependencies?.[i]))) return
    pendingEffects.push(() => {
      previous?.cleanup?.()
      slots[index] = { dependencies, cleanup: callback() }
    })
  }
  const module = load({ ...React,
    useState(initialValue) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: typeof initialValue === 'function' ? initialValue() : initialValue }
      return [slots[index].value, (value) => {
        slots[index].value = typeof value === 'function' ? value(slots[index].value) : value
      }]
    },
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value } },
    useMemo(callback) { return callback() }, useCallback(callback) { return callback },
    useContext() { return confirm }, useEffect, useLayoutEffect: useEffect
  })
  return {
    render(nextProps = props) {
      props = nextProps
      cursor = 0
      pendingEffects = []
      const root = module.DecisionInboxView(props)
      const tree = root.type(root.props)
      pendingEffects.forEach((effect) => effect())
      return tree
    },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()) },
    history(tree) { return nodes(tree).find((node) => node.type === module.DecisionInboxHistory) }
  }
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return [tree, ...nodes(tree.props?.children)]
}
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return ''
  if (typeof tree !== 'object') return String(tree)
  if (Array.isArray(tree)) return tree.map(text).join('')
  return text(tree.props?.children)
}
function button(tree, label) {
  const match = nodes(tree).find((node) => node.type === 'button' && text(node).includes(label))
  assert.ok(match, `Missing button: ${label}`)
  return match
}
function historyHarness(data, project, execute, confirm) {
  const harness = viewHarness({ data, project, executeCandidateDecision: execute }, confirm)
  button(harness.render(), '处理记录').props.onClick()
  const history = () => harness.history(harness.render())
  return { harness, history }
}
async function flush() { await new Promise((resolve) => setImmediate(resolve)) }

const base = fixture()
const ready = ui.previewCandidateDecisionUndo(base.data, { projectId: base.project.id, receiptId: base.receipt.id })
assert.equal(ready.status, 'ready')
assert.equal(submitTag(undoHtml(ready)).includes('disabled'), false)
const conflictData = structuredClone(base.data)
conflictData.characters[0].emotionalState = '后来已释然'
const conflict = ui.previewCandidateDecisionUndo(conflictData, { projectId: base.project.id, receiptId: base.receipt.id })
assert.equal(conflict.status, 'conflict')
assert.match(undoHtml(conflict), /后来已释然/)
assert.match(undoHtml(conflict), /平静/)
assert.match(submitTag(undoHtml(conflict)), /disabled/)
assert.equal(ui.canSubmitDecisionUndo(conflict, false), false)
assert.equal(ui.canSubmitDecisionUndo(conflict, true), true)
assert.equal(ui.canSubmitDecisionUndo({ ...conflict, canRestoreConflicts: false }, true), false)
assert.equal(ui.canSubmitDecisionUndo({ ...ready, status: 'unavailable' }, true), false)
assert.equal(ui.canSubmitDecisionUndo({ ...ready, status: 'already_undone' }, true), false)

for (const [value, expected] of [[0, '>0<'], [false, '否 (false)'], [null, '空值'], [[], '空列表'], ['', '空文本']]) {
  assert.ok(render(ui.DecisionFieldValue, { field: { exists: true, value }, path: ['value'] }).includes(expected))
}
assert.match(render(ui.DecisionFieldValue, { field: { exists: false }, path: ['value'] }), /字段不存在/)
assert.match(render(ui.DecisionFieldValue, { field: { exists: true, value: [0, false, '长段落'.repeat(100)] }, path: ['value'] }), /<details/)
assert.match(render(ui.DecisionFieldValue, { field: { exists: true, value: 'payoff' }, path: ['treatmentMode'] }), /回收/)
assert.match(render(ui.DecisionFieldValue, { field: { exists: true, value: ['weaknessAndCost'] }, path: ['linkedCardFields'] }), /弱点与代价/)

const actions = { ...ready, items: ['retain_history', 'deactivate_created', 'remove_created'].map((action, i) => ({
  collection: ['characterStateLogs', 'characterStateFacts', 'timelineEvents'][i], id: `record-${i}`,
  title: `记录 ${i}`, action, fields: [{ path: ['status'], before: { exists: false }, after: { exists: true, value: 'active' },
    current: { exists: true, value: 'active' }, conflicted: false }]
})) }
const actionHtml = undoHtml(actions)
assert.match(actionHtml, /保留历史记录/)
assert.match(actionHtml, /停用本次新增记录/)
assert.match(actionHtml, /移除本次新增记录/)
const traceField = { path: ['acceptedMemoryCandidateIds'], before: { exists: true, value: ['earlier'] },
  after: { exists: true, value: ['earlier', 'this-decision'] },
  current: { exists: true, value: ['earlier', 'this-decision', 'later-decision'] }, conflicted: false }
const traceItem = { collection: 'generationRunTraces', id: 'trace', title: '运行关联', action: 'restore_fields', fields: [traceField] }
const traceHtml = undoHtml({ ...ready, items: [traceItem] }, { effects: [{ ...traceItem, created: false }] })
assert.match(traceHtml, /撤销后<\/small><ul><li><span>earlier<\/span><\/li><li><span>later-decision/)

const legacy = { ...base.receipt, id: 'legacy', effects: undefined }
const undone = { ...base.receipt, id: 'undo-ui', operation: 'undo', undoesReceiptId: base.receipt.id, decisions: [] }
const historyHtml = render(ui.DecisionInboxHistory, { ...base, projectId: base.project.id,
  receipts: [undone, base.receipt, legacy], disabled: false, onUndo() {} })
assert.match(historyHtml, /旧记录未保存处理前的值/)
assert.match(historyHtml, /查看撤销记录/)
assert.match(historyHtml, /查看原处理记录/)
assert.match(historyHtml, /data-decision-receipt-id="receipt-ui"/)

const commands = []
const harness = viewHarness({ ...base, executeCandidateDecision: async (command) => { commands.push(command) } })
let tree = harness.render()
const firstCandidate = nodes(tree).find((node) => node.props?.['data-candidate-id'] === 'timeline-a')
nodes(firstCandidate).find((node) => node.type === 'input').props.onChange({ target: { checked: true } })
tree = harness.render()
button(tree, '接受所选 1 项').props.onClick()
await flush()
assert.deepEqual(commands[0].decisions.map((item) => item.candidateId), ['timeline-a'])
assert.equal(commands[0].decisions[0].kind, 'memory')
harness.unmount()

const mixed = fixture()
mixed.data.memoryUpdateCandidates[1].proposedPatch.kind = 'invalid_patch'
const partialCommands = []
const partial = viewHarness({ ...mixed, executeCandidateDecision: async (command) => partialCommands.push(command) })
let partialTree = partial.render()
assert.equal(button(partialTree, '接受本事件并写入').props.disabled, true)
const validCandidate = nodes(partialTree).find((node) => node.props?.['data-candidate-id'] === 'timeline-a')
nodes(validCandidate).find((node) => node.type === 'input').props.onChange({ target: { checked: true } })
partialTree = partial.render()
assert.equal(button(partialTree, '接受所选 1 项').props.disabled, false)
button(partialTree, '拒绝所选 1 项').props.onClick()
await flush()
assert.deepEqual(partialCommands[0].decisions.map(({ candidateId, decision }) => ({ candidateId, decision })),
  [{ candidateId: 'timeline-a', decision: 'reject' }])
partial.unmount()

const group = { riskLevel: 'low', memoryCandidateIds: ['f'], characterStateCandidateIds: [], impactAreas: ['foreshadowing'] }
assert.equal(ui.matchesInboxFilter(group, 'foreshadowing'), true)
assert.equal(ui.matchesInboxFilter(group, 'memory'), true)
assert.equal(ui.matchesInboxFilter(group, 'timeline'), false)
assert.equal(ui.matchesInboxFilter({ ...group, impactAreas: ['timeline'] }, 'timeline'), true)

let finishSubmission
let confirmations = 0
const submitted = []
const undoHarness = historyHarness(base.data, base.project, (command) => {
  submitted.push(command)
  return new Promise((resolve) => { finishSubmission = resolve })
}, async () => { confirmations++; return true })
undoHarness.history().props.onUndo(ready, false)
undoHarness.history().props.onUndo(ready, false)
assert.equal(confirmations, 0, 'The explicit inline undo button must not trigger a second confirmation dialog.')
assert.match(undoHtml(ready), /高风险变更/)
finishSubmission()
await flush()
assert.equal(submitted.length, 1)
assert.deepEqual(submitted[0].decisions, [])
assert.equal(submitted[0].confirmedHighRisk, true)
assert.equal(submitted[0].undo.expectedFingerprint, ready.expectedFingerprint)
assert.equal(Object.hasOwn(submitted[0].undo, 'restoreChangedFields'), false)
assert.equal(submitted[0].actor.kind, 'user')
assert.equal(submitted[0].schemaVersion, 1)
undoHarness.harness.unmount()

const conflictCommands = []
const conflicts = historyHarness(conflictData, base.project, async (command) => conflictCommands.push(command))
conflicts.history().props.onUndo(conflict, false)
await flush()
assert.equal(conflictCommands.length, 0)
conflicts.history().props.onUndo(conflict, true)
await flush()
assert.equal(conflictCommands[0].undo.restoreChangedFields, true)
conflicts.harness.unmount()

const cancelled = []
let closedPreview = 0
const previewModule = load({ ...React, useState: (initial) => [initial, () => {}] })
const previewTree = previewModule.DecisionInboxUndoPreview({ preview: ready, disabled: false,
  onUndo: (...args) => cancelled.push(args), onCancel: () => { closedPreview++ }, onRelatedReceipt() {} })
button(previewTree, '取消').props.onClick()
assert.equal(closedPreview, 1)
assert.equal(cancelled.length, 0)
const leaving = historyHarness(base.data, base.project, async (command) => cancelled.push(command))
const oldHistory = leaving.history()
leaving.harness.unmount()
oldHistory.props.onUndo(ready, false)
await flush()
assert.equal(cancelled.length, 0)
const stale = historyHarness(conflictData, base.project, async (command) => cancelled.push(command))
stale.history().props.onUndo(ready, false)
await flush()
assert.equal(cancelled.length, 0)
stale.history().props.onUndo({ ...conflict, projectId: 'another-project' }, true)
await flush()
assert.equal(cancelled.length, 0)
stale.harness.unmount()

const changedBeforeClick = historyHarness(base.data, base.project, async (command) => cancelled.push(command))
const shownHistory = changedBeforeClick.history()
changedBeforeClick.harness.render({ data: conflictData, project: base.project, executeCandidateDecision: async (command) => cancelled.push(command) })
shownHistory.props.onUndo(ready, false)
await flush()
assert.equal(cancelled.length, 0)
changedBeforeClick.harness.unmount()

let releaseConfirm
const highRisk = fixture()
highRisk.data.memoryUpdateCandidates[0].proposedPatch.warnings = ['需作者明确确认']
const accepting = viewHarness({ ...highRisk, executeCandidateDecision: async (command) => cancelled.push(command) },
  () => { confirmations++; return new Promise((resolve) => { releaseConfirm = resolve }) })
button(accepting.render(), '接受本事件并写入').props.onClick()
assert.equal(confirmations, 1, 'Accepting high-risk candidates still requires the existing modal.')
accepting.unmount()
releaseConfirm(true)
await flush()
assert.equal(cancelled.length, 0)
console.log('validate-decision-inbox-history-ui: ok (selection, filters, inline undo confirmation, values, consent, stale preview, busy and unmount)')

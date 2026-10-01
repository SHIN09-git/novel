#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Module, { createRequire } from 'node:module'
import { join } from 'node:path'
import { after, test } from 'node:test'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'

// Execute the real workspace view with an in-memory React scheduler. Visual
// children that are not rendered by these tests are represented by prop nodes.
const require = createRequire(import.meta.url)
const originalLoad = Module._load
const originalExtensions = new Map(['.ts', '.tsx'].map((extension) => [extension, require.extensions[extension]]))
for (const extension of originalExtensions.keys()) {
  require.extensions[extension] = (module, filename) => {
    const result = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true
      }
    })
    module._compile(result.outputText, filename)
  }
}

let active
const sameDependencies = (left, right) => left && right && left.length === right.length &&
  left.every((item, index) => Object.is(item, right[index]))
const react = {
  useState(initial) {
    const state = active, index = state.cursor++
    if (!(index in state.cells)) state.cells[index] = typeof initial === 'function' ? initial() : initial
    return [state.cells[index], (value) => {
      const next = typeof value === 'function' ? value(state.cells[index]) : value
      if (!Object.is(next, state.cells[index])) {
        state.cells[index] = next
        state.dirty = true
      }
    }]
  },
  useReducer(reducer, initialArg, initializer) {
    const [value, setValue] = react.useState(() => initializer ? initializer(initialArg) : initialArg)
    return [value, (action) => setValue((current) => reducer(current, action))]
  },
  useMemo(factory, dependencies) {
    const state = active, index = state.cursor++
    if (!state.cells[index] || !sameDependencies(state.cells[index].dependencies, dependencies)) {
      state.cells[index] = { dependencies, value: factory() }
    }
    return state.cells[index].value
  },
  useCallback(callback, dependencies) { return react.useMemo(() => callback, dependencies) },
  useRef(value) { return react.useMemo(() => ({ current: value }), []) },
  useEffect(effect, dependencies) {
    const state = active, index = state.cursor++
    if (!state.cells[index] || !sameDependencies(state.cells[index].dependencies, dependencies)) {
      state.cells[index] = { dependencies, cleanup: state.cells[index]?.cleanup }
      state.effects.push({ index, effect })
    }
  }
}

const viewPath = join(repoRoot, 'src/renderer/src/views/CharactersView.tsx')
Module._load = function (request, parent, isMain) {
  if (request === 'react') return react
  if (request === 'lucide-react') return { Plus: 'Plus' }
  if (request === 'react/jsx-runtime') {
    const jsx = (type, props) => ({ type, props: props ?? {} })
    return { Fragment: 'Fragment', jsx, jsxs: jsx }
  }
  if (parent?.filename === viewPath) {
    if (request === '../components/ConfirmDialog') return { useConfirm: () => async () => true }
    if (request === '../components/FormFields') return { EmptyState: 'EmptyState' }
    if (request === '../components/Layout') return { Header: 'Header' }
    if (request === './characters/CharacterFocusCard') return { CharacterFocusCard: 'Focus' }
    if (request === './characters/CharacterListPane') return { CharacterListPane: 'CharacterList' }
    if (request === './characters/CharacterProfilePanels') return { CharacterProfilePanels: 'Profile' }
    if (request === './characters/CharacterStateLedgerPanel') return { CharacterStateLedgerPanel: 'Ledger' }
    if (request === './characters/CharacterStateLogPanel') return { CharacterStateLogPanel: 'Logs' }
    if (request === './characters/CharacterWorkspaceTabs') return { CharacterWorkspaceTabs: 'Tabs' }
  }
  return originalLoad.call(this, request, parent, isMain)
}

after(() => {
  Module._load = originalLoad
  for (const [extension, loader] of originalExtensions) {
    if (loader) require.extensions[extension] = loader
    else delete require.extensions[extension]
  }
})

const { normalizeAppData } = require(join(repoRoot, 'src/shared/defaults.ts'))
const { createOperationQueue } = require(join(repoRoot, 'src/renderer/src/utils/saveQueue.ts'))
const { CharactersView } = require(viewPath)

const t0 = '2026-01-01T00:00:00.000Z'
const t1 = '2026-01-02T00:00:00.000Z'

function character(projectId, id, name, isMain = false) {
  return {
    id, projectId, name, isMain,
    role: '', surfaceGoal: '', deepDesire: '', coreFear: '', selfDeception: '',
    knownInformation: '', unknownInformation: '', protagonistRelationship: '', emotionalState: '',
    nextActionTendency: '', forbiddenWriting: '', roleFunction: '', deepNeed: '', decisionLogic: '',
    abilitiesAndResources: '', weaknessAndCost: '', relationshipTension: '', futureHooks: '',
    lastChangedChapter: null, createdAt: t0, updatedAt: t0
  }
}

function stateLog(projectId, characterId, id, note) {
  return {
    id, projectId, characterId, note,
    chapterId: null, chapterOrder: null, linkedFactId: null, linkedCandidateId: null,
    convertedAt: null, createdAt: t0
  }
}

function fixture() {
  return normalizeAppData({
    projects: [
      { id: 'p1', name: 'Project one', createdAt: t0, updatedAt: t0 },
      { id: 'p2', name: 'Project two', createdAt: t0, updatedAt: t0 }
    ],
    characters: [
      character('p1', 'shared-character', 'A', true),
      character('p1', 'character-b', 'B'),
      character('p2', 'shared-character', 'A in project two', true)
    ],
    chapters: [
      { id: 'p1-chapter', projectId: 'p1', order: 1, title: 'P1 chapter', body: '', createdAt: t0, updatedAt: t0 },
      { id: 'p2-chapter', projectId: 'p2', order: 1, title: 'P2 chapter', body: '', createdAt: t0, updatedAt: t0 }
    ],
    characterStateLogs: [
      stateLog('p1', 'shared-character', 'a-log-1', 'A first persisted log'),
      { ...stateLog('p1', 'shared-character', 'a-log-2', 'A second persisted log'), createdAt: t1 },
      stateLog('p1', 'character-b', 'b-log-1', 'B persisted log'),
      stateLog('p2', 'shared-character', 'p2-log-1', 'P2 persisted log')
    ]
  })
}

function findNode(node, type) {
  if (Array.isArray(node)) return node.map((child) => findNode(child, type)).find(Boolean)
  if (!node || typeof node !== 'object') return null
  if (node.type === type) return node
  for (const value of Object.values(node.props ?? {})) {
    const found = findNode(value, type)
    if (found) return found
  }
  return null
}

function harness() {
  let data = fixture()
  const state = { cells: [], cursor: 0, effects: [], dirty: false }
  const queue = createOperationQueue()
  const writes = []
  let saveCalls = 0
  let tree
  const props = {
    data,
    project: data.projects.find((item) => item.id === 'p1'),
    saveData(update) {
      saveCalls += 1
      return queue.enqueue(async () => {
        const next = update(data)
        const outcome = await new Promise((resolve) => writes.push({ next, resolve }))
        if (outcome.ok) {
          data = next
          props.data = next
        }
        return outcome
      })
    }
  }

  function render() {
    let attempts = 0
    do {
      state.cursor = 0
      state.effects = []
      state.dirty = false
      active = state
      try { tree = CharactersView(props) } finally { active = undefined }
      for (const pending of state.effects) {
        const previous = state.cells[pending.index]?.cleanup
        if (typeof previous === 'function') previous()
        const cleanup = pending.effect()
        state.cells[pending.index].cleanup = cleanup
      }
      assert.ok(++attempts < 30, 'character workspace must settle')
    } while (state.dirty)
  }

  async function settle() {
    await new Promise(setImmediate)
    render()
  }

  async function act(callback) {
    callback()
    await settle()
  }

  async function finish(outcome = { ok: true }) {
    assert.ok(writes.length, 'expected a delayed save')
    writes.shift().resolve(outcome)
    await settle()
  }

  render()
  return {
    act, finish, writes,
    data: () => data,
    saveCalls: () => saveCalls,
    ledger: () => findNode(tree, 'Ledger').props,
    list: () => findNode(tree, 'CharacterList').props,
    logs: () => findNode(tree, 'Logs').props,
    async selectCharacter(id) { await act(() => findNode(tree, 'CharacterList').props.onSelect(id)) },
    async selectProject(id) {
      props.project = data.projects.find((item) => item.id === id)
      render()
      await settle()
    }
  }
}

async function typeFact(run, { label, value }) {
  await run.act(() => {
    if (label !== undefined) run.ledger().onFactLabelChange(label)
    if (value !== undefined) run.ledger().onFactValueChange(value)
  })
}

async function typeLog(run, note) {
  await run.act(() => run.logs().onLogNoteChange(note))
}

async function beginConversion(run, logId, patch = {}) {
  const log = run.logs().logs.find((item) => item.id === logId)
  assert.ok(log, `expected log ${logId}`)
  await run.act(() => run.logs().onBeginConvertLog(log))
  if (Object.keys(patch).length) await run.act(() => run.logs().onPatchConversionDraft(patch))
}

test('state value 5000 stays with A instead of leaking into B', async () => {
  const run = harness()
  await typeFact(run, { value: '5000' })
  await run.selectCharacter('character-b')
  assert.equal(run.ledger().factValue, '')
  await run.selectCharacter('shared-character')
  assert.equal(run.ledger().factValue, '5000')
})

test('completed log submission resets its mode, but never resets a newer form', async () => {
  const run = harness()
  await typeLog(run, 'A pending state suggestion')
  await run.act(() => run.logs().onLogSaveModeChange('candidate'))
  await run.act(() => run.logs().onRecordLog())
  await run.finish()
  assert.equal(run.logs().logNote, '')
  assert.equal(run.logs().logSaveMode, 'log_only')

  await typeLog(run, 'A second log')
  await run.act(() => run.logs().onRecordLog())
  await typeLog(run, 'A new candidate input')
  await run.act(() => run.logs().onLogSaveModeChange('candidate'))
  await run.finish()
  assert.equal(run.logs().logNote, 'A new candidate input')
  assert.equal(run.logs().logSaveMode, 'candidate')
})

test('A/B fact, log and conversion drafts survive switching without crossing characters', async () => {
  const run = harness()
  await typeFact(run, { label: 'A cash', value: '5000' })
  await typeLog(run, 'A unsaved log')
  await beginConversion(run, 'a-log-1', { label: 'A converted label', value: 'A converted value' })

  await run.selectCharacter('character-b')
  assert.equal(run.ledger().factValue, '')
  assert.equal(run.logs().logNote, '')
  assert.equal(run.logs().conversionLogId, null)
  await typeFact(run, { label: 'B location', value: 'B station' })
  await typeLog(run, 'B unsaved log')
  await beginConversion(run, 'b-log-1', { label: 'B converted label', value: 'B converted value' })

  await run.selectCharacter('shared-character')
  assert.equal(run.ledger().factLabel, 'A cash')
  assert.equal(run.ledger().factValue, '5000')
  assert.equal(run.logs().logNote, 'A unsaved log')
  assert.equal(run.logs().conversionLogId, 'a-log-1')
  assert.equal(run.logs().conversionDraft.label, 'A converted label')

  await run.selectCharacter('character-b')
  assert.equal(run.ledger().factLabel, 'B location')
  assert.equal(run.ledger().factValue, 'B station')
  assert.equal(run.logs().logNote, 'B unsaved log')
  assert.equal(run.logs().conversionLogId, 'b-log-1')
  assert.equal(run.logs().conversionDraft.label, 'B converted label')
})

test('late log save receipt preserves newer text typed for the same character', async () => {
  const run = harness()
  await typeLog(run, 'A submitted log')
  await run.act(() => run.logs().onRecordLog())
  assert.equal(run.logs().logSaving, true)
  await typeLog(run, 'A newer unsaved log')
  await run.finish()
  assert.equal(run.logs().logNote, 'A newer unsaved log')
  assert.equal(run.data().characterStateLogs.filter((item) => item.note === 'A submitted log').length, 1)
})

test('late fact save receipt preserves a newer value typed for the same character', async () => {
  const run = harness()
  await typeFact(run, { label: 'A submitted fact', value: '5000' })
  await run.act(() => run.ledger().onAddStateFact())
  assert.equal(run.ledger().factSaving, true)
  await typeFact(run, { value: '6000' })
  await run.finish()
  assert.equal(run.ledger().factValue, '6000')
  assert.equal(run.data().characterStateFacts.filter((item) => item.label === 'A submitted fact').length, 1)
})

test('A save receipt does not clear B input after a character switch', async () => {
  const run = harness()
  await typeLog(run, 'A submitted log')
  await run.act(() => run.logs().onRecordLog())
  await run.selectCharacter('character-b')
  await typeLog(run, 'B remains local')
  await run.finish()
  assert.equal(run.logs().logNote, 'B remains local')
  assert.equal(run.logs().logSaving, false)
})

test('failed fact, log and conversion saves retain input, show feedback and can retry', async () => {
  const run = harness()

  await typeFact(run, { label: 'Retry cash', value: '5000' })
  await run.act(() => run.ledger().onAddStateFact())
  await run.finish({ ok: false, errorMessage: 'fact fixture failed' })
  assert.equal(run.ledger().factValue, '5000')
  assert.match(run.ledger().factMessage, /失败|重试/)
  await run.act(() => run.ledger().onAddStateFact())
  await run.finish()
  assert.equal(run.ledger().factValue, '')
  assert.equal(run.data().characterStateFacts.filter((item) => item.label === 'Retry cash').length, 1)

  await typeLog(run, 'Retry this log')
  await run.act(() => run.logs().onRecordLog())
  await run.finish({ ok: false, errorMessage: 'log fixture failed' })
  assert.equal(run.logs().logNote, 'Retry this log')
  assert.match(run.logs().logMessage, /失败|重试/)
  await run.act(() => run.logs().onRecordLog())
  await run.finish()
  assert.equal(run.logs().logNote, '')
  assert.equal(run.data().characterStateLogs.filter((item) => item.note === 'Retry this log').length, 1)

  await beginConversion(run, 'a-log-1', { label: 'Retry conversion', value: 'still editing' })
  const sourceLog = run.logs().logs.find((item) => item.id === 'a-log-1')
  await run.act(() => run.logs().onConfirmConvertLogToFact(sourceLog))
  await run.finish({ ok: false, errorMessage: 'conversion fixture failed' })
  assert.equal(run.logs().conversionLogId, 'a-log-1')
  assert.equal(run.logs().conversionDraft.value, 'still editing')
  assert.match(run.logs().conversionMessage, /失败|重试/)
  await run.act(() => run.logs().onConfirmConvertLogToFact(sourceLog))
  await run.finish()
  assert.equal(run.logs().conversionLogId, null)
  assert.equal(run.data().characterStateLogs.find((item) => item.id === 'a-log-1').linkedFactId !== null, true)
})

test('repeated clicks while pending create only one fact, log and conversion', async () => {
  const run = harness()

  await typeFact(run, { label: 'Single fact', value: '1' })
  const beforeFactCalls = run.saveCalls()
  await run.act(() => run.ledger().onAddStateFact())
  await run.act(() => run.ledger().onAddStateFact())
  assert.equal(run.saveCalls() - beforeFactCalls, 1)
  await run.finish()
  assert.equal(run.data().characterStateFacts.filter((item) => item.label === 'Single fact').length, 1)

  await typeLog(run, 'Single log')
  const beforeLogCalls = run.saveCalls()
  await run.act(() => run.logs().onRecordLog())
  await run.act(() => run.logs().onRecordLog())
  assert.equal(run.saveCalls() - beforeLogCalls, 1)
  await run.finish()
  assert.equal(run.data().characterStateLogs.filter((item) => item.note === 'Single log').length, 1)

  await beginConversion(run, 'a-log-1', { label: 'Single conversion' })
  const sourceLog = run.logs().logs.find((item) => item.id === 'a-log-1')
  const beforeConversionCalls = run.saveCalls()
  const beforeConversionFacts = run.data().characterStateFacts.length
  await run.act(() => run.logs().onConfirmConvertLogToFact(sourceLog))
  await run.act(() => run.logs().onConfirmConvertLogToFact(sourceLog))
  assert.equal(run.saveCalls() - beforeConversionCalls, 1)
  await run.finish()
  assert.equal(run.data().characterStateFacts.length - beforeConversionFacts, 1)
  assert.ok(run.data().characterStateLogs.find((item) => item.id === 'a-log-1').linkedFactId)
})

test('conversion receipt for A log does not clear a newly selected conversion log', async () => {
  const run = harness()
  await beginConversion(run, 'a-log-1', { label: 'First conversion' })
  const firstLog = run.logs().logs.find((item) => item.id === 'a-log-1')
  await run.act(() => run.logs().onConfirmConvertLogToFact(firstLog))
  assert.equal(run.logs().conversionSaving, true)

  await beginConversion(run, 'a-log-2', { label: 'Second conversion remains', value: 'new selection' })
  await run.finish()
  assert.equal(run.logs().conversionLogId, 'a-log-2')
  assert.equal(run.logs().conversionDraft.label, 'Second conversion remains')
  assert.equal(run.logs().conversionDraft.value, 'new selection')
})

test('converting L2 directly to a candidate does not clear the edited L1 conversion form', async () => {
  const run = harness()
  await beginConversion(run, 'a-log-1', { label: 'Edited L1 conversion', value: 'L1 local value' })
  const secondLog = run.logs().logs.find((item) => item.id === 'a-log-2')
  await run.act(() => run.logs().onConvertLogToCandidate(secondLog))
  assert.equal(run.logs().conversionSaving, true)
  await run.finish()

  assert.equal(run.logs().conversionLogId, 'a-log-1')
  assert.equal(run.logs().conversionDraft.label, 'Edited L1 conversion')
  assert.equal(run.logs().conversionDraft.value, 'L1 local value')
  assert.ok(run.data().characterStateLogs.find((item) => item.id === 'a-log-2').linkedCandidateId)
})

test('pending state follows its project and character when leaving and returning', async () => {
  const run = harness()
  await typeLog(run, 'A pending log')
  await run.act(() => run.logs().onRecordLog())
  assert.equal(run.logs().logSaving, true)

  await run.selectCharacter('character-b')
  assert.equal(run.logs().logSaving, false)
  await run.selectCharacter('shared-character')
  assert.equal(run.logs().logSaving, true)
  await run.finish()
  assert.equal(run.logs().logSaving, false)
})

test('drafts are isolated by project even when character ids are equal', async () => {
  const run = harness()
  await typeFact(run, { label: 'P1 fact', value: 'p1 value' })
  await typeLog(run, 'P1 unsaved log')
  await beginConversion(run, 'a-log-1', { label: 'P1 conversion' })

  await run.selectProject('p2')
  assert.equal(run.list().selectedId, 'shared-character')
  assert.equal(run.ledger().factValue, '')
  assert.equal(run.logs().logNote, '')
  assert.equal(run.logs().conversionLogId, null)
  await typeFact(run, { label: 'P2 fact', value: 'p2 value' })
  await typeLog(run, 'P2 unsaved log')
  await beginConversion(run, 'p2-log-1', { label: 'P2 conversion' })

  await run.selectProject('p1')
  assert.equal(run.ledger().factLabel, 'P1 fact')
  assert.equal(run.ledger().factValue, 'p1 value')
  assert.equal(run.logs().logNote, 'P1 unsaved log')
  assert.equal(run.logs().conversionLogId, 'a-log-1')

  await run.selectProject('p2')
  assert.equal(run.ledger().factLabel, 'P2 fact')
  assert.equal(run.ledger().factValue, 'p2 value')
  assert.equal(run.logs().logNote, 'P2 unsaved log')
  assert.equal(run.logs().conversionLogId, 'p2-log-1')
})

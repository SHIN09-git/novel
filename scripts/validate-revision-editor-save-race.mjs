#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Module, { createRequire } from 'node:module'
import { join } from 'node:path'
import { after, test } from 'node:test'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'

// Transpile in memory and execute the actual view/actions. Only React's hook
// scheduler and unrendered visual children are replaced; no storage or AI runs.
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
    if (!state.cells[index] || !sameDependencies(state.cells[index], dependencies)) {
      state.cells[index] = dependencies
      state.effects.push(effect)
    }
  }
}
Module._load = function (request, parent, isMain) {
  if (request === 'react') return react
  if (request === 'react/jsx-runtime') {
    const jsx = (type, props) => ({ type, props })
    return { jsx, jsxs: jsx }
  }
  if (parent?.filename === join(repoRoot, 'src/renderer/src/views/RevisionStudioView.tsx')) {
    if (request === '../components/ConfirmDialog') return { useConfirm: () => async () => true }
    if (request === '../components/Layout') return { Header: 'Header' }
    if (request === './revision/RevisionComparisonPanel') return { RevisionComparisonPanel: 'Panel' }
    if (request === './revision/RevisionStudioSidebar') return { RevisionStudioSidebar: 'Sidebar' }
  }
  if (parent?.filename === join(repoRoot, 'src/renderer/src/views/revision/RevisionComparisonPanel.tsx')) {
    if (request === '../../components/AiRewriteTextArea') return { AiRewriteTextArea: 'Editor' }
    if (request === '../../components/FormFields') return { EmptyState: 'EmptyState' }
    if (request === '../../components/UI') return { SectionCard: 'SectionCard' }
    if (request === './RevisionDiffView') return { RevisionDiffView: 'Diff' }
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
const { RevisionStudioView } = require(join(repoRoot, 'src/renderer/src/views/RevisionStudioView.tsx'))
const { RevisionComparisonPanel } = require(join(repoRoot, 'src/renderer/src/views/revision/RevisionComparisonPanel.tsx'))
const t0 = '2026-01-01T00:00:00.000Z'
const t1 = '2026-01-02T00:00:00.000Z'

function findNode(node, type) {
  if (Array.isArray(node)) return node.map((child) => findNode(child, type)).find(Boolean)
  if (!node || typeof node !== 'object') return null
  return node.type === type ? node : findNode(node.props?.children, type)
}

function panelNodes(node) {
  if (Array.isArray(node)) return node.flatMap(panelNodes)
  if (!node || typeof node !== 'object') return []
  return [node, ...panelNodes(node.props?.children), ...panelNodes(node.props?.actions)]
}

function harness() {
  let data = normalizeAppData({
    projects: [{ id: 'p', name: 'Memory-only fixture', createdAt: t0, updatedAt: t0 }],
    chapters: [
      { id: 'ch', projectId: 'p', order: 1, title: 'Chapter', body: 'Source', createdAt: t0, updatedAt: t0 },
      { id: 'other-ch', projectId: 'p', order: 0, title: 'Other chapter', body: 'Other source', createdAt: t0, updatedAt: t0 }
    ],
    revisionSessions: [{ id: 'session', projectId: 'p', chapterId: 'ch', sourceDraftId: null,
      status: 'active', createdAt: t0, updatedAt: t0 }],
    revisionVersions: [
      { id: 'v1', sessionId: 'session', requestId: 'r1', title: 'First', body: 'A', status: 'pending', createdAt: t1, updatedAt: t1 },
      { id: 'v2', sessionId: 'session', requestId: 'r2', title: 'Second', body: 'Other candidate', status: 'pending', createdAt: t0, updatedAt: t0 }
    ]
  })
  const state = { cells: [], cursor: 0, effects: [], dirty: false }
  const queue = createOperationQueue()
  const writes = []
  let tree
  const props = {
    data, project: data.projects[0],
    saveData: async (update) => {
      try {
        return await queue.enqueue(async () => {
          const next = update(data)
          const outcome = await new Promise((resolve) => writes.push({ next, resolve }))
          if (outcome.ok) {
            data = next
            props.data = next
          }
          return outcome
        })
      } catch (error) {
        return { ok: false, errorMessage: error.message }
      }
    }
  }
  function render() {
    let attempts = 0
    do {
      state.cursor = 0
      state.effects = []
      state.dirty = false
      active = state
      try { tree = RevisionStudioView(props) } finally { active = undefined }
      for (const effect of state.effects) effect()
      assert.ok(++attempts < 20, 'component must settle')
    } while (state.dirty)
  }
  async function settle() {
    await new Promise(setImmediate)
    render()
  }
  const panel = () => findNode(tree, 'Panel').props
  render()
  return {
    panel, writes, settle,
    sidebar: () => findNode(tree, 'Sidebar').props,
    read: () => data,
    message: () => tree.props.children.find((child) => child?.props?.className === 'notice revision-message')?.props.children ?? '',
    type(body) { panel().onEditedBodyChange(body); render() },
    async save() { panel().onPersistEditedBody(); await settle() },
    async select(id) { panel().onSelectVersion(id); await settle() },
    async finish(outcome = { ok: true }) {
      assert.ok(writes.length, 'expected a pending save')
      writes.shift().resolve(outcome)
      await settle()
    },
    updateVersion(id, patch) {
      data = { ...data, revisionVersions: data.revisionVersions.map((version) => version.id === id ? { ...version, ...patch } : version) }
      props.data = data
      render()
    }
  }
}

test('late save of B preserves C, and C can subsequently be saved', async () => {
  const run = harness()
  run.type('B')
  await run.save()
  assert.equal(run.writes[0].next.revisionVersions[0].body, 'B')
  run.type('C')
  await run.finish()
  assert.equal(run.read().revisionVersions[0].body, 'B')
  assert.equal(run.panel().selectedVersionForView.body, 'C')
  await run.save()
  await run.finish()
  assert.equal(run.read().revisionVersions[0].body, 'C')
  assert.equal(run.panel().selectedVersionForView.body, 'C')
})

test('candidate switching flushes the original candidate and loads the target body', async () => {
  const run = harness()
  run.type('B')
  await run.save()
  await run.select('v2')
  assert.equal(run.panel().selectedVersion.id, 'v1')
  await run.finish()
  await run.finish()
  assert.equal(run.panel().selectedVersion.id, 'v2')
  assert.equal(run.panel().selectedVersionForView.body, 'Other candidate')
  await run.select('v1')
  assert.equal(run.panel().selectedVersionForView.body, 'B')
})

test('undoing to A while B is saving is still newer input and remains saveable', async () => {
  const run = harness()
  run.type('B')
  await run.save()
  run.type('A')
  await run.finish()
  assert.equal(run.read().revisionVersions[0].body, 'B')
  assert.equal(run.panel().selectedVersionForView.body, 'A')
  await run.save()
  await run.finish()
  assert.equal(run.read().revisionVersions[0].body, 'A')
})

test('typing C while a switch is saving B cancels the switch without discarding C', async () => {
  const run = harness()
  run.type('B')
  await run.select('v2')
  run.type('C')
  await run.finish()
  assert.equal(run.panel().selectedVersion.id, 'v1')
  assert.equal(run.panel().selectedVersionForView.body, 'C')
  assert.ok(run.message())
  await run.select('v2')
  await run.finish()
  assert.equal(run.read().revisionVersions[0].body, 'C')
  assert.equal(run.panel().selectedVersion.id, 'v2')
  assert.equal(run.panel().selectedVersionForView.body, 'Other candidate')
  await run.select('v1')
  assert.equal(run.panel().selectedVersionForView.body, 'C')
})

test('failed save preserves new input and does not complete a candidate switch', async () => {
  const run = harness()
  run.type('B')
  await run.select('v2')
  run.type('C')
  await run.finish({ ok: false, errorMessage: 'fixture write failed' })
  assert.equal(run.read().revisionVersions[0].body, 'A')
  assert.equal(run.panel().selectedVersion.id, 'v1')
  assert.equal(run.panel().selectedVersionForView.body, 'C')
  assert.match(run.message(), /fixture write failed/)
})

test('clean editor follows persisted updates; dirty editor retains its local input', () => {
  const run = harness()
  run.updateVersion('v1', { body: 'External update' })
  assert.equal(run.panel().selectedVersionForView.body, 'External update')
  run.type('Local edits')
  run.updateVersion('v1', { body: 'Another persisted update' })
  assert.equal(run.panel().selectedVersionForView.body, 'Local edits')
})

test('updates for a different candidate never replace the selected candidate input', async () => {
  const run = harness()
  await run.select('v2')
  run.type('Second candidate edits')
  run.updateVersion('v1', { body: 'Late first candidate receipt', updatedAt: t1 })
  assert.equal(run.panel().selectedVersion.id, 'v2')
  assert.equal(run.panel().selectedVersionForView.body, 'Second candidate edits')
})

test('terminal versions remain read-only and display their persisted body', () => {
  const run = harness()
  run.type('Unsaved edits')
  run.updateVersion('v1', { status: 'accepted', body: 'Accepted manuscript' })
  assert.equal(run.panel().selectedVersionCanEdit, false)
  assert.equal(run.panel().selectedVersionForView.body, 'Accepted manuscript')
})

test('quick rewrite save callback also preserves input typed while saving', async () => {
  const run = harness()
  const applied = run.panel().onApplyRewrite('Rewrite B')
  await run.settle()
  run.type('C typed during rewrite save')
  await run.finish()
  assert.equal(await applied, true)
  assert.equal(run.read().revisionVersions[0].body, 'Rewrite B')
  assert.equal(run.panel().selectedVersionForView.body, 'C typed during rewrite save')
})

test('late rewrite callback cannot populate another selected candidate', async () => {
  const run = harness()
  const applied = run.panel().onApplyRewrite('First candidate rewrite')
  await run.settle()
  await run.select('v2')
  run.type('Second candidate edits')
  await run.finish()
  assert.equal(await applied, true)
  assert.equal(run.read().revisionVersions[0].body, 'First candidate rewrite')
  assert.equal(run.panel().selectedVersion.id, 'v2')
  assert.equal(run.panel().selectedVersionForView.body, 'Second candidate edits')
})

for (const status of ['draft', 'pending', 'accepted', 'rejected', 'superseded']) {
  test(`real comparison panel enforces editor and action permissions for ${status}`, async () => {
    const run = harness()
    run.updateVersion('v1', { status })
    const editable = status === 'draft' || status === 'pending'
    const nodes = panelNodes(RevisionComparisonPanel({ ...run.panel(), revisionViewMode: 'revised' }))
    const editor = nodes.find((node) => node.type === 'Editor' && node.props.className === 'revision-textarea revised')
    const accept = nodes.find((node) => node.type === 'button' && node.props.className === 'primary-button')
    const reject = nodes.find((node) => node.type === 'button' && node.props.className === 'danger-button')
    assert.ok(editor && accept && reject)
    assert.equal(editor.props.readOnly, !editable)
    assert.equal(editor.props.disabled, !editable)
    assert.equal(accept.props.disabled, !editable)
    assert.equal(reject.props.disabled, !editable)
    if (editable) {
      assert.equal(typeof editor.props.onChange, 'function')
      assert.equal(typeof editor.props.onBlur, 'function')
      editor.props.onChange('Edited through actual panel')
      await run.settle()
      const updated = panelNodes(RevisionComparisonPanel({ ...run.panel(), revisionViewMode: 'revised' }))
        .find((node) => node.type === 'Editor' && node.props.className === 'revision-textarea revised')
      updated.props.onBlur()
      await run.settle()
      await run.finish()
      assert.equal(run.read().revisionVersions[0].body, 'Edited through actual panel')
    } else {
      assert.equal(editor.props.onChange, undefined)
      assert.equal(editor.props.onBlur, undefined)
      assert.equal(editor.props.getAiService, undefined)
      assert.equal(editor.props.rewriteTarget, undefined)
      assert.equal(run.writes.length, 0)
      assert.equal(run.read().revisionVersions[0].body, 'A')
    }
  })
}

for (const destination of ['source', 'view']) {
  for (const succeeds of [true, false]) {
    test(`${destination} switch ${succeeds ? 'waits for persistence' : 'is cancelled on save failure'}`, async () => {
      const run = harness()
      run.type('B')
      if (destination === 'source') run.sidebar().onChapterChange('other-ch')
      else run.panel().onViewModeChange('revised')
      await run.settle()
      assert.equal(run.writes.length, 1)
      assert.equal(run.read().revisionVersions[0].body, 'A')
      assert.equal(run.sidebar().selectedChapter.id, 'ch')
      assert.equal(run.panel().revisionViewMode, 'diff')
      await run.finish(succeeds ? { ok: true } : { ok: false, errorMessage: 'fixture write failed' })
      assert.equal(run.read().revisionVersions[0].body, succeeds ? 'B' : 'A')
      assert.equal(run.sidebar().selectedChapter.id, succeeds && destination === 'source' ? 'other-ch' : 'ch')
      assert.equal(run.panel().revisionViewMode, succeeds && destination === 'view' ? 'revised' : 'diff')
      if (!succeeds) {
        assert.equal(run.panel().selectedVersionForView.body, 'B')
        assert.match(run.message(), /fixture write failed/)
      }
    })
  }
}

#!/usr/bin/env node
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

// Execute the real component and handlers in memory. Only React's hook/element
// runtime is substituted; this tests controls, not browser layout or effects.
const output = await build({
  stdin: {
    contents: `
      export { ChapterVersionHistoryPanel as Panel } from './src/renderer/src/views/chapters/ChapterVersionHistoryPanel';
      export { restoreChapterVersionEntry as restore, deleteChapterVersionEntry as remove } from './src/renderer/src/views/chapters/chapterVersionActionHandlers';
      export { buildRevisionCommitBundle as buildRevision, applyRevisionCommitBundleToAppData as applyRevision } from './src/services/RevisionCommitBundleService';
      export { getChapterVersionChain as chain, getChapterVersionProtectionReason as protection } from './src/services/ChapterVersionChainService';
      export { normalizeAppData } from './src/shared/defaults';
      export { mount } from 'react';
    `,
    resolveDir: repoRoot, loader: 'ts'
  },
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', logLevel: 'silent',
  plugins: [{
    name: 'focused-panel-hooks',
    setup(plugin) {
      plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, ({ path }) => ({ path, namespace: 'panel-test' }))
      plugin.onLoad({ filter: /.*/, namespace: 'panel-test' }, ({ path }) => ({ contents: path === 'react' ? `
        let active;
        export const useMemo = (factory) => factory();
        export function useState(initial) {
          const state = active, index = state.cursor++;
          if (!(index in state.values)) state.values[index] = typeof initial === 'function' ? initial() : initial;
          return [state.values[index], value => { state.values[index] = typeof value === 'function' ? value(state.values[index]) : value; }];
        }
        export function mount(Component, props) {
          const state = { values: [], cursor: 0 };
          return () => { active = state; state.cursor = 0; try { return Component(props); } finally { active = undefined; } };
        }
      ` : `
        export const jsx = (type, props, key) => ({ type, props, key });
        export const jsxs = jsx;
        export const Fragment = Symbol('Fragment');
      ` }))
    }
  }]
})
const h = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
const originalBody = 'Original manuscript, before its first revision.'
const revisedBody = 'First formally accepted revision.'
const t0 = '2026-09-06T00:00:00.000Z'
const t1 = '2026-09-06T01:00:00.000Z'

function fixture() {
  const initial = h.normalizeAppData({
    projects: [{ id: 'p', name: 'Isolated restore fixture', createdAt: t0, updatedAt: t0 }],
    chapters: [{ id: 'ch', projectId: 'p', order: 1, title: 'Chapter', body: originalBody, createdAt: t0, updatedAt: t0 }]
  })
  return h.applyRevision(initial, h.buildRevision({
    appData: initial, projectId: 'p', chapterId: 'ch', revisionCommitId: 'first-commit',
    newChapterVersionId: 'first-version', revisedAt: t1, afterText: revisedBody
  }))
}

const baseline = (data) => h.chain(data, 'ch').find((entry) => entry.id === 'revision-before:first-commit')

function harness(initial, { fallback = false, confirm = () => true, failWrite = false } = {}) {
  let current = structuredClone(initial)
  const confirmations = [], bundles = [], editorBodies = [], messages = []
  let writes = 0
  const context = {
    chapters: current.chapters, selected: current.chapters[0], bodyDraft: current.chapters[0].body,
    project: current.projects[0],
    confirmAction: async (prompt) => { confirmations.push(prompt); return confirm(prompt) },
    flushBody: async () => true,
    replaceWithPersistedBody: (body) => editorBodies.push(body),
    setAiMessage: (message) => messages.push(message),
    saveData: async (update) => {
      if (failWrite) return { ok: false, errorMessage: 'fixture save failed' }
      const next = update(current)
      if (next !== current) writes++
      current = next
      return { ok: true }
    },
    ...(!fallback ? { saveRevisionCommitBundle: async (buildCommit) => {
      if (failWrite) throw new Error('fixture save failed')
      const { next, bundle } = buildCommit(current)
      const persisted = h.applyRevision(current, bundle)
      assert.deepEqual(next, persisted, 'handler prediction must match the shared commit kernel')
      bundles.push(bundle)
      writes++
      current = persisted
    } } : {})
  }
  return {
    context, confirmations, bundles, editorBodies, messages,
    read: () => current, writes: () => writes,
    replace: (data) => { current = data }
  }
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...nodes(tree.props?.children)]
}

const restoreLabel = '\u6062\u590d\u6b64\u7248\u672c'
const deleteLabel = '\u5220\u9664\u8bb0\u5f55'
const button = (tree, label) => nodes(tree).find((node) => node.type === 'button' && node.props.children === label)

test('virtual baseline is selectable and restorable in the real panel, but never deletable', () => {
  const data = fixture(), entry = baseline(data), restored = []
  assert.ok(entry)
  assert.equal(entry.version, null)
  const render = h.mount(h.Panel, {
    data, selected: data.chapters[0], onRestoreVersion: (item) => restored.push(item),
    onCopyVersion: () => {}, onDeleteVersion: () => assert.fail('virtual baseline must not offer deletion')
  })
  let tree = render()
  assert.equal(button(tree, restoreLabel).props.disabled, true, 'current version remains non-restorable')
  const historyButton = nodes(tree).find((node) => node.type === 'button' && node.key === entry.id)
  assert.ok(historyButton)
  historyButton.props.onClick()
  tree = render()
  assert.equal(button(tree, restoreLabel).props.disabled, false)
  assert.equal(button(tree, deleteLabel), undefined)
  button(tree, restoreLabel).props.onClick()
  assert.equal(restored[0].id, entry.id)
  assert.equal(restored[0].version, null)
})

test('restoring the virtual baseline commits via entry.id and preserves both directions of the version chain', async () => {
  const data = fixture(), firstCommit = structuredClone(data.revisionCommitBundles[0])
  const firstVersion = structuredClone(data.chapterVersions[0])
  const run = harness(data)
  await h.restore(run.context, baseline(data))
  assert.equal(run.writes(), 1)
  assert.equal(run.confirmations.length, 1)
  assert.equal(run.read().chapters[0].body, originalBody)
  assert.deepEqual(run.editorBodies, [originalBody])
  assert.equal(run.bundles[0].beforeText, revisedBody)
  assert.equal(run.bundles[0].afterText, originalBody)
  assert.equal(run.bundles[0].revisionReason, 'Restore chapter version revision-before:first-commit')
  assert.equal(run.read().revisionCommitBundles.length, 2)
  assert.equal(run.read().chapterVersions.length, 2)
  assert.deepEqual(run.read().revisionCommitBundles.find((item) => item.id === firstCommit.id), firstCommit)
  assert.deepEqual(run.read().chapterVersions.find((item) => item.id === firstVersion.id), firstVersion)
  const chain = h.chain(run.read(), 'ch')
  assert.ok(chain.some((entry) => entry.isCurrent && entry.body === originalBody))
  const forward = chain.find((entry) => entry.id === 'first-version')
  assert.equal(forward.isCurrent, false)
  const secondRun = harness(run.read())
  await h.restore(secondRun.context, forward)
  assert.equal(secondRun.read().chapters[0].body, revisedBody)
  assert.equal(secondRun.read().revisionCommitBundles.length, 3)
  assert.equal(secondRun.read().chapterVersions.length, 3)
  for (const body of [originalBody, revisedBody]) assert.ok(h.chain(secondRun.read(), 'ch').some((entry) => entry.body === body))
})

test('legacy saveData fallback can restore the same virtual baseline without losing history', async () => {
  const data = fixture(), run = harness(data, { fallback: true })
  await h.restore(run.context, baseline(data))
  assert.equal(run.writes(), 1)
  assert.equal(run.read().chapters[0].body, originalBody)
  assert.equal(run.read().revisionCommitBundles.length, 2)
  assert.deepEqual(run.read().revisionCommitBundles.find((item) => item.id === 'first-commit'), data.revisionCommitBundles[0])
})

test('cancellation and already-current entries create no commit', async () => {
  const data = fixture(), cancelled = harness(data, { confirm: () => false })
  await h.restore(cancelled.context, baseline(data))
  assert.equal(cancelled.confirmations.length, 1)
  assert.equal(cancelled.writes(), 0)
  assert.deepEqual(cancelled.read(), data)
  assert.deepEqual(cancelled.editorBodies, [])
  const current = harness(data)
  await h.restore(current.context, h.chain(data, 'ch').find((entry) => entry.isCurrent))
  assert.equal(current.confirmations.length, 0)
  assert.equal(current.writes(), 0)
})

test('failed persistence never replaces the editor body or claims a committed result', async () => {
  const data = fixture()
  for (const fallback of [false, true]) {
    const run = harness(data, { fallback, failWrite: true })
    await h.restore(run.context, baseline(data))
    assert.equal(run.writes(), 0)
    assert.deepEqual(run.read(), data)
    assert.deepEqual(run.editorBodies, [])
    assert.deepEqual(run.messages, ['fixture save failed'])
  }
})

test('a removed virtual source is re-resolved at save time rather than trusting cached entry text', async () => {
  const data = fixture(), run = harness(data)
  run.replace({ ...data, revisionCommitBundles: [] })
  const before = structuredClone(run.read())
  await h.restore(run.context, baseline(data))
  assert.equal(run.writes(), 0)
  assert.deepEqual(run.read(), before)
  assert.deepEqual(run.editorBodies, [])
  assert.match(run.messages[0], /missing chapter version/)
})

test('unsaved body is flushed first and preserved as the restore commit baseline', async () => {
  const data = fixture(), run = harness(data), unsavedBody = 'Author edits that must remain recoverable.'
  run.context.bodyDraft = unsavedBody
  let flushes = 0
  run.context.flushBody = async () => {
    flushes++
    assert.equal(run.confirmations.length, 1)
    run.replace({ ...run.read(), chapters: [{ ...run.read().chapters[0], body: unsavedBody }] })
    return true
  }
  await h.restore(run.context, baseline(data))
  assert.equal(flushes, 1)
  assert.equal(run.confirmations.length, 2)
  assert.equal(run.bundles[0].beforeText, unsavedBody)
  assert.equal(run.read().chapters[0].body, originalBody)
  for (const body of [originalBody, revisedBody, unsavedBody]) assert.ok(h.chain(run.read(), 'ch').some((entry) => entry.body === body))
  const failedFlush = harness(data)
  failedFlush.context.bodyDraft = unsavedBody
  failedFlush.context.flushBody = async () => false
  await h.restore(failedFlush.context, baseline(data))
  assert.equal(failedFlush.confirmations.length, 1)
  assert.equal(failedFlush.writes(), 0)
})

test('virtual and committed entries stay deletion-protected; unrelated local snapshots remain deletable', async () => {
  const data = fixture(), run = harness(data)
  await h.remove(run.context, baseline(data))
  assert.equal(run.confirmations.length, 0)
  assert.equal(run.writes(), 0)
  assert.ok(h.protection(data, baseline(data).id))
  await h.remove(run.context, h.chain(data, 'ch').find((entry) => entry.id === 'first-version'))
  assert.equal(run.writes(), 0)
  assert.deepEqual(run.read(), data)
  const local = { id: 'local', projectId: 'p', chapterId: 'ch', body: 'Local snapshot', title: 'Chapter',
    source: 'manual', note: '', createdAt: t0 }
  const withLocal = { ...data, chapterVersions: [...data.chapterVersions, local] }
  const localRun = harness(withLocal)
  await h.remove(localRun.context, h.chain(withLocal, 'ch').find((entry) => entry.id === 'local'))
  assert.equal(localRun.writes(), 1)
  assert.deepEqual(localRun.read().chapterVersions, data.chapterVersions)
  assert.deepEqual(localRun.read().revisionCommitBundles, data.revisionCommitBundles)
})

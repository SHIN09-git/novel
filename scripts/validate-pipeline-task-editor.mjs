#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'
import { verifyPipelineTaskEditorViewGuards } from './utils/pipeline-task-editor-view-fixture.mjs'

const require = createRequire(join(repoRoot, 'package.json'))
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const output = await build({
  entryPoints: [join(repoRoot, 'src/renderer/src/components/pipeline/PipelineTaskEditor.tsx')],
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', packages: 'external',
  loader: { '.css': 'empty' }, write: false, logLevel: 'silent'
})
function load(react = React) {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(
    (id) => id === 'react' ? react : require(id), module, module.exports)
  return module.exports
}
const ui = load()
const original = {
  goal: '林取得路线，岑留守', conflict: '渡口关闭', endingHook: '远处的钟声', targetWordCount: '1800-2200 字',
  styleRequirement: '克制，不使用比喻', suspenseToKeep: '', allowedPayoffs: '', forbiddenPayoffs: '', readerEmotion: '期待'
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function flush() { await new Promise((resolve) => setImmediate(resolve)) }
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return [tree, ...nodes(tree.props?.children)]
}
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return ''
  if (typeof tree !== 'object') return String(tree)
  return Array.isArray(tree) ? tree.map(text).join('') : text(tree.props?.children)
}

// Exercise the component's real event handlers with controlled React state and deferred saves.
function harness(initial) {
  const slots = []
  let index = 0, pendingEffects = [], changed = false, unmounted = false, lateUpdates = 0
  let props = initial, tree
  const { PipelineTaskEditor } = load({ ...React,
    useId: () => 'task-editor-fixture',
    useState(initialValue) {
      const slot = index++
      if (!slots[slot]) slots[slot] = { value: typeof initialValue === 'function' ? initialValue() : initialValue }
      return [slots[slot].value, (value) => {
        if (unmounted) lateUpdates++
        const next = typeof value === 'function' ? value(slots[slot].value) : value
        changed ||= !Object.is(next, slots[slot].value)
        slots[slot].value = next
      }]
    },
    useRef(value) { const slot = index++; return slots[slot] ??= { current: value } },
    useLayoutEffect(callback, dependencies) {
      const slot = index++
      const previous = slots[slot]
      if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return
      pendingEffects.push(() => {
        previous?.cleanup?.()
        slots[slot] = { dependencies, cleanup: callback() }
      })
    }
  })
  const api = {
    render(updates = {}) {
      props = { ...props, ...updates }
      let passes = 0
      do {
        index = 0; pendingEffects = []; changed = false
        tree = PipelineTaskEditor(props)
        pendingEffects.forEach((effect) => effect())
        assert.ok(++passes < 10, 'Task synchronization must settle without a render loop.')
      } while (changed)
      return tree
    },
    input(name) { return nodes(tree).find((node) => ['input', 'textarea'].includes(node.type) && node.props.name === name) },
    button(label) { return nodes(tree).find((node) => node.type === 'button' && text(node) === label) },
    change(name, value) { api.input(name).props.onChange({ target: { value } }); api.render() },
    save() { nodes(tree).find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} }) },
    text() { return text(tree) },
    unmount() { unmounted = true; slots.forEach((slot) => slot?.cleanup?.()) },
    lateUpdates() { return lateUpdates }
  }
  api.render()
  return api
}

const markup = renderToStaticMarkup(React.createElement(ui.PipelineTaskEditor, {
  task: original, busy: false, onSave: async () => {}, sourceLabel: '已保存的本章任务',
  impact: { label: '仅更新表达', reusableArtifacts: ['角色资料', '伏笔选择'], warnings: ['旧草稿继续保留'] }
}))
assert.match(markup, /当前保存/)
assert.match(markup, /来源：已保存的本章任务/)
assert.match(markup, /角色资料、伏笔选择/)
assert.match(markup, /旧草稿继续保留/)
assert.doesNotMatch(markup, /按此任务生成/)
assert.equal(Object.keys(ui.PIPELINE_TASK_FIELD_LABELS).length, 9)

const saves = []
const dirtyStates = []
let generated = 0, pending = deferred()
const editor = harness({ task: original, busy: false,
  onSave: (task) => { saves.push(task); return pending.promise }, onGenerate: () => { generated++ },
  onDirtyChange: (dirty) => { dirtyStates.push(dirty) } })
assert.deepEqual(dirtyStates, [false], 'An incoming task starts as saved.')
for (const name of Object.keys(original)) {
  const input = editor.input(name)
  assert.ok(input, `Missing author field: ${name}`)
  assert.ok(nodes(editor.render()).some((node) => node.type === 'label' && node.props.htmlFor === input.props.id),
    `The ${name} control must have an associated native label.`)
}
assert.equal(editor.input('targetWordCount').props.type, 'text')
const advanced = nodes(editor.render()).find((node) => node.type === 'details')
assert.equal(advanced.props.open, undefined)
assert.deepEqual(nodes(advanced).filter((node) => node.type === 'textarea').map((node) => node.props.name),
  ['suspenseToKeep', 'allowedPayoffs', 'forbiddenPayoffs', 'readerEmotion'])
assert.equal(editor.button('保存任务').props.disabled, true)
assert.equal(editor.button('按此任务生成').props.disabled, false, 'An incoming saved task can be generated.')
editor.change('goal', '  林等待岑返回\n保持原文空白  ')
const authoredGoal = editor.input('goal').props.value
assert.equal(dirtyStates.at(-1), true, 'Editing must report unsaved task state.')
editor.render({ task: { ...original } })
assert.equal(editor.input('goal').props.value, authoredGoal, 'Equivalent new prop objects must preserve local edits.')
assert.match(editor.text(), /本地更改/)
editor.button('按此任务生成').props.onClick()
assert.equal(generated, 0, 'Editing must neither trigger generation nor allow generation of unsaved input.')
editor.save(); editor.save(); editor.render()
assert.equal(saves.length, 1, 'A pending save must reject re-entry before React rerenders.')
assert.equal(saves[0].goal, authoredGoal)
assert.equal(saves[0].targetWordCount, original.targetWordCount)
assert.deepEqual(Object.keys(saves[0]).sort(), Object.keys(original).sort(), 'Saving must not invent fields.')
assert.match(editor.text(), /正在保存/)
editor.change('goal', 'busy overwrite')
editor.button('重置未保存更改').props.onClick()
assert.equal(editor.input('goal').props.value, authoredGoal)
pending.reject(new Error('测试保存失败'))
await flush(); editor.render()
assert.equal(editor.input('goal').props.value, authoredGoal)
assert.match(editor.text(), /保存失败：测试保存失败/)
assert.equal(editor.button('按此任务生成').props.disabled, true)
assert.equal(dirtyStates.at(-1), true, 'A rejected save must keep the task dirty.')

pending = deferred()
editor.save(); pending.resolve()
await flush(); editor.render({ task: { ...original } })
assert.match(editor.text(), /当前保存/)
assert.equal(generated, 0, 'Saving itself must not start AI generation.')
assert.equal(editor.button('按此任务生成').props.disabled, false)
assert.equal(dirtyStates.at(-1), false, 'A successful save must clear task dirtiness.')
editor.button('按此任务生成').props.onClick()
assert.equal(generated, 1)
const savedTask = { ...saves[1] }
editor.change('styleRequirement', '第二次尚未保存的表达要求')
editor.render({ task: savedTask })
assert.equal(editor.input('styleRequirement').props.value, '第二次尚未保存的表达要求',
  'A delayed save echo must not erase a newer local edit.')
editor.button('重置未保存更改').props.onClick(); editor.render()
assert.equal(editor.input('styleRequirement').props.value, savedTask.styleRequirement)
assert.equal(editor.input('goal').props.value, authoredGoal, 'Reset returns to the successful save, not initial props.')
assert.equal(dirtyStates.at(-1), false, 'Resetting must clear task dirtiness.')
editor.change('goal', '来源切换前的本地更改')
editor.render({ task: { ...savedTask }, sourceLabel: '另一个已保存任务' })
assert.equal(editor.input('goal').props.value, authoredGoal,
  'A different source must reset local edits even when its task fields match the current task.')
assert.equal(dirtyStates.at(-1), false, 'A source reset must clear task dirtiness.')

editor.render({ busy: true })
editor.change('goal', 'busy edit'); editor.save(); editor.button('按此任务生成').props.onClick()
assert.equal(saves.length, 2)
assert.equal(generated, 1)
assert.equal(editor.input('goal').props.value, authoredGoal)
editor.render({ busy: false })
editor.change('suspenseToKeep', '新悬念')
pending = deferred(); editor.save()
const switchedTask = { ...original, goal: '另一章：继续行船' }
editor.render({ task: switchedTask })
assert.equal(editor.input('goal').props.value, switchedTask.goal)
assert.equal(editor.button('保存任务').props.disabled, true)
pending.resolve(); await flush(); editor.render()
assert.equal(editor.input('goal').props.value, switchedTask.goal, 'An old save result must not overwrite a switched task.')
assert.match(editor.text(), /当前保存/)
editor.change('readerEmotion', '好奇')
pending = deferred(); editor.save()
editor.render({ task: { ...original, goal: '第三章' } })
pending.reject(new Error('旧任务错误')); await flush(); editor.render()
assert.doesNotMatch(editor.text(), /旧任务错误/)
assert.equal(editor.input('goal').props.value, '第三章')
editor.change('allowedPayoffs', '只回收钟声')
pending = deferred(); editor.save(); editor.unmount()
assert.equal(dirtyStates.at(-1), false, 'Unmounting clears external task dirtiness.')
pending.resolve(); await flush()
assert.equal(editor.lateUpdates(), 0, 'Unmounted editors must ignore late save results.')
await verifyPipelineTaskEditorViewGuards()
console.log('validate-pipeline-task-editor: ok (fields, local edits, async save, generation gate, dirty state and view guards)')

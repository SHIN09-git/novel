import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const output = await build({
  stdin: { contents: `
    export * from './src/renderer/src/components/aiRewriteResultModel';
    export { useAiRewriteCandidate } from './src/renderer/src/components/useAiRewriteCandidate';
  `, resolveDir: repoRoot, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'hook-state-harness', setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: 'hooks', namespace: 'harness' }))
    builder.onResolve({ filter: /\/ConfirmDialog$/ }, () => ({ path: 'confirm', namespace: 'harness' }))
    builder.onResolve({ filter: /\/QuickRewriteDraftProvider$/ }, () => ({ path: 'persistence', namespace: 'harness' }))
    builder.onLoad({ filter: /.*/, namespace: 'harness' }, ({ path }) => ({ contents: path === 'confirm'
      ? `export const useConfirm = () => (input) => globalThis.__rewriteHarness.confirm(input)`
      : path === 'persistence' ? `export const useQuickRewriteDraftStore = () => null`
      : `export const useState = (...args) => globalThis.__rewriteHarness.useState(...args);
        export const useRef = (...args) => globalThis.__rewriteHarness.useRef(...args);
        export const useEffect = (...args) => globalThis.__rewriteHarness.useEffect(...args);
        export const useCallback = (callback) => callback;` }))
  } }]
})
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
let checks = 0
async function test(name, run) { await run(); checks++; console.log(`PASS ${name}`) }
const body = '门口的钟没有响。她把纸条收进衣袋。远处有人关上了窗。'
const text = '她把纸条收进衣袋。'
const range = { start: body.indexOf(text), end: body.indexOf(text) + text.length, text }
const action = { id: 'blank', label: '空白重写', type: 'rewrite_section', instruction: '保留事实，改写动作。' }
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }

function harness(response = '她折好纸条，塞进衣袋。') {
  const cells = [], effects = [], confirms = [], messages = [], applies = [], calls = []
  let cursor = 0, currentBody = body, sourceKey = 'chapter-a', failSave = false
  let responder = async () => ({ data: { revisedText: response }, usedAI: true })
  const service = { generateRevision: (...args) => { calls.push(args); return responder(...args) }, cancelCall: async () => ({ cancelled: true }) }
  const runtime = {
    useState(initial) { const at = cursor++; if (!(at in cells)) cells[at] = typeof initial === 'function' ? initial() : initial
      return [cells[at], (value) => { cells[at] = typeof value === 'function' ? value(cells[at]) : value }] },
    useRef(initial) { const at = cursor++; if (!(at in cells)) cells[at] = { current: initial }; return cells[at] },
    useEffect(effect, deps) { const at = cursor++; const prior = cells[at]
      if (!prior || deps.some((value, i) => !Object.is(prior.deps[i], value))) effects.push(() => {
        prior?.cleanup?.(); cells[at] = { deps: [...deps], cleanup: effect() }
      }) },
    async confirm(input) { confirms.push(input); return true }
  }
  function render() {
    globalThis.__rewriteHarness = runtime
    cursor = 0
    const input = { scopeKey: sourceKey, getCurrentBody: (key) => key === sourceKey ? currentBody : undefined,
      getAiService: async () => service, onStatusChange: (message) => messages.push(message),
      onApply: async (candidate, next) => { if (failSave) throw new Error('fixture save failure'); applies.push(candidate); currentBody = next; return true } }
    const hook = api.useAiRewriteCandidate(input)
    if (effects.length) { for (const effect of effects.splice(0)) effect(); return render() }
    return hook
  }
  const start = () => render().run(action, { targetKey: sourceKey, sourceBody: currentBody, selection: range, instruction: action.instruction, context: '' })
  render()
  return { render, start, confirms, applies, messages, calls,
    body: () => currentBody, changeBody: (value) => { currentBody = value }, setFail: (value) => { failSave = value },
    respond: (fn) => { responder = fn }, changeScope: (key) => { sourceKey = key; render() },
    cleanup: () => { for (const cell of cells) cell?.cleanup?.(); delete globalThis.__rewriteHarness }
  }
}
const withHarness = async (run, response) => { const h = harness(response); try { await run(h) } finally { h.cleanup() } }

await test('local composition preserves all text outside an explicit offset, including duplicate text', () => {
  const repeated = text + text
  const second = { start: text.length, end: repeated.length, text }
  const candidate = { sourceBody: repeated, selection: second, text: '新片段', scope: 'selection' }
  assert.equal(api.composeRewriteResult(candidate, repeated), text + '新片段')
  assert.equal(api.findRewriteRange(repeated, text), null)
  assert.throws(() => api.composeRewriteResult(candidate, repeated + '新正文'))
  assert.throws(() => api.retargetRewriteCandidate(candidate, repeated, { start: -1, end: 3, text: '错误' }))
})
await test('whole responses are suggestions, never automatically pasted into a local selection', () => {
  assert.equal(api.classifyRewriteResult(body, range, body.replace(text, '她把纸条藏好。')), 'chapter')
  assert.equal(api.classifyRewriteResult(body, range, '她藏好纸条。'), 'selection')
  assert.equal(api.classifyRewriteResult(body, { start: 0, end: body.length, text: body }, body + '门开了。'), 'selection')
})
await test('normal response stays a candidate until explicitly applied; author edits are adopted', () => withHarness(async (h) => {
  await h.start()
  assert.equal(h.body(), body)
  assert.equal(h.applies.length, 0)
  h.render().edit('她将纸条折好，放进衣袋。')
  await h.render().apply()
  assert.equal(h.body(), body.replace(text, '她将纸条折好，放进衣袋。'))
  assert.equal(h.applies.length, 1)
  assert.equal(h.render().candidate, null)
}))
await test('an entire chapter candidate requires a specific confirmation and replaces only once', () => withHarness(async (h) => {
  await h.start()
  assert.equal(h.render().candidate.scope, 'chapter')
  assert.equal(h.body(), body)
  const first = h.render().apply()
  const second = h.render().apply()
  await Promise.all([first, second])
  assert.equal(h.confirms.length, 1)
  assert.equal(h.confirms[0].confirmLabel, '确认采用整章')
  assert.equal(h.applies.length, 1)
  assert.equal(h.body(), body.replace(text, '她慢慢收起纸条。'))
}, body.replace(text, '她慢慢收起纸条。')))
await test('late response is retained when prose changes, and unique explicit relocation preserves new prose', () => withHarness(async (h) => {
  const hold = deferred()
  h.respond(() => hold.promise)
  const running = h.start()
  await new Promise((done) => setImmediate(done))
  h.changeBody('新增开场。' + body)
  hold.resolve({ data: { revisedText: '她藏好纸条。' }, usedAI: true })
  await running
  assert.equal(h.render().stale, true)
  await h.render().apply()
  assert.equal(h.applies.length, 0)
  h.render().retarget()
  assert.equal(h.render().stale, false)
  await h.render().apply()
  assert.equal(h.body(), '新增开场。' + body.replace(text, '她藏好纸条。'))
}))
await test('ambiguous relocation retains the candidate and needs an explicit offset', () => withHarness(async (h) => {
  await h.start()
  h.changeBody(body + text)
  h.render().retarget()
  assert.equal(h.render().stale, true)
  assert.ok(h.render().message.includes('出现多次'))
  const start = h.body().lastIndexOf(text)
  h.render().retarget({ start, end: start + text.length, text })
  await h.render().apply()
  assert.equal(h.body(), body + '她折好纸条，塞进衣袋。')
}))
await test('saving failure leaves the editable result available for a retry', () => withHarness(async (h) => {
  await h.start()
  h.setFail(true)
  await h.render().apply()
  assert.equal(h.body(), body)
  assert.ok(h.render().candidate)
  assert.ok(h.render().message.includes('fixture save failure'))
  h.setFail(false)
  await h.render().apply()
  assert.equal(h.applies.length, 1)
}))
await test('refinement edits the candidate, not the chapter; failure and cancellation preserve the prior result', () => withHarness(async (h) => {
  await h.start()
  const before = h.render().candidate.text
  h.respond(async () => { throw new Error('temporary fixture failure') })
  h.render().refine('动作更简短')
  await new Promise((done) => setImmediate(done))
  assert.equal(h.render().candidate.text, before)
  assert.equal(h.body(), body)
  const hold = deferred()
  h.respond(() => hold.promise)
  h.render().refine('动作更简短')
  await new Promise((done) => setImmediate(done))
  assert.equal(h.render().cancel(), true)
  hold.resolve({ data: { revisedText: '迟到片段。' }, usedAI: true })
  await new Promise((done) => setImmediate(done))
  assert.equal(h.render().candidate.text, before)
  assert.equal(h.applies.length, 0)
}))
await test('changing chapters invalidates late responses even with identical prose', () => withHarness(async (h) => {
  const hold = deferred()
  h.respond(() => hold.promise)
  const running = h.start()
  await new Promise((done) => setImmediate(done))
  h.changeScope('chapter-b')
  hold.resolve({ data: { revisedText: '旧章迟到结果。' }, usedAI: true })
  await running
  assert.equal(h.render().candidate, null)
  assert.equal(h.body(), body)
}))
await test('relocation never silently downgrades a whole-chapter candidate to a local insertion', () => withHarness(async (h) => {
  await h.start()
  h.changeBody('新增开头。' + body)
  h.render().retarget()
  assert.equal(h.render().candidate.scope, 'chapter')
  assert.equal(h.render().stale, false)
  assert.equal(h.applies.length, 0)
}, body.replace(text, '她慢慢收好纸条。')))
await test('refinement detects a newly broad response against the original chapter, not the candidate fragment', () => withHarness(async (h) => {
  await h.start()
  h.respond(async () => ({ data: { revisedText: body.replace(text, '她慢慢收好纸条。') }, usedAI: true }))
  h.render().refine('再改一次')
  await new Promise((done) => setImmediate(done))
  assert.equal(h.render().candidate.scope, 'chapter')
  assert.equal(h.body(), body)
  await h.render().apply()
  assert.equal(h.confirms.at(-1).confirmLabel, '确认采用整章')
  assert.equal(h.body(), body.replace(text, '她慢慢收好纸条。'))
}))
await test('discard does not write prose', () => withHarness(async (h) => {
  await h.start()
  h.render().discard()
  assert.equal(h.render().candidate, null)
  assert.equal(h.applies.length, 0)
}))
await test('offline fallback is not presented as an AI candidate', () => withHarness(async (h) => {
  h.respond(async () => ({ ok: true, usedAI: false, data: { revisedText: text } }))
  await h.start()
  assert.equal(h.render().candidate, null)
  assert.equal(h.body(), body)
  assert.match(h.render().message, /没有生成 AI 修订/)
}))
await test('a local fallback cannot replace an existing edited candidate', () => withHarness(async (h) => {
  await h.start()
  h.render().edit('作者保留的修改。')
  h.respond(async () => ({ ok: true, usedAI: false, data: { revisedText: text } }))
  await h.start()
  assert.equal(h.render().candidate.text, '作者保留的修改。')
  assert.equal(h.body(), body)
}))
await test('refinement without an AI response preserves the prior result and reports the reason', () => withHarness(async (h) => {
  await h.start()
  const before = h.render().candidate
  h.respond(async () => ({ ok: false, usedAI: false, data: { revisedText: before.text }, error: '模型连接不可用。' }))
  h.render().refine('增加动作细节')
  await new Promise((done) => setImmediate(done))
  assert.equal(h.render().candidate, before)
  assert.equal(h.render().message, '模型连接不可用。')
  assert.equal(h.applies.length, 0)
}))
console.log(`AI rewrite result validation passed (${checks} behavior checks; hook state harness, not browser QA).`)

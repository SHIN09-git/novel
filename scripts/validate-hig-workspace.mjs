import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const require = createRequire(join(repoRoot, 'package.json'))
const { createElement } = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const output = await build({ entryPoints: [join(repoRoot, 'src/renderer/src/components/layoutParts/AppShell.tsx')],
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic',
  loader: { '.png': 'dataurl' }, write: false, logLevel: 'silent' })
const module = { exports: {} }
new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports)
const html = renderToStaticMarkup(createElement(module.exports.Shell, {
  project: { name: 'Synthetic Project', genre: '' }, view: 'chapters', status: 'Saved',
  setView() {}, setProjectId() {}, children: createElement('h1', null, 'Chapter')
}))
const checks = []
function check(name, run) { run(); checks.push(name) }
check('Shell exposes one current destination and labelled navigation landmarks', () => {
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1)
  assert(html.includes('<nav class="nav-list" aria-label='))
})
check('Sidebar disclosure uses a native labelled button outside its controlled region', () => {
  assert(html.includes('aria-controls="workspace-sidebar" aria-expanded="true"'))
  assert(html.indexOf('</aside>') < html.indexOf('class="sidebar-toggle icon-button"'))
  assert(html.includes('title="收起侧栏"'))
})
check('Skip link has a focusable main target and project back navigation stays available', () => {
  assert(html.includes('href="#workspace-main"'))
  assert(html.includes('id="workspace-main" tabindex="-1"'))
  assert(html.indexOf('返回项目列表') < html.indexOf('class="project-badge"'))
})
const css = await readFile(join(repoRoot, 'src/renderer/src/styles/base.css'), 'utf8')
const blocks = [...css.matchAll(/--color-bg:[\s\S]*?--sidebar:/g)].map(m => m[0])
const rgb = hex => hex.match(/[0-9a-f]{2}/gi).map(v => parseInt(v, 16) / 255)
const lum = hex => rgb(hex).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05)
check('Both explicit themes and system-dark provide readable text and primary action tokens', () => {
  assert.equal(blocks.length, 3)
  for (const block of blocks) {
    const get = name => block.match(new RegExp(`--color-${name}:\\s*(#[a-f0-9]{6})`))[1]
    for (const text of ['text-primary', 'text-secondary', 'text-muted']) {
      assert(contrast(get(text), get('bg')) >= 4.5, text)
      assert(contrast(get(text), get('surface')) >= 4.5, text)
      assert(contrast(get(text), get('surface-elevated')) >= 4.5, text)
    }
    assert(contrast(get('on-accent'), get('accent-strong')) >= 4.5)
  }
})
check('Input placeholders use readable theme text instead of browser default gray', () => {
  assert.match(css, /input::placeholder,\s*textarea::placeholder\s*\{\s*color: var\(--color-text-muted\);\s*opacity: 1;/)
})
const styles = async path => readFile(join(repoRoot, 'src/renderer/src/styles', path), 'utf8')
const writing = await styles('features/writing-workspace.css')
const character = await styles('views/characters.css')
check('Shared palette has no writing-route override or pale dark-mode character header', () => {
  assert(!writing.includes('--color-bg:') && !writing.includes('--writing-action-text:'))
  assert(!character.includes('linear-gradient'))
})
const shell = await styles('app-shell.css')
check('Collapsed navigation is hidden and releases its grid column', () => {
  assert(shell.includes('.sidebar[hidden] { display: none; }'))
  assert(shell.includes('.app-shell[data-sidebar-collapsed="true"]'))
})
const components = await styles('components.css')
check('Secondary commands share the themed button surface instead of browser default gray', () => {
  assert(components.replaceAll('\r\n', '\n').includes('.secondary-button,\n.ghost-button {'))
})
const tabBuild = await build({ entryPoints: [join(repoRoot, 'src/renderer/src/views/promptBuilder/PromptWorkspaceTabs.tsx')],
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false, logLevel: 'silent' })
const tabModule = { exports: {} }
new Function('require', 'module', 'exports', tabBuild.outputFiles[0].text)(require, tabModule, tabModule.exports)
check('Prompt tabs expose one keyboard stop and stable labelled panel relationships', () => {
  const markup = renderToStaticMarkup(createElement(tabModule.exports.PromptWorkspaceTabs, { activeTab: 'editor', onChange() {} }))
  assert.equal((markup.match(/aria-selected="true"/g) || []).length, 1)
  assert.equal((markup.match(/tabindex="0"/g) || []).length, 1)
  for (const id of ['task', 'editor', 'context', 'history']) assert(markup.includes(`aria-controls="prompt-workspace-panel-${id}"`))
})
check('Prompt tabs support arrow wrapping, Home, End and focus follows selection', () => {
  const selected = [], focused = []
  const original = globalThis.document
  globalThis.document = { getElementById: id => ({ focus: () => focused.push(id) }) }
  try {
    const tree = tabModule.exports.PromptWorkspaceTabs({ activeTab: 'task', onChange: tab => selected.push(tab) })
    const buttons = tree.props.children
    for (const key of ['ArrowLeft', 'End', 'ArrowRight', 'Home']) buttons[0].props.onKeyDown({ key, preventDefault() {} })
    assert.deepEqual(selected, ['history', 'history', 'editor', 'task'])
    assert.deepEqual(focused, selected.map(id => `prompt-workspace-tab-${id}`))
    buttons[0].props.onKeyDown({ key: 'Tab', preventDefault() { throw Error('Do not trap Tab') } })
  } finally { globalThis.document = original }
})
const promptCss = await styles('views/prompt.css')
check('Prompt editor uses theme surfaces and hidden panels cannot override native hidden', () => {
  assert(!promptCss.includes('#fffefc') && !promptCss.includes('rgba(255, 254, 250'))
  assert(promptCss.includes('[role="tabpanel"][hidden] { display: none; }'))
  assert(promptCss.includes('.prompt-editor:focus-visible'))
})
const characterBuild = await build({ entryPoints: [join(repoRoot, 'src/renderer/src/views/characters/CharacterWorkspaceTabs.tsx')],
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false, logLevel: 'silent' })
const characterModule = { exports: {} }
new Function('require', 'module', 'exports', characterBuild.outputFiles[0].text)(require, characterModule, characterModule.exports)
check('Character tabs label panels and pending candidates without extra keyboard stops', () => {
  const markup = renderToStaticMarkup(createElement(characterModule.exports.CharacterWorkspaceTabs, { activeTab: 'ledger', pendingCount: 2, onChange() {} }))
  assert.equal((markup.match(/aria-selected="true"/g) || []).length, 1)
  assert.equal((markup.match(/tabindex="0"/g) || []).length, 1)
  assert(markup.includes('aria-label="2 项待确认"'))
  for (const id of ['profile', 'ledger', 'logs']) assert(markup.includes(`aria-controls="character-panel-${id}"`))
})
check('Character tabs wrap focus, support Home/End, and do not trap Tab', () => {
  const selected = [], focused = []
  const original = globalThis.document
  globalThis.document = { getElementById: id => ({ focus: () => focused.push(id) }) }
  try {
    const tree = characterModule.exports.CharacterWorkspaceTabs({ activeTab: 'profile', pendingCount: 0, onChange: tab => selected.push(tab) })
    for (const key of ['ArrowLeft', 'End', 'ArrowRight', 'Home']) tree.props.children[0].props.onKeyDown({ key, preventDefault() {} })
    assert.deepEqual(selected, ['logs', 'logs', 'ledger', 'profile'])
    assert.deepEqual(focused, selected.map(id => `character-tab-${id}`))
    tree.props.children[0].props.onKeyDown({ key: 'Tab', preventDefault() { throw Error('Do not trap Tab') } })
  } finally { globalThis.document = original }
})
const characterView = await readFile(join(repoRoot, 'src/renderer/src/views/CharactersView.tsx'), 'utf8')
check('Character panels stay mounted and hide natively to retain drafts on tab change', () => {
  for (const id of ['profile', 'ledger', 'logs']) assert(characterView.includes(`hidden={activeTab !== '${id}'}`))
  assert(character.includes('[role="tabpanel"][hidden] { display: none; }'))
})
console.log(JSON.stringify({ ok: true, checks, actualRendererQA: 'node scripts/qa-hig-workspace.mjs (requires production build and matching packaged binding)' }, null, 2))

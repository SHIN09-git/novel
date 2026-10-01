#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'
import { assertProseLayout, assertProseFixture, withinDirectory, PROSE_VIEWPORTS } from './utils/qa-prose-first-workspaces.mjs'
import { createProseFirstFixture, loadProseFixtureDomain, startProseRejectSink, PROSE_FIXTURE_IDS, PROSE_TEXT } from './utils/qa-prose-first-fixture.mjs'

const require = createRequire(join(repoRoot, 'package.json'))
const checks = []
const failures = []
async function check(name, run) {
  try { await run(); checks.push(name) }
  catch (error) { failures.push({ name, error: error.message }) }
}
const noop = () => {}
const forbidden = () => { throw new Error('Lightweight UI validation must never call AI, storage or clipboard.') }

// Real component functions and real JSX elements, shallow at child boundaries.
// No DOM/CSS geometry is inferred from these trees; that belongs to the CDP helper.
async function component(path, name) {
  const output = await build({ entryPoints: [join(repoRoot, path)], bundle: true,
    platform: 'node', format: 'cjs', target: 'node22', packages: 'external',
    jsx: 'automatic', loader: { '.css': 'empty' }, write: false, logLevel: 'silent' })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports)
  return module.exports[name]
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return [tree, ...nodes(tree.props?.children)]
}
const byClass = (tree, className) => nodes(tree).find((node) => node.props?.className?.split(/\s+/).includes(className))
const byHandler = (tree, handler) => nodes(tree).find((node) => node.type === 'button' && node.props.onClick === handler)

await check('Relative layout checks reject narrow, hidden, covered, blank and overflowing prose at all four widths', () => {
  for (const viewport of PROSE_VIEWPORTS) {
    const valid = { viewport, root: { width: viewport.width * 0.85 }, main: { width: viewport.width * 0.6 },
      body: { width: viewport.width * 0.55, height: 400, visibleHeight: 120, lineHeight: 24, hit: true, hasText: true },
      documentWidth: viewport.width, bodyWidth: viewport.width, overflow: [], unlabelledTools: [], primaryContrasts: [{ ratio: 7 }] }
    assertProseLayout(valid)
    for (const change of [
      (sample) => { sample.main.width = sample.root.width * 0.3 },
      (sample) => { sample.body.width = sample.main.width * 0.3 },
      (sample) => { sample.body.visibleHeight = 0 },
      (sample) => { sample.body.hit = false },
      (sample) => { sample.body.hasText = false },
      (sample) => { sample.documentWidth++ },
      (sample) => { sample.overflow.push('PRE.raw') },
      (sample) => { sample.unlabelledTools.push('BUTTON.tool') },
      (sample) => { sample.primaryContrasts[0].ratio = 1.6 }
    ]) {
      const broken = structuredClone(valid); change(broken)
      assert.throws(() => assertProseLayout(broken))
    }
  }
})

await check('Isolation guards reject sibling paths, real projects, credentials and missing candidate prose', () => {
  assert(withinDirectory(join(repoRoot, 'tmp'), join(repoRoot, 'tmp/isolated/db.sqlite')))
  assert(!withinDirectory(join(repoRoot, 'tmp'), join(repoRoot, 'tmp-other/db.sqlite')))
  assert(!withinDirectory(repoRoot, repoRoot))
  const fixture = { projectId: 'qa-project', chapterId: 'qa-chapter', draftId: 'qa-draft', versionId: 'qa-version' }
  const loaded = { data: { projects: [{ id: fixture.projectId }], settings: { apiKey: '', hasApiKey: false },
    chapters: [{ id: fixture.chapterId, projectId: fixture.projectId, body: 'Chapter prose' }],
    chapterGenerationJobs: [{ id: 'qa-job', projectId: fixture.projectId, status: 'completed' }],
    generatedChapterDrafts: [{ id: fixture.draftId, projectId: fixture.projectId, jobId: 'qa-job', body: 'Draft prose' }],
    revisionSessions: [{ id: 'qa-session', projectId: fixture.projectId }],
    revisionVersions: [{ id: fixture.versionId, sessionId: 'qa-session', body: 'Candidate prose' }] } }
  assertProseFixture(loaded, fixture)
  for (const change of [
    (data) => { data.projects.push({ id: 'real-project' }) },
    (data) => { data.settings.hasApiKey = true },
    (data) => { data.chapterGenerationJobs[0].status = 'running' },
    (data) => { data.revisionVersions[0].body = '' },
    (data) => { data.revisionSessions[0].projectId = 'qa-other' }
  ]) {
    const broken = structuredClone(loaded); change(broken.data)
    assert.throws(() => assertProseFixture(broken, fixture))
  }
})

await check('W07 long-prose fixtures survive the real normalizer with source hashes, local-only roles and a plan-only job', async () => {
  const domain = await loadProseFixtureDomain()
  const original = domain.normalizeAppData({ projects: [{ id: 'qa-baseline', name: 'Baseline' }] })
  const before = structuredClone(original)
  const data = createProseFirstFixture(original, 'http://127.0.0.1:9999', domain.draftContentHash)
  assert.deepEqual(original, before, 'Pure fixture construction mutated the parent data.')
  const normalized = domain.normalizeAppData(data), ids = PROSE_FIXTURE_IDS
  assertProseFixture({ data: normalized }, ids)
  for (const collection of ['chapters', 'generatedChapterDrafts', 'revisionVersions']) {
    assert(normalized[collection][0].body.length > 2500)
    assert.equal(normalized[collection][0].body, data[collection][0].body)
  }
  const draft = normalized.generatedChapterDrafts[0], hash = domain.draftContentHash(draft.body)
  assert.equal(normalized.qualityGateReports[0].draftContentHash, hash)
  assert.equal(normalized.revisionRequests[0].sourceDraftContentHash, hash)
  assert.equal(normalized.revisionVersions[0].sourceContentHash, hash)
  assert.equal(normalized.revisionVersions[0].requestId, ids.requestId)
  assert.equal(normalized.revisionRequests[0].sessionId, ids.sessionId)
  const plan = normalized.chapterGenerationSteps.find((step) => step.jobId === ids.planJobId)
  assert.equal(JSON.parse(plan.output).chapterGoal, PROSE_TEXT.plan)
  assert(!normalized.generatedChapterDrafts.some((item) => item.jobId === ids.planJobId))
  const configs = [normalized.settings, ...Object.values(normalized.settings.pipelineModelRoles),
    ...normalized.chapterGenerationJobs.flatMap((job) => [job.aiRunConfig, ...Object.values(job.aiRunConfig.roles)])]
  assert(configs.every((config) => config.apiProvider === 'local' && config.baseUrl === 'http://127.0.0.1:9999'))
  assert.equal(normalized.settings.hasApiKey, false)
  assert.throws(() => createProseFirstFixture(data, 'http://127.0.0.1:9999', domain.draftContentHash))
  assert.throws(() => createProseFirstFixture(original, 'https://example.com', domain.draftContentHash))
})

await check('Reject-only loopback service counts every route without producing AI output', async () => {
  const sink = await startProseRejectSink()
  try {
    assert.equal((await fetch(sink.baseUrl + '/unexpected')).status, 503)
    assert.equal((await fetch(sink.baseUrl + '/v1/chat/completions', { method: 'POST', body: '{}' })).status, 503)
    assert.deepEqual(sink.requests, [{ method: 'GET', path: '/unexpected' }, { method: 'POST', path: '/v1/chat/completions' }])
  } finally { await sink.close() }
})

const HeaderActions = await component('src/renderer/src/views/reading/ReaderHeaderActions.tsx', 'ReaderHeaderActions')
await check('Reading tools retain actual callbacks and summary state changes', () => {
  let summary = false, font = 18
  const props = { onToggleSummaries: () => { summary = !summary },
    onDecreaseFont: () => { font-- }, onIncreaseFont: () => { font++ },
    onCopyAll: forbidden, onBackToChapters: forbidden }
  const tree = HeaderActions({ ...props, showSummaries: summary })
  for (const name of ['onToggleSummaries', 'onDecreaseFont', 'onIncreaseFont']) {
    const button = byHandler(tree, props[name])
    assert(button && !button.props.disabled, `${name} must be reachable through an enabled button.`)
    button.props.onClick()
  }
  assert.equal(summary, true); assert.equal(font, 18)
  byHandler(HeaderActions({ ...props, showSummaries: summary }), props.onToggleSummaries).props.onClick()
  assert.equal(summary, false)
})

const Article = await component('src/renderer/src/views/reading/ReaderChapterArticle.tsx', 'ReaderChapterArticle')
await check('Reading prose preserves selection anchors and editor pending-save locks', () => {
  let editing = false, contextEvents = 0
  const body = 'First paragraph.\nSecond paragraph.'
  const props = { chapter: { id: 'qa-chapter', projectId: 'qa-project', order: 1, title: 'Fixture', body, summary: 'Summary' },
    segments: [{ id: 'first', start: 0, end: 16, text: 'First paragraph.' }, { id: 'second', start: 17, end: 34, text: 'Second paragraph.' }],
    showSummary: false, isSaving: false, editDraft: body, getAiService: forbidden, rewriteContext: forbidden,
    onStatusChange: noop, onOpenRewriteMenu: () => { contextEvents++ }, onStartEditing: () => { editing = true },
    onBackToChapter: forbidden, onEditDraftChange: noop, onCancelEditing: () => { editing = false }, onSaveEditing: forbidden }
  const read = Article({ ...props, isEditing: editing })
  assert.equal(read.props['data-reader-chapter-id'], props.chapter.id)
  const segments = nodes(read).filter((node) => node.props?.['data-reader-segment-id'])
  assert.deepEqual(segments.map((node) => node.props.children), props.segments.map((segment) => segment.text))
  assert.deepEqual(segments.map((node) => node.props['data-reader-segment-start']), [0, 17])
  const prose = byClass(read, 'reader-prose') || byClass(read, 'reader-chapter-body')
  prose.props.onContextMenu({})
  assert.equal(contextEvents, 1)
  byHandler(read, props.onStartEditing).props.onClick()
  assert(editing)
  const editor = Article({ ...props, isEditing: editing })
  assert.equal(byClass(editor, 'reader-editor-textarea').props.value, body)
  byHandler(editor, props.onCancelEditing).props.onClick()
  assert(!editing)
  const busy = Article({ ...props, isEditing: true, isSaving: true })
  assert.equal(byClass(busy, 'reader-editor-textarea').props.disabled, true)
  assert(nodes(busy).filter((node) => node.type === 'button').every((node) => node.props.disabled))
})

const Rail = await component('src/renderer/src/views/reading/ReaderChapterRail.tsx', 'ReaderChapterRail')
await check('Reading jump rail dispatches the selected chapter ID and exposes its changed active state', () => {
  const chapters = [{ id: 'qa-one', order: 2, title: 'First' }, { id: 'qa-two', order: 7, title: 'Second' }]
  let activeChapterId = chapters[0].id
  const render = () => Rail({ chapters, activeChapterId, onJump: (id) => { activeChapterId = id } })
  const tree = render()
  const disclosure = nodes(tree).find((node) => node.type === 'details')
  assert(disclosure && nodes(disclosure).some((node) => node.type === 'summary'))
  const buttons = nodes(tree).filter((node) => node.type === 'button')
  assert.equal(buttons.length, 2)
  assert(buttons.every((node) => node.props['aria-label']))
  buttons[1].props.onClick()
  assert.equal(activeChapterId, chapters[1].id)
  const next = nodes(render()).filter((node) => node.type === 'button')
  assert.equal(next[1].props['aria-current'], 'true')
  assert.equal(next[0].props['aria-current'], undefined)
})

const Draft = await component('src/renderer/src/components/pipeline/PipelineDraftPanel.tsx', 'PipelineDraftPanel')
await check('Pipeline DOM order follows its visible tools, prose and diagnostics order', async () => {
  const Layout = await component('src/renderer/src/components/pipeline/PipelineLayout.tsx', 'PipelineLayout')
  const grid = byClass(Layout({ topBar: 'status', sidebar: 'tools', main: 'prose', inspector: 'diagnostics' }), 'pipeline-console-grid')
  assert.deepEqual(grid.props.children.map((child) => child.props.className), ['pipeline-sidebar', 'pipeline-main', 'pipeline-inspector'])
})
await check('Legacy pending revisions and shared generation statuses have author-facing Chinese labels', async () => {
  const revisionLabel = await component('src/renderer/src/views/revision/revisionTypeCatalog.ts', 'revisionVersionStatusLabel')
  const jobLabel = await component('src/renderer/src/components/pipeline/pipelineStatusLabels.ts', 'pipelineJobStatusLabel')
  assert.equal(revisionLabel('pending'), '待确认')
  assert.equal(revisionLabel('accepted'), '已接受')
  assert.equal(jobLabel('completed'), '生成完成')
  assert.equal(jobLabel('failed'), '生成失败')
})
await check('Pipeline body is bound to the draft and cannot be edited or accepted while running', () => {
  const draft = { id: 'qa-draft', title: 'Fixture', body: 'Original fixture prose.', status: 'draft' }
  const props = { draft, job: { id: 'qa-job' }, isRunning: false, onCopyDraft: forbidden,
    onAccept: forbidden, onAcceptUnreviewed: forbidden, onReject: forbidden, onRetryDraft: forbidden }
  const tree = Draft(props)
  const body = byClass(tree, 'pipeline-draft-body')
  assert.equal(body.props.value, draft.body); assert.equal(body.props.readOnly, true)
  const actions = byClass(Draft({ ...props, isRunning: true }), 'pipeline-draft-actions')
  assert(nodes(actions).filter((node) => node.type === 'button').every((node) => node.props.disabled))
  assert(!byClass(Draft({ ...props, draft: null }), 'pipeline-draft-body'))
})

const Artifact = await component('src/renderer/src/components/pipeline/PipelineCurrentArtifactPanel.tsx', 'PipelineCurrentArtifactPanel')
await check('A new plan-only job exposes its task despite a stale draft tab, and real tab callbacks still work', () => {
  const taskEditor = require('react').createElement('form', { 'data-fixture-task': true })
  const plan = { chapterTitle: 'Fixture plan', chapterGoal: 'Keep the saved task visible.' }
  const props = { activeTab: 'draft', taskEditor, job: { id: 'qa-plan-only', status: 'idle' },
    isRunning: false, draft: null,
    steps: [{ id: 'qa-plan-step', type: 'generate_chapter_plan', status: 'completed', output: JSON.stringify(plan) }],
    labels: { generate_chapter_plan: 'Plan' }, onAcceptDraft: forbidden, onRejectDraft: forbidden,
    onRetryDraft: forbidden, onCopyDraft: forbidden, onRetryStep: forbidden, onSkipStep: forbidden, canSkipStep: () => false,
    onActiveTabChange: (tab) => { props.activeTab = tab } }
  const first = Artifact(props)
  const task = byClass(first, 'pipeline-artifact-body')
  assert(task && !task.props.hidden, 'A valid plan with no draft must not be hidden by stale activeTab=draft.')
  assert(nodes(task).includes(taskEditor), 'The real task editor must remain mounted and visible.')
  assert(nodes(task).some((node) => node.type === 'pre' && JSON.parse(node.props.children).chapterGoal === plan.chapterGoal),
    'The generated plan must remain available through the raw-plan disclosure.')
  const stepsButton = nodes(byClass(first, 'pipeline-artifact-tabs')).find((node) => node.type === 'button' && node.props.children === '步骤输出')
  stepsButton.props.onClick()
  assert.equal(props.activeTab, 'steps')
  assert(byClass(Artifact(props), 'pipeline-step-output-list'), 'Explicit steps navigation must not be overridden by the fallback.')
  const planButton = nodes(byClass(Artifact(props), 'pipeline-artifact-tabs')).find((node) => node.type === 'button' && node.props.children === '任务书')
  planButton.props.onClick()
  assert.equal(props.activeTab, 'plan')
  assert(!byClass(Artifact(props), 'pipeline-artifact-body').props.hidden)
})

const Comparison = await component('src/renderer/src/views/revision/RevisionComparisonPanel.tsx', 'RevisionComparisonPanel')
await check('Revision mode callbacks switch real candidate/diff branches without writeback; historical bodies stay read-only', () => {
  const version = { id: 'qa-version', requestId: 'qa-request', body: 'Candidate prose.', status: 'pending' }
  let mode = 'diff'
  const props = { projectId: 'qa-project', sourceBody: 'Original prose.', versions: [version], selectedVersion: version,
    selectedVersionForView: version, selectedVersionCanEdit: true, revisionType: 'custom', instruction: '', loading: false,
    requestTypeById: new Map(), getAiService: forbidden, buildRevisionContext: forbidden, onMessage: noop,
    onGenerateRevision: forbidden, onSelectVersion: forbidden, onViewModeChange: (value) => { mode = value },
    onEditedBodyChange: forbidden, onApplyRewrite: forbidden, onPersistEditedBody: forbidden,
    onCopyVersion: forbidden, onAcceptVersion: forbidden, onRejectVersion: forbidden }
  const tree = () => Comparison({ ...props, revisionViewMode: mode })
  const switcher = byClass(tree(), 'revision-view-switch')
  const buttons = nodes(switcher).filter((node) => node.type === 'button')
  assert.equal(buttons.length, 2)
  assert(!byClass(tree(), 'revised'))
  buttons.find((button) => !button.props['aria-pressed']).props.onClick()
  assert.equal(mode, 'revised')
  assert.equal(byClass(tree(), 'revised').props.value, version.body)
  const source = byClass(tree(), 'original')
  assert.equal(source.props.value, props.sourceBody); assert.equal(source.props.readOnly, true)
  const disclosure = byClass(tree(), 'revision-source-disclosure')
  assert.equal(disclosure.type, 'details'); assert(!disclosure.props.open)
  assert(nodes(disclosure).some((node) => node.type === 'summary'))
  const historical = Comparison({ ...props, revisionViewMode: 'revised', selectedVersionCanEdit: false,
    selectedVersion: { ...version, status: 'accepted' }, selectedVersionForView: { ...version, status: 'accepted' } })
  const readonly = byClass(historical, 'revised')
  assert.equal(readonly.props.readOnly, true)
  assert.equal(readonly.props.onChange, undefined); assert.equal(readonly.props.onBlur, undefined)
  assert.equal(readonly.props.getAiService, undefined)
})

console.log(JSON.stringify({ ok: failures.length === 0, checks, failures, realRendererQA: 'not run; parent calls runProseFirstWorkspacesQA',
  scope: 'In-memory React component contracts and negative geometry/isolation tests; no Electron, native switch, filesystem fixture or paid AI.' }, null, 2))
if (failures.length) process.exitCode = 1

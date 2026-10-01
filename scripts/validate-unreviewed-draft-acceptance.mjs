import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

// Standalone W02 contract suite. Native SQLite uses only mkdtemp fixtures and
// the already-installed Node addon, never Electron, rebuilds or user databases.
// sqlite-boundary remains a separately labelled simulated persistence test.
const time = '2026-09-06T10:00:00.000Z'
const acceptedAt = '2026-09-06T11:00:00.000Z'
const later = '2026-09-06T12:00:00.000Z'
const cases = []
const test = (name, run) => cases.push({ name, run })
const copy = (value) => structuredClone(value)
const tmpBase = join(repoRoot, 'tmp')
const require = createRequire(import.meta.url)
const nativeHandles = new Set()
let nativeDatabase
let nativeSkipReason = ''
let outDir
let modules

function probeNativeSqlite() {
  if (process.versions.electron) {
    nativeSkipReason = 'Electron runtime is forbidden; run this suite with Node.'
    return
  }
  let probe
  try {
    const Database = require('better-sqlite3')
    probe = new Database(':memory:')
    assert.equal(probe.prepare('SELECT 137 AS probe_value').get().probe_value, 137)
    nativeDatabase = Database
  } catch (error) {
    nativeSkipReason = `Node ${process.version} ABI ${process.versions.modules}: ${error.message ?? error}`
  } finally {
    probe?.close()
  }
}

function nativeStorage(path) {
  const storage = new modules.sqlite.SqliteStorageService(path)
  nativeHandles.add(storage)
  return storage
}

function nativeConnection(path, readonly = false) {
  const db = new nativeDatabase(path, { readonly, fileMustExist: true })
  nativeHandles.add(db)
  return db
}

function closeNativeHandles() {
  for (const handle of nativeHandles) {
    try { handle.close() } finally { nativeHandles.delete(handle) }
  }
}

async function bundle(entry, name) {
  const outfile = join(outDir, `${name}.mjs`)
  await build({
    entryPoints: [join(repoRoot, entry)], outfile, bundle: true,
    platform: 'node', format: 'esm', target: 'node22',
    external: ['better-sqlite3', 'electron', 'react', 'react/jsx-runtime'], logLevel: 'silent'
  })
  return import(pathToFileURL(outfile).href)
}

async function bundleViewProbe() {
  // Real React SSR and real view/selection/acceptance code, with only unrelated
  // pipeline services and the console boundary stubbed. This is NOT browser QA.
  const stubs = {
    GenerationPipelineConsole: 'export let captured; export function GenerationPipelineConsole(props) { captured = props; return null }',
    ConfirmDialog: 'export const useConfirm = () => async () => true',
    usePipelineConfigState: `export const usePipelineConfigState = () => ({
      selectedJobId: 'j1', targetChapterOrder: 7, nextChapter: 8, contextSource: 'auto',
      snapshots: [], readerEmotionPresets: []
    })`,
    usePipelineRunner: `export const canSkipPipelineStep = () => false;
      export const PIPELINE_STEP_LABELS = {};
      export const usePipelineRunner = () => ({ isPipelineRunning: false, setPipelineMessage() {} })`,
    useMemoryCandidates: 'export const useMemoryCandidates = () => ({})',
    usePipelinePrimaryAction: 'export const usePipelinePrimaryAction = () => ({})',
    usePipelineRevisionActions: 'export const usePipelineRevisionActions = () => ({})',
    usePipelineTraceActions: 'export const usePipelineTraceActions = () => ({})'
  }
  const outfile = join(outDir, 'view-probe.mjs')
  await build({
    stdin: {
      contents: `export { GenerationPipelineView } from './src/renderer/src/views/GenerationPipelineView';
        export { captured } from 'GenerationPipelineConsole';`,
      resolveDir: repoRoot, sourcefile: 'w02-view-probe.ts', loader: 'ts'
    },
    outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22',
    external: ['react', 'react/jsx-runtime'], logLevel: 'silent',
    plugins: [{ name: 'w02-view-boundaries', setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        const key = args.path.split('/').at(-1)
        return Object.hasOwn(stubs, key) ? { path: key, namespace: 'w02-view-stub' } : undefined
      })
      builder.onLoad({ filter: /.*/, namespace: 'w02-view-stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }))
    } }]
  })
  return import(pathToFileURL(outfile).href)
}

function renderViewProbe(data) {
  const { createElement } = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  let current = copy(data)
  let saves = 0
  renderToStaticMarkup(createElement(modules.view.GenerationPipelineView, {
    data, project: data.projects[0],
    saveData: async (update) => {
      current = typeof update === 'function' ? update(current) : update
      saves += 1
      return { ok: true }
    }
  }))
  return { props: modules.view.captured, current: () => current, saves: () => saves }
}

async function findReviewHelper() {
  if (typeof modules.commit.buildChapterAcceptanceReview === 'function') {
    return modules.commit.buildChapterAcceptanceReview
  }
  // The contract fixes the export, not its owning file. Discover only service
  // source files, never runtime settings, user data, or unrelated directories.
  for (const directory of ['src/services', 'src/services/commitBundles']) {
    for (const file of (await readdir(join(repoRoot, directory))).sort()) {
      if (!file.endsWith('.ts')) continue
      const entry = `${directory}/${file}`
      const source = await readFile(join(repoRoot, entry), 'utf8')
      if (!/export\s+(?:function|const)\s+buildChapterAcceptanceReview\b/.test(source)) continue
      return (await bundle(entry, 'acceptance-review')).buildChapterAcceptanceReview
    }
  }
  return undefined
}

function fixture({ recipe = true, quality = null, editorial = null, existingChapter = true } = {}) {
  const data = modules.defaults.normalizeAppData({
    schemaVersion: 3,
    projects: [{ id: 'p1', name: 'W02 fixture', createdAt: time, updatedAt: time }],
    chapters: existingChapter ? [{
      id: 'c1', projectId: 'p1', order: 7, title: 'Original title', body: 'Original chapter body.',
      createdAt: time, updatedAt: time
    }] : [],
    chapterGenerationJobs: [{
      id: 'j1', projectId: 'p1', targetChapterOrder: 7, contextSource: 'auto', pipelineMode: 'standard',
      ...(recipe ? { pipelineRecipe: modules.recipes.PipelineRecipeService.getDefaultRecipe('standard') } : {}),
      status: 'completed', currentStep: 'await_user_confirmation', errorMessage: '', createdAt: time, updatedAt: time
    }],
    generatedChapterDrafts: [{
      id: 'd1', projectId: 'p1', jobId: 'j1', chapterId: existingChapter ? 'c1' : null,
      title: 'Draft title', body: 'Current draft body.', summary: 'Draft summary.', status: 'draft',
      tokenEstimate: 12, createdAt: time, updatedAt: time
    }],
    memoryUpdateCandidates: [{
      id: 'm1', projectId: 'p1', jobId: 'j1', type: 'chapter_review', status: 'pending',
      title: 'Pending memory', description: '', proposedPatch: { kind: 'legacy_raw', rawText: '' },
      createdAt: time, updatedAt: time
    }]
  })
  if (quality) data.qualityGateReports = [qualityReport(data, quality)]
  if (editorial) data.editorialVerdicts = [verdict(data, editorial)]
  return data
}

const draftOf = (data) => data.generatedChapterDrafts.find((item) => item.id === 'd1')
const hashOf = (data) => modules.binding.draftContentHash(draftOf(data).body)

function qualityReport(data, status, overrides = {}) {
  return {
    id: 'q1', projectId: 'p1', jobId: 'j1', chapterId: draftOf(data).chapterId, draftId: 'd1',
    draftContentHash: hashOf(data), pass: status !== 'blocked',
    overallScore: status === 'blocked' ? 42 : status === 'needs_review' ? 72 : 92,
    dimensions: Object.fromEntries([
      'characterConsistency', 'characterStateConsistency', 'foreshadowingControl', 'chapterContinuity',
      'styleMatch', 'pacing', 'promptCompliance', 'contextRelevanceCompliance'
    ].map((key) => [key, 90])),
    issues: [], requiredFixes: status === 'blocked' ? ['Resolve known failure.'] : [],
    optionalSuggestions: [], createdAt: time, ...overrides
  }
}

function verdict(data, status, overrides = {}) {
  return {
    id: 'v1', projectId: 'p1', jobId: 'j1', chapterId: draftOf(data).chapterId, draftId: 'd1',
    draftContentHash: hashOf(data), draftRevision: draftOf(data).updatedAt, status,
    canAccept: status === 'approved' || status === 'advisory', summary: `Editorial ${status}`,
    coverage: { quality: data.qualityGateReports.length ? 'current' : 'unavailable', consistency: 'not_requested' },
    blockers: [], advisories: [], actions: [],
    sourceRefs: {
      qualityGateReportId: data.qualityGateReports[0]?.id ?? null,
      characterStateIssueIds: [], ignoredStaleReportIds: []
    },
    schemaVersion: 1, createdAt: time, updatedAt: time, ...overrides
  }
}

function review(data, mode, required) {
  assert.equal(typeof modules.review, 'function', 'Missing contract export buildChapterAcceptanceReview')
  return modules.review(data, draftOf(data), mode, required)
}

function expectedReview(data, mode, qualityStatus = 'not_available', editorialStatus = 'not_available', required = true) {
  return {
    mode, draftContentHash: hashOf(data), editorialRequired: required,
    qualityGateReportId: qualityStatus === 'not_available' ? null : 'q1',
    editorialVerdictId: editorialStatus === 'not_available' ? null : 'v1',
    qualityStatus, editorialStatus
  }
}

function commit(data, mode, extra = {}) {
  return modules.commit.buildAcceptedDraftCommitBundle({
    appData: data, projectId: 'p1', draftId: 'd1', targetChapterOrder: 7,
    commitId: 'commit1', chapterId: 'c1', chapterVersionId: 'version1', acceptedAt,
    ...(mode === undefined ? {} : { acceptanceMode: mode }), ...extra
  })
}

function unreviewedBundle(data) {
  const result = commit(data, 'unreviewed')
  assert.ok(result.acceptanceReview, 'Explicit mode must persist acceptanceReview')
  return result
}

function legacyRecord(data) {
  const result = commit(data)
  assert.equal(result.acceptanceReview, undefined, 'Legacy builder must not fabricate a review snapshot')
  return result
}

function registerHelperTests() {
  test('helper: missing review is explicit and pure', () => {
    const data = fixture()
    const before = copy(data)
    assert.deepEqual(review(data, 'unreviewed'), expectedReview(data, 'unreviewed'))
    assert.deepEqual(data, before)
  })
  test('helper: reviewed requires a current quality report', () => {
    assert.throws(() => review(fixture(), 'reviewed'))
  })
  test('helper: invalid mode cannot silently become unreviewed', () => {
    assert.throws(() => review(fixture(), 'invalid'))
  })
  test('helper: recipe editorial requirement cannot be disabled by false', () => {
    const data = fixture({ quality: 'passed' })
    assert.throws(() => review(data, 'reviewed', false))
    assert.equal(review(data, 'unreviewed', false).editorialRequired, true)
  })
  test('helper: non-recipe reviewed allows quality-only unless explicitly required', () => {
    const data = fixture({ recipe: false, quality: 'passed' })
    assert.deepEqual(review(data, 'reviewed'), expectedReview(data, 'reviewed', 'passed', 'not_available', false))
    assert.throws(() => review(data, 'reviewed', true))
    assert.throws(() => review(data, 'unreviewed'))
  })
  for (const [quality, editorial] of [['passed', 'approved'], ['needs_review', 'advisory'], ['blocked', 'blocked']]) {
    test(`helper: complete ${quality}/${editorial} uses reviewed, never unreviewed`, () => {
      const data = fixture({ quality, editorial })
      assert.deepEqual(review(data, 'reviewed'), expectedReview(data, 'reviewed', quality, editorial))
      assert.throws(() => review(data, 'unreviewed'))
    })
  }
  for (const quality of [null, 'passed', 'blocked']) {
    for (const editorial of [null, 'incomplete']) {
      test(`helper: partial ${quality}/${editorial} keeps available evidence`, () => {
        const data = fixture({ quality, editorial })
        const before = copy(data)
        assert.deepEqual(review(data, 'unreviewed'), expectedReview(data, 'unreviewed', quality ?? 'not_available', editorial ?? 'not_available'))
        assert.throws(() => review(data, 'reviewed'))
        assert.deepEqual(data, before)
      })
    }
  }
  test('helper: old passing report and verdict are not current evidence', () => {
    const data = fixture({ quality: 'passed', editorial: 'approved' })
    draftOf(data).body = 'Revised body without review.'
    draftOf(data).updatedAt = later
    const before = copy(data)
    assert.deepEqual(review(data, 'unreviewed'), expectedReview(data, 'unreviewed'))
    assert.throws(() => review(data, 'reviewed'))
    assert.deepEqual(data, before)
  })
  test('helper: unchanged body with a newer draft revision invalidates old verdict', () => {
    const data = fixture({ quality: 'passed', editorial: 'approved' })
    draftOf(data).updatedAt = later
    assert.throws(() => review(data, 'reviewed'))
    assert.deepEqual(review(data, 'unreviewed'), expectedReview(data, 'unreviewed', 'passed'))
  })
  for (const key of ['projectId', 'jobId', 'draftId']) {
    test(`helper: foreign ${key} cannot supply reviewed evidence`, () => {
      const data = fixture({ quality: 'passed', editorial: 'approved' })
      data.qualityGateReports[0][key] = 'foreign'
      data.editorialVerdicts[0][key] = 'foreign'
      assert.throws(() => review(data, 'reviewed'))
      assert.deepEqual(review(data, 'unreviewed'), expectedReview(data, 'unreviewed'))
    })
  }
  test('helper: newest complete failure wins over an older pass', () => {
    const data = fixture({ quality: 'passed', editorial: 'approved' })
    data.qualityGateReports.push(qualityReport(data, 'blocked', { id: 'q2', createdAt: later }))
    data.editorialVerdicts.push(verdict(data, 'blocked', {
      id: 'v2', createdAt: later, updatedAt: later,
      sourceRefs: { qualityGateReportId: 'q2', characterStateIssueIds: [], ignoredStaleReportIds: [] }
    }))
    const result = review(data, 'reviewed')
    assert.equal(result.qualityGateReportId, 'q2')
    assert.equal(result.editorialVerdictId, 'v2')
    assert.equal(result.qualityStatus, 'blocked')
    assert.equal(result.editorialStatus, 'blocked')
    assert.throws(() => review(data, 'unreviewed'))
  })
  test('helper: verdict referring to an older report does not complete current review', () => {
    const data = fixture({ quality: 'passed', editorial: 'approved' })
    data.qualityGateReports.push(qualityReport(data, 'blocked', { id: 'q2', createdAt: later }))
    assert.throws(() => review(data, 'reviewed'))
    const result = review(data, 'unreviewed')
    assert.equal(result.qualityGateReportId, 'q2')
    assert.equal(result.qualityStatus, 'blocked')
    assert.equal(result.editorialVerdictId, 'v1')
    assert.equal(data.qualityGateReports[1].pass, false)
  })
}

function registerBundleTests() {
  test('bundle: omitted mode preserves legacy behavior without a passing snapshot', () => {
    const data = fixture()
    const result = legacyRecord(data)
    assert.equal(result.qualityGateReportId, null)
    assert.equal(modules.commit.applyChapterCommitBundleToAppData(data, result).chapterCommitBundles.length, 1)
  })
  test('bundle: reviewed uses the pre-acceptance draft revision', () => {
    const data = fixture({ quality: 'passed', editorial: 'approved' })
    const result = commit(data, 'reviewed')
    assert.deepEqual(result.acceptanceReview, expectedReview(data, 'reviewed', 'passed', 'approved'))
    assert.equal(result.generatedDraft.updatedAt, acceptedAt)
    modules.commit.validateChapterCommitBundle(result, data)
  })
  test('bundle: unreviewed stores no synthetic diagnostic and leaves pending memory alone', () => {
    const data = fixture()
    const before = copy(data)
    const result = unreviewedBundle(data)
    assert.deepEqual(result.acceptanceReview, expectedReview(data, 'unreviewed'))
    const next = modules.commit.applyChapterCommitBundleToAppData(data, result)
    assert.deepEqual(next.qualityGateReports, [])
    assert.deepEqual(next.editorialVerdicts, [])
    assert.deepEqual(next.memoryUpdateCandidates, data.memoryUpdateCandidates)
    assert.equal(next.chapters[0].body, draftOf(data).body)
    assert.deepEqual(data, before)
  })
  test('bundle: stale reports remain history but are not bound to acceptance', () => {
    const data = fixture({ quality: 'blocked', editorial: 'blocked' })
    draftOf(data).body = 'A genuinely revised draft.'
    draftOf(data).updatedAt = later
    const result = unreviewedBundle(data)
    assert.deepEqual(result.acceptanceReview, expectedReview(data, 'unreviewed'))
    assert.equal(result.qualityGateReportId, null)
    assert.deepEqual(result.qualityGateReports, [])
    const next = modules.commit.applyChapterCommitBundleToAppData(data, result)
    assert.deepEqual(next.qualityGateReports, data.qualityGateReports)
    assert.deepEqual(next.editorialVerdicts, data.editorialVerdicts)
  })
  test('bundle: partial failed report remains blocked and referenced', () => {
    const data = fixture({ quality: 'blocked', editorial: 'incomplete' })
    const result = unreviewedBundle(data)
    assert.deepEqual(result.acceptanceReview, expectedReview(data, 'unreviewed', 'blocked', 'incomplete'))
    const next = modules.commit.applyChapterCommitBundleToAppData(data, result)
    assert.deepEqual(next.qualityGateReports, modules.defaults.normalizeAppData(data).qualityGateReports)
    assert.equal(next.qualityGateReports[0].pass, false)
    assert.equal(next.qualityGateReports[0].overallScore, data.qualityGateReports[0].overallScore)
    assert.deepEqual(next.editorialVerdicts, data.editorialVerdicts)
  })
  for (const [field, value] of [
    ['mode', 'reviewed'], ['mode', 'invalid'], ['draftContentHash', 'forged'],
    ['editorialRequired', false], ['qualityGateReportId', 'forged'], ['editorialVerdictId', 'forged'],
    ['qualityStatus', 'passed'], ['editorialStatus', 'approved']
  ]) {
    test(`validator: rejects forged snapshot ${field}=${value}`, () => {
      const data = fixture()
      const result = unreviewedBundle(data)
      result.acceptanceReview[field] = value
      assert.throws(() => modules.commit.validateChapterCommitBundle(result, data))
    })
  }
  test('validator: current reports are re-evaluated at write time', () => {
    const data = fixture()
    const result = unreviewedBundle(data)
    data.qualityGateReports = [qualityReport(data, 'blocked')]
    data.editorialVerdicts = [verdict(data, 'blocked')]
    assert.throws(() => modules.commit.validateChapterCommitBundle(result, data))
  })
  for (const collection of ['acceptedMemoryUpdateCandidates', 'acceptedCharacterStateChangeCandidates']) {
    test(`validator: unreviewed rejects ${collection}`, () => {
      const data = fixture()
      const result = unreviewedBundle(data)
      result[collection] = collection === 'acceptedMemoryUpdateCandidates'
        ? [{ ...data.memoryUpdateCandidates[0], status: 'accepted' }]
        : [{ id: 'state1', projectId: 'p1', chapterId: 'c1', characterId: 'char1', status: 'accepted' }]
      assert.throws(() => modules.commit.validateChapterCommitBundle(result, data))
    })
  }
  for (const [label, mutate] of [
    ['missing draft', (data) => { data.generatedChapterDrafts = [] }],
    ['missing job', (data) => { data.chapterGenerationJobs = [] }],
    ['foreign source draft', (data) => { draftOf(data).projectId = 'foreign' }],
    ['foreign job', (data) => { data.chapterGenerationJobs[0].projectId = 'foreign' }],
    ['foreign chapter ID', (data) => { data.chapters[0].projectId = 'foreign' }],
    ['draft body changed', (data) => { draftOf(data).body = 'Concurrent draft edit.' }]
  ]) {
    test(`validator: unreviewed still rejects ${label}`, () => {
      const data = fixture()
      const result = unreviewedBundle(data)
      mutate(data)
      assert.throws(() => modules.commit.validateChapterCommitBundle(result, data))
    })
  }
  for (const field of ['jobId', 'generatedDraftId']) {
    test(`validator: explicit snapshot cannot drop ${field} to evade source checks`, () => {
      const data = fixture()
      const result = unreviewedBundle(data)
      result[field] = null
      assert.throws(() => modules.commit.validateChapterCommitBundle(result, data))
    })
  }
  test('validator: changing chapter and version together cannot evade source body binding', () => {
    const data = fixture()
    const result = unreviewedBundle(data)
    result.chapter.body = 'Forged accepted text.'
    result.chapterVersion.body = result.chapter.body
    assert.throws(() => modules.commit.validateChapterCommitBundle(result, data))
  })
}

function uiHarness(data, { confirmed = true, mutate, transactional = true } = {}) {
  let current = copy(data)
  const calls = { confirmations: [], saves: 0, messages: [], bundles: [] }
  const view = copy(data)
  const hook = modules.ui.useDraftAcceptance({
    project: view.projects[0], selectedJob: view.chapterGenerationJobs[0], targetChapterOrder: 7,
    chapters: view.chapters, qualityGateReports: view.qualityGateReports, editorialVerdicts: view.editorialVerdicts,
    confirmAction: async (prompt) => {
      calls.confirmations.push(prompt)
      if (mutate) mutate(current)
      return confirmed
    },
    saveData: async (update) => {
      const next = typeof update === 'function' ? update(current) : update
      current = next
      calls.saves += 1
      return { ok: true }
    },
    ...(transactional ? { saveChapterCommitBundle: async (buildCommit) => {
      const result = buildCommit(current)
      calls.bundles.push(result.bundle)
      current = result.next
      calls.saves += 1
    } } : {}),
    setPipelineMessage: (message) => calls.messages.push(message)
  })
  return { hook, calls, draft: draftOf(view), current: () => current }
}

function registerUiTests() {
  test('UI: default reviewed does not silently switch to unreviewed', async () => {
    const h = uiHarness(fixture())
    await h.hook.acceptDraft(h.draft)
    assert.equal(h.calls.saves, 0)
    assert.ok(h.calls.messages.length)
  })
  test('UI: successful default acceptance explicitly records reviewed mode', async () => {
    const h = uiHarness(fixture({ quality: 'passed', editorial: 'approved' }))
    await h.hook.acceptDraft(h.draft)
    assert.equal(h.calls.saves, 1)
    assert.equal(h.current().chapterCommitBundles[0].acceptanceReview?.mode, 'reviewed')
  })
  for (const alias of [false, true]) {
    for (const transactional of [false, true]) {
      test(`UI: ${alias ? 'alias' : 'explicit mode'} confirms once, transactional=${transactional}`, async () => {
        const h = uiHarness(fixture(), { transactional })
        if (alias) {
          assert.equal(typeof h.hook.acceptDraftUnreviewed, 'function')
          await h.hook.acceptDraftUnreviewed(h.draft)
        } else await h.hook.acceptDraft(h.draft, 'unreviewed')
        assert.equal(h.calls.confirmations.length, 1)
        assert.equal(h.calls.saves, 1)
        assert.equal(h.current().chapterCommitBundles[0].acceptanceReview.mode, 'unreviewed')
      })
    }
  }
  test('UI: unreviewed new chapter still requires explicit confirmation', async () => {
    const h = uiHarness(fixture({ existingChapter: false }))
    await h.hook.acceptDraft(h.draft, 'unreviewed')
    assert.equal(h.calls.confirmations.length, 1)
    assert.equal(h.calls.saves, 1)
  })
  test('UI: cancellation leaves all state unchanged', async () => {
    const data = fixture()
    const h = uiHarness(data, { confirmed: false })
    await h.hook.acceptDraft(h.draft, 'unreviewed')
    assert.equal(h.calls.confirmations.length, 1)
    assert.equal(h.calls.saves, 0)
    assert.deepEqual(h.current(), data)
  })
  test('UI: complete failure uses one explicit reviewed confirmation', async () => {
    const data = fixture({ quality: 'blocked', editorial: 'blocked' })
    const rejected = uiHarness(data)
    await rejected.hook.acceptDraft(rejected.draft, 'unreviewed')
    assert.equal(rejected.calls.saves, 0)
    const h = uiHarness(data)
    await h.hook.acceptDraft(h.draft)
    assert.equal(h.calls.confirmations.length, 1)
    assert.equal(h.calls.saves, 1)
    assert.equal(h.current().chapterCommitBundles[0].acceptanceReview.qualityStatus, 'blocked')
    assert.equal(h.current().qualityGateReports[0].pass, false)
  })
  test('UI: partial failure permits keeping work but explicitly displays the failed risk', async () => {
    const data = fixture({ quality: 'blocked', editorial: 'incomplete' })
    const h = uiHarness(data)
    await h.hook.acceptDraft(h.draft, 'unreviewed')
    assert.equal(h.calls.confirmations.length, 1)
    const prompt = h.calls.confirmations[0]
    assert.match(`${prompt.title}\n${prompt.message}`, /\u672a\u901a\u8fc7|\u5931\u8d25|blocked/i,
      'Confirmation must disclose known failure, not merely missing diagnostics')
    assert.equal(h.calls.saves, 1)
    assert.deepEqual(h.current().chapterCommitBundles[0].acceptanceReview,
      expectedReview(data, 'unreviewed', 'blocked', 'incomplete'))
    assert.deepEqual(h.current().qualityGateReports, modules.defaults.normalizeAppData(data).qualityGateReports)
    assert.equal(h.current().qualityGateReports[0].pass, false)
    assert.deepEqual(h.current().editorialVerdicts, data.editorialVerdicts)
  })
  for (const mode of ['reviewed', 'unreviewed']) {
    test(`UI: running job cannot be accepted in ${mode} mode`, async () => {
      const data = fixture(mode === 'reviewed' ? { quality: 'passed', editorial: 'approved' } : {})
      data.chapterGenerationJobs[0].status = 'running'
      const h = uiHarness(data)
      await h.hook.acceptDraft(h.draft, mode)
      assert.equal(h.calls.saves, 0)
    })
  }
  for (const [label, mutate] of [
    ['draft body', (data) => { draftOf(data).body = 'Concurrent draft.' }],
    ['target body', (data) => { data.chapters[0].body = 'Concurrent chapter.' }],
    ['missing source', (data) => { data.generatedChapterDrafts = [] }],
    ['review completes with failure', (data) => {
      data.qualityGateReports = [qualityReport(data, 'blocked')]
      data.editorialVerdicts = [verdict(data, 'blocked')]
    }]
  ]) {
    test(`UI: confirmation race rejects ${label}`, async () => {
      const h = uiHarness(fixture(), { mutate })
      await h.hook.acceptDraft(h.draft, 'unreviewed')
      assert.equal(h.calls.confirmations.length, 1)
      assert.equal(h.calls.saves, 0)
    })
  }
}

function sqliteBoundary(initial) {
  // Keep saveChapterCommitBundle, saveEntityBundle, revision checks and entity
  // mapping real. Only database I/O is substituted; rollback here is simulated.
  let state = { data: copy(initial), revision: 'fixture-revision' }
  let inTransaction = false
  let failWrite = false
  const db = { transaction: (operation) => (...args) => {
    const before = copy(state)
    inTransaction = true
    try { return operation(...args) } catch (error) { state = before; throw error }
    finally { inTransaction = false }
  } }
  const storage = Object.create(modules.sqlite.SqliteStorageService.prototype)
  storage.storagePath = join(outDir, 'not-opened.sqlite')
  storage.open = async () => db
  storage.isEmpty = () => false
  storage.readAppData = () => copy(state.data)
  storage.currentRevision = () => state.revision
  storage.writeEntityEntries = (_db, entries) => {
    assert.ok(inTransaction, 'Entry writes must stay inside the transaction boundary')
    for (const { collection, value } of entries) {
      const index = state.data[collection].findIndex((item) => item.id === value.id)
      if (index < 0) state.data[collection].push(copy(value))
      else state.data[collection][index] = copy(value)
      if (failWrite) throw new Error('Injected persistence failure')
    }
  }
  storage.writeRevisionMeta = (_db, revision) => {
    assert.ok(inTransaction)
    state.revision = revision
  }
  storage.loadSnapshot = async () => copy(state)
  storage.saveIfCurrent = async (data, expected) => {
    assert.equal(expected, state.revision)
    state = { data: copy(data), revision: `${state.revision}-edit` }
    return { ok: true, revision: state.revision }
  }
  return { storage, failNextWrite: () => { failWrite = true } }
}

async function storageFor(kind, data) {
  if (kind === 'sqlite-boundary') return sqliteBoundary(data)
  const directory = await mkdtemp(join(outDir, `${kind}-`))
  if (kind === 'sqlite-native') {
    assert.ok(nativeDatabase, 'Native availability must be checked before running native cases')
    const path = join(directory, 'data.sqlite')
    const storage = nativeStorage(path)
    await storage.save(data)
    return { storage, path }
  }
  const storage = new modules.json.JsonStorageService(join(directory, 'data.json'))
  await storage.save(data)
  return { storage }
}

function registerStorageTests() {
  for (const kind of ['json', 'sqlite-boundary', 'sqlite-native']) {
    test(`${kind}: snapshot round-trip and exact replay preserve revision`, async () => {
      const { storage } = await storageFor(kind, fixture())
      const initial = await storage.loadSnapshot()
      const result = unreviewedBundle(initial.data)
      const write = await storage.saveChapterCommitBundle(result, initial.revision)
      const saved = await storage.loadSnapshot()
      assert.deepEqual(saved.data.chapterCommitBundles[0].acceptanceReview, result.acceptanceReview)
      assert.equal(saved.data.chapters[0].body, result.chapter.body)
      const replay = await storage.saveChapterCommitBundle(copy(result), saved.revision)
      assert.equal(replay.revision, write.revision)
      assert.deepEqual(replay.savedCollections, [])
      assert.deepEqual(await storage.loadSnapshot(), saved)
    })
    for (const mode of ['legacy', 'reviewed', 'unreviewed']) {
      test(`${kind}: ${mode} replay survives later text/reports`, async () => {
        const legacy = mode === 'legacy'
        const data = fixture(mode === 'reviewed' ? { quality: 'passed', editorial: 'approved' } : {})
        const result = legacy ? legacyRecord(data) : commit(data, mode)
        if (!legacy) assert.ok(result.acceptanceReview)
        // Seed the historical receipt without passing it through new-write gates.
        data.chapterCommitBundles = [copy(result)]
        data.chapterVersions = [result.previousChapterVersion, result.chapterVersion].filter(Boolean).map(copy)
        data.generatedChapterDrafts = [copy(result.generatedDraft)]
        data.chapters = [{ ...result.chapter, body: 'Later authoritative chapter.', updatedAt: later }]
        draftOf(data).body = 'Later draft revision.'
        draftOf(data).updatedAt = later
        data.qualityGateReports = [qualityReport(data, 'blocked')]
        data.editorialVerdicts = [verdict(data, 'blocked')]
        const { storage } = await storageFor(kind, data)
        const before = await storage.loadSnapshot()
        const replay = await storage.saveChapterCommitBundle(copy(result), before.revision)
        assert.equal(replay.revision, before.revision)
        assert.deepEqual(replay.savedCollections, [])
        assert.deepEqual(await storage.loadSnapshot(), before)
        const forged = copy(result)
        forged.acceptanceReview = legacy ? expectedReview(data, 'unreviewed') : {
          ...forged.acceptanceReview, mode: mode === 'reviewed' ? 'unreviewed' : 'reviewed'
        }
        await assert.rejects(() => storage.saveChapterCommitBundle(forged, before.revision))
        assert.deepEqual(await storage.loadSnapshot(), before)
      })
    }
    test(`${kind}: every persisted snapshot field is immutable`, async () => {
      const data = fixture()
      const result = unreviewedBundle(data)
      const { storage } = await storageFor(kind, data)
      await storage.saveChapterCommitBundle(result, (await storage.loadSnapshot()).revision)
      const before = await storage.loadSnapshot()
      for (const [key, value] of Object.entries({
        mode: 'reviewed', draftContentHash: 'different', editorialRequired: false,
        qualityGateReportId: 'q-forged', editorialVerdictId: 'v-forged',
        qualityStatus: 'passed', editorialStatus: 'approved'
      })) {
        const forged = copy(result)
        forged.acceptanceReview[key] = value
        await assert.rejects(() => storage.saveChapterCommitBundle(forged, before.revision),
          `Persisted acceptanceReview.${key} must be immutable`)
        assert.deepEqual(await storage.loadSnapshot(), before)
      }
    })
    test(`${kind}: stale revision and forged snapshot cannot partially write`, async () => {
      const { storage } = await storageFor(kind, fixture())
      const before = await storage.loadSnapshot()
      const result = unreviewedBundle(before.data)
      await assert.rejects(() => storage.saveChapterCommitBundle(result, `${before.revision}-stale`))
      assert.deepEqual(await storage.loadSnapshot(), before)
      const forged = copy(result)
      forged.acceptanceReview.qualityStatus = 'passed'
      await assert.rejects(() => storage.saveChapterCommitBundle(forged, before.revision))
      assert.deepEqual(await storage.loadSnapshot(), before)
    })
    test(`${kind}: newly completed failed diagnostics reject an old unreviewed bundle`, async () => {
      const { storage } = await storageFor(kind, fixture())
      const initial = await storage.loadSnapshot()
      const result = unreviewedBundle(initial.data)
      initial.data.qualityGateReports = [qualityReport(initial.data, 'blocked')]
      initial.data.editorialVerdicts = [verdict(initial.data, 'blocked')]
      await storage.saveIfCurrent(initial.data, initial.revision)
      const before = await storage.loadSnapshot()
      await assert.rejects(() => storage.saveChapterCommitBundle(result, before.revision))
      assert.deepEqual(await storage.loadSnapshot(), before)
    })
    for (const [label, mutate] of [
      ['missing draft', (data) => { data.generatedChapterDrafts = [] }],
      ['foreign draft project', (data) => { draftOf(data).projectId = 'foreign-project' }],
      ['foreign draft job', (data) => { draftOf(data).jobId = 'foreign-job' }],
      ['missing job', (data) => { data.chapterGenerationJobs = [] }],
      ['foreign job project', (data) => { data.chapterGenerationJobs[0].projectId = 'foreign-project' }],
      ['changed source body', (data) => { draftOf(data).body = 'New current source text.' }]
    ]) {
      test(`${kind}: explicit snapshot rechecks ${label} against current storage`, async () => {
        const { storage } = await storageFor(kind, fixture())
        const initial = await storage.loadSnapshot()
        const result = unreviewedBundle(initial.data)
        mutate(initial.data)
        await storage.saveIfCurrent(initial.data, initial.revision)
        const before = await storage.loadSnapshot()
        await assert.rejects(() => storage.saveChapterCommitBundle(result, before.revision))
        assert.deepEqual(await storage.loadSnapshot(), before)
      })
    }
  }
  test('sqlite-boundary: simulated write failure rolls back entries and revision', async () => {
    const data = fixture()
    const { storage, failNextWrite } = sqliteBoundary(data)
    const before = await storage.loadSnapshot()
    const result = unreviewedBundle(data)
    failNextWrite()
    await assert.rejects(() => storage.saveChapterCommitBundle(result, before.revision), /Injected persistence failure/)
    assert.deepEqual(await storage.loadSnapshot(), before)
  })
}

function registerReviewRegressionTests() {
  test('history: a first accepted current version is saved history, not an empty chain', () => {
    const data = fixture({ existingChapter: false })
    const next = modules.commit.applyChapterCommitBundleToAppData(data, commit(data, 'unreviewed'))
    const { createElement } = require('react')
    const { renderToStaticMarkup } = require('react-dom/server')
    const html = renderToStaticMarkup(createElement(modules.history.ChapterVersionHistoryPanel, {
      data: next, selected: next.chapters[0], onCopyVersion() {}, onRestoreVersion() {}, onDeleteVersion() {}
    }))
    assert.ok(html.includes('1 个已保存版本'))
    assert.ok(html.includes('未审稿采纳'))
    assert.ok(!html.includes('暂无历史版本'))
  })
  test('history: an unversioned current body keeps the honest empty-history state', () => {
    const data = fixture()
    const { createElement } = require('react')
    const { renderToStaticMarkup } = require('react-dom/server')
    const html = renderToStaticMarkup(createElement(modules.history.ChapterVersionHistoryPanel, {
      data, selected: data.chapters[0], onCopyVersion() {}, onRestoreVersion() {}, onDeleteVersion() {}
    }))
    assert.ok(html.includes('0 个已保存版本'))
    assert.ok(html.includes('暂无历史版本'))
  })
  test('UI: accepted draft continues to next chapter despite a retained failed review step', () => {
    const data = fixture()
    const job = { ...data.chapterGenerationJobs[0], status: 'failed' }
    const draft = { ...data.generatedChapterDrafts[0], status: 'accepted' }
    const calls = []
    const action = modules.primary.usePipelinePrimaryAction({
      selectedJob: job, selectedSteps: [{ type: 'generate_chapter_review', status: 'failed' }],
      latestDraft: draft, latestQualityReport: null, isPipelineRunning: false,
      onStartNextChapter: () => calls.push('next'), onRetryStep: () => calls.push('retry')
    })
    assert.equal(action.primaryActionLabel, `生成第 ${job.targetChapterOrder + 1} 章`)
    action.runPrimaryAction()
    assert.deepEqual(calls, ['next'])
    assert.equal(job.status, 'failed', 'The generation history must not be rewritten as successful')
  })
  test('UI: unaccepted draft keeps failed-step retry as its primary action', () => {
    const data = fixture()
    const calls = []
    const action = modules.primary.usePipelinePrimaryAction({
      selectedJob: { ...data.chapterGenerationJobs[0], status: 'failed' },
      selectedSteps: [{ type: 'generate_chapter_review', status: 'failed' }],
      latestDraft: data.generatedChapterDrafts[0], latestQualityReport: null, isPipelineRunning: false,
      onStartNextChapter: () => calls.push('next'), onRetryStep: () => calls.push('retry')
    })
    assert.equal(action.primaryActionLabel, '重试失败步骤')
    action.runPrimaryAction()
    assert.deepEqual(calls, ['retry'])
  })
  for (const kind of ['json', 'sqlite-native']) {
    test(`${kind}: review regression - archived-after-build target cannot be restored by a new commit`, async () => {
      const { storage } = await storageFor(kind, fixture())
      const initial = await storage.loadSnapshot()
      const result = unreviewedBundle(initial.data)
      initial.data.chapters[0].archivedAt = later
      initial.data.chapters[0].updatedAt = later
      await storage.saveIfCurrent(initial.data, initial.revision)
      const before = await storage.loadSnapshot()
      await assert.rejects(() => storage.saveChapterCommitBundle(result, before.revision),
        'A new commit must not clear a concurrent archive marker')
      assert.deepEqual(await storage.loadSnapshot(), before)
    })
    test(`${kind}: review regression - unreviewed bundle cannot erase a failed consistency report`, async () => {
      const data = fixture({ quality: 'blocked', editorial: 'incomplete' })
      data.consistencyReviewReports = [{
        id: 'consistency1', projectId: 'p1', jobId: 'j1', chapterId: 'c1', draftId: 'd1',
        draftContentHash: hashOf(data), severitySummary: 'high', suggestions: 'Repair the contradiction.',
        issues: [{ id: 'issue1', severity: 'high', type: 'character', title: 'Known contradiction',
          description: 'Known contradictory state.', suggestion: 'Preserve this diagnostic.' }], createdAt: time
      }]
      const { storage } = await storageFor(kind, data)
      const before = await storage.loadSnapshot()
      const result = unreviewedBundle(before.data)
      assert.equal(result.consistencyReviewReports[0].id, 'consistency1')
      result.consistencyReviewReports[0].issues = []
      result.consistencyReviewReports[0].severitySummary = 'low'
      await assert.rejects(() => storage.saveChapterCommitBundle(result, before.revision),
        'Keeping unreviewed prose must not overwrite an existing failure with a clean diagnostic')
      assert.deepEqual(await storage.loadSnapshot(), before)
    })
    test(`${kind}: review regression - exact replay after archive remains a no-op`, async () => {
      const { storage } = await storageFor(kind, fixture())
      const initial = await storage.loadSnapshot()
      const result = unreviewedBundle(initial.data)
      await storage.saveChapterCommitBundle(result, initial.revision)
      const saved = await storage.loadSnapshot()
      saved.data.chapters[0].archivedAt = later
      saved.data.chapters[0].updatedAt = later
      await storage.saveIfCurrent(saved.data, saved.revision)
      const before = await storage.loadSnapshot()
      const replay = await storage.saveChapterCommitBundle(copy(result), before.revision)
      assert.deepEqual(replay.savedCollections, [])
      assert.deepEqual(await storage.loadSnapshot(), before)
    })
    test(`${kind}: review regression - a different commit ID cannot accept the same draft twice`, async () => {
      const { storage } = await storageFor(kind, fixture())
      const initial = await storage.loadSnapshot()
      const first = unreviewedBundle(initial.data)
      const second = commit(initial.data, 'unreviewed', { commitId: 'commit2', chapterVersionId: 'version2' })
      await storage.saveChapterCommitBundle(first, initial.revision)
      const before = await storage.loadSnapshot()
      await assert.rejects(() => storage.saveChapterCommitBundle(second, before.revision))
      assert.deepEqual(await storage.loadSnapshot(), before)
    })
  }
  test('UI: review regression - repeated acceptance creates only one commit', async () => {
    const h = uiHarness(fixture())
    await h.hook.acceptDraft(h.draft, 'unreviewed')
    await h.hook.acceptDraft(h.draft, 'unreviewed')
    assert.equal(h.calls.saves, 1)
    assert.equal(h.current().chapterCommitBundles.length, 1)
  })
  test('UI: review regression - archive during confirmation prevents acceptance', async () => {
    const h = uiHarness(fixture(), { mutate: (data) => { data.chapters[0].archivedAt = later } })
    await h.hook.acceptDraft(h.draft, 'unreviewed')
    assert.equal(h.calls.saves, 0)
    assert.equal(h.current().chapters[0].archivedAt, later)
  })
  test('UI: review regression - partial blocked verdict is not replaced by a milder quality warning', async () => {
    const data = fixture({ quality: 'blocked', editorial: 'blocked', existingChapter: false })
    data.editorialVerdicts[0].summary = 'Known editorial blocker: source continuity contradicts the approved state.'
    data.qualityGateReports.push(qualityReport(data, 'needs_review', { id: 'q2', createdAt: later }))
    const h = uiHarness(data)
    await h.hook.acceptDraft(h.draft, 'unreviewed')
    assert.equal(h.calls.saves, 1, 'Partial review must still allow the author to keep the work')
    const snapshot = h.current().chapterCommitBundles[0].acceptanceReview
    assert.equal(snapshot.editorialStatus, 'blocked')
    assert.equal(snapshot.editorialVerdictId, 'v1')
    assert.equal(snapshot.qualityStatus, 'needs_review')
    assert.equal(snapshot.qualityGateReportId, 'q2')
    assert.equal(h.calls.confirmations.length, 1)
    assert.ok(h.calls.confirmations[0].message.includes(data.editorialVerdicts[0].summary),
      'Explicit confirmation must retain the known blocked editorial finding alongside the milder quality warning')
  })
  for (const key of ['projectId', 'jobId']) {
    test(`view-props: review regression - foreign verdict ${key} cannot hide unreviewed acceptance`, async () => {
      const data = fixture({ quality: 'passed', editorial: 'approved' })
      data.editorialVerdicts[0][key] = 'foreign'
      const h = renderViewProbe(data)
      const panel = h.props.currentArtifactPanel
      await panel.onAcceptDraft(panel.draft)
      assert.equal(h.saves(), 0, 'Normal reviewed acceptance cannot borrow the foreign verdict')
      assert.equal(typeof panel.onAcceptUnreviewedDraft, 'function',
        'The view must expose the valid unreviewed path when no local current verdict exists')
      await panel.onAcceptUnreviewedDraft(panel.draft)
      assert.equal(h.saves(), 1)
      const snapshot = h.current().chapterCommitBundles[0].acceptanceReview
      assert.equal(snapshot.mode, 'unreviewed')
      assert.equal(snapshot.editorialVerdictId, null)
      assert.equal(snapshot.editorialStatus, 'not_available')
    })
  }
  for (const source of ['missing', 'foreign']) {
    test(`view-props: review regression - ${source} quality report offers unreviewed without claiming a pass`, async () => {
      const data = fixture({ quality: 'passed' })
      if (source === 'missing') data.qualityGateReports = []
      else data.qualityGateReports[0].projectId = 'foreign'
      const h = renderViewProbe(data)
      const panel = h.props.currentArtifactPanel
      assert.equal(typeof panel.onAcceptUnreviewedDraft, 'function')
      await panel.onAcceptUnreviewedDraft(panel.draft)
      assert.equal(h.saves(), 1)
      assert.equal(h.current().chapterCommitBundles[0].acceptanceReview.qualityStatus, 'not_available')
      assert.equal(h.current().chapterCommitBundles[0].acceptanceReview.qualityGateReportId, null)
    })
  }
  test('view-props: review regression - legacy no-recipe reviewed path still writes explicit provenance', async () => {
    const data = fixture({ recipe: false, quality: 'passed' })
    const h = renderViewProbe(data)
    const panel = h.props.currentArtifactPanel
    assert.equal(panel.onAcceptUnreviewedDraft, undefined)
    await panel.onAcceptDraft(panel.draft)
    assert.equal(h.saves(), 1)
    assert.deepEqual(h.current().chapterCommitBundles[0].acceptanceReview,
      expectedReview(data, 'reviewed', 'passed', 'not_available', false))
  })
  test('panel-props: running and already accepted drafts cannot expose an enabled accept action', () => {
    function collectButtons(element) {
      if (!element || typeof element !== 'object') return []
      const children = Array.isArray(element.props?.children) ? element.props.children : [element.props?.children]
      return [...(element.type === 'button' ? [element] : []), ...children.flatMap(collectButtons)]
    }
    for (const [running, status] of [[true, 'draft'], [false, 'accepted']]) {
      const data = fixture()
      const draft = { ...draftOf(data), status }
      const tree = modules.panel.PipelineDraftPanel({
        draft, job: data.chapterGenerationJobs[0], isRunning: running,
        onAccept() {}, onAcceptUnreviewed() {}, onReject() {}, onRetryDraft() {}, onCopyDraft() {}
      })
      const buttons = collectButtons(tree)
      const accepts = buttons.filter((item) => /\u63a5\u53d7|\u91c7\u7eb3/.test(String(item.props.children)))
      assert.ok(accepts.length > 0)
      assert.ok(accepts.every((item) => item.props.disabled === true))
    }
  })
}

function registerNativeStorageTests() {
  for (const mode of ['reviewed', 'unreviewed']) {
    test(`sqlite-native: ${mode} persists exact review evidence across close/reopen`, async () => {
      const data = fixture(mode === 'reviewed'
        ? { quality: 'passed', editorial: 'approved' }
        : { quality: 'blocked', editorial: 'incomplete' })
      const { storage, path } = await storageFor('sqlite-native', data)
      const initial = await storage.loadSnapshot()
      const result = commit(initial.data, mode)
      assert.ok(result.acceptanceReview)
      const written = await storage.saveChapterCommitBundle(result, initial.revision)
      const expected = await storage.loadSnapshot()
      storage.close()
      const reopened = nativeStorage(path)
      const actual = await reopened.loadSnapshot()
      assert.deepEqual(actual, expected)
      assert.equal(actual.revision, written.revision)
      assert.deepEqual(actual.data.chapterCommitBundles[0].acceptanceReview, result.acceptanceReview)
      assert.equal(draftOf(actual.data).status, 'accepted')
      assert.equal(actual.data.qualityGateReports[0].pass, mode === 'reviewed')
      assert.equal(actual.data.editorialVerdicts[0].status, mode === 'reviewed' ? 'approved' : 'incomplete')
      const reader = nativeConnection(path, true)
      const raw = reader.prepare('SELECT json FROM entities WHERE collection = ? AND id = ?')
        .get('chapterCommitBundles', result.id)
      assert.deepEqual(JSON.parse(raw.json), JSON.parse(JSON.stringify(result)))
      assert.equal(reader.prepare('SELECT value FROM meta WHERE key = ?').get('revision').value, written.revision)
      for (const collection of ['chapterCommitBundles', 'generatedChapterDrafts']) {
        assert.equal(reader.prepare('SELECT COUNT(*) AS count FROM entities WHERE collection = ?').get(collection).count, 1)
      }
      const replay = await reopened.saveChapterCommitBundle(copy(result), actual.revision)
      assert.deepEqual(replay.savedCollections, [])
      assert.equal(replay.revision, actual.revision)
    })
  }
  for (const stage of ['entity', 'revision']) {
    test(`sqlite-native: real ${stage} failure rolls back every row and revision, then retry succeeds`, async () => {
      const { storage, path } = await storageFor('sqlite-native', fixture({ quality: 'blocked', editorial: 'incomplete' }))
      const before = await storage.loadSnapshot()
      const result = unreviewedBundle(before.data)
      const db = nativeConnection(path)
      const rowsBefore = db.prepare('SELECT * FROM entities ORDER BY collection, id').all()
      const metaBefore = db.prepare('SELECT * FROM meta ORDER BY key').all()
      // Static triggers fail after prior entity writes, or at the final revision
      // write. The real SQLite transaction, not a JS mock, must undo them all.
      db.exec(stage === 'entity' ? `
        CREATE TRIGGER w02_fail_commit
        BEFORE INSERT ON entities
        WHEN NEW.collection = 'generatedChapterDrafts'
        BEGIN SELECT RAISE(ABORT, 'W02 injected native entity failure'); END;
      ` : `
        CREATE TRIGGER w02_fail_commit
        BEFORE INSERT ON meta
        WHEN NEW.key = 'revision'
        BEGIN SELECT RAISE(ABORT, 'W02 injected native revision failure'); END;
      `)
      await assert.rejects(() => storage.saveChapterCommitBundle(result, before.revision),
        /W02 injected native (entity|revision) failure/)
      assert.deepEqual(await storage.loadSnapshot(), before)
      assert.deepEqual(db.prepare('SELECT * FROM entities ORDER BY collection, id').all(), rowsBefore)
      assert.deepEqual(db.prepare('SELECT * FROM meta ORDER BY key').all(), metaBefore)
      storage.close()
      const reopened = nativeStorage(path)
      assert.deepEqual(await reopened.loadSnapshot(), before)
      db.exec('DROP TRIGGER w02_fail_commit')
      const retry = await reopened.saveChapterCommitBundle(result, before.revision)
      assert.notEqual(retry.revision, before.revision)
      const saved = await reopened.loadSnapshot()
      assert.equal(saved.data.chapterCommitBundles.length, 1)
      assert.deepEqual(saved.data.chapterCommitBundles[0].acceptanceReview, result.acceptanceReview)
      assert.equal(saved.data.qualityGateReports[0].pass, false)
    })
  }
}

async function main() {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Network/remote AI is forbidden in this focused suite') }
  await mkdir(tmpBase, { recursive: true })
  outDir = await mkdtemp(join(tmpBase, 'unreviewed-draft-acceptance-'))
  try {
    modules = {}
    for (const [key, entry] of Object.entries({
      defaults: 'src/shared/defaults.ts', binding: 'src/services/DraftDiagnosticBindingService.ts',
      recipes: 'src/services/PipelineRecipeService.ts', commit: 'src/services/ChapterCommitBundleService.ts',
      ui: 'src/renderer/src/views/generation/useDraftAcceptance.ts',
      primary: 'src/renderer/src/views/generation/usePipelinePrimaryAction.ts',
      json: 'src/storage/JsonStorageService.ts', sqlite: 'src/storage/SqliteStorageService.ts'
    })) modules[key] = await bundle(entry, key)
    if (!process.argv.includes('--native-only')) {
      modules.view = await bundleViewProbe()
      modules.panel = await bundle('src/renderer/src/components/pipeline/PipelineDraftPanel.tsx', 'panel')
      modules.history = await bundle('src/renderer/src/views/chapters/ChapterVersionHistoryPanel.tsx', 'history')
    }
    modules.review = await findReviewHelper()
    registerHelperTests()
    registerBundleTests()
    registerUiTests()
    registerStorageTests()
    registerReviewRegressionTests()
    registerNativeStorageTests()
    probeNativeSqlite()
    const nativeOnly = process.argv.includes('--native-only')
    const selectedCases = nativeOnly ? cases.filter((item) => item.name.startsWith('sqlite-native:')) : cases
    let failed = 0
    let skipped = 0
    for (const item of selectedCases) {
      if (item.name.startsWith('sqlite-native:') && !nativeDatabase) {
        skipped += 1
        console.log(`SKIP ${item.name}: native SQLite unavailable (see summary)`)
        continue
      }
      try {
        if (item.name.startsWith('helper:')) {
          assert.equal(typeof modules.review, 'function', 'Missing contract export buildChapterAcceptanceReview')
        }
        await item.run()
        console.log(`PASS ${item.name}`)
      } catch (error) {
        failed += 1
        console.error(`FAIL ${item.name}\n${error.message ?? error}`)
      } finally {
        closeNativeHandles()
      }
    }
    console.log(`validate-unreviewed-draft-acceptance: ${selectedCases.length - failed - skipped}/${selectedCases.length} passed; ${failed} failed; ${skipped} skipped`)
    console.log(nativeDatabase
      ? `SQLite native: real isolated Node ${process.version} ABI ${process.versions.modules} fixtures; no Electron or rebuild.`
      : `SQLite native: SKIP; ${nativeSkipReason}. No rebuild attempted.`)
    if (!nativeOnly) console.log('sqlite-boundary cases use simulated persistence and are not native SQLite coverage.')
    if (failed) process.exitCode = 1
  } finally {
    globalThis.fetch = originalFetch
    closeNativeHandles()
    const actual = await realpath(outDir)
    const base = await realpath(tmpBase)
    assert.equal(resolve(dirname(actual)), resolve(base), 'Cleanup must stay in the dedicated workspace temp parent')
    assert.ok(actual.startsWith(join(base, 'unreviewed-draft-acceptance-')))
    await rm(actual, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })

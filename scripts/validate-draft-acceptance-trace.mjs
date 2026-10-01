import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

// This is intentionally a storage-boundary regression: the runtime trace is
// inserted after the normal seed write, so load() has to normalize it.
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const time = '2026-09-08T10:00:00.000Z'
const acceptedAt = '2026-09-08T11:00:00.000Z'
const tmpBase = join(repoRoot, 'tmp')
let tmpDir
let modules

async function bundle(entry, name) {
  const outfile = join(tmpDir, `${name}.mjs`)
  await build({
    entryPoints: [join(repoRoot, entry)], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22',
    external: ['better-sqlite3'], logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?${Date.now()}-${Math.random()}`)
}

function clone(value) { return structuredClone(value) }
function hash(body) { return modules.binding.draftContentHash(body) }
function assertRejects(fn, label) { assert.throws(fn, undefined, label) }

function seed({ reviewed }) {
  const raw = {
    schemaVersion: 3,
    projects: [{ id: 'p1', name: 'isolated trace fixture', createdAt: time, updatedAt: time }],
    chapters: [{ id: 'c1', projectId: 'p1', order: 3, title: 'Before', body: 'Before body.', createdAt: time, updatedAt: time }],
    chapterGenerationJobs: [{
      id: 'j1', projectId: 'p1', targetChapterOrder: 3, contextSource: 'auto', pipelineMode: 'standard',
      ...(reviewed ? { pipelineRecipe: { id: 'standard', version: 1 } } : {}),
      status: 'completed', currentStep: 'await_user_confirmation', errorMessage: '', createdAt: time, updatedAt: time
    }],
    generatedChapterDrafts: [{
      id: 'd1', projectId: 'p1', jobId: 'j1', chapterId: 'c1', title: 'Accepted', body: 'Accepted body.', summary: 'Summary.',
      status: 'draft', tokenEstimate: 12, createdAt: time, updatedAt: time
    }]
  }
  const data = modules.defaults.normalizeAppData(raw)
  if (!reviewed) return data
  const contentHash = hash(data.generatedChapterDrafts[0].body)
  const quality = (id, createdAt) => ({
    id, projectId: 'p1', jobId: 'j1', chapterId: 'c1', draftId: 'd1', draftContentHash: contentHash,
    pass: true, overallScore: 90, dimensions: {}, issues: [], requiredFixes: [], optionalSuggestions: [], createdAt
  })
  const consistency = (id, createdAt) => ({
    id, projectId: 'p1', jobId: 'j1', chapterId: 'c1', draftId: 'd1', draftContentHash: contentHash,
    issues: [], suggestions: '', severitySummary: 'low', createdAt
  })
  const redundancy = (id, createdAt) => ({
    id, projectId: 'p1', jobId: 'j1', chapterId: 'c1', draftId: 'd1', draftContentHash: contentHash,
    repeatedPhrases: [], repeatedSceneDescriptions: [], repeatedExplanations: [], overusedIntensifiers: [], redundantParagraphs: [],
    compressionSuggestions: [], overallRedundancyScore: 0, createdAt
  })
  data.qualityGateReports = [quality('q-old', '2026-09-08T09:00:00.000Z'), quality('q-new', '2026-09-08T10:01:00.000Z')]
  data.consistencyReviewReports = [consistency('c-old', '2026-09-08T09:00:00.000Z'), consistency('c-new', '2026-09-08T10:01:00.000Z')]
  data.redundancyReports = [redundancy('r-old', '2026-09-08T09:00:00.000Z'), redundancy('r-new', '2026-09-08T10:01:00.000Z')]
  data.editorialVerdicts = [{
    id: 'v-new', projectId: 'p1', jobId: 'j1', chapterId: 'c1', draftId: 'd1', draftContentHash: contentHash,
    draftRevision: time, status: 'approved', canAccept: true, summary: 'Approved.',
    coverage: { quality: 'current', consistency: 'not_requested' }, blockers: [], advisories: [], actions: [],
    sourceRefs: { qualityGateReportId: 'q-new', consistencyReviewReportId: null, redundancyReportId: null,
      noveltyAuditTraceId: null, generationRunTraceId: null, characterStateIssueIds: [], ignoredStaleReportIds: [] },
    schemaVersion: 1, createdAt: '2026-09-08T10:02:00.000Z', updatedAt: '2026-09-08T10:02:00.000Z'
  }]
  return data
}

function runtimeTrace(job, novelty = 'stale') {
  const trace = modules.trace.createEmptyGenerationRunTrace(job)
  const currentAudit = {
    newNamedCharacters: [{
      kind: 'new_named_character', text: 'Current name', evidenceExcerpt: 'Current evidence', reason: 'Current reason',
      severity: 'warning', allowedByTask: false, hasPriorForeshadowing: false, sourceHint: null, suggestedAction: 'Review',
      confidence: 'high', semanticEvidence: { ruleTarget: 'target', beneficiary: 'beneficiary', crisisCue: null,
        resolutionCue: null, costOrLimitCue: 'cost', sourceMediumCue: null }
    }],
    severity: 'warning', summary: 'current audit', sourceDraftId: 'd1', sourceContentHash: hash('Accepted body.'), auditedAt: time
  }
  return {
    ...trace, id: 'trace-runtime', selectedCharacterIds: ['character-runtime'], contextWarnings: ['runtime warning'],
    aiCalls: [{ id: 'call-runtime', stepId: 'generate', stepType: 'generate_chapter_draft', role: 'prose', provider: 'openai',
      model: 'runtime-model', usage: { promptTokens: 13 }, createdAt: time }],
    noveltyAuditResult: novelty === 'current'
      ? currentAudit
      : { severity: 'warning', summary: 'stale audit', sourceDraftId: 'd1', sourceContentHash: 'not-current' },
    // Runtime objects legitimately omit these optional prompt block fields.
    promptBlockOrder: [{ id: 'task', title: 'Task', kind: 'chapter_task', priority: 1, tokenEstimate: 9, source: 'runtime', included: true, reason: 'fixture' }],
    createdAt: time, updatedAt: time
  }
}

async function insertRuntimeTrace(kind, path, trace) {
  if (kind === 'json') {
    const document = JSON.parse(await readFile(path, 'utf8'))
    document.generationRunTraces.push(trace)
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    return
  }
  const db = new Database(path)
  try {
    db.prepare(`INSERT INTO entities (collection, id, project_id, chapter_id, job_id, character_id, chapter_order, title, updated_at, json)
      VALUES (?, ?, ?, NULL, ?, NULL, ?, NULL, ?, ?)`)
      .run('generationRunTraces', trace.id, trace.projectId, trace.jobId, trace.targetChapterOrder, trace.updatedAt, JSON.stringify(trace))
  } finally { db.close() }
}

function storage(kind, path) {
  return kind === 'json' ? new modules.json.JsonStorageService(path) : new modules.sqlite.SqliteStorageService(path)
}

async function setup(kind, reviewed, name, novelty = 'stale') {
  const path = join(tmpDir, `${name}.${kind === 'json' ? 'json' : 'sqlite'}`)
  const store = storage(kind, path)
  const initial = seed({ reviewed })
  const rawTrace = runtimeTrace(initial.chapterGenerationJobs[0], novelty)
  const runtimeData = { ...initial, generationRunTraces: [rawTrace] }
  await store.save(initial) // Normalized seed first; only the runtime trace below is sparse.
  await insertRuntimeTrace(kind, path, rawTrace)
  const snapshot = await store.loadSnapshot()
  const trace = snapshot.data.generationRunTraces.find((item) => item.id === 'trace-runtime')
  assert.deepEqual(trace.promptBlockOrder[0].sourceIds, [], `${kind}: load normalizes omitted sourceIds`)
  assert.equal(trace.promptBlockOrder[0].compressed, false, `${kind}: load normalizes omitted compressed`)
  assert.equal(trace.promptBlockOrder[0].forced, false, `${kind}: load normalizes omitted forced`)
  assert.equal(trace.promptBlockOrder[0].omittedReason, null, `${kind}: load normalizes omitted omittedReason`)
  assert.equal(trace.aiCalls[0].usage.completionTokens, undefined, `${kind}: partial AI usage remains valid`)
  return { store, path, snapshot, runtimeData }
}

function commit(data, mode, id = `commit-${mode}`) {
  return modules.commit.buildAcceptedDraftCommitBundle({
    appData: data, projectId: 'p1', draftId: 'd1', targetChapterOrder: 3, chapterId: 'c1',
    commitId: id, chapterVersionId: `${id}:version`, acceptedAt, acceptanceMode: mode
  })
}

async function exercise(kind, mode) {
  const { store, snapshot, runtimeData } = await setup(kind, mode === 'reviewed', `${kind}-${mode}`)
  try {
    // This is the historical failure path: build/apply receive the original
    // sparse runtime trace, while save sees the normalized DB copy.
    const bundle = commit(runtimeData, mode)
    assert.equal(bundle.generationRunTrace.noveltyAuditResult, null, `${kind}/${mode}: stale novelty audit is removed`)
    assert.deepEqual(bundle.generationRunTrace.promptBlockOrder[0].sourceIds, [], `${kind}/${mode}: builder normalizes raw runtime trace`)
    const reloadBundle = commit(snapshot.data, mode, `commit-${mode}-reload`)
    assert.equal(modules.commit.applyChapterCommitBundleToAppData(snapshot.data, reloadBundle).chapterCommitBundles.length, 1,
      `${kind}/${mode}: reload snapshot build path remains valid`)
    if (mode === 'reviewed') {
      assert.equal(bundle.qualityGateReportId, 'q-new', `${kind}: newest matching quality report wins`)
      assert.equal(bundle.consistencyReviewReportId, 'c-new', `${kind}: newest matching consistency report wins`)
      assert.equal(bundle.redundancyReports[0].id, 'r-new', `${kind}: newest matching redundancy report wins`)
    }
    const applied = modules.commit.applyChapterCommitBundleToAppData(runtimeData, bundle)
    assert.equal(applied.chapterCommitBundles.length, 1, `${kind}/${mode}: apply validates normalized trace`)
    const written = await store.saveChapterCommitBundle(bundle, snapshot.revision)
    const saved = await store.loadSnapshot()
    assert.equal(saved.data.chapterCommitBundles.length, 1, `${kind}/${mode}: save validates normalized trace`)
    assert.equal(saved.data.generationRunTraces[0].noveltyAuditResult, null, `${kind}/${mode}: stale novelty remains absent after save`)

    // Exact receipts may retry, but must not duplicate or overwrite later prose.
    saved.data.chapters[0] = { ...saved.data.chapters[0], body: 'Later author change.', updatedAt: '2026-09-08T12:00:00.000Z' }
    const later = await store.saveIfCurrent(saved.data, saved.revision)
    const replay = await store.saveChapterCommitBundle(clone(bundle), later.revision)
    const afterReplay = await store.loadSnapshot()
    assert.deepEqual(replay.savedCollections, [], `${kind}/${mode}: replay writes nothing`)
    assert.equal(afterReplay.data.chapters[0].body, 'Later author change.', `${kind}/${mode}: replay cannot overwrite later prose`)
    assert.equal(afterReplay.data.chapterCommitBundles.length, 1, `${kind}/${mode}: replay cannot duplicate receipt`)
    assert.notEqual(written.revision, snapshot.revision)
  } finally { store.close?.() }
}

async function rejectTampering(kind, field, mutate) {
  const { store, snapshot, runtimeData } = await setup(kind, true, `${kind}-tamper-${field}`)
  try {
    const bundle = commit(runtimeData, 'reviewed', `commit-tamper-${field}`)
    mutate(bundle.generationRunTrace)
    assertRejects(() => modules.commit.applyChapterCommitBundleToAppData(runtimeData, bundle), `${kind}/${field}: apply rejects altered runtime evidence`)
    const before = await store.loadSnapshot()
    await assert.rejects(() => store.saveChapterCommitBundle(bundle, before.revision), `${kind}/${field}: save rejects altered runtime evidence`)
    assert.deepEqual(await store.loadSnapshot(), before, `${kind}/${field}: rejected save is not partially committed`)
  } finally { store.close?.() }
}

async function retainCurrentNovelty(kind) {
  const { store, snapshot, runtimeData } = await setup(kind, true, `${kind}-current-novelty`, 'current')
  try {
    const bundle = commit(runtimeData, 'reviewed', `commit-current-novelty-${kind}`)
    const finding = bundle.generationRunTrace.noveltyAuditResult.newNamedCharacters[0]
    assert.equal(finding.confidence, 'high', `${kind}: current novelty confidence is retained`)
    assert.deepEqual(finding.semanticEvidence, {
      ruleTarget: 'target', beneficiary: 'beneficiary', crisisCue: null,
      resolutionCue: null, costOrLimitCue: 'cost', sourceMediumCue: null
    }, `${kind}: current novelty nested optional evidence is retained`)
    assert.equal(modules.commit.applyChapterCommitBundleToAppData(runtimeData, bundle).chapterCommitBundles.length, 1,
      `${kind}: raw current novelty trace applies`)
    await store.saveChapterCommitBundle(bundle, snapshot.revision)
  } finally { store.close?.() }
}

async function main() {
  tmpDir = await mkdtemp(join(tmpBase, 'validate-draft-acceptance-trace-'))
  const resolvedTmp = await realpath(tmpDir)
  assert.equal(dirname(resolvedTmp), resolve(tmpBase), 'fixtures must stay under this repository tmp directory')
  assert.ok(!/^[Ff]:/.test(resolvedTmp), 'fixtures must never use F: project data')
  try {
    modules = {
      defaults: await bundle('src/shared/defaults.ts', 'defaults'),
      binding: await bundle('src/services/DraftDiagnosticBindingService.ts', 'binding'),
      trace: await bundle('src/renderer/src/utils/runTrace.ts', 'trace'),
      commit: await bundle('src/services/ChapterCommitBundleService.ts', 'commit'),
      json: await bundle('src/storage/JsonStorageService.ts', 'json'),
      sqlite: await bundle('src/storage/SqliteStorageService.ts', 'sqlite')
    }
    let passed = 0
    for (const kind of ['json', 'sqlite']) for (const mode of ['reviewed', 'unreviewed']) {
      await exercise(kind, mode); passed += 1
    }
    for (const kind of ['json', 'sqlite']) {
      await retainCurrentNovelty(kind); passed += 1
    }
    for (const [field, mutate] of [
      ['selectedCharacterIds', (trace) => { trace.selectedCharacterIds = ['forged-character'] }],
      ['contextWarnings', (trace) => { trace.contextWarnings = ['forged warning'] }],
      ['aiCalls.model', (trace) => { trace.aiCalls[0].model = 'forged-model' }]
    ]) for (const kind of ['json', 'sqlite']) {
      await rejectTampering(kind, field, mutate); passed += 1
    }
    console.log(`validate-draft-acceptance-trace: ${passed}/12 scenarios passed (real JSON and Node SQLite; no native rebuild).`)
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })

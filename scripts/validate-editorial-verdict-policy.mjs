import assert from 'node:assert/strict'
import { join } from 'node:path'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

// No fixtures, generated modules, or application data are written to disk.
async function load(entry) {
  const result = await build({
    entryPoints: [join(repoRoot, entry)], bundle: true, write: false,
    platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`)
}

const service = await load('src/services/EditorialVerdictService.ts')
const { isEditorialIssueActive } = await load('src/shared/editorialIssuePolicy.ts')
const { activeConsistencyIssues } = await load('src/services/qualityGate/evaluationMergers.ts')
const { normalizeAppData } = await load('src/shared/defaults.ts')
const { draftContentHash } = await load('src/services/DraftDiagnosticBindingService.ts')
const { PipelineRecipeService } = await load('src/services/PipelineRecipeService.ts')
const time = '2026-09-05T12:00:00.000Z'
const later = '2026-09-05T13:00:00.000Z'
const body = 'A draft used only to verify editorial policy and diagnostic binding.'
const hash = draftContentHash(body)
const scope = { projectId: 'project', jobId: 'job', chapterId: 'chapter', draftId: 'draft', draftContentHash: hash }
let passed = 0
let failed = 0

function test(name, run) {
  try {
    run()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}: ${error.message}`)
  }
}

function issue(status = 'open', severity = 'high', overrides = {}) {
  return {
    id: 'issue', type: 'previous_chapter_contradiction', status, severity,
    title: 'Unexplained location change', description: 'Location contradicts the previous chapter.',
    evidence: 'Instant arrival', suggestedFix: 'Explain the journey.', revisionInstruction: 'Add the journey.',
    relatedChapterIds: [], relatedCharacterIds: [], relatedForeshadowingIds: [], ...overrides
  }
}

function review(issues = [], overrides = {}) {
  return { ...scope, id: 'review', issues, suggestions: '', severitySummary: 'low', createdAt: time, ...overrides }
}

function gate(overrides = {}) {
  return {
    ...scope, id: 'gate', overallScore: 90, pass: true, dimensions: {}, issues: [],
    requiredFixes: [], optionalSuggestions: [], createdAt: time, ...overrides
  }
}

function echo(overrides = {}) {
  return {
    type: 'consistency_review_blocker', severity: 'high', linkedConsistencyIssueId: 'issue',
    description: 'Old linked finding', evidence: 'Old linked evidence', suggestedFix: 'Old linked fix', ...overrides
  }
}

function trace(overrides = {}) {
  return {
    id: 'trace', projectId: 'project', jobId: 'job', generatedDraftId: 'draft',
    qualityGateReportId: 'gate', consistencyReviewReportId: 'review', characterStateIssueIds: [],
    characterStateWarnings: [], createdAt: time, updatedAt: time, ...overrides
  }
}

function data(overrides = {}) {
  return normalizeAppData({
    schemaVersion: 3,
    generatedChapterDrafts: [{
      id: 'draft', projectId: 'project', jobId: 'job', chapterId: 'chapter', body,
      title: 'Draft', summary: '', status: 'draft', tokenEstimate: 20, createdAt: time, updatedAt: time
    }],
    qualityGateReports: [gate()], consistencyReviewReports: [review()], ...overrides
  })
}

function verdict(appData = data(), extra = {}) {
  const result = service.buildEditorialVerdict({ appData, draftId: 'draft', createdAt: time, ...extra })
  assert.ok(result.actions.length <= 3)
  assert.equal(new Set(result.actions.map((action) => action.actionType)).size, result.actions.length)
  assert.equal(result.canAccept, ['approved', 'advisory'].includes(result.status))
  assert.equal(result.draftContentHash, draftContentHash(appData.generatedChapterDrafts[0].body))
  assert.equal(result.draftRevision, appData.generatedChapterDrafts[0].updatedAt)
  assert.ok(JSON.stringify(result).length <= 24000)
  return result
}

function findings(result) {
  return [...result.blockers, ...result.advisories].filter((item) => item.source !== 'diagnostic_binding')
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  Object.values(value).forEach(freeze)
  return value
}

for (const status of ['open', 'converted_to_revision', 'resolved', 'ignored', undefined, 'legacy_unknown']) {
  test(`shared policy matches quality gate: ${status}`, () => {
    const item = issue(status)
    item.status = status
    assert.equal(isEditorialIssueActive(item), activeConsistencyIssues([review([item])]).length === 1)
    assert.equal(isEditorialIssueActive(item), !['resolved', 'ignored'].includes(status))
  })
}

for (const status of ['open', 'converted_to_revision', 'resolved', 'ignored']) {
  for (const severity of ['low', 'medium', 'high']) {
    for (const type of ['previous_chapter_contradiction', 'character_knowledge_leak']) {
      test(`lifecycle ${status}/${severity}/${type}`, () => {
        const result = verdict(data({ consistencyReviewReports: [review([issue(status, severity, { type })])] }))
        const active = isEditorialIssueActive(issue(status))
        assert.equal(findings(result).length, active ? 1 : 0)
        assert.equal(result.status, !active ? 'approved' : severity === 'high' ? 'blocked' : 'advisory')
        if (active) assert.equal(findings(result)[0].source, type.startsWith('character_') ? 'character_state' : 'consistency_review')
      })
    }
  }
}

for (const status of ['open', 'converted_to_revision']) {
  for (const binding of [
    { draftContentHash: 'old-hash' }, { draftContentHash: null }, { draftId: 'other' },
    { projectId: 'other' }, { jobId: 'other' }
  ]) {
    test(`unverified later review cannot erase ${status}: ${JSON.stringify(binding)}`, () => {
      const result = verdict(data({ consistencyReviewReports: [
        review([issue(status)]), review([], { id: 'later', createdAt: later, ...binding })
      ] }))
      assert.equal(result.status, 'blocked')
      assert.equal(result.sourceRefs.consistencyReviewReportId, 'review')
    })
  }
  test(`verified newer clean review supersedes ${status}`, () => {
    const result = verdict(data({ consistencyReviewReports: [
      review([issue(status)]), review([], { id: 'later', createdAt: later })
    ] }))
    assert.equal(result.status, 'approved')
    assert.equal(result.sourceRefs.consistencyReviewReportId, 'later')
  })
  test(`equal timestamps do not silently resolve ${status}`, () => {
    const reports = [review([issue(status)], { id: 'a' }), review([], { id: 'z' })]
    const first = verdict(data({ consistencyReviewReports: reports }))
    const reversed = verdict(data({ consistencyReviewReports: [...reports].reverse() }))
    assert.equal(first.status, 'blocked')
    assert.equal(first.blockers[0].sourceId, 'a')
    assert.deepEqual(first, reversed)
  })
}

for (const status of ['resolved', 'ignored']) {
  for (const pass of [true, false]) {
    test(`closed ${status} does not return through quality/trace (gate pass=${pass})`, () => {
      const result = verdict(data({
        consistencyReviewReports: [review([issue(status)])],
        qualityGateReports: [gate({ pass, issues: [echo()], requiredFixes: ['Old linked fix'] })],
        generationRunTraces: [trace({ characterStateIssueIds: ['issue'] })]
      }))
      assert.deepEqual(findings(result), [])
      assert.deepEqual(result.sourceRefs.characterStateIssueIds, [])
      assert.equal(result.status, 'incomplete')
      assert.equal(result.coverage.quality, 'stale')
      assert.equal(result.actions[0].actionType, 'rerun_diagnostics')
    })
  }
  test(`latest explicit ${status} replaces older open state`, () => {
    const result = verdict(data({ consistencyReviewReports: [
      review([issue()]), review([issue(status)], { id: 'later', createdAt: later })
    ] }))
    assert.equal(result.status, 'approved')
  })
  test(`terminal ${status} wins ambiguous timestamp tie`, () => {
    const result = verdict(data({ consistencyReviewReports: [
      review([issue()], { id: 'z' }), review([issue(status)], { id: 'a' })
    ] }))
    assert.equal(result.status, 'approved')
  })
}

test('new review also supersedes a quality echo of an omitted older finding', () => {
  const result = verdict(data({
    consistencyReviewReports: [review([issue('converted_to_revision')]), review([], { id: 'later', createdAt: later })],
    qualityGateReports: [gate({ pass: false, issues: [echo()] })]
  }))
  assert.deepEqual(findings(result), [])
  assert.equal(result.status, 'incomplete')
})

test('independent gate risks survive closure of linked findings', () => {
  const result = verdict(data({
    consistencyReviewReports: [review([issue('resolved')])],
    qualityGateReports: [gate({ pass: false, issues: [echo(), echo({
      type: 'length', linkedConsistencyIssueId: undefined, description: 'Independent high risk'
    })] })]
  }))
  assert.equal(result.status, 'blocked')
  assert.equal(result.blockers.length, 1)
  assert.equal(result.blockers[0].title, 'Independent high risk')
  assert.ok(result.actions.some((action) => action.actionType === 'rerun_diagnostics'))
})

test('unknown linked findings remain conservative blockers', () => {
  assert.equal(verdict(data({ qualityGateReports: [gate({ issues: [echo()] })] })).status, 'blocked')
})

for (const recipeId of [undefined, 'standard', 'strict', 'custom', 'fast']) {
  for (const consistency of [undefined, true, false]) {
    test(`coverage recipe=${recipeId}, consistency=${consistency}`, () => {
      const result = verdict(data({ consistencyReviewReports: [] }), { coverageExpectation: { recipeId, consistency } })
      const requested = consistency ?? recipeId !== 'fast'
      assert.equal(result.status, requested ? 'incomplete' : 'approved')
      assert.equal(result.coverage.consistency, requested ? 'unavailable' : 'not_requested')
      assert.equal(result.advisories.length, requested ? 1 : 0)
      assert.equal(result.actions[0].actionType, requested ? 'rerun_diagnostics' : 'accept_draft')
    })
  }
}

test('omitting expectation preserves legacy required consistency', () => {
  assert.equal(verdict(data({ consistencyReviewReports: [] })).status, 'incomplete')
})

for (const recipeId of ['fast', 'standard', 'strict']) {
  for (const signal of ['none', 'warning', 'failure']) {
    test(`actual recipe execution: ${recipeId}/${signal}`, () => {
      const consistency = PipelineRecipeService.shouldRunStep(recipeId, 'consistency_review', signal)
      const result = verdict(data({ consistencyReviewReports: [] }), { coverageExpectation: { recipeId, consistency } })
      assert.equal(result.coverage.consistency, consistency ? 'unavailable' : 'not_requested')
      assert.equal(result.canAccept, !consistency)
    })
  }
}

test('fast never skips the mandatory quality gate', () => {
  const result = verdict(data({ qualityGateReports: [], consistencyReviewReports: [] }), { coverageExpectation: { recipeId: 'fast' } })
  assert.equal(result.status, 'incomplete')
  assert.deepEqual(result.coverage, { quality: 'unavailable', consistency: 'not_requested' })
})

test('not-requested consistency still evaluates an available current report', () => {
  const result = verdict(data({ consistencyReviewReports: [review([issue('converted_to_revision')])] }), {
    coverageExpectation: { recipeId: 'fast', consistency: false }
  })
  assert.equal(result.coverage.consistency, 'current')
  assert.equal(result.status, 'blocked')
})

for (const draftContentHash of ['stale-hash', null]) {
  test(`unbound reports are stale, not unavailable: ${draftContentHash}`, () => {
    const appData = data({
      qualityGateReports: [gate({ draftContentHash, pass: false })],
      consistencyReviewReports: [review([issue()], { draftContentHash })]
    })
    const result = verdict(appData)
    assert.deepEqual(result.coverage, { quality: 'stale', consistency: 'stale' })
    assert.equal(result.status, 'incomplete')
    assert.equal(findings(result).length, 0)
    assert.deepEqual(result.sourceRefs.ignoredStaleReportIds, ['gate', 'review'])
    assert.equal(result.sourceRefs.qualityGateReportId, null)
    assert.equal(result.sourceRefs.consistencyReviewReportId, null)
    assert.deepEqual(result.advisories.map((item) => item.code), ['quality_stale', 'consistency_stale'])
    assert.equal(verdict(appData, { coverageExpectation: { recipeId: 'fast' } }).coverage.consistency, 'not_requested')
  })
}

for (const field of ['draftId', 'projectId', 'jobId']) {
  test(`reports belonging to another ${field} are not current or stale coverage`, () => {
    const result = verdict(data({
      qualityGateReports: [gate({ [field]: 'other' })], consistencyReviewReports: [review([], { [field]: 'other' })]
    }))
    assert.deepEqual(result.coverage, { quality: 'unavailable', consistency: 'unavailable' })
    assert.deepEqual(result.sourceRefs.ignoredStaleReportIds, [])
  })
}

test('a newer stale report cannot replace a current gate', () => {
  const result = verdict(data({ qualityGateReports: [gate(), gate({ id: 'later', createdAt: later, draftContentHash: 'old', pass: false })] }))
  assert.equal(result.status, 'approved')
  assert.equal(result.sourceRefs.qualityGateReportId, 'gate')
  assert.deepEqual(result.sourceRefs.ignoredStaleReportIds, ['later'])
})

test('a passing score below the author review line becomes an advisory', () => {
  const result = verdict(data({ qualityGateReports: [gate({ overallScore: 72 })] }))
  assert.equal(result.status, 'advisory')
  assert.equal(result.canAccept, true)
  assert.ok(result.advisories.some((item) => item.code === 'human_review'))
})

function audit(overrides = {}) {
  return {
    sourceDraftId: 'draft', sourceContentHash: hash, auditedAt: time, severity: 'fail', summary: 'Review novelty.',
    newNamedCharacters: [{
      kind: 'new_named_character', text: 'Fragment', evidenceExcerpt: 'Fragment evidence', reason: 'Uncertain name',
      severity: 'fail', confidence: 'low', allowedByTask: false, suggestedAction: 'Review manually'
    }],
    newWorldRules: [], newSystemMechanics: [], newOrganizationsOrRanks: [], majorLoreReveals: [],
    suspiciousDeusExRules: [], untracedNames: [], ...overrides
  }
}

test('low-confidence novelty is advisory even with a fail aggregate', () => {
  const result = verdict(data({ generationRunTraces: [trace({ noveltyAuditResult: audit() })] }))
  assert.equal(result.status, 'advisory')
  assert.equal(result.blockers.length, 0)
  assert.equal(result.advisories[0].source, 'novelty_audit')
})

test('high-confidence unauthorized novelty remains blocking', () => {
  const novelty = audit()
  novelty.newNamedCharacters[0].confidence = 'high'
  const result = verdict(data({ generationRunTraces: [trace({ noveltyAuditResult: novelty })] }))
  assert.equal(result.status, 'blocked')
})

test('stale novelty and trace state cannot leak through absent report references', () => {
  const appData = data({
    qualityGateReports: [], consistencyReviewReports: [],
    generationRunTraces: [trace({ qualityGateReportId: undefined, consistencyReviewReportId: undefined,
      characterStateIssueIds: ['unbound-state'], noveltyAuditResult: audit({ sourceContentHash: 'old' }) })]
  })
  // Preserve absent references: equality of two undefined IDs must not bind a trace.
  appData.generationRunTraces[0].qualityGateReportId = undefined
  appData.generationRunTraces[0].consistencyReviewReportId = undefined
  const result = verdict(appData)
  assert.equal(result.status, 'incomplete')
  assert.equal(findings(result).length, 0)
  assert.equal(result.sourceRefs.generationRunTraceId, null)
})

test('state inputs require draft ID, content hash and optional revision', () => {
  const state = { id: 'state', draftId: 'draft', draftContentHash: hash, draftRevision: time,
    type: 'injury_reset', severity: 'high', description: 'Injury vanished' }
  assert.equal(verdict(data(), { stateIssues: [state] }).status, 'blocked')
  for (const change of [{ draftId: 'other' }, { draftContentHash: 'old' }, { draftRevision: later }]) {
    assert.equal(verdict(data(), { stateIssues: [{ ...state, ...change }] }).status, 'approved')
  }
})

test('mixed sources retain three distinct ordered actions', () => {
  const result = verdict(data({
    qualityGateReports: [], consistencyReviewReports: [review([issue('open', 'high', { type: 'character_knowledge_leak' })])],
    generationRunTraces: [trace({ noveltyAuditResult: audit() })],
    redundancyReports: [{ ...scope, id: 'redundancy', overallRedundancyScore: 70, compressionSuggestions: ['Shorten'], createdAt: time }]
  }))
  assert.equal(result.actions.length, 3)
  assert.equal(result.actions[0].actionType, 'rerun_diagnostics')
  assert.ok(result.actions.some((action) => action.actionType === 'revise_draft'))
  assert.equal(result.status, 'blocked')
})

test('determinism, immutability, upsert identity and coverage roundtrip', () => {
  const appData = freeze(data({ consistencyReviewReports: [review([issue('converted_to_revision')])] }))
  const first = verdict(appData)
  assert.deepEqual(verdict(appData), first)
  const once = service.upsertEditorialVerdictToAppData(appData, first)
  const twice = service.upsertEditorialVerdictToAppData(freeze(once), first)
  assert.deepEqual(twice, once)
  assert.equal(twice.editorialVerdicts.length, 1)
  assert.equal(appData.editorialVerdicts.length, 0)
  assert.deepEqual(service.getEditorialVerdictForDraft(twice, 'draft'), first)
  assert.deepEqual(normalizeAppData(twice).editorialVerdicts[0].coverage, first.coverage)
  const next = service.upsertEditorialVerdictToAppData(twice, { ...first, createdAt: later, updatedAt: later })
  assert.equal(next.editorialVerdicts[0].createdAt, time)
  assert.equal(next.editorialVerdicts[0].updatedAt, later)
})

test('expectation changes replace the verdict rather than duplicating its identity', () => {
  const appData = data({ consistencyReviewReports: [] })
  const standard = verdict(appData)
  const fast = verdict(appData, { coverageExpectation: { recipeId: 'fast' } })
  assert.equal(standard.id, fast.id)
  const updated = service.upsertEditorialVerdictToAppData(service.upsertEditorialVerdictToAppData(appData, standard), fast)
  assert.equal(updated.editorialVerdicts.length, 1)
  assert.equal(updated.editorialVerdicts[0].status, 'approved')
})

test('body edits invalidate reports and revision edits invalidate cached verdicts', () => {
  const appData = data()
  const saved = service.upsertEditorialVerdictToAppData(appData, verdict(appData))
  const changed = structuredClone(saved)
  changed.generatedChapterDrafts[0].body += ' Changed.'
  changed.generatedChapterDrafts[0].updatedAt = later
  assert.equal(service.getEditorialVerdictForDraft(changed, 'draft'), null)
  assert.equal(verdict(changed).status, 'incomplete')
  const revisionOnly = structuredClone(saved)
  revisionOnly.generatedChapterDrafts[0].updatedAt = later
  assert.equal(service.getEditorialVerdictForDraft(revisionOnly, 'draft'), null)
  assert.equal(verdict(revisionOnly).status, 'approved')
})

test('missing draft fails explicitly', () => {
  assert.throws(() => service.buildEditorialVerdict({ appData: data(), draftId: 'missing' }))
})

console.log(`Editorial verdict policy: ${passed} passed, ${failed} failed.`)
if (failed) process.exitCode = 1

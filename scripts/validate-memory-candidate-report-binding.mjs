#!/usr/bin/env node
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

// Bundle in memory: no storage adapters, native modules, AI calls or fixture files.
const output = await build({
  stdin: {
    contents: `
      export { AuthorDecisionPolicyService as Policy } from './src/services/AuthorDecisionPolicyService';
      export { draftContentHash as hash } from './src/services/DraftDiagnosticBindingService';
      export { previewCandidateDecisions, applyCandidateDecisionCommand } from './src/services/CandidateDecisionService';
      export { EMPTY_APP_DATA } from './src/shared/defaults';
    `,
    resolveDir: repoRoot,
    loader: 'ts'
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'
})
const { Policy, hash, previewCandidateDecisions, applyCandidateDecisionCommand, EMPTY_APP_DATA } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
)
const t0 = '2026-09-06T00:00:00.000Z'
const t1 = '2026-09-06T01:00:00.000Z'
const t2 = '2026-09-06T02:00:00.000Z'
const t3 = '2026-09-06T03:00:00.000Z'

function candidate(overrides = {}) {
  return {
    id: 'candidate', projectId: 'p', jobId: 'job', type: 'chapter_review', targetId: null,
    proposedPatch: {
      schemaVersion: 1, kind: 'chapter_review_update', summary: 'Review', warnings: [],
      sourceChapterOrder: 1, targetChapterId: 'chapter', targetChapterOrder: 1,
      review: { summary: 'Review', newInformation: '', characterChanges: '', newForeshadowing: '',
        resolvedForeshadowing: '', endingHook: '', riskWarnings: '' },
      continuityBridgeSuggestion: null
    },
    evidence: 'Fixture evidence', confidence: 0.9, status: 'pending', createdAt: t1, updatedAt: t1,
    ...overrides
  }
}

function draft(overrides = {}) {
  return {
    id: 'draft', projectId: 'p', jobId: 'job', chapterId: 'chapter', body: 'Current body.',
    title: 'Draft', summary: '', status: 'draft', tokenEstimate: 3, createdAt: t0, updatedAt: t0,
    ...overrides
  }
}

function report(overrides = {}) {
  return {
    id: 'pass', projectId: 'p', jobId: 'job', chapterId: 'chapter', draftId: 'draft',
    draftContentHash: hash('Current body.'), overallScore: 95, pass: true,
    dimensions: Object.fromEntries([
      'plotCoherence', 'characterConsistency', 'characterStateConsistency', 'foreshadowingControl',
      'chapterContinuity', 'redundancyControl', 'styleMatch', 'pacing', 'promptCompliance',
      'contextRelevanceCompliance'
    ].map((key) => [key, 95])),
    issues: [], requiredFixes: [], optionalSuggestions: [], createdAt: t2,
    ...overrides
  }
}

function failed(overrides = {}) {
  return report({ id: 'fail', pass: false, overallScore: 20, ...overrides })
}

const data = (...drafts) => ({ generatedChapterDrafts: drafts.length ? drafts : [draft()] })
const assess = (reports, context = data(), item = candidate()) => Policy.assessMemoryCandidateQuality(item, reports, context)
const selected = (reports, context = data(), items = [candidate()]) => Policy.reportsForMemoryCandidates(items, reports, context)

function previewData(overrides = {}) {
  return {
    ...structuredClone(EMPTY_APP_DATA),
    projects: [{ id: 'p', name: 'Isolated fixture', createdAt: t0, updatedAt: t0 }],
    chapters: [{ id: 'chapter', projectId: 'p', order: 1, title: 'Chapter', body: 'Current body.',
      createdAt: t0, updatedAt: t0 }],
    chapterGenerationJobs: [{ id: 'job', projectId: 'p', targetChapterOrder: 1 }],
    generatedChapterDrafts: [draft()], qualityGateReports: [report()], memoryUpdateCandidates: [candidate()],
    ...overrides
  }
}

function preview(snapshot, decision = 'accept') {
  const before = structuredClone(snapshot)
  const result = previewCandidateDecisions(snapshot, {
    projectId: 'p',
    decisions: snapshot.memoryUpdateCandidates.filter((item) => item.projectId === 'p').map((item) =>
      ({ kind: 'memory', candidateId: item.id, decision }))
  })
  assert.deepEqual(snapshot, before, 'preview must not mutate reports or candidate warnings')
  return result
}

function assertUnverifiedNotice(snapshot, result) {
  const assessment = assess(snapshot.qualityGateReports, snapshot, snapshot.memoryUpdateCandidates[0])
  assert.equal(assessment.sourceStatus, 'unverified')
  const originalWarnings = snapshot.memoryUpdateCandidates[0].proposedPatch.warnings ?? []
  const notices = assessment.warnings.filter((warning) => !originalWarnings.includes(warning))
  assert.ok(notices.length, 'unverified provenance must have an explicit notice')
  for (const notice of notices) assert.ok(result.items[0].warnings.includes(notice), 'preview must expose provenance notices')
}

test('legacy minimal candidates without proposedPatch do not crash either policy entry point', () => {
  const minimal = { id: 'legacy', projectId: 'p', jobId: 'job', createdAt: t1 }
  assert.equal(Object.hasOwn(minimal, 'proposedPatch'), false)
  assert.equal(assess([report()], data(), minimal).sourceStatus, 'current_draft')
  assert.deepEqual(selected([report()], data(), [minimal]), [])
  const legacyFailure = failed()
  assert.deepEqual(Policy.reportsForMemoryCandidates([minimal], [legacyFailure]), [legacyFailure])
  for (const item of [minimal, { id: 'legacy-no-date', projectId: 'p', jobId: 'job' }]) {
    const result = Policy.assessMemoryCandidateQuality(item, [report()])
    assert.equal(result.sourceStatus, 'unverified')
    assert.ok(result.warnings.length)
  }
})

test('legacy malformed warning fields neither crash nor turn a string into per-character warnings', () => {
  for (const patch of [null, {}, { warnings: null }, { warnings: 'legacy text' }, { warnings: {} }]) {
    const item = candidate({ proposedPatch: patch })
    assert.deepEqual(assess([report()], data(), item).warnings, [])
    assert.deepEqual(selected([report()], data(), [item]), [])
  }
  const item = candidate({ proposedPatch: { warnings: ['Keep this novelty warning', null, 7, false, {}] } })
  assert.deepEqual(assess([report()], data(), item).warnings, ['Keep this novelty warning'])
})

test('same jobId never imports a foreign project report, with or without AppData', () => {
  const foreign = failed({ projectId: 'other', createdAt: t3 })
  assert.deepEqual(Policy.reportsForMemoryCandidates([candidate()], [foreign]), [])
  assert.deepEqual(selected([foreign]), [])
  assert.equal(assess([foreign]).report, null)
  assert.deepEqual(selected([report(), foreign]), [])
})

test('foreign passing report cannot conceal a local failed report', () => {
  const local = failed()
  const foreign = report({ projectId: 'other', createdAt: t3 })
  assert.deepEqual(Policy.reportsForMemoryCandidates([candidate()], [local, foreign]), [local])
  assert.deepEqual(selected([local, foreign]), [local])
})

test('late old-hash failure cannot override a current bound pass', () => {
  const current = report()
  const stale = failed({ draftContentHash: hash('Old body.'), createdAt: t3 })
  assert.deepEqual(selected([current, stale]), [])
  assert.equal(assess([stale, current]).report, current)
  assert.equal(assess([stale, current]).sourceStatus, 'current_draft')
})

test('other draft, job, chapter and hashless failures cannot override a current pass', () => {
  const current = report()
  for (const mismatch of [
    { draftId: 'other-draft' }, { jobId: 'other-job' }, { chapterId: 'other-chapter' },
    { draftContentHash: null }, { draftContentHash: undefined }, { draftContentHash: '' }
  ]) {
    assert.deepEqual(selected([current, failed({ ...mismatch, createdAt: t3 })]), [])
  }
})

test('latest report is chosen within the current binding before assessing risk', () => {
  const oldFailure = failed({ createdAt: t1 })
  const currentPass = report()
  assert.deepEqual(selected([currentPass, oldFailure]), [])
  const latestFailure = failed({ id: 'latest-fail', createdAt: t3 })
  assert.deepEqual(selected([currentPass, latestFailure]), [latestFailure])
  const stalePass = report({ draftContentHash: hash('Old body.'), createdAt: t3 })
  assert.deepEqual(selected([oldFailure, stalePass]), [oldFailure])
})

test('current bound legacy raw-pass reports with required fixes still require review', () => {
  const inconsistent = report({ requiredFixes: ['Must fix'] })
  assert.deepEqual(selected([inconsistent]), [inconsistent])
})

test('no current report does not reuse an old failure or fabricate a passed review', () => {
  const stale = failed({ draftContentHash: hash('Old body.') })
  const result = assess([stale])
  assert.equal(result.report, null)
  assert.equal(result.sourceStatus, 'unverified')
  assert.match(result.warnings.join(' '), /hash/)
  assert.deepEqual(selected([stale]), [])
  assert.equal(assess([]).sourceStatus, 'unverified')
})

test('legacy two-argument calls retain local historical risk and report it as unverified', () => {
  const legacyFailure = failed({ draftId: null, draftContentHash: undefined })
  assert.deepEqual(Policy.reportsForMemoryCandidates([candidate()], [legacyFailure]), [legacyFailure])
  for (const reports of [[legacyFailure], [report()], []]) {
    const result = Policy.assessMemoryCandidateQuality(candidate(), reports)
    assert.equal(result.sourceStatus, 'unverified')
    assert.match(result.warnings.join(' '), /不代表当前正文审稿通过/)
  }
})

test('edited or replaced drafts cannot certify an older candidate using updatedAt', () => {
  const oldCandidate = candidate({ updatedAt: t3 })
  for (const source of [draft({ updatedAt: t2 }), draft({ createdAt: t2, updatedAt: t2 })]) {
    const result = assess([report()], data(source), oldCandidate)
    assert.equal(result.sourceStatus, 'unverified')
    assert.match(result.warnings.join(' '), /候选来源版本无法核实/)
  }
})

test('missing, ambiguous and foreign-only drafts remain unverified', () => {
  for (const sources of [[], [draft(), draft({ id: 'second' })], [draft({ projectId: 'other' })]]) {
    assert.equal(assess([report()], { generatedChapterDrafts: sources }).sourceStatus, 'unverified')
  }
  assert.equal(assess([report()], data(draft(), draft({ projectId: 'other' }))).sourceStatus, 'current_draft')
})

test('invalid source timestamps cannot establish provenance; equal times and time zones work', () => {
  for (const source of [draft({ createdAt: '' }), draft({ updatedAt: 'invalid' })]) {
    assert.equal(assess([report()], data(source)).sourceStatus, 'unverified')
  }
  assert.equal(assess([report()], data(), candidate({ createdAt: '' })).sourceStatus, 'unverified')
  const sameTime = candidate({ createdAt: '2026-09-06T08:00:00+08:00' })
  assert.equal(assess([report()], data(), sameTime).sourceStatus, 'current_draft')
})

test('candidate targetId is not mistaken for its source draft or source chapter', () => {
  const item = candidate({ type: 'character_update', targetId: 'character-id' })
  assert.equal(assess([report()], data(), item).sourceStatus, 'current_draft')
})

test('draft binding retains normalized newline hash semantics and allows unlinked chapters', () => {
  const source = draft({ body: 'a\r\nb', chapterId: null })
  const matching = report({ draftContentHash: hash('a\nb'), chapterId: null })
  assert.equal(assess([matching], data(source)).sourceStatus, 'current_draft')
})

test('candidate novelty warnings survive current passes and unverified history without mutation', () => {
  const item = candidate()
  item.proposedPatch.warnings = ['Novelty warning: untraced new world rule']
  Object.freeze(item.proposedPatch.warnings)
  Object.freeze(item.proposedPatch)
  Object.freeze(item)
  const current = report()
  const reports = Object.freeze([current])
  const snapshot = structuredClone(item)
  const bound = assess(reports, data(), item)
  assert.deepEqual(bound.warnings, item.proposedPatch.warnings)
  assert.notEqual(bound.warnings, item.proposedPatch.warnings)
  assert.deepEqual(selected(reports, data(), [item]), [])
  const legacy = Policy.assessMemoryCandidateQuality(item, reports)
  assert.equal(legacy.warnings[0], item.proposedPatch.warnings[0])
  assert.equal(legacy.warnings.length, 2)
  assert.deepEqual(item, snapshot)
})

test('batch report deduplication is project-scoped and tie selection is deterministic', () => {
  const local = failed({ id: 'shared' })
  const foreign = failed({ id: 'shared', projectId: 'other' })
  const items = [candidate(), candidate({ id: 'c2' }), candidate({ id: 'c3', projectId: 'other' })]
  assert.deepEqual(Policy.reportsForMemoryCandidates(items, [local, foreign]), [local, foreign])
  const laterIdPass = report({ id: 'z' })
  assert.deepEqual(selected([local, laterIdPass]), [])
  assert.deepEqual(selected([laterIdPass, local]), [])
})

test('missing provenance stays unverified even when a historical report passed', () => {
  const historicalPass = report({ draftId: 'removed-draft', draftContentHash: hash('Old body.') })
  const snapshot = previewData({ generatedChapterDrafts: [], qualityGateReports: [historicalPass] })
  const assessment = assess(snapshot.qualityGateReports, snapshot)
  assert.equal(assessment.sourceStatus, 'unverified')
  assert.match(assessment.warnings.join(' '), /不代表当前正文审稿通过/)
  const result = preview(snapshot)
  assertUnverifiedNotice(snapshot, result)
  assert.equal(result.items[0].risk, 'low')
  assert.equal(result.requiresConfirmation, false)
})

test('real preview chooses the latest currently bound report, not a late stale failure', () => {
  const snapshot = previewData({ qualityGateReports: [
    failed({ id: 'old-bound-failure', createdAt: t1 }), report(),
    failed({ id: 'late-stale-failure', draftContentHash: hash('Old body.'), createdAt: t3 })
  ] })
  const result = preview(snapshot)
  assert.equal(result.items[0].risk, 'low')
  assert.deepEqual(result.items[0].warnings, [])
  assert.equal(result.requiresConfirmation, false)
})

test('real preview keeps current report failures and required fixes as actual review risk', () => {
  for (const latest of [failed({ createdAt: t3 }), report({ id: 'raw-pass-with-fix', createdAt: t3, requiredFixes: ['Fix'] })]) {
    const snapshot = previewData({ qualityGateReports: [report(), latest] })
    const result = preview(snapshot)
    assert.equal(result.items[0].risk, 'high')
    assert.ok(result.items[0].warnings.some((warning) =>
      warning.startsWith('来源正文') && warning.includes(Policy.riskMessage(latest))
    ), 'current review risk must expose the actual score and blocking reasons')
    assert.equal(result.requiresConfirmation, true)
  }
})

test('historical failed reports retain risk but are never labelled as current source review', () => {
  const historicalFailure = failed({ draftId: 'removed-draft', draftContentHash: hash('Old body.') })
  const snapshot = previewData({ generatedChapterDrafts: [], qualityGateReports: [historicalFailure] })
  const result = preview(snapshot)
  assertUnverifiedNotice(snapshot, result)
  assert.ok(result.items[0].warnings.some((warning) =>
    warning.startsWith('历史参考') && warning.includes(Policy.riskMessage(historicalFailure))
  ))
  assert.equal(result.items[0].warnings.some((warning) => warning.startsWith('来源正文')), false)
  assert.equal(result.items[0].risk, 'high', 'the actual historical failure, not the unverified notice, retains review risk')
  assert.equal(result.requiresConfirmation, true)
})

test('real preview isolates both project and job even with colliding report and draft ids', () => {
  const snapshot = previewData({ qualityGateReports: [report(),
    failed({ id: 'pass', projectId: 'other', createdAt: t3 }),
    failed({ id: 'pass', jobId: 'other-job', createdAt: t3 })
  ], generatedChapterDrafts: [draft(), draft({ projectId: 'other' }), draft({ jobId: 'other-job' })] })
  const result = preview(snapshot)
  assert.equal(result.items[0].risk, 'low')
  assert.deepEqual(result.items[0].warnings, [])
  assert.equal(result.requiresConfirmation, false)
})

test('unverified-source notice alone adds no forced gate for low or medium confidence candidates', () => {
  for (const [confidence, expectedRisk] of [[0.9, 'low'], [0.4, 'medium']]) {
    for (const context of [
      { generatedChapterDrafts: [], qualityGateReports: [] },
      { qualityGateReports: [] },
      { qualityGateReports: [report({ draftContentHash: hash('Old body.') })] },
      { generatedChapterDrafts: [draft({ updatedAt: t2 })], qualityGateReports: [report()] }
    ]) {
      const snapshot = previewData({ ...context, memoryUpdateCandidates: [candidate({ confidence })] })
      const result = preview(snapshot)
      assertUnverifiedNotice(snapshot, result)
      assert.equal(result.items[0].risk, expectedRisk)
      assert.equal(result.requiresConfirmation, false)
    }
  }
})

test('candidate novelty warnings stay high risk under both current passes and unverified sources', () => {
  const item = candidate()
  item.proposedPatch.warnings = ['Novelty warning: untraced new world rule']
  for (const context of [{}, { generatedChapterDrafts: [], qualityGateReports: [] }]) {
    const snapshot = previewData({ ...context, memoryUpdateCandidates: [item] })
    const result = preview(snapshot)
    assert.equal(result.items[0].risk, 'high')
    assert.equal(result.requiresConfirmation, true)
    assert.ok(result.items[0].warnings.includes(item.proposedPatch.warnings[0]))
    if (!snapshot.generatedChapterDrafts.length) assertUnverifiedNotice(snapshot, result)
    const rejection = preview(snapshot, 'reject')
    assert.equal(rejection.items[0].risk, 'high')
    assert.equal(rejection.requiresConfirmation, false, 'rejecting risk must not require acceptance confirmation')
    assert.ok(rejection.items[0].warnings.includes(item.proposedPatch.warnings[0]))
  }
})

test('destructive foreshadowing decisions retain intrinsic risk when sources are unverified', () => {
  for (const suggestedStatus of ['resolved', 'abandoned']) {
    const item = candidate({ type: 'foreshadowing', targetId: 'foreshadowing', proposedPatch: {
      schemaVersion: 1, kind: 'foreshadowing_status_update', summary: 'Change status', warnings: [],
      foreshadowingId: 'foreshadowing', suggestedStatus
    } })
    const snapshot = previewData({ generatedChapterDrafts: [], qualityGateReports: [], memoryUpdateCandidates: [item] })
    const result = preview(snapshot)
    assertUnverifiedNotice(snapshot, result)
    assert.equal(result.items[0].risk, 'high')
    assert.equal(result.requiresConfirmation, true)
    assert.ok(result.items[0].warnings.some((warning) => /伏笔/.test(warning)))
  }
})

test('batch preview keeps report risk isolated per candidate job', () => {
  const otherDraft = draft({ id: 'draft-2', jobId: 'job-2' })
  const snapshot = previewData({
    generatedChapterDrafts: [draft(), otherDraft],
    qualityGateReports: [report(), failed({ id: 'failure-2', jobId: 'job-2', draftId: 'draft-2' })],
    memoryUpdateCandidates: [candidate(), candidate({ id: 'candidate-2', jobId: 'job-2' })]
  })
  const result = preview(snapshot)
  assert.deepEqual(result.items.map((item) => item.risk), ['low', 'high'])
  assert.deepEqual(result.items[0].warnings, [])
  assert.ok(result.items[1].warnings.length)
  assert.equal(result.requiresConfirmation, true)
})

test('risk and provenance warning changes invalidate the preview fingerprint and reject the stale command', () => {
  const cases = [
    [[report()], [failed()]],
    [[], [report()]],
    [[failed({ overallScore: 20 })], [failed({ overallScore: 30 })]]
  ]
  for (const [beforeReports, afterReports] of cases) {
    const before = previewData({ qualityGateReports: beforeReports })
    const oldPreview = preview(before)
    const after = { ...before, qualityGateReports: afterReports }
    const newPreview = preview(after)
    assert.notEqual(oldPreview.items[0].expectedFingerprint, newPreview.items[0].expectedFingerprint)
    const unchanged = structuredClone(after)
    assert.throws(() => applyCandidateDecisionCommand(after, {
      id: 'stale-preview', projectId: 'p', schemaVersion: 1, actor: { kind: 'user' },
      reason: 'Isolated stale-preview regression', decidedAt: t3, confirmedHighRisk: true,
      decisions: oldPreview.items.map(({ kind, candidateId, decision, expectedFingerprint }) =>
        ({ kind, candidateId, decision, expectedFingerprint }))
    }), (error) => error.code === 'CANDIDATE_PREVIEW_STALE')
    assert.deepEqual(after, unchanged, 'stale rejection must not apply any candidate or receipt')
  }
})

test('ignored foreign and stale diagnostics do not change an otherwise identical preview fingerprint', () => {
  const before = previewData()
  const after = { ...before, qualityGateReports: [...before.qualityGateReports,
    failed({ projectId: 'other', createdAt: t3 }), failed({ jobId: 'other-job', createdAt: t3 }),
    failed({ draftContentHash: hash('Old body.'), createdAt: t3 })
  ] }
  assert.deepEqual(preview(after), preview(before))
})

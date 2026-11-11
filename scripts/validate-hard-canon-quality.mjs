import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { repoRoot } from './utils/repo-root.mjs'

// Exercise the actual desktop diagnostic handler and the shared pipeline step, without Electron, storage or a model.
const handlers = new Map()
const electron = { ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, app: { isReady: () => false, isPackaged: true } }
const compiled = await build({
  stdin: { resolveDir: repoRoot, contents: `
    export { auditHardCanon } from './src/services/HardCanonAuditService'
    export * from './src/services/qualityGate/hardCanonQuality'
    export { normalizeQualityGateReport } from './src/shared/normalizers/reports'
    export { draftContentHash, invalidateDraftDiagnosticsAfterChange, latestQualityReportForDraft } from './src/services/DraftDiagnosticBindingService'
    export { AuthorDecisionPolicyService } from './src/services/AuthorDecisionPolicyService'
    export { DiagnosticsService } from './src/main/services/DiagnosticsService'
    export { registerDiagnosticsIpcHandlers } from './src/main/ipc/diagnosticsIpcHandlers'
    export { IPC_CHANNELS } from './src/shared/ipc/ipcChannels'
    export { runQualityGateStep } from './src/renderer/src/views/generation/pipelineSteps/qualityCheck'
    export { restorePipelineStateFromCompletedSteps } from './src/renderer/src/views/generation/pipelineStateRestore'
    export { HardCanonAuditPanel } from './src/renderer/src/components/HardCanonAuditPanel'
    export { PipelineDiagnosticsPanel } from './src/renderer/src/components/pipeline/PipelineDiagnosticsPanel'
  ` },
  platform: 'node', format: 'cjs', target: 'node22', packages: 'external', loader: { '.css': 'empty' }, bundle: true, write: false
})
const require = createRequire(import.meta.url)
const mod = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
  (id) => id === 'electron' ? electron : require(id), mod, mod.exports
)
const {
  auditHardCanon, normalizeQualityGateReport, withCurrentHardCanonAudit, qualityReportWithoutHardCanon,
  draftContentHash, invalidateDraftDiagnosticsAfterChange, latestQualityReportForDraft, AuthorDecisionPolicyService,
  runQualityGateStep, restorePipelineStateFromCompletedSteps, HardCanonAuditPanel, PipelineDiagnosticsPanel
} = mod.exports
const render = (component, props) => renderToStaticMarkup(createElement(component, props))
const projectId = 'quality-fixture'
const date = '2026-01-10T08:00:00.000Z'
const bookOnly = '只有虚构前章存有的参照句'
const ruleOnly = '未进入模型上下文的规则标题'
const body = '架上放着灰铃。桌角压着晓签。\r\n' + Array.from({ length: 100 },
  (_, i) => `第${i + 1}张登记纸叠在窗台上。她腾出一只手，把编号写进空着的方格里。`).join('\n')
const draft = { id: 'd', jobId: 'j', chapterId: 'c2', projectId, title: '登记册', body, status: 'draft', updatedAt: date, createdAt: date }
const job = { id: draft.jobId, projectId, targetChapterOrder: 2, pipelineRecipeId: 'standard', pipelineMode: 'standard' }
const target = (text) => ({ projectId, chapterOrder: job.targetChapterOrder, chapterId: draft.chapterId, body: text })
const rule = (id, term, enforcement) => ({
  id, projectId, title: ruleOnly + term, content: '合成规则正文', category: 'prohibition', priority: 'must',
  status: 'active', createdAt: date, updatedAt: date, check: { kind: 'literal', mode: 'terms', terms: [term], enforcement, maxPerChapter: 0 }
})
const ruleA = rule('rule-A', '灰铃', 'block'), ruleB = rule('rule-B', '晓签', 'review')
const pack = { id: 'pack', projectId, items: [ruleA, ruleB], createdAt: date, updatedAt: date, schemaVersion: 1 }
const step = { id: 'gate', jobId: job.id, type: 'quality_gate', status: 'pending', updatedAt: date, output: '' }
const data = {
  hardCanonPacks: [pack], characters: [], characterStateFacts: [], foreshadowings: [], generatedChapterDrafts: [draft],
  chapters: [
    { id: 'c1', projectId, order: 1, body: bookOnly + '。灰铃。' },
    { id: 'c2', projectId, order: 2, body: '灰铃。架上也是灰铃。' }
  ],
  chapterGenerationSteps: [
    { ...step, id: 'prose', type: 'generate_chapter_draft', status: 'completed', output: JSON.stringify({ title: draft.title, body }) }, step
  ],
  chapterGenerationJobs: [job], consistencyReviewReports: [], qualityGateReports: [], redundancyReports: [],
  editorialVerdicts: [], generationRunTraces: [], runTraceAuthorSummaries: []
}
const dimensions = Object.fromEntries(Object.keys(normalizeQualityGateReport({}).dimensions).map(key => [key, 92]))
const semantic = { pass: true, overallScore: 92, dimensions, issues: [], requiredFixes: [], optionalSuggestions: [] }
const passNovelty = {
  severity: 'pass', summary: '', newNamedCharacters: [], newWorldRules: [], newSystemMechanics: [], newOrganizationsOrRanks: [],
  majorLoreReveals: [], suspiciousDeusExRules: [], untracedNames: []
}
const modelCalls = [], diagnosticRequests = []
const diagnosticsService = new mod.exports.DiagnosticsService({
  chatCompletion: async request => {
    modelCalls.push(request)
    return { ok: true, content: JSON.stringify(semantic), finishReason: 'stop' }
  }
})
mod.exports.registerDiagnosticsIpcHandlers(diagnosticsService)
async function runGate(library) {
  const current = library.generatedChapterDrafts[0]
  const redundancy = { projectId, id: 'redundancy', chapterId: current.chapterId, draftId: current.id, jobId: job.id,
    draftContentHash: draftContentHash(current.body), overallRedundancyScore: 0, compressionSuggestions: [], createdAt: date }
  const state = { working: { ...library, redundancyReports: [redundancy] }, context: '仅本章的场景提纲', plan: null }
  restorePipelineStateFromCompletedSteps(state, library.chapterGenerationSteps, false, false)
  await runQualityGateStep({ state, job, step, options: { pipelineMode: 'standard' }, env: {
    project: { id: projectId }, scoped: { characters: [] }, runId: 'fixture-run',
    getAiSettings: () => ({ apiProvider: 'local', baseUrl: 'http://localhost:1', modelName: 'fixture', temperature: 0, maxTokens: 1000 }),
    updateStepInData: (working, id, patch) => ({
      ...working, chapterGenerationSteps: working.chapterGenerationSteps.map(item => item.id === id ? { ...item, ...patch } : item)
    }),
    diagnostics: {
      auditNovelty: async () => passNovelty,
      evaluateQualityGate: async request => {
        diagnosticRequests.push(request)
        const result = await handlers.get(mod.exports.IPC_CHANNELS.DIAGNOSTICS_EVALUATE_QUALITY_GATE)({}, request)
        assert.ok(result.id, result.error)
        return result
      }
    }
  } })
  return state.working
}

const first = await runGate(data)
const report = first.qualityGateReports[0], audit = report.hardCanonAudit
const base = qualityReportWithoutHardCanon(report)
assert.deepEqual(audit, auditHardCanon(data, target(body)))
assert.ok(audit.findings.some(f => f.ruleId === ruleA.id && f.severity === 'block'))
assert.ok(audit.findings.some(f => f.ruleId === ruleB.id && f.severity === 'review'))
assert.deepEqual(audit.counts.find(count => count.ruleId === ruleA.id), {
  ruleId: ruleA.id, chapterCount: 1, bookCount: 3, projectedBookCount: 2, delta: -1
})
assert.equal(base.pass, true)
assert.equal(report.pass, false)
assert.deepEqual(report.issues, [])
assert.deepEqual(report.requiredFixes, [])
assert.deepEqual(report.dimensions, dimensions)
assert.equal(report.overallScore, semantic.overallScore)
assert.equal(report.hardCanonBasePass, base.pass)
assert.deepEqual(first.consistencyReviewReports[0].issues, [])
assert.deepEqual(first.editorialVerdicts[0].blockers, [])
assert.equal(first.editorialVerdicts[0].status, 'approved')
assert.equal(first.generationRunTraces[0].qualityGateReportId, report.id)
assert.deepEqual(JSON.parse(first.chapterGenerationSteps.find(item => item.id === step.id).output).hardCanonAudit, audit)
assert.equal(modelCalls.length, 1)

const persisted = normalizeQualityGateReport(JSON.parse(JSON.stringify(report)))
assert.deepEqual(persisted.hardCanonAudit, audit)
assert.equal(qualityReportWithoutHardCanon(persisted).pass, true)
assert.deepEqual(withCurrentHardCanonAudit(persisted, audit), persisted)
assert.deepEqual(withCurrentHardCanonAudit(persisted, null), qualityReportWithoutHardCanon(persisted))
assert.equal(withCurrentHardCanonAudit(base, null), base)
const legacy = normalizeQualityGateReport({ ...base, pass: false })
assert.ok(!('hardCanonAudit' in legacy))
assert.equal(withCurrentHardCanonAudit(legacy, null), legacy)
assert.equal(withCurrentHardCanonAudit(legacy, null).pass, false)
for (const bad of [{ ...audit, projectId: 'other' }, { ...audit, draftContentHash: 'other' }]) {
  assert.throws(() => withCurrentHardCanonAudit(base, bad), /不匹配/)
}
const corrupt = normalizeQualityGateReport({ ...report, hardCanonAudit: { ...audit, findings: [{ severity: 'unknown' }] } })
assert.ok(!('hardCanonAudit' in corrupt) && !('hardCanonBasePass' in corrupt))
assert.equal(corrupt.pass, false)

const weakPack = { ...pack, items: [rule('rule-A', '灰铃', 'review'), ruleB] }
const weakAudit = auditHardCanon({ ...data, hardCanonPacks: [weakPack] }, target(body))
assert.notEqual(weakAudit.rulesFingerprint, audit.rulesFingerprint)
const weakReport = withCurrentHardCanonAudit(persisted, weakAudit)
assert.equal(weakReport.pass, true)
assert.deepEqual(weakReport.issues, base.issues)
assert.deepEqual(weakReport.requiredFixes, base.requiredFixes)
assert.deepEqual(weakReport.optionalSuggestions, base.optionalSuggestions)
assert.deepEqual(weakReport.dimensions, base.dimensions)
assert.equal(weakReport.overallScore, base.overallScore)
assert.equal(AuthorDecisionPolicyService.assessQualityGate(weakReport).status, 'passed')
const nearThreshold = { ...base, overallScore: 50 }
assert.equal(withCurrentHardCanonAudit(nearThreshold, weakAudit).pass, true)
const emptyAudit = auditHardCanon({ ...data, hardCanonPacks: [] }, target(body))
assert.deepEqual(withCurrentHardCanonAudit(report, emptyAudit), base)
const otherFailure = { ...base, pass: false, requiredFixes: ['普通审稿仍有必修项'] }
assert.deepEqual(withCurrentHardCanonAudit(withCurrentHardCanonAudit(otherFailure, audit), null), otherFailure)
assert.equal(withCurrentHardCanonAudit(otherFailure, weakAudit).pass, false)
assert.equal(report.pass, false, 'replacing the live check must not mutate the historical report')
const lfBody = body.replaceAll('\r\n', '\n')
assert.equal(draftContentHash(lfBody), draftContentHash(body))
await assert.rejects(diagnosticsService.evaluateQualityGate({
  ...diagnosticRequests[0], chapterDraft: { ...draft, body: lfBody }, hardCanonAudit: audit
}), /不匹配/)
await assert.rejects(diagnosticsService.evaluateQualityGate({
  ...diagnosticRequests[0], targetChapterOrder: job.targetChapterOrder + 1, hardCanonAudit: audit
}), /不匹配/)
assert.equal(modelCalls.length, 1, 'a rules-only change is checked locally')

const revisedBody = body.replace('灰铃', '木盒')
const edited = invalidateDraftDiagnosticsAfterChange(first, draft.id, revisedBody, '2026-01-10T09:00:00.000Z')
assert.equal(latestQualityReportForDraft(edited.qualityGateReports, edited.generatedChapterDrafts[0]), null)
const second = await runGate(edited)
const fresh = second.qualityGateReports[0]
assert.equal(modelCalls.length, 2, 'only the two ordinary semantic reviews may call the transport')
for (const request of modelCalls) {
  assert.ok(!JSON.stringify(request.messages).includes(bookOnly))
  assert.ok(!JSON.stringify(request.messages).includes(ruleOnly))
}
for (const request of diagnosticRequests) {
  assert.ok(!JSON.stringify(request).includes(bookOnly))
  assert.ok(!('chapters' in request) && !('hardCanonPacks' in request))
}
assert.equal(diagnosticRequests[1].chapterDraft.body, revisedBody)
assert.equal(fresh.draftContentHash, draftContentHash(revisedBody))
assert.equal(fresh.hardCanonAudit.draftContentHash, fresh.draftContentHash)
assert.notEqual(fresh.hardCanonAudit.rawBodyFingerprint, audit.rawBodyFingerprint)
assert.ok(!fresh.hardCanonAudit.findings.some(f => f.severity === 'block'))
assert.equal(fresh.pass, true)
assert.deepEqual(second.qualityGateReports.find(item => item.id === report.id), report)

const viewProps = { editorialVerdict: first.editorialVerdicts[0], qualityReport: report, latestDraft: draft,
  chapterCommitBundles: [], revisionCandidates: [], consistencyReports: [], linkedConsistencyIssueTitle: () => null }
const headline = (props) => render(PipelineDiagnosticsPanel, { ...viewProps, ...props }).split('<details class="pipeline-original-reports">')[0]
assert.match(headline({ hardCanonAudit: audit }), /硬设定未通过/)
assert.doesNotMatch(headline({ hardCanonAudit: audit }), /可以采纳|接受草稿|没有必须先修订的问题/)
assert.match(headline({ hardCanonAudit: weakAudit }), /可采纳，有硬设定提示/)
assert.match(headline({ hardCanonAudit: null }), /没有适用于本章的可执行硬设定/)
assert.doesNotMatch(headline({ hardCanonAudit: null }), /硬设定未通过|确证违反/)
assert.match(headline({}), /硬设定待核对/)
assert.doesNotMatch(headline({ hardCanonAudit: fresh.hardCanonAudit }), /可采纳，有硬设定提示/)
assert.match(headline({ hardCanonAudit: audit, latestDraft: { ...draft, body: lfBody } }), /硬设定待核对/)
const snapshotHtml = render(HardCanonAuditPanel, { audit, scope: 'report_snapshot' })
const finding = audit.findings.find(f => f.severity === 'block')
for (const value of [finding.excerpt, finding.reason, finding.ruleVersion, finding.ruleId, audit.rulesFingerprint,
  `正文第 ${finding.start + 1} 至 ${finding.end} 位`, '本章 1 次', '已采纳全书 3 次', '采纳此稿后 2 次', '变化 -1 次']) {
  assert.ok(snapshotHtml.includes(value), `missing readable evidence: ${value}`)
}
assert.match(snapshotHtml, /审稿当时的硬设定核查/)
assert.match(render(HardCanonAuditPanel, { audit, body }), /架上放着<mark>灰铃<\/mark>。/)
assert.match(render(HardCanonAuditPanel, { audit, body: lfBody }), /正文已变化/)
assert.doesNotMatch(render(HardCanonAuditPanel, { audit, body: lfBody, scope: 'report_snapshot' }), /<mark>/)
assert.match(render(HardCanonAuditPanel, { audit, scope: 'historical_version' }), /历史正文 · 按现行规则核对/)
assert.match(render(HardCanonAuditPanel, { audit: null, scope: 'report_snapshot' }), /没有保存/)
const hints = Array.from({ length: 13 }, (_, i) => ({ ...finding, severity: 'review', reason: `复核第${i + 1}处` }))
const longList = render(HardCanonAuditPanel, { audit: { ...audit, findings: [...hints, finding] } })
assert.ok(longList.includes(finding.reason) && !longList.includes('复核第13处'))
assert.match(longList, /查看更多证据/)
console.log('validate-hard-canon-quality: pipeline, revised text, report provenance, local replacement and author evidence passed')

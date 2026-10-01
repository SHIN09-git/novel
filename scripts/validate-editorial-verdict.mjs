import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'editorial-verdict-test')
const timestamp = '2026-09-05T12:00:00.000Z'

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function bundle(entryPoint, fileName) {
  const outfile = join(outDir, fileName)
  await build({
    entryPoints: [join(root, entryPoint)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

function audit(hash) {
  return {
    newNamedCharacters: [{
      kind: 'new_named_character', text: '她没有', evidenceExcerpt: '她没有回头', reason: '低置信度中文片段', severity: 'fail',
      allowedByTask: false, hasPriorForeshadowing: false, suggestedAction: '人工复核', confidence: 'low'
    }],
    newWorldRules: [], newSystemMechanics: [], newOrganizationsOrRanks: [], majorLoreReveals: [], suspiciousDeusExRules: [], untracedNames: [],
    severity: 'warning', summary: '存在低置信度命名片段。', sourceDraftId: 'draft-1', sourceContentHash: hash, auditedAt: timestamp
  }
}

function makeData(normalizeAppData, hash, overrides = {}) {
  return normalizeAppData({
    schemaVersion: 3,
    projects: [{ id: 'project-1', name: '测试项目', createdAt: timestamp, updatedAt: timestamp }],
    chapters: [{ id: 'chapter-1', projectId: 'project-1', order: 11, title: '第十一章', body: '', createdAt: timestamp, updatedAt: timestamp }],
    generatedChapterDrafts: [{
      id: 'draft-1', projectId: 'project-1', chapterId: 'chapter-1', jobId: 'job-1', title: '第十一章草稿',
      body: '正文中只保留必要的审稿证据，不应复制整篇正文。', summary: '', status: 'draft', tokenEstimate: 30,
      createdAt: timestamp, updatedAt: timestamp
    }],
    qualityGateReports: [
      { id: 'quality-current', projectId: 'project-1', jobId: 'job-1', chapterId: 'chapter-1', draftId: 'draft-1', draftContentHash: hash, overallScore: 86, pass: true, dimensions: {}, issues: [], requiredFixes: [], optionalSuggestions: [], createdAt: timestamp },
      { id: 'quality-stale-newer', projectId: 'project-1', jobId: 'job-1', chapterId: 'chapter-1', draftId: 'draft-1', draftContentHash: 'draft-v1-stale', overallScore: 10, pass: false, dimensions: {}, issues: [], requiredFixes: ['旧正文问题'], optionalSuggestions: [], createdAt: '2026-09-05T13:00:00.000Z' }
    ],
    consistencyReviewReports: [{
      id: 'consistency-current', projectId: 'project-1', jobId: 'job-1', chapterId: 'chapter-1', draftId: 'draft-1', draftContentHash: hash,
      issues: [{ id: 'consistency-issue', type: 'previous_chapter_contradiction', severity: 'high', title: '上一章衔接冲突', description: '角色位置与上一章结尾矛盾。', evidence: '角色无解释跨区', relatedChapterIds: [], relatedCharacterIds: [], relatedForeshadowingIds: [], suggestedFix: '补足移动过程。', revisionInstruction: '补足移动过程。', status: 'open' }],
      suggestions: '', severitySummary: 'high', createdAt: timestamp
    }],
    redundancyReports: [{ id: 'redundancy-current', projectId: 'project-1', jobId: 'job-1', chapterId: 'chapter-1', draftId: 'draft-1', draftContentHash: hash, repeatedPhrases: [], repeatedSceneDescriptions: [], repeatedExplanations: [], overusedIntensifiers: [], redundantParagraphs: [], compressionSuggestions: ['删减一次重复解释。'], overallRedundancyScore: 55, createdAt: timestamp }],
    generationRunTraces: [{
      id: 'trace-current', projectId: 'project-1', jobId: 'job-1', targetChapterOrder: 11, generatedDraftId: 'draft-1',
      qualityGateReportId: 'quality-current', consistencyReviewReportId: 'consistency-current', redundancyReportId: 'redundancy-current',
      characterStateWarnings: [], characterStateIssueIds: [], noveltyAuditResult: audit(hash), createdAt: timestamp, updatedAt: timestamp
    }],
    ...overrides
  })
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const service = await bundle('src/services/EditorialVerdictService.ts', 'service.mjs')
  const defaults = await bundle('src/shared/defaults.ts', 'defaults.mjs')
  const binding = await bundle('src/services/DraftDiagnosticBindingService.ts', 'binding.mjs')
  const checks = []
  const body = '正文中只保留必要的审稿证据，不应复制整篇正文。'
  const hash = binding.draftContentHash(body)
  const data = makeData(defaults.normalizeAppData, hash)
  const verdict = service.buildEditorialVerdict({ appData: data, draftId: 'draft-1', createdAt: timestamp })

  checks.push(assert(verdict.status === 'blocked' && !verdict.canAccept, 'high consistency issue blocks the exact current draft', verdict))
  checks.push(assert(verdict.sourceRefs.qualityGateReportId === 'quality-current', 'latest matching report wins over a newer stale report', verdict.sourceRefs))
  checks.push(assert(verdict.sourceRefs.ignoredStaleReportIds.includes('quality-stale-newer'), 'stale report is recorded but never treated as current'))
  checks.push(assert(verdict.blockers.some((item) => item.source === 'consistency_review'), 'consistency blocker is preserved with source reference'))
  checks.push(assert(verdict.advisories.some((item) => item.source === 'novelty_audit'), 'low-confidence novelty remains advisory'))
  checks.push(assert(!verdict.blockers.some((item) => item.source === 'novelty_audit'), 'low-confidence novelty cannot block acceptance'))
  checks.push(assert(verdict.advisories.some((item) => item.source === 'redundancy_report'), 'redundancy is represented as advisory'))
  checks.push(assert(verdict.actions.length <= 3, 'author actions are capped at three', verdict.actions))
  checks.push(assert(verdict.draftContentHash === hash && verdict.draftRevision === timestamp, 'verdict binds content hash and draft revision'))
  checks.push(assert(!JSON.stringify(verdict).includes(body), 'verdict does not copy the full draft'))
  checks.push(assert(JSON.stringify(verdict).length < 24000, 'verdict remains compact'))

  const sameVerdict = service.buildEditorialVerdict({ appData: data, draftId: 'draft-1', createdAt: timestamp })
  checks.push(assert(JSON.stringify(sameVerdict) === JSON.stringify(verdict), 'same input produces a deterministic verdict'))
  const once = service.upsertEditorialVerdictToAppData(data, verdict)
  const twice = service.upsertEditorialVerdictToAppData(once, sameVerdict)
  checks.push(assert(twice.editorialVerdicts.length === 1, 'upsert is idempotent for the same draft revision'))
  checks.push(assert(service.getEditorialVerdictForDraft(twice, 'draft-1')?.id === verdict.id, 'current verdict lookup requires matching hash and revision'))

  const stateVerdict = service.buildEditorialVerdict({
    appData: makeData(defaults.normalizeAppData, hash, { consistencyReviewReports: [{ id: 'consistency-pass', projectId: 'project-1', jobId: 'job-1', chapterId: 'chapter-1', draftId: 'draft-1', draftContentHash: hash, issues: [], suggestions: '', severitySummary: 'low', createdAt: timestamp }] }),
    draftId: 'draft-1', createdAt: timestamp,
    stateIssues: [{ id: 'state-current', draftId: 'draft-1', draftContentHash: hash, draftRevision: timestamp, type: 'injury_reset', severity: 'high', description: '伤势无解释消失', evidence: '重新挥剑', suggestedFix: '保留伤势限制' }]
  })
  checks.push(assert(stateVerdict.blockers.some((item) => item.source === 'character_state'), 'bound high-risk state issue becomes a blocker'))
  checks.push(assert(stateVerdict.sourceRefs.characterStateIssueIds.includes('state-current'), 'state issue source id is traceable'))

  const approvedData = makeData(defaults.normalizeAppData, hash, {
    consistencyReviewReports: [{ id: 'consistency-pass', projectId: 'project-1', jobId: 'job-1', chapterId: 'chapter-1', draftId: 'draft-1', draftContentHash: hash, issues: [], suggestions: '', severitySummary: 'low', createdAt: timestamp }],
    redundancyReports: [],
    generationRunTraces: []
  })
  const approved = service.buildEditorialVerdict({ appData: approvedData, draftId: 'draft-1', createdAt: timestamp })
  checks.push(assert(approved.status === 'approved' && approved.canAccept, 'clean current reports produce an approved verdict', approved))
  checks.push(assert(approved.actions[0]?.actionType === 'accept_draft', 'approved verdict recommends acceptance'))

  const changed = {
    ...data,
    generatedChapterDrafts: data.generatedChapterDrafts.map((draft) => draft.id === 'draft-1'
      ? { ...draft, body: `${draft.body}\n正文已修订。`, updatedAt: '2026-09-05T14:00:00.000Z' }
      : draft)
  }
  const changedVerdict = service.buildEditorialVerdict({ appData: changed, draftId: 'draft-1', createdAt: timestamp })
  checks.push(assert(changedVerdict.status === 'incomplete' && !changedVerdict.canAccept, 'changed prose invalidates old reports instead of reviving them', changedVerdict))
  checks.push(assert(!changedVerdict.sourceRefs.qualityGateReportId && !changedVerdict.sourceRefs.consistencyReviewReportId, 'stale reports are absent from current source refs'))
  checks.push(assert(changedVerdict.actions[0]?.actionType === 'rerun_diagnostics', 'incomplete verdict recommends rerunning diagnostics first'))

  const normalizedLegacy = defaults.normalizeAppData({ schemaVersion: 3 })
  checks.push(assert(Array.isArray(normalizedLegacy.editorialVerdicts) && normalizedLegacy.editorialVerdicts.length === 0, 'legacy AppData receives an empty verdict collection'))
  const source = await readFile(join(root, 'src/services/EditorialVerdictService.ts'), 'utf8')
  checks.push(assert(!/AIService|AIClient|chatCompletion|generateText/.test(source), 'editorial verdict does not call an LLM'))

  const failed = checks.filter((check) => !check.ok)
  for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.message}`)
  if (failed.length) {
    console.error(JSON.stringify(failed, null, 2))
    process.exit(1)
  }
  console.log(`Editorial verdict validation passed: ${checks.length} checks.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

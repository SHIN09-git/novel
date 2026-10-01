import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function loadModule(relativePath) {
  const result = await build({
    entryPoints: [join(repoRoot, relativePath)], bundle: true, write: false,
    format: 'esm', platform: 'node', target: 'node20', logLevel: 'silent'
  })
  const source = result.outputFiles[0]?.text
  if (!source) throw new Error(`Unable to bundle ${relativePath}`)
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

const [{ deriveConsistencyReviewFromQualityGate }, consistencySource, qualitySource, verdictSource] = await Promise.all([
  loadModule('src/services/CombinedSemanticReviewService.ts'),
  readFile(join(repoRoot, 'src/renderer/src/views/generation/pipelineSteps/consistencyReview.ts'), 'utf8'),
  readFile(join(repoRoot, 'src/renderer/src/views/generation/pipelineSteps/qualityCheck.ts'), 'utf8'),
  readFile(join(repoRoot, 'src/services/EditorialVerdictService.ts'), 'utf8')
])

const draft = {
  id: 'draft-1', projectId: 'project-1', chapterId: 'chapter-1', jobId: 'job-1',
  title: '测试章', body: '正文', summary: '', status: 'draft', tokenEstimate: 2,
  createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z'
}
const quality = {
  id: 'quality-1', projectId: 'project-1', jobId: 'job-1', chapterId: 'chapter-1', draftId: 'draft-1',
  draftContentHash: 'hash-1', promptContextSnapshotId: null, overallScore: 72, pass: true,
  dimensions: {
    plotCoherence: 72, characterConsistency: 72, characterStateConsistency: 72, foreshadowingControl: 72,
    chapterContinuity: 72, redundancyControl: 72, styleMatch: 72, pacing: 72, emotionalPayoff: 72,
    originality: 72, promptCompliance: 72, contextRelevanceCompliance: 72
  },
  issues: [
    { severity: 'high', type: 'unauthorized_new_rule', description: '出现未授权规则', evidence: '附加条款', suggestedFix: '删除规则' },
    { severity: 'medium', type: 'foreshadowing_treatment_violation', description: '伏笔提前说破', evidence: '角色直接解释', suggestedFix: '恢复暗示' },
    { severity: 'low', type: 'style_mismatch', description: '语气偏硬', evidence: '局部表达', suggestedFix: '润色' }
  ],
  requiredFixes: ['删除规则'], optionalSuggestions: ['润色'], createdAt: '2026-09-06T00:01:00.000Z'
}

const first = deriveConsistencyReviewFromQualityGate(quality, draft)
const second = deriveConsistencyReviewFromQualityGate(quality, draft)
assert(first.consistencyReviewReport.id === second.consistencyReviewReport.id, 'derived consistency report must be deterministic')
assert(first.consistencyReviewReport.issues.length === 2, 'only semantic consistency issues should enter the compatibility report')
assert(first.consistencyReviewReport.severitySummary === 'high', 'derived report must retain the strongest severity')
assert(first.consistencyReviewReport.draftId === draft.id, 'derived report must remain bound to the exact draft')
assert(first.qualityGateReport.issues[0].linkedConsistencyIssueId, 'mapped quality issues must link to the compatibility issue')
assert(!first.qualityGateReport.issues[2].linkedConsistencyIssueId, 'pure style advice must not masquerade as a consistency issue')

assert(consistencySource.includes("recipe.id === 'standard'"), 'standard mode must defer its separate consistency model call')
assert(consistencySource.includes('combined_semantic_review_deferred'), 'the deferred step must leave an explicit recoverable output')
assert(consistencySource.includes("await env.getAiService('reviewer')"), 'strict/custom modes must retain independent semantic review')
assert(qualitySource.includes('deriveConsistencyReviewFromQualityGate'), 'quality gate must emit the compatibility consistency report')
assert(qualitySource.includes('consistencyReviewReportId: combinedConsistencyReport?.id'), 'trace must link the combined report')
assert(verdictSource.includes('currentConsistencyIssues.has(item.linkedConsistencyIssueId)'), 'editorial verdict must not duplicate linked quality and consistency findings')

console.log('Combined semantic review validation passed.')

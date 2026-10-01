import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const service = read('src/services/AuthorDecisionPolicyService.ts')
const qualityGatePolicy = read('src/shared/qualityGatePolicy.ts')
const qualityGateService = read('src/services/QualityGateService.ts')
const draftAcceptance = read('src/renderer/src/views/generation/useDraftAcceptance.ts')
const memoryCandidates = read('src/renderer/src/views/generation/useMemoryCandidates.ts')
const revisionStudio = [
  read('src/renderer/src/views/RevisionStudioView.tsx'),
  read('src/renderer/src/views/revision/revisionVersionActions.ts')
].join('\n')
const riskBanner = read('src/renderer/src/components/pipeline/PipelineRiskBanner.tsx')
const topStatus = read('src/renderer/src/components/pipeline/PipelineTopStatusBar.tsx')
const diagnosticsPanel = read('src/renderer/src/components/pipeline/PipelineDiagnosticsPanel.tsx')
const agentDecision = read('src/agent/AgentDecisionService.ts')

assert(service.includes('export class AuthorDecisionPolicyService'), 'AuthorDecisionPolicyService centralizes author-facing decision policy')
assert(service.includes('assessQualityGate'), 'AuthorDecisionPolicyService exposes assessQualityGate')
assert(service.includes('draftAcceptancePrompt'), 'AuthorDecisionPolicyService owns draft acceptance prompt copy')
assert(service.includes('revisionAcceptancePrompt'), 'AuthorDecisionPolicyService owns revision acceptance prompt copy')
assert(service.includes('memoryCandidatePrompt'), 'AuthorDecisionPolicyService owns memory candidate confirmation copy')
assert(service.includes('QUALITY_GATE_PASS_SCORE') && service.includes('QUALITY_GATE_HUMAN_REVIEW_SCORE'), 'decision policy uses shared quality gate thresholds')
assert(service.includes('../shared/qualityGatePolicy'), 'decision policy imports lightweight shared quality gate policy')
assert(!service.includes("from './QualityGateService'") && !service.includes('QualityGateService.'), 'decision policy does not import heavy QualityGateService')
assert(qualityGatePolicy.includes('QUALITY_GATE_PASS_SCORE = 50'), 'shared quality gate policy keeps pass threshold at 50')
assert(qualityGatePolicy.includes('QUALITY_GATE_HUMAN_REVIEW_SCORE = 80'), 'shared quality gate policy keeps human review threshold at 80')
assert(qualityGatePolicy.includes('shouldQualityGateRequireHumanReview'), 'shared quality gate policy exposes human review predicate')
assert(qualityGatePolicy.includes('qualityGateHasRequiredFixes'), 'shared quality gate policy treats required fixes as blocking findings')
assert(qualityGatePolicy.includes('qualityGateEffectivelyPassed'), 'shared quality gate policy exposes legacy-safe effective pass semantics')
assert(qualityGateService.includes('qualityGateSatisfiesPassCriteria(report)'), 'new quality reports cannot raw-pass while required fixes remain')
assert(service.includes('qualityGateEffectivelyPassed(report)'), 'author decision blocks legacy pass reports that violate current pass criteria')

for (const [name, source] of [
  ['useDraftAcceptance', draftAcceptance],
  ['useMemoryCandidates', memoryCandidates],
  ['RevisionStudioView', revisionStudio],
  ['PipelineRiskBanner', riskBanner],
  ['PipelineTopStatusBar', topStatus]
]) {
  assert(source.includes('AuthorDecisionPolicyService'), `${name} uses AuthorDecisionPolicyService`)
}

assert(!draftAcceptance.includes('QUALITY_GATE_HUMAN_REVIEW_SCORE'), 'useDraftAcceptance no longer embeds human review threshold copy')
assert(!revisionStudio.includes('QUALITY_GATE_HUMAN_REVIEW_SCORE'), 'RevisionStudioView no longer embeds human review threshold copy')
assert(!riskBanner.includes('QUALITY_GATE_HUMAN_REVIEW_SCORE'), 'PipelineRiskBanner no longer embeds human review threshold copy')
assert(!topStatus.includes('QualityGateService'), 'PipelineTopStatusBar does not duplicate quality gate status logic')
assert(diagnosticsPanel.includes('AuthorDecisionPolicyService.assessQualityGate'), 'PipelineDiagnosticsPanel uses centralized decision semantics')
assert(!diagnosticsPanel.includes('qualityReport.pass'), 'PipelineDiagnosticsPanel does not render the legacy raw pass flag directly')
assert(agentDecision.includes('The quality report still lists'), 'Agent needs-review fallback surfaces legacy required fixes')

console.log('validate-author-decision-policy: ok')

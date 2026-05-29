import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const service = read('src/services/AuthorDecisionPolicyService.ts')
const qualityGatePolicy = read('src/shared/qualityGatePolicy.ts')
const draftAcceptance = read('src/renderer/src/views/generation/useDraftAcceptance.ts')
const memoryCandidates = read('src/renderer/src/views/generation/useMemoryCandidates.ts')
const revisionStudio = read('src/renderer/src/views/RevisionStudioView.tsx')
const riskBanner = read('src/renderer/src/components/pipeline/PipelineRiskBanner.tsx')
const topStatus = read('src/renderer/src/components/pipeline/PipelineTopStatusBar.tsx')

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

console.log('validate-author-decision-policy: ok')

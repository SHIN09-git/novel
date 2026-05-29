import type { QualityGateReport } from './types'

export const QUALITY_GATE_PASS_SCORE = 50
export const QUALITY_GATE_HUMAN_REVIEW_SCORE = 80
export const QUALITY_GATE_KEY_DIMENSION_REVIEW_SCORE = 70

export function qualityGateHasCriticalDimensionRisk(report: QualityGateReport): boolean {
  return (
    report.dimensions.characterConsistency < QUALITY_GATE_KEY_DIMENSION_REVIEW_SCORE ||
    report.dimensions.characterStateConsistency < QUALITY_GATE_KEY_DIMENSION_REVIEW_SCORE ||
    report.dimensions.foreshadowingControl < QUALITY_GATE_KEY_DIMENSION_REVIEW_SCORE ||
    report.dimensions.chapterContinuity < QUALITY_GATE_KEY_DIMENSION_REVIEW_SCORE ||
    report.dimensions.contextRelevanceCompliance < QUALITY_GATE_KEY_DIMENSION_REVIEW_SCORE ||
    report.issues.some((issue) => issue.severity === 'high')
  )
}

export function shouldQualityGateRequireHumanReview(report: QualityGateReport): boolean {
  return !report.pass || report.overallScore < QUALITY_GATE_HUMAN_REVIEW_SCORE || qualityGateHasCriticalDimensionRisk(report)
}

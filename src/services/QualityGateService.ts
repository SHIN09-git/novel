import type {
  AIResult,
  ChapterDraftResult,
  ChapterPlan,
  ChapterTask,
  Character,
  CharacterStateFact,
  ConsistencyReviewReport,
  AiCallTelemetry,
  GeneratedChapterDraft,
  ID,
  NoveltyAuditResult,
  PipelineContextSource,
  QualityGateReviewScope,
  QualityGateReport,
  RedundancyReport
} from '../shared/types'
import {
  QUALITY_GATE_HUMAN_REVIEW_SCORE,
  QUALITY_GATE_PASS_SCORE,
  qualityGateSatisfiesPassCriteria,
  shouldQualityGateRequireHumanReview
} from '../shared/qualityGatePolicy'
import { NoveltyDetector } from './NoveltyDetector'
import { draftContentHash } from './DraftDiagnosticBindingService'
import { activeConsistencyIssues, applyConsistencyFindings, applyLocalGuardrails, applyNoveltyAudit } from './qualityGate/evaluationMergers'
import {
  buildLocalQualityEvaluation,
  clampQualityScore,
  draftBody,
  type LocalQualityEvaluation
} from './qualityGate/localQualityRules'

export { QUALITY_GATE_HUMAN_REVIEW_SCORE, QUALITY_GATE_PASS_SCORE } from '../shared/qualityGatePolicy'
export type QualityGateEvaluation = LocalQualityEvaluation

interface QualityGateAI {
  generateQualityGateReport(
    chapterDraft: ChapterDraftResult | GeneratedChapterDraft,
    context: string,
    chapterPlan: ChapterPlan | null,
    reviewScope?: QualityGateReviewScope
  ): Promise<AIResult<QualityGateEvaluation>>
}

export interface EvaluateQualityGateOptions {
  projectId: ID
  jobId: ID
  chapterId: ID | null
  draftId: ID | null
  chapterDraft: ChapterDraftResult | GeneratedChapterDraft
  context: string
  chapterPlan: ChapterPlan | null
  consistencyReports?: ConsistencyReviewReport[]
  noveltyAuditResult?: NoveltyAuditResult | null
  redundancyReport?: RedundancyReport | null
  characterStateFacts?: CharacterStateFact[]
  characters?: Character[]
  promptContextSnapshotId?: ID | null
  contextSource?: PipelineContextSource
  targetChapterOrder?: number
  hasAuthoritativeChapterTask?: boolean
  chapterTask?: ChapterTask | null
  aiService?: QualityGateAI
}

function consistencyDiagnosticsContext(options: EvaluateQualityGateOptions): string {
  const issues = activeConsistencyIssues(options.consistencyReports)
  if (!issues.length) return options.context
  const diagnostics = issues.map((issue) => ({
    id: issue.id,
    type: issue.type,
    severity: issue.severity,
    title: issue.title,
    description: issue.description,
    evidence: issue.evidence,
    suggestedFix: issue.suggestedFix
  }))
  return `${options.context}\n\n## Consistency Review Diagnostics\n${JSON.stringify(diagnostics, null, 2)}`
}

export class QualityGateService {
  static async evaluateChapterDraft(options: EvaluateQualityGateOptions): Promise<QualityGateReport> {
    const reviewContext = consistencyDiagnosticsContext(options)
    const localEvaluation = buildLocalQualityEvaluation(
      options.chapterDraft,
      options.chapterPlan,
      reviewContext,
      options.characterStateFacts,
      options.characters ?? [],
      options.chapterTask,
      options.redundancyReport
    )
    let evaluation: QualityGateEvaluation | null = null
    let aiTelemetry: AiCallTelemetry | undefined
    if (options.aiService) {
      const result = await options.aiService.generateQualityGateReport(
        options.chapterDraft,
        reviewContext,
        options.chapterPlan,
        {
          targetChapterOrder: options.targetChapterOrder,
          hasAuthoritativeChapterTask: options.hasAuthoritativeChapterTask
        }
      )
      aiTelemetry = result.telemetry
      if (result.data) evaluation = result.data
    }
    evaluation = evaluation ? applyLocalGuardrails(evaluation, localEvaluation) : localEvaluation
    evaluation = applyConsistencyFindings(evaluation, options.consistencyReports)
    const noveltyAudit =
      options.noveltyAuditResult ??
      NoveltyDetector.audit({ generatedText: draftBody(options.chapterDraft), context: reviewContext, chapterPlan: options.chapterPlan })
    evaluation = applyNoveltyAudit(evaluation, noveltyAudit)
    if (options.contextSource === 'prompt_snapshot') {
      evaluation = {
        ...evaluation,
        optionalSuggestions: [
          ...new Set([
            ...evaluation.optionalSuggestions,
            '本次使用 Prompt 构建器手动上下文快照；若问题来自上下文遗漏，请回到 Prompt 构建器调整选择并保存新快照。'
          ])
        ]
      }
    }

    const report: QualityGateReport = {
      id: crypto.randomUUID(),
      projectId: options.projectId,
      jobId: options.jobId,
      chapterId: options.chapterId,
      draftId: options.draftId,
      draftContentHash: draftContentHash(draftBody(options.chapterDraft)),
      promptContextSnapshotId: options.promptContextSnapshotId ?? null,
      overallScore: clampQualityScore(evaluation.overallScore),
      pass: evaluation.pass,
      dimensions: {
        plotCoherence: clampQualityScore(evaluation.dimensions.plotCoherence),
        characterConsistency: clampQualityScore(evaluation.dimensions.characterConsistency),
        characterStateConsistency: clampQualityScore(evaluation.dimensions.characterStateConsistency),
        foreshadowingControl: clampQualityScore(evaluation.dimensions.foreshadowingControl),
        chapterContinuity: clampQualityScore(evaluation.dimensions.chapterContinuity),
        redundancyControl: clampQualityScore(evaluation.dimensions.redundancyControl),
        styleMatch: clampQualityScore(evaluation.dimensions.styleMatch),
        pacing: clampQualityScore(evaluation.dimensions.pacing),
        emotionalPayoff: clampQualityScore(evaluation.dimensions.emotionalPayoff),
        originality: clampQualityScore(evaluation.dimensions.originality),
        promptCompliance: clampQualityScore(evaluation.dimensions.promptCompliance),
        contextRelevanceCompliance: clampQualityScore(evaluation.dimensions.contextRelevanceCompliance)
      },
      issues: evaluation.issues,
      requiredFixes: [...new Set(evaluation.requiredFixes)],
      optionalSuggestions: [...new Set(evaluation.optionalSuggestions)],
      aiTelemetry,
      createdAt: new Date().toISOString()
    }
    report.pass = qualityGateSatisfiesPassCriteria(report)
    return report
  }

  static shouldRequireHumanReview(report: QualityGateReport): boolean {
    return shouldQualityGateRequireHumanReview(report)
  }

  static generateRevisionInstructions(report: QualityGateReport): string[] {
    return [...new Set([...report.requiredFixes, ...report.issues.map((issue) => `${issue.type}: ${issue.suggestedFix}`)].filter(Boolean))]
  }
}

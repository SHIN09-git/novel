import type {
  AIResult,
  ChapterDraftResult,
  ChapterPlan,
  ConsistencySeverity,
  GeneratedChapterDraft,
  ID,
  QualityGateDimensionScores,
  QualityGateIssue,
  QualityGateReport
} from '../shared/types'
import { TokenEstimator } from './TokenEstimator'

export type QualityGateEvaluation = Pick<
  QualityGateReport,
  'overallScore' | 'pass' | 'dimensions' | 'issues' | 'requiredFixes' | 'optionalSuggestions'
>

interface QualityGateAI {
  generateQualityGateReport(
    chapterDraft: ChapterDraftResult | GeneratedChapterDraft,
    context: string,
    chapterPlan: ChapterPlan | null
  ): Promise<AIResult<QualityGateEvaluation>>
}

interface EvaluateOptions {
  projectId: ID
  jobId: ID
  chapterId: ID | null
  draftId: ID | null
  chapterDraft: ChapterDraftResult | GeneratedChapterDraft
  context: string
  chapterPlan: ChapterPlan | null
  aiService?: QualityGateAI
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 70
  return Math.max(0, Math.min(100, Math.round(value)))
}

function average(dimensions: QualityGateDimensionScores): number {
  const values = Object.values(dimensions)
  return clampScore(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function bodyOf(chapterDraft: ChapterDraftResult | GeneratedChapterDraft): string {
  return 'body' in chapterDraft ? chapterDraft.body : ''
}

function titleOf(chapterDraft: ChapterDraftResult | GeneratedChapterDraft): string {
  return 'title' in chapterDraft ? chapterDraft.title : ''
}

function fallbackEvaluation(chapterDraft: ChapterDraftResult | GeneratedChapterDraft, chapterPlan: ChapterPlan | null): QualityGateEvaluation {
  const body = bodyOf(chapterDraft)
  const tokenCount = TokenEstimator.estimate(body)
  const issues: QualityGateIssue[] = []
  const planText = [chapterPlan?.chapterGoal, chapterPlan?.conflictToPush, chapterPlan?.endingHook].filter(Boolean).join('\n')

  if (tokenCount < 500) {
    issues.push({
      severity: 'high',
      type: 'length',
      description: '章节正文明显偏短，可能只是模板或未完成草稿。',
      evidence: `估算正文 token：${tokenCount}`,
      suggestedFix: '补足场景推进、角色行动、冲突升级和结尾钩子后再进入记忆更新。'
    })
  }

  if (chapterPlan && planText && !body.includes(chapterPlan.conflictToPush.slice(0, 8))) {
    issues.push({
      severity: 'medium',
      type: 'promptCompliance',
      description: '本地规则无法确认正文是否推进了任务书中的核心冲突。',
      evidence: chapterPlan.conflictToPush || chapterPlan.chapterGoal,
      suggestedFix: '人工核对正文是否明确推进本章冲突，必要时要求 AI 局部重写冲突段落。'
    })
  }

  if (/本地草稿模板|API Key|请根据/.test(body)) {
    issues.push({
      severity: 'high',
      type: 'placeholder',
      description: '正文仍包含模板或配置提示，不能作为正式章节。',
      evidence: '检测到模板提示文本。',
      suggestedFix: '配置 API 后重新生成，或手动替换为真实章节正文。'
    })
  }

  const dimensions: QualityGateDimensionScores = {
    plotCoherence: tokenCount < 500 ? 50 : 76,
    characterConsistency: 75,
    foreshadowingControl: 75,
    styleMatch: titleOf(chapterDraft) ? 74 : 68,
    pacing: tokenCount < 500 ? 45 : 72,
    emotionalPayoff: 70,
    originality: /突然|命运|无法回头/.test(body) ? 68 : 73,
    promptCompliance: issues.some((issue) => issue.type === 'promptCompliance') ? 65 : 76
  }
  const overallScore = average(dimensions)
  return {
    overallScore,
    pass: overallScore >= 75 && !issues.some((issue) => issue.severity === 'high'),
    dimensions,
    issues,
    requiredFixes: issues.filter((issue) => issue.severity === 'high').map((issue) => issue.suggestedFix),
    optionalSuggestions: issues.filter((issue) => issue.severity !== 'high').map((issue) => issue.suggestedFix)
  }
}

export class QualityGateService {
  static async evaluateChapterDraft(options: EvaluateOptions): Promise<QualityGateReport> {
    let evaluation: QualityGateEvaluation | null = null

    if (options.aiService) {
      const result = await options.aiService.generateQualityGateReport(options.chapterDraft, options.context, options.chapterPlan)
      if (result.data) evaluation = result.data
    }

    if (!evaluation) {
      evaluation = fallbackEvaluation(options.chapterDraft, options.chapterPlan)
    }

    const report: QualityGateReport = {
      id: crypto.randomUUID(),
      projectId: options.projectId,
      jobId: options.jobId,
      chapterId: options.chapterId,
      draftId: options.draftId,
      overallScore: clampScore(evaluation.overallScore),
      pass: evaluation.pass,
      dimensions: {
        plotCoherence: clampScore(evaluation.dimensions.plotCoherence),
        characterConsistency: clampScore(evaluation.dimensions.characterConsistency),
        foreshadowingControl: clampScore(evaluation.dimensions.foreshadowingControl),
        styleMatch: clampScore(evaluation.dimensions.styleMatch),
        pacing: clampScore(evaluation.dimensions.pacing),
        emotionalPayoff: clampScore(evaluation.dimensions.emotionalPayoff),
        originality: clampScore(evaluation.dimensions.originality),
        promptCompliance: clampScore(evaluation.dimensions.promptCompliance)
      },
      issues: evaluation.issues,
      requiredFixes: evaluation.requiredFixes,
      optionalSuggestions: evaluation.optionalSuggestions,
      createdAt: new Date().toISOString()
    }
    report.pass = report.pass && !this.shouldRequireHumanReview(report)
    return report
  }

  static shouldRequireHumanReview(report: QualityGateReport): boolean {
    return (
      report.overallScore < 75 ||
      report.dimensions.characterConsistency < 70 ||
      report.dimensions.foreshadowingControl < 70 ||
      report.issues.some((issue) => issue.severity === 'high')
    )
  }

  static generateRevisionInstructions(report: QualityGateReport): string[] {
    const issueInstructions = report.issues.map((issue) => `${issue.type}: ${issue.suggestedFix}`)
    return [...report.requiredFixes, ...issueInstructions].filter(Boolean)
  }
}

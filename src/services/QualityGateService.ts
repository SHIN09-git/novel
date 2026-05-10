import type {
  AIResult,
  ChapterDraftResult,
  ChapterPlan,
  ConsistencySeverity,
  ConsistencyReviewIssue,
  ConsistencyReviewReport,
  GeneratedChapterDraft,
  ID,
  NoveltyAuditResult,
  PipelineContextSource,
  QualityGateDimensionScores,
  QualityGateIssue,
  QualityGateReport
} from '../shared/types'
import { TokenEstimator } from './TokenEstimator'
import { analyzeRedundancy } from './RedundancyService'
import { NoveltyDetector } from './NoveltyDetector'

export type QualityGateEvaluation = Pick<
  QualityGateReport,
  'overallScore' | 'pass' | 'dimensions' | 'issues' | 'requiredFixes' | 'optionalSuggestions'
>

export const QUALITY_GATE_PASS_SCORE = 50
export const QUALITY_GATE_HUMAN_REVIEW_SCORE = 80

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
  consistencyReports?: ConsistencyReviewReport[]
  promptContextSnapshotId?: ID | null
  contextSource?: PipelineContextSource
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

function treatmentViolationsFromContext(body: string, context: string): QualityGateIssue[] {
  const issues: QualityGateIssue[] = []
  const blocks = context.match(/### 【[\s\S]*?(?=\n### 【|\n## |\n# |$)/g) ?? []
  for (const block of blocks) {
    const title = block.match(/^### 【(.+?)】/m)?.[1]?.trim()
    const mode = block.match(/当前处理方式：(.+)/)?.[1]?.trim()
    if (!title || !mode || !body.includes(title)) continue
    if (mode === '隐藏') {
      issues.push({
        severity: 'high',
        type: 'foreshadowing_treatment_violation',
        description: '草稿明显提及了本章应隐藏的伏笔。',
        evidence: title,
        suggestedFix: '删除该伏笔在本章的直接提及，除非作者明确手动要求。'
      })
    }
    if (mode === '暂停') {
      issues.push({
        severity: 'medium',
        type: 'foreshadowing_treatment_violation',
        description: '草稿提及了本章应暂停的伏笔，需要确认是否越权推进。',
        evidence: title,
        suggestedFix: '检查该段是否推进、解释或回收了暂停伏笔；必要时改为不出现。'
      })
    }
    if (mode === '暗示' && /真相|原来|解释|揭示|回收|说明/.test(body)) {
      issues.push({
        severity: 'high',
        type: 'foreshadowing_treatment_violation',
        description: '草稿可能把只允许暗示的伏笔写成了解释或回收。',
        evidence: title,
        suggestedFix: '把该伏笔改回轻微信号，不让角色直接说破，也不解释来源。'
      })
    }
  }
  return issues
}

function stateLedgerViolationsFromContext(body: string, context: string): QualityGateIssue[] {
  const issues: QualityGateIssue[] = []
  const cashMatch = context.match(/现金余额[：:]\s*([0-9]+(?:\.[0-9]+)?)/)
  const cash = cashMatch ? Number(cashMatch[1]) : Number.NaN
  if (Number.isFinite(cash)) {
    for (const match of body.matchAll(/(花费|支付|买下|购买|付了|花了)\s*([0-9]+(?:\.[0-9]+)?)/g)) {
      const amount = Number(match[2])
      if (Number.isFinite(amount) && amount > cash && !/收入|借|赊|偷|抢|预支/.test(body.slice(Math.max(0, match.index - 80), (match.index ?? 0) + 120))) {
        issues.push({
          severity: 'high',
          type: 'resource_underflow',
          description: '正文出现超过角色状态账本余额的支出，且没有交代资金来源。',
          evidence: match[0],
          suggestedFix: '补充收入、借款、赊账或偷取等来源，或把支出改到当前余额以内。'
        })
      }
    }
  }

  const inventoryMatch = context.match(/持有物品[：:]\s*([^\n。]+)/)
  const inventory = inventoryMatch?.[1]?.split(/[、,，\s]+/).map((item) => item.trim()).filter(Boolean) ?? []
  if (inventory.length) {
    for (const match of body.matchAll(/使用了?([^，。、“”\s]{2,12}(钥匙|地图|剑|枪|药|戒指|令牌|笔记|书))/g)) {
      const item = match[1]
      if (!inventory.some((owned) => item.includes(owned) || owned.includes(item))) {
        issues.push({
          severity: 'high',
          type: 'missing_inventory',
          description: '正文使用了角色状态账本未记录持有的物品。',
          evidence: item,
          suggestedFix: '先在正文交代获得该物品，或改用账本中已有物品。'
        })
      }
    }
  }

  if (/伤势|身体状态|右臂|骨裂|受伤/.test(context) && /痊愈|完全恢复|毫无伤痛|行动自如/.test(body) && !/治疗|休养|药|包扎|解释/.test(body)) {
    issues.push({
      severity: 'high',
      type: 'injury_reset',
      description: '角色伤势可能被无解释重置。',
      evidence: body.slice(0, 160),
      suggestedFix: '保留伤势影响，或补充明确治疗/休养/代价说明。'
    })
  }

  if (/能力限制|冷却|代价|过度使用/.test(context) && /无限|毫无限制|连续使用|反复发动/.test(body) && !/代价|冷却|消耗|痛/.test(body)) {
    issues.push({
      severity: 'medium',
      type: 'ability_overuse',
      description: '角色能力限制可能被忽略。',
      evidence: body.slice(0, 160),
      suggestedFix: '恢复能力代价、冷却或失败风险，避免无成本连续使用。'
    })
  }

  return issues
}

function fallbackEvaluation(
  chapterDraft: ChapterDraftResult | GeneratedChapterDraft,
  chapterPlan: ChapterPlan | null,
  context = ''
): QualityGateEvaluation {
  const body = bodyOf(chapterDraft)
  const tokenCount = TokenEstimator.estimate(body)
  const issues: QualityGateIssue[] = [...treatmentViolationsFromContext(body, context), ...stateLedgerViolationsFromContext(body, context)]
  const redundancy = analyzeRedundancy({ projectId: 'quality-gate', chapterId: null, draftId: null, body })
  const startsWithReset = /^(与此同时|不知过了多久|几天后|另一边|清晨|夜色|城市|世界|传说|在这座)/.test(body.trim())
  const hasContinuityContext = /上一章结尾衔接|Chapter Continuity Bridge|openingContinuationBeat|mustContinueFrom/.test(context)
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

  if (hasContinuityContext && startsWithReset) {
    issues.push({
      severity: 'high',
      type: 'chapter_continuity_break',
      description: '正文开头疑似重新开场，没有直接承接上一章结尾状态。',
      evidence: body.trim().slice(0, 120),
      suggestedFix: '进入修订工作台执行“加强章节衔接”，让第一场戏从上一章结尾后的数秒到数分钟内开始。'
    })
  }

  if (redundancy.overallRedundancyScore >= 45) {
    issues.push({
      severity: redundancy.overallRedundancyScore >= 70 ? 'medium' : 'low',
      type: 'redundancy_control',
      description: '正文存在重复词组、重复解释或可压缩描写。',
      evidence: [...redundancy.repeatedPhrases, ...redundancy.overusedIntensifiers].slice(0, 5).join('；'),
      suggestedFix: '进入修订工作台执行“减少冗余”或“压缩描写”，删除重复解释和抽象强化词。'
    })
  }

  const dimensions: QualityGateDimensionScores = {
    plotCoherence: tokenCount < 500 ? 50 : 76,
    characterConsistency: 75,
    characterStateConsistency: issues.some((issue) =>
      ['resource_underflow', 'missing_inventory', 'injury_reset', 'knowledge_leak', 'ability_overuse', 'location_jump', 'promise_ignored', 'state_conflict'].includes(issue.type)
    )
      ? 58
      : 75,
    foreshadowingControl: issues.some((issue) => issue.type === 'foreshadowing_treatment_violation') ? 62 : 75,
    chapterContinuity: issues.some((issue) => issue.type === 'chapter_continuity_break') ? 58 : 76,
    redundancyControl: Math.max(35, 82 - redundancy.overallRedundancyScore),
    styleMatch: titleOf(chapterDraft) ? 74 : 68,
    pacing: tokenCount < 500 ? 45 : 72,
    emotionalPayoff: 70,
    originality: /突然|命运|无法回头/.test(body) ? 68 : 73,
    promptCompliance: issues.some((issue) => issue.type === 'promptCompliance') ? 65 : 76,
    contextRelevanceCompliance: context.includes('本章角色上下文切片') || context.includes('上下文需求计划') ? 76 : 70
  }
  const overallScore = average(dimensions)
  return {
    overallScore,
    pass: overallScore >= QUALITY_GATE_PASS_SCORE && !issues.some((issue) => issue.severity === 'high'),
    dimensions,
    issues,
    requiredFixes: issues.filter((issue) => issue.severity === 'high').map((issue) => issue.suggestedFix),
    optionalSuggestions: issues.filter((issue) => issue.severity !== 'high').map((issue) => issue.suggestedFix)
  }
}

function activeConsistencyIssues(reports: ConsistencyReviewReport[] = []): ConsistencyReviewIssue[] {
  return reports.flatMap((report) => report.issues).filter((issue) => issue.status !== 'ignored' && issue.status !== 'resolved')
}

function issueKind(issue: ConsistencyReviewIssue): 'character' | 'foreshadowing' | 'continuity' | 'setting' | 'other' {
  if (issue.type.includes('character')) return 'character'
  if (issue.type.includes('foreshadowing')) return 'foreshadowing'
  if (issue.type.includes('worldbuilding')) return 'setting'
  if (issue.type.includes('timeline') || issue.type.includes('continuity') || issue.type.includes('contradiction')) return 'continuity'
  return 'other'
}

function linkQualityIssuesToConsistency(
  qualityIssues: QualityGateIssue[],
  consistencyIssues: ConsistencyReviewIssue[]
): QualityGateIssue[] {
  return qualityIssues.map((issue) => {
    if (issue.linkedConsistencyIssueId) return issue
    const text = `${issue.type} ${issue.description} ${issue.evidence}`.toLowerCase()
    const linked = consistencyIssues.find((consistencyIssue) => {
      const evidence = consistencyIssue.evidence.toLowerCase()
      const title = consistencyIssue.title.toLowerCase()
      const sameKind =
        (issue.type.includes('character') && issueKind(consistencyIssue) === 'character') ||
        (issue.type.includes('foreshadow') && issueKind(consistencyIssue) === 'foreshadowing') ||
        (issue.type.includes('continuity') && issueKind(consistencyIssue) === 'continuity')
      return (evidence && text.includes(evidence.slice(0, 24))) || (title && text.includes(title.slice(0, 16))) || sameKind
    })
    return linked ? { ...issue, linkedConsistencyIssueId: linked.id } : issue
  })
}

function applyConsistencyFindings(
  evaluation: QualityGateEvaluation,
  consistencyReports: ConsistencyReviewReport[] = []
): QualityGateEvaluation {
  const consistencyIssues = activeConsistencyIssues(consistencyReports)
  if (!consistencyIssues.length) return evaluation

  const highIssues = consistencyIssues.filter((issue) => issue.severity === 'high')
  const linkedIssues = linkQualityIssuesToConsistency(evaluation.issues, consistencyIssues)
  const existingLinkedIds = new Set(linkedIssues.map((issue) => issue.linkedConsistencyIssueId).filter(Boolean))
  const synthesized = highIssues
    .filter((issue) => !existingLinkedIds.has(issue.id))
    .map<QualityGateIssue>((issue) => ({
      severity: issue.severity,
      type: 'consistency_review_blocker',
      description: `一致性审稿已发现高风险问题：${issue.title}`,
      evidence: issue.evidence,
      suggestedFix: issue.revisionInstruction || issue.suggestedFix,
      linkedConsistencyIssueId: issue.id
    }))

  const dimensions = { ...evaluation.dimensions }
  for (const issue of highIssues) {
    const kind = issueKind(issue)
    if (kind === 'character') dimensions.characterConsistency = Math.min(dimensions.characterConsistency, 62)
    if (kind === 'foreshadowing') dimensions.foreshadowingControl = Math.min(dimensions.foreshadowingControl, 62)
    if (kind === 'continuity' || kind === 'setting') {
      dimensions.plotCoherence = Math.min(dimensions.plotCoherence, 65)
      dimensions.chapterContinuity = Math.min(dimensions.chapterContinuity, 62)
      dimensions.promptCompliance = Math.min(dimensions.promptCompliance, 68)
    }
  }

  const issues = [...linkedIssues, ...synthesized]
  const requiredFixes = [
    ...evaluation.requiredFixes,
    ...highIssues.map((issue) => issue.revisionInstruction || issue.suggestedFix).filter(Boolean)
  ]
  const overallScore = Math.min(evaluation.overallScore, average(dimensions))
  return {
    ...evaluation,
    overallScore,
    pass: evaluation.pass && highIssues.length === 0 && overallScore >= QUALITY_GATE_PASS_SCORE,
    dimensions,
    issues,
    requiredFixes: [...new Set(requiredFixes)]
  }
}

function noveltyIssuesFromAudit(audit: NoveltyAuditResult): QualityGateIssue[] {
  const findings = [
    ...audit.newNamedCharacters,
    ...audit.newWorldRules,
    ...audit.newSystemMechanics,
    ...audit.newOrganizationsOrRanks,
    ...audit.majorLoreReveals,
    ...audit.suspiciousDeusExRules,
    ...audit.untracedNames
  ]
  const noveltySeverityToQualitySeverity = (severity: NoveltyAuditResult['newWorldRules'][number]['severity']): ConsistencySeverity => {
    if (severity === 'fail') return 'high'
    if (severity === 'warning') return 'medium'
    return 'low'
  }
  return findings
    .filter((finding) => finding.severity !== 'info' || !finding.allowedByTask)
    .map((finding) => ({
      severity: noveltySeverityToQualitySeverity(finding.severity),
      type:
        finding.kind === 'new_named_character' || finding.kind === 'untraced_name'
          ? 'unauthorized_new_character'
          : finding.kind === 'new_organization_or_rank'
            ? 'unauthorized_new_organization'
            : finding.kind === 'major_lore_reveal'
              ? 'unauthorized_lore_reveal'
              : finding.kind === 'deus_ex_rule' || finding.kind === 'suspicious_deus_ex_rule'
                ? 'deus_ex_rule_patch'
                : 'unauthorized_new_rule',
      description: finding.reason,
      evidence: finding.evidenceExcerpt || finding.text,
      suggestedFix: `${finding.suggestedAction}${finding.sourceHint ? ` Source: ${finding.sourceHint}.` : ''}`
    }))
}

function applyNoveltyAudit(evaluation: QualityGateEvaluation, audit: NoveltyAuditResult): QualityGateEvaluation {
  if (audit.severity === 'pass') return evaluation
  const issues = [...evaluation.issues, ...noveltyIssuesFromAudit(audit)]
  const dimensions = { ...evaluation.dimensions }
  if (audit.severity === 'fail') {
    dimensions.originality = Math.min(dimensions.originality, 55)
    dimensions.promptCompliance = Math.min(dimensions.promptCompliance, 58)
    dimensions.plotCoherence = Math.min(dimensions.plotCoherence, 62)
    dimensions.contextRelevanceCompliance = Math.min(dimensions.contextRelevanceCompliance, 65)
  } else {
    dimensions.originality = Math.min(dimensions.originality, 68)
    dimensions.promptCompliance = Math.min(dimensions.promptCompliance, 70)
  }
  const highFixes = issues.filter((issue) => issue.severity === 'high').map((issue) => issue.suggestedFix)
  const overallScore = Math.min(evaluation.overallScore, average(dimensions))
  return {
    ...evaluation,
    overallScore,
    pass:
      evaluation.pass &&
      audit.severity !== 'fail' &&
      !issues.some((issue) => issue.severity === 'high') &&
      overallScore >= QUALITY_GATE_PASS_SCORE,
    dimensions,
    issues,
    requiredFixes: [...new Set([...evaluation.requiredFixes, ...highFixes])],
    optionalSuggestions: [
      ...evaluation.optionalSuggestions,
      audit.summary,
      ...issues.filter((issue) => issue.severity !== 'high').map((issue) => issue.suggestedFix)
    ].filter(Boolean)
  }
}

export class QualityGateService {
  static async evaluateChapterDraft(options: EvaluateOptions): Promise<QualityGateReport> {
    let evaluation: QualityGateEvaluation | null = null
    const consistencyIssues = activeConsistencyIssues(options.consistencyReports)
    const consistencyContext = consistencyIssues.length
      ? `${options.context}\n\n## Consistency Review Diagnostics\n${JSON.stringify(
          consistencyIssues.map((issue) => ({
            id: issue.id,
            type: issue.type,
            severity: issue.severity,
            title: issue.title,
            description: issue.description,
            evidence: issue.evidence,
            suggestedFix: issue.suggestedFix
          })),
          null,
          2
        )}`
      : options.context

    if (options.aiService) {
      const result = await options.aiService.generateQualityGateReport(options.chapterDraft, consistencyContext, options.chapterPlan)
      if (result.data) evaluation = result.data
    }

    if (!evaluation) {
      evaluation = fallbackEvaluation(options.chapterDraft, options.chapterPlan, consistencyContext)
    }
    evaluation = applyConsistencyFindings(evaluation, options.consistencyReports)
    evaluation = applyNoveltyAudit(
      evaluation,
      NoveltyDetector.audit({
        generatedText: bodyOf(options.chapterDraft),
        context: consistencyContext,
        chapterPlan: options.chapterPlan
      })
    )
    if (options.contextSource === 'prompt_snapshot') {
      evaluation = {
        ...evaluation,
        optionalSuggestions: [
          ...evaluation.optionalSuggestions,
          '本次使用 Prompt 构建器手动上下文快照；若问题来自上下文遗漏，请回到 Prompt 构建器调整选择并保存新快照。'
        ]
      }
    }

    const report: QualityGateReport = {
      id: crypto.randomUUID(),
      projectId: options.projectId,
      jobId: options.jobId,
      chapterId: options.chapterId,
      draftId: options.draftId,
      promptContextSnapshotId: options.promptContextSnapshotId ?? null,
      overallScore: clampScore(evaluation.overallScore),
      pass: evaluation.pass,
      dimensions: {
        plotCoherence: clampScore(evaluation.dimensions.plotCoherence),
        characterConsistency: clampScore(evaluation.dimensions.characterConsistency),
        characterStateConsistency: clampScore(evaluation.dimensions.characterStateConsistency),
        foreshadowingControl: clampScore(evaluation.dimensions.foreshadowingControl),
        chapterContinuity: clampScore(evaluation.dimensions.chapterContinuity),
        redundancyControl: clampScore(evaluation.dimensions.redundancyControl),
        styleMatch: clampScore(evaluation.dimensions.styleMatch),
        pacing: clampScore(evaluation.dimensions.pacing),
        emotionalPayoff: clampScore(evaluation.dimensions.emotionalPayoff),
        originality: clampScore(evaluation.dimensions.originality),
        promptCompliance: clampScore(evaluation.dimensions.promptCompliance),
        contextRelevanceCompliance: clampScore(evaluation.dimensions.contextRelevanceCompliance)
      },
      issues: evaluation.issues,
      requiredFixes: evaluation.requiredFixes,
      optionalSuggestions: evaluation.optionalSuggestions,
      createdAt: new Date().toISOString()
    }
    report.pass =
      report.overallScore >= QUALITY_GATE_PASS_SCORE &&
      !report.issues.some((issue) => issue.severity === 'high')
    return report
  }

  static shouldRequireHumanReview(report: QualityGateReport): boolean {
    return (
      !report.pass ||
      report.overallScore < QUALITY_GATE_HUMAN_REVIEW_SCORE ||
      report.dimensions.characterConsistency < 70 ||
      report.dimensions.characterStateConsistency < 70 ||
      report.dimensions.foreshadowingControl < 70 ||
      report.dimensions.chapterContinuity < 70 ||
      report.dimensions.contextRelevanceCompliance < 70 ||
      report.issues.some((issue) => issue.severity === 'high')
    )
  }

  static generateRevisionInstructions(report: QualityGateReport): string[] {
    const issueInstructions = report.issues.map((issue) => `${issue.type}: ${issue.suggestedFix}`)
    return [...report.requiredFixes, ...issueInstructions].filter(Boolean)
  }
}

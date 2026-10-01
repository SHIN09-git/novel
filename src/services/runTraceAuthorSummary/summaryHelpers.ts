import type {
  ConsistencyReviewIssue,
  GenerationRunTrace,
  NoveltyAuditResult,
  NoveltyFinding,
  QualityGateIssue,
  RedundancyReport,
  RunTraceAuthorNextAction,
  RunTraceAuthorProblemSource,
  RunTraceAuthorSummaryStatus
} from '../../shared/types'

const MAX_EVIDENCE_LENGTH = 180

export function compactText(value: string | undefined | null, maxLength = MAX_EVIDENCE_LENGTH): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => compactText(item)).filter(Boolean)))
}

export function severityRank(severity: 'low' | 'medium' | 'high'): number {
  if (severity === 'high') return 3
  if (severity === 'medium') return 2
  return 1
}

export function upsertProblem(
  problems: RunTraceAuthorProblemSource[],
  problem: RunTraceAuthorProblemSource
): void {
  const existing = problems.find((item) => item.source === problem.source)
  if (!existing) {
    problems.push({ ...problem, evidence: uniqueStrings(problem.evidence).slice(0, 5) })
    return
  }
  existing.severity = severityRank(problem.severity) > severityRank(existing.severity) ? problem.severity : existing.severity
  existing.evidence = uniqueStrings([...existing.evidence, ...problem.evidence]).slice(0, 5)
  if (problem.recommendation && !existing.recommendation.includes(problem.recommendation)) {
    existing.recommendation = existing.recommendation
      ? `${existing.recommendation} ${problem.recommendation}`
      : problem.recommendation
  }
}

export function pushAction(actions: RunTraceAuthorNextAction[], action: RunTraceAuthorNextAction): void {
  if (actions.some((item) => item.actionType === action.actionType && item.label === action.label)) return
  actions.push(action)
}

export function qualityEvidence(issues: QualityGateIssue[]): string[] {
  return [...issues]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 3)
    .map((issue) => compactText([issue.type, issue.description || issue.evidence].filter(Boolean).join('：')))
}

export function consistencyEvidence(issues: ConsistencyReviewIssue[]): string[] {
  return [...issues]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 3)
    .map((issue) => compactText([issue.title || issue.type, issue.description || issue.evidence].filter(Boolean).join('：')))
}

export function allNoveltyFindings(audit: NoveltyAuditResult | null): NoveltyFinding[] {
  if (!audit) return []
  const findings = [
    ...audit.newNamedCharacters,
    ...audit.newWorldRules,
    ...audit.newSystemMechanics,
    ...audit.newOrganizationsOrRanks,
    ...audit.majorLoreReveals,
    ...audit.suspiciousDeusExRules,
    ...audit.untracedNames
  ]
  const seen = new Set<string>()
  return findings.filter((finding) => {
    const key = [finding.kind, compactText(finding.text), compactText(finding.evidenceExcerpt)].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function actionableNoveltyFindings(audit: NoveltyAuditResult | null): NoveltyFinding[] {
  return allNoveltyFindings(audit).filter(
    (finding) => finding.severity !== 'info' && (!finding.allowedByTask || finding.severity === 'fail')
  )
}

export function redundancyRisk(report: RedundancyReport | null): 'low' | 'medium' | 'high' | 'unknown' {
  if (!report) return 'unknown'
  if (report.overallRedundancyScore >= 70) return 'high'
  if (report.overallRedundancyScore >= 45) return 'medium'
  return 'low'
}

export function contextBudgetPressure(trace: GenerationRunTrace): 'low' | 'medium' | 'high' | 'unknown' {
  const estimate = trace.finalPromptTokenEstimate || trace.contextTokenEstimate
  if (!estimate) return trace.omittedContextItems.length > 8 ? 'medium' : 'unknown'
  const contextRatio = trace.contextTokenEstimate / Math.max(1, estimate)
  if (trace.omittedContextItems.length > 12 || contextRatio > 0.82) return 'high'
  if (trace.omittedContextItems.length > 4 || contextRatio > 0.65) return 'medium'
  return 'low'
}

export function statusFromProblems(
  problems: RunTraceAuthorProblemSource[],
  hasFailedStep: boolean
): RunTraceAuthorSummaryStatus {
  if (hasFailedStep) return 'failed'
  if (problems.some((item) => item.severity === 'high')) return 'risky'
  if (problems.length) return 'needs_attention'
  return 'good'
}

const PROBLEM_SOURCE_LABELS: Record<RunTraceAuthorProblemSource['source'], string> = {
  context_missing: '关键上下文缺失',
  context_noise: '上下文噪声或预算压力',
  task_contract: '本章任务契约',
  character_state: '角色状态连续性',
  foreshadowing: '伏笔使用',
  novelty_drift: '未授权新增设定',
  consistency: '前后文一致性',
  quality_gate: '质量门禁',
  redundancy: '重复与冗余',
  model_output: '模型输出或调用失败',
  revision_needed: '修订尚未完成',
  unknown: '尚未定位的环节'
}

export function oneLineForStatus(
  status: RunTraceAuthorSummaryStatus,
  problems: RunTraceAuthorProblemSource[]
): string {
  if (status === 'failed') return '生成流程中存在失败步骤，优先检查模型响应、API Key、Provider 或失败步骤输出。'
  if (status === 'risky') {
    const source = problems.find((item) => item.severity === 'high')?.source ?? 'unknown'
    return `这一章存在高风险问题，最可能来自${PROBLEM_SOURCE_LABELS[source]}，建议先修订再正式采纳。`
  }
  if (status === 'needs_attention') return '这一章生成链路有需要人工确认的风险点，建议先看摘要中的证据和下一步动作。'
  if (status === 'good') return '这一章生成链路未发现明显高风险问题，但仍建议人工阅读正文节奏和人物情绪。'
  return '诊断信息不足，建议查看质量门禁、审稿报告和原始 Run Trace。'
}

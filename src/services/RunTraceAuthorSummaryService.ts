import type {
  AppData,
  ConsistencyReviewIssue,
  ConsistencyReviewReport,
  GeneratedChapterDraft,
  GenerationRunTrace,
  ID,
  NoveltyAuditResult,
  QualityGateIssue,
  QualityGateReport,
  RedundancyReport,
  RunTraceAuthorActionType,
  RunTraceAuthorNextAction,
  RunTraceAuthorProblemSource,
  RunTraceAuthorSummary,
  RunTraceAuthorSummaryStatus
} from '../shared/types'

const SUMMARY_VERSION = 1
const MAX_EVIDENCE_LENGTH = 180

export interface BuildRunTraceAuthorSummaryParams {
  traceId?: ID
  jobId?: ID
  createdAt?: string
}

function compactText(value: string | undefined | null, maxLength = MAX_EVIDENCE_LENGTH): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => compactText(item)).filter(Boolean)))
}

function severityRank(severity: 'low' | 'medium' | 'high'): number {
  if (severity === 'high') return 3
  if (severity === 'medium') return 2
  return 1
}

function upsertProblem(
  problems: RunTraceAuthorProblemSource[],
  problem: RunTraceAuthorProblemSource
): void {
  const existing = problems.find((item) => item.source === problem.source)
  if (!existing) {
    problems.push({
      ...problem,
      evidence: uniqueStrings(problem.evidence).slice(0, 5)
    })
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

function pushAction(actions: RunTraceAuthorNextAction[], action: RunTraceAuthorNextAction): void {
  if (actions.some((item) => item.actionType === action.actionType && item.label === action.label)) return
  actions.push(action)
}

function findTrace(appData: AppData, params: BuildRunTraceAuthorSummaryParams): GenerationRunTrace {
  const trace =
    (params.traceId ? appData.generationRunTraces.find((item) => item.id === params.traceId) : null) ??
    (params.jobId ? appData.generationRunTraces.find((item) => item.jobId === params.jobId) : null)
  if (!trace) throw new Error('缺少生成追踪记录，无法构建作者诊断摘要。')
  return trace
}

function findDraft(appData: AppData, trace: GenerationRunTrace): GeneratedChapterDraft | null {
  if (trace.generatedDraftId) {
    const draft = appData.generatedChapterDrafts.find((item) => item.id === trace.generatedDraftId)
    if (draft) return draft
  }
  return appData.generatedChapterDrafts.find((item) => item.jobId === trace.jobId) ?? null
}

function findQualityReport(appData: AppData, trace: GenerationRunTrace, draft: GeneratedChapterDraft | null): QualityGateReport | null {
  if (trace.qualityGateReportId) {
    const report = appData.qualityGateReports.find((item) => item.id === trace.qualityGateReportId)
    if (report) return report
  }
  if (draft) {
    const report = appData.qualityGateReports.find((item) => item.draftId === draft.id)
    if (report) return report
  }
  return appData.qualityGateReports.find((item) => item.jobId === trace.jobId) ?? null
}

function findConsistencyReport(appData: AppData, trace: GenerationRunTrace): ConsistencyReviewReport | null {
  if (trace.consistencyReviewReportId) {
    const report = appData.consistencyReviewReports.find((item) => item.id === trace.consistencyReviewReportId)
    if (report) return report
  }
  return appData.consistencyReviewReports.find((item) => item.jobId === trace.jobId) ?? null
}

function findRedundancyReport(appData: AppData, trace: GenerationRunTrace, draft: GeneratedChapterDraft | null): RedundancyReport | null {
  if (trace.redundancyReportId) {
    const report = appData.redundancyReports.find((item) => item.id === trace.redundancyReportId)
    if (report) return report
  }
  if (draft) {
    const report = appData.redundancyReports.find((item) => item.draftId === draft.id)
    if (report) return report
  }
  return appData.redundancyReports.find((item) => item.jobId === trace.jobId) ?? null
}

function qualityEvidence(issues: QualityGateIssue[]): string[] {
  return issues.slice(0, 3).map((issue) => compactText([issue.type, issue.description || issue.evidence].filter(Boolean).join('：')))
}

function consistencyEvidence(issues: ConsistencyReviewIssue[]): string[] {
  return issues.slice(0, 3).map((issue) => compactText([issue.title || issue.type, issue.description || issue.evidence].filter(Boolean).join('：')))
}

function allNoveltyFindings(audit: NoveltyAuditResult | null) {
  if (!audit) return []
  return [
    ...audit.newNamedCharacters,
    ...audit.newWorldRules,
    ...audit.newSystemMechanics,
    ...audit.newOrganizationsOrRanks,
    ...audit.majorLoreReveals,
    ...audit.suspiciousDeusExRules,
    ...audit.untracedNames
  ]
}

function redundancyRisk(report: RedundancyReport | null): 'low' | 'medium' | 'high' | 'unknown' {
  if (!report) return 'unknown'
  if (report.overallRedundancyScore >= 70) return 'high'
  if (report.overallRedundancyScore >= 45) return 'medium'
  return 'low'
}

function contextBudgetPressure(trace: GenerationRunTrace): 'low' | 'medium' | 'high' | 'unknown' {
  const estimate = trace.finalPromptTokenEstimate || trace.contextTokenEstimate
  if (!estimate) return trace.omittedContextItems.length > 8 ? 'medium' : 'unknown'
  const contextRatio = trace.contextTokenEstimate / Math.max(1, estimate)
  if (trace.omittedContextItems.length > 12 || contextRatio > 0.82) return 'high'
  if (trace.omittedContextItems.length > 4 || contextRatio > 0.65) return 'medium'
  return 'low'
}

function statusFromProblems(problems: RunTraceAuthorProblemSource[], hasFailedStep: boolean): RunTraceAuthorSummaryStatus {
  if (hasFailedStep) return 'failed'
  if (problems.some((item) => item.severity === 'high')) return 'risky'
  if (problems.some((item) => item.severity === 'medium' || item.severity === 'low')) return 'needs_attention'
  return 'good'
}

function oneLineForStatus(status: RunTraceAuthorSummaryStatus, problems: RunTraceAuthorProblemSource[]): string {
  if (status === 'failed') return '生成流程中存在失败步骤，优先检查模型响应、API Key、Provider 或失败步骤输出。'
  if (status === 'risky') {
    const source = problems.find((item) => item.severity === 'high')?.source ?? 'unknown'
    return `这一章存在高风险问题，最可能来自 ${source}，建议先修订再正式采纳。`
  }
  if (status === 'needs_attention') return '这一章生成链路有需要人工确认的风险点，建议先看摘要中的证据和下一步动作。'
  if (status === 'good') return '这一章生成链路未发现明显高风险问题，但仍建议人工阅读正文节奏和人物情绪。'
  return '诊断信息不足，建议查看质量门禁、审稿报告和原始 Run Trace。'
}

export function buildRunTraceAuthorSummary(appData: AppData, params: BuildRunTraceAuthorSummaryParams): RunTraceAuthorSummary {
  const trace = findTrace(appData, params)
  const job = appData.chapterGenerationJobs.find((item) => item.id === trace.jobId) ?? null
  const draft = findDraft(appData, trace)
  const qualityReport = findQualityReport(appData, trace, draft)
  const consistencyReport = findConsistencyReport(appData, trace)
  const redundancyReport = findRedundancyReport(appData, trace, draft)
  const now = params.createdAt ?? new Date().toISOString()
  const problems: RunTraceAuthorProblemSource[] = []
  const nextActions: RunTraceAuthorNextAction[] = []
  const failedSteps = appData.chapterGenerationSteps.filter((step) => step.jobId === trace.jobId && step.status === 'failed')
  const hasFailedStep = Boolean(failedSteps.length || job?.status === 'failed')

  if (hasFailedStep) {
    upsertProblem(problems, {
      source: 'model_output',
      severity: 'high',
      evidence: failedSteps.map((step) => compactText(`${step.type}: ${step.errorMessage || step.output}`)).filter(Boolean),
      recommendation: '先重试失败步骤；如果继续失败，检查 provider、API Key、模型返回结构和错误摘要。'
    })
    pushAction(nextActions, {
      label: '重试失败步骤',
      actionType: 'rerun_generation',
      reason: '流水线未完整完成，后续诊断可能不完整。'
    })
  }

  if (qualityReport) {
    if (!qualityReport.pass) {
      upsertProblem(problems, {
        source: 'quality_gate',
        severity: 'high',
        evidence: [`质量门禁未通过，得分 ${qualityReport.overallScore}`, ...qualityEvidence(qualityReport.issues)],
        recommendation: '先进入修订工作台处理必修项，再考虑接受草稿。'
      })
      pushAction(nextActions, {
        label: '进入修订工作台',
        actionType: 'revise_chapter',
        reason: '质量门禁已经拦截，直接采纳可能把问题写入正式章节。'
      })
    } else if (qualityReport.issues.length) {
      upsertProblem(problems, {
        source: 'quality_gate',
        severity: 'medium',
        evidence: qualityEvidence(qualityReport.issues),
        recommendation: '质量门禁通过但仍有建议项，人工阅读时优先核对这些片段。'
      })
    }
  }

  if (consistencyReport) {
    const highIssues = consistencyReport.issues.filter((issue) => issue.severity === 'high')
    if (highIssues.length) {
      upsertProblem(problems, {
        source: 'consistency',
        severity: 'high',
        evidence: consistencyEvidence(highIssues),
        recommendation: '优先修复连续性审稿中的 high issue，再接受正文。'
      })
      pushAction(nextActions, {
        label: '处理一致性审稿问题',
        actionType: 'revise_chapter',
        reason: '高风险一致性问题通常会造成吃书或角色状态断裂。'
      })
    }

    const characterIssues = consistencyReport.issues.filter((issue) =>
      ['character_knowledge_leak', 'character_motivation_gap', 'character_ooc'].includes(issue.type)
    )
    if (characterIssues.length) {
      upsertProblem(problems, {
        source: 'character_state',
        severity: characterIssues.some((issue) => issue.severity === 'high') ? 'high' : 'medium',
        evidence: consistencyEvidence(characterIssues),
        recommendation: '核对角色状态账本和角色卡切片，必要时补录知识、伤势、位置或关系状态。'
      })
      pushAction(nextActions, {
        label: '补充角色状态',
        actionType: 'update_character_state',
        reason: '审稿发现的问题可能来自角色状态缺失或未被 prompt 使用。'
      })
    }

    const foreshadowingIssues = consistencyReport.issues.filter((issue) => issue.type.includes('foreshadowing'))
    if (foreshadowingIssues.length) {
      upsertProblem(problems, {
        source: 'foreshadowing',
        severity: foreshadowingIssues.some((issue) => issue.severity === 'high') ? 'high' : 'medium',
        evidence: consistencyEvidence(foreshadowingIssues),
        recommendation: '检查伏笔 treatmentMode，确认本章是否越权推进、提前解释或误回收。'
      })
      pushAction(nextActions, {
        label: '复核伏笔账本',
        actionType: 'review_foreshadowing',
        reason: '伏笔误用会污染长篇节奏和后续回收空间。'
      })
    }
  }

  const noveltyFindings = allNoveltyFindings(trace.noveltyAuditResult)
  if (trace.noveltyAuditResult && (trace.noveltyAuditResult.severity !== 'pass' || noveltyFindings.length)) {
    upsertProblem(problems, {
      source: 'novelty_drift',
      severity: trace.noveltyAuditResult.severity === 'fail' ? 'high' : 'medium',
      evidence: [trace.noveltyAuditResult.summary, ...noveltyFindings.slice(0, 4).map((finding) => compactText(`${finding.text}：${finding.reason || finding.evidenceExcerpt}`))],
      recommendation: '确认新角色、新机制或新规则是否被任务书允许；未授权内容建议删除或改写为已有线索的结果。'
    })
    pushAction(nextActions, {
      label: '确认新增设定风险',
      actionType: 'review_memory_candidate',
      reason: '不要让未授权新设定通过复盘候选进入长期记忆。'
    })
  }

  if (noveltyFindings.length && (!trace.includedHardCanonItemIds.length || trace.truncatedHardCanonItemIds.length)) {
    upsertProblem(problems, {
      source: 'novelty_drift',
      severity: trace.noveltyAuditResult?.severity === 'fail' ? 'high' : 'medium',
      evidence: [
        trace.includedHardCanonItemIds.length
          ? `HardCanonPack 已纳入 ${trace.includedHardCanonItemIds.length} 条，截断 ${trace.truncatedHardCanonItemIds.length} 条。`
          : '本次 prompt 没有纳入 HardCanonPack 硬设定。'
      ],
      recommendation: '如新增设定漂移反复出现，建议检查硬设定包是否缺失、过长或没有覆盖关键世界规则。'
    })
  }

  const redundancy = redundancyRisk(redundancyReport)
  if (redundancy === 'high' || redundancy === 'medium') {
    upsertProblem(problems, {
      source: 'redundancy',
      severity: redundancy === 'high' ? 'high' : 'medium',
      evidence: [
        redundancyReport ? `冗余得分 ${redundancyReport.overallRedundancyScore}` : '',
        ...(redundancyReport?.compressionSuggestions.slice(0, 3) ?? [])
      ],
      recommendation: '用修订工作台做压缩冗余或删除重复解释，优先保留动作、对话和情绪余波。'
    })
    pushAction(nextActions, {
      label: '压缩冗余描写',
      actionType: 'revise_chapter',
      reason: '冗余风险会让章节节奏拖慢并增加 AI 味。'
    })
  }

  const traceUnmetNeeds = trace.contextSelectionTrace?.unmetNeeds ?? []
  const traceDroppedBlocks = trace.contextSelectionTrace?.droppedBlocks ?? []
  const highPriorityUnmetNeeds = traceUnmetNeeds.filter((need) => need.priority === 'must' || need.priority === 'high')
  const contextTraceMissingHints = highPriorityUnmetNeeds.map((need) =>
    `${need.needType}${need.sourceId ? `:${need.sourceId}` : ''} - ${need.reason}`
  )
  const droppedHighPriorityHints = traceDroppedBlocks
    .filter((block) => block.priority === 'must' || block.priority === 'high')
    .map((block) => `${block.blockType}${block.sourceId ? `:${block.sourceId}` : ''} - ${block.dropReason}`)

  const missingHints = uniqueStrings([
    ...contextTraceMissingHints,
    ...droppedHighPriorityHints,
    ...trace.contextNeedPlanWarnings,
    ...trace.contextNeedPlanOmittedItems.map((item) => `${item.type}: ${item.reason}`),
    ...trace.contextWarnings.filter((warning) => /缺|missing|omitted|省略|未纳入/i.test(warning))
  ]).slice(0, 6)
  if (missingHints.length || (Object.keys(trace.requiredStateFactCategories).length > 0 && trace.includedCharacterStateFactIds.length === 0)) {
    upsertProblem(problems, {
      source: 'context_missing',
      severity: highPriorityUnmetNeeds.some((need) => need.priority === 'must') || droppedHighPriorityHints.length > 0 || trace.contextNeedPlanOmittedItems.length > 3 ? 'high' : 'medium',
      evidence: missingHints.length ? missingHints : ['上下文需求计划要求角色状态，但最终没有纳入角色状态事实。'],
      recommendation: '补充角色状态、伏笔或时间线记录，或在 Prompt 构建器中调整上下文选择。'
    })
    pushAction(nextActions, {
      label: '调整上下文',
      actionType: 'adjust_context',
      reason: '生成问题可能来自关键上下文没有进入正文 prompt。'
    })
  }

  const pressure = contextBudgetPressure(trace)
  const tracePressure = trace.contextSelectionTrace?.budgetSummary.pressure
  const stageSummaryTokenShare =
    trace.contextSelectionTrace?.budgetSummary.usedTokens
      ? trace.contextSelectionTrace.selectedBlocks
          .filter((block) => block.blockType === 'stageSummary')
          .reduce((sum, block) => sum + block.tokenEstimate, 0) / Math.max(1, trace.contextSelectionTrace.budgetSummary.usedTokens)
      : 0
  if (pressure === 'high' || tracePressure === 'high' || stageSummaryTokenShare > 0.28) {
    upsertProblem(problems, {
      source: 'context_noise',
      severity: 'medium',
      evidence: [`上下文预算压力高：上下文 ${trace.contextTokenEstimate} / 最终 ${trace.finalPromptTokenEstimate} token，省略 ${trace.omittedContextItems.length} 项。`],
      recommendation: '优先压缩远期摘要、减少低相关角色/伏笔，避免噪声挤掉本章硬状态。'
    })
  }

  if (trace.characterStateWarnings.length || trace.characterStateIssueIds.length) {
    upsertProblem(problems, {
      source: 'character_state',
      severity: trace.characterStateIssueIds.length ? 'high' : 'medium',
      evidence: [...trace.characterStateWarnings, trace.characterStateIssueIds.length ? `角色状态 issue：${trace.characterStateIssueIds.join(', ')}` : ''],
      recommendation: '检查角色状态事实是否已确认入账，并确认正文没有无解释恢复、瞬移或知识越界。'
    })
  }

  if (trace.acceptedRevisionVersionId) {
    pushAction(nextActions, {
      label: '复核已接受修订',
      actionType: 'ignore',
      reason: '本章已有接受的修订版本，确认修订确实覆盖主要风险即可。'
    })
  }
  if (!nextActions.length) {
    pushAction(nextActions, {
      label: '人工通读正文',
      actionType: 'ignore',
      reason: '自动诊断没有发现高风险，但作者仍应确认节奏、语气和情绪命中。'
    })
  }

  const overallStatus = statusFromProblems(problems, hasFailedStep)
  const consistencyPassed = consistencyReport ? !consistencyReport.issues.some((issue) => issue.severity === 'high') : undefined
  const mainDraftIssues = uniqueStrings([
    ...(qualityReport?.issues.slice(0, 3).map((issue) => issue.description || issue.evidence) ?? []),
    ...(consistencyReport?.issues.slice(0, 3).map((issue) => issue.description || issue.evidence) ?? [])
  ])

  const summary: RunTraceAuthorSummary = {
    id: `run-trace-author-summary-${trace.id}`,
    projectId: trace.projectId,
    chapterId: draft?.chapterId ?? qualityReport?.chapterId ?? consistencyReport?.chapterId ?? null,
    jobId: trace.jobId,
    traceId: trace.id,
    generatedDraftId: trace.generatedDraftId,
    createdAt: now,
    summaryVersion: SUMMARY_VERSION,
    overallStatus,
    oneLineDiagnosis: oneLineForStatus(overallStatus, problems),
    likelyProblemSources: problems.sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
    contextDiagnosis: {
      usedContextCount:
        trace.selectedChapterIds.length +
        trace.selectedStageSummaryIds.length +
        trace.selectedCharacterIds.length +
        trace.selectedForeshadowingIds.length +
        trace.selectedTimelineEventIds.length +
        trace.includedCharacterStateFactIds.length +
        trace.forcedContextBlocks.length,
      missingContextHints: missingHints,
      noisyContextHints: pressure === 'high' ? [`省略 ${trace.omittedContextItems.length} 项，上下文 token ${trace.contextTokenEstimate}`] : [],
      budgetPressure: tracePressure ?? pressure
    },
    continuityDiagnosis: {
      characterStateIssues: uniqueStrings([...trace.characterStateWarnings, ...trace.characterStateIssueIds]),
      foreshadowingIssues: consistencyReport
        ? consistencyReport.issues.filter((issue) => issue.type.includes('foreshadowing')).map((issue) => issue.title || issue.description)
        : [],
      timelineIssues: consistencyReport
        ? consistencyReport.issues.filter((issue) => issue.type === 'timeline_conflict').map((issue) => issue.title || issue.description)
        : [],
      newCanonRisks: trace.noveltyAuditResult ? noveltyFindings.map((finding) => `${finding.text}: ${finding.severity}`).slice(0, 6) : []
    },
    draftDiagnosis: {
      qualityGatePassed: qualityReport?.pass,
      consistencyPassed,
      redundancyRisk: redundancy,
      mainDraftIssues
    },
    nextActions,
    sourceRefs: {
      qualityGateReportId: qualityReport?.id,
      consistencyReviewReportId: consistencyReport?.id,
      redundancyReportIds: redundancyReport ? [redundancyReport.id] : [],
      noveltyAuditId: trace.noveltyAuditResult ? trace.id : undefined,
      generationRunTraceId: trace.id,
      contextNeedPlanId: trace.contextNeedPlanId ?? undefined
    }
  }

  validateRunTraceAuthorSummary(summary)
  return summary
}

export function validateRunTraceAuthorSummary(summary: RunTraceAuthorSummary): void {
  const errors: string[] = []
  if (!summary.id) errors.push('summary.id is required')
  if (!summary.projectId) errors.push('summary.projectId is required')
  if (!summary.createdAt) errors.push('summary.createdAt is required')
  if (!summary.summaryVersion) errors.push('summary.summaryVersion is required')
  if (!summary.oneLineDiagnosis.trim()) errors.push('summary.oneLineDiagnosis is required')
  if (!summary.sourceRefs.generationRunTraceId && !summary.traceId) errors.push('summary must reference a generation run trace')
  if (JSON.stringify(summary).length > 12000) errors.push('summary is too large; keep it as diagnosis, not prompt/body storage')
  if (errors.length) throw new Error(`RunTraceAuthorSummary 校验失败：${errors.join('；')}`)
}

export function upsertRunTraceAuthorSummaryToAppData(appData: AppData, summary: RunTraceAuthorSummary): AppData {
  validateRunTraceAuthorSummary(summary)
  const existingIndex = appData.runTraceAuthorSummaries.findIndex(
    (item) => item.id === summary.id || (summary.traceId && item.traceId === summary.traceId) || (summary.jobId && item.jobId === summary.jobId && item.traceId === summary.traceId)
  )
  const nextSummaries =
    existingIndex >= 0
      ? appData.runTraceAuthorSummaries.map((item, index) => (index === existingIndex ? summary : item))
      : [summary, ...appData.runTraceAuthorSummaries]
  return {
    ...appData,
    runTraceAuthorSummaries: nextSummaries
  }
}

export function getRunTraceAuthorSummaryForChapter(appData: AppData, chapterId: ID): RunTraceAuthorSummary | null {
  return (
    [...appData.runTraceAuthorSummaries]
      .filter((summary) => summary.chapterId === chapterId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  )
}

export function getRunTraceAuthorSummaryForJob(appData: AppData, jobId: ID): RunTraceAuthorSummary | null {
  return (
    [...appData.runTraceAuthorSummaries]
      .filter((summary) => summary.jobId === jobId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  )
}

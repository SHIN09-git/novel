import type {
  AppData,
  ID,
  RunTraceAuthorNextAction,
  RunTraceAuthorProblemSource,
  RunTraceAuthorSummary
} from '../shared/types'
import {
  actionableNoveltyFindings,
  compactText,
  consistencyEvidence,
  oneLineForStatus,
  pushAction,
  qualityEvidence,
  redundancyRisk,
  severityRank,
  statusFromProblems,
  uniqueStrings,
  upsertProblem
} from './runTraceAuthorSummary/summaryHelpers'
import { appendContextDiagnosis } from './runTraceAuthorSummary/contextDiagnosis'
import {
  findConsistencyReport,
  findDraft,
  findQualityReport,
  findRedundancyReport,
  findTrace
} from './runTraceAuthorSummary/sourceLookup'
import { noveltyAuditMatchesDraft } from './DraftDiagnosticBindingService'

const SUMMARY_VERSION = 1

export interface BuildRunTraceAuthorSummaryParams {
  traceId?: ID
  jobId?: ID
  createdAt?: string
}

export function buildRunTraceAuthorSummary(appData: AppData, params: BuildRunTraceAuthorSummaryParams): RunTraceAuthorSummary {
  const trace = findTrace(appData, params)
  const job = appData.chapterGenerationJobs.find((item) => item.id === trace.jobId) ?? null
  const draft = findDraft(appData, trace)
  const qualityReport = findQualityReport(appData, trace, draft)
  const consistencyReport = findConsistencyReport(appData, trace, draft)
  const redundancyReport = findRedundancyReport(appData, trace, draft)
  const noveltyAudit = draft
    ? noveltyAuditMatchesDraft(trace.noveltyAuditResult, draft)
      ? trace.noveltyAuditResult
      : null
    : trace.noveltyAuditResult
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

  const riskyNoveltyFindings = actionableNoveltyFindings(noveltyAudit)
  if (noveltyAudit && (noveltyAudit.severity !== 'pass' || riskyNoveltyFindings.length)) {
    upsertProblem(problems, {
      source: 'novelty_drift',
      severity: noveltyAudit.severity === 'fail' ? 'high' : 'medium',
      evidence: [noveltyAudit.summary, ...riskyNoveltyFindings.slice(0, 4).map((finding) => compactText(`${finding.text}：${finding.reason || finding.evidenceExcerpt}`))],
      recommendation: '确认新角色、新机制或新规则是否被任务书允许；未授权内容建议删除或改写为已有线索的结果。'
    })
    pushAction(nextActions, {
      label: '确认新增设定风险',
      actionType: 'review_memory_candidate',
      reason: '不要让未授权新设定通过复盘候选进入长期记忆。'
    })
  }

  if (riskyNoveltyFindings.length && (!trace.includedHardCanonItemIds.length || trace.truncatedHardCanonItemIds.length)) {
    upsertProblem(problems, {
      source: 'novelty_drift',
      severity: noveltyAudit?.severity === 'fail' ? 'high' : 'medium',
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

  const { missingHints, pressure, tracePressure } = appendContextDiagnosis(trace, problems, nextActions)

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
    generatedDraftId: draft?.id ?? trace.generatedDraftId,
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
      newCanonRisks: riskyNoveltyFindings.map((finding) => `${finding.text}: ${finding.severity}`).slice(0, 6)
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
      noveltyAuditId: noveltyAudit ? trace.id : undefined,
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

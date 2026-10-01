import type {
  ContextDecisionReasonCode,
  GenerationRunTrace,
  RunTraceAuthorNextAction,
  RunTraceAuthorProblemSource
} from '../../shared/types'
import {
  contextBudgetPressure,
  pushAction,
  uniqueStrings,
  upsertProblem
} from './summaryHelpers'

type ContextSelectionPressure = 'low' | 'medium' | 'high' | 'unknown'

function contextDecisionLabel(code: ContextDecisionReasonCode): string {
  const labels: Record<ContextDecisionReasonCode, string> = {
    required_need: '需求计划要求',
    manual_selection: '用户手动选择',
    task_relevance: '本章任务相关',
    recency: '近期事实',
    related_context: '关联上下文',
    profile_default: '预算配置默认',
    budget_exceeded: '预算不足',
    low_relevance: '相关性较低',
    compressed_replacement: '已被压缩内容替代',
    forbidden: '任务或规则禁止',
    manual_exclusion: '用户手动排除',
    prompt_limit: '数量上限',
    profile_filter: '预算配置过滤',
    status_ineligible: '状态不适用',
    snapshot_locked: 'Prompt 快照已固定',
    missing_source: '来源记录不存在',
    not_available: '没有可用内容',
    unknown: '旧记录未分类'
  }
  return labels[code]
}

export interface ContextDiagnosisBuildResult {
  missingHints: string[]
  pressure: ContextSelectionPressure
  tracePressure: ContextSelectionPressure | undefined
}

export function appendContextDiagnosis(
  trace: GenerationRunTrace,
  problems: RunTraceAuthorProblemSource[],
  nextActions: RunTraceAuthorNextAction[]
): ContextDiagnosisBuildResult {
  const traceUnmetNeeds = trace.contextSelectionTrace?.unmetNeeds ?? []
  const traceDroppedBlocks = trace.contextSelectionTrace?.droppedBlocks ?? []
  const highPriorityUnmetNeeds = traceUnmetNeeds.filter(
    (need) => !need.uncertain && (need.priority === 'must' || need.priority === 'high')
  )
  const contextTraceMissingHints = highPriorityUnmetNeeds.map((need) =>
    `${contextDecisionLabel(need.reasonCode)}：${need.needType}${need.sourceId ? `:${need.sourceId}` : ''} - ${need.reason}`
  )
  const droppedHighPriorityHints = traceDroppedBlocks
    .filter((block) => !block.uncertain && (block.priority === 'must' || block.priority === 'high'))
    .map(
      (block) =>
        `${contextDecisionLabel(block.reasonCode)}：${block.blockType}${block.sourceId ? `:${block.sourceId}` : ''} - ${block.dropReason}`
    )
  const confirmedPlanOmissions = trace.contextNeedPlanOmittedItems.filter(
    (item) => !item.uncertain && (item.priority === 'must' || item.priority === 'high')
  )
  const legacyNeedWarnings = trace.contextNeedPlanWarnings.filter((warning) => /缺|未找到|丢失|missing|not found/i.test(warning))
  const missingHints = uniqueStrings([
    ...contextTraceMissingHints,
    ...droppedHighPriorityHints,
    ...legacyNeedWarnings,
    ...confirmedPlanOmissions.map((item) => `${contextDecisionLabel(item.reasonCode)}：${item.type} - ${item.reason}`),
    ...trace.contextWarnings.filter((warning) => /缺|missing|omitted|省略|未纳入/i.test(warning))
  ]).slice(0, 6)
  const legacyMissingCharacterState =
    !trace.contextSelectionTrace &&
    Object.keys(trace.requiredStateFactCategories).length > 0 &&
    trace.includedCharacterStateFactIds.length === 0

  if (missingHints.length || legacyMissingCharacterState) {
    const structuredMissingCodes = [
      ...highPriorityUnmetNeeds.map((need) => need.reasonCode),
      ...traceDroppedBlocks
        .filter((block) => !block.uncertain && (block.priority === 'must' || block.priority === 'high'))
        .map((block) => block.reasonCode),
      ...confirmedPlanOmissions.map((item) => item.reasonCode)
    ]
    const deliberatelyFixed =
      structuredMissingCodes.length > 0 &&
      structuredMissingCodes.every((code) => code === 'manual_exclusion' || code === 'snapshot_locked')
    upsertProblem(problems, {
      source: 'context_missing',
      severity:
        !deliberatelyFixed &&
        (highPriorityUnmetNeeds.some((need) => need.priority === 'must') ||
          traceDroppedBlocks.some(
            (block) => !block.uncertain && block.priority === 'must' && block.reasonCode !== 'manual_exclusion'
          ) ||
          confirmedPlanOmissions.length > 3)
          ? 'high'
          : 'medium',
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
  const stageSummaryTokenShare = trace.contextSelectionTrace?.budgetSummary.usedTokens
    ? trace.contextSelectionTrace.selectedBlocks
        .filter((block) => block.blockType === 'stageSummary')
        .reduce((sum, block) => sum + block.tokenEstimate, 0) /
      Math.max(1, trace.contextSelectionTrace.budgetSummary.usedTokens)
    : 0
  if (pressure === 'high' || tracePressure === 'high' || stageSummaryTokenShare > 0.28) {
    upsertProblem(problems, {
      source: 'context_noise',
      severity: 'medium',
      evidence: [
        `上下文预算压力高：上下文 ${trace.contextTokenEstimate} / 最终 ${trace.finalPromptTokenEstimate} token，省略 ${trace.omittedContextItems.length} 项。`
      ],
      recommendation: '优先压缩远期摘要、减少低相关角色/伏笔，避免噪声挤掉本章硬状态。'
    })
  }

  return { missingHints, pressure, tracePressure }
}

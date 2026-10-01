import type {
  ContextDecisionReasonCode,
  ContextSelectionTraceBlock,
  ContextSelectionTraceDroppedBlock,
  GenerationRunTrace,
  ID,
  PromptBlockOrderItem,
  PromptContractReplay,
  PromptContractReplayBlock,
  PromptContractReplayIssue
} from '../shared/types'
import { TokenEstimator } from './TokenEstimator'

const LOWER_PRIORITY_BLOCK_KINDS = new Set([
  'chapter_task',
  'character_state',
  'foreshadowing_rules',
  'story_direction',
  'current_progress',
  'recent_chapters',
  'remote_summary',
  'timeline',
  'story_bible_reference',
  'style',
  'forbidden_and_novelty',
  'output_format',
  'prompt_snapshot'
])

const LOWER_PRIORITY_HEADING =
  /^##\s+(?:\d+\.\s*)?(?:本章任务契约|当前角色硬状态|本章伏笔操作规则|中期剧情导向|当前剧情状态|最近章节详细回顾|远期压缩摘要|时间线事件|最小硬设定|风格要求|禁止事项|输出格式要求)/m

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function sourceMatches(block: PromptBlockOrderItem, sourceId?: ID | null): boolean {
  return Boolean(sourceId && (block.sourceIds ?? []).includes(sourceId))
}

function kindMatches(promptKind: string, selectionKind: string): boolean {
  const left = promptKind.toLowerCase()
  const right = selectionKind.toLowerCase()
  if (left === right || left.includes(right) || right.includes(left)) return true
  if (left === 'character_state') return right.includes('character') || right.includes('state')
  if (left === 'foreshadowing_rules') return right.includes('foreshadowing')
  if (left === 'hard_canon') return right.includes('hard_canon') || right.includes('worldbuilding')
  if (left === 'recent_chapters' || left === 'current_progress') return right.includes('chapter')
  if (left === 'remote_summary') return right.includes('stage') || right.includes('summary')
  if (left === 'timeline') return right.includes('timeline')
  if (left === 'story_direction') return right.includes('story_direction')
  return false
}

function decisionReasonCodes(
  block: PromptBlockOrderItem,
  selectionBlocks: Array<ContextSelectionTraceBlock | ContextSelectionTraceDroppedBlock>
): ContextDecisionReasonCode[] {
  const sourceMatchesForBlock = selectionBlocks.filter((item) => sourceMatches(block, item.sourceId))
  const matches = sourceMatchesForBlock.length
    ? sourceMatchesForBlock
    : selectionBlocks.filter((item) => kindMatches(block.kind, item.blockType))
  return unique(matches.map((item) => item.reasonCode))
}

function replayBlock(
  block: PromptBlockOrderItem,
  position: number,
  finalTokens: number,
  selectionBlocks: Array<ContextSelectionTraceBlock | ContextSelectionTraceDroppedBlock>
): PromptContractReplayBlock {
  return {
    position,
    id: block.id,
    title: block.title,
    kind: block.kind,
    authorityPriority: block.priority,
    tokenEstimate: Math.max(0, block.tokenEstimate),
    tokenSharePercent: finalTokens > 0 ? Math.round((Math.max(0, block.tokenEstimate) / finalTokens) * 100) : 0,
    source: block.source,
    sourceIds: block.sourceIds ?? [],
    forced: Boolean(block.forced),
    compressed: Boolean(block.compressed),
    reason: block.reason,
    omittedReason: block.omittedReason ?? null,
    decisionReasonCodes: decisionReasonCodes(block, selectionBlocks)
  }
}

function addIssue(issues: PromptContractReplayIssue[], issue: PromptContractReplayIssue): void {
  if (issues.some((item) => item.code === issue.code && item.message === issue.message)) return
  issues.push(issue)
}

function forcedBlockIsTracked(trace: GenerationRunTrace, kind: string, sourceId?: ID | null): boolean {
  return trace.promptBlockOrder.some(
    (block) =>
      block.included &&
      block.forced &&
      (block.kind === kind || block.kind.includes(kind) || kind.includes(block.kind)) &&
      (!sourceId || !(block.sourceIds ?? []).length || (block.sourceIds ?? []).includes(sourceId))
  )
}

export function hasContinuityBridgeSection(finalPrompt: string): boolean {
  return /^##\s+(?:\d+\.\s*)?上一章结尾衔接(?:\s+Bridge)?\s*$/m.test(finalPrompt)
}

function insertSectionBeforeLowerPriority(finalPrompt: string, sectionText: string): string {
  const lowerHeading = LOWER_PRIORITY_HEADING.exec(finalPrompt)
  if (lowerHeading?.index !== undefined) {
    return `${finalPrompt.slice(0, lowerHeading.index).trimEnd()}\n\n${sectionText}\n\n${finalPrompt.slice(lowerHeading.index).trimStart()}`
  }

  const writingTask = /^##\s+(?:\d+\.\s*)?写作任务声明\s*$/m.exec(finalPrompt)
  if (writingTask?.index !== undefined) {
    const afterHeading = writingTask.index + writingTask[0].length
    const nextHeading = /^##\s+/m.exec(finalPrompt.slice(afterHeading))
    const insertAt = nextHeading?.index === undefined ? finalPrompt.length : afterHeading + nextHeading.index
    return `${finalPrompt.slice(0, insertAt).trimEnd()}\n\n${sectionText}\n\n${finalPrompt.slice(insertAt).trimStart()}`
  }

  const documentTitle = /^#(?!#)\s+.+$/m.exec(finalPrompt)
  if (documentTitle?.index === 0) {
    const lineEnd = finalPrompt.indexOf('\n', documentTitle[0].length)
    const insertAt = lineEnd < 0 ? finalPrompt.length : lineEnd + 1
    return `${finalPrompt.slice(0, insertAt).trimEnd()}\n\n${sectionText}\n\n${finalPrompt.slice(insertAt).trimStart()}`
  }
  return `${sectionText}\n\n${finalPrompt.trimStart()}`.trim()
}

function moveContinuitySectionBeforeLowerPriority(finalPrompt: string): string {
  const bridgeHeading = /^##\s+(?:\d+\.\s*)?上一章结尾衔接(?:\s+Bridge)?\s*$/m.exec(finalPrompt)
  const lowerHeading = LOWER_PRIORITY_HEADING.exec(finalPrompt)
  if (bridgeHeading?.index === undefined || lowerHeading?.index === undefined || bridgeHeading.index < lowerHeading.index) {
    return finalPrompt
  }

  const sectionStart = bridgeHeading.index
  const afterHeading = sectionStart + bridgeHeading[0].length
  const nextHeading = /^##\s+/m.exec(finalPrompt.slice(afterHeading))
  const sectionEnd = nextHeading?.index === undefined ? finalPrompt.length : afterHeading + nextHeading.index
  const sectionText = finalPrompt.slice(sectionStart, sectionEnd).trim()
  const withoutSection = `${finalPrompt.slice(0, sectionStart).trimEnd()}\n\n${finalPrompt.slice(sectionEnd).trimStart()}`.trim()
  return insertSectionBeforeLowerPriority(withoutSection, sectionText)
}

export function insertForcedPromptBlock(
  promptBlockOrder: PromptBlockOrderItem[],
  block: PromptBlockOrderItem
): PromptBlockOrderItem[] {
  const existing = promptBlockOrder.find((item) => item.included && item.kind === block.kind)
  const effectiveBlock = existing
    ? { ...existing, ...block, included: true, forced: true, omittedReason: null }
    : block
  const withoutBlock = promptBlockOrder.filter((item) => item !== existing)
  const lowerIndex = withoutBlock.findIndex((item) => LOWER_PRIORITY_BLOCK_KINDS.has(item.kind))
  if (lowerIndex >= 0) {
    return [...withoutBlock.slice(0, lowerIndex), effectiveBlock, ...withoutBlock.slice(lowerIndex)]
  }
  const writingTaskIndex = withoutBlock.findIndex((item) => item.kind === 'writing_task')
  const insertAt = writingTaskIndex >= 0 ? writingTaskIndex + 1 : withoutBlock.length
  return [...withoutBlock.slice(0, insertAt), effectiveBlock, ...withoutBlock.slice(insertAt)]
}

export interface EnsureContinuityBridgeInput {
  finalPrompt: string
  promptBlockOrder: PromptBlockOrderItem[]
  bridgeBody: string
  bridgeId: ID
  source: string
  reason: string
}

export function ensureContinuityBridgeInPrompt(input: EnsureContinuityBridgeInput): {
  finalPrompt: string
  promptBlockOrder: PromptBlockOrderItem[]
  inserted: boolean
} {
  const promptHasBridge = hasContinuityBridgeSection(input.finalPrompt)
  const orderHasBridge = input.promptBlockOrder.some((block) => block.included && block.kind === 'continuity_bridge')
  const sectionText = `## 2. 上一章结尾衔接 Bridge\n${input.bridgeBody.trim()}`
  const finalPrompt = promptHasBridge
    ? moveContinuitySectionBeforeLowerPriority(input.finalPrompt)
    : insertSectionBeforeLowerPriority(input.finalPrompt, sectionText)
  const promptBlockOrder = insertForcedPromptBlock(input.promptBlockOrder, {
        id: 'forced-continuity-bridge',
        title: '2. 上一章结尾衔接 Bridge',
        kind: 'continuity_bridge',
        priority: 2,
        tokenEstimate: TokenEstimator.estimate(sectionText),
        source: input.source,
        sourceIds: [input.bridgeId],
        included: true,
        compressed: false,
        forced: true,
        omittedReason: null,
        reason: input.reason
      })
  const originalBridgeIndex = input.promptBlockOrder.findIndex((block) => block.included && block.kind === 'continuity_bridge')
  const originalTaskIndex = input.promptBlockOrder.findIndex((block) => LOWER_PRIORITY_BLOCK_KINDS.has(block.kind))
  const moved = originalBridgeIndex >= 0 && originalTaskIndex >= 0 && originalBridgeIndex > originalTaskIndex
  return { finalPrompt, promptBlockOrder, inserted: !promptHasBridge || !orderHasBridge || moved }
}

export function buildPromptContractReplay(trace: GenerationRunTrace): PromptContractReplay {
  const finalTokens = Math.max(0, trace.finalPromptTokenEstimate)
  const includedOrder = trace.promptBlockOrder.filter((block) => block.included)
  const omittedOrder = trace.promptBlockOrder.filter((block) => !block.included)
  const selectedTraceBlocks = trace.contextSelectionTrace?.selectedBlocks ?? []
  const droppedTraceBlocks = trace.contextSelectionTrace?.droppedBlocks ?? []
  const includedBlocks = includedOrder.map((block, index) => replayBlock(block, index + 1, finalTokens, selectedTraceBlocks))
  const omittedBlocks = omittedOrder.map((block, index) => replayBlock(block, index + 1, finalTokens, droppedTraceBlocks))
  const accountedBlockTokenEstimate = includedBlocks.reduce((total, block) => total + block.tokenEstimate, 0)
  const tokenAccountingDelta = finalTokens - accountedBlockTokenEstimate
  const issues: PromptContractReplayIssue[] = []
  const opaqueSnapshot = includedBlocks.length === 1 && includedBlocks[0].kind === 'prompt_snapshot'

  if (!trace.promptBlockOrder.length) {
    addIssue(issues, {
      code: 'missing_block_order',
      severity: 'error',
      message: '本次运行没有结构化 Prompt 区块记录，无法回放模型实际看到的顺序。',
      evidence: []
    })
  } else if (opaqueSnapshot) {
    addIssue(issues, {
      code: 'opaque_snapshot',
      severity: 'warning',
      message: '该 Prompt 快照没有结构化标题，只能按冻结全文识别，无法逐块核对。',
      evidence: [includedBlocks[0].title]
    })
  }

  const bridgeIndex = includedBlocks.findIndex((block) => block.kind === 'continuity_bridge')
  const taskIndex = includedBlocks.findIndex((block) => block.kind === 'chapter_task')
  if (!opaqueSnapshot && trace.targetChapterOrder > 1 && bridgeIndex < 0) {
    addIssue(issues, {
      code: 'missing_continuity_bridge',
      severity: 'error',
      message: '目标章节缺少上一章结尾衔接区块。',
      evidence: [`目标章节：第 ${trace.targetChapterOrder} 章`]
    })
  }
  if (!opaqueSnapshot && taskIndex < 0) {
    addIssue(issues, {
      code: 'missing_chapter_task',
      severity: 'error',
      message: '最终 Prompt 缺少本章任务契约区块。',
      evidence: []
    })
  }
  if (bridgeIndex >= 0 && taskIndex >= 0 && bridgeIndex > taskIndex) {
    addIssue(issues, {
      code: 'forced_bridge_after_task',
      severity: 'error',
      message: '上一章 Bridge 位于本章任务之后，实际顺序违背章节承接优先级。',
      evidence: [`Bridge 位置 ${bridgeIndex + 1}，任务契约位置 ${taskIndex + 1}`]
    })
  }

  const duplicateIds = unique(
    trace.promptBlockOrder
      .map((block) => block.id)
      .filter((id, index, ids) => ids.indexOf(id) !== index)
  )
  if (duplicateIds.length) {
    addIssue(issues, {
      code: 'duplicate_block_id',
      severity: 'warning',
      message: 'Prompt 区块记录存在重复 ID，可能导致回放含义不清。',
      evidence: duplicateIds
    })
  }

  const untrackedForced = trace.forcedContextBlocks.filter(
    (block) => !forcedBlockIsTracked(trace, block.kind, block.sourceId)
  )
  if (untrackedForced.length) {
    addIssue(issues, {
      code: 'forced_context_untracked',
      severity: 'error',
      message: '存在已注入但未进入最终区块顺序的强制上下文。',
      evidence: untrackedForced.map((block) => block.title)
    })
  }

  const hasCompressedReplacement = trace.compressionRecords.some((record) => record.replacementKind !== 'dropped')
  if (hasCompressedReplacement && !includedBlocks.some((block) => block.compressed)) {
    addIssue(issues, {
      code: 'compression_untracked',
      severity: 'warning',
      message: '上下文发生了压缩替换，但最终 Prompt 区块没有标记压缩来源。',
      evidence: trace.compressionRecords.slice(0, 4).map((record) => `第 ${record.originalChapterOrder} 章 -> ${record.replacementKind}`)
    })
  }

  const confirmedUnmetNeeds = (trace.contextSelectionTrace?.unmetNeeds ?? []).filter(
    (need) =>
      !need.uncertain &&
      (need.priority === 'must' || need.priority === 'high') &&
      need.reasonCode !== 'manual_exclusion'
  )
  if (confirmedUnmetNeeds.length) {
    addIssue(issues, {
      code: 'confirmed_need_unmet',
      severity: 'warning',
      message: `有 ${confirmedUnmetNeeds.length} 项高优先级上下文需求没有进入最终 Prompt。`,
      evidence: confirmedUnmetNeeds.slice(0, 5).map((need) => need.reason)
    })
  }

  if (trace.truncatedHardCanonItemIds.length) {
    addIssue(issues, {
      code: 'hard_canon_truncated',
      severity: 'warning',
      message: 'HardCanonPack 有条目因预算被截断。',
      evidence: trace.truncatedHardCanonItemIds.slice(0, 6)
    })
  }
  if (trace.promptLintIssueCount > 0) {
    addIssue(issues, {
      code: 'prompt_lint_cleanup',
      severity: 'info',
      message: `运行时 Prompt Guard 清理了 ${trace.promptLintIssueCount} 个问题。`,
      evidence: trace.promptLintWarnings.slice(0, 5)
    })
  }

  const accountingTolerance = Math.max(96, Math.ceil(finalTokens * 0.12))
  if (Math.abs(tokenAccountingDelta) > accountingTolerance) {
    addIssue(issues, {
      code: 'token_accounting_gap',
      severity: 'warning',
      message: '区块 token 合计与最终 Prompt 估算存在较大差异。',
      evidence: [`区块合计 ${accountedBlockTokenEstimate}，最终估算 ${finalTokens}，差值 ${tokenAccountingDelta}`]
    })
  }

  const status = issues.some((issue) => issue.severity === 'error')
    ? 'incomplete'
    : issues.some((issue) => issue.severity === 'warning')
      ? 'needs_attention'
      : 'complete'
  const summary = status === 'complete'
    ? `模型实际收到 ${includedBlocks.length} 个结构化区块，约 ${finalTokens} token，未发现契约顺序异常。`
    : status === 'incomplete'
      ? `模型实际收到 ${includedBlocks.length} 个区块，但有 ${issues.filter((issue) => issue.severity === 'error').length} 个关键契约缺口。`
      : `模型实际收到 ${includedBlocks.length} 个区块，有 ${issues.filter((issue) => issue.severity === 'warning').length} 项需要关注。`

  return {
    traceId: trace.id,
    targetChapterOrder: trace.targetChapterOrder,
    contextSource: trace.contextSource,
    status,
    summary,
    finalPromptTokenEstimate: finalTokens,
    accountedBlockTokenEstimate,
    tokenAccountingDelta,
    includedBlocks,
    omittedBlocks,
    selectedContextCount: selectedTraceBlocks.length,
    droppedContextCount: droppedTraceBlocks.length,
    unmetNeedCount: trace.contextSelectionTrace?.unmetNeeds.length ?? 0,
    promptLintIssueCount: trace.promptLintIssueCount,
    issues
  }
}

export class PromptContractReplayService {
  static build(trace: GenerationRunTrace): PromptContractReplay {
    return buildPromptContractReplay(trace)
  }
}

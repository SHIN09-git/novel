import type { ContextSelectionResult, ContextSelectionTrace } from '../types'
import { arrayOrEmpty, objectOrEmpty, stringArrayValue, stringValue } from './common'
import {
  normalizeContextDecisionReasonCode,
  normalizeContextNeedPriority,
  normalizeContextSelectionMode
} from './contextPrimitives'

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function normalizeTraceBlockBase(value: unknown) {
  const block = objectOrEmpty(value)
  return {
    block,
    normalized: {
      blockType: stringValue(block.blockType) || 'unknown',
      sourceId: stringValue(block.sourceId) || null,
      priority: normalizeContextNeedPriority(block.priority),
      uncertain: typeof block.uncertain === 'boolean' ? block.uncertain : false,
      reasonCode: normalizeContextDecisionReasonCode(block.reasonCode),
      forced: typeof block.forced === 'boolean' ? block.forced : false,
      compressed: typeof block.compressed === 'boolean' ? block.compressed : false,
      replacementSourceId: stringValue(block.replacementSourceId) || null,
      tokenEstimate: nonNegativeNumber(block.tokenEstimate)
    }
  }
}

export function normalizeContextSelectionTrace(value: unknown): ContextSelectionTrace | null {
  if (!value || typeof value !== 'object') return null
  const trace = objectOrEmpty(value)
  const summary = objectOrEmpty(trace.budgetSummary)
  const pressure =
    summary.pressure === 'low' || summary.pressure === 'medium' || summary.pressure === 'high'
      ? summary.pressure
      : 'low'

  return {
    projectId: stringValue(trace.projectId),
    chapterId: stringValue(trace.chapterId) || null,
    jobId: stringValue(trace.jobId) || undefined,
    selectionMode: normalizeContextSelectionMode(trace.selectionMode),
    selectedBlocks: arrayOrEmpty(trace.selectedBlocks).map((entry) => {
      const { block, normalized } = normalizeTraceBlockBase(entry)
      return {
        ...normalized,
        reason: stringValue(block.reason) || '已进入最终上下文。'
      }
    }),
    droppedBlocks: arrayOrEmpty(trace.droppedBlocks).map((entry) => {
      const { block, normalized } = normalizeTraceBlockBase(entry)
      return {
        ...normalized,
        dropReason: stringValue(block.dropReason) || stringValue(block.reason) || '预算不足或相关性较低。'
      }
    }),
    unmetNeeds: arrayOrEmpty(trace.unmetNeeds).map((entry) => {
      const item = objectOrEmpty(entry)
      return {
        needType: stringValue(item.needType) || 'unknown',
        priority: normalizeContextNeedPriority(item.priority),
        uncertain: typeof item.uncertain === 'boolean' ? item.uncertain : false,
        reasonCode: normalizeContextDecisionReasonCode(item.reasonCode),
        reason: stringValue(item.reason) || '上下文需求未被最终选择满足。',
        sourceId: stringValue(item.sourceId) || null
      }
    }),
    budgetSummary: {
      totalBudget: nonNegativeNumber(summary.totalBudget),
      usedTokens: nonNegativeNumber(summary.usedTokens),
      reservedTokens: nonNegativeNumber(summary.reservedTokens),
      pressure
    }
  }
}

export function normalizeOmittedContextItems(value: unknown): ContextSelectionResult['omittedItems'] {
  return arrayOrEmpty(value).map((entry) => {
    const item = objectOrEmpty(entry)
    return {
      type: stringValue(item.type) || 'unknown',
      id: stringValue(item.id) || null,
      reason: stringValue(item.reason) || '旧数据未记录具体省略原因。',
      reasonCode: normalizeContextDecisionReasonCode(item.reasonCode),
      priority: normalizeContextNeedPriority(item.priority),
      uncertain: typeof item.uncertain === 'boolean' ? item.uncertain : false,
      replacementSourceId: stringValue(item.replacementSourceId) || null,
      estimatedTokensSaved: nonNegativeNumber(item.estimatedTokensSaved)
    }
  })
}

export function normalizeContextSelectionResult(value: unknown): ContextSelectionResult {
  const selection = objectOrEmpty(value)
  return {
    selectedStoryBibleFields: stringArrayValue(selection.selectedStoryBibleFields),
    selectedChapterIds: stringArrayValue(selection.selectedChapterIds),
    selectedStageSummaryIds: stringArrayValue(selection.selectedStageSummaryIds),
    selectedCharacterIds: stringArrayValue(selection.selectedCharacterIds),
    selectedForeshadowingIds: stringArrayValue(selection.selectedForeshadowingIds),
    selectedTimelineEventIds: stringArrayValue(selection.selectedTimelineEventIds),
    estimatedTokens: nonNegativeNumber(selection.estimatedTokens),
    omittedItems: normalizeOmittedContextItems(selection.omittedItems),
    compressionRecords: normalizeContextCompressionRecords(selection.compressionRecords),
    contextSelectionTrace: normalizeContextSelectionTrace(selection.contextSelectionTrace),
    warnings: stringArrayValue(selection.warnings)
  }
}

export function normalizeContextCompressionRecords(value: unknown): ContextSelectionResult['compressionRecords'] {
  return arrayOrEmpty<Record<string, unknown>>(value).map((entry) => {
    const record = objectOrEmpty(entry)
    const replacementKind =
      record.replacementKind === 'stage_summary' ||
      record.replacementKind === 'chapter_one_line_summary' ||
      record.replacementKind === 'summary_excerpt' ||
      record.replacementKind === 'dropped'
        ? record.replacementKind
        : 'dropped'
    const kind =
      record.kind === 'chapter_recap_to_stage_summary' ||
      record.kind === 'chapter_recap_to_one_line_summary' ||
      record.kind === 'chapter_recap_to_summary_excerpt' ||
      record.kind === 'chapter_recap_dropped'
        ? record.kind
        : 'chapter_recap_dropped'
    const originalTokenEstimate = nonNegativeNumber(record.originalTokenEstimate)
    const replacementTokenEstimate = nonNegativeNumber(record.replacementTokenEstimate)
    return {
      id: stringValue(record.id) || `compression-${stringValue(record.originalChapterId) || 'unknown'}`,
      kind,
      originalContextKind: 'chapter_recap',
      originalChapterId: stringValue(record.originalChapterId),
      originalChapterOrder: typeof record.originalChapterOrder === 'number' ? record.originalChapterOrder : 0,
      originalTitle: stringValue(record.originalTitle) || undefined,
      originalTokenEstimate,
      replacementKind,
      replacementSourceId: stringValue(record.replacementSourceId) || null,
      replacementText: stringValue(record.replacementText),
      replacementTokenEstimate,
      savedTokenEstimate:
        typeof record.savedTokenEstimate === 'number' && Number.isFinite(record.savedTokenEstimate)
          ? Math.max(0, record.savedTokenEstimate)
          : Math.max(0, originalTokenEstimate - replacementTokenEstimate),
      reasonCode: normalizeContextDecisionReasonCode(record.reasonCode || 'compressed_replacement'),
      reason: stringValue(record.reason) || 'Context compressed for token budget.'
    }
  })
}

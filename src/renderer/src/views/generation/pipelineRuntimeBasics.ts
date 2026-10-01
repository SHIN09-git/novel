import type { ContextBudgetMode, PipelineMode } from '../../../../shared/types'
import { safeParseJson } from '../../../../services/AIJsonParser'

export interface PipelineRuntimeOptions {
  targetChapterOrder: number
  pipelineMode: PipelineMode
  estimatedWordCount: string
  readerEmotionTarget: string
  budgetMode: ContextBudgetMode
  budgetMaxTokens: number
}

export function serializeOutput(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

export function parseOutput<T>(value: string, fallback: T): T {
  if (!value.trim()) return fallback
  const parsed = safeParseJson<T>(value, '流水线步骤输出')
  return parsed.ok ? parsed.data : fallback
}

export function normalizePipelineOptions(
  options: Partial<PipelineRuntimeOptions>,
  fallback: PipelineRuntimeOptions
): PipelineRuntimeOptions {
  return {
    targetChapterOrder: Number.isFinite(options.targetChapterOrder) ? Number(options.targetChapterOrder) : fallback.targetChapterOrder,
    pipelineMode: options.pipelineMode ?? fallback.pipelineMode,
    estimatedWordCount: options.estimatedWordCount || fallback.estimatedWordCount,
    readerEmotionTarget: options.readerEmotionTarget || fallback.readerEmotionTarget,
    budgetMode: options.budgetMode ?? fallback.budgetMode,
    budgetMaxTokens: Number.isFinite(options.budgetMaxTokens) ? Number(options.budgetMaxTokens) : fallback.budgetMaxTokens
  }
}

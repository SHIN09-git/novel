export type ReasoningEffort = 'low' | 'medium' | 'high'

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === 'low' || value === 'medium' || value === 'high'
}

// HTTP completion limits cover both reasoning and visible output. These are
// workbench defaults when opting in, not a promise about the model's capacity.
const minimumCompletionTokens = { low: 8192, medium: 16384, high: 32768 } as const

export function effectiveCompletionTokens(maxTokens: number, effort?: ReasoningEffort | null): number {
  return effort ? Math.max(maxTokens, minimumCompletionTokens[effort]) : maxTokens
}

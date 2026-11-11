import type { AiTokenUsage } from './types/base'

export const usageCountFields = ['promptTokens', 'completionTokens', 'totalTokens', 'cachedPromptTokens', 'reasoningTokens'] as const
export const tokenCount = (n: unknown): number | undefined => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : undefined

export function readTokenUsage(v: unknown): AiTokenUsage | undefined {
  if (!v || typeof v !== 'object') return
  const usage: AiTokenUsage = {}
  for (const key of usageCountFields) {
    const n = tokenCount((v as AiTokenUsage)[key])
    if (n !== undefined) usage[key] = n
  }
  return Object.keys(usage).length ? usage : undefined
}

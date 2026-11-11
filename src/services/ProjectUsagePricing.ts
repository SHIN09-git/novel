import type { ApiProvider } from '../shared/types/base'
import type { ProjectModelRate } from '../shared/projectUsage'
import { findProjectRate, priceUsageAttempt } from '../shared/projectUsagePricing'

export { findProjectRate, normalizeProjectModelRates, priceUsageAttempt } from '../shared/projectUsagePricing'

export interface PreparedUsageInput {
  provider: ApiProvider
  endpoint: string
  model: string
  /** Supply messages OR an already counted input, never both. */
  messages?: readonly { role?: string; content: string }[] | null
  countedInputTokens?: number
  maxTokens: number | null
  rates?: readonly ProjectModelRate[]
}

export interface UsageRange { min: number; max: number }
export interface ProjectUsageEstimate {
  scope: 'single_request'
  inputTokens: UsageRange | null
  outputTokens: UsageRange | null
  cost: (UsageRange & { currency: string }) | null
  pricing: 'estimated' | 'no_rate' | 'subscription' | 'unknown'
  pipelineBudget: null
  bookBudget: null
}

// A text-only heuristic, not a tokenizer or a provider limit. Do not include unprepared messages.
function inputRange(messages: PreparedUsageInput['messages']): UsageRange | null {
  if (!messages?.length) return null
  let ascii = 0, han = 0, other = 0, otherBytes = 0
  for (const message of messages) {
    if (typeof message?.content !== 'string') return null
    for (const char of message.content) {
      const code = char.codePointAt(0)!
      if (code < 128) ascii++
      else if (code >= 0x4e00 && code <= 0x9fff) han++
      else { other++; otherBytes += code < 0x800 ? 2 : code < 0x10000 ? 3 : 4 }
    }
  }
  if (ascii + han + other === 0) return null
  return { min: Math.ceil(ascii / 5) + han + other, max: Math.ceil(ascii / 3) + 2 * han + otherBytes }
}

/** Offline, one physical request if dispatched. Never returns messages, settings or the endpoint. */
export function estimateProjectUsage(input: PreparedUsageInput): ProjectUsageEstimate {
  const counted = input.countedInputTokens
  const inputTokens = counted === undefined ? inputRange(input.messages)
    : input.messages == null && Number.isSafeInteger(counted) && counted >= 0 ? { min: counted, max: counted } : null
  const subscription = input.provider === 'codex_cli'
  // Codex CLI uses maxTokens as a prose instruction, not as an enforced generation limit.
  const outputTokens = !subscription && input.maxTokens !== null && Number.isSafeInteger(input.maxTokens) && input.maxTokens > 0
    ? { min: 0, max: input.maxTokens } : null
  const rate = findProjectRate(input.rates, input.provider, input.endpoint, input.model)
  let cost: ProjectUsageEstimate['cost'] = null
  if (!subscription && inputTokens && outputTokens && rate) {
    // Cache hits are not knowable in advance. Bound both extremes, including a premium cache rate.
    const cached = rate.cachedInputPerMillionTokens ?? rate.inputPerMillionTokens
    const min = priceUsageAttempt({ promptTokens: inputTokens.min, completionTokens: 0,
      cachedPromptTokens: cached < rate.inputPerMillionTokens ? inputTokens.min : 0 }, rate)
    const max = priceUsageAttempt({ promptTokens: inputTokens.max, completionTokens: outputTokens.max,
      cachedPromptTokens: cached > rate.inputPerMillionTokens ? inputTokens.max : 0 }, rate)
    if (min !== null && max !== null) cost = { currency: rate.currency, min, max }
  }
  return { scope: 'single_request', inputTokens, outputTokens, cost,
    pricing: subscription ? 'subscription' : !rate ? 'no_rate' : cost ? 'estimated' : 'unknown',
    pipelineBudget: null, bookBudget: null }
}

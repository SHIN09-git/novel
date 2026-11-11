import type { ProjectModelRate } from './projectUsage'
import type { AiTokenUsage, ApiProvider } from './types/base'
import { redactSensitiveText } from './errorUtils'

const safeDimension = (value: string) => redactSensitiveText(value) === value &&
  !/(?:^|[^a-z0-9])(?:sk-|github_pat_|gh[pousr]_|xox[baprs]-|eyj[\w-]+\.|AIza[\w-]{16,}|AKIA[\w]{16})/i.test(value)

/** Only the HTTP origin is a pricing dimension. Never retain the URL as supplied. */
export function modelRateOrigin(endpoint: unknown): string | undefined {
  if (typeof endpoint !== 'string') return undefined
  try {
    const url = new URL(endpoint)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password &&
      safeDimension(url.origin) ? url.origin : undefined
  } catch { return undefined }
}

function isPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function normalizeRate(value: unknown): ProjectModelRate | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const { provider, inputPerMillionTokens, outputPerMillionTokens, cachedInputPerMillionTokens } = raw
  const endpoint = modelRateOrigin(raw.endpoint)
  const model = typeof raw.model === 'string' ? raw.model.trim() : ''
  const currency = typeof raw.currency === 'string' ? raw.currency.trim().toUpperCase() : ''
  if ((provider !== 'openai' && provider !== 'compatible' && provider !== 'local' && provider !== 'codex_cli') ||
      !endpoint || !/^[\p{L}\p{N}][\p{L}\p{N}_.:/+-]{0,127}$/u.test(model) || model.includes('://') ||
      !safeDimension(model) || !/^[A-Z]{3}$/.test(currency) ||
      !isPrice(inputPerMillionTokens) || !isPrice(outputPerMillionTokens) ||
      (cachedInputPerMillionTokens !== undefined && !isPrice(cachedInputPerMillionTokens))) return undefined
  return { provider, endpoint, model, currency, inputPerMillionTokens, outputPerMillionTokens,
    ...(cachedInputPerMillionTokens === undefined ? {} : { cachedInputPerMillionTokens }) }
}

export function normalizeProjectModelRates(value: unknown): ProjectModelRate[] {
  if (!Array.isArray(value)) return []
  const rates = new Map<string, ProjectModelRate>()
  for (const item of value) {
    const rate = normalizeRate(item)
    if (rate) rates.set(JSON.stringify([rate.provider, rate.endpoint, rate.model]), rate)
  }
  return [...rates.values()]
}

export function findProjectRate(
  rates: readonly ProjectModelRate[] | undefined, provider: ApiProvider, endpoint: string, model: string
): ProjectModelRate | undefined {
  const origin = modelRateOrigin(endpoint)
  if (!origin || !model?.trim()) return undefined
  return rates?.find(rate => rate.provider === provider && rate.endpoint === origin && rate.model === model.trim())
}

const isTokenCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0

export function priceUsageAttempt(usage: AiTokenUsage | undefined, rate: ProjectModelRate | undefined): number | null {
  if (!usage || !rate || rate.provider === 'codex_cli') return null
  const { promptTokens: input, completionTokens: output, cachedPromptTokens: cached } = usage
  const { inputPerMillionTokens: inputPrice, outputPerMillionTokens: outputPrice, cachedInputPerMillionTokens: cachedPrice } = rate
  if (!isTokenCount(input) || !isTokenCount(output) || !isPrice(inputPrice) || !isPrice(outputPrice) ||
      (cachedPrice !== undefined && !isPrice(cachedPrice)) ||
      (cached !== undefined && (!isTokenCount(cached) || cached > input))) return null
  if (input > 0 && cachedPrice !== undefined && cachedPrice !== inputPrice && cached === undefined) return null
  // Cached input is already part of promptTokens; reasoning is already part of completionTokens.
  const amount = ((input - (cached ?? 0)) * inputPrice + (cached ?? 0) * (cachedPrice ?? inputPrice) + output * outputPrice) / 1_000_000
  return Number.isFinite(amount) ? amount : null
}

import type {
  AIResult,
  ForeshadowingTreatmentMode,
  ForeshadowingWeight
} from '../../../shared/types'
import { normalizeTreatmentMode } from '../../../shared/foreshadowingTreatment'

export function fallbackResult<T>(data: T, error = '未配置 API Key，已生成本地结构化模板。'): AIResult<T> {
  return { ok: true, usedAI: false, data, error }
}

export function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    return value
      .map((item) => asText(item))
      .map((item) => item.trim())
      .filter(Boolean)
      .join('\n')
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        const text = asText(item).trim()
        return text ? `${key}: ${text}` : ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function normalizeWeight(value: unknown): ForeshadowingWeight {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'payoff') return value
  if (value === '低') return 'low'
  if (value === '中') return 'medium'
  if (value === '高') return 'high'
  if (value === '回收') return 'payoff'
  return 'medium'
}

export function normalizeRecommendedTreatmentMode(value: unknown): ForeshadowingTreatmentMode | undefined {
  if (value === null || value === undefined || value === '') return undefined
  return normalizeTreatmentMode(value)
}

export function normalizeNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

export function clampScore(value: unknown, fallback = 70): number {
  return Math.max(0, Math.min(100, Math.round(asNumber(value, fallback))))
}

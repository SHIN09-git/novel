import type { AiTokenUsage, ApiProvider } from './types/base'

export const usagePhases = ['planning', 'writing', 'review', 'revision', 'extraction', 'other'] as const
export type UsagePhase = typeof usagePhases[number]
export interface ProjectUsageContext { projectId: string; phase: UsagePhase }

/** One physical dispatch. No manuscript text, URL path, error body or credentials. */
export interface UsageAttempt extends ProjectUsageContext {
  id: string
  callId: string
  runId?: string
  startedAt: string
  provider: ApiProvider
  model: string
  endpoint: string
  outcome: 'success' | 'failed' | 'cancelled'
  usage?: AiTokenUsage
  providerRequestId?: string
}

export interface ProjectModelRate {
  provider: ApiProvider
  endpoint: string
  model: string
  currency: string
  inputPerMillionTokens: number
  outputPerMillionTokens: number
  cachedInputPerMillionTokens?: number
}

export interface UsageTotals {
  requests: number
  failedRequests: number
  unknownUsageRequests: number
  partialUsageRequests: number
  subscriptionRequests: number
  unpricedRequests: number
  tokens: Record<keyof AiTokenUsage, number | null>
  costs: { currency: string; amount: number; pricedRequests: number }[]
}

export interface ProjectUsageReport {
  projectId: string
  totals: UsageTotals
  byPhase: (UsageTotals & { phase: UsagePhase })[]
  coverage: {
    firstRecordedAt: string | null
    lastRecordedAt: string | null
    legacyCalls: number
    legacyJobsWithoutUsage: number
    invalidRecords: number
    unreportedRequests: number
  }
  balance: null
  warnings: string[]
}

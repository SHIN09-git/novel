import { randomUUID } from 'node:crypto'
import type { ProjectUsageContext, UsageAttempt } from '../../shared/projectUsage'
import type { AiTokenUsage } from '../../shared/types'
import { usageCountFields } from '../../shared/tokenUsage'

export interface UsageJournal {
  getStoragePath(): string | null
  append(storagePath: string, attempts: readonly UsageAttempt[]): Promise<void>
}

type Dispatch = Pick<UsageAttempt, 'id' | 'endpoint' | 'startedAt' | 'outcome' | 'providerRequestId' | 'usage'>
type CallMetadata = Pick<UsageAttempt, 'callId' | 'runId' | 'model' | 'provider'>
export type ReceiptMetadata = { providerRequestId?: unknown; usage?: AiTokenUsage }

/** Private to one logical call. Its dispatches (including retries) run sequentially. */
export class AiUsageReceipts {
  private readonly dispatches: Dispatch[] = []

  constructor(private readonly isSafeId: (id: string) => boolean) {}

  start(endpoint: string): void {
    this.dispatches.push({ id: randomUUID(), startedAt: new Date().toISOString(), endpoint, outcome: 'failed' })
  }

  observe({ providerRequestId, usage }: ReceiptMetadata, outcome?: Dispatch['outcome']): void {
    const attempt = this.dispatches.at(-1)
    if (!attempt) return
    if (outcome) attempt.outcome = outcome
    if (usage) attempt.usage = usage
    if (!attempt.providerRequestId && typeof providerRequestId === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(providerRequestId) &&
        !/^(?:sk-|eyJ[^.]*\.)/i.test(providerRequestId) && this.isSafeId(providerRequestId)) {
      attempt.providerRequestId = providerRequestId
    }
  }

  get count(): number { return this.dispatches.length }

  totalKnownUsage(): AiTokenUsage | undefined {
    // The journal keeps all dispatches. A provider can replay the same charge on a retry.
    const seen = new Map<string, AiTokenUsage>()
    const conflicts = new Set<keyof AiTokenUsage>()
    const total: AiTokenUsage = {}
    for (const { id, endpoint, providerRequestId, usage } of this.dispatches) {
      if (!usage) continue
      const source = providerRequestId ? JSON.stringify([endpoint, providerRequestId]) : id
      const previous = seen.get(source) ?? {}
      for (const key of usageCountFields) {
        const n = usage[key]
        if (n === undefined || conflicts.has(key)) continue
        if (previous[key] === undefined) {
          previous[key] = n
          total[key] = (total[key] ?? 0) + n
        } else if (previous[key] !== n) {
          conflicts.add(key)
          delete total[key]
        }
      }
      seen.set(source, previous)
    }
    return Object.keys(total).length ? total : undefined
  }

  records(context: ProjectUsageContext, call: CallMetadata): UsageAttempt[] {
    return this.dispatches.map(attempt => ({ ...context, ...call, ...attempt }))
  }
}

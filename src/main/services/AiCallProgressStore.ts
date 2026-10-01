import type { AiCallProgress, AiCallProgressStage, ApiProvider } from '../../shared/types'

interface StoredAiCallProgress {
  callId: string
  runId?: string
  stage: AiCallProgressStage
  attempt: number
  retryDelayMs?: number
  provider: ApiProvider
  model: string
  startedAtMs: number
  lastActivityAtMs: number
  sequence: number
}

export interface AiCallProgressStoreOptions {
  now?: () => number
  terminalRetentionMs?: number
  maxEntries?: number
}

export interface StartAiCallProgressInput {
  callId: string
  runId?: string
  provider: ApiProvider
  model: string
  startedAt?: number
}

export interface UpdateAiCallProgressInput {
  attempt?: number
  retryDelayMs?: number
}

const TERMINAL_STAGES = new Set<AiCallProgressStage>(['completed', 'failed', 'cancelled'])

function progressKey(runId: string | undefined, callId: string): string {
  return `${runId ?? ''}\u0000${callId}`
}

function newestFirst(left: StoredAiCallProgress, right: StoredAiCallProgress): number {
  return right.lastActivityAtMs - left.lastActivityAtMs || right.sequence - left.sequence ||
    right.startedAtMs - left.startedAtMs ||
    right.callId.localeCompare(left.callId)
}

export class AiCallProgressStore {
  private readonly records = new Map<string, StoredAiCallProgress>()
  private readonly now: () => number
  private readonly terminalRetentionMs: number
  private readonly maxEntries: number
  private sequence = 0

  constructor(options: AiCallProgressStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.terminalRetentionMs = Math.max(0, options.terminalRetentionMs ?? 5 * 60_000)
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 200))
  }

  start(input: StartAiCallProgressInput): void {
    const timestamp = input.startedAt ?? this.now()
    this.prune(timestamp)
    this.records.set(progressKey(input.runId, input.callId), {
      callId: input.callId,
      runId: input.runId,
      stage: 'waiting_response',
      attempt: 0,
      provider: input.provider,
      model: input.model.trim().slice(0, 128) || 'unknown',
      startedAtMs: timestamp,
      lastActivityAtMs: timestamp,
      sequence: ++this.sequence
    })
  }

  update(
    runId: string | undefined,
    callId: string,
    stage: AiCallProgressStage,
    input: UpdateAiCallProgressInput = {}
  ): void {
    const record = this.records.get(progressKey(runId, callId))
    if (!record || TERMINAL_STAGES.has(record.stage)) return
    const timestamp = this.now()
    record.stage = stage
    record.attempt = input.attempt ?? record.attempt
    record.retryDelayMs = stage === 'retry_wait' ? input.retryDelayMs : undefined
    record.lastActivityAtMs = timestamp
    record.sequence = ++this.sequence
    this.prune(timestamp)
  }

  get(query: { runId?: string; callId?: string } = {}): AiCallProgress | null {
    const timestamp = this.now()
    this.prune(timestamp)
    if (query.runId !== undefined && query.callId !== undefined) {
      const record = this.records.get(progressKey(query.runId, query.callId))
      return record?.runId === query.runId && record.callId === query.callId
        ? this.snapshot(record, timestamp)
        : null
    }
    let match: StoredAiCallProgress | undefined
    let activeMatch: StoredAiCallProgress | undefined
    for (const record of this.records.values()) {
      if (query.runId !== undefined && record.runId !== query.runId) continue
      if (query.callId !== undefined && record.callId !== query.callId) continue
      if (!match || newestFirst(record, match) < 0) match = record
      if (query.callId === undefined && !TERMINAL_STAGES.has(record.stage) &&
        (!activeMatch || newestFirst(record, activeMatch) < 0)) {
        activeMatch = record
      }
    }
    match = activeMatch ?? match
    return match ? this.snapshot(match, timestamp) : null
  }

  listRun(runId: string): AiCallProgress[] {
    const timestamp = this.now()
    this.prune(timestamp)
    return [...this.records.values()]
      .filter((record) => record.runId === runId)
      .sort(newestFirst)
      .map((record) => this.snapshot(record, timestamp))
  }

  private snapshot(record: StoredAiCallProgress, timestamp: number): AiCallProgress {
    const elapsedAt = TERMINAL_STAGES.has(record.stage) ? record.lastActivityAtMs : timestamp
    return {
      callId: record.callId,
      runId: record.runId,
      stage: record.stage,
      elapsedMs: Math.max(0, elapsedAt - record.startedAtMs),
      attempt: record.attempt,
      retryDelayMs: record.retryDelayMs,
      provider: record.provider,
      model: record.model,
      startedAt: new Date(record.startedAtMs).toISOString(),
      lastActivityAt: new Date(record.lastActivityAtMs).toISOString()
    }
  }

  private prune(timestamp: number): void {
    let activeCount = 0
    for (const [key, record] of this.records) {
      if (!TERMINAL_STAGES.has(record.stage)) {
        activeCount += 1
      } else if (timestamp - record.lastActivityAtMs > this.terminalRetentionMs) {
        this.records.delete(key)
      }
    }
    if (this.records.size <= this.maxEntries || this.records.size === activeCount) return
    const terminalLimit = Math.max(0, this.maxEntries - activeCount)
    const terminalRecords = [...this.records.entries()]
      .filter(([, record]) => TERMINAL_STAGES.has(record.stage))
      .sort((left, right) => newestFirst(left[1], right[1]))
    for (const [key] of terminalRecords.slice(terminalLimit)) this.records.delete(key)
  }
}

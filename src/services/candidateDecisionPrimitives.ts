import type { AppData, CandidateDecisionCommand } from '../shared/types'
import { draftContentHash } from './DraftDiagnosticBindingService'

export class CandidateDecisionError extends Error {
  constructor(message: string, readonly code = 'CANDIDATE_DECISION_INVALID') { super(message) }
}

export function stableDecisionJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableDecisionJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableDecisionJson(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export const decisionFingerprint = (value: unknown) => draftContentHash(stableDecisionJson(value)).replace('draft-v1-', 'decision-v1-')

export function validateDecisionEnvelope(command: CandidateDecisionCommand): void {
  if (!command || typeof command.id !== 'string' || !command.id.trim() ||
    typeof command.projectId !== 'string' || !command.projectId.trim() || command.schemaVersion !== 1 ||
    !['user', 'agent'].includes(command.actor?.kind) || typeof command.decidedAt !== 'string' || !Number.isFinite(Date.parse(command.decidedAt)) ||
    typeof command.reason !== 'string') throw new CandidateDecisionError('候选决定缺少必要参数。')
}

export const CANDIDATE_DECISION_COLLECTIONS = [
  'projects', 'chapters', 'chapterContinuityBridges', 'characters', 'characterStateLogs', 'characterStateFacts',
  'characterStateTransactions', 'characterStateChangeCandidates', 'memoryUpdateCandidates', 'foreshadowings',
  'timelineEvents', 'stageSummaries', 'generationRunTraces', 'candidateDecisionReceipts'
] as const satisfies readonly (keyof AppData)[]

export type DecisionRecord = { id: string; projectId?: string; [key: string]: unknown }
export function decisionRecords(data: AppData, collection: string): DecisionRecord[] {
  if (!CANDIDATE_DECISION_COLLECTIONS.some((key) => key === collection)) return []
  return data[collection as typeof CANDIDATE_DECISION_COLLECTIONS[number]] as unknown as DecisionRecord[]
}

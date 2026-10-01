import type { AppData, CandidateDecisionReceipt } from '../../shared/types'
import { redactSensitiveText } from '../../shared/errorUtils'
import { compact } from '../agentReadableText'
import { readOptions } from './agentToolArguments'

export function redactCandidateValue<T>(value: T, data: AppData): T {
  if (typeof value === 'string') return redactSensitiveText(value, [data.settings.apiKey]) as T
  if (Array.isArray(value)) return value.map((item) => redactCandidateValue(item, data)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactCandidateValue(item, data)])) as T
  }
  return value
}

export function candidateDecisionText(value: string, data: AppData, args: Record<string, unknown>): string {
  const { detail, maxChars } = readOptions(args)
  const safe = redactCandidateValue(value, data)
  return detail === 'full' ? (maxChars ? safe.slice(0, maxChars) : safe) : compact(safe, Math.min(maxChars ?? 320, 320))
}

export function candidateReceiptForDisplay(receipt: CandidateDecisionReceipt, data: AppData, args: Record<string, unknown>) {
  if (readOptions(args).detail === 'full') return redactCandidateValue(receipt, data)
  return redactCandidateValue({
    id: receipt.id, projectId: receipt.projectId, actor: receipt.actor, authorizationGrantId: receipt.authorizationGrantId,
    reason: candidateDecisionText(receipt.reason, data, args), decidedAt: receipt.decidedAt, updatedAt: receipt.updatedAt,
    operation: receipt.operation ?? 'decide', undoesReceiptId: receipt.undoesReceiptId,
    decisions: receipt.decisions.map(({ kind, candidateId, decision }) => ({ kind, candidateId, decision })),
    changedRecords: receipt.changedRecords, undoSupported: Boolean(receipt.effects?.length) && receipt.operation !== 'undo',
    effects: receipt.effects?.map((effect) => ({ collection: effect.collection, id: effect.id, created: effect.created,
      title: candidateDecisionText(effect.title, data, args), fieldCount: effect.fields.length }))
  }, data)
}

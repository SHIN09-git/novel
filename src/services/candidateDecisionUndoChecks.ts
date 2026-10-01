import type { AppData, CandidateDecisionEffect, CandidateDecisionReceipt } from '../shared/types'

const referenceFields: Record<string, Set<string>> = {
  foreshadowings: new Set(['foreshadowingId', 'foreshadowingIds', 'relatedForeshadowingIds', 'requiredForeshadowingIds', 'forbiddenForeshadowingIds']),
  timelineEvents: new Set(['timelineEventId', 'timelineEventIds', 'relatedTimelineEventIds', 'requiredTimelineEventIds']),
  stageSummaries: new Set(['stageSummaryId', 'stageSummaryIds', 'generatedFromStageSummaryIds']),
  chapterContinuityBridges: new Set(['bridgeId', 'continuityBridgeId', 'chapterContinuityBridgeId'])
}
const sourceCollections: Record<string, string> = { foreshadowing: 'foreshadowings', timeline: 'timelineEvents', stage_summary: 'stageSummaries' }
function references(value: unknown, id: string, collection: string, key = ''): boolean {
  if (typeof value === 'string') return Boolean(referenceFields[collection]?.has(key)) && value === id
  if (Array.isArray(value)) return value.some((item) => references(item, id, collection, key))
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    if (source.sourceId === id && sourceCollections[String(source.sourceType)] === collection) return true
    return Object.entries(value).some(([name, item]) => name !== 'id' && references(item, id, collection, name))
  }
  return false
}

/** History may reference a removed item. Live world records must not be left dangling. */
export function liveUndoDependencies(data: AppData, effects: CandidateDecisionEffect[]): string[] {
  const removed = effects.filter((effect) => effect.created &&
    ['foreshadowings', 'timelineEvents', 'stageSummaries', 'chapterContinuityBridges'].includes(effect.collection))
  const removing = new Set(removed.map((effect) => `${effect.collection}:${effect.id}`))
  const warnings: string[] = []
  const collections = ['characters', 'characterStateFacts', 'foreshadowings', 'timelineEvents',
    'hardCanonPacks', 'storyDirectionGuides', 'chapterContinuityBridges'] as const
  for (const effect of removed) {
    for (const collection of collections) {
      for (const item of data[collection] ?? []) {
        if (removing.has(`${collection}:${item.id}`)) continue
        if (references(item, effect.id, effect.collection)) warnings.push(`“${effect.title}”已被其他故事记录引用，请先处理关联：${collection} / ${item.id}。`)
      }
    }
  }
  return warnings
}

export function laterDecisionTouches(data: AppData, receipt: CandidateDecisionReceipt,
  effect: CandidateDecisionEffect, path: string[]): boolean {
  const receipts = data.candidateDecisionReceipts ?? []
  const undone = new Set(receipts.map((item) => item.undoesReceiptId).filter(Boolean))
  const sourceIndex = receipts.findIndex((item) => item.id === receipt.id)
  return receipts.some((item, index) => item.projectId === receipt.projectId && !item.operation &&
    item.id !== receipt.id && !undone.has(item.id) &&
    (Date.parse(item.decidedAt) > Date.parse(receipt.decidedAt) || item.decidedAt === receipt.decidedAt && index > sourceIndex) &&
    item.effects?.some((change) => change.collection === effect.collection && change.id === effect.id &&
      change.fields.some((field) => field.path.every((key, i) => path[i] === key) || path.every((key, i) => field.path[i] === key))))
}

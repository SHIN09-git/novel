import type { CandidateDecisionReceipt, CandidateDecisionUndoPreview } from '../../../../shared/types/candidateDecision'
import type { DecisionInboxCandidateRef, DecisionInboxEventGroup } from '../../../../services/DecisionInboxService'

export type InboxFilter = 'all' | 'high' | 'memory' | 'state' | 'foreshadowing' | 'timeline'

export const INBOX_FILTERS = [
  ['all', '全部'], ['high', '高风险'], ['memory', '记忆'], ['state', '角色状态'],
  ['foreshadowing', '伏笔'], ['timeline', '时间线']
] as const

export function matchesInboxFilter(group: DecisionInboxEventGroup, filter: InboxFilter): boolean {
  if (filter === 'high') return group.riskLevel === 'high'
  if (filter === 'memory') return group.memoryCandidateIds.length > 0
  if (filter === 'state') return group.characterStateCandidateIds.length > 0
  if (filter === 'foreshadowing' || filter === 'timeline') return group.impactAreas.includes(filter)
  return true
}

export function inboxCandidateKey(candidate: DecisionInboxCandidateRef): string {
  return `${candidate.kind === 'memory_update' ? 'memory' : 'character_state'}:${candidate.id}`
}

export function selectedInboxCandidates(group: DecisionInboxEventGroup, selected: ReadonlySet<string>) {
  return group.candidates.filter((candidate) => selected.has(inboxCandidateKey(candidate)))
}

export function decisionReceiptSummary(receipt: CandidateDecisionReceipt): string {
  if (receipt.operation === 'undo') return '已撤销一次候选处理'
  const accepted = receipt.decisions.filter((item) => item.decision === 'accept').length
  const rejected = receipt.decisions.filter((item) => item.decision === 'reject').length
  const amended = receipt.decisions.filter((item) => item.amendment).length
  return [accepted ? `接受 ${accepted} 项` : '', rejected ? `拒绝 ${rejected} 项` : '',
    amended ? `其中编辑 ${amended} 项` : ''].filter(Boolean).join(' · ') || '候选处理记录'
}

export function decisionRecordTitle(record: { collection: string; title: string }): string {
  const labels: Record<string, string> = {
    memoryUpdateCandidates: '记忆候选', characterStateChangeCandidates: '角色状态候选',
    chapters: '章节记忆', characters: '角色卡', characterStateFacts: '角色状态',
    characterStateTransactions: '状态变更历史', characterStateLogs: '角色变化历史',
    foreshadowings: '伏笔', timelineEvents: '时间线事件', stageSummaries: '阶段摘要',
    generationRunTraces: '运行关联记录', chapterContinuityBridges: '章节承接记录'
  }
  return record.title && record.title !== record.collection ? record.title : labels[record.collection] ?? '相关记录'
}

export function canSubmitDecisionUndo(preview: CandidateDecisionUndoPreview, restoreChangedFields: boolean): boolean {
  return preview.status === 'ready' ||
    (preview.status === 'conflict' && preview.canRestoreConflicts && restoreChangedFields)
}

export function decisionReceiptTime(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '时间未记录'
}

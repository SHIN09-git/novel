import type { DataMergePreview } from '../../../shared/types'

export function formatMergeConflictSummary(preview?: DataMergePreview): string {
  const conflicts = preview?.conflicts ?? []
  if (conflicts.length === 0) return '未提供具体冲突信息。'

  const details = conflicts.slice(0, 3).map((conflict) => {
    const title = conflict.sourceTitle || conflict.targetTitle || conflict.entityId
    return `${title}：${conflict.reason}`
  })
  const remainder = conflicts.length - details.length
  return `${details.join('；')}${remainder > 0 ? `；另有 ${remainder} 个冲突` : ''}`
}

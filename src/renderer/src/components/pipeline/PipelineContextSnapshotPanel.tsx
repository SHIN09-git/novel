import type { ID, PromptContextSnapshot } from '../../../../shared/types'
import { formatDate } from '../../utils/format'

export function PipelineContextSnapshotPanel({
  contextSource,
  snapshot,
  selectedSnapshotId,
  targetChapterOrder,
  onUseAutoContext
}: {
  contextSource: 'auto' | 'prompt_snapshot'
  snapshot: PromptContextSnapshot | null
  selectedSnapshotId: ID | null
  targetChapterOrder: number
  onUseAutoContext: () => void
}) {
  if (contextSource === 'auto') {
    return (
      <div className="pipeline-context-snapshot compact">
        <strong>自动构建上下文</strong>
        <p className="muted">将根据预算、章节衔接、角色、伏笔处理方式和阶段摘要自动选择上下文。</p>
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="pipeline-context-snapshot warning">
        <strong>Prompt 快照不可用</strong>
        <p>快照已丢失或尚未选择，请重新选择快照，或切回自动构建上下文。</p>
        {selectedSnapshotId ? <small>缺失快照 ID：{selectedSnapshotId}</small> : null}
        <button className="ghost-button" type="button" onClick={onUseAutoContext}>
          改用自动构建上下文
        </button>
      </div>
    )
  }

  const mismatch = snapshot.targetChapterOrder !== targetChapterOrder

  return (
    <div className={mismatch ? 'pipeline-context-snapshot warning' : 'pipeline-context-snapshot'}>
      <div className="pipeline-context-snapshot-header">
        <strong>Prompt 快照 · 第 {snapshot.targetChapterOrder} 章</strong>
        <span>{formatDate(snapshot.createdAt)}</span>
      </div>
      <div className="pipeline-mini-metrics">
        <span>{snapshot.mode}</span>
        <span>{snapshot.estimatedTokens} token</span>
        <span>角色 {snapshot.selectedCharacterIds.length}</span>
        <span>伏笔 {snapshot.selectedForeshadowingIds.length}</span>
        <span>处理覆盖 {Object.keys(snapshot.foreshadowingTreatmentOverrides).length}</span>
      </div>
      {mismatch ? <p className="error-text">快照目标章节与当前目标章节不一致，请确认后再生成。</p> : null}
      {snapshot.note ? <p className="muted">备注：{snapshot.note}</p> : null}
      <details>
        <summary>查看快照摘要</summary>
        <ul className="advice-list">
          <li>纳入章节：{snapshot.contextSelectionResult.selectedChapterIds.length}</li>
          <li>阶段摘要：{snapshot.contextSelectionResult.selectedStageSummaryIds.length}</li>
          <li>时间线事件：{snapshot.contextSelectionResult.selectedTimelineEventIds.length}</li>
          <li>省略项目：{snapshot.contextSelectionResult.omittedItems.length}</li>
        </ul>
        <pre>{snapshot.finalPrompt.slice(0, 1200)}</pre>
      </details>
    </div>
  )
}

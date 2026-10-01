import type { ContextBudgetMode, ID, PromptContextSnapshot, PromptVersion } from '../../../../shared/types'
import { ArrowRight, Trash2 } from 'lucide-react'
import { formatDate, modeLabel } from '../../utils/format'

interface PromptHistoryPanelsProps {
  promptContextSnapshots: PromptContextSnapshot[]
  promptVersions: PromptVersion[]
  onLoadSnapshot: (snapshot: PromptContextSnapshot) => void
  onSendSnapshotToPipeline?: (snapshotId: ID) => void
  onDeleteSnapshot: (snapshotId: ID) => void
  onLoadPromptVersion: (version: PromptVersion) => void
  onDeletePromptVersion: (versionId: ID) => void
}

function safeModeLabel(mode: ContextBudgetMode): string {
  return mode === 'custom' ? '自定义模式' : modeLabel(mode)
}

export function PromptHistoryPanels({
  promptContextSnapshots,
  promptVersions,
  onLoadSnapshot,
  onSendSnapshotToPipeline,
  onDeleteSnapshot,
  onLoadPromptVersion,
  onDeletePromptVersion
}: PromptHistoryPanelsProps) {
  return (
    <>
      <section className="panel prompt-snapshot-panel">
        <h2>上下文快照</h2>
        <div className="version-list">
          {promptContextSnapshots.length === 0 ? (
            <p className="muted">暂无上下文快照。</p>
          ) : (
            promptContextSnapshots.map((snapshot) => (
              <div key={snapshot.id} className="version-row">
                <button onClick={() => onLoadSnapshot(snapshot)}>
                  <strong>第 {snapshot.targetChapterOrder} 章 · {safeModeLabel(snapshot.mode)}</strong>
                  <span>
                    {snapshot.estimatedTokens} token · 角色 {snapshot.selectedCharacterIds.length} · 伏笔 {snapshot.selectedForeshadowingIds.length} · {formatDate(snapshot.createdAt)}
                  </span>
                  {snapshot.note ? <span>{snapshot.note}</span> : null}
                </button>
                <div className="row-actions">
                  {onSendSnapshotToPipeline && <button className="ghost-button" onClick={() => onSendSnapshotToPipeline(snapshot.id)}>发送到流水线<ArrowRight size={16} aria-hidden="true" /></button>}
                  <button className="icon-button" aria-label="删除快照" title="删除快照" onClick={() => onDeleteSnapshot(snapshot.id)}><Trash2 size={16} aria-hidden="true" /></button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel prompt-version-panel">
        <h2>已保存版本</h2>
        <div className="version-list">
          {promptVersions.length === 0 && <p className="muted">暂无已保存版本。</p>}
          {promptVersions.map((version) => (
            <div key={version.id} className="version-row">
              <button onClick={() => onLoadPromptVersion(version)}>
                <strong>{version.title}</strong>
                <span>{version.tokenEstimate} token · {formatDate(version.createdAt)}</span>
              </button>
              <button className="icon-button" aria-label="删除版本" title="删除版本" onClick={() => onDeletePromptVersion(version.id)}><Trash2 size={16} aria-hidden="true" /></button>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

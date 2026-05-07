import type { Chapter, ChapterVersion } from '../../../../shared/types'
import { formatDate } from '../../utils/format'

interface ChapterVersionHistoryPanelProps {
  selected: Chapter
  versions: ChapterVersion[]
  onCopyVersion: (version: ChapterVersion) => void
  onRestoreVersion: (version: ChapterVersion) => void
  onDeleteVersion: (version: ChapterVersion) => void
}

export function ChapterVersionHistoryPanel({
  selected,
  versions,
  onCopyVersion,
  onRestoreVersion,
  onDeleteVersion
}: ChapterVersionHistoryPanelProps) {
  return (
    <div className="version-history-panel">
      <div className="panel-title-row">
        <h3>章节版本历史</h3>
        <span className="muted">{versions.length} 个备份</span>
      </div>
      {versions.length === 0 ? (
        <p className="muted">暂无历史版本。接受修订版本或恢复旧版本前，系统会自动保存快照。</p>
      ) : (
        <div className="version-history-list">
          {versions.map((version) => (
            <article key={version.id} className="version-history-item">
              <div>
                <strong>{version.title || `第 ${selected.order} 章`}</strong>
                <p>
                  {version.note || version.source} · {formatDate(version.createdAt)} ·{' '}
                  {version.body.replace(/\s/g, '').length.toLocaleString()} 字
                </p>
              </div>
              <div className="row-actions">
                <button className="ghost-button" onClick={() => onCopyVersion(version)}>
                  复制
                </button>
                <button className="primary-button" onClick={() => onRestoreVersion(version)}>
                  恢复
                </button>
                <button className="danger-button" onClick={() => onDeleteVersion(version)}>
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

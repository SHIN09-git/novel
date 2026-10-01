import type { Chapter, ID } from '../../../../shared/types'

interface ChapterListPanelProps {
  chapters: Chapter[]
  archivedChapters: Chapter[]
  selectedChapterId: ID | null
  activeBodyCharacterCount: number
  onSelectChapter: (chapter: Chapter) => void
  onRestoreChapter: (chapter: Chapter) => void
}

export function ChapterListPanel({
  chapters,
  archivedChapters,
  selectedChapterId,
  activeBodyCharacterCount,
  onSelectChapter,
  onRestoreChapter
}: ChapterListPanelProps) {
  return (
    <aside className="list-pane">
      <div className="chapter-shelf-header">
        <span>章节列表</span>
        <strong>{chapters.length}</strong>
      </div>
      {chapters.map((chapter) => (
        <button
          key={chapter.id}
          className={chapter.id === selectedChapterId ? 'list-item active' : 'list-item'}
          onClick={() => onSelectChapter(chapter)}
        >
          <strong>第 {chapter.order} 章</strong>
          <span>{chapter.title || '未命名'}</span>
          <small>
            {(chapter.id === selectedChapterId ? activeBodyCharacterCount : chapter.body.replace(/\s/g, '').length).toLocaleString()} 字
            {chapter.includedInStageSummary ? ' · 已进阶段摘要' : ''}
          </small>
        </button>
      ))}
      {archivedChapters.length ? (
        <details className="chapter-archive-list">
          <summary>已归档章节 ({archivedChapters.length})</summary>
          <div className="chapter-archive-items">
            {archivedChapters.map((chapter) => (
              <div className="chapter-archive-item" key={chapter.id}>
                <div>
                  <strong>第 {chapter.order} 章</strong>
                  <span>{chapter.title || '未命名'}</span>
                </div>
                <button className="ghost-button" onClick={() => onRestoreChapter(chapter)}>
                  恢复
                </button>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </aside>
  )
}

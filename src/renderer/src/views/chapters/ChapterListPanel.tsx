import type { Chapter, ID } from '../../../../shared/types'

interface ChapterListPanelProps {
  chapters: Chapter[]
  selectedChapterId: ID | null
  activeBodyCharacterCount: number
  onSelectChapter: (chapter: Chapter) => void
}

export function ChapterListPanel({
  chapters,
  selectedChapterId,
  activeBodyCharacterCount,
  onSelectChapter
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
    </aside>
  )
}

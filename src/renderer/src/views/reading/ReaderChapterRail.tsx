import type { Chapter, ID } from '../../../../shared/types'

interface ReaderChapterRailProps {
  chapters: Chapter[]
  activeChapterId: ID | null
  onJump: (chapterId: ID) => void
}

export function ReaderChapterRail({ chapters, activeChapterId, onJump }: ReaderChapterRailProps) {
  return (
    <nav className="reader-chapter-rail" aria-label="章节导航">
      <details title={`章节目录，共 ${chapters.length} 章`} open>
        <summary>目录</summary>
        <div className="reader-chapter-rail-list">
          {chapters.map((chapter) => {
            const isActive = chapter.id === activeChapterId
            return (
              <button
                key={chapter.id}
                type="button"
                className={isActive ? 'active' : ''}
                aria-current={isActive ? 'true' : undefined}
                aria-label={`跳转到第 ${chapter.order} 章 ${chapter.title || '未命名章节'}`}
                title={`第 ${chapter.order} 章 ${chapter.title || '未命名章节'}`}
                onClick={() => onJump(chapter.id)}
              >
                <span className="reader-rail-bar" />
                <span className="reader-rail-label">{chapter.order}</span>
              </button>
            )
          })}
        </div>
      </details>
    </nav>
  )
}

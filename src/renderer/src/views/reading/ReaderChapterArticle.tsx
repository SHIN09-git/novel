import type { MouseEvent } from 'react'
import type { Chapter } from '../../../../shared/types'
import type { AIService } from '../../../../services/AIService'
import { AiRewriteTextArea } from '../../components/AiRewriteTextArea'
import type { ReaderBodySegment } from './readerText'

interface ReaderChapterArticleProps {
  chapter: Chapter
  segments: ReaderBodySegment[]
  showSummary: boolean
  isEditing: boolean
  isSaving?: boolean
  editDraft: string
  getAiService: () => Promise<AIService>
  rewriteContext: () => string
  onStatusChange: (message: string) => void
  onOpenRewriteMenu: (event: MouseEvent<HTMLElement>) => void
  onStartEditing: () => void
  onBackToChapter: () => void
  onEditDraftChange: (value: string) => void
  onCancelEditing: () => void
  onSaveEditing: () => void
}

export function ReaderChapterArticle({
  chapter,
  segments,
  showSummary,
  isEditing,
  isSaving = false,
  editDraft,
  getAiService,
  rewriteContext,
  onStatusChange,
  onOpenRewriteMenu,
  onStartEditing,
  onBackToChapter,
  onEditDraftChange,
  onCancelEditing,
  onSaveEditing
}: ReaderChapterArticleProps) {
  return (
    <article className="reader-chapter card" data-reader-chapter-id={chapter.id}>
      <header className="reader-chapter-header">
        <div>
          <span>第 {chapter.order} 章</span>
          <h2>{chapter.title || '未命名章节'}</h2>
        </div>
        <div className="reader-chapter-actions">
          <button type="button" className="ghost-button" disabled={isSaving} onClick={onStartEditing}>编辑本章</button>
          <button type="button" className="ghost-button" disabled={isSaving} onClick={onBackToChapter}>到章节页</button>
        </div>
      </header>

      {showSummary && chapter.summary ? <p className="reader-summary">{chapter.summary}</p> : null}

      {isEditing ? (
        <div className="reader-inline-editor">
          <AiRewriteTextArea
            value={editDraft}
            disabled={isSaving}
            onChange={onEditDraftChange}
            getAiService={getAiService}
            context={rewriteContext}
            scopeKey={chapter.id}
            rewriteTarget={{ projectId: chapter.projectId, kind: 'reader_edit', targetId: chapter.id }}
            rows={18}
            className="reader-editor-textarea"
            onStatusChange={onStatusChange}
          />
          <div className="reader-inline-actions">
            <button className="ghost-button" type="button" disabled={isSaving} onClick={onCancelEditing}>取消</button>
            <button className="primary-button" type="button" disabled={isSaving} onClick={onSaveEditing}>{isSaving ? '正在保存' : '保存本章'}</button>
          </div>
        </div>
      ) : segments.length ? (
        <div className="reader-chapter-body" onContextMenu={onOpenRewriteMenu}>
          {segments.map((segment) => (
            <p
              key={segment.id}
              data-reader-segment-id={segment.id}
              data-reader-segment-start={segment.start}
              data-reader-segment-end={segment.end}
            >
              {segment.text}
            </p>
          ))}
        </div>
      ) : (
        <p className="reader-empty-chapter">本章正文为空。</p>
      )}
    </article>
  )
}

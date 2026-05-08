import type { ChapterGenerationJob, GeneratedChapterDraft } from '../../../../shared/types'

export function PipelineDraftPanel({
  draft,
  job,
  onAccept,
  onReject,
  onRetryDraft,
  onCopyDraft,
  onOpenRevision
}: {
  draft: GeneratedChapterDraft | null
  job: ChapterGenerationJob | null
  onAccept: (draft: GeneratedChapterDraft) => void
  onReject: (draft: GeneratedChapterDraft) => void
  onRetryDraft: (job: ChapterGenerationJob) => void
  onCopyDraft: (draft: GeneratedChapterDraft) => void
  onOpenRevision?: (draft: GeneratedChapterDraft) => void
}) {
  if (!draft) {
    return (
      <div className="pipeline-draft-empty">
        <h3>章节草稿尚未生成</h3>
        <p className="muted">正文草稿会在“生成正文”步骤完成后显示。</p>
      </div>
    )
  }

  return (
    <article className="pipeline-draft-preview">
      <div className="pipeline-draft-header">
        <div>
          <span className="chapter-kicker">Generated Draft</span>
          <h3>{draft.title || '未命名章节草稿'}</h3>
          <p className="muted">
            {draft.status} · {draft.tokenEstimate} token · {draft.chapterId ? '已关联章节' : '尚未关联正式章节'}
          </p>
        </div>
        <div className="row-actions">
          <button className="ghost-button" onClick={() => onCopyDraft(draft)}>
            复制草稿
          </button>
          {onOpenRevision ? (
            <button className="ghost-button" onClick={() => onOpenRevision(draft)}>
              进入修订
            </button>
          ) : null}
        </div>
      </div>
      <textarea className="prompt-editor pipeline-draft-body" value={draft.body} readOnly />
      <div className="row-actions pipeline-draft-actions">
        <button className="primary-button" disabled={draft.status === 'accepted'} onClick={() => onAccept(draft)}>
          接受章节草稿
        </button>
        <button className="danger-button" disabled={draft.status === 'rejected'} onClick={() => onReject(draft)}>
          拒绝章节草稿
        </button>
        <button className="ghost-button" disabled={!job} onClick={() => job && onRetryDraft(job)}>
          重新生成正文
        </button>
      </div>
    </article>
  )
}

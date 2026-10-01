import type { ChapterAcceptanceReview, ChapterGenerationJob, GeneratedChapterDraft } from '../../../../shared/types'

export function PipelineDraftPanel({
  draft,
  job,
  isRunning,
  onAccept,
  onAcceptUnreviewed,
  acceptanceReview,
  onReject,
  onRetryDraft,
  onCopyDraft,
  onOpenRevision
}: {
  draft: GeneratedChapterDraft | null
  job: ChapterGenerationJob | null
  isRunning: boolean
  onAccept: (draft: GeneratedChapterDraft) => void
  onAcceptUnreviewed?: (draft: GeneratedChapterDraft) => void
  acceptanceReview?: ChapterAcceptanceReview
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
          <span className="chapter-kicker">章节草稿</span>
          <h3>{draft.title || '未命名章节草稿'}</h3>
          <p className="muted">
            {{ draft: '待采纳', accepted: '已采纳', rejected: '已拒绝' }[draft.status]} · {draft.tokenEstimate} token · {draft.chapterId ? '已关联章节' : '尚未关联正式章节'}
          </p>
        </div>
        <div className="row-actions">
          <button className="ghost-button" onClick={() => onCopyDraft(draft)}>
            复制草稿
          </button>
          {onOpenRevision ? (
            <button className="ghost-button" disabled={isRunning} onClick={() => onOpenRevision(draft)}>
              进入修订
            </button>
          ) : null}
        </div>
      </div>
      <textarea className="prompt-editor pipeline-draft-body" aria-label="章节草稿正文" value={draft.body} readOnly />
      <div className="row-actions pipeline-draft-actions">
        <button className="primary-button" disabled={isRunning || draft.status !== 'draft'} onClick={() => onAccept(draft)}>
          接受章节草稿
        </button>
        {onAcceptUnreviewed && draft.status === 'draft' ? (
          <button className="ghost-button" disabled={isRunning} onClick={() => onAcceptUnreviewed(draft)}>
            未完成审稿，直接采纳
          </button>
        ) : null}
        <button className="danger-button" disabled={isRunning || draft.status !== 'draft'} onClick={() => onReject(draft)}>
          拒绝章节草稿
        </button>
        <button className="ghost-button" disabled={isRunning || !job} onClick={() => job && onRetryDraft(job)}>
          重新生成正文
        </button>
      </div>
      {draft.status === 'accepted' ? (
        <p className="notice pipeline-draft-accepted">
          {acceptanceReview?.mode === 'unreviewed' ? '本次为未审稿采纳，已有诊断结果仍保留。' : ''}
          该草稿已经写入正式章节和版本链，可从页面顶部继续生成下一章。
        </p>
      ) : null}
    </article>
  )
}

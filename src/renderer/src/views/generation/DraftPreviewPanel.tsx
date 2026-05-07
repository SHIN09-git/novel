import type { ChapterGenerationJob, GeneratedChapterDraft } from '../../../../shared/types'

interface DraftPreviewPanelProps {
  draft: GeneratedChapterDraft | null
  job: ChapterGenerationJob | null
  onAccept: (draft: GeneratedChapterDraft) => void
  onReject: (draft: GeneratedChapterDraft) => void
  onRetryDraft: (job: ChapterGenerationJob) => void
  onCopyDraft: (draft: GeneratedChapterDraft) => void
}

export function DraftPreviewPanel({ draft, job, onAccept, onReject, onRetryDraft, onCopyDraft }: DraftPreviewPanelProps) {
  return (
    <div className="panel draft-panel">
      <h2>章节正文草稿</h2>
      {draft ? (
        <article className="candidate-card">
          <h3>{draft.title}</h3>
          <p>
            状态：{draft.status} · {draft.tokenEstimate} token
          </p>
          <textarea className="prompt-editor" value={draft.body} readOnly />
          <div className="row-actions">
            <button className="primary-button" onClick={() => onAccept(draft)}>
              接受章节草稿
            </button>
            <button className="danger-button" onClick={() => onReject(draft)}>
              拒绝章节草稿
            </button>
            <button className="ghost-button" disabled={!job} onClick={() => job && onRetryDraft(job)}>
              重新生成章节正文
            </button>
            <button className="ghost-button" onClick={() => onCopyDraft(draft)}>
              复制草稿正文
            </button>
          </div>
        </article>
      ) : (
        <p className="muted">正文草稿会在第 3 步完成后显示。</p>
      )}
    </div>
  )
}

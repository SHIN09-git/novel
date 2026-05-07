import type { ReactNode } from 'react'
import type { Chapter } from '../../../../shared/types'
import { NumberInput, TextArea, TextInput, Toggle } from '../../components/FormFields'

interface ChapterEditorPanelProps {
  selected: Chapter
  bodyDraft: string
  bodyCharacterCount: number
  paragraphCount: number
  reviewFilledCount: number
  reviewFieldCount: number
  chapterStatus: string
  loadingAction: string | null
  aiMessage: string
  showVersionHistory: boolean
  versionCount: number
  versionHistory: ReactNode
  onUpdateChapter: (patch: Partial<Chapter>) => void
  onBodyChange: (body: string) => void
  onBodyBlur: () => void
  onCopyBody: () => void
  onCopyWithTitle: () => void
  onExportTxt: () => void
  onExportMarkdown: () => void
  onToggleVersionHistory: () => void
  onApplyReviewTemplate: () => void
  onGenerateReview: () => void
  onExtractCharacters: () => void
  onExtractForeshadowing: () => void
  onGenerateNextRisk: () => void
  onDeleteChapter: () => void
}

export function ChapterEditorPanel({
  selected,
  bodyDraft,
  bodyCharacterCount,
  paragraphCount,
  reviewFilledCount,
  reviewFieldCount,
  chapterStatus,
  loadingAction,
  aiMessage,
  showVersionHistory,
  versionCount,
  versionHistory,
  onUpdateChapter,
  onBodyChange,
  onBodyBlur,
  onCopyBody,
  onCopyWithTitle,
  onExportTxt,
  onExportMarkdown,
  onToggleVersionHistory,
  onApplyReviewTemplate,
  onGenerateReview,
  onExtractCharacters,
  onExtractForeshadowing,
  onGenerateNextRisk,
  onDeleteChapter
}: ChapterEditorPanelProps) {
  return (
    <div className="panel chapter-editor-main">
      <div className="chapter-editor-heading">
        <div>
          <span className="chapter-kicker">当前章节</span>
          <h2>
            第 {selected.order} 章 {selected.title || '未命名'}
          </h2>
        </div>
        <div className="chapter-meta-strip">
          <span>{chapterStatus}</span>
          <span>{bodyCharacterCount.toLocaleString()} 字</span>
          <span>{paragraphCount} 段</span>
          <span>
            复盘 {reviewFilledCount}/{reviewFieldCount}
          </span>
        </div>
      </div>
      <div className="form-grid compact">
        <NumberInput
          label="章节序号"
          min={1}
          value={selected.order}
          onChange={(order) => onUpdateChapter({ order: order ?? selected.order })}
        />
        <TextInput label="章节标题" value={selected.title} onChange={(title) => onUpdateChapter({ title })} />
      </div>
      <TextArea
        label="正文稿纸"
        value={bodyDraft}
        rows={24}
        className="manuscript-textarea"
        onBlur={onBodyBlur}
        onChange={onBodyChange}
      />
      <div className="row-actions chapter-export-actions">
        <button className="ghost-button" onClick={onCopyBody}>
          复制正文
        </button>
        <button className="ghost-button" onClick={onCopyWithTitle}>
          复制标题 + 正文
        </button>
        <button className="ghost-button" onClick={onExportTxt}>
          导出 TXT
        </button>
        <button className="ghost-button" onClick={onExportMarkdown}>
          导出 Markdown
        </button>
        <button className="ghost-button" onClick={onToggleVersionHistory}>
          版本历史 {versionCount ? `(${versionCount})` : ''}
        </button>
      </div>
      <div className="row-actions chapter-ai-actions">
        <button className="ghost-button" onClick={onApplyReviewTemplate}>
          一键生成章节复盘模板
        </button>
        <button className="primary-button" disabled={loadingAction !== null} onClick={onGenerateReview}>
          生成章节复盘草稿
        </button>
        <button className="ghost-button" disabled={loadingAction !== null} onClick={onExtractCharacters}>
          从正文提取角色变化
        </button>
        <button className="ghost-button" disabled={loadingAction !== null} onClick={onExtractForeshadowing}>
          从正文提取伏笔
        </button>
        <button className="ghost-button" disabled={loadingAction !== null} onClick={onGenerateNextRisk}>
          生成下一章风险提醒
        </button>
        <Toggle
          label="已进入阶段摘要"
          checked={selected.includedInStageSummary}
          onChange={(includedInStageSummary) => onUpdateChapter({ includedInStageSummary })}
        />
        <button className="danger-button" onClick={onDeleteChapter}>
          删除章节
        </button>
      </div>
      {loadingAction ? <p className="muted">正在生成草稿...</p> : null}
      {aiMessage ? <div className="notice">{aiMessage}</div> : null}
      {showVersionHistory ? versionHistory : null}
    </div>
  )
}

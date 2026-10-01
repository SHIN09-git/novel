import type { ReactNode } from 'react'
import type { Chapter } from '../../../../shared/types'
import type { AIService } from '../../../../services/AIService'
import { AiRewriteTextArea } from '../../components/AiRewriteTextArea'
import { NumberInput, TextInput, Toggle } from '../../components/FormFields'
import { CHAPTER_BODY_SAVE_LABELS, type ChapterBodySaveStatus } from './chapterBodyDraftModel'

interface ChapterEditorPanelProps {
  selected: Chapter
  bodyDraft: string
  bodyCharacterCount: number
  paragraphCount: number
  reviewFilledCount: number
  reviewFieldCount: number
  chapterStatus: string
  bodySaveStatus: ChapterBodySaveStatus
  hasBodyConflict: boolean
  loadingAction: string | null
  aiMessage: string
  getAiService: () => Promise<AIService>
  aiRewriteContext: string | (() => string)
  onAiRewriteStatus: (message: string) => void
  showVersionHistory: boolean
  showReviewPanel: boolean
  versionHistory: ReactNode
  onUpdateChapter: (patch: Partial<Chapter>) => void | Promise<unknown>
  onBodyChange: (body: string) => void
  onApplyRewrite: (body: string) => Promise<boolean>
  onBodyBlur: () => void
  onCopyBody: () => void
  onCopyWithTitle: () => void
  onExportTxt: () => void
  onExportMarkdown: () => void
  onToggleVersionHistory: () => void
  onToggleReviewPanel: () => void
  onApplyReviewTemplate: () => void
  onGenerateReview: () => void
  onExtractCharacters: () => void
  onExtractForeshadowing: () => void
  onGenerateNextRisk: () => void
  onArchiveChapter: () => void
  onUseExternalBody: () => void
  onKeepLocalBody: () => void
}

export function ChapterEditorPanel({
  selected,
  bodyDraft,
  bodyCharacterCount,
  paragraphCount,
  reviewFilledCount,
  reviewFieldCount,
  chapterStatus,
  bodySaveStatus,
  hasBodyConflict,
  loadingAction,
  aiMessage,
  getAiService,
  aiRewriteContext,
  onAiRewriteStatus,
  showVersionHistory,
  showReviewPanel,
  versionHistory,
  onUpdateChapter,
  onBodyChange,
  onApplyRewrite,
  onBodyBlur,
  onCopyBody,
  onCopyWithTitle,
  onExportTxt,
  onExportMarkdown,
  onToggleVersionHistory,
  onToggleReviewPanel,
  onApplyReviewTemplate,
  onGenerateReview,
  onExtractCharacters,
  onExtractForeshadowing,
  onGenerateNextRisk,
  onArchiveChapter,
  onUseExternalBody,
  onKeepLocalBody
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
          <span className={`chapter-body-save-state is-${bodySaveStatus}`}>{CHAPTER_BODY_SAVE_LABELS[bodySaveStatus]}</span>
          <span>{bodyCharacterCount.toLocaleString()} 字</span>
          <span>{paragraphCount} 段</span>
          <span>
            复盘 {reviewFilledCount}/{reviewFieldCount}
          </span>
        </div>
      </div>
      {hasBodyConflict ? (
        <div className="notice warning chapter-body-conflict" role="status">
          <div>
            <strong>正文出现版本冲突</strong>
            <span>其他流程已经保存了新正文。系统已暂停自动保存，避免覆盖任一版本。</span>
          </div>
          <div className="row-actions">
            <button className="ghost-button" onClick={onUseExternalBody}>使用最新正文</button>
            <button className="danger-button" onClick={onKeepLocalBody}>保留本地并覆盖</button>
          </div>
        </div>
      ) : null}
      <div className="form-grid compact">
        <NumberInput
          label="章节序号"
          min={1}
          value={selected.order}
          onChange={(order) => onUpdateChapter({ order: order ?? selected.order })}
          hint="若目标章序已存在，将与对应章节交换位置。"
        />
        <TextInput
          label="章节标题"
          value={selected.title}
          debounceMs={400}
          bufferKey={selected.id}
          onChange={(title) => onUpdateChapter({ title })}
        />
      </div>
      <AiRewriteTextArea
        label="正文稿纸"
        value={bodyDraft}
        rows={24}
        className="manuscript-textarea"
        getAiService={getAiService}
        context={aiRewriteContext}
        scopeKey={selected.id}
        rewriteTarget={{ projectId: selected.projectId, kind: 'chapter', targetId: selected.id }}
        disabled={loadingAction !== null}
        onStatusChange={onAiRewriteStatus}
        onBlur={onBodyBlur}
        onChange={onBodyChange}
        onApplyRewrite={onApplyRewrite}
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
          {showVersionHistory ? '收起版本历史' : '版本历史'}
        </button>
        <button className="ghost-button" onClick={onToggleReviewPanel}>
          {showReviewPanel ? '收起本章复盘' : `本章复盘 (${reviewFilledCount}/${reviewFieldCount})`}
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
        <button className="danger-button" onClick={onArchiveChapter}>
          归档章节
        </button>
      </div>
      {loadingAction ? <p className="muted">正在生成草稿...</p> : null}
      {aiMessage ? <div className="notice">{aiMessage}</div> : null}
      {showVersionHistory ? versionHistory : null}
    </div>
  )
}

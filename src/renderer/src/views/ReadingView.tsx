import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import type { AppData, Chapter, ID, Project } from '../../../shared/types'
import { ExportService } from '../../../services/ExportService'
import { AiRewriteMenuPortal } from '../components/AiRewriteMenuPortal'
import { useQuickRewriteDraftStore } from '../components/QuickRewriteDraftProvider'
import { clearAppliedQuickRewriteDraft } from '../components/quickRewriteDraftAdapter'
import { useConfirm } from '../components/ConfirmDialog'
import { EmptyState } from '../components/FormFields'
import { Header } from '../components/Layout'
import { getNovelDirectorClipboardApi } from '../platform/novelDirectorBridge'
import { useProjectData } from '../hooks/useProjectData'
import type { SaveDataHandler } from '../utils/saveDataState'
import { ReaderChapterRail } from './reading/ReaderChapterRail'
import { ReaderChapterArticle } from './reading/ReaderChapterArticle'
import { ReaderHeaderActions } from './reading/ReaderHeaderActions'
import { ReaderRewriteResult } from './reading/ReaderRewriteResult'
import { buildReaderChapterContext } from './reading/readerContext'
import { readerTextRangeFromSelection, splitReaderBody } from './reading/readerText'
import type { ReaderRewriteUndo, ReaderSelection } from './reading/readerTypes'
import { useReaderNavigation } from './reading/useReaderNavigation'
import type { ReaderPosition } from './reading/readerPosition'
import { useReaderAiRewrite } from './reading/useReaderAiRewrite'
import { useReaderRevisionCommit, type SaveReaderRevisionCommitBundle } from './reading/useReaderRevisionCommit'

interface ReadingViewProps {
  data: AppData
  project: Project
  saveData: SaveDataHandler
  saveRevisionCommitBundle?: SaveReaderRevisionCommitBundle
  initialChapterId?: ID | null
  onBackToChapters?: (chapterId?: ID | null) => void
}

export function ReadingView({
  data,
  project,
  saveData,
  saveRevisionCommitBundle,
  initialChapterId,
  onBackToChapters
}: ReadingViewProps) {
  const confirmAction = useConfirm()
  const scoped = useProjectData(data, project.id)
  const chapters = useMemo(() => [...scoped.chapters].sort((a, b) => a.order - b.order), [scoped.chapters])
  const getAiService = useCallback(async () => {
    const { AIService } = await import('../../../services/AIService')
    return new AIService(data.settings)
  }, [data.settings])
  const [selection, setSelection] = useState<ReaderSelection | null>(null)
  const [customInstruction, setCustomInstruction] = useState('')
  const [message, setMessage] = useState('')
  const [fontSize, setFontSize] = useState(18)
  const [showSummaries, setShowSummaries] = useState(false)
  const [editingChapterId, setEditingChapterId] = useState<ID | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const editBaseline = useRef('')
  const editingPosition = useRef<ReaderPosition | null>(null)
  const pendingPosition = useRef<ReaderPosition | null>(null)
  const savingInline = useRef(false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastRewrite, setLastRewrite] = useState<ReaderRewriteUndo | null>(null)
  const quickDraftStore = useQuickRewriteDraftStore()
  const { activeChapterId, readerScrollRef, jumpToChapter, capturePosition, restorePosition, flushReaderPosition } = useReaderNavigation(chapters, initialChapterId, { projectId: project.id })
  const preserveBeforeApply = useCallback(() => { pendingPosition.current = capturePosition() }, [capturePosition])
  useLayoutEffect(() => {
    if (editingChapterId || !pendingPosition.current) return
    restorePosition(pendingPosition.current)
    pendingPosition.current = null
  }, [chapters, editingChapterId, restorePosition])
  const commitChapterBody = useReaderRevisionCommit({
    projectId: project.id,
    saveData,
    saveRevisionCommitBundle
  })
  const clearRewriteSelection = useCallback(() => setSelection(null), [])
  const readerRewrite = useReaderAiRewrite({
    initialChapterId: initialChapterId ?? activeChapterId,
    chapters,
    project,
    selection,
    customInstruction,
    getAiService,
    commitChapterBody,
    clearSelection: clearRewriteSelection,
    setMessage,
    setLastRewrite,
    beforeApply: preserveBeforeApply
  })

  function openRewriteMenu(event: MouseEvent<HTMLElement>, chapter: Chapter) {
    const browserSelection = window.getSelection()
    const selectedText = browserSelection?.toString() ?? ''
    if (!selectedText.trim() || !browserSelection || browserSelection.rangeCount === 0) return
    const range = browserSelection.getRangeAt(0)
    if (!event.currentTarget.contains(range.commonAncestorContainer)) return
    event.preventDefault()

    const textRange = readerTextRangeFromSelection(range, chapter.body, selectedText)
    if (!textRange) return
    readerRewrite.selectChapter(chapter.id)
    setSelection({ chapterId: chapter.id, ...textRange, x: event.clientX, y: event.clientY })
  }

  function hasUnsavedInlineEdit(): boolean {
    if (!editingChapterId) return false
    return editDraft !== editBaseline.current
  }

  async function confirmDiscardInlineEdit(): Promise<boolean> {
    if (!hasUnsavedInlineEdit()) return true
    return confirmAction({
      title: '放弃未保存修改',
      message: '当前阅读页编辑器还有未保存的正文。继续操作会放弃这些临时修改；已保存正文不会受影响。',
      confirmLabel: '放弃修改',
      tone: 'danger'
    })
  }

  async function startEditing(chapter: Chapter) {
    if (savingInline.current || editingChapterId === chapter.id) return
    if (editingChapterId !== chapter.id && !(await confirmDiscardInlineEdit())) return
    editingPosition.current = capturePosition()
    editBaseline.current = chapter.body
    setEditingChapterId(chapter.id)
    setEditDraft(chapter.body)
  }

  async function cancelInlineEdit() {
    if (savingInline.current) return
    if (!(await confirmDiscardInlineEdit())) return
    pendingPosition.current = editingPosition.current
    setEditingChapterId(null)
    setEditDraft('')
  }

  async function backToChapters(chapterId: ID | null) {
    if (savingInline.current) return
    if (!(await confirmDiscardInlineEdit())) return
    flushReaderPosition()
    onBackToChapters?.(chapterId)
  }

  async function saveInlineEdit() {
    if (!editingChapterId || savingInline.current) return
    const chapter = chapters.find((item) => item.id === editingChapterId)
    if (!chapter) return
    if (chapter.body === editDraft) {
      setMessage('正文没有变化。')
      pendingPosition.current = editingPosition.current
      setEditingChapterId(null)
      setEditDraft('')
      return
    }
    savingInline.current = true
    setIsSaving(true)
    try {
      const saved = await commitChapterBody({
        chapterId: editingChapterId,
        expectedBeforeBody: editBaseline.current,
        body: editDraft,
        revisedBy: 'user',
        revisionReason: '阅读页手动编辑',
        revisionNote: '在连贯阅读页明确保存正文修改。'
      })
      if (!saved.ok) {
        setMessage(`正文保存失败：${saved.errorMessage}`)
        return
      }
      clearAppliedQuickRewriteDraft(quickDraftStore, { projectId: project.id, kind: 'reader_edit', targetId: editingChapterId }, editDraft)
      setMessage('已保存本章正文。')
      pendingPosition.current = editingPosition.current
      setEditingChapterId(null)
      setEditDraft('')
    } catch (error) {
      setMessage(`正文保存失败：${error instanceof Error ? error.message : String(error)}；编辑内容仍保留。`)
    } finally { savingInline.current = false; setIsSaving(false) }
  }

  async function undoLastRewrite() {
    if (!lastRewrite) return
    const chapter = chapters.find((item) => item.id === lastRewrite.chapterId)
    if (!chapter || chapter.body !== lastRewrite.afterBody) {
      setLastRewrite(null)
      setMessage('正文已经发生其他修改，未执行快速撤销；可在章节版本历史中检查已有版本。')
      return
    }
    preserveBeforeApply()
    const saved = await commitChapterBody({
      chapterId: chapter.id,
      expectedBeforeBody: lastRewrite.afterBody,
      body: lastRewrite.beforeBody,
      revisedBy: 'user',
      revisionReason: `撤销阅读页 AI 重写：${lastRewrite.label}`,
      revisionNote: `恢复到应用“${lastRewrite.label}”之前的正文。`
    })
    if (!saved.ok) {
      setMessage(`撤销失败：${saved.errorMessage}`)
      return
    }
    setMessage(`已撤销：${lastRewrite.label}`)
    setLastRewrite(null)
  }

  async function copyAllChapters() {
    if (!chapters.length) return
    const content = ExportService.formatAllChaptersAsText(chapters)
    await getNovelDirectorClipboardApi().writeText(content)
    setMessage('已复制全书正文。')
  }

  const menu = selection ? (
    <AiRewriteMenuPortal
      anchor={selection}
      selectionLength={selection.text.trim().length}
      busyActionId={readerRewrite.busyActionId}
      activeCall={readerRewrite.activeCall}
      customInstruction={customInstruction}
      hint="返回候选后可对比、编辑和应用。"
      onCustomInstructionChange={setCustomInstruction}
      onAction={(action) => void readerRewrite.run(action)}
      onCancel={readerRewrite.cancel}
      onDismiss={() => {
        if (!readerRewrite.busyActionId) setSelection(null)
      }}
    />
  ) : null

  return (
    <div className="reading-view">
      <Header
        title="连贯阅读"
        actions={
          <ReaderHeaderActions
            showSummaries={showSummaries}
            onToggleSummaries={() => setShowSummaries((value) => !value)}
            onDecreaseFont={() => setFontSize((value) => Math.max(15, value - 1))}
            onIncreaseFont={() => setFontSize((value) => Math.min(24, value + 1))}
            onCopyAll={() => void copyAllChapters()} onBackToChapters={() => void backToChapters(activeChapterId)}
          />
        }
      />

      {message || lastRewrite ? (
        <div className="reader-message" role="status">
          <span>{message || `已应用：${lastRewrite?.label}`}</span>
          {lastRewrite ? (
            <button className="ghost-button" type="button" onClick={() => void undoLastRewrite()}>
              撤销刚才重写
            </button>
          ) : null}
        </div>
      ) : null}

      {!chapters.length ? (
        <EmptyState title="暂无可阅读章节" description="创建章节或导入旧项目后，可以在这里连续阅读整部小说。" />
      ) : (
        <section className="reader-continuous-shell">
          <main className="reader-main reader-continuous-main" style={{ '--reader-font-size': `${fontSize}px` } as CSSProperties}>
            <div className="reader-continuous-scroll" ref={readerScrollRef}>
              {chapters.map((chapter) => {
                const segments = splitReaderBody(chapter.body)
                const isEditing = editingChapterId === chapter.id
                return (
                  <ReaderChapterArticle
                    key={chapter.id}
                    chapter={chapter}
                    segments={segments}
                    showSummary={showSummaries}
                    isEditing={isEditing}
                    isSaving={isSaving}
                    editDraft={isEditing ? editDraft : chapter.body}
                    getAiService={getAiService}
                    rewriteContext={() => buildReaderChapterContext(project, chapter, chapters)}
                    onStatusChange={setMessage}
                    onOpenRewriteMenu={(event) => openRewriteMenu(event, chapter)}
                    onStartEditing={() => void startEditing(chapter)}
                    onBackToChapter={() => void backToChapters(chapter.id)}
                    onEditDraftChange={setEditDraft}
                    onCancelEditing={() => void cancelInlineEdit()}
                    onSaveEditing={() => void saveInlineEdit()}
                  />
                )
              })}
            </div>
          </main>

          <ReaderChapterRail chapters={chapters} activeChapterId={activeChapterId} onJump={(id) => { readerRewrite.selectChapter(id); jumpToChapter(id) }} />
        </section>
      )}
      {menu}
      <ReaderRewriteResult rewrite={readerRewrite} chapters={chapters} onMessage={setMessage} clearSelection={clearRewriteSelection} />
    </div>
  )
}

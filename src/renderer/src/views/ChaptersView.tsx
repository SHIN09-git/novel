import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppData,
  Chapter,
  ID,
  Project,
  RevisionCommitBundle
} from '../../../shared/types'
import {
  archiveChapterInAppData,
  nextChapterOrder,
  reorderChapterInAppData,
  restoreArchivedChapterInAppData
} from '../../../services/ChapterLifecycleService'
import { useConfirm } from '../components/ConfirmDialog'
import { EmptyState } from '../components/FormFields'
import { Header } from '../components/Layout'
import { useProjectData } from '../hooks/useProjectData'
import { newId, now } from '../utils/format'
import type { SaveDataHandler } from '../utils/saveDataState'
import { ChapterEditorPanel } from './chapters/ChapterEditorPanel'
import { ChapterListPanel } from './chapters/ChapterListPanel'
import { buildChapterAiContext } from './chapters/chapterAiContext'
import { reviewFields, type ReviewTextField } from './chapters/chapterViewTypes'
import { useChapterAiDrafts } from './chapters/useChapterAiDrafts'
import { useChapterBodyDraft } from './chapters/useChapterBodyDraft'
import { useChapterCharacterActions } from './chapters/useChapterCharacterActions'
import { formatNextSuggestionsAsRiskText, useChapterContinuityActions } from './chapters/useChapterContinuityActions'
import { useChapterExportActions } from './chapters/useChapterExportActions'
import { useChapterForeshadowingActions } from './chapters/useChapterForeshadowingActions'
import { useChapterVersionActions } from './chapters/useChapterVersionActions'
import { updateProjectTimestamp } from './viewTypes'

const ChapterAIDraftPanels = lazy(() =>
  import('./chapters/ChapterAIDraftPanels').then((module) => ({ default: module.ChapterAIDraftPanels }))
)
const ChapterReviewPanel = lazy(() =>
  import('./chapters/ChapterReviewPanel').then((module) => ({ default: module.ChapterReviewPanel }))
)
const ChapterVersionHistoryPanel = lazy(() =>
  import('./chapters/ChapterVersionHistoryPanel').then((module) => ({ default: module.ChapterVersionHistoryPanel }))
)

function ChapterPanelLoading({ label }: { label: string }) {
  return (
    <div className="panel">
      <p className="muted">正在加载{label}...</p>
    </div>
  )
}

interface ProjectProps {
  data: AppData
  project: Project
  saveData: SaveDataHandler
  saveRevisionCommitBundle?: (buildCommit: (currentData: AppData) => { next: AppData; bundle: RevisionCommitBundle }) => Promise<void>
  initialChapterId?: ID | null
  onInitialChapterConsumed?: () => void
  onOpenReader?: (chapterId?: ID | null) => void
}

export function ChaptersView({
  data,
  project,
  saveData,
  saveRevisionCommitBundle,
  initialChapterId,
  onInitialChapterConsumed,
  onOpenReader
}: ProjectProps) {
  const confirmAction = useConfirm()
  const scoped = useProjectData(data, project.id)
  const chapters = useMemo(() => [...scoped.chapters].sort((a, b) => a.order - b.order), [scoped.chapters])
  const chapterListItems = useMemo(() => [...chapters].sort((a, b) => b.order - a.order), [chapters])
  const archivedChapterListItems = useMemo(
    () => [...scoped.archivedChapters].sort((a, b) => b.order - a.order),
    [scoped.archivedChapters]
  )
  const defaultSelectedChapter = chapterListItems[0] ?? null
  const [selectedId, setSelectedId] = useState<ID | null>(defaultSelectedChapter?.id ?? null)
  const selected = chapters.find((chapter) => chapter.id === selectedId) ?? defaultSelectedChapter
  const selectedBridge = selected
    ? scoped.chapterContinuityBridges.find((bridge) => bridge.fromChapterId === selected.id && bridge.toChapterOrder === selected.order + 1) ?? null
    : null
  const [aiMessage, setAiMessage] = useState('')
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [showReviewPanel, setShowReviewPanel] = useState(false)
  const pendingSelectionMessage = useRef('')
  const bodyEditor = useChapterBodyDraft({ selected, projectId: project.id, saveData, onStatusMessage: setAiMessage })
  const {
    bodyDraft,
    saveStatus: bodySaveStatus,
    conflict: bodyConflict,
    updateBodyDraft,
    flushBody,
    useExternalBody,
    keepLocalBody,
    replaceWithPersistedBody
  } = bodyEditor
  const chapterAi = useChapterAiDrafts({
    settings: data.settings,
    selected,
    characters: scoped.characters,
    foreshadowings: scoped.foreshadowings,
    chapterText: () => (selected ? bodyDraft : ''),
    chapterContext: buildChapterContext,
    flushBody,
    setMessage: setAiMessage
  })

  useEffect(() => {
    if (initialChapterId && chapters.some((chapter) => chapter.id === initialChapterId)) {
      setSelectedId(initialChapterId)
      onInitialChapterConsumed?.()
      return
    }
    if (!selectedId && defaultSelectedChapter) {
      setSelectedId(defaultSelectedChapter.id)
      return
    }
    if (selectedId && !chapters.some((chapter) => chapter.id === selectedId)) {
      setSelectedId(defaultSelectedChapter?.id ?? null)
    }
  }, [chapters, defaultSelectedChapter, initialChapterId, onInitialChapterConsumed, selectedId])

  useEffect(() => {
    setShowVersionHistory(false)
    setShowReviewPanel(false)
    setAiMessage(pendingSelectionMessage.current)
    pendingSelectionMessage.current = ''
  }, [selected?.id])

  function buildChapterContext(): string {
    return buildChapterAiContext({
      project,
      bible: scoped.bible,
      chapters: scoped.chapters,
      characters: scoped.characters,
      foreshadowings: scoped.foreshadowings,
      selectedChapter: selected
    })
  }

  async function addChapter() {
    if (!(await flushBody())) return
    const timestamp = now()
    const order = nextChapterOrder(scoped.allChapters, project.id)
    const chapter: Chapter = {
      id: newId(),
      projectId: project.id,
      order,
      title: `第 ${order} 章`,
      body: '',
      summary: '',
      newInformation: '',
      characterChanges: '',
      newForeshadowing: '',
      resolvedForeshadowing: '',
      endingHook: '',
      riskWarnings: '',
      includedInStageSummary: false,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    const saved = await saveData((current) => {
      const nextOrder = nextChapterOrder(current.chapters, project.id)
      return {
        ...current,
        projects: updateProjectTimestamp(current, project.id),
        chapters: current.chapters.some((item) => item.id === chapter.id)
          ? current.chapters
          : [...current.chapters, { ...chapter, order: nextOrder, title: `第 ${nextOrder} 章` }]
      }
    })
    if (!saved.ok) return
    setSelectedId(chapter.id)
  }

  async function updateChapter(id: ID, patch: Partial<Chapter>) {
    if (typeof patch.order === 'number') {
      return saveData((current) => reorderChapterInAppData(current, id, patch.order as number, now()))
    }
    return saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      chapters: current.chapters.map((chapter) => (chapter.id === id ? { ...chapter, ...patch, updatedAt: now() } : chapter))
    }))
  }

  async function archiveChapter(id: ID) {
    const confirmed = await confirmAction({
      title: '归档章节',
      message: '归档后，本章不会进入阅读、Prompt 或后续生成，但正文、版本链、提交和审稿记录都会保留，可随时恢复。',
      confirmLabel: '归档章节',
      tone: 'danger'
    })
    if (!confirmed) return
    if (!(await flushBody())) return
    const saved = await saveData((current) => {
      return archiveChapterInAppData(current, id, now())
    })
    if (!saved.ok) return
    pendingSelectionMessage.current = '章节已归档，正文和完整版本链仍然保留。'
    setSelectedId(null)
  }

  async function restoreArchivedChapter(chapter: Chapter) {
    let orderChanged = false
    const saved = await saveData((current) => {
      const restored = restoreArchivedChapterInAppData(current, chapter.id, now())
      orderChanged = restored.orderChanged
      return restored.data
    })
    if (!saved.ok) return
    pendingSelectionMessage.current = orderChanged ? '章节已恢复；原章序已被占用，因此移动到当前末尾。' : '章节已恢复。'
    setSelectedId(chapter.id)
  }

  async function applyReviewTemplate(chapter: Chapter) {
    await updateChapter(chapter.id, {
      summary: chapter.summary || '本章剧情摘要：\n- ',
      newInformation: chapter.newInformation || '本章新增信息：\n- ',
      characterChanges: chapter.characterChanges || '本章角色变化：\n- ',
      newForeshadowing: chapter.newForeshadowing || '本章新增伏笔：\n- ',
      resolvedForeshadowing: chapter.resolvedForeshadowing || '本章已回收伏笔：\n- ',
      endingHook: chapter.endingHook || '本章结尾钩子：\n- ',
      riskWarnings: chapter.riskWarnings || '本章风险提醒：\n- '
    })
  }

  async function applyReviewField(field: ReviewTextField) {
    if (!selected || !chapterAi.reviewDraft) return
    const result = await updateChapter(selected.id, { [field]: chapterAi.reviewDraft[field] } as Partial<Chapter>)
    if (!result.ok) setAiMessage(`应用复盘字段失败：${result.errorMessage}`)
  }

  async function applyAllReviewDraft() {
    if (!selected || !chapterAi.reviewDraft) return
    const { continuityBridgeSuggestion, characterStateChangeSuggestions: _stateSuggestions, ...chapterReview } = chapterAi.reviewDraft
    const result = await updateChapter(selected.id, chapterReview)
    if (!result.ok) {
      setAiMessage(`应用章节复盘失败：${result.errorMessage}`)
      return
    }
    if (continuityBridgeSuggestion) await saveContinuityBridge(continuityBridgeSuggestion)
  }

  const { saveContinuityBridge, updateContinuityBridgeField } = useChapterContinuityActions({
    selected,
    selectedBridge,
    project,
    saveData,
    setAiMessage
  })
  const { copyChapterBody, exportCurrentChapter, exportAllChapters } = useChapterExportActions({
    chapters,
    selected,
    bodyDraft,
    project,
    flushBody,
    setAiMessage
  })
  const { applyCharacterSuggestion, createStateChangeCandidate } = useChapterCharacterActions({
    selected,
    project,
    characters: scoped.characters,
    characterStateFacts: scoped.characterStateFacts,
    saveData,
    setCharacterSuggestions: chapterAi.setCharacterSuggestions,
    setAiMessage
  })
  const { applyForeshadowingCandidate, applyStatusChange } = useChapterForeshadowingActions({
    selected,
    project,
    saveData
  })
  const { copyChapterVersionEntry, restoreChapterVersionEntry, deleteChapterVersionEntry } = useChapterVersionActions({
    chapters,
    selected,
    bodyDraft,
    project,
    saveData,
    saveRevisionCommitBundle,
    confirmAction,
    flushBody,
    replaceWithPersistedBody,
    setAiMessage
  })
  const bodyCharacterCount = bodyDraft.replace(/\s/g, '').length
  const paragraphCount = bodyDraft.trim() ? bodyDraft.split(/\n+/).filter((line) => line.trim()).length : 0
  const reviewFilledCount = selected
    ? reviewFields.filter((field) => String(selected[field.key] ?? '').trim()).length
    : 0
  const chapterStatus = selected?.includedInStageSummary
    ? '已归入阶段摘要'
    : bodyCharacterCount > 0
      ? '写作中'
      : '未开始'

  async function openReader() {
    if (!(await flushBody())) return
    onOpenReader?.(selected?.id ?? null)
  }

  async function confirmKeepLocalBody() {
    const confirmed = await confirmAction({
      title: '覆盖外部正文',
      message: '这会用当前编辑区内容覆盖其他流程刚保存的正文。请确认你已经理解两份内容的差异；版本历史中的正式提交不会被删除。',
      confirmLabel: '保留本地并覆盖',
      tone: 'danger'
    })
    if (confirmed) await keepLocalBody()
  }

  return (
    <div className="chapters-view">
      <Header
        title="章节创作台"
        description="左侧管理章节脉络，中间沉浸写作，右侧沉淀可进入长期记忆的复盘信息。"
        actions={
          <>
            <button className="ghost-button" onClick={() => void openReader()}>连贯阅读</button>
            <button className="ghost-button" onClick={() => exportAllChapters('txt')}>导出全部 TXT</button>
            <button className="ghost-button" onClick={() => exportAllChapters('md')}>导出全部 MD</button>
            <button className="primary-button" onClick={addChapter}>新增章节</button>
          </>
        }
      />
      <section className="split-layout chapter-workbench">
        <ChapterListPanel
          chapters={chapterListItems}
          archivedChapters={archivedChapterListItems}
          selectedChapterId={selected?.id ?? null}
          activeBodyCharacterCount={bodyCharacterCount}
          onSelectChapter={(chapter) => {
            void flushBody().then((saved) => {
              if (saved) setSelectedId(chapter.id)
            })
          }}
          onRestoreChapter={(chapter) => {
            void restoreArchivedChapter(chapter)
          }}
        />
        <div className={`editor-pane${showReviewPanel ? ' with-review-panel' : ''}`}>
          {!selected ? (
            <EmptyState title="暂无章节" description="创建章节后，可以在这里写正文并填写复盘字段。" />
          ) : (
            <>
              <ChapterEditorPanel
                selected={selected}
                bodyDraft={bodyDraft}
                bodyCharacterCount={bodyCharacterCount}
                paragraphCount={paragraphCount}
                reviewFilledCount={reviewFilledCount}
                reviewFieldCount={reviewFields.length}
                chapterStatus={chapterStatus}
                bodySaveStatus={bodySaveStatus}
                hasBodyConflict={Boolean(bodyConflict)}
                loadingAction={chapterAi.loadingAction}
                aiMessage={aiMessage}
                getAiService={chapterAi.getAiService}
                aiRewriteContext={buildChapterContext}
                onAiRewriteStatus={setAiMessage}
                showVersionHistory={showVersionHistory}
                showReviewPanel={showReviewPanel}
                versionHistory={
                  <Suspense fallback={<ChapterPanelLoading label="版本历史" />}>
                    <ChapterVersionHistoryPanel
                      key={selected.id}
                      data={data}
                      selected={selected}
                      onCopyVersion={copyChapterVersionEntry}
                      onRestoreVersion={restoreChapterVersionEntry}
                      onDeleteVersion={deleteChapterVersionEntry}
                    />
                  </Suspense>
                }
                onUpdateChapter={(patch) => updateChapter(selected.id, patch)}
                onBodyChange={updateBodyDraft}
                onApplyRewrite={async (body) => { updateBodyDraft(body); return flushBody() }}
                onBodyBlur={() => {
                  void flushBody()
                }}
                onCopyBody={() => {
                  void copyChapterBody(false)
                }}
                onCopyWithTitle={() => {
                  void copyChapterBody(true)
                }}
                onExportTxt={() => {
                  void exportCurrentChapter('txt')
                }}
                onExportMarkdown={() => {
                  void exportCurrentChapter('md')
                }}
                onToggleVersionHistory={() => setShowVersionHistory((value) => !value)}
                onToggleReviewPanel={() => setShowReviewPanel((value) => !value)}
                onApplyReviewTemplate={() => {
                  void applyReviewTemplate(selected)
                }}
                onGenerateReview={() => void chapterAi.actions.generateReview()}
                onExtractCharacters={() => void chapterAi.actions.extractCharacters()}
                onExtractForeshadowing={() => void chapterAi.actions.extractForeshadowing()}
                onGenerateNextRisk={() => void chapterAi.actions.generateNextRisk()}
                onArchiveChapter={() => {
                  void archiveChapter(selected.id)
                }}
                onUseExternalBody={useExternalBody}
                onKeepLocalBody={() => void confirmKeepLocalBody()}
              />

              {chapterAi.hasOutput ? (
                <Suspense fallback={<ChapterPanelLoading label="AI 草稿" />}>
                  <ChapterAIDraftPanels
                    selectedOrder={selected.order}
                    rawAIText={chapterAi.rawAIText}
                    reviewDraft={chapterAi.reviewDraft}
                    reviewFields={reviewFields}
                    characters={scoped.characters}
                    characterSuggestions={chapterAi.characterSuggestions}
                    foreshadowings={scoped.foreshadowings}
                    foreshadowingDraft={chapterAi.foreshadowingDraft}
                    nextSuggestions={chapterAi.nextSuggestions}
                    onSetReviewDraft={chapterAi.setReviewDraft}
                    onApplyAllReviewDraft={applyAllReviewDraft}
                    onApplyReviewField={applyReviewField}
                    onSaveContinuityBridge={(suggestion) => {
                      void saveContinuityBridge(suggestion)
                    }}
                    onApplyCharacterSuggestion={(suggestion) => {
                      void applyCharacterSuggestion(suggestion)
                    }}
                    onCreateStateChangeCandidate={(suggestion) => {
                      void createStateChangeCandidate(suggestion)
                    }}
                    onApplyForeshadowingCandidate={(candidate, status) => {
                      void applyForeshadowingCandidate(candidate, status)
                    }}
                    onApplyStatusChange={(change) => {
                      void applyStatusChange(change)
                    }}
                    onSetNextSuggestions={chapterAi.setNextSuggestions}
                    onApplyNextSuggestions={() => {
                      void updateChapter(selected.id, {
                        riskWarnings: chapterAi.nextSuggestions ? formatNextSuggestionsAsRiskText(chapterAi.nextSuggestions) : ''
                      })
                    }}
                  />
                </Suspense>
              ) : null}

              {showReviewPanel ? (
                <Suspense fallback={<ChapterPanelLoading label="本章复盘" />}>
                  <ChapterReviewPanel
                    selected={selected}
                    selectedBridge={selectedBridge}
                    reviewFields={reviewFields}
                    onUpdateChapter={(patch) => {
                      void updateChapter(selected.id, patch)
                    }}
                    onUpdateContinuityBridgeField={(field, value) => {
                      void updateContinuityBridgeField(field, value)
                    }}
                  />
                </Suspense>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  )
}

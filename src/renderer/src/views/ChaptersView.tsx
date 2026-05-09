import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AIResult,
  AppData,
  Chapter,
  ChapterContinuityBridge,
  ChapterContinuityBridgeSuggestion,
  ChapterReviewDraft,
  ChapterVersion,
  CharacterStateChangeCandidate,
  CharacterStateChangeSuggestion,
  CharacterStateFact,
  CharacterStateTransaction,
  CharacterStateLog,
  CharacterStateSuggestion,
  Foreshadowing,
  ForeshadowingCandidate,
  ForeshadowingExtractionResult,
  ForeshadowingStatus,
  ForeshadowingStatusChangeSuggestion,
  ID,
  NextChapterSuggestions,
  Project
} from '../../../shared/types'
import { AIService } from '../../../services/AIService'
import { normalizeTreatmentMode } from '../../../shared/foreshadowingTreatment'
import { ExportService } from '../../../services/ExportService'
import { useConfirm } from '../components/ConfirmDialog'
import { EmptyState } from '../components/FormFields'
import { Header } from '../components/Layout'
import { projectData } from '../utils/projectData'
import { formatDate, newId, now } from '../utils/format'
import type { SaveDataInput } from '../utils/saveDataState'
import { ChapterAIDraftPanels } from './chapters/ChapterAIDraftPanels'
import { ChapterEditorPanel } from './chapters/ChapterEditorPanel'
import { ChapterListPanel } from './chapters/ChapterListPanel'
import { ChapterReviewPanel } from './chapters/ChapterReviewPanel'
import { ChapterVersionHistoryPanel } from './chapters/ChapterVersionHistoryPanel'
import { reviewFields, type ReviewTextField } from './chapters/chapterViewTypes'

interface ProjectProps {
  data: AppData
  project: Project
  saveData: (next: SaveDataInput) => Promise<void>
}

function updateProjectTimestamp(data: AppData, projectId: ID): Project[] {
  return data.projects.map((project) => (project.id === projectId ? { ...project, updatedAt: now() } : project))
}

const emptyBridgeSuggestion: ChapterContinuityBridgeSuggestion = {
  lastSceneLocation: '',
  lastPhysicalState: '',
  lastEmotionalState: '',
  lastUnresolvedAction: '',
  lastDialogueOrThought: '',
  immediateNextBeat: '',
  mustContinueFrom: '',
  mustNotReset: '',
  openMicroTensions: ''
}

export function ChaptersView({ data, project, saveData }: ProjectProps) {
  const confirmAction = useConfirm()
  const scoped = projectData(data, project.id)
  const chapters = [...scoped.chapters].sort((a, b) => a.order - b.order)
  const [selectedId, setSelectedId] = useState<ID | null>(chapters[0]?.id ?? null)
  const selected = chapters.find((chapter) => chapter.id === selectedId) ?? chapters[0] ?? null
  const selectedBridge = selected
    ? scoped.chapterContinuityBridges.find((bridge) => bridge.fromChapterId === selected.id && bridge.toChapterOrder === selected.order + 1) ?? null
    : null
  const [bodyDraft, setBodyDraft] = useState(selected?.body ?? '')
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [aiMessage, setAiMessage] = useState('')
  const [rawAIText, setRawAIText] = useState('')
  const [reviewDraft, setReviewDraft] = useState<ChapterReviewDraft | null>(null)
  const [characterSuggestions, setCharacterSuggestions] = useState<CharacterStateSuggestion[]>([])
  const [foreshadowingDraft, setForeshadowingDraft] = useState<ForeshadowingExtractionResult | null>(null)
  const [nextSuggestions, setNextSuggestions] = useState<NextChapterSuggestions | null>(null)
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const bodySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const aiService = useMemo(() => new AIService(data.settings), [data.settings])

  useEffect(() => {
    if (!selectedId && chapters[0]) setSelectedId(chapters[0].id)
  }, [chapters, selectedId])

  useEffect(() => {
    setBodyDraft(selected?.body ?? '')
    setReviewDraft(null)
    setCharacterSuggestions([])
    setForeshadowingDraft(null)
    setNextSuggestions(null)
    setRawAIText('')
    setAiMessage('')
  }, [selected?.id])

  useEffect(() => {
    return () => {
      if (bodySaveTimer.current) clearTimeout(bodySaveTimer.current)
    }
  }, [])

  function buildChapterContext(): string {
    const bible = scoped.bible
    const recentChapters = [...scoped.chapters]
      .filter((chapter) => !selected || chapter.order < selected.order)
      .sort((a, b) => b.order - a.order)
      .slice(0, 3)
      .map((chapter) => `第 ${chapter.order} 章《${chapter.title || '未命名'}》：${chapter.summary || '暂无摘要'}`)
      .join('\n')

    return [
      `项目：${project.name}`,
      `简介：${project.description || '暂无'}`,
      `题材：${project.genre || '暂无'}`,
      `核心爽点：${project.coreAppeal || '暂无'}`,
      `主线冲突：${bible?.mainConflict || '暂无'}`,
      `重要不可违背设定：${bible?.immutableFacts || '暂无'}`,
      `主要角色：${scoped.characters.filter((character) => character.isMain).map((character) => character.name).join('、') || '暂无'}`,
      `未回收伏笔：${scoped.foreshadowings.filter((item) => item.status !== 'resolved' && item.status !== 'abandoned').map((item) => item.title).join('、') || '暂无'}`,
      `最近章节摘要：\n${recentChapters || '暂无'}`
    ].join('\n')
  }

  function chapterText(): string {
    return bodyDraft || selected?.body || ''
  }

  function handleAIResult<T>(result: AIResult<T>, onData: (data: T) => void) {
    setRawAIText(result.rawText ?? '')
    if (result.data) onData(result.data)
    if (result.parseError) {
      setAiMessage(`解析失败，可手动复制。${result.parseError}`)
      return
    }
    setAiMessage(result.error || (result.usedAI ? 'AI 草稿已生成，请预览后再应用。' : '未配置 API Key，已生成本地结构化模板。'))
  }

  async function addChapter() {
    const timestamp = now()
    const order = Math.max(0, ...chapters.map((chapter) => chapter.order)) + 1
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
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await saveData((current) => {
      const nextOrder = Math.max(0, ...current.chapters.filter((item) => item.projectId === project.id).map((item) => item.order)) + 1
      return {
        ...current,
        projects: updateProjectTimestamp(current, project.id),
        chapters: current.chapters.some((item) => item.id === chapter.id)
          ? current.chapters
          : [...current.chapters, { ...chapter, order: nextOrder, title: `第 ${nextOrder} 章` }]
      }
    })
    setSelectedId(chapter.id)
  }

  async function updateChapter(id: ID, patch: Partial<Chapter>) {
    await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      chapters: current.chapters.map((chapter) => (chapter.id === id ? { ...chapter, ...patch, updatedAt: now() } : chapter))
    }))
  }

  function updateBodyDebounced(id: ID, body: string) {
    setBodyDraft(body)
    if (bodySaveTimer.current) clearTimeout(bodySaveTimer.current)
    bodySaveTimer.current = setTimeout(() => {
      void updateChapter(id, { body })
    }, 500)
  }

  async function flushBody() {
    if (selected && bodyDraft !== selected.body) {
      if (bodySaveTimer.current) clearTimeout(bodySaveTimer.current)
      await updateChapter(selected.id, { body: bodyDraft })
    }
  }

  async function deleteChapter(id: ID) {
    const confirmed = await confirmAction({
      title: '删除章节',
      message: '确定删除这一章吗？相关草稿、质量报告和修订记录会保留安全兜底，但章节正文会被移除。',
      confirmLabel: '删除章节',
      tone: 'danger'
    })
    if (!confirmed) return
    await saveData((current) => {
      const revisionSessionIds = new Set(current.revisionSessions.filter((session) => session.chapterId === id).map((session) => session.id))
      return {
        ...current,
        projects: updateProjectTimestamp(current, project.id),
        chapters: current.chapters.filter((chapter) => chapter.id !== id),
        chapterContinuityBridges: current.chapterContinuityBridges.filter((bridge) => bridge.fromChapterId !== id),
        characterStateLogs: current.characterStateLogs.map((log) => (log.chapterId === id ? { ...log, chapterId: null } : log)),
        revisionSessions: current.revisionSessions.filter((session) => session.chapterId !== id),
        revisionRequests: current.revisionRequests.filter((request) => !revisionSessionIds.has(request.sessionId)),
        revisionVersions: current.revisionVersions.filter((version) => !revisionSessionIds.has(version.sessionId)),
        chapterVersions: current.chapterVersions.filter((version) => version.chapterId !== id)
      }
    })
    setSelectedId(null)
  }

  async function restoreChapterVersion(version: ChapterVersion) {
    if (!selected) return
    const confirmed = await confirmAction({
      title: '恢复历史版本',
      message: '确定恢复这个历史版本吗？当前正文会先保存为一个新历史版本。',
      confirmLabel: '恢复版本'
    })
    if (!confirmed) return
    const timestamp = now()
    const snapshot: ChapterVersion = {
      id: newId(),
      projectId: project.id,
      chapterId: selected.id,
      source: 'restore_before',
      title: selected.title,
      body: bodyDraft,
      note: `恢复 ${formatDate(version.createdAt)} 版本前自动保存`,
      createdAt: timestamp
    }
    await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      chapters: current.chapters.map((chapter) =>
        chapter.id === selected.id ? { ...chapter, title: version.title, body: version.body, updatedAt: timestamp } : chapter
      ),
      chapterVersions: [snapshot, ...current.chapterVersions]
    }))
    setBodyDraft(version.body)
  }

  async function deleteChapterVersion(version: ChapterVersion) {
    const confirmed = await confirmAction({
      title: '删除历史版本',
      message: '确定删除这个章节历史版本吗？',
      confirmLabel: '删除版本',
      tone: 'danger'
    })
    if (!confirmed) return
    await saveData((current) => ({
      ...current,
      chapterVersions: current.chapterVersions.filter((item) => item.id !== version.id)
    }))
  }

  async function copyChapterVersion(version: ChapterVersion) {
    const base = selected ?? chapters.find((chapter) => chapter.id === version.chapterId)
    if (!base) return
    await window.novelDirector.clipboard.writeText(ExportService.formatChapterAsText({ ...base, title: version.title, body: version.body }))
    setAiMessage('已复制历史版本正文')
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

  async function runAIAction<T>(label: string, action: () => Promise<AIResult<T>>, onData: (data: T) => void) {
    if (!selected) return
    setLoadingAction(label)
    setAiMessage('')
    await flushBody()
    try {
      handleAIResult(await action(), onData)
    } finally {
      setLoadingAction(null)
    }
  }

  async function applyReviewField(field: ReviewTextField) {
    if (!selected || !reviewDraft) return
    await updateChapter(selected.id, { [field]: reviewDraft[field] } as Partial<Chapter>)
  }

  async function applyAllReviewDraft() {
    if (!selected || !reviewDraft) return
    const { continuityBridgeSuggestion, characterStateChangeSuggestions: _stateSuggestions, ...chapterReview } = reviewDraft
    await updateChapter(selected.id, chapterReview)
    if (continuityBridgeSuggestion) await saveContinuityBridge(continuityBridgeSuggestion)
  }

  async function saveContinuityBridge(suggestion: ChapterContinuityBridgeSuggestion) {
    if (!selected) return
    const timestamp = now()
    const existing = selectedBridge
    const bridge: ChapterContinuityBridge = {
      ...(existing ?? {
        id: newId(),
        projectId: project.id,
        fromChapterId: selected.id,
        toChapterOrder: selected.order + 1,
        createdAt: timestamp
      }),
      ...suggestion,
      updatedAt: timestamp
    }
    await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      chapterContinuityBridges: existing
        ? current.chapterContinuityBridges.map((item) => (item.id === existing.id ? bridge : item))
        : [bridge, ...current.chapterContinuityBridges]
    }))
    setAiMessage('已保存下一章衔接状态。')
  }

  async function updateContinuityBridgeField(field: keyof ChapterContinuityBridgeSuggestion, value: string) {
    await saveContinuityBridge({ ...(selectedBridge ?? emptyBridgeSuggestion), [field]: value })
  }

  async function applyCharacterSuggestion(suggestion: CharacterStateSuggestion) {
    if (!selected) return
    const character = scoped.characters.find((item) => item.id === suggestion.characterId)
    if (!character) return
    const timestamp = now()
    const log: CharacterStateLog = {
      id: newId(),
      projectId: project.id,
      characterId: character.id,
      chapterId: selected.id,
      chapterOrder: selected.order,
      note: suggestion.changeSummary,
      createdAt: timestamp
    }
    await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      characters: current.characters.map((item) =>
        item.id === character.id
          ? {
              ...item,
              emotionalState: suggestion.newCurrentEmotionalState || item.emotionalState,
              protagonistRelationship: suggestion.newRelationshipWithProtagonist || item.protagonistRelationship,
              nextActionTendency: suggestion.newNextActionTendency || item.nextActionTendency,
              lastChangedChapter: selected.order,
              updatedAt: timestamp
            }
          : item
      ),
      characterStateLogs: [...current.characterStateLogs, log]
    }))
    setCharacterSuggestions((items) => items.filter((item) => item !== suggestion))
  }

  async function createStateChangeCandidate(suggestion: CharacterStateChangeSuggestion) {
    if (!selected) return
    const character = scoped.characters.find((item) => item.id === suggestion.characterId)
    if (!character) return
    const timestamp = now()
    const existingFact = scoped.characterStateFacts.find(
      (fact) => fact.characterId === suggestion.characterId && fact.key === suggestion.key && fact.status === 'active'
    )
    const proposedFact: CharacterStateFact = {
      id: existingFact?.id ?? newId(),
      projectId: project.id,
      characterId: suggestion.characterId,
      category: suggestion.category,
      key: suggestion.key,
      label: suggestion.label,
      valueType: Array.isArray(suggestion.afterValue) ? 'list' : typeof suggestion.afterValue === 'number' ? 'number' : 'text',
      value: suggestion.afterValue ?? existingFact?.value ?? '',
      unit: existingFact?.unit ?? '',
      linkedCardFields: suggestion.linkedCardFields,
      trackingLevel: suggestion.category === 'relationship' || suggestion.category === 'status' ? 'soft' : 'hard',
      promptPolicy: 'when_relevant',
      status: 'active',
      sourceChapterId: selected.id,
      sourceChapterOrder: selected.order,
      evidence: suggestion.evidence,
      confidence: suggestion.confidence,
      createdAt: existingFact?.createdAt ?? timestamp,
      updatedAt: timestamp
    }
    const proposedTransaction: CharacterStateTransaction = {
      id: newId(),
      projectId: project.id,
      characterId: suggestion.characterId,
      factId: proposedFact.id,
      chapterId: selected.id,
      chapterOrder: selected.order,
      transactionType: suggestion.suggestedTransactionType,
      beforeValue: suggestion.beforeValue ?? existingFact?.value ?? null,
      afterValue: suggestion.afterValue,
      delta: suggestion.delta,
      reason: suggestion.evidence,
      evidence: suggestion.evidence,
      source: 'chapter_review',
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp
    }
    const candidate: CharacterStateChangeCandidate = {
      id: newId(),
      projectId: project.id,
      characterId: suggestion.characterId,
      chapterId: selected.id,
      chapterOrder: selected.order,
      candidateType: suggestion.changeType,
      targetFactId: existingFact?.id ?? null,
      proposedFact,
      proposedTransaction,
      beforeValue: suggestion.beforeValue ?? existingFact?.value ?? null,
      afterValue: suggestion.afterValue,
      evidence: suggestion.evidence,
      confidence: suggestion.confidence,
      riskLevel: suggestion.riskLevel,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      characterStateChangeCandidates: [candidate, ...current.characterStateChangeCandidates]
    }))
    setAiMessage(`已加入 ${character.name} 的状态变化候选。`)
  }

  async function applyForeshadowingCandidate(candidate: ForeshadowingCandidate, status: ForeshadowingStatus = 'unresolved') {
    if (!selected) return
    const timestamp = now()
    const item: Foreshadowing = {
      id: newId(),
      projectId: project.id,
      title: candidate.title,
      firstChapterOrder: candidate.firstChapterOrder ?? selected.order,
      description: candidate.description,
      status,
      weight: candidate.suggestedWeight,
      treatmentMode: normalizeTreatmentMode(candidate.recommendedTreatmentMode, status, candidate.suggestedWeight),
      expectedPayoff: candidate.expectedPayoff,
      payoffMethod: '',
      relatedCharacterIds: candidate.relatedCharacterIds,
      relatedMainPlot: '',
      notes: candidate.notes,
      actualPayoffChapter: null,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      foreshadowings: [...current.foreshadowings, item]
    }))
  }

  async function applyStatusChange(change: ForeshadowingStatusChangeSuggestion) {
    if (!selected) return
    await saveData((current) => ({
      ...current,
      projects: updateProjectTimestamp(current, project.id),
      foreshadowings: current.foreshadowings.map((item) =>
        item.id === change.foreshadowingId
          ? {
              ...item,
              status: change.suggestedStatus,
              actualPayoffChapter: change.suggestedStatus === 'resolved' ? selected.order : item.actualPayoffChapter,
              notes: [item.notes, change.notes || change.evidenceText].filter(Boolean).join('\n'),
              updatedAt: now()
            }
          : item
      )
    }))
  }

  function nextSuggestionsAsRiskText(suggestions: NextChapterSuggestions): string {
    return [
      '下一章风险提醒：',
      `- 下一章目标：${suggestions.nextChapterGoal}`,
      `- 必须推进的冲突：${suggestions.conflictToPush}`,
      `- 必须保留的悬念：${suggestions.suspenseToKeep}`,
      `- 可轻推伏笔：${suggestions.foreshadowingToHint}`,
      `- 不要提前揭示：${suggestions.foreshadowingNotToReveal}`,
      `- 建议结尾钩子：${suggestions.suggestedEndingHook}`,
      `- 读者情绪目标：${suggestions.readerEmotionTarget}`
    ].join('\n')
  }

  function selectedChapterWithDraft(): Chapter | null {
    return selected ? { ...selected, body: bodyDraft } : null
  }

  async function copyChapterBody(includeTitle = false) {
    const chapter = selectedChapterWithDraft()
    if (!chapter) return
    if (!chapter.body.trim()) {
      setAiMessage('当前章节正文为空')
      return
    }
    const content = includeTitle ? ExportService.formatChapterAsText(chapter) : chapter.body
    await window.novelDirector.clipboard.writeText(content)
    setAiMessage(includeTitle ? '已复制章节标题 + 正文' : '已复制正文')
  }

  async function exportCurrentChapter(format: 'txt' | 'md') {
    const chapter = selectedChapterWithDraft()
    if (!chapter) return
    if (!chapter.body.trim()) {
      setAiMessage('当前章节正文为空')
      return
    }
    await flushBody()
    const content = format === 'txt' ? ExportService.formatChapterAsText(chapter) : ExportService.formatChapterAsMarkdown(chapter)
    const fileName = ExportService.defaultChapterFileName(chapter, format)
    const result =
      format === 'txt'
        ? await window.novelDirector.export.saveTextFile(content, fileName)
        : await window.novelDirector.export.saveMarkdownFile(content, fileName)
    if (!result.canceled) {
      setAiMessage(`已导出：${result.filePath}`)
    }
  }

  async function exportAllChapters(format: 'txt' | 'md') {
    if (chapters.length === 0) {
      setAiMessage('当前项目暂无章节可导出')
      return
    }
    await flushBody()
    const currentBody = selected ? { [selected.id]: bodyDraft } : {}
    const exportChapters = chapters.map((chapter) => ({ ...chapter, body: currentBody[chapter.id] ?? chapter.body }))
    const content =
      format === 'txt'
        ? ExportService.formatAllChaptersAsText(exportChapters)
        : ExportService.formatAllChaptersAsMarkdown(project, exportChapters)
    const fileName = ExportService.defaultAllChaptersFileName(project, format)
    const result =
      format === 'txt'
        ? await window.novelDirector.export.saveTextFile(content, fileName)
        : await window.novelDirector.export.saveMarkdownFile(content, fileName)
    if (!result.canceled) {
      setAiMessage(`已导出全部章节：${result.filePath}`)
    }
  }

  const selectedChapterVersions = selected
    ? [...scoped.chapterVersions].filter((version) => version.chapterId === selected.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : []
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

  return (
    <div className="chapters-view">
      <Header
        title="章节创作台"
        description="左侧管理章节脉络，中间沉浸写作，右侧沉淀可进入长期记忆的复盘信息。"
        actions={
          <>
            <button className="ghost-button" onClick={() => exportAllChapters('txt')}>导出全部 TXT</button>
            <button className="ghost-button" onClick={() => exportAllChapters('md')}>导出全部 MD</button>
            <button className="primary-button" onClick={addChapter}>新增章节</button>
          </>
        }
      />
      <section className="split-layout chapter-workbench">
        <ChapterListPanel
          chapters={chapters}
          selectedChapterId={selected?.id ?? null}
          activeBodyCharacterCount={bodyCharacterCount}
          onSelectChapter={(chapter) => {
            void flushBody().then(() => setSelectedId(chapter.id))
          }}
        />
        <div className="editor-pane">
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
                loadingAction={loadingAction}
                aiMessage={aiMessage}
                showVersionHistory={showVersionHistory}
                versionCount={selectedChapterVersions.length}
                versionHistory={
                  <ChapterVersionHistoryPanel
                    selected={selected}
                    versions={selectedChapterVersions}
                    onCopyVersion={copyChapterVersion}
                    onRestoreVersion={restoreChapterVersion}
                    onDeleteVersion={deleteChapterVersion}
                  />
                }
                onUpdateChapter={(patch) => {
                  void updateChapter(selected.id, patch)
                }}
                onBodyChange={(body) => updateBodyDebounced(selected.id, body)}
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
                onApplyReviewTemplate={() => {
                  void applyReviewTemplate(selected)
                }}
                onGenerateReview={() =>
                  runAIAction('review', () => aiService.generateChapterReview(chapterText(), buildChapterContext()), setReviewDraft)
                }
                onExtractCharacters={() =>
                  runAIAction(
                    'characters',
                    () => aiService.updateCharacterStates(chapterText(), scoped.characters, buildChapterContext()),
                    setCharacterSuggestions
                  )
                }
                onExtractForeshadowing={() =>
                  runAIAction(
                    'foreshadowing',
                    () => aiService.extractForeshadowing(chapterText(), scoped.foreshadowings, buildChapterContext(), scoped.characters),
                    setForeshadowingDraft
                  )
                }
                onGenerateNextRisk={() =>
                  runAIAction('next', () => aiService.generateNextChapterSuggestions(selected, buildChapterContext()), setNextSuggestions)
                }
                onDeleteChapter={() => {
                  void deleteChapter(selected.id)
                }}
              />

              <ChapterAIDraftPanels
                selectedOrder={selected.order}
                rawAIText={rawAIText}
                reviewDraft={reviewDraft}
                reviewFields={reviewFields}
                characters={scoped.characters}
                characterSuggestions={characterSuggestions}
                foreshadowings={scoped.foreshadowings}
                foreshadowingDraft={foreshadowingDraft}
                nextSuggestions={nextSuggestions}
                onSetReviewDraft={setReviewDraft}
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
                onSetNextSuggestions={setNextSuggestions}
                onApplyNextSuggestions={() => {
                  void updateChapter(selected.id, { riskWarnings: nextSuggestions ? nextSuggestionsAsRiskText(nextSuggestions) : '' })
                }}
              />

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
            </>
          )}
        </div>
      </section>
    </div>
  )
}

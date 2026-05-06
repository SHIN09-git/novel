import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AIResult,
  AppData,
  Chapter,
  ChapterContinuityBridge,
  ChapterContinuityBridgeSuggestion,
  ChapterReviewDraft,
  ChapterVersion,
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
import { EmptyState, NumberInput, TextArea, TextInput, Toggle } from '../components/FormFields'
import { Header } from '../components/Layout'
import { ActionToolbar, SectionCard, StatusBadge } from '../components/UI'
import { projectData } from '../utils/projectData'
import { formatDate, newId, now, statusLabel, weightLabel } from '../utils/format'

interface ProjectProps {
  data: AppData
  project: Project
  saveData: (next: AppData) => Promise<void>
}

function updateProjectTimestamp(data: AppData, projectId: ID): Project[] {
  return data.projects.map((project) => (project.id === projectId ? { ...project, updatedAt: now() } : project))
}

type ReviewTextField = Exclude<keyof ChapterReviewDraft, 'continuityBridgeSuggestion'>

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
    await saveData({ ...data, projects: updateProjectTimestamp(data, project.id), chapters: [...data.chapters, chapter] })
    setSelectedId(chapter.id)
  }

  async function updateChapter(id: ID, patch: Partial<Chapter>) {
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      chapters: data.chapters.map((chapter) => (chapter.id === id ? { ...chapter, ...patch, updatedAt: now() } : chapter))
    })
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
    if (!confirm('确定删除这一章吗？')) return
    const revisionSessionIds = new Set(data.revisionSessions.filter((session) => session.chapterId === id).map((session) => session.id))
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      chapters: data.chapters.filter((chapter) => chapter.id !== id),
      chapterContinuityBridges: data.chapterContinuityBridges.filter((bridge) => bridge.fromChapterId !== id),
      characterStateLogs: data.characterStateLogs.map((log) => (log.chapterId === id ? { ...log, chapterId: null } : log)),
      revisionSessions: data.revisionSessions.filter((session) => session.chapterId !== id),
      revisionRequests: data.revisionRequests.filter((request) => !revisionSessionIds.has(request.sessionId)),
      revisionVersions: data.revisionVersions.filter((version) => !revisionSessionIds.has(version.sessionId)),
      chapterVersions: data.chapterVersions.filter((version) => version.chapterId !== id)
    })
    setSelectedId(null)
  }

  async function restoreChapterVersion(version: ChapterVersion) {
    if (!selected) return
    if (!confirm('确定恢复这个历史版本吗？当前正文会先保存为一个新历史版本。')) return
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
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      chapters: data.chapters.map((chapter) =>
        chapter.id === selected.id ? { ...chapter, title: version.title, body: version.body, updatedAt: timestamp } : chapter
      ),
      chapterVersions: [snapshot, ...data.chapterVersions]
    })
    setBodyDraft(version.body)
  }

  async function deleteChapterVersion(version: ChapterVersion) {
    if (!confirm('确定删除这个章节历史版本吗？')) return
    await saveData({
      ...data,
      chapterVersions: data.chapterVersions.filter((item) => item.id !== version.id)
    })
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
    const { continuityBridgeSuggestion, ...chapterReview } = reviewDraft
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
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      chapterContinuityBridges: existing
        ? data.chapterContinuityBridges.map((item) => (item.id === existing.id ? bridge : item))
        : [bridge, ...data.chapterContinuityBridges]
    })
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
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      characters: data.characters.map((item) =>
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
      characterStateLogs: [...data.characterStateLogs, log]
    })
    setCharacterSuggestions((items) => items.filter((item) => item !== suggestion))
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
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      foreshadowings: [...data.foreshadowings, item]
    })
  }

  async function applyStatusChange(change: ForeshadowingStatusChangeSuggestion) {
    if (!selected) return
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      foreshadowings: data.foreshadowings.map((item) =>
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
    })
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

  const reviewFields: Array<{ key: ReviewTextField; label: string }> = [
    { key: 'summary', label: '本章剧情摘要' },
    { key: 'newInformation', label: '本章新增信息' },
    { key: 'characterChanges', label: '本章角色变化' },
    { key: 'newForeshadowing', label: '本章新增伏笔' },
    { key: 'resolvedForeshadowing', label: '本章已回收伏笔' },
    { key: 'endingHook', label: '本章结尾钩子' },
    { key: 'riskWarnings', label: '本章风险提醒' }
  ]
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
    <>
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
        <aside className="list-pane">
          <div className="chapter-shelf-header">
            <span>章节列表</span>
            <strong>{chapters.length}</strong>
          </div>
          {chapters.map((chapter) => (
            <button
              key={chapter.id}
              className={chapter.id === selected?.id ? 'list-item active' : 'list-item'}
              onClick={() => {
                void flushBody().then(() => setSelectedId(chapter.id))
              }}
            >
              <strong>第 {chapter.order} 章</strong>
              <span>{chapter.title || '未命名'}</span>
              <small>
                {(chapter.id === selected?.id ? bodyCharacterCount : chapter.body.replace(/\s/g, '').length).toLocaleString()} 字
                {chapter.includedInStageSummary ? ' · 已进阶段摘要' : ''}
              </small>
            </button>
          ))}
        </aside>
        <div className="editor-pane">
          {!selected ? (
            <EmptyState title="暂无章节" description="创建章节后，可以在这里写正文并填写复盘字段。" />
          ) : (
            <>
              <div className="panel chapter-editor-main">
                <div className="chapter-editor-heading">
                  <div>
                    <span className="chapter-kicker">当前章节</span>
                    <h2>第 {selected.order} 章 {selected.title || '未命名'}</h2>
                  </div>
                  <div className="chapter-meta-strip">
                    <span>{chapterStatus}</span>
                    <span>{bodyCharacterCount.toLocaleString()} 字</span>
                    <span>{paragraphCount} 段</span>
                    <span>复盘 {reviewFilledCount}/{reviewFields.length}</span>
                  </div>
                </div>
                <div className="form-grid compact">
                  <NumberInput label="章节序号" min={1} value={selected.order} onChange={(order) => updateChapter(selected.id, { order: order ?? selected.order })} />
                  <TextInput label="章节标题" value={selected.title} onChange={(title) => updateChapter(selected.id, { title })} />
                </div>
                <TextArea
                  label="正文稿纸"
                  value={bodyDraft}
                  rows={24}
                  className="manuscript-textarea"
                  onBlur={() => {
                    void flushBody()
                  }}
                  onChange={(body) => updateBodyDebounced(selected.id, body)}
                />
                <div className="row-actions chapter-export-actions">
                  <button className="ghost-button" onClick={() => copyChapterBody(false)}>复制正文</button>
                  <button className="ghost-button" onClick={() => copyChapterBody(true)}>复制标题 + 正文</button>
                  <button className="ghost-button" onClick={() => exportCurrentChapter('txt')}>导出 TXT</button>
                  <button className="ghost-button" onClick={() => exportCurrentChapter('md')}>导出 Markdown</button>
                  <button className="ghost-button" onClick={() => setShowVersionHistory((value) => !value)}>
                    版本历史 {selectedChapterVersions.length ? `(${selectedChapterVersions.length})` : ''}
                  </button>
                </div>
                <div className="row-actions chapter-ai-actions">
                  <button className="ghost-button" onClick={() => applyReviewTemplate(selected)}>
                    一键生成章节复盘模板
                  </button>
                  <button
                    className="primary-button"
                    disabled={loadingAction !== null}
                    onClick={() =>
                      runAIAction(
                        'review',
                        () => aiService.generateChapterReview(chapterText(), buildChapterContext()),
                        setReviewDraft
                      )
                    }
                  >
                    生成章节复盘草稿
                  </button>
                  <button
                    className="ghost-button"
                    disabled={loadingAction !== null}
                    onClick={() =>
                      runAIAction(
                        'characters',
                        () => aiService.updateCharacterStates(chapterText(), scoped.characters, buildChapterContext()),
                        setCharacterSuggestions
                      )
                    }
                  >
                    从正文提取角色变化
                  </button>
                  <button
                    className="ghost-button"
                    disabled={loadingAction !== null}
                    onClick={() =>
                      runAIAction(
                        'foreshadowing',
                        () => aiService.extractForeshadowing(chapterText(), scoped.foreshadowings, buildChapterContext(), scoped.characters),
                        setForeshadowingDraft
                      )
                    }
                  >
                    从正文提取伏笔
                  </button>
                  <button
                    className="ghost-button"
                    disabled={loadingAction !== null}
                    onClick={() =>
                      runAIAction(
                        'next',
                        () => aiService.generateNextChapterSuggestions(selected, buildChapterContext()),
                        setNextSuggestions
                      )
                    }
                  >
                    生成下一章风险提醒
                  </button>
                  <Toggle label="已进入阶段摘要" checked={selected.includedInStageSummary} onChange={(includedInStageSummary) => updateChapter(selected.id, { includedInStageSummary })} />
                  <button className="danger-button" onClick={() => deleteChapter(selected.id)}>
                    删除章节
                  </button>
                </div>
                {loadingAction ? <p className="muted">正在生成草稿...</p> : null}
                {aiMessage ? <div className="notice">{aiMessage}</div> : null}
                {showVersionHistory ? (
                  <div className="version-history-panel">
                    <div className="panel-title-row">
                      <h3>章节版本历史</h3>
                      <span className="muted">{selectedChapterVersions.length} 个备份</span>
                    </div>
                    {selectedChapterVersions.length === 0 ? (
                      <p className="muted">暂无历史版本。接受修订版本或恢复旧版本前，系统会自动保存快照。</p>
                    ) : (
                      <div className="version-history-list">
                        {selectedChapterVersions.map((version) => (
                          <article key={version.id} className="version-history-item">
                            <div>
                              <strong>{version.title || `第 ${selected.order} 章`}</strong>
                              <p>{version.note || version.source} · {formatDate(version.createdAt)} · {version.body.replace(/\s/g, '').length.toLocaleString()} 字</p>
                            </div>
                            <div className="row-actions">
                              <button className="ghost-button" onClick={() => copyChapterVersion(version)}>复制</button>
                              <button className="primary-button" onClick={() => restoreChapterVersion(version)}>恢复</button>
                              <button className="danger-button" onClick={() => deleteChapterVersion(version)}>删除</button>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              {rawAIText ? (
                <div className="panel ai-draft-panel">
                  <h2>AI 原始返回</h2>
                  <p className="muted">解析失败时保留原始文本，方便手动复制。</p>
                  <textarea className="prompt-editor" value={rawAIText} readOnly />
                </div>
              ) : null}

              {reviewDraft ? (
                <div className="panel ai-draft-panel">
                  <div className="panel-title-row">
                    <h2>章节复盘草稿预览</h2>
                    <button className="primary-button" onClick={applyAllReviewDraft}>
                      应用到章节复盘
                    </button>
                  </div>
                  <div className="form-grid">
                    {reviewFields.map((field) => (
                      <div key={field.key} className="draft-field">
                        <TextArea
                          label={field.label}
                          value={reviewDraft[field.key]}
                          onChange={(value) => setReviewDraft({ ...reviewDraft, [field.key]: value })}
                        />
                        <div className="row-actions">
                          <button className="primary-button" onClick={() => applyReviewField(field.key)}>
                            应用
                          </button>
                          <button className="ghost-button" onClick={() => setReviewDraft({ ...reviewDraft, [field.key]: '' })}>
                            忽略
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="panel continuity-mini-panel">
                    <h3>下一章衔接建议</h3>
                    <div className="form-grid">
                      <TextArea label="结尾位置" value={reviewDraft.continuityBridgeSuggestion.lastSceneLocation} onChange={(lastSceneLocation) => setReviewDraft({ ...reviewDraft, continuityBridgeSuggestion: { ...reviewDraft.continuityBridgeSuggestion, lastSceneLocation } })} />
                      <TextArea label="身体状态" value={reviewDraft.continuityBridgeSuggestion.lastPhysicalState} onChange={(lastPhysicalState) => setReviewDraft({ ...reviewDraft, continuityBridgeSuggestion: { ...reviewDraft.continuityBridgeSuggestion, lastPhysicalState } })} />
                      <TextArea label="情绪状态" value={reviewDraft.continuityBridgeSuggestion.lastEmotionalState} onChange={(lastEmotionalState) => setReviewDraft({ ...reviewDraft, continuityBridgeSuggestion: { ...reviewDraft.continuityBridgeSuggestion, lastEmotionalState } })} />
                      <TextArea label="未完成动作" value={reviewDraft.continuityBridgeSuggestion.lastUnresolvedAction} onChange={(lastUnresolvedAction) => setReviewDraft({ ...reviewDraft, continuityBridgeSuggestion: { ...reviewDraft.continuityBridgeSuggestion, lastUnresolvedAction } })} />
                      <TextArea label="下一章必须接住" value={reviewDraft.continuityBridgeSuggestion.immediateNextBeat} onChange={(immediateNextBeat) => setReviewDraft({ ...reviewDraft, continuityBridgeSuggestion: { ...reviewDraft.continuityBridgeSuggestion, immediateNextBeat } })} />
                      <TextArea label="禁止重置" value={reviewDraft.continuityBridgeSuggestion.mustNotReset} onChange={(mustNotReset) => setReviewDraft({ ...reviewDraft, continuityBridgeSuggestion: { ...reviewDraft.continuityBridgeSuggestion, mustNotReset } })} />
                    </div>
                    <button className="primary-button" onClick={() => saveContinuityBridge(reviewDraft.continuityBridgeSuggestion)}>
                      保存为下一章衔接状态
                    </button>
                  </div>
                </div>
              ) : null}

              {characterSuggestions.length > 0 ? (
                <div className="panel ai-draft-panel">
                  <h2>角色状态候选变更</h2>
                  <div className="candidate-list">
                    {characterSuggestions.map((suggestion) => {
                      const character = scoped.characters.find((item) => item.id === suggestion.characterId)
                      if (!character) return null
                      return (
                        <article key={`${suggestion.characterId}-${suggestion.changeSummary}`} className="candidate-card">
                          <h3>{character.name}</h3>
                          <p><strong>变化原因：</strong>{suggestion.changeSummary}</p>
                          <p><strong>原情绪状态：</strong>{character.emotionalState || '待补充'}</p>
                          <p><strong>建议情绪状态：</strong>{suggestion.newCurrentEmotionalState || '不变'}</p>
                          <p><strong>原关系状态：</strong>{character.protagonistRelationship || '待补充'}</p>
                          <p><strong>建议关系状态：</strong>{suggestion.newRelationshipWithProtagonist || '不变'}</p>
                          <p><strong>建议行动倾向：</strong>{suggestion.newNextActionTendency || '不变'}</p>
                          <p><strong>关联章节：</strong>第 {selected.order} 章 · 置信度 {Math.round(suggestion.confidence * 100)}%</p>
                          <button className="primary-button" onClick={() => applyCharacterSuggestion(suggestion)}>
                            应用到角色卡并记录日志
                          </button>
                        </article>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {foreshadowingDraft ? (
                <div className="panel ai-draft-panel">
                  <h2>伏笔提取候选</h2>
                  <div className="candidate-list">
                    {foreshadowingDraft.newForeshadowingCandidates.map((candidate) => (
                      <article key={`${candidate.title}-${candidate.description}`} className="candidate-card">
                        <h3>{candidate.title}</h3>
                        <p>{candidate.description}</p>
                        <p><strong>首次出现：</strong>第 {candidate.firstChapterOrder ?? selected.order} 章</p>
                        <p><strong>建议权重：</strong>{weightLabel(candidate.suggestedWeight)}</p>
                        <p><strong>预计回收：</strong>{candidate.expectedPayoff || '待补充'}</p>
                        <p><strong>注意事项：</strong>{candidate.notes || '无'}</p>
                        <button className="primary-button" onClick={() => applyForeshadowingCandidate(candidate)}>
                          加入伏笔账本
                        </button>
                      </article>
                    ))}
                    {foreshadowingDraft.abandonedForeshadowingCandidates.map((candidate) => (
                      <article key={`abandoned-${candidate.title}-${candidate.description}`} className="candidate-card">
                        <h3>{candidate.title}（废弃候选）</h3>
                        <p>{candidate.description}</p>
                        <button className="ghost-button" onClick={() => applyForeshadowingCandidate(candidate, 'abandoned')}>
                          加入为废弃伏笔
                        </button>
                      </article>
                    ))}
                    {foreshadowingDraft.statusChanges.map((change) => {
                      const item = scoped.foreshadowings.find((foreshadowing) => foreshadowing.id === change.foreshadowingId)
                      if (!item) return null
                      return (
                        <article key={`${change.foreshadowingId}-${change.suggestedStatus}`} className="candidate-card">
                          <h3>{item.title}</h3>
                          <p><strong>当前状态：</strong>{statusLabel(item.status)}</p>
                          <p><strong>建议新状态：</strong>{statusLabel(change.suggestedStatus)}</p>
                          <p><strong>证据文本：</strong>{change.evidenceText || '待补充'}</p>
                          <p><strong>置信度：</strong>{Math.round(change.confidence * 100)}%</p>
                          <button className="primary-button" onClick={() => applyStatusChange(change)}>
                            应用状态变更
                          </button>
                        </article>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {nextSuggestions ? (
                <div className="panel ai-draft-panel">
                  <h2>下一章风险提醒草稿</h2>
                  <div className="form-grid">
                    <TextArea label="下一章目标" value={nextSuggestions.nextChapterGoal} onChange={(nextChapterGoal) => setNextSuggestions({ ...nextSuggestions, nextChapterGoal })} />
                    <TextArea label="必须推进的冲突" value={nextSuggestions.conflictToPush} onChange={(conflictToPush) => setNextSuggestions({ ...nextSuggestions, conflictToPush })} />
                    <TextArea label="必须保留的悬念" value={nextSuggestions.suspenseToKeep} onChange={(suspenseToKeep) => setNextSuggestions({ ...nextSuggestions, suspenseToKeep })} />
                    <TextArea label="可轻推伏笔" value={nextSuggestions.foreshadowingToHint} onChange={(foreshadowingToHint) => setNextSuggestions({ ...nextSuggestions, foreshadowingToHint })} />
                    <TextArea label="不要提前揭示" value={nextSuggestions.foreshadowingNotToReveal} onChange={(foreshadowingNotToReveal) => setNextSuggestions({ ...nextSuggestions, foreshadowingNotToReveal })} />
                    <TextArea label="建议结尾钩子" value={nextSuggestions.suggestedEndingHook} onChange={(suggestedEndingHook) => setNextSuggestions({ ...nextSuggestions, suggestedEndingHook })} />
                    <TextArea label="读者情绪目标" value={nextSuggestions.readerEmotionTarget} onChange={(readerEmotionTarget) => setNextSuggestions({ ...nextSuggestions, readerEmotionTarget })} />
                  </div>
                  <button className="primary-button" onClick={() => updateChapter(selected.id, { riskWarnings: nextSuggestionsAsRiskText(nextSuggestions) })}>
                    应用到本章风险提醒
                  </button>
                </div>
              ) : null}

              <div className="panel chapter-review-panel">
                <h2>本章复盘</h2>
                <div className="form-grid">
                  <TextArea label="本章剧情摘要" value={selected.summary} onChange={(summary) => updateChapter(selected.id, { summary })} />
                  <TextArea label="本章新增信息" value={selected.newInformation} onChange={(newInformation) => updateChapter(selected.id, { newInformation })} />
                  <TextArea label="本章角色变化" value={selected.characterChanges} onChange={(characterChanges) => updateChapter(selected.id, { characterChanges })} />
                  <TextArea label="本章新增伏笔" value={selected.newForeshadowing} onChange={(newForeshadowing) => updateChapter(selected.id, { newForeshadowing })} />
                  <TextArea label="本章已回收伏笔" value={selected.resolvedForeshadowing} onChange={(resolvedForeshadowing) => updateChapter(selected.id, { resolvedForeshadowing })} />
                  <TextArea label="本章结尾钩子" value={selected.endingHook} onChange={(endingHook) => updateChapter(selected.id, { endingHook })} />
                  <TextArea label="本章风险提醒" value={selected.riskWarnings} onChange={(riskWarnings) => updateChapter(selected.id, { riskWarnings })} />
                </div>
                <div className="panel continuity-mini-panel">
                  <h3>下一章衔接状态</h3>
                  <p className="muted">保存后，Prompt 构建器和生产流水线生成第 {selected.order + 1} 章时会优先使用这组状态。</p>
                  <div className="form-grid">
                    <TextArea label="结尾位置" value={selectedBridge?.lastSceneLocation ?? ''} onChange={(value) => updateContinuityBridgeField('lastSceneLocation', value)} />
                    <TextArea label="身体状态" value={selectedBridge?.lastPhysicalState ?? ''} onChange={(value) => updateContinuityBridgeField('lastPhysicalState', value)} />
                    <TextArea label="情绪状态" value={selectedBridge?.lastEmotionalState ?? ''} onChange={(value) => updateContinuityBridgeField('lastEmotionalState', value)} />
                    <TextArea label="未完成动作" value={selectedBridge?.lastUnresolvedAction ?? ''} onChange={(value) => updateContinuityBridgeField('lastUnresolvedAction', value)} />
                    <TextArea label="下一章必须接住" value={selectedBridge?.immediateNextBeat ?? ''} onChange={(value) => updateContinuityBridgeField('immediateNextBeat', value)} />
                    <TextArea label="禁止重置" value={selectedBridge?.mustNotReset ?? ''} onChange={(value) => updateContinuityBridgeField('mustNotReset', value)} />
                    <TextArea label="开放小张力" value={selectedBridge?.openMicroTensions ?? ''} onChange={(value) => updateContinuityBridgeField('openMicroTensions', value)} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  )
}

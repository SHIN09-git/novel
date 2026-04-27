import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AIResult,
  AppData,
  AppSettings,
  Chapter,
  ChapterDraftResult,
  ChapterGenerationJob,
  ChapterGenerationStep,
  ChapterGenerationStepStatus,
  ChapterGenerationStepType,
  ChapterPlan,
  ChapterReviewDraft,
  ChapterTask,
  Character,
  CharacterStateLog,
  CharacterStateSuggestion,
  ConsistencyReviewData,
  ConsistencyReviewReport,
  ContextBudgetMode,
  ContextBudgetProfile,
  ContextSelectionResult,
  Foreshadowing,
  ForeshadowingCandidate,
  ForeshadowingExtractionResult,
  ForeshadowingStatus,
  ForeshadowingStatusChangeSuggestion,
  ForeshadowingWeight,
  GeneratedChapterDraft,
  ID,
  MemoryUpdateCandidate,
  PipelineMode,
  NextChapterSuggestions,
  Project,
  PromptMode,
  PromptModuleSelection,
  QualityGateIssue,
  QualityGateReport,
  RevisionCandidate,
  StageSummary,
  StoryBible,
  TimelineEvent
} from '../../shared/types'
import { createEmptyBible, createEmptyChapterTask, defaultModulesForMode, EMPTY_APP_DATA } from '../../shared/defaults'
import { AIService } from '../../services/AIService'
import { ContextBudgetManager } from '../../services/ContextBudgetManager'
import { ExportService } from '../../services/ExportService'
import { parseChapterNumbersFromText, PromptBuilderService } from '../../services/PromptBuilderService'
import { QualityGateService } from '../../services/QualityGateService'
import { TokenEstimator } from '../../services/TokenEstimator'
import { EmptyState, Field, NumberInput, SelectField, TextArea, TextInput, Toggle } from './components/FormFields'
import { Header, Shell, type View } from './components/Layout'
import { projectData } from './utils/projectData'
import { clampNumber, formatDate, modeLabel, newId, now, statusLabel, weightLabel } from './utils/format'

interface PersistProps {
  data: AppData
  saveData: (next: AppData) => Promise<void>
}

interface ProjectProps extends PersistProps {
  project: Project
}

function updateProjectTimestamp(data: AppData, projectId: ID): Project[] {
  return data.projects.map((project) => (project.id === projectId ? { ...project, updatedAt: now() } : project))
}

function HomeView({
  data,
  saveData,
  setProjectId,
  setView
}: PersistProps & {
  setProjectId: (id: ID) => void
  setView: (view: View) => void
}) {
  const [draft, setDraft] = useState({
    name: '',
    genre: '',
    description: '',
    targetReaders: '',
    coreAppeal: '',
    style: ''
  })
  const [editing, setEditing] = useState<Project | null>(null)

  async function createProject() {
    if (!draft.name.trim()) return
    const timestamp = now()
    const project: Project = {
      id: newId(),
      name: draft.name.trim(),
      genre: draft.genre,
      description: draft.description,
      targetReaders: draft.targetReaders,
      coreAppeal: draft.coreAppeal,
      style: draft.style,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await saveData({
      ...data,
      projects: [project, ...data.projects],
      storyBibles: [createEmptyBible(project.id), ...data.storyBibles]
    })
    setDraft({ name: '', genre: '', description: '', targetReaders: '', coreAppeal: '', style: '' })
    setProjectId(project.id)
    setView('dashboard')
  }

  async function saveProjectEdit() {
    if (!editing) return
    await saveData({
      ...data,
      projects: data.projects.map((project) =>
        project.id === editing.id ? { ...editing, updatedAt: now() } : project
      )
    })
    setEditing(null)
  }

  async function deleteProject(project: Project) {
    if (!confirm(`确定删除《${project.name}》及其全部本地数据吗？此操作不可撤销。`)) return
    const projectJobIds = new Set(data.chapterGenerationJobs.filter((item) => item.projectId === project.id).map((item) => item.id))
    await saveData({
      ...data,
      projects: data.projects.filter((item) => item.id !== project.id),
      storyBibles: data.storyBibles.filter((item) => item.projectId !== project.id),
      chapters: data.chapters.filter((item) => item.projectId !== project.id),
      characters: data.characters.filter((item) => item.projectId !== project.id),
      characterStateLogs: data.characterStateLogs.filter((item) => item.projectId !== project.id),
      foreshadowings: data.foreshadowings.filter((item) => item.projectId !== project.id),
      timelineEvents: data.timelineEvents.filter((item) => item.projectId !== project.id),
      stageSummaries: data.stageSummaries.filter((item) => item.projectId !== project.id),
      promptVersions: data.promptVersions.filter((item) => item.projectId !== project.id),
      chapterGenerationJobs: data.chapterGenerationJobs.filter((item) => item.projectId !== project.id),
      chapterGenerationSteps: data.chapterGenerationSteps.filter((item) => !projectJobIds.has(item.jobId)),
      generatedChapterDrafts: data.generatedChapterDrafts.filter((item) => item.projectId !== project.id),
      memoryUpdateCandidates: data.memoryUpdateCandidates.filter((item) => item.projectId !== project.id),
      consistencyReviewReports: data.consistencyReviewReports.filter((item) => item.projectId !== project.id),
      contextBudgetProfiles: data.contextBudgetProfiles.filter((item) => item.projectId !== project.id),
      qualityGateReports: data.qualityGateReports.filter((item) => item.projectId !== project.id),
      revisionCandidates: data.revisionCandidates.filter((item) => item.projectId !== project.id)
    })
  }

  return (
    <div className="home">
      <Header title="Novel Director" description="面向 AI 长篇小说创作的上下文导演台。" />
      <section className="workspace-grid">
        <div className="panel">
          <h2>创建新项目</h2>
          <div className="form-grid">
            <TextInput label="项目名" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
            <TextInput label="类型/题材" value={draft.genre} onChange={(genre) => setDraft({ ...draft, genre })} />
          </div>
          <TextArea label="简介" rows={3} value={draft.description} onChange={(description) => setDraft({ ...draft, description })} />
          <div className="form-grid">
            <TextInput
              label="目标读者"
              value={draft.targetReaders}
              onChange={(targetReaders) => setDraft({ ...draft, targetReaders })}
            />
            <TextInput label="整体风格" value={draft.style} onChange={(style) => setDraft({ ...draft, style })} />
          </div>
          <TextArea
            label="核心爽点/情绪体验"
            rows={3}
            value={draft.coreAppeal}
            onChange={(coreAppeal) => setDraft({ ...draft, coreAppeal })}
          />
          <button className="primary-button" onClick={createProject}>
            创建并进入工作台
          </button>
        </div>
        <div className="panel project-list-panel">
          <h2>项目列表</h2>
          {data.projects.length === 0 ? (
            <EmptyState title="还没有小说项目" description="创建一个项目后，就可以开始维护小说圣经、章节复盘和 Prompt 上下文。" />
          ) : (
            <div className="project-list">
              {data.projects.map((project) => (
                <article className="project-row" key={project.id}>
                  {editing?.id === project.id ? (
                    <div className="edit-project">
                      <TextInput label="项目名" value={editing.name} onChange={(name) => setEditing({ ...editing, name })} />
                      <TextInput label="类型/题材" value={editing.genre} onChange={(genre) => setEditing({ ...editing, genre })} />
                      <TextArea
                        label="简介"
                        rows={3}
                        value={editing.description}
                        onChange={(description) => setEditing({ ...editing, description })}
                      />
                      <div className="row-actions">
                        <button className="primary-button" onClick={saveProjectEdit}>
                          保存
                        </button>
                        <button className="ghost-button" onClick={() => setEditing(null)}>
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <h3>{project.name}</h3>
                        <p>{project.description || '暂无简介'}</p>
                        <small>
                          {project.genre || '未设置题材'} · 更新于 {formatDate(project.updatedAt)}
                        </small>
                      </div>
                      <div className="row-actions">
                        <button
                          className="primary-button"
                          onClick={() => {
                            setProjectId(project.id)
                            setView('dashboard')
                          }}
                        >
                          进入
                        </button>
                        <button className="ghost-button" onClick={() => setEditing(project)}>
                          编辑
                        </button>
                        <button className="danger-button" onClick={() => deleteProject(project)}>
                          删除
                        </button>
                      </div>
                    </>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function DashboardView({ data, project, saveData }: ProjectProps) {
  const scoped = projectData(data, project.id)
  const recentChapter = [...scoped.chapters].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  const latestStage = [...scoped.stageSummaries].sort((a, b) => b.chapterEnd - a.chapterEnd)[0]
  const highForeshadowingCount = scoped.foreshadowings.filter(
    (item) => item.status !== 'resolved' && item.status !== 'abandoned' && (item.weight === 'high' || item.weight === 'payoff')
  ).length
  const mainCharacterCount = scoped.characters.filter((character) => character.isMain).length
  const nextChapter = Math.max(0, ...scoped.chapters.map((chapter) => chapter.order)) + 1

  async function createNextChapter() {
    const timestamp = now()
    const chapter: Chapter = {
      id: newId(),
      projectId: project.id,
      order: nextChapter,
      title: `第 ${nextChapter} 章`,
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
  }

  return (
    <>
      <Header title="项目工作台" description="把长期设定、阶段摘要和当前戏剧状态收束到下一章。" actions={<button className="primary-button" onClick={createNextChapter}>新建第 {nextChapter} 章</button>} />
      <section className="metric-grid">
        <div className="metric">
          <span>最近编辑章节</span>
          <strong>{recentChapter ? `第 ${recentChapter.order} 章` : '暂无'}</strong>
          <p>{recentChapter?.title || '先创建章节开始写作。'}</p>
        </div>
        <div className="metric">
          <span>当前阶段摘要</span>
          <strong>{latestStage ? `${latestStage.chapterStart}-${latestStage.chapterEnd}` : '暂无'}</strong>
          <p>{latestStage?.nextStageDirection || '建议每 3 章生成一次摘要。'}</p>
        </div>
        <div className="metric">
          <span>未回收高权重伏笔</span>
          <strong>{highForeshadowingCount}</strong>
          <p>Prompt 默认优先纳入中/高/回收权重伏笔。</p>
        </div>
        <div className="metric">
          <span>主要角色</span>
          <strong>{mainCharacterCount}</strong>
          <p>角色卡记录当前戏剧状态。</p>
        </div>
      </section>
    </>
  )
}

function BibleView({ data, project, saveData }: ProjectProps) {
  const bible = projectData(data, project.id).bible ?? createEmptyBible(project.id)

  async function updateBible(patch: Partial<StoryBible>) {
    const nextBible = { ...bible, ...patch, updatedAt: now() }
    const exists = data.storyBibles.some((item) => item.projectId === project.id)
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      storyBibles: exists
        ? data.storyBibles.map((item) => (item.projectId === project.id ? nextBible : item))
        : [...data.storyBibles, nextBible]
    })
  }

  return (
    <>
      <Header title="小说圣经" description="这里应放长期稳定信息，而不是章节流水账。" />
      <section className="panel">
        <div className="notice">长期上下文要短、稳、可复用。会频繁变化的信息请写入章节复盘或角色当前状态。</div>
        <div className="form-grid">
          <TextArea label="世界观基础设定" value={bible.worldbuilding} onChange={(worldbuilding) => updateBible({ worldbuilding })} />
          <TextArea label="故事核心命题" value={bible.corePremise} onChange={(corePremise) => updateBible({ corePremise })} />
          <TextArea label="主角核心欲望" value={bible.protagonistDesire} onChange={(protagonistDesire) => updateBible({ protagonistDesire })} />
          <TextArea label="主角核心恐惧" value={bible.protagonistFear} onChange={(protagonistFear) => updateBible({ protagonistFear })} />
          <TextArea label="主线冲突" value={bible.mainConflict} onChange={(mainConflict) => updateBible({ mainConflict })} />
          <TextArea label="力量体系/规则体系" value={bible.powerSystem} onChange={(powerSystem) => updateBible({ powerSystem })} />
          <TextArea label="禁用套路" value={bible.bannedTropes} onChange={(bannedTropes) => updateBible({ bannedTropes })} />
          <TextArea label="文风样例" value={bible.styleSample} onChange={(styleSample) => updateBible({ styleSample })} />
          <TextArea label="叙事基调" value={bible.narrativeTone} onChange={(narrativeTone) => updateBible({ narrativeTone })} />
          <TextArea label="重要不可违背设定" value={bible.immutableFacts} onChange={(immutableFacts) => updateBible({ immutableFacts })} />
        </div>
      </section>
    </>
  )
}

function ChaptersView({ data, project, saveData }: ProjectProps) {
  const scoped = projectData(data, project.id)
  const chapters = [...scoped.chapters].sort((a, b) => a.order - b.order)
  const [selectedId, setSelectedId] = useState<ID | null>(chapters[0]?.id ?? null)
  const selected = chapters.find((chapter) => chapter.id === selectedId) ?? chapters[0] ?? null
  const [bodyDraft, setBodyDraft] = useState(selected?.body ?? '')
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [aiMessage, setAiMessage] = useState('')
  const [rawAIText, setRawAIText] = useState('')
  const [reviewDraft, setReviewDraft] = useState<ChapterReviewDraft | null>(null)
  const [characterSuggestions, setCharacterSuggestions] = useState<CharacterStateSuggestion[]>([])
  const [foreshadowingDraft, setForeshadowingDraft] = useState<ForeshadowingExtractionResult | null>(null)
  const [nextSuggestions, setNextSuggestions] = useState<NextChapterSuggestions | null>(null)
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
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      chapters: data.chapters.filter((chapter) => chapter.id !== id),
      characterStateLogs: data.characterStateLogs.map((log) => (log.chapterId === id ? { ...log, chapterId: null } : log))
    })
    setSelectedId(null)
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

  async function applyReviewField(field: keyof ChapterReviewDraft) {
    if (!selected || !reviewDraft) return
    await updateChapter(selected.id, { [field]: reviewDraft[field] } as Partial<Chapter>)
  }

  async function applyAllReviewDraft() {
    if (!selected || !reviewDraft) return
    await updateChapter(selected.id, reviewDraft)
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
    await window.novelAPI.writeClipboard(content)
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
        ? await window.novelAPI.saveTextFile(content, fileName)
        : await window.novelAPI.saveMarkdownFile(content, fileName)
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
        ? await window.novelAPI.saveTextFile(content, fileName)
        : await window.novelAPI.saveMarkdownFile(content, fileName)
    if (!result.canceled) {
      setAiMessage(`已导出全部章节：${result.filePath}`)
    }
  }

  const reviewFields: Array<{ key: keyof ChapterReviewDraft; label: string }> = [
    { key: 'summary', label: '本章剧情摘要' },
    { key: 'newInformation', label: '本章新增信息' },
    { key: 'characterChanges', label: '本章角色变化' },
    { key: 'newForeshadowing', label: '本章新增伏笔' },
    { key: 'resolvedForeshadowing', label: '本章已回收伏笔' },
    { key: 'endingHook', label: '本章结尾钩子' },
    { key: 'riskWarnings', label: '本章风险提醒' }
  ]

  return (
    <>
      <Header
        title="章节管理"
        description="正文和复盘分离：正文负责写，复盘负责进入后续上下文。"
        actions={
          <>
            <button className="ghost-button" onClick={() => exportAllChapters('txt')}>导出全部 TXT</button>
            <button className="ghost-button" onClick={() => exportAllChapters('md')}>导出全部 MD</button>
            <button className="primary-button" onClick={addChapter}>新增章节</button>
          </>
        }
      />
      <section className="split-layout">
        <aside className="list-pane">
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
              {chapter.includedInStageSummary ? <small>已进阶段摘要</small> : null}
            </button>
          ))}
        </aside>
        <div className="editor-pane">
          {!selected ? (
            <EmptyState title="暂无章节" description="创建章节后，可以在这里写正文并填写复盘字段。" />
          ) : (
            <>
              <div className="panel">
                <div className="form-grid compact">
                  <NumberInput label="章节序号" min={1} value={selected.order} onChange={(order) => updateChapter(selected.id, { order: order ?? selected.order })} />
                  <TextInput label="章节标题" value={selected.title} onChange={(title) => updateChapter(selected.id, { title })} />
                </div>
                <TextArea
                  label="正文"
                  value={bodyDraft}
                  rows={16}
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
                </div>
                <div className="row-actions">
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

              <div className="panel">
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
              </div>
            </>
          )}
        </div>
      </section>
    </>
  )
}

function CharactersView({ data, project, saveData }: ProjectProps) {
  const scoped = projectData(data, project.id)
  const characters = [...scoped.characters].sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name))
  const chapters = [...scoped.chapters].sort((a, b) => a.order - b.order)
  const [selectedId, setSelectedId] = useState<ID | null>(characters[0]?.id ?? null)
  const [logNote, setLogNote] = useState('')
  const [logChapter, setLogChapter] = useState<number | null>(chapters.at(-1)?.order ?? null)
  const selected = characters.find((character) => character.id === selectedId) ?? characters[0] ?? null
  const logs = scoped.characterStateLogs
    .filter((log) => log.characterId === selected?.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  useEffect(() => {
    if (!selectedId && characters[0]) setSelectedId(characters[0].id)
  }, [characters, selectedId])

  async function addCharacter() {
    const timestamp = now()
    const character: Character = {
      id: newId(),
      projectId: project.id,
      name: '新角色',
      role: '',
      surfaceGoal: '',
      deepDesire: '',
      coreFear: '',
      selfDeception: '',
      knownInformation: '',
      unknownInformation: '',
      protagonistRelationship: '',
      emotionalState: '',
      nextActionTendency: '',
      forbiddenWriting: '',
      lastChangedChapter: null,
      isMain: false,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await saveData({ ...data, projects: updateProjectTimestamp(data, project.id), characters: [...data.characters, character] })
    setSelectedId(character.id)
  }

  async function updateCharacter(id: ID, patch: Partial<Character>) {
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      characters: data.characters.map((character) => (character.id === id ? { ...character, ...patch, updatedAt: now() } : character))
    })
  }

  async function deleteCharacter(character: Character) {
    if (!confirm(`确定删除角色「${character.name}」吗？相关伏笔和时间线中的角色引用会被移除。`)) return
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      characters: data.characters.filter((item) => item.id !== character.id),
      characterStateLogs: data.characterStateLogs.filter((log) => log.characterId !== character.id),
      foreshadowings: data.foreshadowings.map((item) => ({
        ...item,
        relatedCharacterIds: item.relatedCharacterIds.filter((id) => id !== character.id)
      })),
      timelineEvents: data.timelineEvents.map((event) => ({
        ...event,
        participantCharacterIds: event.participantCharacterIds.filter((id) => id !== character.id)
      }))
    })
    setSelectedId(null)
  }

  async function addStateLog(character: Character) {
    if (!logNote.trim()) return
    const chapter = chapters.find((item) => item.order === logChapter)
    const log: CharacterStateLog = {
      id: newId(),
      projectId: project.id,
      characterId: character.id,
      chapterId: chapter?.id ?? null,
      chapterOrder: logChapter,
      note: logNote,
      createdAt: now()
    }
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      characterStateLogs: [...data.characterStateLogs, log],
      characters: data.characters.map((item) => (item.id === character.id ? { ...item, lastChangedChapter: logChapter, updatedAt: now() } : item))
    })
    setLogNote('')
  }

  return (
    <>
      <Header title="角色卡系统" description="角色卡记录当前戏剧状态，Prompt 默认只引入主要角色和当前相关角色。" actions={<button className="primary-button" onClick={addCharacter}>新增角色</button>} />
      <section className="split-layout">
        <aside className="list-pane">
          {characters.map((character) => (
            <button key={character.id} className={character.id === selected?.id ? 'list-item active' : 'list-item'} onClick={() => setSelectedId(character.id)}>
              <strong>{character.name}</strong>
              <span>{character.role || '未设置定位'}</span>
              {character.isMain ? <small>主要角色</small> : null}
            </button>
          ))}
        </aside>
        <div className="editor-pane">
          {!selected ? (
            <EmptyState title="暂无角色" description="创建角色卡后，把基础设定和当前状态分区维护。" />
          ) : (
            <>
              <div className="panel">
                <h2>基础设定</h2>
                <div className="form-grid compact">
                  <TextInput label="角色名" value={selected.name} onChange={(name) => updateCharacter(selected.id, { name })} />
                  <TextInput label="角色定位" value={selected.role} onChange={(role) => updateCharacter(selected.id, { role })} />
                </div>
                <div className="form-grid">
                  <TextArea label="表层目标" value={selected.surfaceGoal} onChange={(surfaceGoal) => updateCharacter(selected.id, { surfaceGoal })} />
                  <TextArea label="深层欲望" value={selected.deepDesire} onChange={(deepDesire) => updateCharacter(selected.id, { deepDesire })} />
                  <TextArea label="核心恐惧" value={selected.coreFear} onChange={(coreFear) => updateCharacter(selected.id, { coreFear })} />
                  <TextArea label="自我欺骗" value={selected.selfDeception} onChange={(selfDeception) => updateCharacter(selected.id, { selfDeception })} />
                  <TextArea label="禁止写法" value={selected.forbiddenWriting} onChange={(forbiddenWriting) => updateCharacter(selected.id, { forbiddenWriting })} />
                </div>
                <div className="row-actions">
                  <Toggle label="主要角色" checked={selected.isMain} onChange={(isMain) => updateCharacter(selected.id, { isMain })} />
                  <button className="danger-button" onClick={() => deleteCharacter(selected)}>
                    删除角色
                  </button>
                </div>
              </div>
              <div className="panel">
                <h2>当前状态</h2>
                <div className="form-grid">
                  <TextArea label="当前知道的信息" value={selected.knownInformation} onChange={(knownInformation) => updateCharacter(selected.id, { knownInformation })} />
                  <TextArea label="当前不知道的信息" value={selected.unknownInformation} onChange={(unknownInformation) => updateCharacter(selected.id, { unknownInformation })} />
                  <TextArea label="与主角关系状态" value={selected.protagonistRelationship} onChange={(protagonistRelationship) => updateCharacter(selected.id, { protagonistRelationship })} />
                  <TextArea label="当前情绪状态" value={selected.emotionalState} onChange={(emotionalState) => updateCharacter(selected.id, { emotionalState })} />
                  <TextArea label="下一阶段行为倾向" value={selected.nextActionTendency} onChange={(nextActionTendency) => updateCharacter(selected.id, { nextActionTendency })} />
                  <NumberInput label="最近一次变化发生章节" value={selected.lastChangedChapter} onChange={(lastChangedChapter) => updateCharacter(selected.id, { lastChangedChapter })} />
                </div>
              </div>
              <div className="panel">
                <h2>角色状态更新记录</h2>
                <div className="inline-form">
                  <select value={logChapter ?? ''} onChange={(event) => setLogChapter(event.target.value ? Number(event.target.value) : null)}>
                    <option value="">未关联章节</option>
                    {chapters.map((chapter) => (
                      <option key={chapter.id} value={chapter.order}>
                        第 {chapter.order} 章
                      </option>
                    ))}
                  </select>
                  <input value={logNote} placeholder="记录这次状态变化" onChange={(event) => setLogNote(event.target.value)} />
                  <button className="primary-button" onClick={() => addStateLog(selected)}>
                    记录
                  </button>
                </div>
                <div className="log-list">
                  {logs.map((log) => (
                    <article key={log.id}>
                      <strong>{log.chapterOrder ? `第 ${log.chapterOrder} 章` : '未关联章节'}</strong>
                      <p>{log.note}</p>
                      <small>{formatDate(log.createdAt)}</small>
                    </article>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  )
}

function expectedPayoffNearText(text: string, targetChapterOrder: number): boolean {
  const numbers = parseChapterNumbersFromText(text)
  return numbers.some((num) => Math.abs(num - targetChapterOrder) <= 3)
}

function recommendedForeshadowings(items: Foreshadowing[], targetChapterOrder: number): Foreshadowing[] {
  return items
    .filter((item) => item.status !== 'resolved' && item.status !== 'abandoned')
    .filter(
      (item) =>
        item.weight === 'medium' ||
        item.weight === 'high' ||
        item.weight === 'payoff' ||
        expectedPayoffNearText(item.expectedPayoff, targetChapterOrder)
    )
}

function recommendedCharacters(characters: Character[], foreshadowings: Foreshadowing[]): Character[] {
  const relatedIds = new Set(foreshadowings.flatMap((item) => item.relatedCharacterIds))
  return characters.filter((character) => character.isMain || relatedIds.has(character.id))
}

const PIPELINE_STEP_ORDER: ChapterGenerationStepType[] = [
  'context_budget_selection',
  'build_context',
  'generate_chapter_plan',
  'generate_chapter_draft',
  'generate_chapter_review',
  'propose_character_updates',
  'propose_foreshadowing_updates',
  'consistency_review',
  'quality_gate',
  'await_user_confirmation'
]

const PIPELINE_STEP_LABELS: Record<ChapterGenerationStepType, string> = {
  context_budget_selection: '上下文预算选择',
  build_context: '构建上下文',
  generate_chapter_plan: '生成任务书',
  generate_chapter_draft: '生成正文',
  generate_chapter_review: '复盘章节',
  propose_character_updates: '提取角色更新',
  propose_foreshadowing_updates: '提取伏笔更新',
  consistency_review: '一致性审稿',
  quality_gate: '质量门禁',
  await_user_confirmation: '等待确认'
}

function serializeOutput(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function parseOutput<T>(value: string, fallback: T): T {
  if (!value.trim()) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function normalizePipelineOptions(
  options: Partial<{
    targetChapterOrder: number
    pipelineMode: PipelineMode
    estimatedWordCount: string
    readerEmotionTarget: string
    budgetMode: ContextBudgetMode
    budgetMaxTokens: number
  }>,
  fallback: {
    targetChapterOrder: number
    pipelineMode: PipelineMode
    estimatedWordCount: string
    readerEmotionTarget: string
    budgetMode: ContextBudgetMode
    budgetMaxTokens: number
  }
) {
  return {
    targetChapterOrder: Number.isFinite(options.targetChapterOrder) ? Number(options.targetChapterOrder) : fallback.targetChapterOrder,
    pipelineMode: options.pipelineMode ?? fallback.pipelineMode,
    estimatedWordCount: options.estimatedWordCount || fallback.estimatedWordCount,
    readerEmotionTarget: options.readerEmotionTarget || fallback.readerEmotionTarget,
    budgetMode: options.budgetMode ?? fallback.budgetMode,
    budgetMaxTokens: Number.isFinite(options.budgetMaxTokens) ? Number(options.budgetMaxTokens) : fallback.budgetMaxTokens
  }
}

function minimumDraftTokens(expectedWordCount: string): number {
  const numbers = [...expectedWordCount.matchAll(/\d+/g)].map((match) => Number(match[0])).filter((value) => Number.isFinite(value))
  const minimumWords = numbers.length > 0 ? Math.min(...numbers) : 2000
  return Math.max(900, Math.min(2400, Math.round(minimumWords * 0.4)))
}

function validateGeneratedChapterDraft(body: string, expectedWordCount: string, strict: boolean): string | null {
  const trimmed = body.trim()
  if (!trimmed) return '正文生成结果为空。'
  if (/^\s*[\[{]/.test(trimmed) && /"(?:body|chapterBody|chapterText|content)"\s*:/.test(trimmed)) {
    return 'AI 返回的是未解析完成的 JSON，而不是可用正文，可能已被截断。'
  }
  if (/【(?:世界规则|人物心理|主线推进|本章目标|角色节拍)】/.test(trimmed) || /^(本章目标|必须推进的冲突|角色节拍)：/m.test(trimmed)) {
    return 'AI 返回的是大纲/任务书摘要，不是章节正文。'
  }
  if (!/[。！？.!?」”]$/.test(trimmed)) {
    return '正文疑似中途截断，结尾没有完整句号或收束标点。'
  }
  if (strict) {
    const tokenEstimate = TokenEstimator.estimate(trimmed)
    const minTokens = minimumDraftTokens(expectedWordCount)
    if (tokenEstimate < minTokens) {
      return `正文过短（约 ${tokenEstimate} token），低于本章预计字数的最低可接受值（约 ${minTokens} token）。`
    }
  }
  return null
}

function createContextBudgetProfile(
  projectId: ID,
  mode: ContextBudgetMode,
  maxTokens: number,
  name = '临时预算方案'
): ContextBudgetProfile {
  const timestamp = now()
  const isLight = mode === 'light'
  const isFull = mode === 'full'
  return {
    id: newId(),
    projectId,
    name,
    maxTokens,
    mode,
    includeRecentChaptersCount: isLight ? 2 : isFull ? 5 : 3,
    includeStageSummariesCount: isLight ? 0 : isFull ? 8 : 2,
    includeMainCharacters: true,
    includeRelatedCharacters: !isLight,
    includeForeshadowingWeights: isLight ? ['high', 'payoff'] : isFull ? ['low', 'medium', 'high', 'payoff'] : ['medium', 'high', 'payoff'],
    includeTimelineEventsCount: isLight ? 0 : isFull ? 20 : 6,
    styleSampleMaxChars: isLight ? 600 : isFull ? 2000 : 1200,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function selectBudgetContext(project: Project, data: AppData, targetChapterOrder: number, budgetProfile: ContextBudgetProfile): ContextSelectionResult {
  const scoped = projectData(data, project.id)
  return ContextBudgetManager.selectContext(
    {
      project,
      bible: scoped.bible,
      chapters: scoped.chapters,
      characters: scoped.characters,
      foreshadowings: scoped.foreshadowings,
      timelineEvents: scoped.timelineEvents,
      stageSummaries: scoped.stageSummaries
    },
    targetChapterOrder,
    budgetProfile
  )
}

function buildPipelineContext(
  project: Project,
  data: AppData,
  targetChapterOrder: number,
  emotion: string,
  wordCount: string,
  budgetProfile?: ContextBudgetProfile
): string {
  const scoped = projectData(data, project.id)
  const autoForeshadowings = recommendedForeshadowings(scoped.foreshadowings, targetChapterOrder)
  const autoCharacters = recommendedCharacters(scoped.characters, autoForeshadowings)
  return PromptBuilderService.build({
    project,
    bible: scoped.bible,
    chapters: scoped.chapters,
    characters: scoped.characters,
    characterStateLogs: scoped.characterStateLogs,
    foreshadowings: scoped.foreshadowings,
    timelineEvents: scoped.timelineEvents,
    stageSummaries: scoped.stageSummaries,
    config: {
      projectId: project.id,
      targetChapterOrder,
      mode: 'standard',
      modules: defaultModulesForMode('standard'),
      task: {
        goal: `生成第 ${targetChapterOrder} 章草稿`,
        conflict: '',
        suspenseToKeep: '',
        allowedPayoffs: '',
        forbiddenPayoffs: '',
        endingHook: '',
        readerEmotion: emotion,
        targetWordCount: wordCount,
        styleRequirement: project.style
      },
      selectedCharacterIds: autoCharacters.map((character) => character.id),
      selectedForeshadowingIds: autoForeshadowings.map((item) => item.id)
    },
    budgetProfile
  })
}

function ForeshadowingView({ data, project, saveData }: ProjectProps) {
  const scoped = projectData(data, project.id)
  const [statusFilter, setStatusFilter] = useState<'all' | ForeshadowingStatus>('all')
  const [weightFilter, setWeightFilter] = useState<'all' | ForeshadowingWeight>('all')
  const [nearChapter, setNearChapter] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<ID | null>(null)
  const foreshadowings = scoped.foreshadowings
    .filter((item) => statusFilter === 'all' || item.status === statusFilter)
    .filter((item) => weightFilter === 'all' || item.weight === weightFilter)
    .filter((item) => !nearChapter || !item.expectedPayoff || expectedPayoffNearText(item.expectedPayoff, nearChapter))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const selected = scoped.foreshadowings.find((item) => item.id === selectedId) ?? foreshadowings[0] ?? null

  async function addForeshadowing() {
    const timestamp = now()
    const item: Foreshadowing = {
      id: newId(),
      projectId: project.id,
      title: '新伏笔',
      firstChapterOrder: null,
      description: '',
      status: 'unresolved',
      weight: 'medium',
      expectedPayoff: '',
      payoffMethod: '',
      relatedCharacterIds: [],
      relatedMainPlot: '',
      notes: '',
      actualPayoffChapter: null,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await saveData({ ...data, projects: updateProjectTimestamp(data, project.id), foreshadowings: [...data.foreshadowings, item] })
    setSelectedId(item.id)
  }

  async function updateForeshadowing(id: ID, patch: Partial<Foreshadowing>) {
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      foreshadowings: data.foreshadowings.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: now() } : item))
    })
  }

  async function deleteForeshadowing(item: Foreshadowing) {
    if (!confirm(`确定删除伏笔「${item.title}」吗？`)) return
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      foreshadowings: data.foreshadowings.filter((candidate) => candidate.id !== item.id)
    })
    setSelectedId(null)
  }

  return (
    <>
      <Header title="伏笔账本" description="不要把所有伏笔都塞进 Prompt，只让当前相关、未回收、中高权重伏笔进入上下文。" actions={<button className="primary-button" onClick={addForeshadowing}>快速新增伏笔</button>} />
      <section className="panel filters">
        <SelectField
          label="状态"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'all', label: '全部' },
            { value: 'unresolved', label: '未回收' },
            { value: 'partial', label: '部分推进' },
            { value: 'resolved', label: '已回收' },
            { value: 'abandoned', label: '废弃' }
          ]}
        />
        <SelectField
          label="权重"
          value={weightFilter}
          onChange={setWeightFilter}
          options={[
            { value: 'all', label: '全部' },
            { value: 'low', label: '低' },
            { value: 'medium', label: '中' },
            { value: 'high', label: '高' },
            { value: 'payoff', label: '回收' }
          ]}
        />
        <NumberInput label="预计回收接近章节" value={nearChapter} onChange={setNearChapter} />
      </section>
      <section className="table-editor">
        <div className="panel table-panel">
          <table>
            <thead>
              <tr>
                <th>标题</th>
                <th>状态</th>
                <th>权重</th>
                <th>预计回收</th>
              </tr>
            </thead>
            <tbody>
              {foreshadowings.map((item) => (
                <tr key={item.id} className={item.id === selected?.id ? 'active-row' : ''} onClick={() => setSelectedId(item.id)}>
                  <td>{item.title}</td>
                  <td>{statusLabel(item.status)}</td>
                  <td>{weightLabel(item.weight)}</td>
                  <td>{item.expectedPayoff || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          {!selected ? (
            <EmptyState title="暂无伏笔" description="新增伏笔后，可维护状态、权重、预计回收章节和关联角色。" />
          ) : (
            <>
              <div className="form-grid compact">
                <TextInput label="伏笔标题" value={selected.title} onChange={(title) => updateForeshadowing(selected.id, { title })} />
                <NumberInput label="首次出现章节" value={selected.firstChapterOrder} onChange={(firstChapterOrder) => updateForeshadowing(selected.id, { firstChapterOrder })} />
                <SelectField<ForeshadowingStatus>
                  label="当前状态"
                  value={selected.status}
                  onChange={(status) => updateForeshadowing(selected.id, { status })}
                  options={[
                    { value: 'unresolved', label: '未回收' },
                    { value: 'partial', label: '部分推进' },
                    { value: 'resolved', label: '已回收' },
                    { value: 'abandoned', label: '废弃' }
                  ]}
                />
                <SelectField<ForeshadowingWeight>
                  label="叙事权重"
                  value={selected.weight}
                  onChange={(weight) => updateForeshadowing(selected.id, { weight })}
                  options={[
                    { value: 'low', label: '低' },
                    { value: 'medium', label: '中' },
                    { value: 'high', label: '高' },
                    { value: 'payoff', label: '回收' }
                  ]}
                />
              </div>
              <TextArea label="伏笔描述" value={selected.description} onChange={(description) => updateForeshadowing(selected.id, { description })} />
              <div className="form-grid">
                <TextArea label="预计回收章节或范围" value={selected.expectedPayoff} onChange={(expectedPayoff) => updateForeshadowing(selected.id, { expectedPayoff })} />
                <TextArea label="回收方式" value={selected.payoffMethod} onChange={(payoffMethod) => updateForeshadowing(selected.id, { payoffMethod })} />
                <TextArea label="关联主线" value={selected.relatedMainPlot} onChange={(relatedMainPlot) => updateForeshadowing(selected.id, { relatedMainPlot })} />
                <TextArea label="注意事项" value={selected.notes} onChange={(notes) => updateForeshadowing(selected.id, { notes })} />
              </div>
              <NumberInput label="实际回收章节" value={selected.actualPayoffChapter} onChange={(actualPayoffChapter) => updateForeshadowing(selected.id, { actualPayoffChapter })} />
              <div className="checkbox-grid">
                {scoped.characters.map((character) => (
                  <Toggle
                    key={character.id}
                    label={character.name}
                    checked={selected.relatedCharacterIds.includes(character.id)}
                    onChange={(checked) => {
                      const ids = checked
                        ? [...selected.relatedCharacterIds, character.id]
                        : selected.relatedCharacterIds.filter((id) => id !== character.id)
                      updateForeshadowing(selected.id, { relatedCharacterIds: ids })
                    }}
                  />
                ))}
              </div>
              <div className="row-actions">
                <button className="danger-button" onClick={() => deleteForeshadowing(selected)}>
                  删除伏笔
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  )
}

function TimelineView({ data, project, saveData }: ProjectProps) {
  const scoped = projectData(data, project.id)
  const events = [...scoped.timelineEvents].sort((a, b) => a.narrativeOrder - b.narrativeOrder)

  async function addEvent() {
    const timestamp = now()
    const event: TimelineEvent = {
      id: newId(),
      projectId: project.id,
      title: '新事件',
      chapterOrder: null,
      storyTime: '',
      narrativeOrder: Math.max(0, ...events.map((item) => item.narrativeOrder)) + 1,
      participantCharacterIds: [],
      result: '',
      downstreamImpact: '',
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await saveData({ ...data, projects: updateProjectTimestamp(data, project.id), timelineEvents: [...data.timelineEvents, event] })
  }

  async function updateEvent(id: ID, patch: Partial<TimelineEvent>) {
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      timelineEvents: data.timelineEvents.map((event) => (event.id === id ? { ...event, ...patch, updatedAt: now() } : event))
    })
  }

  async function deleteEvent(event: TimelineEvent) {
    if (!confirm(`确定删除时间线事件「${event.title}」吗？`)) return
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      timelineEvents: data.timelineEvents.filter((item) => item.id !== event.id)
    })
  }

  return (
    <>
      <Header title="时间线 / 事件系统" description="用故事内时间和真实叙事顺序防止长篇剧情错位。" actions={<button className="primary-button" onClick={addEvent}>新增事件</button>} />
      <section className="panel timeline-list">
        {events.length === 0 ? (
          <EmptyState title="暂无事件" description="记录关键事件、参与角色、结果和后续影响。" />
        ) : (
          events.map((event) => (
            <article key={event.id} className="timeline-item">
              <div className="timeline-head">
                <input value={event.title} onChange={(change) => updateEvent(event.id, { title: change.target.value })} />
                <NumberInput label="叙事顺序" value={event.narrativeOrder} onChange={(narrativeOrder) => updateEvent(event.id, { narrativeOrder: narrativeOrder ?? event.narrativeOrder })} />
                <NumberInput label="所属章节" value={event.chapterOrder} onChange={(chapterOrder) => updateEvent(event.id, { chapterOrder })} />
              </div>
              <div className="form-grid">
                <TextArea label="故事内时间" value={event.storyTime} rows={2} onChange={(storyTime) => updateEvent(event.id, { storyTime })} />
                <TextArea label="事件结果" value={event.result} rows={2} onChange={(result) => updateEvent(event.id, { result })} />
                <TextArea label="对后续剧情的影响" value={event.downstreamImpact} rows={2} onChange={(downstreamImpact) => updateEvent(event.id, { downstreamImpact })} />
              </div>
              <div className="checkbox-grid">
                {scoped.characters.map((character) => (
                  <Toggle
                    key={character.id}
                    label={character.name}
                    checked={event.participantCharacterIds.includes(character.id)}
                    onChange={(checked) => {
                      const ids = checked
                        ? [...event.participantCharacterIds, character.id]
                        : event.participantCharacterIds.filter((id) => id !== character.id)
                      updateEvent(event.id, { participantCharacterIds: ids })
                    }}
                  />
                ))}
              </div>
              <button className="danger-button" onClick={() => deleteEvent(event)}>
                删除事件
              </button>
            </article>
          ))
        )}
      </section>
    </>
  )
}

function StageSummaryView({ data, project, saveData }: ProjectProps) {
  const scoped = projectData(data, project.id)
  const chapters = [...scoped.chapters].sort((a, b) => a.order - b.order)
  const summaries = [...scoped.stageSummaries].sort((a, b) => a.chapterStart - b.chapterStart)
  const [chapterStart, setChapterStart] = useState(1)
  const [chapterEnd, setChapterEnd] = useState(3)
  const aiService = useMemo(() => new AIService(), [])

  async function generateDraft() {
    const selectedChapters = chapters.filter((chapter) => chapter.order >= chapterStart && chapter.order <= chapterEnd)
    if (selectedChapters.length === 0) return
    const draft = await aiService.generateStageSummary(selectedChapters)
    const timestamp = now()
    const summary: StageSummary = { ...draft, id: newId(), projectId: project.id, createdAt: timestamp, updatedAt: timestamp }
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      stageSummaries: [...data.stageSummaries, summary],
      chapters: data.chapters.map((chapter) =>
        chapter.projectId === project.id && chapter.order >= chapterStart && chapter.order <= chapterEnd
          ? { ...chapter, includedInStageSummary: true, updatedAt: now() }
          : chapter
      )
    })
  }

  async function updateSummary(id: ID, patch: Partial<StageSummary>) {
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      stageSummaries: data.stageSummaries.map((summary) => (summary.id === id ? { ...summary, ...patch, updatedAt: now() } : summary))
    })
  }

  async function deleteSummary(summary: StageSummary) {
    if (!confirm(`确定删除第 ${summary.chapterStart}-${summary.chapterEnd} 章阶段摘要吗？`)) return
    const remaining = data.stageSummaries.filter((item) => item.id !== summary.id)
    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      stageSummaries: remaining,
      chapters: data.chapters.map((chapter) => {
        if (chapter.projectId !== project.id) return chapter
        const stillCovered = remaining.some(
          (item) => item.projectId === project.id && chapter.order >= item.chapterStart && chapter.order <= item.chapterEnd
        )
        return { ...chapter, includedInStageSummary: stillCovered, updatedAt: now() }
      })
    })
  }

  return (
    <>
      <Header title="滚动阶段摘要" description="阶段摘要用于替代旧章节详细信息，避免 Prompt 越写越长。" />
      <section className="panel inline-form stage-builder">
        <NumberInput label="起始章节" value={chapterStart} min={1} onChange={(value) => setChapterStart(clampNumber(value ?? 1, 1))} />
        <NumberInput label="结束章节" value={chapterEnd} min={1} onChange={(value) => setChapterEnd(clampNumber(value ?? 3, 3))} />
        <button className="primary-button" onClick={generateDraft}>
          从选中章节生成阶段摘要草稿
        </button>
      </section>
      <section className="summary-list">
        {summaries.length === 0 ? (
          <EmptyState title="暂无阶段摘要" description="建议每 3 章生成一次阶段摘要，用它替代旧章节细节。" />
        ) : (
          summaries.map((summary) => (
            <article key={summary.id} className="panel">
              <div className="form-grid compact">
                <NumberInput label="覆盖起始章" value={summary.chapterStart} onChange={(chapterStart) => updateSummary(summary.id, { chapterStart: chapterStart ?? summary.chapterStart })} />
                <NumberInput label="覆盖结束章" value={summary.chapterEnd} onChange={(chapterEnd) => updateSummary(summary.id, { chapterEnd: chapterEnd ?? summary.chapterEnd })} />
              </div>
              <div className="form-grid">
                <TextArea label="阶段剧情进展" value={summary.plotProgress} onChange={(plotProgress) => updateSummary(summary.id, { plotProgress })} />
                <TextArea label="主要角色关系变化" value={summary.characterRelations} onChange={(characterRelations) => updateSummary(summary.id, { characterRelations })} />
                <TextArea label="关键秘密/信息差" value={summary.secrets} onChange={(secrets) => updateSummary(summary.id, { secrets })} />
                <TextArea label="已埋伏笔" value={summary.foreshadowingPlanted} onChange={(foreshadowingPlanted) => updateSummary(summary.id, { foreshadowingPlanted })} />
                <TextArea label="已回收伏笔" value={summary.foreshadowingResolved} onChange={(foreshadowingResolved) => updateSummary(summary.id, { foreshadowingResolved })} />
                <TextArea label="当前未解决问题" value={summary.unresolvedQuestions} onChange={(unresolvedQuestions) => updateSummary(summary.id, { unresolvedQuestions })} />
                <TextArea label="下一阶段推荐推进方向" value={summary.nextStageDirection} onChange={(nextStageDirection) => updateSummary(summary.id, { nextStageDirection })} />
              </div>
              <button className="danger-button" onClick={() => deleteSummary(summary)}>
                删除阶段摘要
              </button>
            </article>
          ))
        )}
      </section>
    </>
  )
}

function PromptBuilderView({ data, project, saveData }: ProjectProps) {
  const scoped = projectData(data, project.id)
  const nextChapter = Math.max(0, ...scoped.chapters.map((chapter) => chapter.order)) + 1
  const [targetChapterOrder, setTargetChapterOrder] = useState(nextChapter)
  const [mode, setMode] = useState<PromptMode>(data.settings.defaultPromptMode)
  const [modules, setModules] = useState<PromptModuleSelection>(defaultModulesForMode(data.settings.defaultPromptMode))
  const [task, setTask] = useState<ChapterTask>(createEmptyChapterTask())
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<ID[]>([])
  const [selectedForeshadowingIds, setSelectedForeshadowingIds] = useState<ID[]>([])
  const [prompt, setPrompt] = useState('')
  const [budgetMode, setBudgetMode] = useState<ContextBudgetMode>(data.settings.defaultPromptMode)
  const [budgetMaxTokens, setBudgetMaxTokens] = useState(data.settings.defaultTokenBudget)
  const tokenEstimate = TokenEstimator.estimate(prompt)
  const advice = TokenEstimator.compressionAdvice(tokenEstimate, budgetMaxTokens)
  const budgetProfile = useMemo(
    () => createContextBudgetProfile(project.id, budgetMode, budgetMaxTokens, 'Prompt 构建器预算'),
    [project.id, budgetMode, budgetMaxTokens]
  )
  const budgetSelection = useMemo(
    () => selectBudgetContext(project, data, targetChapterOrder, budgetProfile),
    [project, data, targetChapterOrder, budgetProfile]
  )

  const autoForeshadowings = useMemo(
    () => recommendedForeshadowings(scoped.foreshadowings, targetChapterOrder),
    [scoped.foreshadowings, targetChapterOrder]
  )
  const autoCharacters = useMemo(
    () => recommendedCharacters(scoped.characters, autoForeshadowings),
    [scoped.characters, autoForeshadowings]
  )

  function resetAutomaticSelection() {
    setSelectedForeshadowingIds(autoForeshadowings.map((item) => item.id))
    setSelectedCharacterIds(autoCharacters.map((item) => item.id))
  }

  useEffect(() => {
    resetAutomaticSelection()
  }, [project.id, targetChapterOrder])

  function changeMode(nextMode: PromptMode) {
    setMode(nextMode)
    setBudgetMode(nextMode)
    setModules(defaultModulesForMode(nextMode))
  }

  function toggleId(list: ID[], id: ID, checked: boolean): ID[] {
    return checked ? [...new Set([...list, id])] : list.filter((item) => item !== id)
  }

  function generatePrompt() {
    const content = PromptBuilderService.build({
      project,
      bible: scoped.bible,
      chapters: scoped.chapters,
      characters: scoped.characters,
      characterStateLogs: scoped.characterStateLogs,
      foreshadowings: scoped.foreshadowings,
      timelineEvents: scoped.timelineEvents,
      stageSummaries: scoped.stageSummaries,
      budgetProfile,
      config: {
        projectId: project.id,
        targetChapterOrder,
        mode,
        modules,
        task,
        selectedCharacterIds,
        selectedForeshadowingIds
      }
    })
    setPrompt(content)
  }

  async function copyPrompt() {
    if (!prompt.trim()) return
    await window.novelAPI.writeClipboard(prompt)
  }

  async function savePromptVersion() {
    if (!prompt.trim()) return
    await saveData({
      ...data,
      promptVersions: [
        {
          id: newId(),
          projectId: project.id,
          targetChapterOrder,
          title: `第 ${targetChapterOrder} 章 ${modeLabel(mode)} ${formatDate(now())}`,
          mode,
          content: prompt,
          tokenEstimate,
          moduleSelection: modules,
          task,
          createdAt: now()
        },
        ...data.promptVersions
      ]
    })
  }

  async function deletePromptVersion(id: ID) {
    if (!confirm('确定删除这个 Prompt 版本吗？')) return
    await saveData({ ...data, promptVersions: data.promptVersions.filter((version) => version.id !== id) })
  }

  return (
    <>
      <Header title="Prompt 构建器" description="选择目标章节和上下文模块，生成可复制、可保存版本的结构化写作 Prompt。" />
      <section className="prompt-layout">
        <aside className="panel prompt-controls">
          <NumberInput label="准备写第 N 章" value={targetChapterOrder} min={1} onChange={(value) => setTargetChapterOrder(value ?? 1)} />
          <SelectField<PromptMode>
            label="Prompt 模式"
            value={mode}
            onChange={changeMode}
            options={[
              { value: 'light', label: '轻量模式' },
              { value: 'standard', label: '标准模式' },
              { value: 'full', label: '完整模式' }
            ]}
          />
          <SelectField<ContextBudgetMode>
            label="记忆预算模式"
            value={budgetMode}
            onChange={setBudgetMode}
            options={[
              { value: 'light', label: '轻量' },
              { value: 'standard', label: '标准' },
              { value: 'full', label: '完整' },
              { value: 'custom', label: '自定义' }
            ]}
          />
          <NumberInput
            label="上下文预算 token"
            min={1000}
            value={budgetMaxTokens}
            onChange={(value) => setBudgetMaxTokens(value ?? data.settings.defaultTokenBudget)}
          />
          <div className="module-box">
            <h3>上下文模块</h3>
            {(Object.keys(modules) as Array<keyof PromptModuleSelection>).map((key) => (
              <Toggle
                key={key}
                label={
                  {
                    bible: '全书核心设定',
                    progress: '当前剧情进度',
                    recentChapters: '最近章节回顾',
                    characters: '主要角色状态',
                    foreshadowing: '当前相关伏笔',
                    stageSummaries: '阶段摘要档案',
                    timeline: '时间线校验',
                    chapterTask: '当前章节任务书',
                    forbidden: '本章禁止事项',
                    outputFormat: '输出格式要求'
                  }[key]
                }
                checked={modules[key]}
                onChange={(checked) => setModules({ ...modules, [key]: checked })}
              />
            ))}
          </div>
          <button className="ghost-button" onClick={resetAutomaticSelection}>
            恢复自动推荐
          </button>
          <div className="token-box">
            <span>预计 token</span>
            <strong className={tokenEstimate > budgetMaxTokens ? 'over-budget' : ''}>{tokenEstimate}</strong>
            <small>预算：{budgetMaxTokens}</small>
          </div>
          <ul className="advice-list">
            {advice.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </aside>
        <div className="prompt-main">
          <section className="panel">
            <h2>记忆预算调度</h2>
            <p className="muted">{ContextBudgetManager.explainSelection(budgetSelection)}</p>
            <div className="metric-grid">
              <article>
                <span>预算上限</span>
                <strong>{budgetProfile.maxTokens}</strong>
              </article>
              <article>
                <span>实际估算</span>
                <strong className={budgetSelection.estimatedTokens > budgetProfile.maxTokens ? 'over-budget' : ''}>
                  {budgetSelection.estimatedTokens}
                </strong>
              </article>
              <article>
                <span>纳入章节</span>
                <strong>{budgetSelection.selectedChapterIds.length}</strong>
              </article>
              <article>
                <span>纳入伏笔</span>
                <strong>{budgetSelection.selectedForeshadowingIds.length}</strong>
              </article>
            </div>
            <div className="budget-columns">
              <div>
                <h3>已选择内容</h3>
                <ul className="advice-list">
                  <li>章节：{scoped.chapters.filter((chapter) => budgetSelection.selectedChapterIds.includes(chapter.id)).map((chapter) => `第 ${chapter.order} 章`).join('、') || '无'}</li>
                  <li>角色：{scoped.characters.filter((character) => budgetSelection.selectedCharacterIds.includes(character.id)).map((character) => character.name).join('、') || '无'}</li>
                  <li>伏笔：{scoped.foreshadowings.filter((item) => budgetSelection.selectedForeshadowingIds.includes(item.id)).map((item) => item.title).join('、') || '无'}</li>
                </ul>
              </div>
              <div>
                <h3>省略与风险</h3>
                <ul className="advice-list">
                  {budgetSelection.omittedItems.slice(0, 6).map((item, index) => (
                    <li key={`${item.type}-${item.id ?? index}`}>{item.type}：{item.reason}</li>
                  ))}
                  {budgetSelection.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
          <section className="panel">
            <h2>手动选择本章相关角色</h2>
            <div className="checkbox-grid">
              {scoped.characters.map((character) => (
                <Toggle
                  key={character.id}
                  label={`${character.name}${autoCharacters.some((item) => item.id === character.id) ? '（自动推荐）' : ''}`}
                  checked={selectedCharacterIds.includes(character.id)}
                  onChange={(checked) => setSelectedCharacterIds(toggleId(selectedCharacterIds, character.id, checked))}
                />
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>手动选择本章相关伏笔</h2>
            <div className="checkbox-grid">
              {scoped.foreshadowings.map((item) => (
                <Toggle
                  key={item.id}
                  label={`${item.title}${autoForeshadowings.some((auto) => auto.id === item.id) ? '（自动推荐）' : ''}`}
                  checked={selectedForeshadowingIds.includes(item.id)}
                  onChange={(checked) => setSelectedForeshadowingIds(toggleId(selectedForeshadowingIds, item.id, checked))}
                />
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>当前章节任务书</h2>
            <div className="form-grid">
              <TextArea label="本章目标" value={task.goal} onChange={(goal) => setTask({ ...task, goal })} />
              <TextArea label="本章必须推进的冲突" value={task.conflict} onChange={(conflict) => setTask({ ...task, conflict })} />
              <TextArea label="本章必须保留的悬念" value={task.suspenseToKeep} onChange={(suspenseToKeep) => setTask({ ...task, suspenseToKeep })} />
              <TextArea label="本章允许回收的伏笔" value={task.allowedPayoffs} onChange={(allowedPayoffs) => setTask({ ...task, allowedPayoffs })} />
              <TextArea label="本章禁止回收的伏笔" value={task.forbiddenPayoffs} onChange={(forbiddenPayoffs) => setTask({ ...task, forbiddenPayoffs })} />
              <TextArea label="本章结尾钩子" value={task.endingHook} onChange={(endingHook) => setTask({ ...task, endingHook })} />
              <TextArea label="本章读者应该产生的情绪" value={task.readerEmotion} onChange={(readerEmotion) => setTask({ ...task, readerEmotion })} />
              <TextInput label="本章预计字数" value={task.targetWordCount} onChange={(targetWordCount) => setTask({ ...task, targetWordCount })} />
              <TextArea label="文风要求" value={task.styleRequirement} onChange={(styleRequirement) => setTask({ ...task, styleRequirement })} />
            </div>
            <div className="row-actions">
              <button className="primary-button" onClick={generatePrompt}>
                生成 Prompt
              </button>
              <button className="ghost-button" onClick={copyPrompt}>
                复制 Prompt
              </button>
              <button className="ghost-button" onClick={savePromptVersion}>
                保存版本
              </button>
            </div>
          </section>
          <section className="panel prompt-editor-panel">
            <h2>最终 Prompt</h2>
            <textarea className="prompt-editor" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          </section>
          <section className="panel">
            <h2>已保存版本</h2>
            <div className="version-list">
              {scoped.promptVersions.map((version) => (
                <div key={version.id} className="version-row">
                  <button onClick={() => setPrompt(version.content)}>
                    <strong>{version.title}</strong>
                    <span>
                      {version.tokenEstimate} token · {formatDate(version.createdAt)}
                    </span>
                  </button>
                  <button className="danger-button" onClick={() => deletePromptVersion(version.id)}>
                    删除版本
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </>
  )
}

function PipelineView({ data, project, saveData }: ProjectProps) {
  const scoped = projectData(data, project.id)
  const nextChapter = Math.max(0, ...scoped.chapters.map((chapter) => chapter.order)) + 1
  const [targetChapterOrder, setTargetChapterOrder] = useState(nextChapter)
  const [pipelineMode, setPipelineMode] = useState<PipelineMode>('standard')
  const [estimatedWordCount, setEstimatedWordCount] = useState('3000-5000')
  const [readerEmotionTarget, setReaderEmotionTarget] = useState('期待、紧张、好奇')
  const [budgetMode, setBudgetMode] = useState<ContextBudgetMode>(data.settings.defaultPromptMode)
  const [budgetMaxTokens, setBudgetMaxTokens] = useState(data.settings.defaultTokenBudget)
  const [selectedJobId, setSelectedJobId] = useState<ID | null>(scoped.chapterGenerationJobs[0]?.id ?? null)
  const aiService = useMemo(() => new AIService(data.settings), [data.settings])

  const jobs = [...scoped.chapterGenerationJobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null
  const selectedSteps = selectedJob
    ? data.chapterGenerationSteps
        .filter((step) => step.jobId === selectedJob.id)
        .sort((a, b) => PIPELINE_STEP_ORDER.indexOf(a.type) - PIPELINE_STEP_ORDER.indexOf(b.type))
    : []
  const selectedDrafts = selectedJob ? scoped.generatedChapterDrafts.filter((draft) => draft.jobId === selectedJob.id) : []
  const selectedCandidates = selectedJob ? scoped.memoryUpdateCandidates.filter((candidate) => candidate.jobId === selectedJob.id) : []
  const selectedReports = selectedJob ? scoped.consistencyReviewReports.filter((report) => report.jobId === selectedJob.id) : []
  const selectedQualityReports = selectedJob ? scoped.qualityGateReports.filter((report) => report.jobId === selectedJob.id) : []
  const selectedRevisionCandidates = selectedJob ? scoped.revisionCandidates.filter((candidate) => candidate.jobId === selectedJob.id) : []
  const latestDraft = selectedDrafts[0] ?? null
  const latestQualityReport = latestDraft
    ? selectedQualityReports.find((report) => report.draftId === latestDraft.id) ?? selectedQualityReports[0] ?? null
    : selectedQualityReports[0] ?? null

  function makeInitialSteps(jobId: ID): ChapterGenerationStep[] {
    const timestamp = now()
    return PIPELINE_STEP_ORDER.map((type) => ({
      id: newId(),
      jobId,
      type,
      status: 'pending',
      inputSnapshot: '',
      output: '',
      errorMessage: '',
      createdAt: timestamp,
      updatedAt: timestamp
    }))
  }

  async function persistWorking(next: AppData, statusMessage?: string): Promise<AppData> {
    await saveData(next)
    if (statusMessage) {
      // saveData owns the visible status; this keeps the call sites readable.
      void statusMessage
    }
    return next
  }

  function updateStepInData(
    working: AppData,
    stepId: ID,
    patch: Partial<ChapterGenerationStep>,
    jobPatch: Partial<ChapterGenerationJob> = {}
  ): AppData {
    const timestamp = now()
    const step = working.chapterGenerationSteps.find((item) => item.id === stepId)
    return {
      ...working,
      chapterGenerationSteps: working.chapterGenerationSteps.map((item) =>
        item.id === stepId ? { ...item, ...patch, updatedAt: timestamp } : item
      ),
      chapterGenerationJobs: working.chapterGenerationJobs.map((job) =>
        step && job.id === step.jobId ? { ...job, ...jobPatch, updatedAt: timestamp } : job
      )
    }
  }

  async function runPipeline() {
    const timestamp = now()
    const job: ChapterGenerationJob = {
      id: newId(),
      projectId: project.id,
      targetChapterOrder,
      status: 'running',
      currentStep: 'context_budget_selection',
      createdAt: timestamp,
      updatedAt: timestamp,
      errorMessage: ''
    }
    const steps = makeInitialSteps(job.id)
    let working: AppData = {
      ...data,
      chapterGenerationJobs: [job, ...data.chapterGenerationJobs],
      chapterGenerationSteps: [...data.chapterGenerationSteps, ...steps]
    }
    await persistWorking(working)
    setSelectedJobId(job.id)
    await runPipelineFromStep(working, job.id, 'context_budget_selection', {
      targetChapterOrder,
      pipelineMode,
      estimatedWordCount,
      readerEmotionTarget,
      budgetMode,
      budgetMaxTokens
    })
  }

  async function skipStep(job: ChapterGenerationJob, step: ChapterGenerationStep) {
    await saveData(
      updateStepInData(data, step.id, { status: 'skipped', errorMessage: '' }, { currentStep: step.type, status: job.status })
    )
  }

  async function retryStep(job: ChapterGenerationJob, stepType: ChapterGenerationStepType) {
    const firstStep = data.chapterGenerationSteps.find((step) => step.jobId === job.id && step.type === stepType)
    if (!firstStep) return
    const fallbackOptions = { targetChapterOrder: job.targetChapterOrder, pipelineMode, estimatedWordCount, readerEmotionTarget, budgetMode, budgetMaxTokens }
    const options = normalizePipelineOptions(parseOutput(firstStep.inputSnapshot, fallbackOptions), fallbackOptions)
    await runPipelineFromStep(data, job.id, stepType, options)
  }

  async function runPipelineFromStep(
    initialData: AppData,
    jobId: ID,
    fromStep: ChapterGenerationStepType,
    inputOptions: {
      targetChapterOrder: number
      pipelineMode: PipelineMode
      estimatedWordCount: string
      readerEmotionTarget: string
      budgetMode: ContextBudgetMode
      budgetMaxTokens: number
    }
  ) {
    let working = initialData
    const job = working.chapterGenerationJobs.find((item) => item.id === jobId)
    if (!job) return
    const options = normalizePipelineOptions(inputOptions, {
      targetChapterOrder: job?.targetChapterOrder ?? targetChapterOrder,
      pipelineMode,
      estimatedWordCount,
      readerEmotionTarget,
      budgetMode,
      budgetMaxTokens
    })
    let context = ''
    let plan: ChapterPlan | null = null
    let draftResult: ChapterDraftResult | null = null
    const steps = working.chapterGenerationSteps.filter((step) => step.jobId === jobId)
    const startIndex = PIPELINE_STEP_ORDER.indexOf(fromStep)

    const contextStep = steps.find((step) => step.type === 'build_context')
    if (contextStep?.output) context = contextStep.output
    const planStep = steps.find((step) => step.type === 'generate_chapter_plan')
    if (planStep?.output) plan = parseOutput<ChapterPlan | null>(planStep.output, null)
    const draftStep = steps.find((step) => step.type === 'generate_chapter_draft')
    if (draftStep?.output) draftResult = parseOutput<ChapterDraftResult | null>(draftStep.output, null)
    let draftRecord =
      working.generatedChapterDrafts.find((draft) => draft.jobId === jobId && draft.status === 'draft') ??
      working.generatedChapterDrafts.find((draft) => draft.jobId === jobId) ??
      null
    let budgetProfile = createContextBudgetProfile(project.id, options.budgetMode, options.budgetMaxTokens, `第 ${options.targetChapterOrder} 章流水线预算`)
    let budgetSelection: ContextSelectionResult | null = null
    const budgetStep = steps.find((step) => step.type === 'context_budget_selection')
    if (budgetStep?.output) {
      const savedBudget = parseOutput<{ profile?: ContextBudgetProfile; selection?: ContextSelectionResult } | null>(budgetStep.output, null)
      if (savedBudget?.profile) budgetProfile = savedBudget.profile
      if (savedBudget?.selection) budgetSelection = savedBudget.selection
    }

    for (const type of PIPELINE_STEP_ORDER.slice(startIndex)) {
      const step = steps.find((item) => item.type === type)
      if (!step) continue
      working = updateStepInData(
        working,
        step.id,
        { status: 'running', inputSnapshot: serializeOutput(options), errorMessage: '' },
        { status: 'running', currentStep: type, errorMessage: '' }
      )
      await persistWorking(working)

      try {
        if (type === 'context_budget_selection') {
          budgetProfile = createContextBudgetProfile(project.id, options.budgetMode, options.budgetMaxTokens, `第 ${options.targetChapterOrder} 章流水线预算`)
          budgetSelection = selectBudgetContext(project, working, options.targetChapterOrder, budgetProfile)
          working = {
            ...updateStepInData(working, step.id, {
              status: 'completed',
              output: serializeOutput({ profile: budgetProfile, selection: budgetSelection, explanation: ContextBudgetManager.explainSelection(budgetSelection) })
            }),
            contextBudgetProfiles: [budgetProfile, ...working.contextBudgetProfiles]
          }
        }

        if (type === 'build_context') {
          if (!budgetSelection) {
            budgetSelection = selectBudgetContext(project, working, options.targetChapterOrder, budgetProfile)
          }
          context = buildPipelineContext(
            project,
            working,
            options.targetChapterOrder,
            options.readerEmotionTarget,
            options.estimatedWordCount,
            budgetProfile
          )
          working = updateStepInData(working, step.id, { status: 'completed', output: context })
        }

        if (type === 'generate_chapter_plan') {
          const result = await aiService.generateChapterPlan(context, {
            mode: options.pipelineMode,
            targetChapterOrder: options.targetChapterOrder,
            estimatedWordCount: options.estimatedWordCount,
            readerEmotionTarget: options.readerEmotionTarget
          })
          if (!result.data) throw new Error(result.error || result.parseError || '任务书生成失败')
          plan = result.data
          working = updateStepInData(working, step.id, { status: 'completed', output: serializeOutput(result.data) })
        }

        if (type === 'generate_chapter_draft') {
          if (!plan) throw new Error('缺少章节任务书，无法生成正文')
          let result = await aiService.generateChapterDraft(plan, context, {
            mode: options.pipelineMode,
            estimatedWordCount: options.estimatedWordCount,
            readerEmotionTarget: options.readerEmotionTarget
          })
          if (!result.data) throw new Error(result.error || result.parseError || '正文生成失败')
          let validationError = validateGeneratedChapterDraft(result.data.body, options.estimatedWordCount, result.usedAI)
          if (validationError && result.usedAI) {
            result = await aiService.generateChapterDraft(plan, context, {
              mode: options.pipelineMode,
              estimatedWordCount: options.estimatedWordCount,
              readerEmotionTarget: options.readerEmotionTarget,
              retryReason: validationError
            })
            if (!result.data) throw new Error(result.error || result.parseError || '正文重新生成失败')
            validationError = validateGeneratedChapterDraft(result.data.body, options.estimatedWordCount, result.usedAI)
          }
          if (validationError) {
            throw new Error(`${validationError} 请重试，或提高设置页 Max Tokens。`)
          }
          draftResult = result.data
          const draft: GeneratedChapterDraft = {
            id: newId(),
            projectId: project.id,
            chapterId: null,
            jobId,
            title: result.data.title,
            body: result.data.body,
            summary: plan.chapterGoal,
            status: 'draft',
            tokenEstimate: TokenEstimator.estimate(result.data.body),
            createdAt: now(),
            updatedAt: now()
          }
          draftRecord = draft
          working = {
            ...updateStepInData(working, step.id, { status: 'completed', output: serializeOutput(result.data) }),
            generatedChapterDrafts: [draft, ...working.generatedChapterDrafts]
          }
        }

        if (type === 'generate_chapter_review') {
          if (!draftResult) throw new Error('缺少章节正文草稿，无法复盘')
          const result = await aiService.generateChapterReview(draftResult.body, context)
          if (!result.data) throw new Error(result.error || result.parseError || '复盘生成失败')
          const candidate: MemoryUpdateCandidate = {
            id: newId(),
            projectId: project.id,
            jobId,
            type: 'chapter_review',
            targetId: null,
            proposedPatch: serializeOutput(result.data),
            evidence: 'AI 对生成正文的章节复盘草稿',
            confidence: result.usedAI ? 0.75 : 0,
            status: 'pending',
            createdAt: now(),
            updatedAt: now()
          }
          working = {
            ...updateStepInData(working, step.id, { status: 'completed', output: serializeOutput(result.data) }),
            memoryUpdateCandidates: [candidate, ...working.memoryUpdateCandidates]
          }
        }

        if (type === 'propose_character_updates') {
          if (!draftResult) throw new Error('缺少章节正文草稿，无法提取角色更新')
          const result = await aiService.updateCharacterStates(draftResult.body, scoped.characters, context)
          if (!result.data) throw new Error(result.error || result.parseError || '角色更新提取失败')
          const candidates: MemoryUpdateCandidate[] = result.data.map((suggestion) => ({
            id: newId(),
            projectId: project.id,
            jobId,
            type: 'character',
            targetId: suggestion.characterId,
            proposedPatch: serializeOutput(suggestion),
            evidence: suggestion.changeSummary,
            confidence: suggestion.confidence,
            status: 'pending',
            createdAt: now(),
            updatedAt: now()
          }))
          working = {
            ...updateStepInData(working, step.id, { status: 'completed', output: serializeOutput(result.data) }),
            memoryUpdateCandidates: [...candidates, ...working.memoryUpdateCandidates]
          }
        }

        if (type === 'propose_foreshadowing_updates') {
          if (!draftResult) throw new Error('缺少章节正文草稿，无法提取伏笔更新')
          const result = await aiService.extractForeshadowing(draftResult.body, scoped.foreshadowings, context, scoped.characters)
          if (!result.data) throw new Error(result.error || result.parseError || '伏笔更新提取失败')
          const newCandidates: MemoryUpdateCandidate[] = result.data.newForeshadowingCandidates.map((candidate) => ({
            id: newId(),
            projectId: project.id,
            jobId,
            type: 'foreshadowing',
            targetId: null,
            proposedPatch: serializeOutput({ kind: 'new', candidate }),
            evidence: candidate.description,
            confidence: result.usedAI ? 0.7 : 0,
            status: 'pending',
            createdAt: now(),
            updatedAt: now()
          }))
          const changeCandidates: MemoryUpdateCandidate[] = result.data.statusChanges.map((change) => ({
            id: newId(),
            projectId: project.id,
            jobId,
            type: 'foreshadowing',
            targetId: change.foreshadowingId,
            proposedPatch: serializeOutput({ kind: 'status', change }),
            evidence: change.evidenceText,
            confidence: change.confidence,
            status: 'pending',
            createdAt: now(),
            updatedAt: now()
          }))
          working = {
            ...updateStepInData(working, step.id, { status: 'completed', output: serializeOutput(result.data) }),
            memoryUpdateCandidates: [...newCandidates, ...changeCandidates, ...working.memoryUpdateCandidates]
          }
        }

        if (type === 'consistency_review') {
          if (!draftResult) throw new Error('缺少章节正文草稿，无法审稿')
          const result = await aiService.generateConsistencyReview(draftResult, context)
          if (!result.data) throw new Error(result.error || result.parseError || '一致性审稿失败')
          const report: ConsistencyReviewReport = {
            id: newId(),
            projectId: project.id,
            jobId,
            chapterId: null,
            issues: serializeOutput(result.data.issues.length ? result.data.issues : result.data),
            suggestions: result.data.suggestions.join('\n'),
            severitySummary: result.data.severitySummary,
            createdAt: now()
          }
          working = {
            ...updateStepInData(working, step.id, { status: 'completed', output: serializeOutput(result.data) }),
            consistencyReviewReports: [report, ...working.consistencyReviewReports]
          }
        }

        if (type === 'quality_gate') {
          if (!draftResult) throw new Error('缺少章节正文草稿，无法执行质量门禁')
          const report = await QualityGateService.evaluateChapterDraft({
            projectId: project.id,
            jobId,
            chapterId: draftRecord?.chapterId ?? null,
            draftId: draftRecord?.id ?? null,
            chapterDraft: draftRecord ?? draftResult,
            context,
            chapterPlan: plan,
            aiService
          })
          working = {
            ...updateStepInData(working, step.id, { status: 'completed', output: serializeOutput(report) }),
            qualityGateReports: [report, ...working.qualityGateReports]
          }
        }

        if (type === 'await_user_confirmation') {
          working = updateStepInData(working, step.id, { status: 'completed', output: '等待用户确认章节草稿和记忆更新候选。' }, { status: 'completed', currentStep: type })
        }

        await persistWorking(working)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        working = updateStepInData(working, step.id, { status: 'failed', errorMessage: message }, { status: 'failed', errorMessage: message })
        await persistWorking(working)
        break
      }
    }
  }

  async function acceptDraft(draft: GeneratedChapterDraft) {
    const report = scoped.qualityGateReports.find((item) => item.draftId === draft.id) ?? null
    if (report && !report.pass) {
      const forced = confirm(`质量门禁未通过（${report.overallScore} 分）。确认仍要进入章节草稿吗？`)
      if (!forced) return
      if (!confirm('再次确认：低分草稿可能导致后续复盘和记忆候选质量下降。是否强制接受？')) return
    }
    const existing = scoped.chapters.find((chapter) => chapter.order === selectedJob?.targetChapterOrder)
    const timestamp = now()
    let chapterId = existing?.id ?? newId()
    let nextChapters: Chapter[]

    if (existing) {
      if (!confirm(`第 ${existing.order} 章已存在，是否覆盖标题和正文？取消则保留草稿不写入章节。`)) return
      nextChapters = data.chapters.map((chapter) =>
        chapter.id === existing.id
          ? { ...chapter, title: draft.title, body: draft.body, updatedAt: timestamp }
          : chapter
      )
      chapterId = existing.id
    } else {
      nextChapters = [
        ...data.chapters,
        {
          id: chapterId,
          projectId: project.id,
          order: selectedJob?.targetChapterOrder ?? targetChapterOrder,
          title: draft.title,
          body: draft.body,
          summary: draft.summary,
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
      ]
    }

    await saveData({
      ...data,
      projects: updateProjectTimestamp(data, project.id),
      chapters: nextChapters,
      generatedChapterDrafts: data.generatedChapterDrafts.map((item) =>
        item.id === draft.id ? { ...item, chapterId, status: 'accepted', updatedAt: timestamp } : item
      ),
      consistencyReviewReports: data.consistencyReviewReports.map((report) =>
        report.jobId === draft.jobId ? { ...report, chapterId } : report
      ),
      qualityGateReports: data.qualityGateReports.map((report) =>
        report.jobId === draft.jobId ? { ...report, chapterId, draftId: draft.id } : report
      )
    })
  }

  async function rejectDraft(draft: GeneratedChapterDraft) {
    await saveData({
      ...data,
      generatedChapterDrafts: data.generatedChapterDrafts.map((item) =>
        item.id === draft.id ? { ...item, status: 'rejected', updatedAt: now() } : item
      )
    })
  }

  async function applyCandidate(candidate: MemoryUpdateCandidate) {
    const report = scoped.qualityGateReports.find((item) => item.jobId === candidate.jobId && !item.pass) ?? null
    if (report) {
      const ok = confirm(`该流水线质量门禁未通过（${report.overallScore} 分）。确认仍要应用这条长期记忆更新吗？`)
      if (!ok) return
    }
    const timestamp = now()
    let nextData = data

    if (candidate.type === 'chapter_review') {
      const review = parseOutput<ChapterReviewDraft | null>(candidate.proposedPatch, null)
      const targetChapter = scoped.chapters.find((chapter) => chapter.order === selectedJob?.targetChapterOrder) ?? null
      if (!review || !targetChapter) return
      nextData = {
        ...nextData,
        chapters: nextData.chapters.map((chapter) => (chapter.id === targetChapter.id ? { ...chapter, ...review, updatedAt: timestamp } : chapter))
      }
    }

    if (candidate.type === 'character') {
      const suggestion = parseOutput<CharacterStateSuggestion | null>(candidate.proposedPatch, null)
      if (!suggestion) return
      const character = scoped.characters.find((item) => item.id === suggestion.characterId)
      if (!character) return
      const targetChapter = scoped.chapters.find((chapter) => chapter.order === selectedJob?.targetChapterOrder) ?? null
      nextData = {
        ...nextData,
        characters: nextData.characters.map((item) =>
          item.id === character.id
            ? {
                ...item,
                emotionalState: suggestion.newCurrentEmotionalState || item.emotionalState,
                protagonistRelationship: suggestion.newRelationshipWithProtagonist || item.protagonistRelationship,
                nextActionTendency: suggestion.newNextActionTendency || item.nextActionTendency,
                lastChangedChapter: selectedJob?.targetChapterOrder ?? item.lastChangedChapter,
                updatedAt: timestamp
              }
            : item
        ),
        characterStateLogs: [
          ...nextData.characterStateLogs,
          {
            id: newId(),
            projectId: project.id,
            characterId: character.id,
            chapterId: targetChapter?.id ?? null,
            chapterOrder: selectedJob?.targetChapterOrder ?? null,
            note: suggestion.changeSummary,
            createdAt: timestamp
          }
        ]
      }
    }

    if (candidate.type === 'foreshadowing') {
      const patch = parseOutput<{ kind?: string; candidate?: ForeshadowingCandidate; change?: ForeshadowingStatusChangeSuggestion }>(
        candidate.proposedPatch,
        {}
      )
      if (patch.kind === 'new' && patch.candidate) {
        nextData = {
          ...nextData,
          foreshadowings: [
            ...nextData.foreshadowings,
            {
              id: newId(),
              projectId: project.id,
              title: patch.candidate.title,
              firstChapterOrder: patch.candidate.firstChapterOrder ?? selectedJob?.targetChapterOrder ?? null,
              description: patch.candidate.description,
              status: 'unresolved',
              weight: patch.candidate.suggestedWeight,
              expectedPayoff: patch.candidate.expectedPayoff,
              payoffMethod: '',
              relatedCharacterIds: patch.candidate.relatedCharacterIds,
              relatedMainPlot: '',
              notes: patch.candidate.notes,
              actualPayoffChapter: null,
              createdAt: timestamp,
              updatedAt: timestamp
            }
          ]
        }
      }
      if (patch.kind === 'status' && patch.change) {
        nextData = {
          ...nextData,
          foreshadowings: nextData.foreshadowings.map((item) =>
            item.id === patch.change?.foreshadowingId
              ? {
                  ...item,
                  status: patch.change.suggestedStatus,
                  actualPayoffChapter: patch.change.suggestedStatus === 'resolved' ? selectedJob?.targetChapterOrder ?? item.actualPayoffChapter : item.actualPayoffChapter,
                  notes: [item.notes, patch.change.notes || patch.change.evidenceText].filter(Boolean).join('\n'),
                  updatedAt: timestamp
                }
              : item
          )
        }
      }
    }

    await saveData({
      ...nextData,
      projects: updateProjectTimestamp(nextData, project.id),
      memoryUpdateCandidates: nextData.memoryUpdateCandidates.map((item) =>
        item.id === candidate.id ? { ...item, status: 'accepted', updatedAt: timestamp } : item
      )
    })
  }

  async function rejectCandidate(candidate: MemoryUpdateCandidate) {
    await saveData({
      ...data,
      memoryUpdateCandidates: data.memoryUpdateCandidates.map((item) =>
        item.id === candidate.id ? { ...item, status: 'rejected', updatedAt: now() } : item
      )
    })
  }

  async function generateRevisionCandidate(issue: QualityGateIssue, report: QualityGateReport, draft: GeneratedChapterDraft) {
    const context = buildPipelineContext(
      project,
      data,
      selectedJob?.targetChapterOrder ?? targetChapterOrder,
      readerEmotionTarget,
      estimatedWordCount,
      createContextBudgetProfile(project.id, budgetMode, budgetMaxTokens, '修订候选上下文')
    )
    const result = await aiService.generateRevisionCandidate({ title: draft.title, body: draft.body }, issue, context)
    if (!result.data) {
      alert(result.error || result.parseError || '修订候选生成失败')
      return
    }
    const timestamp = now()
    const candidate: RevisionCandidate = {
      id: newId(),
      projectId: project.id,
      jobId: draft.jobId,
      draftId: draft.id,
      sourceReportId: report.id,
      targetIssue: issue.description || issue.type,
      revisionInstruction: result.data.revisionInstruction || issue.suggestedFix,
      revisedText: result.data.revisedText,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await saveData({ ...data, revisionCandidates: [candidate, ...data.revisionCandidates] })
  }

  async function acceptRevisionCandidate(candidate: RevisionCandidate) {
    const timestamp = now()
    await saveData({
      ...data,
      generatedChapterDrafts: data.generatedChapterDrafts.map((draft) =>
        draft.id === candidate.draftId && candidate.revisedText.trim()
          ? { ...draft, body: candidate.revisedText, tokenEstimate: TokenEstimator.estimate(candidate.revisedText), updatedAt: timestamp }
          : draft
      ),
      revisionCandidates: data.revisionCandidates.map((item) =>
        item.id === candidate.id ? { ...item, status: 'accepted', updatedAt: timestamp } : item
      )
    })
  }

  async function rejectRevisionCandidate(candidate: RevisionCandidate) {
    await saveData({
      ...data,
      revisionCandidates: data.revisionCandidates.map((item) =>
        item.id === candidate.id ? { ...item, status: 'rejected', updatedAt: now() } : item
      )
    })
  }

  return (
    <>
      <Header title="章节生产流水线" description="把上下文构建、任务书、正文草稿、复盘、记忆候选和一致性审稿串成可见流程。" />
      <section className="panel pipeline-start">
        <div className="form-grid compact">
          <NumberInput label="目标章节编号" min={1} value={targetChapterOrder} onChange={(value) => setTargetChapterOrder(value ?? nextChapter)} />
          <SelectField<PipelineMode>
            label="生成模式"
            value={pipelineMode}
            onChange={setPipelineMode}
            options={[
              { value: 'conservative', label: '保守' },
              { value: 'standard', label: '标准' },
              { value: 'aggressive', label: '激进' }
            ]}
          />
          <TextInput label="章节预计字数" value={estimatedWordCount} onChange={setEstimatedWordCount} />
          <TextInput label="读者情绪目标" value={readerEmotionTarget} onChange={setReaderEmotionTarget} />
          <SelectField<ContextBudgetMode>
            label="上下文预算模式"
            value={budgetMode}
            onChange={setBudgetMode}
            options={[
              { value: 'light', label: '轻量' },
              { value: 'standard', label: '标准' },
              { value: 'full', label: '完整' },
              { value: 'custom', label: '自定义' }
            ]}
          />
          <NumberInput
            label="预算 token"
            min={1000}
            value={budgetMaxTokens}
            onChange={(value) => setBudgetMaxTokens(value ?? data.settings.defaultTokenBudget)}
          />
        </div>
        <button className="primary-button" onClick={runPipeline}>
          开始生成
        </button>
      </section>

      <section className="split-layout">
        <aside className="list-pane">
          {jobs.length === 0 ? (
            <EmptyState title="暂无流水线任务" description="选择目标章节后点击开始生成。" />
          ) : (
            jobs.map((job) => (
              <button key={job.id} className={job.id === selectedJob?.id ? 'list-item active' : 'list-item'} onClick={() => setSelectedJobId(job.id)}>
                <strong>第 {job.targetChapterOrder} 章</strong>
                <span>{job.status}</span>
                <small>{formatDate(job.createdAt)}</small>
              </button>
            ))
          )}
        </aside>
        <div className="editor-pane">
          {!selectedJob ? (
            <EmptyState title="选择或创建流水线任务" description="每一步都会保存输出，失败后可重试或跳过。" />
          ) : (
            <>
              <div className="panel">
                <h2>步骤条</h2>
                <div className="pipeline-steps">
                  {selectedSteps.map((step) => (
                    <article key={step.id} className={`pipeline-step ${step.status}`}>
                      <div>
                        <strong>{PIPELINE_STEP_LABELS[step.type]}</strong>
                        <span>{step.status}</span>
                      </div>
                      {step.errorMessage ? <p className="error-text">{step.errorMessage}</p> : null}
                      {step.output ? <pre>{step.output.slice(0, 900)}</pre> : null}
                      <div className="row-actions">
                        <button className="ghost-button" onClick={() => retryStep(selectedJob, step.type)}>
                          重试
                        </button>
                        <button className="ghost-button" onClick={() => skipStep(selectedJob, step)}>
                          跳过
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="panel">
                <h2>章节正文草稿</h2>
                {latestDraft ? (
                  <article className="candidate-card">
                    <h3>{latestDraft.title}</h3>
                    <p>
                      状态：{latestDraft.status} · {latestDraft.tokenEstimate} token
                    </p>
                    <textarea className="prompt-editor" value={latestDraft.body} readOnly />
                    <div className="row-actions">
                      <button className="primary-button" onClick={() => acceptDraft(latestDraft)}>
                        接受章节草稿
                      </button>
                      <button className="danger-button" onClick={() => rejectDraft(latestDraft)}>
                        拒绝章节草稿
                      </button>
                      <button className="ghost-button" onClick={() => retryStep(selectedJob, 'generate_chapter_draft')}>
                        重新生成章节正文
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() => {
                          void window.novelAPI.writeClipboard(latestDraft.body).then(() => alert('已复制草稿正文'))
                        }}
                      >
                        复制草稿正文
                      </button>
                    </div>
                  </article>
                ) : (
                  <p className="muted">正文草稿会在第 3 步完成后显示。</p>
                )}
              </div>

              <div className="panel">
                <h2>质量门禁报告</h2>
                {latestQualityReport ? (
                  <article className="candidate-card">
                    <h3>
                      总分 {latestQualityReport.overallScore} · {latestQualityReport.pass ? '通过' : '需人工审查'}
                    </h3>
                    <div className="metric-grid">
                      {Object.entries(latestQualityReport.dimensions).map(([key, value]) => (
                        <article key={key}>
                          <span>{key}</span>
                          <strong className={value < 70 ? 'over-budget' : ''}>{value}</strong>
                        </article>
                      ))}
                    </div>
                    {latestQualityReport.issues.length ? (
                      <div className="candidate-list">
                        {latestQualityReport.issues.map((issue, index) => (
                          <article key={`${issue.type}-${index}`} className="candidate-card">
                            <h3>{issue.severity} · {issue.type}</h3>
                            <p>{issue.description}</p>
                            <p className="muted">{issue.evidence}</p>
                            <p>{issue.suggestedFix}</p>
                            {latestDraft ? (
                              <button className="ghost-button" onClick={() => generateRevisionCandidate(issue, latestQualityReport, latestDraft)}>
                                生成修订候选
                              </button>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">没有发现高风险问题。</p>
                    )}
                    {latestQualityReport.requiredFixes.length ? (
                      <ul className="advice-list">
                        {latestQualityReport.requiredFixes.map((fix) => (
                          <li key={fix}>必修：{fix}</li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                ) : (
                  <p className="muted">质量门禁会在一致性审稿后执行，低分草稿不会自动进入长期记忆。</p>
                )}
              </div>

              <div className="panel">
                <h2>修订候选</h2>
                {selectedRevisionCandidates.length === 0 ? (
                  <p className="muted">可从质量门禁问题中生成局部修订候选。</p>
                ) : (
                  <div className="candidate-list">
                    {selectedRevisionCandidates.map((candidate) => (
                      <article key={candidate.id} className="candidate-card">
                        <h3>{candidate.status} · {candidate.targetIssue}</h3>
                        <p>{candidate.revisionInstruction}</p>
                        <pre>{candidate.revisedText || '暂无修订正文'}</pre>
                        <div className="row-actions">
                          <button className="primary-button" disabled={candidate.status !== 'pending'} onClick={() => acceptRevisionCandidate(candidate)}>
                            应用到草稿
                          </button>
                          <button className="danger-button" disabled={candidate.status !== 'pending'} onClick={() => rejectRevisionCandidate(candidate)}>
                            拒绝修订
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <div className="panel">
                <h2>记忆更新候选</h2>
                {selectedCandidates.length === 0 ? (
                  <p className="muted">章节复盘、角色和伏笔候选会在流水线后半段出现。</p>
                ) : (
                  <div className="candidate-list">
                    {selectedCandidates.map((candidate) => (
                      <article key={candidate.id} className="candidate-card">
                        <h3>{candidate.type}</h3>
                        <p>状态：{candidate.status} · 置信度 {Math.round(candidate.confidence * 100)}%</p>
                        <p>{candidate.evidence || '暂无证据文本'}</p>
                        <pre>{candidate.proposedPatch.slice(0, 900)}</pre>
                        <div className="row-actions">
                          <button className="primary-button" disabled={candidate.status !== 'pending'} onClick={() => applyCandidate(candidate)}>
                            接受
                          </button>
                          <button className="danger-button" disabled={candidate.status !== 'pending'} onClick={() => rejectCandidate(candidate)}>
                            拒绝
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <div className="panel">
                <h2>一致性审稿报告</h2>
                {selectedReports.length === 0 ? (
                  <p className="muted">审稿报告会在第 7 步完成后显示并自动保存。</p>
                ) : (
                  <div className="candidate-list">
                    {selectedReports.map((report) => (
                      <article key={report.id} className="candidate-card">
                        <h3>严重程度：{report.severitySummary}</h3>
                        <pre>{report.issues}</pre>
                        <p>{report.suggestions || '暂无建议'}</p>
                        <small>已保存 · {formatDate(report.createdAt)}</small>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </>
  )
}

function SettingsView({
  data,
  project,
  saveData,
  storagePath,
  setStoragePath,
  setStatus,
  replaceData
}: ProjectProps & {
  storagePath: string
  setStoragePath: (path: string) => void
  setStatus: (message: string) => void
  replaceData: (next: AppData, storagePath?: string) => Promise<void>
}) {
  const [pendingStoragePath, setPendingStoragePath] = useState(storagePath)
  const [defaultStoragePath, setDefaultStoragePath] = useState('')
  const [storageMessage, setStorageMessage] = useState('')

  useEffect(() => {
    setPendingStoragePath(storagePath)
  }, [storagePath])

  useEffect(() => {
    window.novelAPI
      .getDataStoragePath()
      .then((result) => {
        setDefaultStoragePath(result.defaultStoragePath)
        setPendingStoragePath(result.storagePath)
      })
      .catch((error) => setStorageMessage(`读取路径配置失败：${String(error)}`))
  }, [])

  async function updateSettings(patch: Partial<AppSettings>) {
    await saveData({ ...data, settings: { ...data.settings, ...patch } })
  }

  async function exportData() {
    await window.novelAPI.exportData(data)
  }

  async function importData() {
    if (!confirm('导入会覆盖当前本地数据，确定继续吗？')) return
    const result = await window.novelAPI.importData()
    if (!result.canceled && result.data) {
      await replaceData(result.data, result.storagePath)
    }
  }

  async function chooseStoragePath() {
    const result = await window.novelAPI.selectDataStoragePath()
    if (!result.canceled && result.storagePath) {
      setPendingStoragePath(result.storagePath)
      setStorageMessage('已选择新路径，点击“迁移当前数据到新位置”后生效。')
    }
  }

  async function migrateStoragePath(targetPath = pendingStoragePath, overwrite = false) {
    setStorageMessage('正在保存当前数据并迁移...')
    await saveData(data)
    const result = await window.novelAPI.migrateDataStoragePath(targetPath, data, overwrite)
    if (result.needsOverwrite && result.targetPath) {
      if (!confirm('目标路径已有数据文件。MVP 当前只支持覆盖或取消，是否覆盖目标文件？')) {
        setStorageMessage('已取消迁移，原数据路径未改变。')
        return
      }
      return migrateStoragePath(result.targetPath, true)
    }
    if (!result.ok) {
      setStorageMessage(`迁移失败，已回退原路径：${result.error || '未知错误'}`)
      setStatus(`迁移失败：${result.error || '未知错误'}`)
      return
    }
    setStoragePath(result.storagePath)
    setPendingStoragePath(result.storagePath)
    const backup = result.backupPath ? ` 原路径备份：${result.backupPath}` : ''
    setStorageMessage(`迁移成功，后续读写将使用新路径。${backup}`)
    setStatus('数据路径已迁移')
  }

  async function resetStoragePath() {
    setStorageMessage('正在恢复默认路径...')
    await saveData(data)
    const result = await window.novelAPI.resetDataStoragePath(data, false)
    if (result.needsOverwrite && result.targetPath) {
      if (!confirm('默认路径已有数据文件。是否覆盖默认路径数据？')) {
        setStorageMessage('已取消恢复默认路径。')
        return
      }
      const overwriteResult = await window.novelAPI.resetDataStoragePath(data, true)
      if (!overwriteResult.ok) {
        setStorageMessage(`恢复默认路径失败：${overwriteResult.error || '未知错误'}`)
        return
      }
      setStoragePath(overwriteResult.storagePath)
      setPendingStoragePath(overwriteResult.storagePath)
      setStorageMessage(`已恢复默认路径。${overwriteResult.backupPath ? ` 原路径备份：${overwriteResult.backupPath}` : ''}`)
      return
    }
    if (!result.ok) {
      setStorageMessage(`恢复默认路径失败：${result.error || '未知错误'}`)
      return
    }
    setStoragePath(result.storagePath)
    setPendingStoragePath(result.storagePath)
    setStorageMessage(`已恢复默认路径。${result.backupPath ? ` 原路径备份：${result.backupPath}` : ''}`)
  }

  async function openStorageFolder() {
    const result = await window.novelAPI.openDataStorageFolder(storagePath)
    setStorageMessage(result.ok ? '已打开数据文件所在位置。' : `打开失败：${result.error || '未知错误'}`)
  }

  return (
    <>
      <Header title="设置" description={`当前项目：${project.name}`} />
      <section className="panel">
        <h2>AI API 设置预留</h2>
        <div className="form-grid compact">
          <SelectField
            label="API Provider"
            value={data.settings.apiProvider}
            onChange={(apiProvider) => updateSettings({ apiProvider })}
            options={[
              { value: 'openai', label: 'OpenAI' },
              { value: 'compatible', label: 'Compatible API' },
              { value: 'local', label: 'Local Model' }
            ]}
          />
          <TextInput label="Base URL" value={data.settings.baseUrl} onChange={(baseUrl) => updateSettings({ baseUrl })} />
          <TextInput label="Model Name" value={data.settings.modelName} onChange={(modelName) => updateSettings({ modelName })} />
          <Field label="API Key">
            <input type="password" value={data.settings.apiKey} onChange={(event) => updateSettings({ apiKey: event.target.value })} />
          </Field>
          <Field label="Temperature">
            <input type="number" step="0.1" min="0" max="2" value={data.settings.temperature} onChange={(event) => updateSettings({ temperature: Number(event.target.value) })} />
          </Field>
          <NumberInput label="Max Tokens" value={data.settings.maxTokens} onChange={(maxTokens) => updateSettings({ maxTokens: maxTokens ?? 8000 })} />
        </div>
        <div className="checkbox-grid">
          <Toggle label="启用 AI 自动总结" checked={data.settings.enableAutoSummary} onChange={(enableAutoSummary) => updateSettings({ enableAutoSummary })} />
          <Toggle label="启用 AI 章节诊断" checked={data.settings.enableChapterDiagnostics} onChange={(enableChapterDiagnostics) => updateSettings({ enableChapterDiagnostics })} />
        </div>
      </section>
      <section className="panel">
        <h2>Prompt 与存储</h2>
        <div className="form-grid compact">
          <NumberInput label="默认 token 预算" value={data.settings.defaultTokenBudget} onChange={(defaultTokenBudget) => updateSettings({ defaultTokenBudget: defaultTokenBudget ?? 16000 })} />
          <SelectField<PromptMode>
            label="默认 Prompt 模式"
            value={data.settings.defaultPromptMode}
            onChange={(defaultPromptMode) => updateSettings({ defaultPromptMode })}
            options={[
              { value: 'light', label: '轻量模式' },
              { value: 'standard', label: '标准模式' },
              { value: 'full', label: '完整模式' }
            ]}
          />
          <SelectField
            label="主题预留"
            value={data.settings.theme}
            onChange={(theme) => updateSettings({ theme })}
            options={[
              { value: 'system', label: '跟随系统' },
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' }
            ]}
          />
        </div>
        <div className="row-actions">
          <button className="ghost-button" onClick={exportData}>
            导出项目数据
          </button>
          <button className="ghost-button" onClick={importData}>
            导入项目数据
          </button>
        </div>
      </section>
      <section className="panel">
        <h2>本地数据</h2>
        <div className="storage-path">
          <span>当前数据文件路径</span>
          <code>{storagePath || '读取中'}</code>
        </div>
        <div className="storage-path">
          <span>默认数据文件路径</span>
          <code>{defaultStoragePath || '读取中'}</code>
        </div>
        <div className="form-grid compact">
          <TextInput label="新数据保存路径（文件夹或 .json 文件）" value={pendingStoragePath} onChange={setPendingStoragePath} />
        </div>
        {storageMessage ? <div className="notice">{storageMessage}</div> : null}
        <div className="row-actions">
          <button className="ghost-button" onClick={chooseStoragePath}>
            选择保存位置
          </button>
          <button className="ghost-button" onClick={openStorageFolder}>
            打开所在文件夹
          </button>
          <button className="primary-button" onClick={() => migrateStoragePath()}>
            迁移当前数据到新位置
          </button>
          <button className="danger-button" onClick={resetStoragePath}>
            恢复默认路径
          </button>
        </div>
      </section>
    </>
  )
}

export default function App() {
  const [data, setData] = useState<AppData | null>(null)
  const [storagePath, setStoragePath] = useState('')
  const [currentProjectId, setCurrentProjectId] = useState<ID | null>(null)
  const [view, setView] = useState<View>('dashboard')
  const [status, setStatus] = useState('')

  useEffect(() => {
    window.novelAPI
      .getData()
      .then((result) => {
        setData(result.data)
        setStoragePath(result.storagePath)
      })
      .catch((error) => {
        setData(EMPTY_APP_DATA)
        setStatus(`读取失败：${String(error)}`)
      })
  }, [])

  useEffect(() => {
    if (!data) return
    document.documentElement.dataset.theme = data.settings.theme
  }, [data])

  async function saveData(next: AppData) {
    setData(next)
    setStatus('保存中...')
    try {
      const result = await window.novelAPI.saveData(next)
      setStoragePath(result.storagePath)
      setStatus(`已保存 ${new Date().toLocaleTimeString('zh-CN')}`)
    } catch (error) {
      setStatus(`保存失败：${String(error)}`)
    }
  }

  async function replaceData(next: AppData, nextStoragePath?: string) {
    setData(next)
    if (nextStoragePath) setStoragePath(nextStoragePath)
    setCurrentProjectId(next.projects[0]?.id ?? null)
    setStatus('数据已导入')
  }

  if (!data) {
    return (
      <div className="loading-screen">
        <strong>Novel Director</strong>
        <span>正在读取本地数据...</span>
      </div>
    )
  }

  const currentProject = data.projects.find((project) => project.id === currentProjectId) ?? null

  if (!currentProject) {
    return <HomeView data={data} saveData={saveData} setProjectId={setCurrentProjectId} setView={setView} />
  }

  const content = {
    dashboard: <DashboardView data={data} project={currentProject} saveData={saveData} />,
    bible: <BibleView data={data} project={currentProject} saveData={saveData} />,
    chapters: <ChaptersView data={data} project={currentProject} saveData={saveData} />,
    characters: <CharactersView data={data} project={currentProject} saveData={saveData} />,
    foreshadowings: <ForeshadowingView data={data} project={currentProject} saveData={saveData} />,
    timeline: <TimelineView data={data} project={currentProject} saveData={saveData} />,
    stages: <StageSummaryView data={data} project={currentProject} saveData={saveData} />,
    prompt: <PromptBuilderView data={data} project={currentProject} saveData={saveData} />,
    pipeline: <PipelineView data={data} project={currentProject} saveData={saveData} />,
    settings: (
      <SettingsView
        data={data}
        project={currentProject}
        saveData={saveData}
        storagePath={storagePath}
        setStoragePath={setStoragePath}
        setStatus={setStatus}
        replaceData={replaceData}
      />
    )
  }[view]

  return (
    <Shell project={currentProject} view={view} setView={setView} setProjectId={setCurrentProjectId} status={status}>
      {content}
    </Shell>
  )
}

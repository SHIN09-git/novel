import { useEffect, useMemo, useState } from 'react'
import type {
  AppData,
  AppSettings,
  Chapter,
  Character,
  CharacterStateLog,
  Foreshadowing,
  ForeshadowingStatus,
  ForeshadowingTreatmentMode,
  ForeshadowingWeight,
  ID,
  Project,
  PromptMode,
  StageSummary,
  StoryBible,
  TimelineEvent
} from '../../shared/types'
import { createEmptyBible } from '../../shared/defaults'
import { AIService } from '../../services/AIService'
import { EmptyState, Field, NumberInput, SelectField, TextArea, TextInput, Toggle } from './components/FormFields'
import { Header, Shell, type View } from './components/Layout'
import { ActionToolbar, SectionCard, StatCard, StatusBadge, WeightBadge } from './components/UI'
import { useAppData } from './hooks/useAppData'
import { projectData } from './utils/projectData'
import { expectedPayoffNearText } from './utils/promptContext'
import { clampNumber, formatDate, newId, now, statusLabel, treatmentModeLabel, weightLabel } from './utils/format'
import { FORESHADOWING_TREATMENT_OPTIONS, normalizeTreatmentMode, treatmentDescription } from '../../shared/foreshadowingTreatment'
import { ChaptersView } from './views/ChaptersView'
import { GenerationPipelineView } from './views/GenerationPipelineView'
import { PromptBuilderView } from './views/PromptBuilderView'
import { RevisionStudioView } from './views/RevisionStudioView'

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
    const projectRevisionSessionIds = new Set(data.revisionSessions.filter((item) => item.projectId === project.id).map((item) => item.id))
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
      promptContextSnapshots: data.promptContextSnapshots.filter((item) => item.projectId !== project.id),
      chapterContinuityBridges: data.chapterContinuityBridges.filter((item) => item.projectId !== project.id),
      chapterGenerationJobs: data.chapterGenerationJobs.filter((item) => item.projectId !== project.id),
      chapterGenerationSteps: data.chapterGenerationSteps.filter((item) => !projectJobIds.has(item.jobId)),
      generatedChapterDrafts: data.generatedChapterDrafts.filter((item) => item.projectId !== project.id),
      memoryUpdateCandidates: data.memoryUpdateCandidates.filter((item) => item.projectId !== project.id),
      consistencyReviewReports: data.consistencyReviewReports.filter((item) => item.projectId !== project.id),
      contextBudgetProfiles: data.contextBudgetProfiles.filter((item) => item.projectId !== project.id),
      qualityGateReports: data.qualityGateReports.filter((item) => item.projectId !== project.id),
      generationRunTraces: data.generationRunTraces.filter((item) => item.projectId !== project.id),
      redundancyReports: data.redundancyReports.filter((item) => item.projectId !== project.id),
      revisionCandidates: data.revisionCandidates.filter((item) => item.projectId !== project.id),
      revisionSessions: data.revisionSessions.filter((item) => item.projectId !== project.id),
      revisionRequests: data.revisionRequests.filter((item) => !projectRevisionSessionIds.has(item.sessionId)),
      revisionVersions: data.revisionVersions.filter((item) => !projectRevisionSessionIds.has(item.sessionId)),
      chapterVersions: data.chapterVersions.filter((item) => item.projectId !== project.id)
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
  const totalWords = scoped.chapters.reduce((sum, chapter) => sum + chapter.body.replace(/\s/g, '').length, 0)
  const latestDraft = [...scoped.generatedChapterDrafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  const latestQualityReport = [...scoped.qualityGateReports].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const latestLog = [...scoped.characterStateLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const latestLogCharacter = latestLog ? scoped.characters.find((character) => character.id === latestLog.characterId) : null

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
      <Header
        title="项目工作台"
        description="把长期设定、阶段摘要和当前戏剧状态收束到下一章。"
        actions={
          <ActionToolbar>
            <button className="ghost-button">第 {nextChapter} 章准备区</button>
            <button className="primary-button" onClick={createNextChapter}>新建第 {nextChapter} 章</button>
          </ActionToolbar>
        }
      />
      <section className="dashboard-hero">
        <div>
          <span className="chapter-kicker">Novel Control Room</span>
          <h2>{project.name}</h2>
          <p>{project.description || '还没有项目简介。补上核心类型、目标读者和情绪体验后，Prompt 会更稳定。'}</p>
        </div>
        <div className="dashboard-next-card">
          <span>下一步建议</span>
          <strong>准备第 {nextChapter} 章</strong>
          <p>{latestStage?.nextStageDirection || recentChapter?.endingHook || '先补齐最近章节复盘，再进入 Prompt 构建器或生产流水线。'}</p>
        </div>
      </section>
      <section className="metric-grid dashboard-metrics">
        <StatCard label="总字数" value={totalWords.toLocaleString()} detail={`${scoped.chapters.length} 个章节 · 最近第 ${recentChapter?.order ?? '-'} 章`} tone="accent" />
        <StatCard label="阶段摘要" value={latestStage ? `${latestStage.chapterStart}-${latestStage.chapterEnd}` : '暂无'} detail={latestStage?.nextStageDirection || '建议每 3 章生成一次摘要'} tone="info" />
        <StatCard label="高权重伏笔" value={highForeshadowingCount} detail="未回收且需要进入调度视野" tone="warning" />
        <StatCard label="主要角色" value={mainCharacterCount} detail="维护当前戏剧状态，而非百科条目" tone="success" />
      </section>
      <section className="dashboard-grid">
        <SectionCard title="最近生产动态" description="草稿、质量门禁和角色变化会汇集在这里。">
          <div className="insight-list">
            <article>
              <StatusBadge tone={latestDraft ? 'accent' : 'neutral'}>草稿</StatusBadge>
              <strong>{latestDraft ? latestDraft.title : '暂无生成草稿'}</strong>
              <p>{latestDraft ? `${latestDraft.status} · ${latestDraft.tokenEstimate} token · ${formatDate(latestDraft.updatedAt)}` : '从生产流水线生成正文草稿后会显示在这里。'}</p>
            </article>
            <article>
              <StatusBadge tone={latestQualityReport?.pass ? 'success' : latestQualityReport ? 'warning' : 'neutral'}>质量门禁</StatusBadge>
              <strong>{latestQualityReport ? `${latestQualityReport.overallScore} 分 · ${latestQualityReport.pass ? '通过' : '需人工审查'}` : '暂无报告'}</strong>
              <p>{latestQualityReport ? `高风险问题 ${latestQualityReport.issues.filter((issue) => issue.severity === 'high').length} 条 · 必修 ${latestQualityReport.requiredFixes.length} 项` : '章节草稿生成后会自动给出质量解释。'}</p>
            </article>
            <article>
              <StatusBadge tone={latestLog ? 'info' : 'neutral'}>角色状态</StatusBadge>
              <strong>{latestLogCharacter?.name || '暂无状态变化'}</strong>
              <p>{latestLog?.note || '从章节复盘或角色页记录关键变化。'}</p>
            </article>
          </div>
        </SectionCard>
        <SectionCard title="上下文风险雷达" description="优先处理会让 AI 写偏的长期记忆问题。">
          <div className="insight-list compact">
            <article>
              <strong>未回收高权重伏笔</strong>
              <p>{highForeshadowingCount ? `有 ${highForeshadowingCount} 条需要关注。` : '当前没有高压伏笔。'}</p>
            </article>
            <article>
              <strong>最近章节复盘</strong>
              <p>{recentChapter?.summary ? `第 ${recentChapter.order} 章已有摘要。` : '最近章节摘要仍为空，建议先补。'}</p>
            </article>
            <article>
              <strong>阶段摘要</strong>
              <p>{latestStage ? `当前滚动摘要覆盖 ${latestStage.chapterStart}-${latestStage.chapterEnd} 章。` : '暂无阶段摘要，长篇上下文会更容易膨胀。'}</p>
            </article>
          </div>
        </SectionCard>
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
      <section className="split-layout characters-workbench">
        <aside className="list-pane">
          <div className="chapter-shelf-header">
            <span>角色</span>
            <strong>{characters.length}</strong>
          </div>
          {characters.map((character) => (
            <button key={character.id} className={character.id === selected?.id ? 'list-item active' : 'list-item'} onClick={() => setSelectedId(character.id)}>
              <strong>{character.name}</strong>
              <span>{character.role || '未设置定位'}</span>
              <small>{character.isMain ? '主要角色' : '次要角色'} · {character.emotionalState || '情绪待补'}</small>
            </button>
          ))}
        </aside>
        <div className="editor-pane">
          {!selected ? (
            <EmptyState title="暂无角色" description="创建角色卡后，把基础设定和当前状态分区维护。" />
          ) : (
            <>
              <div className="panel character-focus-card">
                <div>
                  <span className="chapter-kicker">Current Dramatic State</span>
                  <h2>{selected.name}</h2>
                  <p>{selected.role || '未设置角色定位'}</p>
                </div>
                <div className="character-state-grid">
                  <article>
                    <span>深层欲望</span>
                    <strong>{selected.deepDesire || '待补充'}</strong>
                  </article>
                  <article>
                    <span>核心恐惧</span>
                    <strong>{selected.coreFear || '待补充'}</strong>
                  </article>
                  <article>
                    <span>关系状态</span>
                    <strong>{selected.protagonistRelationship || '待补充'}</strong>
                  </article>
                </div>
                <div className="row-actions">
                  <StatusBadge tone={selected.isMain ? 'accent' : 'neutral'}>{selected.isMain ? '主要角色' : '次要角色'}</StatusBadge>
                  {selected.lastChangedChapter ? <StatusBadge tone="info">最近变化第 {selected.lastChangedChapter} 章</StatusBadge> : null}
                </div>
              </div>
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
              <div className="panel character-log-panel">
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

function ForeshadowingView({ data, project, saveData }: ProjectProps) {
  const scoped = projectData(data, project.id)
  const [statusFilter, setStatusFilter] = useState<'all' | ForeshadowingStatus>('all')
  const [weightFilter, setWeightFilter] = useState<'all' | ForeshadowingWeight>('all')
  const [treatmentFilter, setTreatmentFilter] = useState<'all' | ForeshadowingTreatmentMode>('all')
  const [nearChapter, setNearChapter] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<ID | null>(null)
  const foreshadowings = scoped.foreshadowings
    .filter((item) => statusFilter === 'all' || item.status === statusFilter)
    .filter((item) => weightFilter === 'all' || item.weight === weightFilter)
    .filter((item) => treatmentFilter === 'all' || normalizeTreatmentMode(item.treatmentMode, item.status, item.weight) === treatmentFilter)
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
      treatmentMode: 'hint',
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
      <Header title="伏笔账本" description="用处理方式控制伏笔本章是隐藏、暗示、推进、误导、暂停还是回收，避免高权重伏笔被每章过度推进。" actions={<button className="primary-button" onClick={addForeshadowing}>快速新增伏笔</button>} />
      <section className="foreshadowing-summary">
        <StatCard label="未回收" value={scoped.foreshadowings.filter((item) => item.status === 'unresolved').length} tone="accent" />
        <StatCard label="部分推进" value={scoped.foreshadowings.filter((item) => item.status === 'partial').length} tone="info" />
        <StatCard label="高/回收权重" value={scoped.foreshadowings.filter((item) => item.weight === 'high' || item.weight === 'payoff').length} tone="warning" />
        <StatCard label="已归档" value={scoped.foreshadowings.filter((item) => item.status === 'resolved' || item.status === 'abandoned').length} tone="success" />
      </section>
      <section className="panel filters asset-filters">
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
        <SelectField
          label="处理方式"
          value={treatmentFilter}
          onChange={setTreatmentFilter}
          options={[{ value: 'all', label: '全部' }, ...FORESHADOWING_TREATMENT_OPTIONS]}
        />
      </section>
      <section className="table-editor foreshadowing-workbench">
        <div className="panel table-panel">
          <table>
            <thead>
              <tr>
                <th>标题</th>
                <th>状态</th>
                <th>权重</th>
                <th>处理方式</th>
                <th>预计回收</th>
              </tr>
            </thead>
            <tbody>
              {foreshadowings.map((item) => (
                <tr key={item.id} className={`${item.id === selected?.id ? 'active-row' : ''} ${item.status}`} onClick={() => setSelectedId(item.id)}>
                  <td>{item.title}</td>
                  <td>
                    <StatusBadge tone={item.status === 'resolved' ? 'success' : item.status === 'abandoned' ? 'neutral' : item.status === 'partial' ? 'info' : 'accent'}>
                      {statusLabel(item.status)}
                    </StatusBadge>
                  </td>
                  <td><WeightBadge weight={item.weight} label={weightLabel(item.weight)} /></td>
                  <td>
                    <StatusBadge tone={normalizeTreatmentMode(item.treatmentMode, item.status, item.weight) === 'payoff' ? 'warning' : normalizeTreatmentMode(item.treatmentMode, item.status, item.weight) === 'hidden' || normalizeTreatmentMode(item.treatmentMode, item.status, item.weight) === 'pause' ? 'neutral' : 'info'}>
                      {treatmentModeLabel(normalizeTreatmentMode(item.treatmentMode, item.status, item.weight))}
                    </StatusBadge>
                  </td>
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
                <SelectField<ForeshadowingTreatmentMode>
                  label="当前处理方式"
                  value={normalizeTreatmentMode(selected.treatmentMode, selected.status, selected.weight)}
                  onChange={(treatmentMode) => updateForeshadowing(selected.id, { treatmentMode })}
                  options={FORESHADOWING_TREATMENT_OPTIONS}
                />
              </div>
              <p className="muted">{treatmentDescription(normalizeTreatmentMode(selected.treatmentMode, selected.status, selected.weight))}</p>
              {selected.weight === 'payoff' && normalizeTreatmentMode(selected.treatmentMode, selected.status, selected.weight) !== 'payoff' ? (
                <p className="notice">该伏笔权重较高，但当前未设置为回收。本章不会默认把它当作兑现项推进。</p>
              ) : null}
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
    window.novelDirector.app
      .getStoragePath()
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
    await window.novelDirector.data.export(data)
  }

  async function importData() {
    if (!confirm('导入会覆盖当前本地数据，确定继续吗？')) return
    const result = await window.novelDirector.data.import()
    if (!result.canceled && result.data) {
      await replaceData(result.data, result.storagePath)
    }
  }

  async function chooseStoragePath() {
    const result = await window.novelDirector.app.selectStoragePath()
    if (!result.canceled && result.storagePath) {
      setPendingStoragePath(result.storagePath)
      setStorageMessage('已选择新路径，点击“迁移当前数据到新位置”后生效。')
    }
  }

  async function migrateStoragePath(targetPath = pendingStoragePath, overwrite = false) {
    setStorageMessage('正在保存当前数据并迁移...')
    await saveData(data)
    const result = await window.novelDirector.app.migrateStoragePath(targetPath, data, overwrite)
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
    const result = await window.novelDirector.app.resetStoragePath(data, false)
    if (result.needsOverwrite && result.targetPath) {
      if (!confirm('默认路径已有数据文件。是否覆盖默认路径数据？')) {
        setStorageMessage('已取消恢复默认路径。')
        return
      }
      const overwriteResult = await window.novelDirector.app.resetStoragePath(data, true)
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
    const result = await window.novelDirector.app.openStorageFolder(storagePath)
    setStorageMessage(result.ok ? '已打开数据文件所在位置。' : `打开失败：${result.error || '未知错误'}`)
  }

  return (
    <>
      <Header title="设置" description={`当前项目：${project.name}`} />
      <div className="settings-grid">
      <section className="panel settings-section">
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
      <section className="panel settings-section">
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
      <section className="panel settings-section local-data-section">
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
      </div>
    </>
  )
}

export default function App() {
  const { data, storagePath, setStoragePath, status, setStatus, saveData, replaceData: replaceStoredData } = useAppData()
  const [currentProjectId, setCurrentProjectId] = useState<ID | null>(null)
  const [view, setView] = useState<View>('dashboard')
  const [revisionPrefill, setRevisionPrefill] = useState<{ chapterId: ID | null; draftId: ID | null; requestId: ID } | null>(null)
  const [pipelineSnapshotId, setPipelineSnapshotId] = useState<ID | null>(null)

  async function replaceData(next: AppData, nextStoragePath?: string) {
    replaceStoredData(next, nextStoragePath)
    setCurrentProjectId(next.projects[0]?.id ?? null)
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
    prompt: (
      <PromptBuilderView
        data={data}
        project={currentProject}
        saveData={saveData}
        onSendToPipeline={(snapshotId) => {
          setPipelineSnapshotId(snapshotId)
          setView('pipeline')
        }}
      />
    ),
    pipeline: (
      <GenerationPipelineView
        data={data}
        project={currentProject}
        saveData={saveData}
        initialSnapshotId={pipelineSnapshotId}
        onInitialSnapshotConsumed={() => setPipelineSnapshotId(null)}
        onOpenRevision={(prefill) => {
          setRevisionPrefill(prefill)
          setView('revision')
        }}
      />
    ),
    revision: (
      <RevisionStudioView
        data={data}
        project={currentProject}
        saveData={saveData}
        prefill={revisionPrefill}
        onPrefillConsumed={() => setRevisionPrefill(null)}
      />
    ),
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

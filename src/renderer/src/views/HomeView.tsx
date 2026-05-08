import { useState } from 'react'
import { createEmptyBible } from '../../../shared/defaults'
import type { ID, Project } from '../../../shared/types'
import { useConfirm } from '../components/ConfirmDialog'
import { EmptyState, TextArea, TextInput } from '../components/FormFields'
import { Header, type View } from '../components/Layout'
import { formatDate, newId, now } from '../utils/format'
import type { PersistProps } from './viewTypes'

export function HomeView({
  data,
  saveData,
  setProjectId,
  setView
}: PersistProps & {
  setProjectId: (id: ID) => void
  setView: (view: View) => void
}) {
  const confirmAction = useConfirm()
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
    await saveData((current) => ({
      ...current,
      projects: [project, ...current.projects],
      storyBibles: [createEmptyBible(project.id), ...current.storyBibles]
    }))
    setDraft({ name: '', genre: '', description: '', targetReaders: '', coreAppeal: '', style: '' })
    setProjectId(project.id)
    setView('dashboard')
  }

  async function saveProjectEdit() {
    if (!editing) return
    await saveData((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id === editing.id ? { ...editing, updatedAt: now() } : project
      )
    }))
    setEditing(null)
  }

  async function deleteProject(project: Project) {
    const confirmed = await confirmAction({
      title: '删除项目',
      message: `确定删除《${project.name}》及其全部本地数据吗？此操作不可撤销。`,
      confirmLabel: '删除项目',
      tone: 'danger'
    })
    if (!confirmed) return

    await saveData((current) => {
      const projectJobIds = new Set(current.chapterGenerationJobs.filter((item) => item.projectId === project.id).map((item) => item.id))
      const projectRevisionSessionIds = new Set(current.revisionSessions.filter((item) => item.projectId === project.id).map((item) => item.id))
      return {
        ...current,
        projects: current.projects.filter((item) => item.id !== project.id),
        storyBibles: current.storyBibles.filter((item) => item.projectId !== project.id),
        chapters: current.chapters.filter((item) => item.projectId !== project.id),
        characters: current.characters.filter((item) => item.projectId !== project.id),
        characterStateLogs: current.characterStateLogs.filter((item) => item.projectId !== project.id),
        foreshadowings: current.foreshadowings.filter((item) => item.projectId !== project.id),
        timelineEvents: current.timelineEvents.filter((item) => item.projectId !== project.id),
        stageSummaries: current.stageSummaries.filter((item) => item.projectId !== project.id),
        promptVersions: current.promptVersions.filter((item) => item.projectId !== project.id),
        promptContextSnapshots: current.promptContextSnapshots.filter((item) => item.projectId !== project.id),
        chapterContinuityBridges: current.chapterContinuityBridges.filter((item) => item.projectId !== project.id),
        chapterGenerationJobs: current.chapterGenerationJobs.filter((item) => item.projectId !== project.id),
        chapterGenerationSteps: current.chapterGenerationSteps.filter((item) => !projectJobIds.has(item.jobId)),
        generatedChapterDrafts: current.generatedChapterDrafts.filter((item) => item.projectId !== project.id),
        memoryUpdateCandidates: current.memoryUpdateCandidates.filter((item) => item.projectId !== project.id),
        consistencyReviewReports: current.consistencyReviewReports.filter((item) => item.projectId !== project.id),
        contextBudgetProfiles: current.contextBudgetProfiles.filter((item) => item.projectId !== project.id),
        qualityGateReports: current.qualityGateReports.filter((item) => item.projectId !== project.id),
        generationRunTraces: current.generationRunTraces.filter((item) => item.projectId !== project.id),
        redundancyReports: current.redundancyReports.filter((item) => item.projectId !== project.id),
        revisionCandidates: current.revisionCandidates.filter((item) => item.projectId !== project.id),
        revisionSessions: current.revisionSessions.filter((item) => item.projectId !== project.id),
        revisionRequests: current.revisionRequests.filter((item) => !projectRevisionSessionIds.has(item.sessionId)),
        revisionVersions: current.revisionVersions.filter((item) => !projectRevisionSessionIds.has(item.sessionId)),
        chapterVersions: current.chapterVersions.filter((item) => item.projectId !== project.id)
      }
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
            <TextInput label="类型 / 题材" value={draft.genre} onChange={(genre) => setDraft({ ...draft, genre })} />
          </div>
          <TextArea label="简介" rows={3} value={draft.description} onChange={(description) => setDraft({ ...draft, description })} />
          <div className="form-grid">
            <TextInput label="目标读者" value={draft.targetReaders} onChange={(targetReaders) => setDraft({ ...draft, targetReaders })} />
            <TextInput label="整体风格" value={draft.style} onChange={(style) => setDraft({ ...draft, style })} />
          </div>
          <TextArea label="核心爽点 / 情绪体验" rows={3} value={draft.coreAppeal} onChange={(coreAppeal) => setDraft({ ...draft, coreAppeal })} />
          <button className="primary-button" onClick={createProject}>
            创建并进入工作台
          </button>
        </div>
        <div className="panel project-list-panel">
          <h2>项目列表</h2>
          {data.projects.length === 0 ? (
            <EmptyState title="还没有小说项目" description="创建一个项目后，就可以维护小说圣经、章节复盘和 Prompt 上下文。" />
          ) : (
            <div className="project-list">
              {data.projects.map((project) => (
                <article className="project-row" key={project.id}>
                  {editing?.id === project.id ? (
                    <div className="edit-project">
                      <TextInput label="项目名" value={editing.name} onChange={(name) => setEditing({ ...editing, name })} />
                      <TextInput label="类型 / 题材" value={editing.genre} onChange={(genre) => setEditing({ ...editing, genre })} />
                      <TextArea label="简介" rows={3} value={editing.description} onChange={(description) => setEditing({ ...editing, description })} />
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

import { useState } from 'react'
import type { ID, Project } from '../../../shared/types'
import { createEmptyBible } from '../../../shared/defaults'
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

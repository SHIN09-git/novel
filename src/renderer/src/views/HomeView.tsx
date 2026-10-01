import { useMemo, useRef, useState } from 'react'
import { ChevronDown, FileUp, LoaderCircle, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { createEmptyBible } from '../../../shared/defaults'
import type { ID, Project } from '../../../shared/types'
import {
  formatProjectDeletionImpact,
  getProjectDeletionSummary,
  markProjectOpened,
  removeProjectFromAppData
} from '../../../services/ProjectLifecycleService'
import { useConfirm } from '../components/ConfirmDialog'
import { EmptyState, TextArea, TextInput } from '../components/FormFields'
import { Header, type View } from '../components/Layout'
import { formatDate, newId, now } from '../utils/format'
import { formatMergeConflictSummary } from '../utils/importFeedback'
import type { ImportDataHandler, PersistProps } from './viewTypes'
import {
  applyProjectFields,
  emptyProjectFields,
  projectFieldsFrom,
  projectMatchesSearch,
  projectsByRecentOpen as sortProjectsByRecentOpen,
  type ProjectFields
} from './home/homeProjectState'
import '../styles/views/home.css'

type EditingProject = { id: ID; fields: ProjectFields }
type BusyAction = 'create' | 'import' | 'open' | 'edit' | 'delete'

export function HomeView({
  data,
  saveData,
  importData,
  setProjectId,
  setView
}: PersistProps & {
  importData: ImportDataHandler
  setProjectId: (id: ID) => void
  setView: (view: View) => void
}) {
  const confirmAction = useConfirm()
  const [draft, setDraft] = useState<ProjectFields>(emptyProjectFields)
  const [editing, setEditing] = useState<EditingProject | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(data.projects.length === 0)
  const [searchQuery, setSearchQuery] = useState('')
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const busyActionRef = useRef<BusyAction | null>(null)
  const createProjectFormRef = useRef<HTMLFormElement>(null)
  const createProjectNameRef = useRef<HTMLInputElement>(null)
  const projectsByRecentOpen = useMemo(() => {
    return sortProjectsByRecentOpen(data.projects)
  }, [data.projects])
  const visibleProjects = useMemo(
    () => projectsByRecentOpen.filter((project) => projectMatchesSearch(project, searchQuery)),
    [projectsByRecentOpen, searchQuery]
  )
  const isBusy = busyAction !== null

  function updateDraft(field: keyof ProjectFields, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  function updateEditing(field: keyof ProjectFields, value: string) {
    setEditing((current) => current ? { ...current, fields: { ...current.fields, [field]: value } } : null)
  }

  function reportSaveFailure(action: string, errorMessage: string) {
    setOperationError(`${action}失败：${errorMessage}`)
  }

  function reportUnexpectedFailure(action: string, error: unknown) {
    reportSaveFailure(action, error instanceof Error ? error.message : String(error))
  }

  function beginAction(action: BusyAction): boolean {
    if (busyActionRef.current) return false
    busyActionRef.current = action
    setBusyAction(action)
    return true
  }

  function finishAction() {
    busyActionRef.current = null
    setBusyAction(null)
  }

  function revealCreateProjectForm() {
    setIsCreateOpen(true)
    requestAnimationFrame(() => {
      const form = createProjectFormRef.current
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      form?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
      createProjectNameRef.current?.focus({ preventScroll: true })
    })
  }

  async function openProject(projectId: ID) {
    if (!beginAction('open')) return
    setOperationError(null)
    try {
      const saved = await saveData((current) => markProjectOpened(current, projectId, now()))
      if (!saved.ok) {
        reportSaveFailure('打开项目', saved.errorMessage)
        return
      }
      setProjectId(projectId)
      setView('dashboard')
    } catch (error) {
      reportUnexpectedFailure('打开项目', error)
    } finally {
      finishAction()
    }
  }

  async function createProject() {
    if (!draft.name.trim() || !beginAction('create')) return
    setOperationError(null)
    try {
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
        updatedAt: timestamp,
        lastOpenedAt: timestamp
      }
      const saved = await saveData((current) => ({
        ...current,
        projects: [project, ...current.projects],
        storyBibles: [createEmptyBible(project.id), ...current.storyBibles]
      }))
      if (!saved.ok) {
        reportSaveFailure('创建项目', saved.errorMessage)
        return
      }
      setDraft(emptyProjectFields())
      setProjectId(project.id)
      setView('dashboard')
    } catch (error) {
      reportUnexpectedFailure('创建项目', error)
    } finally {
      finishAction()
    }
  }

  async function importExistingData() {
    if (!beginAction('import')) return
    try {
      setOperationError(null)
      const strategy = data.projects.length > 0 ? 'merge' : 'replace'
      const result = await importData(strategy)
      if (result.canceled) return
      if (result.mergeBlocked) {
        setOperationError(`安全合并已停止，当前数据未被覆盖。${formatMergeConflictSummary(result.mergePreview)}。如需完全替换，请到“设置”中明确选择覆盖导入。`)
        return
      }
      if (!result.data) return
      const openedProjectId = result.importedProjectIds?.[0] ?? result.data.projects[0]?.id
      if (openedProjectId) {
        const saved = await saveData((current) => markProjectOpened(current, openedProjectId, now()))
        if (!saved.ok) {
          reportSaveFailure('导入后的打开项目', saved.errorMessage)
          return
        }
        setProjectId(openedProjectId)
        setView('dashboard')
      }
    } catch (error) {
      reportUnexpectedFailure('导入', error)
    } finally {
      finishAction()
    }
  }

  async function saveProjectEdit() {
    if (!editing || !editing.fields.name.trim() || !beginAction('edit')) return
    const editingSnapshot = editing
    setOperationError(null)
    try {
      const saved = await saveData((current) => ({
        ...current,
        projects: current.projects.map((project) =>
          project.id === editingSnapshot.id
            ? applyProjectFields(project, editingSnapshot.fields, now())
            : project
        )
      }))
      if (!saved.ok) {
        reportSaveFailure('保存项目资料', saved.errorMessage)
        return
      }
      setEditing(null)
    } catch (error) {
      reportUnexpectedFailure('保存项目资料', error)
    } finally {
      finishAction()
    }
  }

  async function deleteProject(project: Project) {
    if (!beginAction('delete')) return
    setOperationError(null)
    try {
      const summary = getProjectDeletionSummary(data, project.id)
      const impact = formatProjectDeletionImpact(summary)
      const confirmed = await confirmAction({
        title: '删除项目',
        message: `确定删除《${project.name}》吗？将永久删除 ${summary.totalRelatedRecords} 条关联记录（${impact}）。此操作不可撤销；如需保留，请先在设置中导出数据备份。`,
        confirmLabel: '删除项目',
        tone: 'danger'
      })
      if (!confirmed) return
      const saved = await saveData((current) => removeProjectFromAppData(current, project.id))
      if (!saved.ok) reportSaveFailure('删除项目', saved.errorMessage)
    } catch (error) {
      reportUnexpectedFailure('删除项目', error)
    } finally {
      finishAction()
    }
  }

  return (
    <div className="home">
      <Header
        title="Novel Director"
        description="面向 AI 长篇小说创作的上下文导演台。"
        actions={
          <>
            <button className="ghost-button home-header-action" type="button" onClick={() => void importExistingData()} disabled={isBusy} title="导入或合并旧数据 JSON">
              {busyAction === 'import' ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <FileUp size={16} aria-hidden="true" />}
              导入 JSON
            </button>
            <button className="primary-button home-header-action" type="button" onClick={revealCreateProjectForm} disabled={isBusy} title="新建小说项目">
              <Plus size={16} aria-hidden="true" />
              新建项目
            </button>
          </>
        }
      />
      <main className="home-workspace">
        {operationError ? <p className="notice danger home-operation-notice" role="alert">{operationError}</p> : null}
        <section aria-labelledby="existing-projects-heading">
          <div className="home-section-heading">
            <h2 id="existing-projects-heading">现有项目</h2>
            <span>{data.projects.length} 个项目，按最近打开排序</span>
          </div>
          {data.projects.length > 0 ? (
            <>
              <label className="home-project-search">
                <Search size={17} aria-hidden="true" />
                <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索项目名称、题材或简介" aria-label="搜索项目" disabled={isBusy} />
              </label>
              {visibleProjects.length > 0 ? (
                <div className="home-project-list">
                  {projectsByRecentOpen.map((project) => {
                    if (!projectMatchesSearch(project, searchQuery)) return null
                    return <article className="project-row home-project-row" key={project.id}>
                      {editing?.id === project.id ? (
                        <form className="home-project-form home-edit-form" onSubmit={(event) => { event.preventDefault(); void saveProjectEdit() }}>
                          <fieldset className="home-form-fieldset" disabled={busyAction === 'edit'}>
                          <div className="form-grid">
                            <TextInput label="项目名（必填）" value={editing.fields.name} onChange={(value) => updateEditing('name', value)} />
                            <TextInput label="类型 / 题材" value={editing.fields.genre} onChange={(value) => updateEditing('genre', value)} />
                          </div>
                          <TextArea label="简介" rows={2} value={editing.fields.description} onChange={(value) => updateEditing('description', value)} />
                          <details className="home-advanced-fields">
                            <summary>补充项目资料</summary>
                            <div className="form-grid">
                              <TextInput label="目标读者" value={editing.fields.targetReaders} onChange={(value) => updateEditing('targetReaders', value)} />
                              <TextInput label="整体风格" value={editing.fields.style} onChange={(value) => updateEditing('style', value)} />
                            </div>
                            <TextArea label="核心爽点 / 情绪体验" rows={2} value={editing.fields.coreAppeal} onChange={(value) => updateEditing('coreAppeal', value)} />
                          </details>
                          <div className="row-actions">
                            <button className="primary-button" type="submit" disabled={isBusy || !editing.fields.name.trim()}>{busyAction === 'edit' ? '正在保存...' : '保存资料'}</button>
                            <button className="ghost-button" type="button" disabled={isBusy} onClick={() => setEditing(null)}>取消</button>
                          </div>
                          </fieldset>
                        </form>
                      ) : (
                        <>
                          <div className="home-project-summary">
                            <h3>{project.name}</h3>
                            <p>{project.description || '暂无简介'}</p>
                            <small>{project.genre || '未设置题材'} · 最近打开 {formatDate(project.lastOpenedAt || project.updatedAt || project.createdAt)}</small>
                          </div>
                          <div className="row-actions home-project-actions">
                            <button className="primary-button" type="button" disabled={isBusy} onClick={() => void openProject(project.id)}>{busyAction === 'open' ? '正在打开...' : '进入'}</button>
                            <button className="icon-button" type="button" disabled={isBusy} onClick={() => { setOperationError(null); setEditing({ id: project.id, fields: projectFieldsFrom(project) }) }} aria-label={`编辑《${project.name}》`} title="编辑项目资料"><Pencil size={16} aria-hidden="true" /></button>
                            <button className="icon-button" type="button" disabled={isBusy} onClick={() => void deleteProject(project)} aria-label={`删除《${project.name}》`} title="删除项目"><Trash2 size={16} aria-hidden="true" /></button>
                          </div>
                        </>
                      )}
                    </article>
                  })}
                </div>
              ) : <div className="home-empty"><EmptyState title="没有匹配的项目" description="试试名称、题材、简介或项目资料中的词语。" /></div>}
            </>
          ) : <div className="home-empty"><EmptyState title="还没有小说项目" description="新建项目，或从旧数据 JSON 导入继续工作。" /></div>}
        </section>
        <section aria-labelledby="create-project-heading">
          <button className="home-disclosure" type="button" aria-expanded={isCreateOpen} aria-controls="create-project-form" onClick={() => setIsCreateOpen((open) => !open)} disabled={isBusy}>
            <span><strong id="create-project-heading">创建新项目</strong><small>项目名为必填项；其余资料可以稍后补充。</small></span>
            <ChevronDown size={18} aria-hidden="true" />
          </button>
          {isCreateOpen ? (
            <form className="home-project-form" id="create-project-form" ref={createProjectFormRef} onSubmit={(event) => { event.preventDefault(); void createProject() }}>
              <fieldset className="home-form-fieldset" disabled={busyAction === 'create'}>
              <label className="field">
                <span className="field-label">项目名（必填）</span>
                <input ref={createProjectNameRef} value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} placeholder="例如：长安夜航" />
              </label>
              <TextArea label="简介" rows={2} value={draft.description} onChange={(value) => updateDraft('description', value)} placeholder="一句话说明这个故事从哪里开始。" />
              <details className="home-advanced-fields">
                <summary>补充项目资料</summary>
                <div className="form-grid">
                  <TextInput label="类型 / 题材" value={draft.genre} onChange={(value) => updateDraft('genre', value)} />
                  <TextInput label="目标读者" value={draft.targetReaders} onChange={(value) => updateDraft('targetReaders', value)} />
                  <TextInput label="整体风格" value={draft.style} onChange={(value) => updateDraft('style', value)} />
                </div>
                <TextArea label="核心爽点 / 情绪体验" rows={2} value={draft.coreAppeal} onChange={(value) => updateDraft('coreAppeal', value)} />
              </details>
              <div className="row-actions">
                <button className="primary-button" type="submit" disabled={isBusy || !draft.name.trim()}>{busyAction === 'create' ? '正在创建...' : '创建并进入工作台'}</button>
                <button className="ghost-button" type="button" disabled={isBusy} onClick={() => { setDraft(emptyProjectFields()); setIsCreateOpen(false) }}>取消</button>
              </div>
              </fieldset>
            </form>
          ) : null}
        </section>
      </main>
    </div>
  )
}

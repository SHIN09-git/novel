import type { ReactNode } from 'react'
import type { ID, Project } from '../../../shared/types'

export type View =
  | 'dashboard'
  | 'bible'
  | 'chapters'
  | 'characters'
  | 'foreshadowings'
  | 'timeline'
  | 'stages'
  | 'prompt'
  | 'pipeline'
  | 'settings'

export const viewLabels: Record<View, string> = {
  dashboard: '工作台',
  bible: '小说圣经',
  chapters: '章节',
  characters: '角色',
  foreshadowings: '伏笔',
  timeline: '时间线',
  stages: '阶段摘要',
  prompt: 'Prompt 构建器',
  pipeline: '生产流水线',
  settings: '设置'
}

export function Shell({
  project,
  view,
  setView,
  setProjectId,
  children,
  status
}: {
  project: Project
  view: View
  setView: (view: View) => void
  setProjectId: (id: ID | null) => void
  children: ReactNode
  status: string
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="ghost-button back-button" onClick={() => setProjectId(null)}>
          ← 项目列表
        </button>
        <div className="project-badge">
          <span>当前项目</span>
          <strong>{project.name}</strong>
          <small>{project.genre || '未设置题材'}</small>
        </div>
        <nav className="nav-list">
          {(Object.keys(viewLabels) as View[]).map((item) => (
            <button key={item} className={item === view ? 'active' : ''} onClick={() => setView(item)}>
              {viewLabels[item]}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">{status || '本地自动保存已就绪'}</div>
      </aside>
      <main className="main-panel">{children}</main>
    </div>
  )
}

export function Header({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="header-actions">{actions}</div> : null}
    </header>
  )
}

import type { ReactNode } from 'react'
import type { ID, Project } from '../../../../shared/types'
import { type View, viewIcons, viewLabels } from './types'

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
        <div className="brand-mark">
          <div className="brand-symbol">ND</div>
          <div>
            <strong>Novel Director</strong>
            <span>AI 长篇小说工作室</span>
          </div>
        </div>
        <div className="project-badge">
          <span>当前项目</span>
          <strong>{project.name}</strong>
          <small>{project.genre || '未设置题材'}</small>
        </div>
        <nav className="nav-list">
          {(Object.keys(viewLabels) as View[]).map((item) => (
            <button key={item} className={item === view ? 'active' : ''} onClick={() => setView(item)}>
              <span className="nav-icon">{viewIcons[item]}</span>
              <span>{viewLabels[item]}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="back-button" onClick={() => setProjectId(null)}>
            返回项目列表
          </button>
          <span>{status || '本地自动保存就绪'}</span>
        </div>
      </aside>
      <main className="main-panel">{children}</main>
    </div>
  )
}

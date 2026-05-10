import type { ReactNode } from 'react'
import type { ID, Project } from '../../../../shared/types'
import { type View, viewLabels } from './types'

function IconSvg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

function NavIcon({ view }: { view: View }) {
  switch (view) {
    case 'dashboard':
      return (
        <IconSvg>
          <rect x="4" y="4" width="6" height="6" rx="1.5" />
          <rect x="14" y="4" width="6" height="6" rx="1.5" />
          <rect x="4" y="14" width="6" height="6" rx="1.5" />
          <rect x="14" y="14" width="6" height="6" rx="1.5" />
        </IconSvg>
      )
    case 'bible':
      return (
        <IconSvg>
          <path d="M4 5.5c2.8-1.1 5.2-1 8 1v13c-2.8-2-5.2-2.1-8-1V5.5Z" />
          <path d="M12 6.5c2.8-2 5.2-2.1 8-1v13c-2.8-1.1-5.2-1-8 1v-13Z" />
        </IconSvg>
      )
    case 'chapters':
      return (
        <IconSvg>
          <rect x="5" y="3.5" width="14" height="17" rx="2" />
          <path d="M9 8h6" />
          <path d="M9 12h6" />
          <path d="M9 16h3.5" />
        </IconSvg>
      )
    case 'characters':
      return (
        <IconSvg>
          <circle cx="12" cy="7.5" r="3.5" />
          <path d="M5 20c.8-4 3.2-6 7-6s6.2 2 7 6" />
        </IconSvg>
      )
    case 'foreshadowings':
      return (
        <IconSvg>
          <path d="M5 16c4.8 0 5.4-3.6 5.4-7.1" />
          <path d="M10.4 8.9c0-2.7 1.7-4.4 4.4-4.4h3" />
          <path d="M10.4 11.7c1.1 1.9 2.8 2.8 5.1 2.8H19" />
          <circle cx="5" cy="16" r="2" />
          <circle cx="18" cy="4.5" r="2" />
          <circle cx="19" cy="14.5" r="2" />
        </IconSvg>
      )
    case 'timeline':
      return (
        <IconSvg>
          <path d="M12 3v18" />
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
          <path d="M10 12H6" />
          <path d="M14 19h4" />
        </IconSvg>
      )
    case 'stages':
      return (
        <IconSvg>
          <path d="m12 4 8 4-8 4-8-4 8-4Z" />
          <path d="m4 12 8 4 8-4" />
          <path d="m4 16 8 4 8-4" />
        </IconSvg>
      )
    case 'hardCanon':
      return (
        <IconSvg>
          <path d="M12 3.5 19 6v5.4c0 4.4-2.8 7.5-7 9.1-4.2-1.6-7-4.7-7-9.1V6l7-2.5Z" />
          <path d="M8.5 12.2 11 14.6l4.8-5.2" />
        </IconSvg>
      )
    case 'direction':
      return (
        <IconSvg>
          <circle cx="12" cy="12" r="9" />
          <path d="m15.5 8.5-2.2 5-5 2.2 2.2-5 5-2.2Z" />
        </IconSvg>
      )
    case 'prompt':
      return (
        <IconSvg>
          <path d="M8 5H5v14h3" />
          <path d="M16 5h3v14h-3" />
          <path d="M12 7.5 13.2 11l3.3 1-3.3 1L12 16.5 10.8 13l-3.3-1 3.3-1L12 7.5Z" />
        </IconSvg>
      )
    case 'pipeline':
      return (
        <IconSvg>
          <rect x="9" y="3" width="6" height="5" rx="1" />
          <rect x="3" y="16" width="6" height="5" rx="1" />
          <rect x="15" y="16" width="6" height="5" rx="1" />
          <path d="M12 8v4" />
          <path d="M6 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
        </IconSvg>
      )
    case 'revision':
      return (
        <IconSvg>
          <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
          <path d="M13.5 8.5 16 11" />
          <path d="M11 20h9" />
        </IconSvg>
      )
    case 'settings':
      return (
        <IconSvg>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3.5v2.1" />
          <path d="M12 18.4v2.1" />
          <path d="M3.5 12h2.1" />
          <path d="M18.4 12h2.1" />
          <path d="m6 6 1.5 1.5" />
          <path d="m16.5 16.5 1.5 1.5" />
          <path d="m18 6-1.5 1.5" />
          <path d="m7.5 16.5-1.5 1.5" />
          <circle cx="12" cy="12" r="6.4" />
        </IconSvg>
      )
  }
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
              <span className="nav-icon"><NavIcon view={item} /></span>
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

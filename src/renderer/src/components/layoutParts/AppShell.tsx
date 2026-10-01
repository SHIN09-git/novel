import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { ID, Project } from '../../../../shared/types'
import { type View, viewLabels } from './types'
import appIconUrl from '../../../../../build/icon.png'

const navGroups: Array<{ label: string; items: View[] }> = [
  { label: '写作', items: ['dashboard', 'inbox', 'chapters', 'reader', 'pipeline', 'revision'] },
  { label: '故事世界', items: ['direction', 'characters', 'foreshadowings', 'hardCanon', 'bible', 'timeline'] },
  { label: '资料与高级', items: ['stages', 'prompt', 'agentRuns'] },
  { label: '系统', items: ['settings'] }
]

const SIDEBAR_COLLAPSED_KEY = 'novel-director:sidebar-collapsed'

function readSidebarCollapsed() {
  try {
    return window.localStorage?.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeSidebarCollapsed(collapsed: boolean) {
  try {
    window.localStorage?.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // Storage can be unavailable; the toggle still works for this session.
  }
}

// Replays a short settle-in on each route change without remounting the view.
function useViewEnterAnimation(view: View) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof element.animate !== 'function') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const animation = element.animate(
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'none' }
      ],
      { duration: 240, easing: 'cubic-bezier(0.22, 0.8, 0.24, 1)' }
    )
    return () => animation.cancel()
  }, [view])
  return ref
}

// One highlight slides between nav items instead of each item fading its own background.
function useNavIndicator(view: View, enabled: boolean) {
  const navRef = useRef<HTMLElement | null>(null)
  const indicatorRef = useRef<HTMLSpanElement | null>(null)
  useLayoutEffect(() => {
    const nav = navRef.current
    const indicator = indicatorRef.current
    if (!enabled || !nav || !indicator) return
    const place = () => {
      const active = nav.querySelector<HTMLElement>('button[aria-current="page"]')
      if (!active) {
        nav.removeAttribute('data-indicator-ready')
        return
      }
      indicator.style.transform = `translateY(${active.offsetTop}px)`
      indicator.style.height = `${active.offsetHeight}px`
    }
    place()
    if (!nav.hasAttribute('data-indicator-ready')) {
      // Skip the slide on first placement so the highlight starts where the user already is.
      const frame = requestAnimationFrame(() => nav.setAttribute('data-indicator-ready', ''))
      return () => cancelAnimationFrame(frame)
    }
    return undefined
  }, [view, enabled])
  return { navRef, indicatorRef }
}

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
    case 'inbox':
      return (
        <IconSvg>
          <path d="M4 5.5h16v13H4v-13Z" />
          <path d="M4 13h4l1.5 2h5l1.5-2h4" />
          <path d="M8 9h8" />
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
    case 'reader':
      return (
        <IconSvg>
          <path d="M4 5.5c2.8-1.1 5.2-1 8 1v13c-2.8-2-5.2-2.1-8-1V5.5Z" />
          <path d="M12 6.5c2.8-2 5.2-2.1 8-1v13c-2.8-1.1-5.2-1-8 1v-13Z" />
          <path d="M8 9h2" />
          <path d="M8 12h2" />
          <path d="M14 9h2" />
          <path d="M14 12h2" />
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
    case 'agentRuns':
      return (
        <IconSvg>
          <rect x="4" y="5" width="16" height="12" rx="2.5" />
          <path d="M8 9h.1" />
          <path d="M16 9h.1" />
          <path d="M9 13h6" />
          <path d="M12 3v2" />
          <path d="M7 20h10" />
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)
  const contentRef = useViewEnterAnimation(view)
  const currentGroup = navGroups.find((group) => group.items.includes(view))?.label

  const { navRef, indicatorRef } = useNavIndicator(view, !sidebarCollapsed)

  useEffect(() => writeSidebarCollapsed(sidebarCollapsed), [sidebarCollapsed])
  const saveStateTone = /失败|冲突|错误/.test(status)
    ? 'danger'
    : /正在|保存中|迁移/.test(status)
      ? 'busy'
      : 'ready'

  return (
    <div className="app-shell" data-sidebar-collapsed={sidebarCollapsed || undefined} data-writing-workspace={['chapters', 'pipeline', 'revision', 'reader'].includes(view) ? 'true' : undefined}>
      <a className="skip-to-content" href="#workspace-main">跳到正文工作区</a>
      <aside className="sidebar" id="workspace-sidebar" hidden={sidebarCollapsed} inert={sidebarCollapsed || undefined} aria-label="项目导航">
        <div className="brand-mark">
          <div className="brand-symbol" aria-hidden="true">
            <img src={appIconUrl} alt="" />
          </div>
          <div>
            <strong>Novel Director</strong>
            <span>长篇小说导演台</span>
          </div>
        </div>
        <button type="button" className="back-button" onClick={() => setProjectId(null)}>
          <ArrowLeft size={16} aria-hidden="true" />
          返回项目列表
        </button>
        <div className="project-badge">
          <span className="project-badge-label">当前作品</span>
          <strong title={project.name}>{project.name}</strong>
          {project.genre && <small>{project.genre}</small>}
        </div>
        <nav className="nav-list" aria-label="工作台功能" ref={navRef}>
          <span className="nav-indicator" ref={indicatorRef} aria-hidden="true" />
          {navGroups.map((group) => (
            <div className={`nav-group${group.items.includes(view) ? ' current' : ''}`} key={group.label}>
              <span className="nav-group-label">{group.label}</span>
              {group.items.map((item) => (
                <button
                  key={item}
                  className={item === view ? 'active' : ''}
                  aria-current={item === view ? 'page' : undefined}
                  onClick={() => setView(item)}
                >
                  <span className="nav-icon"><NavIcon view={item} /></span>
                  <span>{viewLabels[item]}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <main className="main-panel" id="workspace-main" tabIndex={-1}>
        <div className="workspace-topbar">
          <button
            type="button"
            className="sidebar-toggle icon-button"
            aria-controls="workspace-sidebar"
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={19} aria-hidden="true" /> : <PanelLeftClose size={19} aria-hidden="true" />}
          </button>
          <div className="workspace-location">
            <span className="workspace-project-name" title={project.name}>{project.name}</span>
            <span className="workspace-location-separator workspace-project-separator" aria-hidden="true">/</span>
            {currentGroup ? <span className="workspace-group-name">{currentGroup}</span> : null}
            {currentGroup ? <span className="workspace-location-separator" aria-hidden="true">/</span> : null}
            <strong>{viewLabels[view]}</strong>
          </div>
          <div className={`workspace-save-state ${saveStateTone}`} aria-live="polite">
            <strong key={status}>{status || '本地自动保存就绪'}</strong>
          </div>
        </div>
        <div className="workspace-content" ref={contentRef}>{children}</div>
      </main>
    </div>
  )
}

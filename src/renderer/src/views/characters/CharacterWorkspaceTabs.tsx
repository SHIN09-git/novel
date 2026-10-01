import type { KeyboardEvent } from 'react'

const tabs = [
  { id: 'profile', label: '角色资料' },
  { id: 'ledger', label: '动态账本' },
  { id: 'logs', label: '状态日志' }
] as const

export type CharacterWorkspaceTab = typeof tabs[number]['id']

export function CharacterWorkspaceTabs({ activeTab, onChange, pendingCount }: {
  activeTab: CharacterWorkspaceTab
  onChange: (tab: CharacterWorkspaceTab) => void
  pendingCount: number
}) {
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
    if (next === null) return
    event.preventDefault()
    onChange(tabs[next].id)
    document.getElementById(`character-tab-${tabs[next].id}`)?.focus()
  }

  return <div className="character-workspace-tabs" role="tablist" aria-label="角色工作区">
    {tabs.map((tab, index) => <button
      key={tab.id}
      type="button"
      role="tab"
      id={`character-tab-${tab.id}`}
      aria-controls={`character-panel-${tab.id}`}
      aria-selected={activeTab === tab.id}
      tabIndex={activeTab === tab.id ? 0 : -1}
      onClick={() => onChange(tab.id)}
      onKeyDown={(event) => moveFocus(event, index)}
    >
      {tab.label}
      {tab.id === 'ledger' && pendingCount > 0
        ? <span className="character-pending-count" aria-label={`${pendingCount} 项待确认`}>{pendingCount}</span>
        : null}
    </button>)}
  </div>
}

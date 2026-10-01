import type { KeyboardEvent } from 'react'

const tabs = [
  { id: 'task', label: '任务' },
  { id: 'editor', label: 'Prompt' },
  { id: 'context', label: '上下文' },
  { id: 'history', label: '历史' }
] as const

export type PromptWorkspaceTab = typeof tabs[number]['id']

export function PromptWorkspaceTabs({ activeTab, onChange }: {
  activeTab: PromptWorkspaceTab
  onChange: (tab: PromptWorkspaceTab) => void
}) {
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
    if (next === null) return
    event.preventDefault()
    onChange(tabs[next].id)
    document.getElementById(`prompt-workspace-tab-${tabs[next].id}`)?.focus()
  }

  return <div className="prompt-workspace-tabs" role="tablist" aria-label="Prompt 工作区">
    {tabs.map((tab, index) => <button
      key={tab.id}
      id={`prompt-workspace-tab-${tab.id}`}
      type="button"
      role="tab"
      aria-controls={`prompt-workspace-panel-${tab.id}`}
      aria-selected={activeTab === tab.id}
      tabIndex={activeTab === tab.id ? 0 : -1}
      onKeyDown={(event) => moveFocus(event, index)}
      onClick={() => onChange(tab.id)}
    >{tab.label}</button>)}
  </div>
}

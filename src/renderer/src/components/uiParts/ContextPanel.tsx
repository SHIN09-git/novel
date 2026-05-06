import type { ReactNode } from 'react'

export function ContextPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="context-panel">
      <h2>{title}</h2>
      {children}
    </aside>
  )
}

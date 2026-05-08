import type { ReactNode } from 'react'

export function PipelineLayout({
  topBar,
  sidebar,
  main,
  inspector
}: {
  topBar: ReactNode
  sidebar: ReactNode
  main: ReactNode
  inspector: ReactNode
}) {
  return (
    <div className="pipeline-shell">
      <div className="pipeline-top-status">{topBar}</div>
      <div className="pipeline-console-grid">
        <aside className="pipeline-sidebar">{sidebar}</aside>
        <main className="pipeline-main">{main}</main>
        <aside className="pipeline-inspector">{inspector}</aside>
      </div>
    </div>
  )
}

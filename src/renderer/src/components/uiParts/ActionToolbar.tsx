import type { ReactNode } from 'react'

export function ActionToolbar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`action-toolbar ${className}`.trim()}>{children}</div>
}

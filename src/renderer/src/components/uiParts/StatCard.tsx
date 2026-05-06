import type { ReactNode } from 'react'
import type { BadgeTone } from './StatusBadge'

export function StatCard({
  label,
  value,
  detail,
  tone = 'neutral'
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  tone?: BadgeTone
}) {
  return (
    <article className={`stat-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <p>{detail}</p> : null}
    </article>
  )
}

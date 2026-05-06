import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={`status-badge ${tone}`}>{children}</span>
}

export function WeightBadge({ weight, label }: { weight: string; label: string }) {
  const tone = weight === 'high' || weight === 'payoff' ? 'warning' : weight === 'medium' ? 'accent' : 'neutral'
  return <StatusBadge tone={tone}>{label}</StatusBadge>
}

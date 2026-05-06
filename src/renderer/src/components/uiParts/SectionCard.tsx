import type { ReactNode } from 'react'

export function SectionCard({
  title,
  description,
  actions,
  children,
  className = ''
}: {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`section-card ${className}`.trim()}>
      {title || description || actions ? (
        <div className="section-card-header">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="section-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

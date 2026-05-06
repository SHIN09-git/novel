import type { ReactNode } from 'react'

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  )
}

export function TextInput({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <Field label={label}>
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </Field>
  )
}

export function NumberInput({
  label,
  value,
  onChange,
  min
}: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  min?: number
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={min}
        value={value ?? ''}
        onChange={(event) => {
          const raw = event.target.value
          onChange(raw === '' ? null : Number(raw))
        }}
      />
    </Field>
  )
}

export function TextArea({
  label,
  value,
  onChange,
  rows = 5,
  hint,
  placeholder,
  onBlur,
  className
}: {
  label: string
  value: string
  onChange: (value: string) => void
  rows?: number
  hint?: string
  placeholder?: string
  onBlur?: () => void
  className?: string
}) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        className={className}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function Toggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  )
}

import type { ReactNode } from 'react'
import { useBufferedField } from '../hooks/useBufferedField'

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
  placeholder,
  onBlur,
  debounceMs,
  bufferKey
}: {
  label: string
  value: string
  onChange: (value: string) => void | Promise<unknown>
  placeholder?: string
  onBlur?: () => void
  debounceMs?: number
  bufferKey?: string | number | null
}) {
  const buffered = useBufferedField({ value, onCommit: onChange, delayMs: debounceMs, resetKey: bufferKey })
  return (
    <Field label={label}>
      <input
        value={buffered.value}
        placeholder={placeholder}
        onBlur={() => {
          buffered.flush()
          onBlur?.()
        }}
        onChange={(event) => buffered.onChange(event.target.value)}
      />
    </Field>
  )
}

export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  hint
}: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
  hint?: string
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        min={min}
        max={max}
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
  className,
  debounceMs,
  bufferKey
}: {
  label: string
  value: string
  onChange: (value: string) => void | Promise<unknown>
  rows?: number
  hint?: string
  placeholder?: string
  onBlur?: () => void
  className?: string
  debounceMs?: number
  bufferKey?: string | number | null
}) {
  const buffered = useBufferedField({ value, onCommit: onChange, delayMs: debounceMs, resetKey: bufferKey })
  return (
    <Field label={label} hint={hint}>
      <textarea
        className={className}
        rows={rows}
        value={buffered.value}
        placeholder={placeholder}
        onBlur={() => {
          buffered.flush()
          onBlur?.()
        }}
        onChange={(event) => buffered.onChange(event.target.value)}
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

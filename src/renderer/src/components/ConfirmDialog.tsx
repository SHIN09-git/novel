import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react'

export interface ConfirmDialogOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
}

export type ConfirmInput = string | ConfirmDialogOptions
export type ConfirmFn = (input: ConfirmInput) => Promise<boolean>

const ConfirmDialogContext = createContext<ConfirmFn | null>(null)

function normalizeConfirmInput(input: ConfirmInput): ConfirmDialogOptions {
  return typeof input === 'string'
    ? { title: '确认操作', message: input, confirmLabel: '确认', cancelLabel: '取消', tone: 'default' }
    : {
        title: input.title ?? '确认操作',
        message: input.message,
        confirmLabel: input.confirmLabel ?? '确认',
        cancelLabel: input.cancelLabel ?? '取消',
        tone: input.tone ?? 'default'
      }
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmDialogOptions | null>(null)
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null)

  const confirmAction = useCallback<ConfirmFn>((input) => {
    resolverRef.current?.(false)
    const nextOptions = normalizeConfirmInput(input)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
      setOptions(nextOptions)
    })
  }, [])

  const close = useCallback((confirmed: boolean) => {
    resolverRef.current?.(confirmed)
    resolverRef.current = null
    setOptions(null)
  }, [])

  return (
    <ConfirmDialogContext.Provider value={confirmAction}>
      {children}
      {options ? (
        <div className="confirm-overlay" role="presentation" onMouseDown={() => close(false)}>
          <section
            className={`confirm-dialog ${options.tone === 'danger' ? 'danger' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="confirm-dialog-title">{options.title}</h2>
            <p>{options.message}</p>
            <div className="row-actions">
              <button className="ghost-button" onClick={() => close(false)}>
                {options.cancelLabel}
              </button>
              <button className={options.tone === 'danger' ? 'danger-button' : 'primary-button'} onClick={() => close(true)}>
                {options.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </ConfirmDialogContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const confirmAction = useContext(ConfirmDialogContext)
  return useCallback<ConfirmFn>(
    (input) => {
      if (confirmAction) return confirmAction(input)
      const options = normalizeConfirmInput(input)
      return Promise.resolve(window.confirm(options.message))
    },
    [confirmAction]
  )
}

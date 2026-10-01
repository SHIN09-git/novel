import { createContext, type KeyboardEvent, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'

export interface ConfirmDialogOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string | null
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
        cancelLabel: input.cancelLabel === undefined ? '取消' : input.cancelLabel,
        tone: input.tone ?? 'default'
      }
}

const DIALOG_EXIT_MS = 160

function prefersReducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmDialogOptions | null>(null)
  // The last closed dialog stays painted briefly so it can animate out; it is inert and already resolved.
  const [exiting, setExiting] = useState<ConfirmDialogOptions | null>(null)
  const optionsRef = useRef<ConfirmDialogOptions | null>(null)
  optionsRef.current = options
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const confirmAction = useCallback<ConfirmFn>((input) => {
    if (!resolverRef.current && document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement
    }
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
    if (optionsRef.current && !prefersReducedMotion()) setExiting(optionsRef.current)
    setOptions(null)
    const returnFocus = returnFocusRef.current
    returnFocusRef.current = null
    requestAnimationFrame(() => {
      if (returnFocus?.isConnected) returnFocus.focus()
    })
  }, [])

  useEffect(() => {
    if (!options) return
    ;(cancelButtonRef.current ?? confirmButtonRef.current ?? dialogRef.current)?.focus()
  }, [options])

  useEffect(() => {
    if (!exiting) return
    const timer = window.setTimeout(() => setExiting(null), DIALOG_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [exiting])

  const shown = options ?? exiting
  const isClosing = !options && Boolean(exiting)

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close(false)
      return
    }
    if (event.key !== 'Tab') return

    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) ?? [])].filter((element) => element.tabIndex >= 0)
    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }, [close])

  return (
    <ConfirmDialogContext.Provider value={confirmAction}>
      {children}
      {shown ? (
        <div
          className={`confirm-overlay${isClosing ? ' is-closing' : ''}`}
          role="presentation"
          aria-hidden={isClosing || undefined}
          inert={isClosing || undefined}
          onMouseDown={() => { if (!isClosing) close(false) }}
        >
          <section
            ref={dialogRef}
            className={`confirm-dialog ${shown.tone === 'danger' ? 'danger' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-message"
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="confirm-dialog-title">{shown.title}</h2>
            <p id="confirm-dialog-message" className="confirm-dialog-message">{shown.message}</p>
            <div className="row-actions">
              {shown.cancelLabel ? (
                <button ref={cancelButtonRef} className="ghost-button" onClick={() => close(false)}>
                  {shown.cancelLabel}
                </button>
              ) : null}
              <button
                ref={confirmButtonRef}
                className={shown.tone === 'danger' ? 'danger-button' : 'primary-button'}
                onClick={() => close(true)}
              >
                {shown.confirmLabel}
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
      // Fail closed if the provider is missing; Electron renderer code should
      // never fall back to native browser dialogs.
      return Promise.resolve(false)
    },
    [confirmAction]
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'

type BufferedFieldKey = string | number | null | undefined
type BufferedFieldCommit = (value: string) => void | Promise<unknown>

interface UseBufferedFieldOptions {
  value: string
  onCommit: BufferedFieldCommit
  delayMs?: number
  resetKey?: BufferedFieldKey
}

function isFailedCommitResult(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && 'ok' in value && (value as { ok?: unknown }).ok === false)
}

function safelyStartCommit(commit: BufferedFieldCommit, value: string, onSettled: (failed: boolean) => void) {
  try {
    const pending = commit(value)
    if (pending && typeof pending.then === 'function') {
      void pending.then((result) => {
        onSettled(isFailedCommitResult(result))
      }, () => onSettled(true))
      return
    }
    onSettled(false)
  } catch {
    onSettled(true)
  }
}

export function useBufferedField({ value, onCommit, delayMs = 0, resetKey }: UseBufferedFieldOptions) {
  const [draft, setDraft] = useState(value)
  const draftRef = useRef(value)
  const dirtyRef = useRef(false)
  const lastSubmittedRef = useRef<string | null>(null)
  const inFlightValueRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeCommitRef = useRef(onCommit)
  const resetKeyRef = useRef(resetKey)

  useEffect(() => {
    if (resetKeyRef.current === resetKey) activeCommitRef.current = onCommit
  }, [onCommit, resetKey])

  const clearTimer = useCallback(() => {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const flush = useCallback(
    (forceRetry = false) => {
      clearTimer()
      if (!dirtyRef.current) return
      const next = draftRef.current
      if (inFlightValueRef.current === next) return
      if (!forceRetry && lastSubmittedRef.current === next) return
      lastSubmittedRef.current = next
      const commit = activeCommitRef.current
      const attemptCommit = (remainingRetries: number) => {
        inFlightValueRef.current = next
        safelyStartCommit(commit, next, (failed) => {
          if (inFlightValueRef.current === next) inFlightValueRef.current = null
          if (
            failed &&
            remainingRetries > 0 &&
            draftRef.current === next &&
            lastSubmittedRef.current === next
          ) {
            attemptCommit(remainingRetries - 1)
            return
          }
          if (failed && lastSubmittedRef.current === next) lastSubmittedRef.current = null
        })
      }
      attemptCommit(1)
    },
    [clearTimer]
  )

  const updateDraft = useCallback(
    (next: string) => {
      draftRef.current = next
      dirtyRef.current = true
      setDraft(next)
      clearTimer()
      if (delayMs > 0) {
        timerRef.current = setTimeout(() => flush(false), delayMs)
      } else {
        flush(false)
      }
    },
    [clearTimer, delayMs, flush]
  )

  useEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      flush(false)
      resetKeyRef.current = resetKey
      activeCommitRef.current = onCommit
      draftRef.current = value
      dirtyRef.current = false
      lastSubmittedRef.current = null
      inFlightValueRef.current = null
      setDraft(value)
      return
    }

    if (Object.is(value, draftRef.current)) {
      dirtyRef.current = false
      lastSubmittedRef.current = null
      inFlightValueRef.current = null
      return
    }

    if (!dirtyRef.current) {
      draftRef.current = value
      setDraft(value)
    }
  }, [flush, onCommit, resetKey, value])

  useEffect(
    () => () => {
      clearTimer()
      if (dirtyRef.current && lastSubmittedRef.current !== draftRef.current) {
        safelyStartCommit(activeCommitRef.current, draftRef.current, () => undefined)
      }
    },
    [clearTimer]
  )

  return {
    value: draft,
    onChange: updateDraft,
    flush: () => flush(true)
  }
}

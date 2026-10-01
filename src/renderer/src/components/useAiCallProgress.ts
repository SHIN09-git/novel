import { useEffect, useRef, useState } from 'react'
import {
  isAiCallProgressInScope,
  isAiCallProgressCurrentForStartedAt,
  isTerminalAiCallProgressStage,
  parseAiCallProgressSnapshot,
  type AiCallProgressSnapshot
} from './aiCallProgressModel'

const POLL_INTERVAL_MS = 1_500
const CLOCK_INTERVAL_MS = 1_000

interface AiCallProgressBridge {
  getCallProgress?: (scope: { runId?: string; callId?: string }) => Promise<unknown>
}

export interface UseAiCallProgressOptions {
  isRunning: boolean
  runId?: string | null
  callId?: string | null
  startedAt?: string | null
}

function getProgressBridge(): AiCallProgressBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = (window as Window & { novelDirector?: { ai?: AiCallProgressBridge } }).novelDirector?.ai
  return typeof bridge?.getCallProgress === 'function' ? bridge : null
}

function startedAtMs(startedAt: string | null | undefined) {
  const parsed = startedAt ? Date.parse(startedAt) : Number.NaN
  return Number.isFinite(parsed) ? parsed : Date.now()
}

/** Polls the optional preload API while a scoped author call is actually running. */
export function useAiCallProgress({ isRunning, runId, callId, startedAt }: UseAiCallProgressOptions) {
  const [progress, setProgress] = useState<AiCallProgressSnapshot | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const requestVersionRef = useRef(0)
  const fallbackStartedAtRef = useRef(Date.now())
  const remoteElapsedRef = useRef<{ elapsedMs: number; receivedAt: number; isTerminal: boolean } | null>(null)
  const latestActivityAtMsRef = useRef<number | null>(null)
  const active = isRunning && Boolean(runId || callId)

  useEffect(() => {
    const requestVersion = ++requestVersionRef.current
    const fallbackStartedAt = startedAtMs(startedAt)
    fallbackStartedAtRef.current = fallbackStartedAt
    remoteElapsedRef.current = null
    latestActivityAtMsRef.current = null
    setProgress(null)

    const updateElapsed = () => {
      const remote = remoteElapsedRef.current
      const nextElapsed = remote
        ? remote.elapsedMs + (remote.isTerminal ? 0 : Math.max(0, Date.now() - remote.receivedAt))
        : Math.max(0, Date.now() - fallbackStartedAtRef.current)
      setElapsedMs(nextElapsed)
    }

    updateElapsed()
    if (!active) return () => { requestVersionRef.current++ }

    let disposed = false
    let pollTimer: number | null = null
    let inFlight = false
    const bridge = getProgressBridge()
    const stopPolling = () => {
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer)
        pollTimer = null
      }
    }
    const scheduleNextPoll = () => {
      if (disposed || !bridge?.getCallProgress) return
      stopPolling()
      pollTimer = window.setTimeout(() => { void poll() }, POLL_INTERVAL_MS)
    }
    const poll = async () => {
      if (!bridge?.getCallProgress || disposed || inFlight) return
      inFlight = true
      let shouldContinuePolling = true
      try {
        const raw = await bridge.getCallProgress({
          ...(runId ? { runId } : {}),
          ...(callId ? { callId } : {})
        })
        if (disposed || requestVersion !== requestVersionRef.current) return

        const snapshot = parseAiCallProgressSnapshot(raw)
        if (!snapshot || !isAiCallProgressInScope(snapshot, { runId, callId })) return
        const activityAtMs = snapshot.lastActivityAt ? Date.parse(snapshot.lastActivityAt) : Number.NaN
        if (Number.isFinite(activityAtMs) && latestActivityAtMsRef.current !== null && activityAtMs < latestActivityAtMsRef.current) return

        const terminal = isTerminalAiCallProgressStage(snapshot.stage)
        if (!isAiCallProgressCurrentForStartedAt(snapshot, startedAt)) return
        if (Number.isFinite(activityAtMs)) latestActivityAtMsRef.current = activityAtMs
        remoteElapsedRef.current = { elapsedMs: snapshot.elapsedMs, receivedAt: Date.now(), isTerminal: terminal }
        setProgress(snapshot)
        setElapsedMs(snapshot.elapsedMs)
        shouldContinuePolling = !terminal || !callId
      } catch {
        // Older bridges and transient IPC errors retain the local elapsed timer.
      } finally {
        inFlight = false
        if (!disposed && requestVersion === requestVersionRef.current && shouldContinuePolling) scheduleNextPoll()
      }
    }

    if (bridge) void poll()
    const clockTimer = window.setInterval(updateElapsed, CLOCK_INTERVAL_MS)

    return () => {
      disposed = true
      requestVersionRef.current++
      stopPolling()
      window.clearInterval(clockTimer)
    }
  }, [active, callId, runId, startedAt])

  return { progress, elapsedMs }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AIService } from '../../../services/AIService'
import {
  AiRewriteRequestGate,
  AiRewriteRequestGeneration,
  isAiRewriteScopeCurrent,
  type AiRewriteCallControl
} from './aiRewriteMenuModel'

interface ActiveRewrite {
  control: AiRewriteCallControl
  generation: number
  scopeKey: unknown
  service?: AIService
}

interface AiRewriteCancellationMessages {
  cancelled: string
  legacyBridge: string
  signalFailed: string
}

export function useAiRewriteRequest(
  onStatusChange: ((message: string) => void) | undefined,
  messages: AiRewriteCancellationMessages,
  scopeKey?: unknown
) {
  const [busyActionId, setBusyActionId] = useState<string | null>(null)
  const gateRef = useRef<AiRewriteRequestGate | null>(null)
  const generationRef = useRef<AiRewriteRequestGeneration | null>(null)
  const activeRef = useRef<ActiveRewrite | null>(null)
  const scopeRef = useRef(scopeKey)
  const statusRef = useRef(onStatusChange)
  const messagesRef = useRef(messages)
  statusRef.current = onStatusChange
  messagesRef.current = messages
  if (!gateRef.current) gateRef.current = new AiRewriteRequestGate()
  if (!generationRef.current) generationRef.current = new AiRewriteRequestGeneration()
  if (!isAiRewriteScopeCurrent(scopeRef.current, scopeKey)) {
    scopeRef.current = scopeKey
    generationRef.current.invalidate()
  }

  const begin = useCallback((actionId: string): AiRewriteCallControl | null => {
    if (activeRef.current || !gateRef.current || !generationRef.current) return null
    const control = gateRef.current.begin()
    activeRef.current = { control, generation: generationRef.current.next(), scopeKey: scopeRef.current }
    setBusyActionId(actionId)
    return control
  }, [])

  const attachService = useCallback((control: AiRewriteCallControl, service: AIService): boolean => {
    const active = activeRef.current
    if (!active || !gateRef.current?.isCurrent(control) || !isAiRewriteScopeCurrent(active.scopeKey, scopeRef.current)) return false
    activeRef.current = { ...active, service }
    return true
  }, [])

  const isCurrent = useCallback(
    (control: AiRewriteCallControl): boolean => {
      const active = activeRef.current
      return Boolean(
        active &&
        gateRef.current?.isCurrent(control) &&
        isAiRewriteScopeCurrent(active.scopeKey, scopeRef.current)
      )
    },
    []
  )

  const finish = useCallback((control: AiRewriteCallControl): boolean => {
    if (!gateRef.current?.finish(control)) return false
    activeRef.current = null
    setBusyActionId(null)
    return true
  }, [])

  const cancel = useCallback((): boolean => {
    const active = activeRef.current
    if (!active || !gateRef.current?.cancel(active.control)) return false
    activeRef.current = null
    setBusyActionId(null)
    const sameScope = isAiRewriteScopeCurrent(active.scopeKey, scopeRef.current)
    if (sameScope) statusRef.current?.(messagesRef.current.cancelled)
    if (active.service) {
      void active.service.cancelCall(active.control.runId, active.control.callId).then((result) => {
        if (
          !result.cancelled &&
          !activeRef.current &&
          generationRef.current?.isCurrent(active.generation) &&
          isAiRewriteScopeCurrent(active.scopeKey, scopeRef.current)
        ) statusRef.current?.(messagesRef.current.legacyBridge)
      }).catch(() => {
        if (
          !activeRef.current &&
          generationRef.current?.isCurrent(active.generation) &&
          isAiRewriteScopeCurrent(active.scopeKey, scopeRef.current)
        ) statusRef.current?.(messagesRef.current.signalFailed)
      })
    }
    return true
  }, [])

  useEffect(() => {
    setBusyActionId(null)
    return () => {
      generationRef.current?.invalidate()
      const active = activeRef.current
      if (!active || !gateRef.current?.cancel(active.control)) return
      activeRef.current = null
      if (active.service) void active.service.cancelCall(active.control.runId, active.control.callId).catch(() => undefined)
    }
  }, [scopeKey])

  return { busyActionId, activeCall: activeRef.current?.control ?? null, begin, attachService, isCurrent, finish, cancel }
}

import { lazy, Suspense, useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import type { AIService } from '../../../services/AIService'
import type { QuickRewriteTarget } from '../../../shared/types'
import { Field } from './FormFields'
import { AiRewriteMenuPortal } from './AiRewriteMenuPortal'
import {
  AI_REWRITE_ACTIONS,
  isAiRewriteScopeCurrent,
  type AiRewriteAction
} from './aiRewriteMenuModel'
import { useAiRewriteCandidate } from './useAiRewriteCandidate'

const AiRewriteResultPanel = lazy(() => import('./AiRewriteResultPanel').then((module) => ({ default: module.AiRewriteResultPanel })))

export { AI_REWRITE_ACTIONS, menuPositionAtCursor } from './aiRewriteMenuModel'
export type { AiRewriteAction } from './aiRewriteMenuModel'

interface RewriteSelection {
  start: number
  end: number
  text: string
  x: number
  y: number
}

interface AiRewriteTextAreaProps {
  label?: string
  value: string
  onChange?: (value: string) => void
  onApplyRewrite?: (value: string) => Promise<boolean>
  aiService?: AIService
  getAiService?: () => Promise<AIService>
  context?: string | (() => string)
  rows?: number
  className?: string
  placeholder?: string
  readOnly?: boolean
  hint?: string
  disabled?: boolean
  onBlur?: () => void
  onStatusChange?: (message: string) => void
  scopeKey?: string | number | null
  rewriteTarget?: QuickRewriteTarget
  onRewriteRequest?: (payload: { action: AiRewriteAction; selectedText: string; customInstruction: string }) => Promise<void> | void
}

export function AiRewriteTextArea({
  label,
  value,
  onChange,
  onApplyRewrite,
  aiService,
  getAiService,
  context,
  rows = 5,
  className,
  placeholder,
  readOnly,
  hint,
  disabled,
  onBlur,
  onStatusChange,
  scopeKey,
  rewriteTarget,
  onRewriteRequest
}: AiRewriteTextAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [selection, setSelection] = useState<RewriteSelection | null>(null)
  const [customInstruction, setCustomInstruction] = useState('')
  const [callbackBusyActionId, setCallbackBusyActionId] = useState<string | null>(null)
  const [lastApplied, setLastApplied] = useState<{ before: string; after: string } | null>(null)
  const valueRef = useRef(value)
  const scopeKeyRef = useRef(scopeKey)
  valueRef.current = value
  scopeKeyRef.current = scopeKey
  const rewrite = useAiRewriteCandidate({
    scopeKey,
    persistenceTarget: rewriteTarget,
    retainDraftAfterApply: rewriteTarget?.kind === 'reader_edit',
    getContextForTarget: () => typeof context === 'function' ? context() : context ?? '',
    getCurrentBody: (key) => isAiRewriteScopeCurrent(key, scopeKeyRef.current) ? valueRef.current : undefined,
    getAiService: async () => aiService ?? (getAiService ? await getAiService() : null),
    onStatusChange,
    onApply: async (candidate, next) => {
      if (disabled || readOnly || !onChange) return false
      if (onApplyRewrite && !(await onApplyRewrite(next))) return false
      setLastApplied({ before: candidate.sourceBody, after: next })
      if (!onApplyRewrite) onChange(next)
      requestAnimationFrame(() => {
        const cursor = candidate.scope === 'chapter' ? 0 : candidate.selection.start + candidate.text.length
        textareaRef.current?.focus()
        textareaRef.current?.setSelectionRange(cursor, cursor)
      })
      return true
    }
  })
  const busyActionId = callbackBusyActionId ?? rewrite.busyActionId

  useEffect(() => { setSelection(null); setLastApplied(null) }, [scopeKey])

  const dismissMenu = useCallback(() => {
    if (!busyActionId) setSelection(null)
  }, [busyActionId])

  const cancelActiveRewrite = useCallback(() => {
    if (rewrite.cancel()) setSelection(null)
  }, [rewrite.cancel])

  function openMenu(event: MouseEvent<HTMLTextAreaElement>) {
    if (disabled || (readOnly && !onRewriteRequest)) return
    const target = event.currentTarget
    const start = target.selectionStart
    const end = target.selectionEnd
    const text = value.slice(start, end)
    if (!text.trim()) return
    event.preventDefault()
    setSelection({
      start,
      end,
      text,
      x: event.clientX,
      y: event.clientY
    })
  }

  async function runRewrite(action: AiRewriteAction) {
    if (!selection || busyActionId) return
    const selected = selection
    const finalInstruction = action.requiresCustomInstruction ? customInstruction.trim() : action.instruction
    if (action.requiresCustomInstruction && !finalInstruction) {
      onStatusChange?.('请先填写自定义重写需求。')
      return
    }
    if (onRewriteRequest) {
      const sourceScopeKey = scopeKey
      setCallbackBusyActionId(action.id)
      try {
        await onRewriteRequest({ action, selectedText: selected.text, customInstruction: finalInstruction })
        if (isAiRewriteScopeCurrent(sourceScopeKey, scopeKeyRef.current)) setSelection(null)
      } catch (error) {
        onStatusChange?.(error instanceof Error ? error.message : 'AI 快速重写失败。')
      } finally {
        setCallbackBusyActionId(null)
      }
      return
    }

    const sourceScopeKey = scopeKey
    await rewrite.run(action, { targetKey: sourceScopeKey, sourceBody: valueRef.current,
      selection: selected, context: typeof context === 'function' ? context() : context ?? '',
      instruction: finalInstruction })
    if (isAiRewriteScopeCurrent(sourceScopeKey, scopeKeyRef.current)) setSelection(null)
  }

  const menu = selection ? (
    <AiRewriteMenuPortal
      anchor={selection}
      selectionLength={selection.text.trim().length}
      busyActionId={busyActionId}
      activeCall={rewrite.activeCall}
      customInstruction={customInstruction}
      hint="返回候选后可对比、编辑和应用。"
      onCustomInstructionChange={setCustomInstruction}
      onAction={(action) => void runRewrite(action)}
      onCancel={onRewriteRequest ? undefined : cancelActiveRewrite}
      onDismiss={dismissMenu}
    />
  ) : null

  const textarea = (
    <div className="ai-rewrite-textarea-wrap">
      <textarea
        ref={textareaRef}
        className={className}
        rows={rows}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={disabled}
        onBlur={onBlur}
        onContextMenu={openMenu}
        onChange={(event) => onChange?.(event.target.value)}
      />
      {lastApplied ? <button type="button" className="ghost-button" disabled={Boolean(busyActionId) || rewrite.applying} onClick={() => {
        if (valueRef.current === lastApplied.after && !readOnly && !disabled) {
          onChange?.(lastApplied.before)
          setLastApplied(null)
          onStatusChange?.('已撤销刚才的重写。')
        } else onStatusChange?.('正文已发生其他修改，可通过版本历史恢复。')
      }}>撤销刚才重写</button> : null}
      {menu}
      {rewrite.candidate ? <Suspense fallback={null}><AiRewriteResultPanel result={rewrite} onUseSelection={() => {
        const textarea = textareaRef.current
        if (!textarea) return
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        rewrite.retarget({ start, end, text: valueRef.current.slice(start, end) })
        setSelection(null)
      }} /></Suspense> : null}
    </div>
  )

  return label ? (
    <Field label={label} hint={hint}>
      {textarea}
    </Field>
  ) : (
    textarea
  )
}
